/**
 * Validatie en foutafhandeling voor het onderdeelformulier (`Part`), taak T08
 * (SPEC §F3, §4, §3 regel 7: alle server-side invoer wordt gevalideerd; client-side
 * validatie is hulp voor de gebruiker, geen beveiliging).
 *
 * Bevat het Zod-schema voor het formulier én de pure vertaler van Prisma's P2002
 * (unique constraint failed) naar een veldgebonden Nederlandse melding. Beide zijn
 * met opzet zonder database-aanroep, zodat ze in Vitest getest kunnen worden
 * (`src/lib/__tests__/parts-form.test.ts`).
 *
 * Geldbedragen: gebruikers typen een Nederlandse notatie ("12,50"), maar ook "12.50"
 * moet werken. Beide worden hier genormaliseerd naar een `number` met maximaal 2
 * decimalen (opgeslagen als Decimal(10,2)).
 *
 * Welk soort bedrag welk veld is, staat sinds datamodel v2 in de veldnaam
 * (SPEC §3 regel 0): `purchasePriceExcl` is de inkoopprijs EXCLUSIEF btw (zo staat hij
 * op de leveranciersfactuur) en `salePriceIncl` de verkoopprijs INCLUSIEF btw (zo
 * betaalt de klant hem). Het formulier moet die twee dus ook zo labelen; ze door
 * elkaar halen zou hier ongemerkt goedgekeurd worden.
 *
 * ### De incl./excl.-schakelaar bij de inkoopprijs (T18)
 *
 * De opslag blijft exclusief btw, maar de gebruiker mag kiezen wat hij INTYPT. Het
 * formulier stuurt daarom een extra veld `purchasePriceVatMode` mee (`"excl"` —
 * standaard, want leveranciersfacturen zijn exclusief — of `"incl"`). Bij `"incl"`
 * wordt hier, SERVER-SIDE, teruggerekend met {@link priceExclVat} vóórdat het bedrag
 * naar de database gaat.
 *
 * Die omrekening staat met opzet in dit schema en niet in de server actions: er zijn
 * twee actions (aanmaken én bewerken) die hetzelfde formulier verwerken, en een
 * omrekening die je op één van de twee plekken vergeet zou een inkoopprijs 21% te
 * hoog opslaan zonder dat iets faalt. Door het als transformatie op het schema te
 * zetten is `purchasePriceExcl` in `PartFormValues` per constructie altijd een
 * excl.-bedrag — welke keuze de gebruiker ook maakte.
 *
 * Let op de richting van het verlies: terugrekenen van incl. naar excl. rondt af op
 * centen, dus €10,00 incl. bij 21% wordt 8,26 excl. en dat is terug 9,99 incl. Voor
 * de INKOOPprijs is dat aanvaard (de factuur is excl., dus het excl.-bedrag is daar
 * de waarheid) en het formulier waarschuwt ervoor. Precies dit verlies is de reden
 * dat de VERKOOPprijs de andere kant op wordt opgeslagen (SPEC §3 regel 0).
 *
 * Lege optionele velden ("") worden hier omgezet naar `null`, NOOIT naar een lege
 * string. Dat is essentieel voor `barcode`: de kolom heeft een unique constraint die
 * `null`-waarden niet als gelijk beschouwt (Postgres), maar wél twee lege strings
 * ("") — zodra een tweede onderdeel zonder barcode wordt aangemaakt met "" in plaats
 * van `null`, zou dat een onterechte duplicaatfout geven.
 */

import { z } from "zod";

import { CATEGORY_OPTIONS, type Category } from "@/lib/labels";
import { priceExclVat } from "@/lib/money";

// ---------------------------------------------------------------------------
// Herbruikbare veldschema's
// ---------------------------------------------------------------------------

/** Trimt een vrij tekstveld en zet een lege waarde om naar `null` (nooit ""). */
const optionalTrimmedField = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));

/** Verplicht, getrimd, niet-leeg tekstveld. */
function requiredTextField(label: string) {
  return z.string().trim().min(1, `${label} is verplicht`);
}

/** Regex voor een niet-negatief getal met maximaal 2 decimalen, na normalisatie. */
const TWO_DECIMALS_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Zet Nederlandse ("12,50") of gewone ("12.50") notatie om naar een genormaliseerde
 * puntnotatie-string, zodat één regex beide vormen kan valideren. Retourneert `null`
 * als de invoer geen geldig getal met maximaal 2 decimalen is.
 */
