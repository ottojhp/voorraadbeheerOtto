"use client";

/**
 * Zoek- en filterbalk voor het voorraadoverzicht (SPEC §F2).
 *
 * Dit bestand bevat zowel de pure URL-logica (getest in
 * `src/lib/__tests__/parts-overview.test.ts`, zonder database of React) als het
 * client component zelf. De pure functies staan bewust hier en niet in
 * `page.tsx`: dit bestand importeert alleen typen uit `@/lib/queries/*`
 * (met `import type`, dus weggecompileerd) en niets uit `@/lib/db`. Zou de
 * bundelaar dit bestand ooit vanuit een Server Component meenemen, dan blijft de
 * Prisma-runtime buiten de client bundle.
 *
 * ALLE filterstatus staat in de URL (search, brandId, brandIsNull, category,
 * supplierId, lowStockOnly, sort, sortDir, page, group) zodat de pagina deelbaar
 * en herlaadbaar is — dit component leest en schrijft die URL, het bewaart zelf
 * geen filterstatus in React state (behalve het lokale zoekveld, voor de
 * debounce, en of het filterpaneel op mobiel open staat).
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { CATEGORY_OPTIONS, getCategoryLabel, type Category } from "@/lib/labels";
import type { BrandWithPartCountDTO } from "@/lib/queries/brands";
import type { ListPartsParams } from "@/lib/queries/parts";
import type { SupplierListItemDTO } from "@/lib/queries/suppliers";
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ONDERDELEN_PATH = "/onderdelen";

/** Debounce-vertraging voor het zoekveld, in milliseconden. */
const SEARCH_DEBOUNCE_MS = 400;

const CHECKBOX_INPUT_CLASSES =
  "h-5 w-5 shrink-0 rounded border-gray-300 text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600";
const CHECKBOX_LABEL_CLASSES =
  "flex min-h-[44px] cursor-pointer items-center gap-2 self-end text-sm font-medium text-gray-700";

export interface PartsFiltersProps {
  brands: BrandWithPartCountDTO[];
  suppliers: SupplierListItemDTO[];
  unbrandedPartsCount: number;
}

/**
 * Zoekveld + filters voor `/onderdelen`. Elke wijziging navigeert (via de
 * router) naar een nieuwe URL met bijgewerkte query-parameters; de servercomponent
 * (`page.tsx`) leest die URL en haalt de bijbehorende data op. Er wordt bewust
 * geen filterstatus in een aparte state-container bijgehouden: de URL ís de
 * enige bron van waarheid (SPEC §F2 — deelbaar en herlaadbaar).
 */
