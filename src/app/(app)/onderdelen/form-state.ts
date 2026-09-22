/**
 * Formulierstatus-types en -initialwaarden voor onderdelen.
 *
 * Losgetrokken van `actions.ts`: een `"use server"`-bestand mag in Next.js 15
 * uitsluitend async functies exporteren (type-exports verdwijnen bij het compileren
 * en zijn dus toegestaan, maar een geëxporteerde `const` met een object is dat niet).
 * Dit bestand heeft geen `"use server"` en mag dus gewoon gedeelde types/constanten
 * exporteren; `actions.ts` importeert ze terug met `import type` waar mogelijk.
 */

import type { PartFormFieldName } from "@/lib/validation/parts";

// ---------------------------------------------------------------------------
// Aanmaken / bewerken
// ---------------------------------------------------------------------------

export interface PartFormState {
  status: "idle" | "invalid" | "error";
  fieldErrors: Partial<Record<PartFormFieldName, string>>;
  formError?: string;
}

export const initialPartFormState: PartFormState = {
  status: "idle",
  fieldErrors: {},
};

// ---------------------------------------------------------------------------
// Archiveren
// ---------------------------------------------------------------------------

export interface ArchivePartFormState {
  status: "idle" | "error";
  message?: string;
}

export const initialArchivePartFormState: ArchivePartFormState = {
  status: "idle",
};
