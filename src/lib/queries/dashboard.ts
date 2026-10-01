/**
 * Datalaag voor het dashboard (SPEC §F1, taak T14).
 *
 * Dit zijn de cijfers waar de eigenaar op stuurt, dus twee regels staan hier voorop:
 *
 * 1. **Alles telt de database.** Elke aggregatie gebeurt met `aggregate`, `count`,
 *    `groupBy` of één `$queryRaw`-som; er worden nooit alle onderdelen of alle
 *    verkopen in Node geladen om ze daar op te tellen (acceptatiecriterium T14). De
 *    enige rijen die deze module echt ophaalt zijn de lage-voorraadlijst (per
 *    definitie een kort boodschappenlijstje) en de top 5 / laatste 10.
 * 2. **SPEC §3 regel 1:** naar buiten gaan uitsluitend plain objects — `Decimal`
 *    wordt `number`, `Date` wordt een ISO-string. Nooit een Prisma-object richting
 *    een client component.
 *
 * Elk bedrag dat deze module teruggeeft zegt in zijn NAAM of het inclusief of
 * exclusief btw is (`...Incl` / `...Excl`), zoals SPEC §3 regel 0 voorschrijft.
 * Sinds T18 geeft de voorraadwaarde verkoop beide varianten terug: het incl.-bedrag
 * (wat het schap aan de kassa opbrengt) en het teruggerekende excl.-bedrag (de basis
 * waarop marge en rapportages rekenen). Het dashboard toont ze naast elkaar, elk
 * gelabeld, want het zijn twee verschillende dingen. De voorraadwaarde INKOOP blijft
 * excl. btw — dat is wat er op de leveranciersfacturen staat.
 *
 * Server-only: importeer dit bestand niet in een client component.
 */

import { prisma } from "@/lib/db";
import {
  DEFAULT_RECENT_SALES_LIMIT,
  listRecentSales,
  type RecentSaleDTO,
} from "@/lib/queries/sales";

import { buildPartWhere } from "./parts";

// ---------------------------------------------------------------------------
// Constanten
// ---------------------------------------------------------------------------

/** Top 5 bestsellers, zowel over 30 dagen als all-time (SPEC §F1). */
export const BESTSELLER_LIMIT = 5;

/** De "laatste 30 dagen" uit SPEC §F1. */
export const BESTSELLER_PERIOD_DAYS = 30;

/**
 * Maximum aantal regels in de lage-voorraadlijst op het dashboard. De volledige
 * lijst staat achter de link naar `/onderdelen?lowStockOnly=1`; het dashboard toont
 * de urgentste gevallen.
 */
export const LOW_STOCK_LIST_LIMIT = 10;

/** Laatste verkopen op het dashboard (SPEC §F1: "laatste 10 verkopen"). */
export const RECENT_SALES_LIMIT = DEFAULT_RECENT_SALES_LIMIT;

// ---------------------------------------------------------------------------
// DTO's
// ---------------------------------------------------------------------------

/** De kaarten bovenaan het dashboard. Alle bedragen EXCL. btw. */
export interface DashboardTotalsDTO {
  /** `Σ stockQuantity * purchasePriceExcl` over niet-gearchiveerde onderdelen. */
  stockValuePurchaseExcl: number;
  /**
   * `Σ stockQuantity * (salePriceIncl / (1 + vatRate / 100))` over niet-gearchiveerde
   * onderdelen: de verkoopwaarde op EXCL.-basis, want de opgeslagen verkoopprijs is
   * incl. btw en btw is geen omzet van de winkel.
   */
  stockValueSaleExcl: number;
  /**
   * `Σ stockQuantity * salePriceIncl` over niet-gearchiveerde onderdelen: de
   * verkoopwaarde van het schap tegen de prijzen die de klant betaalt (T18). Staat
   * naast `stockValueSaleExcl` omdat dat twee verschillende dingen zijn — het
   * dashboard labelt ze daarom allebei expliciet.
   */
  stockValueSaleIncl: number;
  /** Aantal unieke, niet-gearchiveerde onderdelen. */
  uniquePartCount: number;
  /** `Σ stockQuantity` over niet-gearchiveerde onderdelen. */
  totalStockQuantity: number;
  /** Aantal onderdelen met `minStock > 0` én `stockQuantity <= minStock`. */
  lowStockCount: number;
}

