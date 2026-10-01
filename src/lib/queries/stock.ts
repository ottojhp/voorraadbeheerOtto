/**
 * Datalaag voor het snel aanpassen van de voorraad (T19, SPEC §F2/§F3).
 *
 * Dit is — naast `registerSale()` (verkoop/werkplaatsverbruik) en de twee paden in
 * `src/app/(app)/onderdelen/actions.ts` (aanmaken en het bewerkformulier) — de enige
 * plek waar `Part.stockQuantity` wijzigt. Twee bindende regels uit SPEC §3 zitten
 * hier net zo ingebakken als in `sales.ts`:
 *
 * - regel 5: de voorraadwijziging en de `StockMutation`-regel (het voorraadgrootboek,
 *   SPEC §4) staan in ÉÉN `prisma.$transaction`. Faalt de grootboekregel, dan draait
 *   de voorraadwijziging mee terug: er bestaat nooit een voorraadwijziging zonder
 *   grootboekregel.
 * - regel 6: negatieve voorraad is verboden. De controle staat server-side BINNEN de
 *   transactie, in de WHERE-clause van de update — niet alleen in de UI.
 *
 * Naar buiten gaan alleen plain DTO's (`number`, `string`, `boolean`, `null`):
 * nooit een `Decimal` of een `Date` (SPEC §3 regel 1), want dit resultaat gaat
 * rechtstreeks terug naar een client component.
 *
 * ### Waarom het ongedaan maken hier geen eigen functie is
 * "Ongedaan maken" in de UI is gewoon een tweede, tegengestelde relatieve wijziging
 * met reden `CORRECTION`. Er wordt NOOIT een bestaande regel gewist of bijgewerkt:
 * een grootboek waarin regels verdwijnen is geen grootboek (SPEC §4). Daarom hoeft
 * er geen aparte functie te bestaan — `adjustStock()` met een omgekeerde `delta` is
 * precies de juiste boeking, en die kan ook geweigerd worden (bv. als er inmiddels
 * verkocht is), wat met een "wis de regel"-aanpak niet eens te signaleren zou zijn.
 *
 * Server-only: importeer dit bestand niet in een client component.
 */

import { Prisma, StockMutationReason } from "@prisma/client";

import { prisma } from "@/lib/db";
import { isLowStock } from "@/lib/queries/parts";
import {
  stockAdjustmentSchema,
  type StockAdjustmentFieldName,
  type StockAdjustmentInput,
} from "@/lib/validation/stock";

import type {
  StockAdjustmentErrorCode,
  StockAdjustmentResultDTO,
} from "./types";

export type { StockAdjustmentErrorCode, StockAdjustmentResultDTO };

// ---------------------------------------------------------------------------
// Fouten
// ---------------------------------------------------------------------------

export interface StockAdjustmentErrorDetails {
  /** Werkelijke voorraad op het moment van weigeren (bij `INSUFFICIENT_STOCK`). */
  availableStock?: number;
  /** De gevraagde wijziging, zodat de melding beide getallen kan noemen. */
  requestedDelta?: number;
  /** Veldgebonden meldingen uit Zod (bij `INVALID_INPUT`). */
  fieldErrors?: Partial<Record<StockAdjustmentFieldName, string>>;
}

/** Fout bij het aanpassen van de voorraad; `message` is al Nederlands en toonbaar. */
export class StockAdjustmentError extends Error {
  readonly code: StockAdjustmentErrorCode;
  readonly availableStock?: number;
  readonly requestedDelta?: number;
  readonly fieldErrors?: Partial<Record<StockAdjustmentFieldName, string>>;

  constructor(
    code: StockAdjustmentErrorCode,
    message: string,
    details: StockAdjustmentErrorDetails = {},
  ) {
    super(message);
    this.name = "StockAdjustmentError";
    this.code = code;
    this.availableStock = details.availableStock;
    this.requestedDelta = details.requestedDelta;
    this.fieldErrors = details.fieldErrors;
  }
}

