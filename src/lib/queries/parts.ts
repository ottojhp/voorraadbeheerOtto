/**
 * Datalaag voor onderdelen (SPEC §F2, §F4, §F1).
 *
 * Deze module is de ENIGE plek waar de rest van de app onderdelen ophaalt. Ze geeft
 * uitsluitend plain DTO's terug (zie `./types`), nooit Prisma-objecten:
 * `Decimal` en `Date` zijn niet serialiseerbaar richting client components en
 * `Decimal` rekent bovendien anders dan `number` (SPEC §3 regel 1).
 *
 * Alle bedragen zijn EXCLUSIEF btw; incl.-bedragen worden afgeleid en alleen getoond
 * (SPEC §3 regel 0). Marge, margepercentage en de prijs incl. btw komen uit
 * `@/lib/money`, zodat die formules maar op één plek staan.
 *
 * Server-only: importeer dit bestand niet in een client component.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { Category } from "@/lib/labels";
import { calcMargin, calcMarginPct, priceWithVat } from "@/lib/money";

import type {
  PaginatedResult,
  PartDTO,
  PartSaleOptionDTO,
  PartSort,
  SortDir,
} from "./types";

// ---------------------------------------------------------------------------
// Constanten
// ---------------------------------------------------------------------------

/** Standaard aantal rijen per pagina (SPEC §F2: "paginering vanaf 50 rijen"). */
export const DEFAULT_PAGE_SIZE = 50;

/** Bovengrens, zodat een `?pageSize=100000` in de URL de server niet kan opblazen. */
export const MAX_PAGE_SIZE = 200;

/** Standaard aantal suggesties in het verkoopscherm. */
export const DEFAULT_SALE_SEARCH_LIMIT = 10;

/** Bovengrens voor `searchPartsForSale`. */
export const MAX_SALE_SEARCH_LIMIT = 50;

/**
 * Relaties die elke `PartDTO` nodig heeft. Bewust `select` binnen de include: een
 * onderdeel heeft alleen de id en naam van merk/leverancier nodig, niet hun hele rij.
 */