/** Eén regel in de lage-voorraadlijst. */
export interface LowStockPartDTO {
  id: string;
  name: string;
  sku: string;
  brandName: string | null;
  supplierName: string | null;
  stockQuantity: number;
  minStock: number;
  /** `minStock - stockQuantity`; het aantal stuks dat tekort is. Nooit negatief. */
  shortage: number;
}

/** Eén bestseller: aantal verkochte/verbruikte stuks per onderdeel. */
export interface BestsellerDTO {
  partId: string;
  name: string;
  sku: string;
  brandName: string | null;
  /** Som van `quantity` over balie én werkplaats; beide verbruiken voorraad. */
  quantitySold: number;
  /** Gearchiveerde onderdelen blijven in de historie staan, wel gemarkeerd. */
  isArchived: boolean;
}

/** Een recente verkoop plus de archiefstatus van het onderdeel. */
export interface DashboardRecentSaleDTO extends RecentSaleDTO {
  isArchived: boolean;
}

/** Alles wat het dashboard nodig heeft, in één plain object. */
export interface DashboardDataDTO {
  totals: DashboardTotalsDTO;
  lowStockParts: LowStockPartDTO[];
  bestsellersLast30Days: BestsellerDTO[];
  bestsellersAllTime: BestsellerDTO[];
  recentSales: DashboardRecentSaleDTO[];
  /** Begin van het bestsellervenster als ISO-string, zodat de UI het kan tonen. */
  bestsellerPeriodStart: string;
}

// ---------------------------------------------------------------------------
// Conversie van ruwe SQL-waarden
// ---------------------------------------------------------------------------

/**
 * Zet een waarde uit een `$queryRaw`-resultaat om naar een gewone `number`.
 *
 * Dit is de valkuil van deze query. `SUM("stockQuantity" * "purchasePriceExcl")` geeft in
 * Postgres een `numeric` terug, en `numeric` past niet in een JavaScript `number`
 * zonder precisieverlies. De driver levert zo'n waarde daarom NIET als getal aan: hij
 * komt binnen als `string` of als `Decimal`-object, afhankelijk van Prisma-versie,
 * driveradapter en of de kolom `SUM` of `SUM(...)::float8` was. `Number(decimal)`
 * werkt toevallig via `valueOf()`, maar `undefined` of een leeg resultaat zou
 * stilletjes `NaN` opleveren — en `formatEuro(NaN)` toont "€ NaN" op het scherm waar
 * de eigenaar zijn voorraadwaarde afleest.
 *
 * Daarom converteren we expliciet en per type, met `0` als bodem:
 *
 * - `null` / `undefined`  → `0` (lege database: `SUM` over nul rijen is `NULL`)
 * - `number`              → zichzelf, tenzij `NaN`/`Infinity`
 * - `bigint`              → `Number(...)` (bv. een `COUNT`)
 * - `string`              → `Number(...)`, `0` als dat geen eindig getal geeft
 * - `Decimal`-achtig      → `.toNumber()` (de expliciete decimal.js-API)
 *
 * Precisie: de kolommen zijn `Decimal(10,2)`, dus zelfs een voorraad van miljoenen
 * stuks blijft ruim binnen `Number.MAX_SAFE_INTEGER / 100`.
 */
