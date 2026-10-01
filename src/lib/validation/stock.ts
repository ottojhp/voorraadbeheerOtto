/**
 * Zod-schema voor het snel aanpassen van de voorraad (T19, SPEC §F2/§F3).
 *
 * SPEC §3 regel 7 is bindend: ALLE server-side invoer wordt gevalideerd. De −/+
 * knoppen, de `min`-attributen en het uitschakelen van de −-knop bij 0 in de UI zijn
 * hulp voor de garagehouder, geen beveiliging — zowel de server action als
 * `adjustStock()` in de datalaag parsen hun invoer met dit schema.
 *
 * ### Twee soorten wijziging, bewust als discriminated union
 *
 * - `mode: "relative"` — een VERSCHIL (`delta`): de −/+ knoppen (±1) en "bijboeken"
 *   (bv. een levering van 10 stuks). De database wordt relatief bijgewerkt
 *   (`increment`), zodat twee telefoons die tegelijk bijboeken elkaar niet
 *   overschrijven.
 * - `mode: "absolute"` — een nieuwe STAND (`targetQuantity`): "exact aantal
 *   instellen", bv. na een fysieke telling.
 *
 * Het zijn met opzet twee aparte vormen en niet één veld dat "soms een verschil en
 * soms een stand" is: dat verschil bepaalt of de database relatief of met een
 * compare-and-set wordt bijgewerkt, en een verwisseling zou een telling van 10 als
 * een levering van 10 wegschrijven (of omgekeerd) zonder dat iets faalt.
 *
 * ### Waarom `delta` nooit 0 mag zijn
 * `StockMutation.delta` heeft een CHECK-constraint `delta <> 0` (zie de migratie van
 * T17): een grootboekregel die niets verandert is ruis. Een `delta` van 0 wordt
 * daarom hier al geweigerd in plaats van pas door Postgres.
 *
 * Bij `mode: "absolute"` kan het verschil wél 0 uitkomen (de gestelde stand is
 * gelijk aan de huidige). Dat is géén fout — er wordt dan simpelweg niets gewijzigd
 * en niets geschreven. Dat is een beslissing van de datalaag, niet van dit schema,
 * want alleen daar is de huidige stand bekend.
 */

import { z } from "zod";

import { MANUAL_STOCK_REASON_OPTIONS, type ManualStockReason } from "@/lib/labels";

/** De kiesbare redenen, als tuple voor `z.enum`. */
export const MANUAL_STOCK_REASONS = MANUAL_STOCK_REASON_OPTIONS as [
  ManualStockReason,
  ...ManualStockReason[],
];

/**
 * Bovengrens voor een relatieve wijziging in één keer. Een zeepslot tegen een
 * vertypt aantal (`1000` in plaats van `10`) en tegen een geknutselde POST die met
 * een absurd grote `delta` een Int-overflow in Postgres probeert te forceren. De
 * echte ondergrens (nooit onder 0) wordt in de transactie afgedwongen.
 */
export const MAX_STOCK_DELTA = 100_000;

/** Bovengrens voor een absolute stand; zelfde reden als {@link MAX_STOCK_DELTA}. */
export const MAX_STOCK_QUANTITY = 1_000_000;

/** Maximale lengte van de vrije toelichting (`StockMutation.note`). */
export const MAX_STOCK_NOTE_LENGTH = 200;

/**
 * Maakt van een `FormData`-string een getal, zonder de valkuilen van
 * `z.coerce.number()`: die maakt van `""`, `" "` en `null` een `0`, waardoor een leeg
 * veld de melding "mag niet 0 zijn" zou krijgen in plaats van "vul een aantal in".
 * Onzin (`"abc"`) wordt ongemoeid doorgegeven, zodat Zod zelf de juiste melding kiest.
 */
function numericField(options: {
  requiredError: string;
  invalidTypeError: string;
}) {
  return z.preprocess((value) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") {
        return undefined;
      }
      const parsed = Number(trimmed);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  }, z.number({ required_error: options.requiredError, invalid_type_error: options.invalidTypeError }));
}

