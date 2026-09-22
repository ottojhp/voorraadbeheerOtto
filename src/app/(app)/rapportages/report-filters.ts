/**
 * Pure URL-logica voor `/rapportages` (SPEC §F6, taak T15).
 *
 * Bevat GEEN React en importeert `@/lib/queries/reports` alleen met `import type`
 * (weggecompileerd) — dus geen Prisma-runtime in de client bundle. Dit bestand
 * wordt zowel door de server component (`page.tsx`), het client filterpaneel
 * (`ReportsFilters.tsx`) als de CSV-export-route (`export/route.ts`) gebruikt, zodat
 * er maar één definitie van "hoe lees ik de filters uit de URL" bestaat — de pagina
 * en de export kunnen daardoor nooit een verschillende periode tonen.
 *
 * ALLE filterstatus staat in de URL (periode-preset of `from`/`to`, categorie,
 * bucketgrootte) zodat de rapportagepagina deelbaar en herlaadbaar is, net als het
 * voorraadoverzicht (SPEC §F2-patroon, hier toegepast op §F6).
 */

import { CATEGORY_OPTIONS, type Category } from "@/lib/labels";
import {
  amsterdamCalendarDateOf,
  formatIsoDate,
  resolveReportingPeriod,
  type ReportingPeriod,
} from "@/lib/reporting-period";
import type { RevenueBucketSize } from "@/lib/queries/reports";

// ---------------------------------------------------------------------------
// searchParams inlezen
// ---------------------------------------------------------------------------

/** Zoals Next.js 15 `searchParams` aanlevert: elke waarde kan ontbreken of herhaald zijn. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Pakt de eerste waarde als een parameter herhaald in de URL staat. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Zet `searchParams` om naar platte strings; lege/ontbrekende waarden vallen weg. */
export function normalizeSearchParams(raw: RawSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const single = firstParam(value);
    if (single !== undefined && single !== "") {
      out[key] = single;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filters parsen
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: ReadonlySet<string> = new Set(CATEGORY_OPTIONS);
const VALID_BUCKET_SIZES: ReadonlySet<string> = new Set(["day", "week"]);

export const DEFAULT_BUCKET_SIZE: RevenueBucketSize = "day";

export interface ParsedReportParams {
  period: ReportingPeriod;
  /** `undefined` = alle categorieën. Een onbekende waarde valt stil terug op alle categorieën. */
  category?: Category;
  bucketSize: RevenueBucketSize;
}

/**
 * Leest de rapportagefilters uit genormaliseerde `searchParams`. Een onbekende
 * categorie of bucketgrootte valt terug op "alle categorieën" resp. `"day"` zonder
 * fout — net als een onbekende periode-preset (afgehandeld in
 * `resolveReportingPeriod`, met een toonbare `warning`). Een gedeelde link met een
 * verouderde of geknoeide parameter moet altijd blijven werken.
 */
export function parseReportSearchParams(
  params: Record<string, string>,
  now?: Date,
): ParsedReportParams {
  const period = resolveReportingPeriod({
    preset: params.preset,
    from: params.from,
    to: params.to,
    now,
  });

  const category =
    params.category && VALID_CATEGORIES.has(params.category)
      ? (params.category as Category)
      : undefined;

  const bucketSize: RevenueBucketSize = VALID_BUCKET_SIZES.has(params.bucket)
    ? (params.bucket as RevenueBucketSize)
    : DEFAULT_BUCKET_SIZE;

  return { period, category, bucketSize };
}

// ---------------------------------------------------------------------------
// URL's opbouwen
// ---------------------------------------------------------------------------

/**
 * Bouwt een querystring die de huidige filters behoudt en overschrijft met
 * `overrides` (bv. bij het wisselen van preset of categorie in `ReportsFilters`).
 * `null` verwijdert die parameter, lege strings worden weggelaten.
 */
export function buildReportsQuery(
  current: Record<string, string>,
  overrides: Record<string, string | null | undefined>,
): string {
  const merged: Record<string, string | null | undefined> = { ...current, ...overrides };

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, value);
  }

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Querystring voor de CSV-export-link, gebaseerd op de al OPGELOSTE periode (dus na
 * een eventuele terugval op de standaardperiode) — zo exporteert de knop altijd
 * exact de periode die de pagina op dat moment toont, ook als de URL een ongeldige
 * preset bevatte.
 */
export function reportsExportQuery(
  period: ReportingPeriod,
  category: Category | undefined,
  bucketSize: RevenueBucketSize,
): string {
  const params = new URLSearchParams();
  params.set("preset", period.preset);

  if (period.preset === "custom") {
    params.set("from", formatIsoDate(amsterdamCalendarDateOf(period.from)));
    params.set("to", formatIsoDate(amsterdamCalendarDateOf(period.to)));
  }

  if (category) {
    params.set("category", category);
  }
  params.set("bucket", bucketSize);

  return params.toString();
}
