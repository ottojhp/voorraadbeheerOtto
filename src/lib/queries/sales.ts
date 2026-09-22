/**
 * Datalaag voor verkopen en werkplaatsverbruik (SPEC §F4, T12).
 *
 * Dit is de enige plek waar een verkoop wordt weggeschreven. Twee bindende regels uit
 * SPEC §3 zitten hier ingebakken:
 *
 * - regel 5: voorraad verlagen en de `Sale` loggen gebeurt in ÉÉN
 *   `prisma.$transaction`. Er mag geen verkoop bestaan zonder voorraadmutatie en
 *   andersom.
 * - regel 6: negatieve voorraad is verboden. De controle staat server-side BINNEN de
 *   transactie, niet alleen in de UI.
 *
 * Verder geldt SPEC §3 regel 1: naar buiten gaan alleen plain DTO's (`number`,
 * `string`, `boolean`, `null`) — nooit een `Decimal` of een `Date`, want die zijn niet
 * serialiseerbaar richting client components.
 *
 * Server-only: importeer dit bestand niet in een client component.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { SaleChannel } from "@/lib/labels";
import { priceWithVat } from "@/lib/money";
import { saleSchema, type SaleInput } from "@/lib/validation/sales";

// ---------------------------------------------------------------------------
// Fouten
// ---------------------------------------------------------------------------

/**
 * Onderscheidbare foutgevallen. De aanroeper (server action) kan hierop sturen —
 * bv. de melding bij het aantalveld zetten in plaats van boven het formulier — zonder
 * foutteksten te moeten vergelijken.
 */
export type SaleErrorCode =
  /** Invoer kwam niet door het Zod-schema (bv. aantal 0 of -1). */
  | "INVALID_INPUT"
  /** Het onderdeel bestaat niet (meer). */
  | "PART_NOT_FOUND"
  /** Het onderdeel is gearchiveerd en dus niet verkoopbaar (SPEC §3 regel 4). */
  | "PART_ARCHIVED"
  /** Er liggen minder stuks op voorraad dan er verkocht worden (SPEC §3 regel 6). */
  | "INSUFFICIENT_STOCK"
  /** Iemand anders was net sneller: de voorwaardelijke update raakte 0 rijen. */
  | "STOCK_CHANGED";

export interface SaleErrorDetails {
  /** Werkelijke voorraad op het moment van weigeren (bij `INSUFFICIENT_STOCK`). */
  availableStock?: number;
  /** Het gevraagde aantal, zodat de melding beide getallen kan noemen. */
  requestedQuantity?: number;
  /** Veldgebonden meldingen uit Zod (bij `INVALID_INPUT`). */
  fieldErrors?: Record<string, string>;
}

/**
 * Fout bij het registreren van een verkoop. `message` is al Nederlands en
 * toonbaar; `code` maakt programmatisch onderscheid mogelijk.
 */
export class SaleError extends Error {
  readonly code: SaleErrorCode;
  readonly availableStock?: number;
  readonly requestedQuantity?: number;
  readonly fieldErrors?: Record<string, string>;

  constructor(code: SaleErrorCode, message: string, details: SaleErrorDetails = {}) {
    super(message);
    this.name = "SaleError";
    this.code = code;
    this.availableStock = details.availableStock;
    this.requestedQuantity = details.requestedQuantity;
    this.fieldErrors = details.fieldErrors;
  }
}

/**
 * Type guard. Naast `instanceof` ook een structurele controle: een fout die door een
 * transactiegrens of een serialisatiestap is gegaan verliest zijn prototype, en dan
 * zou een `instanceof`-only check hem stilletjes als "onbekende fout" behandelen.
 */
export function isSaleError(error: unknown): error is SaleError {
  if (error instanceof SaleError) {
    return true;
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    (error as { name?: unknown }).name === "SaleError"
  );
}

// ---------------------------------------------------------------------------
// DTO's
// ---------------------------------------------------------------------------