/**
 * Type guard. Naast `instanceof` ook een structurele controle: een fout die door een
 * transactiegrens of een serialisatiestap is gegaan verliest zijn prototype, en een
 * `instanceof`-only check zou hem dan stilletjes als "onbekende fout" behandelen
 * (zelfde reden als bij `isSaleError`).
 */
export function isStockAdjustmentError(
  error: unknown,
): error is StockAdjustmentError {
  if (error instanceof StockAdjustmentError) {
    return true;
  }
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    (error as { name?: unknown }).name === "StockAdjustmentError"
  );
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

// `StockAdjustmentResultDTO` en `StockAdjustmentErrorCode` staan in `./types`: die
// module importeert niets uit `@prisma/client` en mag daarom ook in een client
// component gebruikt worden (SPEC §3 regel 1). Ze worden hierboven doorgeëxporteerd,
// zodat server-side aanroepers alles uit deze module kunnen halen.

// ---------------------------------------------------------------------------
// Hulpjes
// ---------------------------------------------------------------------------

/** Velden van het onderdeel die een voorraadwijziging nodig heeft. */
const PART_FOR_STOCK_SELECT = {
  id: true,
  name: true,
  stockQuantity: true,
  minStock: true,
  archivedAt: true,
} satisfies Prisma.PartSelect;

function pluralStuks(count: number): string {
  return count === 1 ? "stuk" : "stuks";
}

// ---------------------------------------------------------------------------
// adjustStock
// ---------------------------------------------------------------------------

/**
 * Past de voorraad van één onderdeel aan en schrijft in dezelfde transactie de
 * bijbehorende `StockMutation`-regel.
 *
 * Twee vormen (zie `@/lib/validation/stock`):
 *
 * - `mode: "relative"` — de −/+ knoppen (±1) en "bijboeken". De voorraad wordt
 *   RELATIEF bijgewerkt met één `UPDATE`:
 *
 *   ```sql
 *   UPDATE "Part" SET "stockQuantity" = "stockQuantity" + $delta
 *    WHERE id = $id AND "archivedAt" IS NULL
 *      -- alleen bij een verlaging, want dan kan het onder 0 uitkomen:
 *      AND "stockQuantity" >= $afname
 *   ```
 *
 *   Dit is exact het patroon uit `registerSale()` en om dezelfde reden: een
 *   `SELECT` neemt onder Postgres' READ COMMITTED geen slot, dus "lezen, controleren,
 *   dan schrijven" is niet veilig als er twee telefoons in de werkplaats open staan.
 *   Een `UPDATE` neemt wél een rijslot en hertoetst zijn WHERE op de nieuwste versie
 *   van de rij: de verliezer van de race raakt 0 rijen en krijgt een nette fout
 *   waarna de hele transactie terugdraait. Omdat de wijziging relatief is, levert
 *   twee keer snel op **+** tikken ook echt **+2** op — ook als beide verzoeken
 *   elkaar overlappen. Een "zet op N"-update zou daar één tik verliezen.
 *
 * - `mode: "absolute"` — "exact aantal instellen" (bv. na een telling). Een absolute
 *   stand kan niet relatief geschreven worden, dus hier is een compare-and-set
 *   nodig: de huidige stand wordt binnen de transactie gelezen en gaat vervolgens
 *   mee in de WHERE van de update:
 *
 *   ```sql
 *   UPDATE "Part" SET "stockQuantity" = $target
 *    WHERE id = $id AND "archivedAt" IS NULL AND "stockQuantity" = $gelezenStand
 *   ```
 *
 *   Daarmee is het dezelfde voorwaardelijke-update-aanpak: wijzigde iemand anders de
 *   voorraad tussen het lezen en het schrijven, dan raakt deze update 0 rijen en
 *   wordt de hele transactie teruggedraaid — geen halve mutatie en geen telling die
 *   stilletjes een levering van iemand anders wegpoetst. De nieuwe stand is per
 *   definitie ≥ 0 omdat het schema negatieve standen al weigert.
 *
 * Een `mode: "absolute"` die precies op de huidige stand uitkomt wijzigt niets en
 * schrijft niets: `delta` mag niet 0 zijn (CHECK-constraint uit T17) en een
 * grootboekregel die niets verandert is ruis. Het resultaat heeft dan
 * `changed: false`.
 *
 * @throws {StockAdjustmentError} met een onderscheidbare `code` en een Nederlandse
 *   melding.
 */
