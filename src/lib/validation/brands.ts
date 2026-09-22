/**
 * Validatie en foutafhandeling voor merken (`Brand`), taak T09.
 *
 * Bevat het Zod-schema voor het formulier (SPEC §3 regel 7: alle server-side invoer
 * wordt gevalideerd) én de pure business-regels die de server actions gebruiken:
 * de verwijderregel en de vertaling van Prisma-foutcodes naar een nette Nederlandse
 * melding. Die laatste twee zijn met opzet pure functies (geen database-aanroep),
 * zodat ze zonder database getest kunnen worden.
 */

import { z } from "zod";

export const MAX_BRAND_NAME_LENGTH = 100;

/** Zod-veld voor een merknaam: verplicht, getrimd, niet leeg, redelijke lengte. */
export const brandNameSchema = z
  .string({ required_error: "Naam is verplicht." })
  .trim()
  .min(1, "Naam is verplicht.")
  .max(
    MAX_BRAND_NAME_LENGTH,
    `Naam mag maximaal ${MAX_BRAND_NAME_LENGTH} tekens zijn.`,
  );

export const createBrandSchema = z.object({
  name: brandNameSchema,
});

export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export const renameBrandSchema = z.object({
  id: z.string().trim().min(1, "Merk-id ontbreekt."),
  name: brandNameSchema,
});

export type RenameBrandInput = z.infer<typeof renameBrandSchema>;

export const deleteBrandSchema = z.object({
  id: z.string().trim().min(1, "Merk-id ontbreekt."),
});

export type DeleteBrandInput = z.infer<typeof deleteBrandSchema>;

// ---------------------------------------------------------------------------
// Verwijderregel (pure functie, geen database-aanroep)
// ---------------------------------------------------------------------------

export interface BrandDeletionCheck {
  allowed: boolean;
  /** Nederlandse foutmelding, alleen gevuld als `allowed` false is. */
  message?: string;
}

/**
 * Een merk mag alleen verwijderd worden als er GEEN onderdelen aan gekoppeld zijn,
 * ook geen gearchiveerde (T09-acceptatiecriterium). `linkedPartCount` moet daarom het
 * TOTALE aantal gekoppelde onderdelen zijn, incl. gearchiveerde
 * (`countPartsForBrand(id).total`), niet alleen de actieve.
 *
 * Puur: geen I/O, zodat de regel zonder database getest kan worden. De server action
 * roept dit aan ná het ophalen van het aantal en blokkeert `prisma.brand.delete`
 * wanneer `allowed` false is. Het schema staat `onDelete: SetNull` toe op
 * `Part.brand`, dus de database zelf zou het verwijderen toestaan; deze functie is de
 * toepassingsregel die dat voorkomt.
 */
export function evaluateBrandDeletion(
  linkedPartCount: number,
): BrandDeletionCheck {
  if (linkedPartCount > 0) {
    const onderdeelWoord =
      linkedPartCount === 1 ? "onderdeel" : "onderdelen";
    const werkwoord = linkedPartCount === 1 ? "is" : "zijn";
    return {
      allowed: false,
      message: `Dit merk kan niet verwijderd worden: er ${werkwoord} nog ${linkedPartCount} ${onderdeelWoord} aan gekoppeld.`,
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Prisma-foutafhandeling (pure vertalers, geen database-aanroep)
// ---------------------------------------------------------------------------

/** Nette Nederlandse melding voor een dubbele merknaam (Prisma-code P2002). */
export const DUPLICATE_BRAND_NAME_ERROR =
  "Er bestaat al een merk met deze naam.";

function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * Herkent Prisma's "Unique constraint failed" (P2002). `Brand.name` heeft een
 * unique constraint (SPEC §4); tussen de voorafgaande naamcontrole en de insert kan
 * een ander verzoek dezelfde naam aanmaken, dus de server action vangt deze fout
 * ALTIJD af naast de voorafgaande controle.
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return hasPrismaErrorCode(error, "P2002");
}

/** Herkent Prisma's "Record not found" (P2025), bv. bij een reeds verwijderd merk. */
export function isRecordNotFoundError(error: unknown): boolean {
  return hasPrismaErrorCode(error, "P2025");
}
