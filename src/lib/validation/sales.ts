/**
 * Zod-schema voor het registreren van een verkoop (SPEC §F4, T12).
 *
 * SPEC §3 regel 7 is hier bindend: ALLE server-side invoer wordt gevalideerd.
 * De plus/min-knoppen en de `min`/`max` op het aantalveld in het verkoopscherm zijn
 * hulp voor de baliemedewerker, geen beveiliging — zowel de server action als
 * `registerSale()` in de datalaag parsen hun invoer met dit schema.
 *
 * Het schema accepteert het aantal zowel als `number` (directe aanroep vanuit code)
 * als `string` (uit `FormData`), zodat er maar één bron van waarheid is voor de
 * regels "geheel getal" en "minimaal 1". Foutmeldingen zijn Nederlands en kunnen
 * rechtstreeks onder een veld getoond worden.
 */

import { z } from "zod";

import { readMoneyInput } from "@/lib/money";

/** Kanalen uit de `SaleChannel`-enum (`prisma/schema.prisma`). */
export const SALE_CHANNELS = ["COUNTER", "WORKSHOP"] as const;

/**
 * Bovengrens voor het aantal. Puur een zeepslot tegen een vertypt aantal
 * (`1111` in plaats van `11`) en tegen een geknutselde POST; de echte grens is de
 * voorraad, en die wordt in de transactie gecontroleerd (SPEC §3 regel 6).
 */
export const MAX_SALE_QUANTITY = 9999;

/** Maximale lengte van de werkorderreferentie. */
export const MAX_SALE_REFERENCE_LENGTH = 120;

/** Maximale lengte van de reden van de korting (T26). */
export const MAX_DISCOUNT_REASON_LENGTH = 200;

/**
 * Bovengrens voor de prijs per stuk: wat er maximaal in een `Decimal(10,2)` past
 * (T26). Puur een zeepslot tegen een vertypt bedrag en tegen een geknutselde POST;
 * zonder deze grens zou de database het bedrag weigeren met een onleesbare
 * numeric-overflowfout in plaats van met een Nederlandse melding bij het veld.
 */
export const MAX_SALE_UNIT_PRICE = 99_999_999.99;

/** Begin van elke foutmelding over de prijs, zodat ze allemaal gelijk klinken. */
const PRICE_LABEL = "De prijs";

/**
 * De prijs per stuk INCL. btw die de klant werkelijk betaalt (T26).
 *
 * Dit veld is LEIDEND: de snelknoppen voor 5/10/15% en het veld voor een vast
 * kortingsbedrag in het verkoopscherm vullen alleen dít veld, en de server leidt de
 * korting af uit het verschil met de normale prijs van het onderdeel. Er wordt dus
 * nooit een percentage of een kortingsbedrag verstuurd dat niet met de getoonde prijs
 * overeen hoeft te komen.
 *
 * Optioneel, en leeg betekent `null` = "de normale prijs van het onderdeel". Dat is
 * met opzet zo: zonder JavaScript (of bij een oudere POST) gaat er geen prijs mee, en
 * dan hoort er de gewone prijs zonder korting geboekt te worden — de veilige kant.
 * `registerSale()` vult `null` in met de prijs die het onderdeel op dat moment heeft.
 *
 * `0` is GELDIG: iets weggeven mag. Negatief niet; dat zou een uitbetaling zijn.
 */
const unitPriceField = z.preprocess(
  (value) => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    }
    return value;
  },
  z.union([
    z.null(),
    z
      .number()
      .refine((value) => Number.isFinite(value), {
        message: `${PRICE_LABEL} moet een getal zijn met maximaal 2 decimalen, bv. 12,50`,
      })
      .refine((value) => value >= 0, {
        message: `${PRICE_LABEL} mag niet negatief zijn`,
      })
      .refine((value) => value <= MAX_SALE_UNIT_PRICE, {
        message: `${PRICE_LABEL} is te hoog`,
      }),
    z
      // Komma of punt als decimaalteken; de balie typt "12,50". Het lezen gebeurt
      // met `readMoneyInput` uit de geldlaag — dezelfde functie die het
      // verkoopscherm live gebruikt, zodat scherm en server nooit een ander
      // oordeel of een andere melding kunnen geven.
      .string()
      .transform((value, ctx) => {
        const result = readMoneyInput(value, PRICE_LABEL);
        if (!result.ok) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error });
          return z.NEVER;
        }
        return result.value;
      })
      .refine((value) => value <= MAX_SALE_UNIT_PRICE, {
        message: `${PRICE_LABEL} is te hoog`,
      }),
  ]),
);

