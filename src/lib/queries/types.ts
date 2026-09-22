/**
 * Gedeelde DTO-types voor de datalaag (`src/lib/queries/`).
 *
 * SPEC §3 regel 1 is hier bindend: Prisma geeft `Decimal`- en `Date`-objecten terug,
 * en die mogen NOOIT een client component in. Daarom bevat elk type in dit bestand
 * uitsluitend `number`, `string`, `boolean` en `null` — datums als ISO-string.
 *
 * Dit bestand importeert met opzet NIETS uit `@prisma/client`, zodat het veilig in
 * client components gebruikt kan worden zonder de Prisma-runtime mee te bundelen.
 * De `Category`-union komt uit `@/lib/labels`, die om dezelfde reden bestaat.
 *
 * Alle bedragen zijn EXCLUSIEF btw, behalve de velden met `InclVat` in de naam
 * (SPEC §3 regel 0).
 */

import type { Category } from "@/lib/labels";

/** Merk of leverancier, gereduceerd tot wat een overzicht of dropdown nodig heeft. */
export interface NamedRefDTO {
  id: string;
  name: string;
}

/**
 * Eén onderdeel als plain object. Wordt gebruikt door het voorraadoverzicht (T07),
 * de bewerkpagina (T08) en het verkoopscherm (T12).
 */
export interface PartDTO {
  id: string;
  name: string;
  /** `null` voor universele onderdelen (olie, remblokken, kabels, lampjes). */
  brand: NamedRefDTO | null;
  category: Category;
  sku: string;
  barcode: string | null;

  /** Inkoopprijs per stuk, excl. btw. */
  purchasePrice: number;
  /** Verkoopprijs per stuk, excl. btw. */
  salePrice: number;
  /** Btw-percentage, bv. `21` of `9` — géén fractie. */
  vatRate: number;
  /** Afgeleid: `salePrice * (1 + vatRate / 100)`. Alleen tonen, nooit opslaan. */
  salePriceInclVat: number;
  /** Afgeleid: `salePrice - purchasePrice`, excl. btw. */
  margin: number;
  /** Afgeleid: `margin / salePrice * 100`; `0` als `salePrice` 0 is. */
  marginPct: number;

  stockQuantity: number;
  minStock: number;
  /** Afgeleid: `minStock > 0 && stockQuantity <= minStock` (SPEC §F1). */
  isLowStock: boolean;

  supplier: NamedRefDTO | null;

  description: string | null;
  fitsModels: string | null;
  location: string | null;

  /** ISO-string, of `null` als het onderdeel niet gearchiveerd is. */
  archivedAt: string | null;
  /** ISO-string. */
  createdAt: string;
  /** ISO-string. */
  updatedAt: string;
}

/**
 * Beknopte variant voor het verkoopscherm (T12): alleen wat de balie nodig heeft om
 * een onderdeel te herkennen, de voorraad te zien en de prijs te tonen.
 */
export interface PartSaleOptionDTO {
  id: string;
  name: string;
  brandName: string | null;
  category: Category;
  sku: string;
  barcode: string | null;
  stockQuantity: number;
  /** Excl. btw. */
  salePrice: number;
  vatRate: number;
  /** Afgeleid, alleen voor weergave. */
  salePriceInclVat: number;
}

/** Generiek pagineringsresultaat. */
export interface PaginatedResult<T> {
  items: T[];
  /** Totaal aantal rijen dat aan het filter voldoet, over alle pagina's heen. */
  total: number;
  /** 1-gebaseerd paginanummer, al genormaliseerd. */
  page: number;
  pageSize: number;
  /** Aantal pagina's; `0` als er geen resultaten zijn. */
  pageCount: number;
}

/** Sorteersleutels voor het voorraadoverzicht (SPEC §F2). */
export type PartSort = "name" | "stock" | "margin";

export type SortDir = "asc" | "desc";