export function rawNumericToNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (
    typeof value === "object" &&
    typeof (value as { toNumber?: unknown }).toNumber === "function"
  ) {
    const parsed = (value as { toNumber: () => unknown }).toNumber();
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

/** Vorm van de ene rij die `getStockValue` uit Postgres terugkrijgt. */
interface StockValueRow {
  purchaseValue: unknown;
  saleValue: unknown;
  saleValueIncl: unknown;
}

/**
 * Leest de twee voorraadwaarden uit het ruwe queryresultaat. Apart en geëxporteerd,
 * zodat precies deze conversie zonder database getest kan worden: een lege database
 * (geen rijen, of `null`-sommen) moet `0` opleveren, nooit `NaN`.
 */
export function readStockValueRows(rows: unknown): {
  stockValuePurchaseExcl: number;
  stockValueSaleExcl: number;
  stockValueSaleIncl: number;
} {
  const row = Array.isArray(rows) ? (rows[0] as StockValueRow | undefined) : undefined;

  return {
    stockValuePurchaseExcl: rawNumericToNumber(row?.purchaseValue),
    stockValueSaleExcl: rawNumericToNumber(row?.saleValue),
    stockValueSaleIncl: rawNumericToNumber(row?.saleValueIncl),
  };
}

// ---------------------------------------------------------------------------
// Voorraadwaarde
// ---------------------------------------------------------------------------

/**
 * Voorraadwaarde inkoop (excl. btw) en verkoop (zowel incl. als excl. btw), SPEC §4.
 *
 * De inkoopprijs staat al excl. btw in de database en blijft dat hier: dat is het
 * bedrag dat de winkel voor het schap betaald heeft. De verkoopprijs staat er sinds
 * datamodel v2 INCL. btw in; die wordt hier één keer rechtstreeks gesommeerd (het
 * incl.-bedrag, T18) en één keer teruggerekend naar excl. met
 * `ROUND("salePriceIncl" / (1 + "vatRate" / 100), 2)` — per stuk afgerond, exact
 * dezelfde afleiding als `priceExclVat` in `@/lib/money` doet voor één onderdeel.
 * Zou je pas ná de sommatie afronden, dan kon het dashboardtotaal een paar cent
 * verschillen van de som van de regels op `/onderdelen`, en dat is precies het soort
 * verschil waar de eigenaar over valt.
 *
 * `prisma.part.aggregate` kan dit niet: dat sommeert één kolom, en hier is het de som
 * van een PRODUCT van twee kolommen (`stockQuantity * purchasePriceExcl`). Het in Node
 * uitrekenen zou betekenen dat elk onderdeel opgehaald wordt — precies wat T14
 * verbiedt. Dus één `$queryRaw` die beide sommen in één scan over `Part` doet.
 *
 * De query gebruikt Prisma's tagged template. Er komt hier geen enkele
 * gebruikersinvoer in voor; mocht dat ooit veranderen, dan hoort die waarde als
 * `${parameter}` in de template (wordt een gebonden parameter), nooit via
 * string-interpolatie in de SQL zelf.
 *
 * `COALESCE(..., 0)` vangt de lege database af: `SUM` over nul rijen geeft in SQL
 * `NULL`. De conversie in `readStockValueRows` vangt hem nog een tweede keer af,
 * omdat `numeric` afhankelijk van de driver als string of `Decimal` binnenkomt.
 */
export async function getStockValue(): Promise<{
  stockValuePurchaseExcl: number;
  stockValueSaleExcl: number;
  stockValueSaleIncl: number;
}> {
  const rows = await prisma.$queryRaw<StockValueRow[]>`
    SELECT
      COALESCE(SUM("stockQuantity" * "purchasePriceExcl"), 0) AS "purchaseValue",
      COALESCE(
        SUM("stockQuantity" * ROUND("salePriceIncl" / (1 + "vatRate" / 100), 2)),
        0
      ) AS "saleValue",
      COALESCE(SUM("stockQuantity" * "salePriceIncl"), 0) AS "saleValueIncl"
    FROM "Part"
    WHERE "archivedAt" IS NULL
  `;

  return readStockValueRows(rows);
}

// ---------------------------------------------------------------------------
// Kerncijfers
// ---------------------------------------------------------------------------

/**
 * De `where` voor "lage voorraad", letterlijk hergebruikt uit de onderdelen-datalaag.
 *
 * Bewust GEEN eigen kopie van de voorwaarde: `buildPartWhere({ lowStockOnly: true })`
 * is exact wat `/onderdelen?lowStockOnly=1` gebruikt, inclusief de field reference
 * `stockQuantity <= minStock` en de eis `minStock > 0`. Zo kunnen het dashboard en
 * het voorraadoverzicht per constructie nooit een verschillend aantal tonen: zou
 * iemand de definitie ooit aanpassen, dan schuift die op beide plekken tegelijk mee.
 *
 * Het randgeval `minStock = 0` (de default, "geen drempel ingesteld") telt daardoor
 * nooit als lage voorraad, ook niet bij voorraad 0.
 */
function lowStockWhere() {
  return buildPartWhere({ lowStockOnly: true });
}

/**
 * De vijf getallen voor de kaarten bovenaan (SPEC §F1).
 *
 * Gearchiveerde onderdelen doen nergens mee: `aggregate` en `count` filteren op
 * `archivedAt: null`, net als `getStockValue`. De drie queries lopen parallel.
 */
export async function getDashboardTotals(): Promise<DashboardTotalsDTO> {
  const [stockValue, aggregate, lowStockCount] = await Promise.all([
    getStockValue(),
    prisma.part.aggregate({
      where: { archivedAt: null },
      _count: { _all: true },
      _sum: { stockQuantity: true },
    }),
    prisma.part.count({ where: lowStockWhere() }),
  ]);

  return {
    stockValuePurchaseExcl: stockValue.stockValuePurchaseExcl,
    stockValueSaleExcl: stockValue.stockValueSaleExcl,
    stockValueSaleIncl: stockValue.stockValueSaleIncl,
    // Lege database: `_count._all` is 0 en `_sum.stockQuantity` is `null`.
    uniquePartCount: rawNumericToNumber(aggregate?._count?._all),
    totalStockQuantity: rawNumericToNumber(aggregate?._sum?.stockQuantity),
    lowStockCount: rawNumericToNumber(lowStockCount),
  };
}

// ---------------------------------------------------------------------------
// Lage voorraad
// ---------------------------------------------------------------------------

/** Het minimale rijtje dat `sortByShortage` nodig heeft. */
interface ShortageRow {
  stockQuantity: number;
  minStock: number;
}

/**
 * Sorteert op grootste TEKORT (`minStock - stockQuantity`), aflopend (SPEC §F1).
 *
 * Postgres kan dit niet via Prisma's `orderBy`: dat accepteert kolommen, geen
 * expressies. Na-sorteren in Node is hier wél verantwoord — anders dan bij een
 * gepagineerde lijst — omdat de database al gefilterd heeft: wat hier binnenkomt is
 * de lage-voorraadlijst zelf, het boodschappenlijstje van de winkel, niet de hele
 * voorraad. Er wordt dus nooit "alles" geladen.
 *
 * Tiebreaker op naam en id, zodat twee onderdelen met hetzelfde tekort bij elke
 * herlaadbeurt in dezelfde volgorde staan.
 */
export function sortByShortage<T extends ShortageRow & { name: string; id: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const shortageA = a.minStock - a.stockQuantity;
    const shortageB = b.minStock - b.stockQuantity;
    if (shortageA !== shortageB) {
      return shortageB - shortageA;
    }
    return a.name.localeCompare(b.name, "nl") || a.id.localeCompare(b.id);
  });
}

