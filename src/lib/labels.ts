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

export type SaleChannel = "COUNTER" | "WORKSHOP";

export const SALE_CHANNEL_LABELS: Record<SaleChannel, string> = {
  COUNTER: "Balie",
  WORKSHOP: "Werkplaats",
};

export const SALE_CHANNEL_OPTIONS: SaleChannel[] = ["COUNTER", "WORKSHOP"];

export function getSaleChannelLabel(channel: SaleChannel): string {
  return SALE_CHANNEL_LABELS[channel];
}
