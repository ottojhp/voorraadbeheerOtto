/**
 * Datalaag voor de rapportagepagina (SPEC §F6, taak T15).
 *
 * Drie bindende regels uit SPEC §3 zitten hier ingebakken:
 *
 * - regel 0: er wordt uitsluitend op EXCL.-basis gerekend. De verkoopprijs staat
 *   sinds datamodel v2 INCLUSIEF btw in `Sale`, dus elke omzet- en margesom rekent
 *   die eerst terug met {@link SALE_PRICE_EXCL_SQL}. Btw is geen omzet en geen winst
 *   van de winkel. Sinds T18 geeft de kerncijfer-query daarnaast `revenueIncl` terug:
 *   het bedrag dat de klanten werkelijk betaald hebben, uitsluitend om te TONEN
 *   (incl. als hoofdbedrag, excl. eronder). Er wordt nergens met dat bedrag gerekend
 *   — marge, margepercentage, bestsellers, merken, categorieën, het omzetverloop en
 *   de CSV-export blijven onveranderd op excl.-basis, en elk veld zegt in zijn naam
 *   wat het is.
 * - regel 1: naar buiten gaan uitsluitend plain DTO's — `Decimal` wordt `number`,
 *   `Date` wordt een ISO-string.
 * - regel 3 (historische correctheid): marge komt ALTIJD uit de prijzen zoals ze op
 *   het moment van verkoop vastlagen (het afgeleide excl.-bedrag uit
 *   `salePriceInclAtSale` minus `purchasePriceExclAtSale`) — nooit uit de huidige
 *   `Part.purchasePriceExcl`/`Part.salePriceIncl`.
 *   Die laatste kunnen inmiddels gewijzigd zijn; de marge van een verkoop van drie
 *   maanden geleden mag daar niet door veranderen.
 *
 * Aggregatie gebeurt in de database. `omzet` en `marge` zijn allebei een som van een
 * PRODUCT van kolommen (`quantity * <verkoop excl.>`, resp.
 * `quantity * (<verkoop excl.> - purchasePriceExclAtSale)`) — dat kan Prisma's
 * `aggregate`/`groupBy` niet (die sommeren één kolom), dus deze module gebruikt
 * `$queryRaw` met Prisma's tagged template (`Prisma.sql` + `Prisma.join`), net als
 * `getStockValue` in `@/lib/queries/dashboard.ts`. Elke variabele waarde (periode,
 * kanaal, categorie, limiet) gaat als `${...}`-parameter de template in — dat wordt
 * door Prisma een gebonden queryparameter, NOOIT string-interpolatie van de SQL
 * zelf. Er wordt nergens een stuk van de query zelf (kolomnaam, tabelnaam,
 * SQL-sleutelwoord) opgebouwd uit gebruikersinvoer, dus SQL-injectie is hier niet
 * mogelijk: een filterwaarde kan een queryparameter worden gemanipuleerd, nooit de
 * vorm van de query.
 *
 * Server-only: importeer dit bestand niet in een client component.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { CATEGORY_OPTIONS, getCategoryLabel, type Category, type SaleChannel } from "@/lib/labels";
import { calcMarginPct } from "@/lib/money";
import { rawNumericToNumber } from "@/lib/queries/dashboard";
import {
  enumerateDayBuckets,
  enumerateWeekBuckets,
} from "@/lib/reporting-period";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** Gedeelde filters voor alle rapportagequery's. `from`/`to` zijn UTC-instants. */
export interface ReportFilters {
  from: Date;
  to: Date;
  /** Alleen deze kanaal, of alle kanalen als niet opgegeven. */
  channel?: SaleChannel;
  /** Alleen deze categorie, of alle categorieën als niet opgegeven. */
  category?: Category;
}

export type RevenueBucketSize = "day" | "week";

// ---------------------------------------------------------------------------
// DTO's
// ---------------------------------------------------------------------------

/**
 * Kerncijfers over de periode (SPEC §F6). `revenue`, `margin` en `marginPct` staan
 * EXCL. btw — dat is waar de rapportage over gaat, want btw is geen omzet en geen
 * winst. `revenueIncl` staat er sinds T18 naast: het bedrag dat de klanten in deze
 * periode werkelijk betaald hebben. De UI zet dat als hoofdbedrag met het
 * excl.-bedrag eronder, maar er wordt nergens mee gerekend.
 */