function normalizeDecimalInput(raw: string): string | null {
  const normalized = raw.trim().replace(",", ".");
  return TWO_DECIMALS_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Geldbedrag-veld: verplicht, accepteert komma of punt als decimaalteken, maximaal 2
 * decimalen, moet 0 of hoger zijn (prijzen zijn nooit negatief, SPEC §F3).
 */
function moneyField(label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} is verplicht`)
    .transform((value, ctx) => {
      const normalized = normalizeDecimalInput(value);
      if (normalized === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} moet een getal zijn met maximaal 2 decimalen, bv. 12,50`,
        });
        return z.NEVER;
      }
      return Number(normalized);
    })
    .refine((value) => value >= 0, {
      message: `${label} moet 0 of hoger zijn`,
    });
}

/**
 * Btw-tarief: zelfde notatie-regels als een geldbedrag, maar optioneel — een leeg
 * veld valt terug op 21 (SPEC §F3: "standaard 21").
 */
const vatRateField = z
  .string()
  .trim()
  .transform((value) => (value === "" ? "21" : value))
  .transform((value, ctx) => {
    const normalized = normalizeDecimalInput(value);
    if (normalized === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Btw-tarief moet een getal zijn met maximaal 2 decimalen",
      });
      return z.NEVER;
    }
    return Number(normalized);
  })
  .refine((value) => value >= 0, {
    message: "Btw-tarief moet 0 of hoger zijn",
  });

/**
 * Geheel getal ≥ 0 (voorraad, minimumvoorraad). De regex staat alleen cijfers toe,
 * dus een minteken of decimaalteken faalt vanzelf — geen aparte `>= 0`-check nodig.
 */
function nonNegativeIntField(label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} is verplicht`)
    .transform((value, ctx) => {
      if (!/^\d+$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} moet een geheel getal zijn (0 of hoger)`,
        });
        return z.NEVER;
      }
      return Number(value);
    });
}

/**
 * De incl./excl.-keuze bij de inkoopprijs (T18). Leeg of afwezig betekent `"excl"`:
 * dat is de standaard én de veilige kant, want bij `"excl"` wordt het ingetypte
 * bedrag ongewijzigd opgeslagen. Een onbekende waarde wordt geweigerd in plaats van
 * stilzwijgend als `"excl"` behandeld — dan zou een typefout in de HTML een
 * inkoopprijs 21% te hoog kunnen opslaan.
 */
const purchasePriceVatModeField = z
  .union([z.string(), z.undefined()])
  // Ook een volledig ontbrekend veld valt terug op `"excl"`: het formulier stuurt
  // altijd een waarde mee, maar een aanroeper die dit veld niet kent (bv. een oudere
  // test of een import) hoort geen validatiefout te krijgen én zeker geen omrekening.
  .transform((value) => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? "excl" : trimmed;
  })
  .pipe(
    z.enum(["excl", "incl"], {
      errorMap: () => ({
        message: "Geef aan of de inkoopprijs inclusief of exclusief btw is",
      }),
    }),
  );

/** De keuzes die de schakelaar bij de inkoopprijs aanbiedt. */
export type PurchasePriceVatMode = "excl" | "incl";

// ---------------------------------------------------------------------------
// Formulierschema
// ---------------------------------------------------------------------------

const CATEGORY_VALUES = CATEGORY_OPTIONS as [Category, ...Category[]];

/**
 * De velden zoals ze uit het formulier komen. Hierop wordt hieronder nog de
 * btw-omrekening van de inkoopprijs toegepast; gebruik altijd `partFormSchema`.
 */
const partFormFields = z.object({
  name: requiredTextField("Naam"),
  sku: requiredTextField("SKU"),
  category: z.enum(CATEGORY_VALUES, {
    errorMap: () => ({ message: "Kies een categorie" }),
  }),
  /** Leeg = geen merk (universeel onderdeel) — dit MOET kunnen (SPEC §4). */
  brandId: optionalTrimmedField,
  /** Leeg = geen leverancier. */
  supplierId: optionalTrimmedField,
  barcode: optionalTrimmedField,
  description: optionalTrimmedField,
  fitsModels: optionalTrimmedField,
  location: optionalTrimmedField,
  /**
   * Het INGETYPTE inkoopbedrag. Of dat incl. of excl. btw is zegt
   * `purchasePriceVatMode`; na de transformatie hieronder is dit veld altijd het
   * bedrag EXCL. btw. Het label is daarom neutraal ("Inkoopprijs"): een
   * foutmelding met "(excl. btw)" erin zou onzin zijn als de gebruiker net incl.
   * heeft gekozen.
   */
  purchasePriceExcl: moneyField("Inkoopprijs"),
  purchasePriceVatMode: purchasePriceVatModeField,
  salePriceIncl: moneyField("Verkoopprijs (incl. btw)"),
  vatRate: vatRateField,
  stockQuantity: nonNegativeIntField("Voorraad"),
  minStock: nonNegativeIntField("Minimumvoorraad"),
});

