"use server";

/**
 * Server actions voor onderdelen (SPEC §F3, §2: mutaties via server actions, niet via
 * losse REST-routes). Alle invoer wordt server-side gevalideerd met het Zod-schema
 * uit `@/lib/validation/parts` (SPEC §3 regel 7) — `PartForm` bevat alleen
 * client-side hulp, geen beveiliging.
 *
 * Duplicate `sku`/`barcode` (SPEC §4: beide `@unique`) geven een veldgebonden
 * melding terug in plaats van een 500: Prisma's P2002 wordt hier afgevangen en
 * vertaald met de pure functie `fieldErrorFromUniqueConstraint` uit de validatielaag,
 * die uit `error.meta.target` afleidt welk veld het betreft.
 *
 * Archiveren zet `archivedAt` (soft delete, SPEC §3 regel 4) en verwijdert nooit
 * hard — de foreign key `Sale.partId` (`onDelete: Restrict`) zou een hard delete van
 * een verkocht onderdeel bovendien laten stuklopen.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";

import { prisma } from "@/lib/db";
import {
  fieldErrorFromUniqueConstraint,
  isRecordNotFoundError,
  partFormSchema,
  type PartFormFieldName,
} from "@/lib/validation/parts";

import type { ArchivePartFormState, PartFormState } from "./form-state";

const PARTS_PATH = "/onderdelen";

// ---------------------------------------------------------------------------
// Aanmaken / bewerken
// ---------------------------------------------------------------------------

/** Leest alle veertien formuliervelden uit `FormData` als platte strings. */
function readPartFormData(formData: FormData) {
  const field = (name: string) => formData.get(name)?.toString() ?? "";
  return {
    name: field("name"),
    sku: field("sku"),
    category: field("category"),
    brandId: field("brandId"),
    supplierId: field("supplierId"),
    barcode: field("barcode"),
    description: field("description"),
    fitsModels: field("fitsModels"),
    location: field("location"),
    purchasePrice: field("purchasePrice"),
    salePrice: field("salePrice"),
    vatRate: field("vatRate"),
    stockQuantity: field("stockQuantity"),
    minStock: field("minStock"),
  };
}

function fieldErrorsFromZodError(
  error: ZodError,
): Partial<Record<PartFormFieldName, string>> {
  const flattened = error.flatten().fieldErrors;
  const result: Partial<Record<PartFormFieldName, string>> = {};
  for (const [key, messages] of Object.entries(flattened)) {
    if (messages && messages.length > 0) {
      result[key as PartFormFieldName] = messages[0];
    }
  }
  return result;
}

export async function createPartAction(
  _prevState: PartFormState,
  formData: FormData,
): Promise<PartFormState> {
  const parsed = partFormSchema.safeParse(readPartFormData(formData));

  if (!parsed.success) {
    return {
      status: "invalid",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    };
  }

  const { data } = parsed;

  let createdId: string;
  try {
    const created = await prisma.part.create({
      data: {
        name: data.name,
        sku: data.sku,
        category: data.category,
        brandId: data.brandId,
        supplierId: data.supplierId,
        barcode: data.barcode,
        description: data.description,
        fitsModels: data.fitsModels,
        location: data.location,
        purchasePrice: data.purchasePrice,
        salePrice: data.salePrice,
        vatRate: data.vatRate,
        stockQuantity: data.stockQuantity,
        minStock: data.minStock,
      },
    });
    createdId = created.id;
  } catch (error) {
    const fieldError = fieldErrorFromUniqueConstraint(error);
    if (fieldError) {
      return {
        status: "invalid",
        fieldErrors: { [fieldError.field]: fieldError.message },
      };
    }
    console.error("Kon onderdeel niet aanmaken", error);
    return {
      status: "error",
      fieldErrors: {},
      formError: "Opslaan is niet gelukt. Probeer het opnieuw.",
    };
  }

  revalidatePath(PARTS_PATH);
  redirect(`/onderdelen/${createdId}?opgeslagen=aangemaakt`);
}

export async function updatePartAction(
  id: string,
  _prevState: PartFormState,
  formData: FormData,
): Promise<PartFormState> {
  const parsed = partFormSchema.safeParse(readPartFormData(formData));

  if (!parsed.success) {
    return {
      status: "invalid",
      fieldErrors: fieldErrorsFromZodError(parsed.error),
    };
  }

  const { data } = parsed;

  try {
    await prisma.part.update({
      where: { id },
      data: {
        name: data.name,
        sku: data.sku,
        category: data.category,
        brandId: data.brandId,
        supplierId: data.supplierId,
        barcode: data.barcode,
        description: data.description,
        fitsModels: data.fitsModels,
        location: data.location,
        purchasePrice: data.purchasePrice,
        salePrice: data.salePrice,
        vatRate: data.vatRate,
        stockQuantity: data.stockQuantity,
        minStock: data.minStock,
      },
    });
  } catch (error) {
    const fieldError = fieldErrorFromUniqueConstraint(error);
    if (fieldError) {
      return {
        status: "invalid",
        fieldErrors: { [fieldError.field]: fieldError.message },
      };
    }
    if (isRecordNotFoundError(error)) {
      return {
        status: "error",
        fieldErrors: {},
        formError: "Opslaan is niet gelukt: dit onderdeel bestaat niet meer.",
      };
    }
    console.error("Kon onderdeel niet bijwerken", error);
    return {
      status: "error",
      fieldErrors: {},
      formError: "Opslaan is niet gelukt. Probeer het opnieuw.",
    };
  }

  revalidatePath(PARTS_PATH);
  revalidatePath(`/onderdelen/${id}`);
  redirect(`/onderdelen/${id}?opgeslagen=bijgewerkt`);
}

// ---------------------------------------------------------------------------
// Archiveren
// ---------------------------------------------------------------------------

/**
 * Archiveert een onderdeel (soft delete via `archivedAt`, SPEC §3 regel 4). Nooit
 * hard verwijderen: de verkoophistorie (`Sale`) moet reconstrueerbaar blijven, ook na
 * archiveren. Na archiveren verdwijnt het onderdeel uit het overzicht
 * (`listParts` sluit `archivedAt` niet-null standaard uit) maar blijft de
 * detailpagina en verkoophistorie bereikbaar.
 */
export async function archivePartAction(
  id: string,
  prevState: ArchivePartFormState,
  formData: FormData,
): Promise<ArchivePartFormState> {
  // `prevState`/`formData` horen bij de `useActionState`-signatuur maar worden hier
  // niet gebruikt: archiveren heeft geen formuliervelden nodig, alleen het `id`.
  void prevState;
  void formData;

  try {
    await prisma.part.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      return { status: "error", message: "Dit onderdeel bestaat niet meer." };
    }
    console.error("Kon onderdeel niet archiveren", error);
    return {
      status: "error",
      message: "Archiveren is niet gelukt. Probeer het opnieuw.",
    };
  }

  revalidatePath(PARTS_PATH);
  revalidatePath(`/onderdelen/${id}`);
  redirect(`/onderdelen/${id}?opgeslagen=gearchiveerd`);
}