/**
 * De lage-voorraadlijst met leverancier (SPEC §F1). Alleen niet-gearchiveerde
 * onderdelen, want die filter zit in `lowStockWhere()`.
 */
export async function listLowStockParts(
  limit: number = LOW_STOCK_LIST_LIMIT,
): Promise<LowStockPartDTO[]> {
  const rows = await prisma.part.findMany({
    where: lowStockWhere(),
    select: {
      id: true,
      name: true,
      sku: true,
      stockQuantity: true,
      minStock: true,
      brand: { select: { name: true } },
      supplier: { select: { name: true } },
    },
  });

  const take =
    Number.isFinite(limit) && limit >= 1
      ? Math.floor(limit)
      : LOW_STOCK_LIST_LIMIT;

  return sortByShortage(rows ?? [])
    .slice(0, take)
    .map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      brandName: row.brand?.name ?? null,
      supplierName: row.supplier?.name ?? null,
      stockQuantity: row.stockQuantity,
      minStock: row.minStock,
      // Kan niet negatief zijn zolang de where-clause `stockQuantity <= minStock`
      // afdwingt; `Math.max` is de vangnet tegen een race met een levering die
      // tussen de query en het renderen binnenkomt.
      shortage: Math.max(0, row.minStock - row.stockQuantity),
    }));
}

