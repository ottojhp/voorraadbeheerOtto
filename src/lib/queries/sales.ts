/**
 * Datalaag voor verkopen en werkplaatsverbruik (SPEC §F4, T12).
 *
 * Dit is de enige plek waar een verkoop wordt weggeschreven. Twee bindende regels uit
 * SPEC §3 zitten hier ingebakken:
 *
 * - regel 5: voorraad verlagen, de `Sale` loggen en de `StockMutation` (het
 *   voorraadgrootboek, SPEC §4) schrijven gebeurt in ÉÉN `prisma.$transaction`. Er
 *   mag geen verkoop bestaan zonder voorraadmutatie en andersom, en geen
 *   voorraadwijziging zonder grootboekregel.
 * - regel 6: negatieve voorraad is verboden. De controle staat server-side BINNEN de
 *   transactie, niet alleen in de UI.
 *
 * Verder geldt SPEC §3 regel 1: naar buiten gaan alleen plain DTO's (`number`,
 * `string`, `boolean`, `null`) — nooit een `Decimal` of een `Date`, want die zijn niet
 * serialiseerbaar richting client components.
 *
 * Server-only: importeer dit bestand niet in een client component.
 */

import { Prisma, StockMutationReason } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { SaleChannel } from "@/lib/labels";
import { describeSalePricing } from "@/lib/money";
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

/**
 * De prijs- en kortingsvelden die élke verkoopweergave nodig heeft (T26).
 *
 * Eén keer gedefinieerd en door beide DTO's hieronder geërfd, zodat de bevestiging na
 * een verkoop, "Laatste verkopen" op het verkoopscherm en "Laatste verkopen" op het
 * dashboard per constructie dezelfde getallen tot hun beschikking hebben. Drie
 * weergaven die elk hun eigen deelverzameling kregen was de zekerste manier om op één
 * van de drie de doorgestreepte originele prijs te vergeten.
 *
 * Alle bedragen komen uit `describeSalePricing()` in `@/lib/money`, dezelfde functie
 * die het verkoopscherm voor de live-weergave gebruikt.
 */
export interface SalePricingFieldsDTO {
  /**
   * De WERKELIJK BETAALDE prijs per stuk INCL. btw, zoals historisch vastgelegd:
   * exact het bedrag dat de klant per stuk afrekende, korting inbegrepen.
   */
  salePriceInclAtSale: number;
  /** Btw-percentage op het moment van verkoop, bv. `21`. */
  vatRateAtSale: number;
  /** Afgeleid uit `salePriceInclAtSale`; de excl.-basis voor marge en rapportages. */
  salePriceExclAtSale: number;
  /** De NORMALE prijs per stuk INCL. btw op het moment van verkoop (T26). */
  listPriceInclAtSale: number;
  /** Afgeleid uit `listPriceInclAtSale`. */
  listPriceExclAtSale: number;
  /** Korting per stuk incl. btw; negatief als er méér dan normaal betaald is. */
  discountPerUnitIncl: number;
  /** Korting in procenten van de normale prijs, consistent met het bedrag. */
  discountPct: number;
  /** `true` zodra er werkelijk korting gegeven is. */
  hasDiscount: boolean;
  /** `quantity * (normale prijs - betaalde prijs)`, incl. resp. excl. btw. */
  discountTotalIncl: number;
  discountTotalExcl: number;
  /** `quantity * normale prijs` — het bedrag dat de UI doorstreept. */
  lineTotalListInclVat: number;
  lineTotalListExclVat: number;
  /** `quantity * betaalde prijs`: wat er werkelijk afgerekend is. */
  lineTotalInclVat: number;
  /** `quantity * salePriceExclAtSale`, dus het afgeleide excl.-regeltotaal. */
  lineTotalExclVat: number;
  /** Vrije toelichting bij de korting; `null` als er geen reden ingevuld is. */
  discountReason: string | null;
}

/** Resultaat van een geslaagde verkoop; alles wat het bevestigingsscherm nodig heeft. */
export interface SaleResultDTO extends SalePricingFieldsDTO {
  saleId: string;
  partId: string;
  partName: string;
  brandName: string | null;
  sku: string;
  quantity: number;
  channel: SaleChannel;
  reference: string | null;
  /** De voorraadstand NA deze verkoop, zodat de balie die meteen ziet. */
  newStockQuantity: number;
  /** ISO-string. */
  soldAt: string;
}

/** Eén regel voor het overzicht "laatste verkopen". */
export interface RecentSaleDTO extends SalePricingFieldsDTO {
  id: string;
  partId: string;
  partName: string;
  brandName: string | null;
  sku: string;
  quantity: number;
  channel: SaleChannel;
  reference: string | null;
  soldAt: string;
}