const PART_INCLUDE = {
  brand: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.PartInclude;

/** Een Part-rij zoals Prisma die met `PART_INCLUDE` teruggeeft. */
export type PartRecord = Prisma.PartGetPayload<{
  include: typeof PART_INCLUDE;
}>;

// ---------------------------------------------------------------------------
// Conversie van Prisma-typen naar plain JS
// ---------------------------------------------------------------------------

/**
 * Zet een Prisma `Decimal` om naar een gewone `number`.
 *
 * Waarom `.toNumber()` en niet `Number(decimal)`: `Decimal` (decimal.js) heeft een
 * `valueOf()`, dus `Number(decimal)` geeft toevallig hetzelfde antwoord — maar het is
 * een impliciete conversie die stilletjes `NaN` oplevert zodra de waarde géén Decimal
 * blijkt te zijn (bv. een string uit `$queryRaw` of `null` uit een optioneel veld).
 * `.toNumber()` is de expliciete, gedocumenteerde API van decimal.js en klapt er
 * zichtbaar uit als het type niet klopt.
 *
 * Precisieverlies is hier geen risico: de kolommen zijn `Decimal(10,2)` en
 * `Decimal(5,2)`, dus maximaal 99.999.999,99 — ruim binnen `Number.MAX_SAFE_INTEGER`
 * gedeeld door 100. Afronden op 2 decimalen gebeurt in `@/lib/money`.
 */
function toNumber(value: Prisma.Decimal): number {
  return value.toNumber();
}

/** Datum → ISO-string (serialiseerbaar); `null` blijft `null`. */
function toIso(value: Date): string;
function toIso(value: Date | null): string | null;
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * Lage voorraad volgens SPEC §F1: `stockQuantity <= minStock` ÉN `minStock > 0`.
 *
 * De tweede voorwaarde is essentieel: onderdelen zonder ingestelde drempel
 * (`minStock = 0`, de default) zouden anders bij voorraad 0 allemaal als "lage
 * voorraad" in de bestellijst belanden, terwijl de eigenaar daar nooit een drempel
 * voor heeft opgegeven.
 */
export function isLowStock(stockQuantity: number, minStock: number): boolean {
  return minStock > 0 && stockQuantity <= minStock;
}

// ---------------------------------------------------------------------------
// DTO-mapper
// ---------------------------------------------------------------------------

/**
 * Mapt een Prisma-Part (met merk en leverancier) naar een plain `PartDTO`.
 * Dit is de enige plek waar `Decimal`/`Date` de app in- of uitgaan.
 */
export function toPartDTO(part: PartRecord): PartDTO {
  const purchasePrice = toNumber(part.purchasePrice);
  const salePrice = toNumber(part.salePrice);
  const vatRate = toNumber(part.vatRate);

  return {
    id: part.id,
    name: part.name,
    brand: part.brand ? { id: part.brand.id, name: part.brand.name } : null,
    category: part.category as Category,
    sku: part.sku,
    barcode: part.barcode,

    purchasePrice,
    salePrice,
    vatRate,
    salePriceInclVat: priceWithVat(salePrice, vatRate),
    margin: calcMargin(purchasePrice, salePrice),
    marginPct: calcMarginPct(purchasePrice, salePrice),

    stockQuantity: part.stockQuantity,
    minStock: part.minStock,
    isLowStock: isLowStock(part.stockQuantity, part.minStock),

    supplier: part.supplier
      ? { id: part.supplier.id, name: part.supplier.name }
      : null,

    description: part.description,
    fitsModels: part.fitsModels,
    location: part.location,

    archivedAt: toIso(part.archivedAt),
    createdAt: toIso(part.createdAt),
    updatedAt: toIso(part.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// listParts
// ---------------------------------------------------------------------------

export interface ListPartsParams {
  /** Vrije zoekterm; case-insensitive substring op naam, sku, barcode en pasvorm. */
  search?: string;
  /** Filter op één merk. Wordt genegeerd als `brandIsNull` aan staat. */
  brandId?: string;
  /** `true` = alleen onderdelen zónder merk (universele artikelen). */
  brandIsNull?: boolean;
  category?: Category;
  supplierId?: string;
  /** Alleen onderdelen onder of op hun minimumvoorraad (met drempel > 0). */
  lowStockOnly?: boolean;
  /** Gearchiveerde onderdelen meenemen. Standaard `false` (SPEC §3 regel 4). */
  includeArchived?: boolean;
  sort?: PartSort;
  sortDir?: SortDir;
  /** 1-gebaseerd. Waarden < 1 of niet-gehele getallen worden naar 1 genormaliseerd. */
  page?: number;
  pageSize?: number;
}

/**
 * Bouwt de Prisma `where` voor `listParts`. Apart en geëxporteerd, zodat het
 * filtergedrag zonder database getest kan worden.
 *
 * Let op `lowStockOnly`: de voorwaarde vergelijkt twee kolommen met elkaar
 * (`stockQuantity <= minStock`). Een gewone Prisma-`where` verwacht op die plek een
 * los getal. Daarom gebruiken we Prisma's **field references**
 * (`prisma.part.fields.minStock`, GA sinds Prisma 5, hier 6.2.1). Dat levert echte
 * SQL op (`"stockQuantity" <= "minStock"`), blijft combineerbaar met alle andere
 * filters, en houdt `count`, `orderBy`, `skip` en `take` gewoon werkend. De
 * alternatieven waren slechter: `$queryRaw` zou de hele where-clause dupliceren
 * (injectie- en onderhoudsrisico) en na-filteren in JavaScript zou de paginering
 * stukmaken, omdat `total` dan niet meer klopt met wat de database telde.
 */
export function buildPartWhere(params: ListPartsParams): Prisma.PartWhereInput {
  const where: Prisma.PartWhereInput = {};

  // Gearchiveerde onderdelen zijn standaard uitgesloten (SPEC §3 regel 4).
  if (!params.includeArchived) {
    where.archivedAt = null;
  }

  const search = params.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { sku: { contains: search, mode: "insensitive" } },
      { barcode: { contains: search, mode: "insensitive" } },
      { fitsModels: { contains: search, mode: "insensitive" } },
    ];
  }

  // "Zonder merk" en "dit merk" sluiten elkaar uit; het expliciete
  // universeel-filter wint, anders zou een achtergebleven brandId in de URL een
  // leeg resultaat geven.
  if (params.brandIsNull) {
    where.brandId = null;
  } else if (params.brandId) {
    where.brandId = params.brandId;
  }

  if (params.category) {
    where.category = params.category;
  }

  if (params.supplierId) {
    where.supplierId = params.supplierId;
  }

  if (params.lowStockOnly) {
    where.minStock = { gt: 0 };
    where.stockQuantity = { lte: prisma.part.fields.minStock };
  }

  return where;
}

/**
 * Bouwt de `orderBy` voor de sorteersleutels die de database zelf aankan.
 * `margin` staat er bewust niet bij — zie `listParts`.
 *
 * Er staat altijd `id` als laatste sleutel: zonder een unieke tiebreaker mag Postgres
 * rijen met dezelfde naam of voorraad per query in een andere volgorde teruggeven,
 * waardoor een rij tussen twee pagina's kan verdwijnen of dubbel kan verschijnen.
 */
export function buildPartOrderBy(
  sort: Exclude<PartSort, "margin"> = "name",
  sortDir: SortDir = "asc",
): Prisma.PartOrderByWithRelationInput[] {
  if (sort === "stock") {
    return [{ stockQuantity: sortDir }, { name: "asc" }, { id: "asc" }];
  }
  return [{ name: sortDir }, { id: "asc" }];
}

/** Normaliseert paginanummer en paginagrootte naar bruikbare gehele getallen. */
export function normalizePagination(
  page?: number,
  pageSize?: number,
): { page: number; pageSize: number; skip: number; take: number } {
  const safePage =
    Number.isFinite(page) && (page as number) >= 1
      ? Math.floor(page as number)
      : 1;

  const requested =
    Number.isFinite(pageSize) && (pageSize as number) >= 1
      ? Math.floor(pageSize as number)
      : DEFAULT_PAGE_SIZE;
  const safePageSize = Math.min(requested, MAX_PAGE_SIZE);

  return {
    page: safePage,
    pageSize: safePageSize,
    skip: (safePage - 1) * safePageSize,
    take: safePageSize,
  };
}

/** Aantal pagina's; 0 als er geen resultaten zijn, zodat de UI een EmptyState toont. */
function pageCountOf(total: number, pageSize: number): number {
  return total === 0 ? 0 : Math.ceil(total / pageSize);
}

/**
 * Gepagineerde lijst met onderdelen, inclusief filters en sortering (SPEC §F2).
 *
 * Sorteren op marge kan Postgres hier niet zelf: marge is een afgeleide waarde
 * (`salePrice - purchasePrice`) en Prisma's `orderBy` accepteert geen expressies.
 * We lossen dat op met twee queries in plaats van na-sorteren binnen de pagina:
 *
 *  1. haal van álle rijen die aan het filter voldoen alleen `id`, `name` en de twee
 *     prijzen op (drie kleine kolommen, geen relaties),
 *  2. sorteer in JavaScript op marge, bepaal `total`, snijd de gevraagde pagina eruit
 *     en haal alleen díe rijen volledig op.
 *
 * Afweging: na-sorteren binnen één pagina zou goedkoper zijn, maar maakt paginering
 * stuk — pagina 2 zou dan op de 51e t/m 100e rij op náám gesorteerd zijn en vervolgens
 * binnen die willekeurige deelverzameling op marge. Dat is geen sortering. De
 * `$queryRaw`-variant (`ORDER BY ("salePrice" - "purchasePrice")`) zou wél in SQL
 * sorteren, maar dwingt tot het dupliceren van de hele where-clause in ruwe SQL.
 * Consequentie van de gekozen aanpak: bij sorteren op marge leest stap 1 alle
 * gefilterde rijen. Voor het assortiment van één winkel (duizenden onderdelen) is dat
 * verwaarloosbaar; bij tienduizenden rijen is de volgende stap een gegenereerde
 * margekolom met index, niet ruwe SQL in de datalaag.
 *
 * Er wordt gesorteerd op marge in EURO's (excl. btw), niet op percentage.
 */
export async function listParts(
  params: ListPartsParams = {},
): Promise<PaginatedResult<PartDTO>> {
  const where = buildPartWhere(params);
  const { page, pageSize, skip, take } = normalizePagination(
    params.page,
    params.pageSize,
  );
  const sortDir: SortDir = params.sortDir === "desc" ? "desc" : "asc";

  if (params.sort === "margin") {
    const candidates = await prisma.part.findMany({
      where,
      select: {
        id: true,
        name: true,
        purchasePrice: true,
        salePrice: true,
      },
    });

    const ranked = candidates
      .map((row) => ({
        id: row.id,
        name: row.name,
        margin: calcMargin(
          toNumber(row.purchasePrice),
          toNumber(row.salePrice),
        ),
      }))
      .sort((a, b) => {
        const byMargin =
          sortDir === "asc" ? a.margin - b.margin : b.margin - a.margin;
        if (byMargin !== 0) {
          return byMargin;
        }
        // Stabiele tiebreaker, net als in `buildPartOrderBy`.
        return a.name.localeCompare(b.name, "nl") || a.id.localeCompare(b.id);
      });

    const total = ranked.length;
    const pageIds = ranked.slice(skip, skip + take).map((row) => row.id);

    if (pageIds.length === 0) {
      return {
        items: [],
        total,
        page,
        pageSize,
        pageCount: pageCountOf(total, pageSize),
      };
    }

    const rows = await prisma.part.findMany({
      where: { id: { in: pageIds } },
      include: PART_INCLUDE,
    });

    // `findMany` met `id: { in: [...] }` geeft geen gegarandeerde volgorde terug,
    // dus herstellen we de margevolgorde uit stap 2.
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = pageIds
      .map((id) => byId.get(id))
      .filter((row): row is PartRecord => row !== undefined)
      .map(toPartDTO);

    return {
      items,
      total,
      page,
      pageSize,
      pageCount: pageCountOf(total, pageSize),
    };
  }

  const orderBy = buildPartOrderBy(
    params.sort === "stock" ? "stock" : "name",
    sortDir,
  );

  const [total, rows] = await Promise.all([
    prisma.part.count({ where }),
    prisma.part.findMany({ where, include: PART_INCLUDE, orderBy, skip, take }),
  ]);

  return {
    items: rows.map(toPartDTO),
    total,
    page,
    pageSize,
    pageCount: pageCountOf(total, pageSize),
  };
}

// ---------------------------------------------------------------------------
// Losse onderdelen ophalen
// ---------------------------------------------------------------------------

/**
 * Eén onderdeel op id, of `null`. Geeft óók gearchiveerde onderdelen terug: de
 * bewerkpagina (T08) en rapportages moeten er nog bij kunnen (SPEC §3 regel 4).
 */
export async function getPartById(id: string): Promise<PartDTO | null> {
  if (!id) {
    return null;
  }

  const part = await prisma.part.findUnique({
    where: { id },
    include: PART_INCLUDE,
  });

  return part ? toPartDTO(part) : null;
}

/**
 * Onderdeel op exacte barcode, of `null`. Gearchiveerde onderdelen zijn uitgesloten:
 * het verkoopscherm (T12) mag een gearchiveerd onderdeel niet kunnen verkopen
 * (SPEC §F4). Daarom `findFirst` met twee voorwaarden in plaats van `findUnique`.
 */
export async function findPartByBarcode(
  barcode: string,
): Promise<PartDTO | null> {
  const value = barcode?.trim();
  if (!value) {
    return null;
  }

  const part = await prisma.part.findFirst({
    where: { barcode: value, archivedAt: null },
    include: PART_INCLUDE,
  });

  return part ? toPartDTO(part) : null;
}

/**
 * Zoeksuggesties voor het verkoopscherm (SPEC §F4): naam, sku of barcode,
 * case-insensitive, alleen niet-gearchiveerde onderdelen. Pasvorm (`fitsModels`) doet
 * hier bewust NIET mee — aan de balie zoek je het artikel zelf, en een vrij
 * pasvormveld levert daar vooral ruis op. Het voorraadoverzicht (T07) zoekt wél op
 * pasvorm.
 */
export async function searchPartsForSale(
  query: string,
  limit: number = DEFAULT_SALE_SEARCH_LIMIT,
): Promise<PartSaleOptionDTO[]> {
  const value = query?.trim();
  if (!value) {
    return [];
  }

  const take = Math.min(
    Number.isFinite(limit) && limit >= 1
      ? Math.floor(limit)
      : DEFAULT_SALE_SEARCH_LIMIT,
    MAX_SALE_SEARCH_LIMIT,
  );

  const rows = await prisma.part.findMany({
    where: {
      archivedAt: null,
      OR: [
        { name: { contains: value, mode: "insensitive" } },
        { sku: { contains: value, mode: "insensitive" } },
        { barcode: { contains: value, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      category: true,
      sku: true,
      barcode: true,
      stockQuantity: true,
      salePrice: true,
      vatRate: true,
      brand: { select: { name: true } },
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take,
  });

  return rows.map((row) => {
    const salePrice = toNumber(row.salePrice);
    const vatRate = toNumber(row.vatRate);

    return {
      id: row.id,
      name: row.name,
      brandName: row.brand?.name ?? null,
      category: row.category as Category,
      sku: row.sku,
      barcode: row.barcode,
      stockQuantity: row.stockQuantity,
      salePrice,
      vatRate,
      salePriceInclVat: priceWithVat(salePrice, vatRate),
    };
  });
}

// ---------------------------------------------------------------------------
// Filteropties voor het voorraadoverzicht (T07)
// ---------------------------------------------------------------------------

/**
 * Aantal actieve onderdelen zonder merk, voor de filterwaarde "universeel"
 * (SPEC §F2).
 *
 * De merken- en leverancierslijsten voor de filterdropdowns staan bewust NIET hier:
 * die domeinen hebben hun eigen datalaag, met exact dezelfde telling (actieve
 * onderdelen, `archivedAt = null`). T07 gebruikt daarvoor
 * `listBrandsWithPartCounts()` uit `./brands` en `listSuppliers()` uit
 * `./suppliers`; ze hier nogmaals bouwen zou twee bijna identieke functies per
 * dropdown opleveren. "Onderdelen zonder merk" is géén merk en heeft dus ook geen
 * rij in `Brand` — die telling hoort daarom wel bij de onderdelen-datalaag.
 */
export async function countUnbrandedParts(): Promise<number> {
  return prisma.part.count({ where: { brandId: null, archivedAt: null } });
}