// ---------------------------------------------------------------------------
// Bestsellers
// ---------------------------------------------------------------------------

/** Vorm van een `groupBy`-rij uit `prisma.sale.groupBy`. */
export interface BestsellerGroupRow {
  partId: string;
  _sum: { quantity: number | null } | null;
}

/**
 * Telt de `groupBy`-rijen samen per onderdeel, sorteert aflopend op aantal stuks en
 * snijdt de top N eruit.
 *
 * De database doet het zware werk al (`groupBy` + `_sum` + `orderBy` + `take`); deze
 * functie is het vangnet dat het resultaat onafhankelijk verifieerbaar maakt en
 * ervoor zorgt dat de volgorde deterministisch is. Rijen met hetzelfde `partId`
 * worden opgeteld, zodat de uitkomst ook klopt als de aanroeper ooit ongegroepeerde
 * rijen aanlevert. `null`-sommen tellen als 0 in plaats van `NaN`.
 */
export function rankBestsellers(
  rows: BestsellerGroupRow[],
  limit: number = BESTSELLER_LIMIT,
): { partId: string; quantitySold: number }[] {
  const totals = new Map<string, number>();

  for (const row of rows ?? []) {
    if (!row?.partId) {
      continue;
    }
    const quantity = rawNumericToNumber(row._sum?.quantity);
    totals.set(row.partId, (totals.get(row.partId) ?? 0) + quantity);
  }

  const take =
    Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : BESTSELLER_LIMIT;

  return [...totals.entries()]
    .map(([partId, quantitySold]) => ({ partId, quantitySold }))
    .sort(
      (a, b) =>
        b.quantitySold - a.quantitySold || a.partId.localeCompare(b.partId),
    )
    .slice(0, take);
}

/**
 * Top N best verkochte onderdelen op aantal stuks (SPEC §F1).
 *
 * Balie (`COUNTER`) én werkplaats (`WORKSHOP`) tellen samen mee: beide verbruiken
 * voorraad, en het dashboard gaat over wat er van het schap gaat. De uitsplitsing per
 * kanaal hoort in de rapportages (SPEC §F6), niet hier.
 *
 * Het optellen gebeurt in de database met `groupBy` + `_sum`; er worden nooit alle
 * verkoopregels opgehaald. Daarna wordt per onderdeel nog naam, sku en merk opgehaald
 * — maximaal N rijen.
 *
 * Gearchiveerde onderdelen blijven hier gewoon in staan (SPEC §3 regel 4: historie is
 * onaantastbaar). Ze worden als `isArchived` gemarkeerd zodat de UI dat kan tonen.
 *
 * @param since Alleen verkopen vanaf dit moment; `null` = all-time.
 */