/**
 * Het schema dat de server actions gebruiken: de formuliervelden PLUS de
 * btw-omrekening van de inkoopprijs. Na `safeParse` is `purchasePriceExcl`
 * gegarandeerd een bedrag exclusief btw, ongeacht wat de gebruiker koos.
 */
export const partFormSchema = partFormFields.transform((data) => ({
  ...data,
  purchasePriceExcl:
    data.purchasePriceVatMode === "incl"
      ? priceExclVat(data.purchasePriceExcl, data.vatRate)
      : data.purchasePriceExcl,
}));

/** Ruwe (nog niet-getransformeerde) invoer, zoals uit een formulier gelezen. */
export type PartFormInput = z.input<typeof partFormSchema>;

/** Gevalideerde en genormaliseerde waarden, klaar om naar Prisma te schrijven. */
export type PartFormValues = z.output<typeof partFormSchema>;

/** De veldnamen van het onderdeelformulier, voor veldgebonden foutmeldingen. */
export type PartFormFieldName = keyof PartFormInput;

// ---------------------------------------------------------------------------
// Prisma-foutafhandeling (pure vertaler, geen database-aanroep)
// ---------------------------------------------------------------------------

export const DUPLICATE_SKU_ERROR = "Dit SKU-nummer is al in gebruik bij een ander onderdeel.";
export const DUPLICATE_BARCODE_ERROR =
  "Deze barcode is al in gebruik bij een ander onderdeel.";

function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/** Herkent Prisma's "Unique constraint failed" (P2002). */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return hasPrismaErrorCode(error, "P2002");
}

/** Herkent Prisma's "Record not found" (P2025), bv. bij een al gearchiveerd/verwijderd onderdeel. */
export function isRecordNotFoundError(error: unknown): boolean {
  return hasPrismaErrorCode(error, "P2025");
}

export interface UniqueConstraintFieldError {
  field: "sku" | "barcode";
  message: string;
}

/** Leest `error.meta.target` (Prisma P2002) als een array van kolomnamen, ongeacht vorm. */
function targetColumnsOf(error: unknown): string[] {
  const meta = (error as { meta?: unknown } | null)?.meta;
  if (!meta || typeof meta !== "object") {
    return [];
  }
  const target = (meta as { target?: unknown }).target;
  if (Array.isArray(target)) {
    return target.map(String);
  }
  if (typeof target === "string") {
    // Sommige databases (of Prisma-versies) geven de target als één string terug,
    // als kommagescheiden kolomlijst of als index-/constraintnaam
    // (bv. "Part_barcode_key"). `includes` in de aanroeper vangt beide vormen.
    return [target];
  }
  return [];
}

/**
 * Vertaalt Prisma's P2002 (unique constraint failed) naar de betrokken veldnaam en
 * een Nederlandse melding, door `error.meta.target` te inspecteren. `Part` heeft twee
 * unieke velden die via dit formulier gevuld worden: `sku` (altijd) en `barcode`
 * (indien ingevuld) — zie SPEC §4. Puur, geen I/O, dus zonder database te testen.
 *
 * Geeft `null` terug als de fout geen (herkenbare) unique-constraint-schending is; de
 * server action gooit de fout dan door als onverwachte fout.
 */
export function fieldErrorFromUniqueConstraint(
  error: unknown,
): UniqueConstraintFieldError | null {
  if (!isUniqueConstraintViolation(error)) {
    return null;
  }

  const columns = targetColumnsOf(error).map((c) => c.toLowerCase());

  if (columns.some((c) => c.includes("barcode"))) {
    return { field: "barcode", message: DUPLICATE_BARCODE_ERROR };
  }
  if (columns.some((c) => c.includes("sku"))) {
    return { field: "sku", message: DUPLICATE_SKU_ERROR };
  }

  return null;
}