/** Het verschil bij een relatieve wijziging: heel getal, niet 0, binnen de grenzen. */
const deltaField = numericField({
  requiredError: "Vul een aantal in",
  invalidTypeError: "Vul een geldig aantal in",
}).pipe(
  z
    .number()
    .int("Aantal moet een heel getal zijn")
    .min(-MAX_STOCK_DELTA, `Aantal mag niet kleiner zijn dan -${MAX_STOCK_DELTA}`)
    .max(MAX_STOCK_DELTA, `Aantal mag niet groter zijn dan ${MAX_STOCK_DELTA}`)
    // `refine` als laatste schakel: het geeft een `ZodEffects` terug waarop geen
    // `min`/`max` meer bestaat.
    .refine((value) => value !== 0, {
      message: "Een wijziging van 0 stuks verandert niets",
    }),
);

/** De nieuwe stand bij "exact aantal instellen": heel getal, 0 of hoger. */
const targetQuantityField = numericField({
  requiredError: "Vul een voorraadaantal in",
  invalidTypeError: "Vul een geldig voorraadaantal in",
}).pipe(
  z
    .number()
    .int("Voorraad moet een heel getal zijn")
    // SPEC §3 regel 6: negatieve voorraad bestaat niet. Hier al weigeren spaart een
    // database-roundtrip; de echte afdwinging staat in de transactie.
    .min(0, "Voorraad kan niet onder 0")
    .max(
      MAX_STOCK_QUANTITY,
      `Voorraad mag niet groter zijn dan ${MAX_STOCK_QUANTITY}`,
    ),
);

/**
 * Reden van de wijziging. Via `errorMap`, want Zod's standaardmelding bij een
 * onbekende enum-waarde is de Engelse "Invalid enum value..." en die zou zo in de UI
 * belanden.
 */
const reasonField = z.enum(MANUAL_STOCK_REASONS, {
  errorMap: () => ({ message: "Kies een reden: levering, correctie of telling" }),
});

/**
 * Vrije toelichting. Leeg wordt `null`, zodat er nooit een lege string in het
 * grootboek staat. GEEN persoonsgegevens (SPEC §4) — net als bij
 * `Sale.reference` bewust zonder inhoudelijke regex, want elke regex daarvoor
 * weigert ook legitieme pakbonnummers en geeft schijnzekerheid.
 */
const noteField = z
  .string()
  .trim()
  .max(
    MAX_STOCK_NOTE_LENGTH,
    `Toelichting mag maximaal ${MAX_STOCK_NOTE_LENGTH} tekens bevatten`,
  )
  .transform((value) => (value === "" ? null : value))
  .nullish()
  .transform((value) => value ?? null);

const partIdField = z.string().trim().min(1, "Onderdeel ontbreekt");

const relativeAdjustment = z.object({
  mode: z.literal("relative"),
  partId: partIdField,
  delta: deltaField,
  reason: reasonField,
  note: noteField,
});

const absoluteAdjustment = z.object({
  mode: z.literal("absolute"),
  partId: partIdField,
  targetQuantity: targetQuantityField,
  reason: reasonField,
  note: noteField,
});

/**
 * Het schema dat de server action en de datalaag gebruiken. `mode` is de
 * discriminator, dus TypeScript weet na een geslaagde parse welk veld gevuld is en
 * een `delta` bij `mode: "absolute"` is een compilerfout in plaats van stil negeren.
 */
export const stockAdjustmentSchema = z.discriminatedUnion("mode", [
  relativeAdjustment,
  absoluteAdjustment,
]);

/** Ruwe invoer, zoals uit een formulier of een client component. */
export type StockAdjustmentInput = z.input<typeof stockAdjustmentSchema>;

/** Gevalideerde waarden, klaar voor `adjustStock()`. */
export type StockAdjustmentValues = z.output<typeof stockAdjustmentSchema>;

/** Veldnamen, voor veldgebonden foutmeldingen in de UI. */
export type StockAdjustmentFieldName =
  | "partId"
  | "delta"
  | "targetQuantity"
  | "reason"
  | "note";
