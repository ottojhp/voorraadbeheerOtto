/**
 * Pure URL-logica voor het voorraadoverzicht (SPEC §F2), zonder `"use client"`.
 *
 * Dit bestand bevat de pure URL-logica (getest in
 * `src/lib/__tests__/parts-overview.test.ts`, zonder database of React) los van
 * het client component `PartsFilters.tsx`. Het staat bewust in een eigen
 * server-veilig bestand: importeert alleen typen uit `@/lib/queries/*` (met
 * `import type`, dus weggecompileerd) en niets uit `@/lib/db`, en heeft geen
 * `"use client"`, zodat `page.tsx` (Server Component) deze functies rechtstreeks
 * kan aanroepen. Elke export uit een `"use client"`-module wordt door Next.js
 * een client-referentie, dus deze functies kunnen niet in `PartsFilters.tsx`
 * blijven staan zonder de pagina te laten crashen bij server-side aanroepen.
 *
 * ALLE filterstatus staat in de URL (search, brandId, brandIsNull, category,
 * supplierId, lowStockOnly, sort, sortDir, page, group) zodat de pagina deelbaar
 * en herlaadbaar is — dit component leest en schrijft die URL, het bewaart zelf
 * geen filterstatus in React state (behalve het lokale zoekveld, voor de
 * debounce, en of het filterpaneel op mobiel open staat).
 */

import { CATEGORY_OPTIONS, type Category } from "@/lib/labels";
import type { ListPartsParams } from "@/lib/queries/parts";
import type { PartSort, SortDir } from "@/lib/queries/types";

// ---------------------------------------------------------------------------
// Pure URL-logica — geen React, geen database, dus rechtstreeks testbaar.
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

const VALID_SORTS = new Set<string>(["name", "stock", "margin"]);
const VALID_CATEGORIES = new Set<string>(CATEGORY_OPTIONS);

/** De waarde die `brandId` in de URL krijgt om "zonder merk" te betekenen. */
export const UNBRANDED_FILTER_VALUE = "unbranded";
/** De waarde die `group` in de URL krijgt om groepering per merk aan te zetten. */
export const GROUP_BY_BRAND_VALUE = "merk";

/**
 * Zet genormaliseerde `searchParams` om naar de parameters voor `listParts` plus
 * de (aparte, niet-`listParts`-) groeperingsvlag. Onbekende/ongeldige waarden
 * (bv. `sort=onzin`) vallen terug op het standaardgedrag in plaats van een fout
 * te geven — een gedeelde link met een verouderde parameter moet blijven werken.
 */
export function parsePartsSearchParams(params: Record<string, string>): {
  listParams: ListPartsParams;
  groupByBrand: boolean;
} {
  const brandIsNull = params.brandId === UNBRANDED_FILTER_VALUE;
  const sort: PartSort = VALID_SORTS.has(params.sort) ? (params.sort as PartSort) : "name";
  const sortDir: SortDir = params.sortDir === "desc" ? "desc" : "asc";
  const category =
    params.category && VALID_CATEGORIES.has(params.category)
      ? (params.category as Category)
      : undefined;
  const pageNum = Number(params.page);

  return {
    listParams: {
      search: params.search,
      brandId: brandIsNull ? undefined : params.brandId,
      brandIsNull: brandIsNull || undefined,
      category,
      supplierId: params.supplierId,
      lowStockOnly: params.lowStockOnly === "1" || undefined,
      sort,
      sortDir,
      page: Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1,
    },
    groupByBrand: params.group === GROUP_BY_BRAND_VALUE,
  };
}

/**
 * Bouwt een querystring die de huidige filters behoudt en overschrijft met
 * `overrides`. Reset `page` naar 1 zodra er iets anders dan de pagina zelf
 * wijzigt — zonder tiebreaker zou "pagina 3" blijven staan terwijl het filter
 * eronder een heel andere resultatenset oplevert. Geef `page` expliciet mee in
 * `overrides` (paginering-links) om dat gedrag te omzeilen.
 *
 * `null` in een override verwijdert die parameter, `true` wordt `"1"` (voor
 * checkboxen als `lowStockOnly`/`brandIsNull`), lege strings worden weggelaten.
 */
export function buildPartsQuery(
  current: Record<string, string>,
  overrides: Record<string, string | number | boolean | null | undefined>,
): string {
  const merged: Record<string, string | number | boolean | null | undefined> = {
    ...current,
    ...overrides,
  };
  if (!("page" in overrides)) {
    merged.page = undefined;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null || value === "" || value === false) {
      continue;
    }
    params.set(key, value === true ? "1" : String(value));
  }

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