/**
 * Reden van de korting (T26): optioneel vrij tekstveld, leeg wordt `null`.
 *
 * Zelfde afweging als bij {@link referenceField}: GEEN inhoudelijke controle op
 * persoonsgegevens, want elke regex daarvoor weigert ook legitieme redenen en geeft
 * schijnzekerheid. De AVG-eis wordt afgedwongen met een zichtbare waarschuwing bij
 * het veld in het verkoopscherm.
 */
const discountReasonField = z
  .string()
  .trim()
  .max(
    MAX_DISCOUNT_REASON_LENGTH,
    `Reden mag maximaal ${MAX_DISCOUNT_REASON_LENGTH} tekens bevatten`,
  )
  .transform((value) => (value === "" ? null : value))
  .nullish()
  .transform((value) => value ?? null);

/**
 * Aantal: accepteert een getal of een string uit `FormData`.
 *
 * `z.coerce.number()` zou hier niet volstaan: die maakt van `""` en van `" "` een
 * `0` en van `null` ook een `0`, waardoor een leeg veld de melding "minimaal 1" zou
 * krijgen in plaats van "vul een aantal in". Daarom een expliciete preprocess die
 * lege invoer als `undefined` doorgeeft en onzin (`"abc"`) ongemoeid laat, zodat
 * Zod er zelf de juiste melding bij kiest.
 */
const quantityField = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") {
        return undefined;
      }
      const parsed = Number(trimmed);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  },
  z
    .number({
      required_error: "Vul een aantal in",
      invalid_type_error: "Vul een geldig aantal in",
    })
    .int("Aantal moet een heel getal zijn")
    .min(1, "Aantal moet minimaal 1 zijn")
    .max(
      MAX_SALE_QUANTITY,
      `Aantal mag niet groter zijn dan ${MAX_SALE_QUANTITY}`,
    ),
);

/**
 * Werkorderreferentie: vrij tekstveld, leeg wordt `null` zodat er nooit een lege
 * string in de database belandt.
 *
 * Bewust GEEN inhoudelijke controle op kenteken of klantnaam: elke regex daarvoor
 * weigert ook legitieme werkordernummers (bv. `WO-12-AB-34`) en geeft schijnzekerheid.
 * De AVG-eis uit SPEC §4 wordt afgedwongen met een zichtbare waarschuwing bij het
 * veld in het verkoopscherm.
 */
const referenceField = z
  .string()
  .trim()
  .max(
    MAX_SALE_REFERENCE_LENGTH,
    `Referentie mag maximaal ${MAX_SALE_REFERENCE_LENGTH} tekens bevatten`,
  )
  .transform((value) => (value === "" ? null : value))
  .nullish()
  .transform((value) => value ?? null);

export const saleSchema = z
  .object({
    partId: z.string().trim().min(1, "Kies eerst een onderdeel"),
    quantity: quantityField,
    // Via `errorMap` in plaats van `required_error`/`invalid_type_error`: een
    // onbekende waarde levert bij Zod anders de Engelse melding
    // "Invalid enum value..." op, en die zou zo in de UI belanden.
    channel: z.enum(SALE_CHANNELS, {
      errorMap: () => ({ message: "Kies balie of werkplaats" }),
    }),
    reference: referenceField,
    unitPriceIncl: unitPriceField,
    discountReason: discountReasonField,
  })
  // Een referentie hoort bij een werkplaatsverbruik (SPEC §4: "vrije verwijzing naar
  // de werkorder"). Bij een baliesverkoop is hij betekenisloos en wordt hij
  // weggegooid in plaats van afgekeurd: de gebruiker kan het kanaal na het typen nog
  // omzetten naar balie, en dan is een blokkerende foutmelding onnodig hinderlijk.
  .transform((values) => ({
    ...values,
    reference: values.channel === "WORKSHOP" ? values.reference : null,
  }));

/** Ruwe invoer, zoals uit een formulier gelezen (aantal mag een string zijn). */
export type SaleInput = z.input<typeof saleSchema>;

/** Gevalideerde waarden, klaar voor `registerSale()`. */
export type SaleValues = z.output<typeof saleSchema>;

/** Veldnamen van het verkoopformulier, voor veldgebonden foutmeldingen. */
export type SaleFormFieldName =
  | "partId"
  | "quantity"
  | "channel"
  | "reference"
  | "unitPriceIncl"
  | "discountReason";
