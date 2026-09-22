/**
 * Formulierstatus-types en -initialwaarden voor leveranciers.
 *
 * Losgetrokken van `actions.ts`: een `"use server"`-bestand mag in Next.js 15
 * uitsluitend async functies exporteren (type-exports verdwijnen bij het compileren
 * en zijn dus toegestaan, maar een geëxporteerde `const` met een object is dat niet).
 * Dit bestand heeft geen `"use server"` en mag dus gewoon gedeelde types/constanten
 * exporteren; `actions.ts` importeert ze terug met `import type` waar mogelijk.
 */

import type { SupplierFormFieldName } from "@/lib/validation/suppliers";

// ---------------------------------------------------------------------------
// Aanmaken / bewerken
// ---------------------------------------------------------------------------

export interface SupplierFormState {
  status: "idle" | "invalid" | "error";
  fieldErrors: Partial<Record<SupplierFormFieldName, string>>;
  formError?: string;
}

export const initialSupplierFormState: SupplierFormState = {
  status: "idle",
  fieldErrors: {},
};

// ---------------------------------------------------------------------------
// Archiveren
// ---------------------------------------------------------------------------

export interface ArchiveSupplierFormState {
  status: "idle" | "error";
  message?: string;
}

export const initialArchiveSupplierFormState: ArchiveSupplierFormState = {
  status: "idle",
};
