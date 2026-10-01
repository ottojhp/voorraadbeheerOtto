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

import type { Category, ManualStockReason } from "@/lib/labels";

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

// ---------------------------------------------------------------------------
// Voorraadmutaties (T19)
// ---------------------------------------------------------------------------

/**
 * Onderscheidbare foutgevallen bij het aanpassen van de voorraad. Staat hier en niet
 * in `./stock` omdat de client component die de melding toont erop moet kunnen
 * sturen, en `./stock` de Prisma-runtime importeert.
 */
export type StockAdjustmentErrorCode =
  | "INVALID_INPUT"
  | "PART_NOT_FOUND"
  | "PART_ARCHIVED"
  | "INSUFFICIENT_STOCK"
  | "STOCK_CHANGED";

/**
 * Resultaat van een geslaagde voorraadwijziging (`adjustStock()` in `./stock`):
 * alles wat de UI nodig heeft om de bevestiging te tonen en de wijziging weer
 * ongedaan te kunnen maken.
 */
export interface StockAdjustmentResultDTO {
  partId: string;
  partName: string;
  /**
   * `false` als er niets te wijzigen was: "exact aantal instellen" op de stand die er
   * al stond. Er is dan ook GEEN grootboekregel geschreven (`delta` mag niet 0 zijn)
   * en `mutationId` is `null`.
   */
  changed: boolean;
  /** Het werkelijk geboekte verschil; `0` als `changed` `false` is. */
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  minStock: number;
  /** Afgeleid uit de NIEUWE stand (SPEC §F1), zodat de UI de badge kan bijwerken. */
  isLowStock: boolean;
  /** De reden zoals weggeschreven; `null` als er niets geschreven is. */
  reason: ManualStockReason | null;
  /** Id van de geschreven grootboekregel; `null` als er niets geschreven is. */
  mutationId: string | null;
}

// ---------------------------------------------------------------------------
// Scannen (T20)
// ---------------------------------------------------------------------------

/**
 * Eén onderdeel zoals het scanscherm het toont bij "is dit het onderdeel?".
 *
 * Bewust een eigen, kleine DTO en niet `PartDTO`: de gebruiker moet op een
 * telefoonscherm in één blik kunnen beslissen of dit het pakje in zijn hand is, en
 * daar heeft hij naam, merk, de drie nummers, de locatie in de schappen en de
 * huidige voorraad voor nodig — geen marge en geen inkoopprijs. `minStock` zit erbij
 * omdat de voorraadknoppen uit T19 die nodig hebben.
 *
 * `supplierArticleNumber` staat hier voor het eerst in een DTO (het veld bestaat
 * sinds T17 alleen in het schema en de seed): het is het nummer dat op de verpakking
 * staat en dus precies waar deze taak op matcht.
 */
export interface PartScanDTO {
  id: string;
  name: string;
  brandName: string | null;
  category: Category;
  sku: string;
  barcode: string | null;
  /** Het nummer dat de leverancier of fabrikant op de verpakking drukt (T17). */
  supplierArticleNumber: string | null;
  /** Plek in de schappen; aan de balie het snelste houvast na een treffer. */
  location: string | null;
  stockQuantity: number;
  minStock: number;
  isLowStock: boolean;
  /** INCL. btw — zoals opgeslagen (SPEC §3 regel 0). */
  salePriceIncl: number;
  vatRate: number;
  /** Afgeleid uit `salePriceIncl`. */
  salePriceExcl: number;
  /** ISO-string, of `null`. Gearchiveerde onderdelen mogen niet gewijzigd worden. */
  archivedAt: string | null;
}

/** Waar de gescande tekst vandaan kwam. Bepaalt hoe hard het bewijs is. */
export type ScanSource = "barcode" | "ocr" | "manual";

/**
 * Eén kandidaat uit een scan: het onderdeel plus de verantwoording waarom het
 * gevonden is. Die verantwoording staat in de UI, zodat de gebruiker weet of hij
 * naar een exacte barcodetreffer of naar een gokje van de tekstherkenning kijkt.
 */
export interface PartScanMatchDTO {
  part: PartScanDTO;
  /** Op welk veld de treffer zat. */
  field: "barcode" | "sku" | "supplierArticleNumber";
  /** De opgeslagen waarde die matchte (niet wat de camera meende te lezen). */
  value: string;
  /** `exact` | `normalized` | `contained` — zie `@/lib/article-number`. */
  kind: "exact" | "normalized" | "contained";
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
