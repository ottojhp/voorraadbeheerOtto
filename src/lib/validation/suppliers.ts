/**
 * Zod-schema voor het leveranciersformulier (`/leveranciers/nieuw`,
 * `/leveranciers/[id]/bewerken`), SPEC §F5 en §3 regel 7 (alle server-side invoer
 * wordt gevalideerd; client-side validatie is hulp, geen beveiliging).
 *
 * Uitgangspunten:
 * - `name` is verplicht en niet-leeg na trimmen.
 * - `email` is optioneel, maar wordt als e-mailadres gevalideerd zodra hij is
 *   ingevuld.
 * - Overige velden zijn optionele strings.
 * - Een leeg formulierveld ("") wordt hier omgezet naar `null`, zodat lege strings
 *   nooit in de database belanden — alleen `null` of een echte waarde.
 * - Foutmeldingen zijn in het Nederlands.
 *
 * Verwacht platte strings als invoer (server actions lezen `FormData` en zetten elk
 * veld om naar een string, ook als het veld ontbreekt); dat houdt dit schema simpel
 * en herbruikbaar voor eventuele client-side hertoetsing.
 */

import { z } from "zod";

/** Trimt een vrij tekstveld en zet een lege waarde om naar `null`. */
const optionalTrimmedField = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));

/** Leeg e-mailveld is toegestaan; een ingevulde waarde moet een geldig e-mailadres zijn. */
const optionalEmailField = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (value === "") {
      return;
    }
    if (!z.string().email().safeParse(value).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Voer een geldig e-mailadres in",
      });
    }
  })
  .transform((value) => (value === "" ? null : value));

export const supplierFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Naam is verplicht"),
  contactPerson: optionalTrimmedField,
  phone: optionalTrimmedField,
  email: optionalEmailField,
  address: optionalTrimmedField,
  notes: optionalTrimmedField,
});

/** Ruwe (nog niet-getransformeerde) invoer, zoals uit een formulier gelezen. */
export type SupplierFormInput = z.input<typeof supplierFormSchema>;

/** Gevalideerde en genormaliseerde waarden, klaar om naar Prisma te schrijven. */
export type SupplierFormValues = z.output<typeof supplierFormSchema>;

/** De veldnamen van het leveranciersformulier, voor veldgebonden foutmeldingen. */
export type SupplierFormFieldName = keyof SupplierFormInput;