export interface ReportSummaryDTO {
  revenue: number;
  /** `Σ quantity * salePriceInclAtSale`: bruto-omzet INCL. btw (alleen tonen). */
  revenueIncl: number;
  margin: number;
  /** `0` als `revenue` 0 is, nooit `NaN`. */
  marginPct: number;
  itemsSold: number;
  transactionCount: number;
  /**
   * Totaal gegeven korting over de periode (T26):
   * `Σ quantity * (listPriceInclAtSale - salePriceInclAtSale)`. INCL. btw, want dat is
   * het bedrag dat de klant niet heeft hoeven betalen; de UI zet dit als hoofdbedrag
   * met {@link discountTotalExcl} eronder, net als bij de omzet.
   */
  discountTotalIncl: number;
  /** Dezelfde korting op EXCL.-basis: het bedrag dat de omzet excl. btw gemist heeft. */
  discountTotalExcl: number;
}

/** Eén regel van de balie/werkplaats-uitsplitsing. */
export interface ChannelBreakdownDTO {
  channel: SaleChannel;
  /** EXCL. btw. */
  revenue: number;
  /** INCL. btw (alleen tonen), zie {@link ReportSummaryDTO.revenueIncl}. */
  revenueIncl: number;
  margin: number;
  itemsSold: number;
  transactionCount: number;
  /** Gegeven korting binnen dit kanaal (T26), incl. resp. excl. btw. */
  discountTotalIncl: number;
  discountTotalExcl: number;
}

/** Eén bestseller over de gekozen periode. */
export interface BestsellerReportDTO {
  partId: string;
  name: string;
  sku: string;
  brandName: string | null;
  /** Gearchiveerde onderdelen blijven in de historie staan (SPEC §3 regel 4). */
  isArchived: boolean;
  quantitySold: number;
  revenue: number;
  margin: number;
}

/** Omzet/marge per merk over de periode. */
export interface BrandRevenueDTO {
  brandId: string | null;
  /** `"Zonder merk"` als `brandId` `null` is (universele onderdelen). */
  brandName: string;
  revenue: number;
  margin: number;
  itemsSold: number;
}

/** Omzet/marge per categorie over de periode. */
export interface CategoryRevenueDTO {
  category: Category;
  categoryLabel: string;
  revenue: number;
  margin: number;
  itemsSold: number;
}

/** Eén punt in de omzetverloop-grafiek. */
export interface RevenueBucketDTO {
  /** `YYYY-MM-DD`: de dag zelf, of de maandag van de ISO-week bij `bucket: "week"`. */
  bucket: string;
  revenue: number;
  margin: number;
}

/** Alles wat de rapportagepagina in één keer nodig heeft. */
export interface ReportDataDTO {
  summary: ReportSummaryDTO;
  channelBreakdown: ChannelBreakdownDTO[];
  bestsellers: BestsellerReportDTO[];
  revenueByBrand: BrandRevenueDTO[];
  revenueByCategory: CategoryRevenueDTO[];
  revenueOverTime: RevenueBucketDTO[];
}

// ---------------------------------------------------------------------------
// Constanten
// ---------------------------------------------------------------------------

/** Aantal bestsellers dat de pagina zelf toont. */
export const DEFAULT_BESTSELLERS_LIMIT = 20;
/** Bovengrens voor de bestsellerslijst, ook voor de CSV-export. */
export const MAX_BESTSELLERS_LIMIT = 500;

// ---------------------------------------------------------------------------
// WHERE-opbouw (parameterized — zie de uitleg bovenaan dit bestand)
// ---------------------------------------------------------------------------

/**
 * De gedeelde `WHERE`-voorwaarden: periode altijd, kanaal en categorie alleen als
 * opgegeven. `s` = `"Sale"`, `p` = `"Part"` (de join-aliassen die elke query hieronder
 * gebruikt). De enum-cast (`::"SaleChannel"`, `::"Category"`) is nodig omdat een
 * `$queryRaw`-parameter als tekst binnenkomt; Postgres zet die niet vanzelf om naar
 * een enum-kolom.
 */
