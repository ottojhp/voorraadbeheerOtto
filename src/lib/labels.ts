/**
 * Nederlandse labels voor de `Category`- en `SaleChannel`-enums uit
 * `prisma/schema.prisma`. Bewust getypeerd met string-unions in plaats van de
 * Prisma-client te importeren, zodat dit bestand ook in client components
 * gebruikt kan worden zonder de Prisma-runtime mee te bundelen.
 */

export type Category =
  | "SCOOTER_PART"
  | "MOTOR_PART"
  | "EBIKE_PART"
  | "MOBILITY_PART"
  | "HELMET"
  | "ACCESSORY"
  | "CONSUMABLE"
  | "OTHER";

export const CATEGORY_LABELS: Record<Category, string> = {
  SCOOTER_PART: "Scooteronderdeel",
  MOTOR_PART: "Motoronderdeel",
  EBIKE_PART: "E-bike/fatbike-onderdeel",
  MOBILITY_PART: "Scootmobiel-onderdeel",
  HELMET: "Helm",
  ACCESSORY: "Accessoire",
  CONSUMABLE: "Verbruiksartikel",
  OTHER: "Overig",
};

/** Alle categorieën in vaste weergavevolgorde, voor dropdowns en filters. */
export const CATEGORY_OPTIONS: Category[] = [
  "SCOOTER_PART",
  "MOTOR_PART",
  "EBIKE_PART",
  "MOBILITY_PART",
  "HELMET",
  "ACCESSORY",
  "CONSUMABLE",
  "OTHER",
];

export function getCategoryLabel(category: Category): string {
  return CATEGORY_LABELS[category];
}

/**
 * Redenen uit de `StockMutationReason`-enum (`prisma/schema.prisma`). Ook hier als
 * string-union in plaats van een import uit `@prisma/client`, zodat de labels in een
 * client component gebruikt kunnen worden (T19: de snelle voorraadknoppen).
 */
export type StockMutationReason =
  | "DELIVERY"
  | "CORRECTION"
  | "COUNT"
  | "SALE"
  | "WORKSHOP"
  | "INITIAL";

export const STOCK_MUTATION_REASON_LABELS: Record<StockMutationReason, string> = {
  DELIVERY: "Levering",
  CORRECTION: "Correctie",
  COUNT: "Telling",
  SALE: "Verkoop",
  WORKSHOP: "Werkplaatsverbruik",
  INITIAL: "Beginvoorraad",
};

/**
 * De redenen die de gebruiker zélf mag kiezen bij een handmatige voorraadwijziging
 * (T19). `SALE` en `WORKSHOP` horen bij een verkoopregel en `INITIAL` bij het
 * aanleggen van een onderdeel; die zijn hier bewust niet kiesbaar, want dan zou het
 * grootboek een verkoop kunnen suggereren die nooit heeft plaatsgevonden.
 */
export type ManualStockReason = "DELIVERY" | "CORRECTION" | "COUNT";

/** Vaste weergavevolgorde van de kiesbare redenen: levering, correctie, telling. */
export const MANUAL_STOCK_REASON_OPTIONS: ManualStockReason[] = [
  "DELIVERY",
  "CORRECTION",
  "COUNT",
];

export function getStockMutationReasonLabel(reason: StockMutationReason): string {
  return STOCK_MUTATION_REASON_LABELS[reason];
}

export type SaleChannel = "COUNTER" | "WORKSHOP";

export const SALE_CHANNEL_LABELS: Record<SaleChannel, string> = {
  COUNTER: "Balie",
  WORKSHOP: "Werkplaats",
};

export const SALE_CHANNEL_OPTIONS: SaleChannel[] = ["COUNTER", "WORKSHOP"];

export function getSaleChannelLabel(channel: SaleChannel): string {
  return SALE_CHANNEL_LABELS[channel];
}