/** Resultaat van een geslaagde verkoop; alles wat het bevestigingsscherm nodig heeft. */
export interface SaleResultDTO {
  saleId: string;
  partId: string;
  partName: string;
  brandName: string | null;
  sku: string;
  quantity: number;
  channel: SaleChannel;
  reference: string | null;
  /** Prijs per stuk, EXCL. btw, zoals vastgelegd op het moment van verkoop. */
  salePriceAtSale: number;
  /** Btw-percentage op het moment van verkoop, bv. `21`. */
  vatRateAtSale: number;
  /** `quantity * salePriceAtSale`, excl. btw. */
  lineTotalExclVat: number;
  /** Afgeleid, alleen voor weergave (SPEC §3 regel 0). */
  lineTotalInclVat: number;
  /** De voorraadstand NA deze verkoop, zodat de balie die meteen ziet. */
  newStockQuantity: number;
  /** ISO-string. */
  soldAt: string;
}

/** Eén regel voor het overzicht "laatste verkopen". */
export interface RecentSaleDTO {
  id: string;
  partId: string;
  partName: string;
  brandName: string | null;
  sku: string;
  quantity: number;
  channel: SaleChannel;
  reference: string | null;
  salePriceAtSale: number;
  vatRateAtSale: number;
  lineTotalExclVat: number;
  lineTotalInclVat: number;
  soldAt: string;
}

// ---------------------------------------------------------------------------
// Constanten en hulpjes
// ---------------------------------------------------------------------------

/** Standaard aantal regels in "laatste verkopen". */
export const DEFAULT_RECENT_SALES_LIMIT = 10;

/** Bovengrens, zodat een `limit` uit een URL de server niet kan opblazen. */
export const MAX_RECENT_SALES_LIMIT = 100;

/** Prisma `Decimal` → gewone `number` (zie `./parts.ts` voor de onderbouwing). */
function toNumber(value: Prisma.Decimal): number {
  return value.toNumber();
}

/** Velden van het onderdeel die een verkoop nodig heeft. */
const PART_FOR_SALE_SELECT = {
  id: true,
  name: true,
  sku: true,
  stockQuantity: true,
  purchasePrice: true,
  salePrice: true,
  vatRate: true,
  archivedAt: true,
  brand: { select: { name: true } },
} satisfies Prisma.PartSelect;

// ---------------------------------------------------------------------------
// registerSale
// ---------------------------------------------------------------------------

export interface RegisterSaleResult {
  sale: SaleResultDTO;
}

/**
 * Registreert een verkoop (balie) of werkplaatsverbruik: verlaagt de voorraad en legt
 * een `Sale` vast — in één atomaire transactie.
 *
 * Volgorde binnen de transactie:
 *
 *  1. het onderdeel opnieuw lezen (bestaat het, is het niet gearchiveerd, is er
 *     genoeg voorraad?) — dit levert nette, specifieke meldingen op;
 *  2. de voorraad verlagen met een VOORWAARDELIJKE update;
 *  3. de `Sale` aanmaken met de prijzen zoals ze op dít moment zijn;
 *  4. de nieuwe voorraadstand teruglezen voor de bevestiging.
 *
 * ### Waarom stap 2 een `updateMany` met voorwaarden in de WHERE is
 *
 * De controle in stap 1 alleen is NIET veilig. Twee balies kunnen tegelijk het laatste
 * exemplaar verkopen: beide transacties lezen `stockQuantity = 1`, beide vinden dat
 * genoeg, en beide trekken er 1 af — eindstand `-1`, met twee verkoopregels. Prisma
 * draait standaard op het isolatieniveau van Postgres (READ COMMITTED); een `SELECT`
 * neemt daar geen slot, dus de tweede transactie ziet de wijziging van de eerste
 * eenvoudigweg niet tot die commit.
 *
 * Daarom wordt de voorwaarde in stap 2 in de WHERE-clause gezet:
 *
 * ```sql
 * UPDATE "Part" SET "stockQuantity" = "stockQuantity" - $qty
 *  WHERE id = $id AND "archivedAt" IS NULL AND "stockQuantity" >= $qty
 * ```
 *
 * Een `UPDATE` neemt in Postgres wél een rijslot en hertoetst bij READ COMMITTED zijn
 * WHERE op de nieuwste versie van de rij. De verliezer van de race raakt daardoor 0
 * rijen (`count === 0`), en die gooit hier een fout waardoor de hele transactie
 * terugdraait: geen halve verkoop, geen negatieve voorraad. Het decrement is bovendien
 * relatief (`stockQuantity - qty`, niet "zet op de waarde die ik las"), zodat een
 * gelijktijdige levering niet wordt overschreven.
 *
 * Alternatieven en waarom niet: `SELECT ... FOR UPDATE` kan Prisma alleen via
 * `$queryRaw` (ruwe SQL in de datalaag, en een extra roundtrip), en
 * `Serializable`-isolatie lost het ook op maar verplaatst het probleem naar
 * serialisatiefouten die de hele app moet kunnen herhalen. De voorwaardelijke update
 * is één statement, werkt op elk isolatieniveau en is hier voldoende.
 *
 * @throws {SaleError} met een onderscheidbare `code` en een Nederlandse melding.
 */