/**
 * De verkoopprijs per stuk EXCLUSIEF btw, afgeleid uit wat er historisch is
 * vastgelegd: `salePriceInclAtSale / (1 + vatRateAtSale / 100)`, per stuk afgerond op
 * centen (SPEC §3 regel 0, v2.0).
 *
 * Eén keer gedefinieerd en in elke query hieronder ingevoegd, zodat omzet, marge,
 * kanaaluitsplitsing, bestsellers, merken, categorieën en het omzetverloop per
 * constructie dezelfde afleiding gebruiken. Zes losse kopieën van deze expressie was
 * de zekerste manier om ooit één plek te vergeten.
 *
 * Er wordt met `vatRateAtSale` gerekend, niet met het huidige `Part.vatRate`: een
 * tariefwijziging mag de omzet van vorig kwartaal niet herschrijven.
 *
 * Het afronden gebeurt vóór de vermenigvuldiging met `quantity`, net als in
 * `getStockValue`, zodat een rapportagetotaal gelijk blijft aan de som van de
 * regelbedragen die de gebruiker in de UI ziet staan.
 */
const SALE_PRICE_EXCL_SQL = Prisma.sql`ROUND(s."salePriceInclAtSale" / (1 + s."vatRateAtSale" / 100), 2)`;

/**
 * De NORMALE prijs per stuk EXCLUSIEF btw op het moment van verkoop (T26), op
 * exact dezelfde manier afgeleid als {@link SALE_PRICE_EXCL_SQL} — per stuk afgerond
 * op centen, met het historische btw-tarief.
 *
 * Wordt UITSLUITEND gebruikt voor de regel "Totaal gegeven korting". Omzet, marge,
 * bestsellers, merken, categorieën en het omzetverloop blijven op
 * `salePriceInclAtSale` rekenen, dus op de WERKELIJK BETAALDE prijs: een korting
 * verlaagt de omzet en de marge, zoals het hoort.
 */
const LIST_PRICE_EXCL_SQL = Prisma.sql`ROUND(s."listPriceInclAtSale" / (1 + s."vatRateAtSale" / 100), 2)`;

/**
 * De gegeven korting over de geselecteerde rijen: `Σ aantal × (normaal − betaald)`,
 * incl. btw als hoofdbedrag en excl. btw als stuurgetal ernaast (T26).
 *
 * Het incl.-bedrag is een exacte som van twee opgeslagen bedragen. Het excl.-bedrag
 * wordt per prijs apart teruggerekend en dán afgetrokken, niet door het
 * incl.-verschil door `1 + btw/100` te delen: alleen zo telt de korting excl. op tot
 * het verschil tussen de omzet excl. die er zónder korting geweest zou zijn en de
 * omzet excl. die er nu staat.
 */
const DISCOUNT_INCL_SQL = Prisma.sql`COALESCE(SUM(s.quantity * (s."listPriceInclAtSale" - s."salePriceInclAtSale")), 0)`;
const DISCOUNT_EXCL_SQL = Prisma.sql`COALESCE(SUM(s.quantity * (${LIST_PRICE_EXCL_SQL} - ${SALE_PRICE_EXCL_SQL})), 0)`;

function buildWhereSql(filters: ReportFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`s."soldAt" >= ${filters.from}`,
    Prisma.sql`s."soldAt" <= ${filters.to}`,
  ];

  if (filters.channel) {
    conditions.push(Prisma.sql`s."channel" = ${filters.channel}::"SaleChannel"`);
  }

  if (filters.category) {
    conditions.push(Prisma.sql`p."category" = ${filters.category}::"Category"`);
  }

  return Prisma.join(conditions, " AND ");
}

// ---------------------------------------------------------------------------
// Kerncijfers
// ---------------------------------------------------------------------------

interface SummaryRow {
  revenue: unknown;
  revenueIncl?: unknown;
  margin: unknown;
  itemsSold: unknown;
  transactionCount: unknown;
  discountTotalIncl?: unknown;
  discountTotalExcl?: unknown;
}

/** Zet een rauwe summary-rij om naar het DTO; apart zodat dit zonder database te testen is. */
export function summaryRowToDto(row: SummaryRow | undefined): ReportSummaryDTO {
  const revenue = rawNumericToNumber(row?.revenue);
  const margin = rawNumericToNumber(row?.margin);
  const purchaseTotal = revenue - margin;

  return {
    revenue,
    // Ontbreekt de kolom (oudere aanroeper of een lege periode), dan 0 — nooit `NaN`.
    revenueIncl: rawNumericToNumber(row?.revenueIncl),
    margin,
    marginPct: calcMarginPct(purchaseTotal, revenue),
    itemsSold: rawNumericToNumber(row?.itemsSold),
    transactionCount: rawNumericToNumber(row?.transactionCount),
    // Ontbreekt de kolom of is de periode leeg, dan 0 — nooit `NaN` (T26).
    discountTotalIncl: rawNumericToNumber(row?.discountTotalIncl),
    discountTotalExcl: rawNumericToNumber(row?.discountTotalExcl),
  };
}