export async function adjustStock(
  input: StockAdjustmentInput,
): Promise<StockAdjustmentResultDTO> {
  // SPEC §3 regel 7: ook binnen de datalaag valideren, niet alleen in de action.
  // Bewust vóór de transactie: ongeldige invoer hoeft geen database te raken.
  const parsed = stockAdjustmentSchema.safeParse(input);
  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    const fieldErrors: Partial<Record<StockAdjustmentFieldName, string>> = {};
    for (const [key, messages] of Object.entries(flattened)) {
      if (messages && messages.length > 0) {
        fieldErrors[key as StockAdjustmentFieldName] = messages[0];
      }
    }
    throw new StockAdjustmentError(
      "INVALID_INPUT",
      Object.values(fieldErrors)[0] ?? "De ingevulde gegevens kloppen niet.",
      { fieldErrors },
    );
  }

  const values = parsed.data;

  return prisma.$transaction(async (tx) => {
    // Stap 1 — het onderdeel lezen binnen de transactie. Dit levert nette,
    // specifieke meldingen op ("er liggen maar 2 stuks") in plaats van alleen het
    // kale "0 rijen geraakt" van de voorwaardelijke update hieronder. De controle
    // VERVANGT die voorwaarde niet; zie de doc-comment.
    const part = await tx.part.findUnique({
      where: { id: values.partId },
      select: PART_FOR_STOCK_SELECT,
    });

    if (!part) {
      throw new StockAdjustmentError(
        "PART_NOT_FOUND",
        "Dit onderdeel bestaat niet (meer). Ga terug en haal de lijst opnieuw op.",
      );
    }

    if (part.archivedAt !== null) {
      throw new StockAdjustmentError(
        "PART_ARCHIVED",
        `"${part.name}" is gearchiveerd; de voorraad daarvan kan niet meer gewijzigd worden.`,
      );
    }

    // Stap 2 — de voorraad bijwerken met een VOORWAARDELIJKE update, en daarna de
    // nieuwe stand teruglezen. `quantityBefore` wordt AFGELEID uit de stand ná de
    // update en niet uit stap 1 overgenomen: de update van stap 2 houdt een rijslot
    // tot het commit-moment, dus `after` is de werkelijke stand ná precies onze eigen
    // mutatie — terwijl de waarde uit stap 1 zonder slot gelezen is en dus al
    // verouderd kan zijn. Dezelfde onderbouwing als in `registerSale()`.
    let delta: number;

    if (values.mode === "relative") {
      delta = values.delta;

      // Alleen een VERLAGING kan onder 0 uitkomen; bij een verhoging zou een
      // ondergrens in de WHERE de update onnodig kunnen laten mislukken.
      if (delta < 0) {
        const decrease = -delta;
        if (part.stockQuantity < decrease) {
          throw new StockAdjustmentError(
            "INSUFFICIENT_STOCK",
            `Er ${part.stockQuantity === 1 ? "ligt" : "liggen"} maar ${part.stockQuantity} ${pluralStuks(
              part.stockQuantity,
            )} van "${part.name}" op voorraad; je probeert er ${decrease} af te boeken. De voorraad kan niet onder 0.`,
            {
              availableStock: part.stockQuantity,
              requestedDelta: delta,
            },
          );
        }
      }

      const updated = await tx.part.updateMany({
        where: {
          id: values.partId,
          archivedAt: null,
          // SPEC §3 regel 6 in de WHERE-clause: bij een verlaging mag de rij alleen
          // geraakt worden als er op het moment van SCHRIJVEN genoeg ligt.
          ...(delta < 0 ? { stockQuantity: { gte: -delta } } : {}),
        },
        data: { stockQuantity: { increment: delta } },
      });

      if (updated.count !== 1) {
        throw new StockAdjustmentError(
          "STOCK_CHANGED",
          `De voorraad van "${part.name}" is zojuist door iemand anders gewijzigd en er ligt niet genoeg meer. Er is niets gewijzigd; haal de voorraad opnieuw op en probeer het nog eens.`,
          { requestedDelta: delta },
        );
      }
    } else {
      // Absolute stand. Komt hij overeen met wat er al staat, dan is er niets te
      // doen: geen update, geen grootboekregel.
      if (values.targetQuantity === part.stockQuantity) {
        return {
          partId: part.id,
          partName: part.name,
          changed: false,
          delta: 0,
          quantityBefore: part.stockQuantity,
          quantityAfter: part.stockQuantity,
          minStock: part.minStock,
          isLowStock: isLowStock(part.stockQuantity, part.minStock),
          reason: null,
          mutationId: null,
        } satisfies StockAdjustmentResultDTO;
      }

      const updated = await tx.part.updateMany({
        where: {
          id: values.partId,
          archivedAt: null,
          // Compare-and-set: de stand die we net lazen moet er bij het schrijven nog
          // staan. Zo verdwijnt een gelijktijdige levering niet stilletjes in een
          // telling.
          stockQuantity: part.stockQuantity,
        },
        data: { stockQuantity: values.targetQuantity },
      });

      if (updated.count !== 1) {
        throw new StockAdjustmentError(
          "STOCK_CHANGED",
          `De voorraad van "${part.name}" is zojuist door iemand anders gewijzigd. Er is niets gewijzigd; haal de voorraad opnieuw op en stel het aantal nog een keer in.`,
        );
      }

      delta = values.targetQuantity - part.stockQuantity;
    }

    // Stap 3 — de nieuwe stand teruglezen in plaats van hem uit te rekenen.
    const after = await tx.part.findUnique({
      where: { id: values.partId },
      select: { stockQuantity: true, minStock: true },
    });

    if (!after) {
      // Kan in de praktijk niet: de update hierboven raakte deze rij en houdt er tot
      // het einde van de transactie een slot op, en `onDelete: Restrict` verhindert
      // het verwijderen. Toch expliciet in plaats van een fallback-berekening: een
      // gokje hier zou een grootboekregel met verzonnen standen opleveren. Gooien
      // draait alles terug.
      throw new Error(
        `Voorraadstand van onderdeel ${values.partId} was na de update niet leesbaar; wijziging teruggedraaid.`,
      );
    }

    const quantityAfter = after.stockQuantity;
    const quantityBefore = quantityAfter - delta;

    // Stap 4 — de grootboekregel (SPEC §4). Dezelfde transactie: faalt dit, dan
    // draait de voorraadwijziging mee terug.
    const mutation = await tx.stockMutation.create({
      data: {
        partId: part.id,
        delta,
        quantityBefore,
        quantityAfter,
        reason: StockMutationReason[values.reason],
        note: values.note,
      },
      select: { id: true },
    });

    return {
      partId: part.id,
      partName: part.name,
      changed: true,
      delta,
      quantityBefore,
      quantityAfter,
      minStock: after.minStock,
      isLowStock: isLowStock(quantityAfter, after.minStock),
      reason: values.reason,
      mutationId: mutation.id,
    } satisfies StockAdjustmentResultDTO;
  });
}

// ---------------------------------------------------------------------------
// Grootboek uitlezen (voor controle en tests)
// ---------------------------------------------------------------------------

/**
 * De som van alle `delta`'s van één onderdeel. Hoort per definitie exact gelijk te
 * zijn aan `Part.stockQuantity` zolang het grootboek sluitend is (SPEC §4). Wordt
 * gebruikt om dat na een wijziging te kunnen controleren.
 */
export async function sumStockMutationDeltas(partId: string): Promise<number> {
  const result = await prisma.stockMutation.aggregate({
    where: { partId },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}