/**
 * `describeSalePricing()` → de DTO-velden hierboven. Puur een naamsverandering van
 * dezelfde getallen (`paid...` heet in de database `...AtSale`), op één plek zodat de
 * twee lijsten niet uit elkaar kunnen lopen.
 */
function toPricingFields(
  listPriceIncl: number,
  paidPriceIncl: number,
  vatRate: number,
  quantity: number,
  discountReason: string | null,
): SalePricingFieldsDTO {
  const pricing = describeSalePricing(
    listPriceIncl,
    paidPriceIncl,
    vatRate,
    quantity,
  );

  return {
    salePriceInclAtSale: pricing.paidPriceIncl,
    vatRateAtSale: pricing.vatRate,
    salePriceExclAtSale: pricing.paidPriceExcl,
    listPriceInclAtSale: pricing.listPriceIncl,
    listPriceExclAtSale: pricing.listPriceExcl,
    discountPerUnitIncl: pricing.discountPerUnitIncl,
    discountPct: pricing.discountPct,
    hasDiscount: pricing.hasDiscount,
    discountTotalIncl: pricing.discountTotalIncl,
    discountTotalExcl: pricing.discountTotalExcl,
    lineTotalListInclVat: pricing.lineTotalListIncl,
    lineTotalListExclVat: pricing.lineTotalListExcl,
    lineTotalInclVat: pricing.lineTotalPaidIncl,
    lineTotalExclVat: pricing.lineTotalPaidExcl,
    discountReason,
  };
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
  purchasePriceExcl: true,
  salePriceIncl: true,
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
 *  4. de nieuwe voorraadstand teruglezen — voor de bevestiging én als basis voor de
 *     grootboekregel;
 *  5. de `StockMutation` schrijven (reason `SALE` of `WORKSHOP`, `delta` negatief).
 *
 * Alle vijf stappen zitten in dezelfde transactie: gaat stap 5 mis, dan draait ook de
 * voorraadverlaging en de verkoopregel terug (SPEC §4: een grootboek met gaten is
 * erger dan geen grootboek).
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

  const { partId, quantity, channel, reference, unitPriceIncl, discountReason } =
    parsed.data;

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
    // btw-tarief worden historisch vastgelegd, zodat de marge reconstrueerbaar
    // blijft als de prijzen later wijzigen. De verkoopprijs gaat INCL. btw mee (het
    // bedrag dat de klant betaalde), de inkoopprijs EXCL. — precies zoals ze op het
    // onderdeel staan, dus zonder tussentijdse omrekening die centen kan kosten.
    //
    // Sinds T26 worden er TWEE verkoopprijzen vastgelegd:
    //
    //  - `listPriceInclAtSale`: de normale prijs, gelezen uit het onderdeel BINNEN
    //    deze transactie. Niet uit het formulier, want dan zou een geknutselde POST
    //    een willekeurige "normale prijs" kunnen verzinnen en daarmee de gegeven
    //    korting in de rapportages kunnen vervalsen;
    //  - `salePriceInclAtSale`: de prijs die de balie heeft ingevuld, dus wat de klant
    //    werkelijk betaalt. Is er geen prijs meegestuurd (`null` — geen JavaScript,
    //    of een oudere POST), dan wordt de normale prijs geboekt. Dat is de veilige
    //    kant: geen korting in plaats van een verzonnen korting.
    //
    // Er wordt hier BEWUST niet geweigerd als de prijs boven de normale prijs of
    // onder de inkoopprijs ligt: dat zijn uitzonderingen die de balie bewust kan
    // willen boeken (T26 vraagt om een waarschuwing, geen blokkade). Negatief kan
    // niet: het Zod-schema weigert dat, en de CHECK-constraint op `Sale` erachter ook.
    const listPriceIncl = toNumber(part.salePriceIncl);
    const paidPriceIncl = unitPriceIncl ?? listPriceIncl;
    // Een reden zonder korting is betekenisloos en wordt weggegooid in plaats van
    // afgekeurd: de baliemedewerker kan de prijs na het typen van een reden nog
    // terugzetten op normaal, en dan is een blokkerende foutmelding onnodig
    // hinderlijk (zelfde afweging als bij `reference` hierboven).
    const storedDiscountReason =
      paidPriceIncl < listPriceIncl ? discountReason : null;

    const sale = await tx.sale.create({
      data: {
        partId: part.id,
        quantity,
        salePriceInclAtSale: new Prisma.Decimal(paidPriceIncl.toFixed(2)),
        listPriceInclAtSale: part.salePriceIncl,
        purchasePriceExclAtSale: part.purchasePriceExcl,
        vatRateAtSale: part.vatRate,
        channel,
        reference,
        discountReason: storedDiscountReason,
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

    if (!after) {
      // Kan in de praktijk niet: de UPDATE in stap 2 raakte deze rij nog en houdt er
      // tot het einde van de transactie een slot op, en een FK-restrict verhindert
      // het verwijderen. Toch expliciet i.p.v. een fallback-berekening: een gokje
      // hier zou een grootboekregel met verzonnen standen opleveren. Gooien draait
      // alles terug.
      throw new Error(
        `Voorraadstand van onderdeel ${partId} was na de update niet leesbaar; verkoop teruggedraaid.`,
      );
    }

    // Stap 5 — de grootboekregel (SPEC §4, T22).
    //
    // ### Hoe `quantityBefore` hier komt zonder de race te herintroduceren
    //
    // De stand vóór de mutatie wordt NIET met een extra SELECT vóór de update
    // opgehaald en ook niet uit stap 1 overgenomen: dat zou precies de
    // lezen-dan-schrijven-race terugbrengen die de voorwaardelijke `UPDATE` hierboven
    // afvangt (stap 1 leest zonder slot, dus die waarde kan al verouderd zijn zodra
    // hij binnen is).
    //
    // In plaats daarvan wordt hij AFGELEID uit de stand ná de update. Dat mag hier om
    // twee redenen:
    //
    //  1. de `UPDATE` van stap 2 nam een rijslot op deze `Part`-rij dat Postgres tot
    //     het commit-moment vasthoudt. Geen andere transactie kan de voorraad tussen
    //     stap 2 en nu wijzigen — `after.stockQuantity` is dus de werkelijke stand ná
    //     precies onze eigen mutatie, en niet een momentopname die alweer achterhaald
    //     kan zijn;
    //  2. de update was RELATIEF (`decrement: quantity`), dus onze mutatie is exact
    //     `-quantity`. Daarmee geldt per definitie
    //     `quantityBefore = quantityAfter + quantity`, ongeacht wat stap 1 las. Een
    //     levering die tussen stap 1 en stap 2 binnenkwam vervuilt deze regel dus
    //     niet; die hoort een eigen `DELIVERY`-regel te krijgen.
    //
    // De database controleert het resultaat nog een keer met de CHECK-constraint
    // `quantityAfter = quantityBefore + delta`.
    const quantityAfter = after.stockQuantity;
    const quantityBefore = quantityAfter + quantity;

    await tx.stockMutation.create({
      data: {
        partId: part.id,
        delta: -quantity,
        quantityBefore,
        quantityAfter,
        // Werkplaatsverbruik krijgt zijn eigen reden, zodat het grootboek zonder
        // join naar `Sale` te lezen is — net als in de seed.
        reason:
          channel === "WORKSHOP"
            ? StockMutationReason.WORKSHOP
            : StockMutationReason.SALE,
        // Vrije toelichting; bij werkplaatsverbruik de werkorderreferentie. Geen
        // persoonsgegevens (AVG) — het Zod-schema trimt en laat de balie hier niets
        // invullen.
        note: reference,
        saleId: sale.id,
      },
      select: { id: true },
    });

    // Het incl.-totaal is een exacte vermenigvuldiging van het betaalde bedrag; het
    // excl.-totaal is afgeleid en dus een stuurgetal (SPEC §3 regel 0).
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
        ...toPricingFields(
          listPriceIncl,
          paidPriceIncl,
          toNumber(part.vatRate),
          quantity,
          storedDiscountReason,
        ),
        newStockQuantity: quantityAfter,
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
      salePriceInclAtSale: true,
      listPriceInclAtSale: true,
      discountReason: true,
      vatRateAtSale: true,
      channel: true,
      reference: true,
      soldAt: true,
      part: {
        select: { name: true, sku: true, brand: { select: { name: true } } },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    partId: row.partId,
    partName: row.part.name,
    brandName: row.part.brand?.name ?? null,
    sku: row.part.sku,
    quantity: row.quantity,
    channel: row.channel as SaleChannel,
    reference: row.reference,
    // De korting wordt afgeleid uit de twee HISTORISCHE prijzen, nooit uit de
    // huidige prijs van het onderdeel (SPEC §3 regel 3).
    ...toPricingFields(
      toNumber(row.listPriceInclAtSale),
      toNumber(row.salePriceInclAtSale),
      toNumber(row.vatRateAtSale),
      row.quantity,
      row.discountReason,
    ),
    soldAt: row.soldAt.toISOString(),
  }));
}