/**
 * Kerncijfers over de periode (SPEC §F6): omzet, marge, margepercentage, aantal
 * verkochte stuks, aantal transacties — allemaal EXCL. btw. `COALESCE(..., 0)` vangt
 * de lege periode af (`SUM` over nul rijen is in SQL `NULL`).
 */
export async function getReportSummary(
  filters: ReportFilters,
): Promise<ReportSummaryDTO> {
  const where = buildWhereSql(filters);

  const rows = await prisma.$queryRaw<SummaryRow[]>`
    SELECT
      COALESCE(SUM(s.quantity * ${SALE_PRICE_EXCL_SQL}), 0) AS "revenue",
      COALESCE(SUM(s.quantity * s."salePriceInclAtSale"), 0) AS "revenueIncl",
      COALESCE(SUM(s.quantity * (${SALE_PRICE_EXCL_SQL} - s."purchasePriceExclAtSale")), 0) AS "margin",
      COALESCE(SUM(s.quantity), 0) AS "itemsSold",
      COUNT(*) AS "transactionCount",
      ${DISCOUNT_INCL_SQL} AS "discountTotalIncl",
      ${DISCOUNT_EXCL_SQL} AS "discountTotalExcl"
    FROM "Sale" s
    JOIN "Part" p ON p.id = s."partId"
    WHERE ${where}
  `;

  return summaryRowToDto(rows[0]);
}

// ---------------------------------------------------------------------------
// Balie / werkplaats-uitsplitsing
// ---------------------------------------------------------------------------

interface ChannelBreakdownRow extends SummaryRow {
  channel: SaleChannel;
}

const ALL_CHANNELS: SaleChannel[] = ["COUNTER", "WORKSHOP"];

/**
 * Omzet/marge/stuks/transacties per kanaal (SPEC §F6: "uitsplitsing balie versus
 * werkplaats"). Dit is bewust een APARTE query van `getReportSummary`: een
 * kanaalfilter in `filters` zou de uitsplitsing zelf zinloos maken (dan is er nog
 * maar één kanaal over), dus deze functie negeert `filters.channel` en toont altijd
 * beide rijen — ontbrekende kanalen (geen verkopen in de periode) komen er met
 * nullen bij, zodat de UI nooit een kanaal stilletjes laat verdwijnen.
 */
export async function getChannelBreakdown(
  filters: ReportFilters,
): Promise<ChannelBreakdownDTO[]> {
  const channelLessFilters: ReportFilters = { ...filters, channel: undefined };
  const where = buildWhereSql(channelLessFilters);

  const rows = await prisma.$queryRaw<ChannelBreakdownRow[]>`
    SELECT
      s.channel AS "channel",
      COALESCE(SUM(s.quantity * ${SALE_PRICE_EXCL_SQL}), 0) AS "revenue",
      COALESCE(SUM(s.quantity * s."salePriceInclAtSale"), 0) AS "revenueIncl",
      COALESCE(SUM(s.quantity * (${SALE_PRICE_EXCL_SQL} - s."purchasePriceExclAtSale")), 0) AS "margin",
      COALESCE(SUM(s.quantity), 0) AS "itemsSold",
      COUNT(*) AS "transactionCount",
      ${DISCOUNT_INCL_SQL} AS "discountTotalIncl",
      ${DISCOUNT_EXCL_SQL} AS "discountTotalExcl"
    FROM "Sale" s
    JOIN "Part" p ON p.id = s."partId"
    WHERE ${where}
    GROUP BY s.channel
  `;

  const byChannel = new Map(rows.map((row) => [row.channel, row]));

  return ALL_CHANNELS.map((channel) => ({
    channel,
    ...summaryRowToDto(byChannel.get(channel)),
  }));
}

// ---------------------------------------------------------------------------
// Bestsellers
// ---------------------------------------------------------------------------

interface BestsellerRow {
  partId: string;
  name: string;
  sku: string;
  brandName: string | null;
  archivedAt: Date | null;
  quantitySold: unknown;
  revenue: unknown;
  margin: unknown;
}

/**
 * Bestsellers over de periode (SPEC §F6): stuks, omzet en marge per onderdeel,
 * aflopend op stuks verkocht. Balie én werkplaats tellen mee (tenzij `filters.channel`
 * een van beide selecteert), net als op het dashboard — beide verbruiken voorraad.
 */