export function PartsFilters({
  brands,
  suppliers,
  unbrandedPartsCount,
}: PartsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const current = normalizeSearchParams(Object.fromEntries(searchParams.entries()));
  const { listParams, groupByBrand } = parsePartsSearchParams(current);

  const [searchInput, setSearchInput] = useState(current.search ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Blijft in sync als de URL van buitenaf wijzigt (browser terug/vooruit, of
  // een klik op "Filters wissen"), zodat het zoekveld nooit een verouderde
  // waarde toont.
  useEffect(() => {
    setSearchInput(current.search ?? "");
  }, [current.search]);

  // Ruim een eventuele openstaande timer op bij het weghalen van het component.
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  function navigate(
    overrides: Record<string, string | number | boolean | null | undefined>,
  ) {
    const qs = buildPartsQuery(current, overrides);
    startTransition(() => {
      router.push(`${pathname}${qs}`);
    });
  }

  /**
   * Keuze: debounce in plaats van een expliciete zoekknop. De andere filters
   * (merk, categorie, leverancier, sortering, checkboxen) navigeren al direct
   * bij elke keuze — een aparte zoekknop zou daarmee inconsistent aanvoelen en
   * een extra tik kosten aan de balie. Bij elke toetsaanslag navigeren zou de
   * lijst (en de focus/scrollpositie) voortdurend laten springen. 400ms
   * debounce is de middenweg: vloeiend typen, maar niet meer dan één navigatie
   * na het stoppen met typen.
   */
  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      navigate({ search: value || null });
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleBrandChange(value: string) {
    if (value === "") {
      navigate({ brandId: null });
    } else if (value === UNBRANDED_FILTER_VALUE) {
      navigate({ brandId: UNBRANDED_FILTER_VALUE });
    } else {
      navigate({ brandId: value });
    }
  }

  const brandSelectValue = listParams.brandIsNull
    ? UNBRANDED_FILTER_VALUE
    : (listParams.brandId ?? "");

  const hasActiveFilters = Boolean(
    listParams.search ||
      listParams.brandId ||
      listParams.brandIsNull ||
      listParams.category ||
      listParams.supplierId ||
      listParams.lowStockOnly,
  );

  return (
    <div className="mb-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Input
            id="onderdelen-zoeken"
            label="Zoeken"
            placeholder="Naam, sku, barcode of pasvorm…"
            value={searchInput}
            onChange={(event) => handleSearchChange(event.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="onderdelen-filters-panel"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 md:hidden"
        >
          Filters {hasActiveFilters && "●"}
          <span aria-hidden="true">{filtersOpen ? "▲" : "▼"}</span>
        </button>
      </div>

      <div
        id="onderdelen-filters-panel"
        className={`${filtersOpen ? "mt-4 grid" : "hidden"} gap-4 sm:grid-cols-2 md:mt-4 md:grid md:grid-cols-3 lg:grid-cols-4`}
      >
        <Select
          id="onderdelen-merk"
          label="Merk"
          value={brandSelectValue}
          onChange={(event) => handleBrandChange(event.target.value)}
        >
          <option value="">Alle merken</option>
          <option value={UNBRANDED_FILTER_VALUE}>
            Zonder merk / universeel ({unbrandedPartsCount})
          </option>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name} ({brand.partCount})
            </option>
          ))}
        </Select>

        <Select
          id="onderdelen-categorie"
          label="Categorie"
          value={listParams.category ?? ""}
          onChange={(event) => navigate({ category: event.target.value || null })}
        >
          <option value="">Alle categorieën</option>
          {CATEGORY_OPTIONS.map((category) => (
            <option key={category} value={category}>
              {getCategoryLabel(category)}
            </option>
          ))}
        </Select>

        <Select
          id="onderdelen-leverancier"
          label="Leverancier"
          value={listParams.supplierId ?? ""}
          onChange={(event) => navigate({ supplierId: event.target.value || null })}
        >
          <option value="">Alle leveranciers</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </Select>

        <Select
          id="onderdelen-sorteren"
          label="Sorteren op"
          value={listParams.sort}
          onChange={(event) => navigate({ sort: event.target.value })}
        >
          <option value="name">Naam</option>
          <option value="stock">Voorraad</option>
          <option value="margin">Marge</option>
        </Select>

        <Select
          id="onderdelen-richting"
          label="Richting"
          value={listParams.sortDir}
          onChange={(event) => navigate({ sortDir: event.target.value })}
        >
          <option value="asc">Oplopend</option>
          <option value="desc">Aflopend</option>
        </Select>

        <label className={CHECKBOX_LABEL_CLASSES}>
          <input
            type="checkbox"
            className={CHECKBOX_INPUT_CLASSES}
            checked={listParams.lowStockOnly === true}
            onChange={(event) =>
              navigate({ lowStockOnly: event.target.checked ? "1" : null })
            }
          />
          Alleen lage voorraad
        </label>

        <label className={CHECKBOX_LABEL_CLASSES}>
          <input
            type="checkbox"
            className={CHECKBOX_INPUT_CLASSES}
            checked={groupByBrand}
            onChange={(event) =>
              navigate({ group: event.target.checked ? GROUP_BY_BRAND_VALUE : null })
            }
          />
          Groeperen per merk
        </label>

        {hasActiveFilters && (
          <div className="flex min-h-[44px] items-end">
            <Link
              href={ONDERDELEN_PATH}
              className="text-sm font-medium text-blue-700 hover:underline"
            >
              Filters wissen
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
