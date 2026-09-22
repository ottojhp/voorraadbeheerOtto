"use server";

/**
 * Server actions voor leveranciers (SPEC §2: mutaties via server actions, niet via
 * losse REST-routes). Alle invoer wordt server-side gevalideerd met het Zod-schema
 * uit `@/lib/validation/suppliers` (SPEC §3 regel 7) — de formulieren in deze map
 * bevatten alleen client-side hulp, geen beveiliging.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";

import { prisma } from "@/lib/db";
import {
  canArchiveSupplier,
  countActivePartsForSupplier,
} from "@/lib/queries/suppliers";
import {
  supplierFormSchema,
  type SupplierFormFieldName,
} from "@/lib/validation/suppliers";

import type {
  ArchiveSupplierFormState,
  SupplierFormState,
} from "./form-state";

// ---------------------------------------------------------------------------
// Aanmaken / bewerken
// ---------------------------------------------------------------------------

/** Leest de zes formuliervelden uit `FormData` als platte strings ("" als leeg/ontbrekend). */
function readSupplierFormData(formData: FormData) {
  const field = (name: string) => (formData.get(name)?.toString() ?? "").trim();
  return {
    name: formData.get("name")?.toString() ?? "",
    contactPerson: field("contactPerson"),
    phone: field("phone"),
    email: field("email"),
    address: field("address"),
    notes: field("notes"),
  };
}

function fieldErrorsFromZodError(
  error: ZodError,
): Partial<Record<SupplierFormFieldName, string>> {
  const flattened = error.flatten().fieldErrors;
  const result: Partial<Record<SupplierFormFieldName, string>> = {};
  for (const [key, messages] of Object.entries(flattened)) {
    if (messages && messages.length > 0) {
      result[key as SupplierFormFieldName] = messages[0];
    }
  }
  return result;
}

export async function createSupplierAction(
  _prevState: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const parsed = supplierFormSchema.safeParse(readSupplierFormData(formData));

  if (!parsed.success) {
    return {
      status: "invalid",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    };
  }

  let createdId: string;
  try {
    const created = await prisma.supplier.create({ data: parsed.data });
    createdId = created.id;
  } catch (error) {
    console.error("Kon leverancier niet aanmaken", error);
    return {
      status: "error",
      fieldErrors: {},
      formError: "Opslaan is niet gelukt. Probeer het opnieuw.",
    };
  }

  revalidatePath("/leveranciers");
  redirect(`/leveranciers/${createdId}`);
}

export async function updateSupplierAction(
  id: string,
  _prevState: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const parsed = supplierFormSchema.safeParse(readSupplierFormData(formData));

  if (!parsed.success) {
    return {
      status: "invalid",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    };
  }

  try {
    await prisma.supplier.update({ where: { id }, data: parsed.data });
  } catch (error) {
    console.error("Kon leverancier niet bijwerken", error);
    return {
      status: "error",
      fieldErrors: {},
      formError:
        "Opslaan is niet gelukt. Mogelijk bestaat deze leverancier niet meer.",
    };
  }

  revalidatePath("/leveranciers");
  revalidatePath(`/leveranciers/${id}`);
  redirect(`/leveranciers/${id}`);
}

// ---------------------------------------------------------------------------
// Archiveren
// ---------------------------------------------------------------------------

/**
 * Archiveert een leverancier (soft delete via `archivedAt`). HARDE REGEL, server-side
 * gecontroleerd (niet alleen in de UI, SPEC §F5): dit mag alleen als er geen actieve
 * onderdelen meer aan de leverancier hangen. Zo niet, dan komt er een duidelijke
 * Nederlandse melding met het aantal terug en gebeurt er geen schrijfactie.
 */
export async function archiveSupplierAction(
  id: string,
  prevState: ArchiveSupplierFormState,
  formData: FormData,
): Promise<ArchiveSupplierFormState> {
  // `prevState`/`formData` horen bij de `useActionState`-signatuur maar worden hier
  // niet gebruikt: archiveren heeft geen formuliervelden nodig, alleen het `id`.
  void prevState;
  void formData;

  const activePartCount = await countActivePartsForSupplier(id);

  if (!canArchiveSupplier(activePartCount)) {
    const onderdeelWoord = activePartCount === 1 ? "onderdeel" : "onderdelen";
    return {
      status: "error",
      message: `Deze leverancier heeft nog ${activePartCount} actieve ${onderdeelWoord} gekoppeld. Koppel die eerst los of archiveer ze, voordat je de leverancier archiveert.`,
    };
  }

  try {
    await prisma.supplier.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  } catch (error) {
    console.error("Kon leverancier niet archiveren", error);
    return {
      status: "error",
      message: "Archiveren is niet gelukt. Probeer het opnieuw.",
    };
  }

  revalidatePath("/leveranciers");
  revalidatePath(`/leveranciers/${id}`);
  redirect("/leveranciers");
}
