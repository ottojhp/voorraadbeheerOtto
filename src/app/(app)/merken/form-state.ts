/**
 * Formulierstatus-type en -initialwaarde voor merkenbeheer.
 *
 * Losgetrokken van `actions.ts`: een `"use server"`-bestand mag in Next.js 15
 * uitsluitend async functies exporteren (type-exports verdwijnen bij het compileren
 * en zijn dus toegestaan, maar een geëxporteerde `const` met een object is dat niet).
 * Dit bestand heeft geen `"use server"` en mag dus gewoon gedeelde types/constanten
 * exporteren; `actions.ts` importeert ze terug met `import type` waar mogelijk.
 */

export interface BrandActionState {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: {
    name?: string;
  };
}

export const initialBrandActionState: BrandActionState = { status: "idle" };
