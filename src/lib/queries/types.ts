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
 * Elk geldveld zegt in zijn NAAM of het bedrag inclusief of exclusief btw is
 * (`...Incl` / `...Excl`), zoals SPEC §3 regel 0 (v2.0) voorschrijft. Zo levert het
 * verwisselen van de twee een compilerfout op in plaats van een stille rekenfout van
 * ~21%. Marge en margepercentage staan altijd op excl.-basis.
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

  /** Inkoopprijs per stuk, EXCL. btw — zoals opgeslagen (facturen zijn excl.). */
  purchasePriceExcl: number;
  /**
   * Afgeleid: `purchasePriceExcl * (1 + vatRate / 100)`. Alleen om te TONEN, zodat de
   * inkoopprijs op dezelfde manier op het scherm staat als de verkoopprijs (T18):
   * incl. als hoofdbedrag, excl. eronder. Er wordt nooit met dit bedrag gerekend —
   * marge en voorraadwaarde inkoop blijven op `purchasePriceExcl`.
   */
  purchasePriceIncl: number;
  /** Verkoopprijs per stuk, INCL. btw — zoals opgeslagen; dit betaalt de klant. */
  salePriceIncl: number;
  /** Btw-percentage, bv. `21` of `9` — géén fractie. */
  vatRate: number;
  /**
   * Afgeleid: `salePriceIncl / (1 + vatRate / 100)`. Het stuurgetal waarmee marge en
   * rapportages rekenen; nooit opgeslagen (SPEC §3 regel 0).
   */
  salePriceExcl: number;
  /** Afgeleid: `salePriceExcl - purchasePriceExcl`. Beide excl. btw. */
  margin: number;
  /** Afgeleid: `margin / salePriceExcl * 100`; `0` als `salePriceExcl` 0 is. */
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
  /** INCL. btw — zoals opgeslagen; dit is het bedrag dat de klant betaalt. */
  salePriceIncl: number;
  vatRate: number;
  /** Afgeleid uit `salePriceIncl`; het excl.-bedrag achter de kassaprijs. */
  salePriceExcl: number;
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