export async function getBestsellers(
  filters: ReportFilters,
  limit: number = DEFAULT_BESTSELLERS_LIMIT,
): Promise<BestsellerReportDTO[]> {
  const where = buildWhereSql(filters);
  const take = Number.isFinite(limit) && limit >= 1
    ? Math.min(Math.floor(limit), MAX_BESTSELLERS_LIMIT)
    : DEFAULT_BESTSELLERS_LIMIT;

  const rows = await prisma.$queryRaw<BestsellerRow[]>`
    SELECT
      p.id AS "partId",
      p.name AS "name",
      p.sku AS "sku",
      b.name AS "brandName",
      p."archivedAt" AS "archivedAt",
      COALESCE(SUM(s.quantity), 0) AS "quantitySold",
      COALESCE(SUM(s.quantity * ${SALE_PRICE_EXCL_SQL}), 0) AS "revenue",
      COALESCE(SUM(s.quantity * (${SALE_PRICE_EXCL_SQL} - s."purchasePriceExclAtSale")), 0) AS "margin"
    FROM "Sale" s
    JOIN "Part" p ON p.id = s."partId"
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    WHERE ${where}
    GROUP BY p.id, p.name, p.sku, b.name, p."archivedAt"
    ORDER BY "quantitySold" DESC, p.name ASC
    LIMIT ${take}
  `;

  return rows.map((row) => ({
    partId: row.partId,
    name: row.name,
    sku: row.sku,
    brandName: row.brandName,
    isArchived: row.archivedAt !== null,
    quantitySold: rawNumericToNumber(row.quantitySold),
    revenue: rawNumericToNumber(row.revenue),
    margin: rawNumericToNumber(row.margin),
  }));
}

// ---------------------------------------------------------------------------
// Omzet per merk
// ---------------------------------------------------------------------------

interface BrandRevenueRow {
  brandId: string | null;
  brandName: string | null;
  revenue: unknown;
  margin: unknown;
  itemsSold: unknown;
}

const UNBRANDED_LABEL = "Zonder merk";

/** Omzet/marge per merk over de periode (SPEC §F6), aflopend op omzet. */
export async function getRevenueByBrand(
  filters: ReportFilters,
): Promise<BrandRevenueDTO[]> {
  const where = buildWhereSql(filters);

  const rows = await prisma.$queryRaw<BrandRevenueRow[]>`
    SELECT
      b.id AS "brandId",
      b.name AS "brandName",
      COALESCE(SUM(s.quantity * ${SALE_PRICE_EXCL_SQL}), 0) AS "revenue",
      COALESCE(SUM(s.quantity * (${SALE_PRICE_EXCL_SQL} - s."purchasePriceExclAtSale")), 0) AS "margin",
      COALESCE(SUM(s.quantity), 0) AS "itemsSold"
    FROM "Sale" s
    JOIN "Part" p ON p.id = s."partId"
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    WHERE ${where}
    GROUP BY b.id, b.name
    ORDER BY "revenue" DESC
  `;

  return rows.map((row) => ({
    brandId: row.brandId,
    brandName: row.brandName ?? UNBRANDED_LABEL,
    revenue: rawNumericToNumber(row.revenue),
    margin: rawNumericToNumber(row.margin),
    itemsSold: rawNumericToNumber(row.itemsSold),
  }));
}

// ---------------------------------------------------------------------------
// Omzet per categorie
// ---------------------------------------------------------------------------

interface CategoryRevenueRow {
  category: Category;
  revenue: unknown;
  margin: unknown;
  itemsSold: unknown;
}

/**
 * Omzet/marge per categorie over de periode (SPEC §F6), aflopend op omzet.
 * Categorieën zonder verkoop in de periode blijven weg (in tegenstelling tot de
 * omzetverloop-buckets hieronder, die met opzet WEL nullen tonen voor een
 * ononderbroken tijdlijn) — een lege categorierij zou hier geen extra informatie
 * geven.
 */