export async function registerSale(input: SaleInput): Promise<RegisterSaleResult> {
  // SPEC §3 regel 7: ook binnen de datalaag valideren, niet alleen in de action.
  // Gebeurt bewust vóór de transactie: ongeldige invoer hoeft geen database te raken.
  const parsed = saleSchema.safeParse(input);
  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: Record<string, string> = {};
    for (const [key, messages] of Object.entries(flattened)) {
      if (messages && messages.length > 0) {
        fieldErrors[key] = messages[0];
      }
    }
    throw new SaleError(
      "INVALID_INPUT",
      Object.values(fieldErrors)[0] ?? "De ingevulde gegevens kloppen niet.",
      { fieldErrors },
    );
  }

  const { partId, quantity, channel, reference } = parsed.data;

  return prisma.$transaction(async (tx) => {
    // Stap 1 — opnieuw lezen binnen de transactie. De UI kan een verouderde
    // voorraad tonen; wat hier uit de database komt telt.
    const part = await tx.part.findUnique({
      where: { id: partId },
      select: PART_FOR_SALE_SELECT,
    });

    if (!part) {
      throw new SaleError(
        "PART_NOT_FOUND",
        "Dit onderdeel bestaat niet (meer). Zoek of scan het opnieuw.",
      );
    }

    if (part.archivedAt !== null) {
      throw new SaleError(
        "PART_ARCHIVED",
        `"${part.name}" is gearchiveerd en kan niet verkocht worden.`,
      );
    }

    if (part.stockQuantity < quantity) {
      throw new SaleError(
        "INSUFFICIENT_STOCK",
        `Er ${part.stockQuantity === 1 ? "is" : "zijn"} maar ${part.stockQuantity} stuk${
          part.stockQuantity === 1 ? "" : "s"
        } van "${part.name}" op voorraad; je probeert er ${quantity} te verkopen.`,
        { availableStock: part.stockQuantity, requestedQuantity: quantity },
      );
    }

    // Stap 2 — voorwaardelijke update; zie de uitleg in de doc-comment hierboven.
    const updated = await tx.part.updateMany({
      where: {
        id: partId,
        archivedAt: null,
        stockQuantity: { gte: quantity },
      },
      data: { stockQuantity: { decrement: quantity } },
    });

    if (updated.count !== 1) {
      // De rij voldeed op het moment van schrijven niet meer aan de voorwaarden:
      // een andere balie was net sneller, of het onderdeel is zojuist gearchiveerd.
      // Gooien draait de hele transactie terug — er is dus geen `Sale` aangemaakt en
      // de voorraad is niet gewijzigd.
      throw new SaleError(
        "STOCK_CHANGED",
        `De voorraad van "${part.name}" is zojuist door iemand anders gewijzigd. Controleer de voorraad en probeer het opnieuw.`,
        { requestedQuantity: quantity },
      );
    }

    // Stap 3 — de verkoopregel. SPEC §3 regel 3: verkoop- én inkoopprijs en het
    // btw-tarief worden historisch vastgelegd (excl. btw), zodat de marge
    // reconstrueerbaar blijft als de prijzen later wijzigen.
    const sale = await tx.sale.create({
      data: {
        partId: part.id,
        quantity,
        salePriceAtSale: part.salePrice,
        purchasePriceAtSale: part.purchasePrice,
        vatRateAtSale: part.vatRate,
        channel,
        reference,
      },
      select: { id: true, soldAt: true },
    });

    // Stap 4 — de nieuwe stand teruglezen in plaats van hem uit te rekenen: tussen
    // stap 1 en stap 2 kan een levering de voorraad verhoogd hebben, en dan klopt
    // `gelezen waarde - aantal` niet met wat er werkelijk in de database staat.
    const after = await tx.part.findUnique({
      where: { id: partId },
      select: { stockQuantity: true },
    });

    const salePrice = toNumber(part.salePrice);
    const vatRate = toNumber(part.vatRate);
    const lineTotalExclVat = salePrice * quantity;

    return {
      sale: {
        saleId: sale.id,
        partId: part.id,
        partName: part.name,
        brandName: part.brand?.name ?? null,
        sku: part.sku,
        quantity,
        channel: channel as SaleChannel,
        reference,
        salePriceAtSale: salePrice,
        vatRateAtSale: vatRate,
        lineTotalExclVat,
        lineTotalInclVat: priceWithVat(lineTotalExclVat, vatRate),
        newStockQuantity: after?.stockQuantity ?? part.stockQuantity - quantity,
        soldAt: sale.soldAt.toISOString(),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// listRecentSales
// ---------------------------------------------------------------------------

/**
 * De laatste verkopen, nieuwste eerst (SPEC §F1 en het bevestigingsoverzicht in
 * §F4). Werkplaatsverbruik staat er bewust tussen: het is voorraadverbruik dat de
 * balie net zo goed wil terugzien. Geeft plain DTO's terug — `Decimal` wordt
 * `number`, `Date` wordt een ISO-string (SPEC §3 regel 1).
 */
export async function listRecentSales(
  limit: number = DEFAULT_RECENT_SALES_LIMIT,
): Promise<RecentSaleDTO[]> {
  const take = Math.min(
    Number.isFinite(limit) && limit >= 1
      ? Math.floor(limit)
      : DEFAULT_RECENT_SALES_LIMIT,
    MAX_RECENT_SALES_LIMIT,
  );

  const rows = await prisma.sale.findMany({
    orderBy: [{ soldAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      partId: true,
      quantity: true,
      salePriceAtSale: true,
      vatRateAtSale: true,
      channel: true,
      reference: true,
      soldAt: true,
      part: {
        select: { name: true, sku: true, brand: { select: { name: true } } },
      },
    },
  });

  return rows.map((row) => {
    const salePriceAtSale = toNumber(row.salePriceAtSale);
    const vatRateAtSale = toNumber(row.vatRateAtSale);
    const lineTotalExclVat = salePriceAtSale * row.quantity;

    return {
      id: row.id,
      partId: row.partId,
      partName: row.part.name,
      brandName: row.part.brand?.name ?? null,
      sku: row.part.sku,
      quantity: row.quantity,
      channel: row.channel as SaleChannel,
      reference: row.reference,
      salePriceAtSale,
      vatRateAtSale,
      lineTotalExclVat,
      lineTotalInclVat: priceWithVat(lineTotalExclVat, vatRateAtSale),
      soldAt: row.soldAt.toISOString(),
    };
  });
}