export async function listBestsellers(
  since: Date | null,
  limit: number = BESTSELLER_LIMIT,
): Promise<BestsellerDTO[]> {
  const take =
    Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : BESTSELLER_LIMIT;

  const grouped = await prisma.sale.groupBy({
    by: ["partId"],
    where: since ? { soldAt: { gte: since } } : undefined,
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take,
  });

  const ranked = rankBestsellers(
    (grouped ?? []) as unknown as BestsellerGroupRow[],
    take,
  );

  if (ranked.length === 0) {
    return [];
  }

  const parts = await prisma.part.findMany({
    where: { id: { in: ranked.map((row) => row.partId) } },
    select: {
      id: true,
      name: true,
      sku: true,
      archivedAt: true,
      brand: { select: { name: true } },
    },
  });

  const byId = new Map((parts ?? []).map((part) => [part.id, part]));

  return ranked
    .map((row) => {
      const part = byId.get(row.partId);
      if (!part) {
        // Kan alleen als een onderdeel tussen beide queries verdwijnt; de database
        // verbiedt dat (onDelete: Restrict), maar we tonen liever niets dan "undefined".
        return null;
      }
      return {
        partId: part.id,
        name: part.name,
        sku: part.sku,
        brandName: part.brand?.name ?? null,
        quantitySold: row.quantitySold,
        isArchived: part.archivedAt !== null,
      };
    })
    .filter((row): row is BestsellerDTO => row !== null);
}

// ---------------------------------------------------------------------------
// Recente verkopen
// ---------------------------------------------------------------------------

/**
 * De laatste verkopen (SPEC §F1), verrijkt met de archiefstatus van het onderdeel.
 *
 * Het ophalen zelf gebeurt met `listRecentSales` uit de verkoop-datalaag, zodat er
 * maar één definitie van "laatste verkopen" bestaat. Daar staat werkplaatsverbruik
 * bewust tussen: ook dat haalt voorraad van het schap.
 *
 * De extra query voor `isArchived` gaat over maximaal tien ids en is nodig omdat een
 * onderdeel dat vorige maand verkocht is inmiddels gearchiveerd kan zijn. Zo'n
 * verkoop hoort zichtbaar te blijven, maar wel duidelijk gemarkeerd.
 */
export async function listDashboardRecentSales(
  limit: number = RECENT_SALES_LIMIT,
): Promise<DashboardRecentSaleDTO[]> {
  const sales = await listRecentSales(limit);

  if (sales.length === 0) {
    return [];
  }

  const archived = await prisma.part.findMany({
    where: {
      id: { in: [...new Set(sales.map((sale) => sale.partId))] },
      archivedAt: { not: null },
    },
    select: { id: true },
  });

  const archivedIds = new Set((archived ?? []).map((part) => part.id));

  return sales.map((sale) => ({
    ...sale,
    isArchived: archivedIds.has(sale.partId),
  }));
}

// ---------------------------------------------------------------------------
// Alles in één keer
// ---------------------------------------------------------------------------

/** Begin van het bestsellervenster: `days` dagen terug vanaf `now`. */
export function periodStart(days: number, now: Date = new Date()): Date {
  const start = new Date(now.getTime());
  start.setDate(start.getDate() - days);
  return start;
}

/**
 * Alle dashboardgegevens in één aanroep. De vijf blokken zijn volledig onafhankelijk
 * van elkaar, dus ze lopen parallel met `Promise.all` — de pagina wacht op de
 * langzaamste query, niet op de som van alle queries.
 */
export async function getDashboardData(
  now: Date = new Date(),
): Promise<DashboardDataDTO> {
  const since = periodStart(BESTSELLER_PERIOD_DAYS, now);

  const [
    totals,
    lowStockParts,
    bestsellersLast30Days,
    bestsellersAllTime,
    recentSales,
  ] = await Promise.all([
    getDashboardTotals(),
    listLowStockParts(),
    listBestsellers(since),
    listBestsellers(null),
    listDashboardRecentSales(),
  ]);

  return {
    totals,
    lowStockParts,
    bestsellersLast30Days,
    bestsellersAllTime,
    recentSales,
    bestsellerPeriodStart: since.toISOString(),
  };
}