export async function getRevenueByCategory(
  filters: ReportFilters,
): Promise<CategoryRevenueDTO[]> {
  const where = buildWhereSql(filters);

  const rows = await prisma.$queryRaw<CategoryRevenueRow[]>`
    SELECT
      p.category AS "category",
      COALESCE(SUM(s.quantity * ${SALE_PRICE_EXCL_SQL}), 0) AS "revenue",
      COALESCE(SUM(s.quantity * (${SALE_PRICE_EXCL_SQL} - s."purchasePriceExclAtSale")), 0) AS "margin",
      COALESCE(SUM(s.quantity), 0) AS "itemsSold"
    FROM "Sale" s
    JOIN "Part" p ON p.id = s."partId"
    WHERE ${where}
    GROUP BY p.category
    ORDER BY "revenue" DESC
  `;

  return rows.map((row) => ({
    category: row.category,
    categoryLabel: getCategoryLabel(row.category),
    revenue: rawNumericToNumber(row.revenue),
    margin: rawNumericToNumber(row.margin),
    itemsSold: rawNumericToNumber(row.itemsSold),
  }));
}

// ---------------------------------------------------------------------------
// Omzetverloop (dag/week)
// ---------------------------------------------------------------------------

interface BucketRow {
  bucket: string;
  revenue: unknown;
  margin: unknown;
}

/**
 * Omzet/marge per dag of week (SPEC §F6), met ALLE buckets in de periode — ook die
 * zonder verkoop, als `0` — zodat de staafjesgrafiek geen dagen/weken laat
 * ontbreken. De Amsterdamse kalenderdag/-week wordt in SQL berekend door de
 * UTC-instant eerst naar `Europe/Amsterdam` te converteren en dan af te ronden
 * (`date_trunc`); dat is dezelfde tijdzoneconventie als `@/lib/reporting-period`
 * (zie de uitleg daar). `date_trunc('week', ...)` in Postgres gebruikt ISO-weken
 * (maandag als eerste dag), consistent met `enumerateWeekBuckets`.
 */
export async function getRevenueOverTime(
  filters: ReportFilters,
  bucketSize: RevenueBucketSize,
): Promise<RevenueBucketDTO[]> {
  const where = buildWhereSql(filters);
  const truncUnit = bucketSize === "week" ? "week" : "day";

  const rows = await prisma.$queryRaw<BucketRow[]>`
    SELECT
      to_char(
        date_trunc(${truncUnit}, s."soldAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Amsterdam'),
        'YYYY-MM-DD'
      ) AS "bucket",
      COALESCE(SUM(s.quantity * ${SALE_PRICE_EXCL_SQL}), 0) AS "revenue",
      COALESCE(SUM(s.quantity * (${SALE_PRICE_EXCL_SQL} - s."purchasePriceExclAtSale")), 0) AS "margin"
    FROM "Sale" s
    JOIN "Part" p ON p.id = s."partId"
    WHERE ${where}
    GROUP BY "bucket"
  `;

  const byBucket = new Map(
    rows.map((row) => [row.bucket, { revenue: rawNumericToNumber(row.revenue), margin: rawNumericToNumber(row.margin) }]),
  );

  const allBuckets =
    bucketSize === "week"
      ? enumerateWeekBuckets(filters.from, filters.to)
      : enumerateDayBuckets(filters.from, filters.to);

  return allBuckets.map((bucket) => {
    const found = byBucket.get(bucket);
    return {
      bucket,
      revenue: found?.revenue ?? 0,
      margin: found?.margin ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Alles in één keer
// ---------------------------------------------------------------------------

export interface GetReportDataOptions {
  bestsellersLimit?: number;
  bucketSize?: RevenueBucketSize;
}

/**
 * Alle rapportagegegevens in één aanroep, net als `getDashboardData` op het
 * dashboard. De zes blokken zijn onafhankelijk van elkaar en lopen daarom parallel.
 */
export async function getReportData(
  filters: ReportFilters,
  options: GetReportDataOptions = {},
): Promise<ReportDataDTO> {
  const bucketSize = options.bucketSize ?? "day";

  const [summary, channelBreakdown, bestsellers, revenueByBrand, revenueByCategory, revenueOverTime] =
    await Promise.all([
      getReportSummary(filters),
      getChannelBreakdown(filters),
      getBestsellers(filters, options.bestsellersLimit),
      getRevenueByBrand(filters),
      getRevenueByCategory(filters),
      getRevenueOverTime(filters, bucketSize),
    ]);

  return {
    summary,
    channelBreakdown,
    bestsellers,
    revenueByBrand,
    revenueByCategory,
    revenueOverTime,
  };
}

/** Alle categorieën, voor het categoriefilter op de rapportagepagina. */
export const REPORT_CATEGORY_OPTIONS = CATEGORY_OPTIONS;
