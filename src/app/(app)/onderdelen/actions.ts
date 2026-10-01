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
 *
 * **Voorraadgrootboek (SPEC §4, T22).** Elke voorraadwijziging die hier gebeurt
 * schrijft een `StockMutation`, in DEZELFDE transactie als de wijziging zelf: een
 * beginvoorraad > 0 bij het aanmaken wordt een `INITIAL`-regel, een gewijzigde
 * voorraad op het bewerkformulier een `CORRECTION`-regel met de oude en de nieuwe
 * stand. Verandert de voorraad niet, dan komt er geen regel (`delta` mag niet 0 zijn,
 * de database weigert dat met een CHECK). Faalt het schrijven van de regel, dan
 * draait de hele transactie terug — er bestaat dus nooit een voorraadwijziging zonder
 * grootboekregel.
 */

import { StockMutationReason } from "@prisma/client";
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

/** Leest alle vijftien formuliervelden uit `FormData` als platte strings. */
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
    purchasePriceExcl: field("purchasePriceExcl"),
    // De incl./excl.-keuze bij de inkoopprijs (T18). Het schema rekent zelf terug
    // naar excl. als hier "incl" staat, dus deze action hoeft daar niets mee.
    purchasePriceVatMode: field("purchasePriceVatMode"),
    salePriceIncl: field("salePriceIncl"),
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
    createdId = await prisma.$transaction(async (tx) => {
      const created = await tx.part.create({
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
          purchasePriceExcl: data.purchasePriceExcl,
          salePriceIncl: data.salePriceIncl,
          vatRate: data.vatRate,
          stockQuantity: data.stockQuantity,
          minStock: data.minStock,
        },
        select: { id: true, stockQuantity: true },
      });

      // Beginvoorraad > 0 opent het grootboek van dit onderdeel (SPEC §4). Bij 0
      // stuks is er niets veranderd en mag er ook geen regel komen: `delta` mag niet
      // 0 zijn.
      if (created.stockQuantity > 0) {
        await tx.stockMutation.create({
          data: {
            partId: created.id,
            delta: created.stockQuantity,
            quantityBefore: 0,
            quantityAfter: created.stockQuantity,
            reason: StockMutationReason.INITIAL,
            note: "Beginvoorraad bij het aanmaken van het onderdeel.",
          },
          select: { id: true },
        });
      }

      return created.id;
    });
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
    await prisma.$transaction(async (tx) => {
      // De stand vóór het opslaan, binnen de transactie gelezen. Het bewerkformulier
      // zet de voorraad op een ABSOLUUT getal dat de gebruiker heeft ingetypt — het
      // is een correctie, geen relatieve mutatie — dus de oude stand moet hier wel
      // gelezen worden. Niet gevonden betekent: onderdeel bestaat niet meer; dan
      // laat de `update` hieronder dat met P2025 weten.
      const before = await tx.part.findUnique({
        where: { id },
        select: { stockQuantity: true },
      });

      const updated = await tx.part.update({
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
          purchasePriceExcl: data.purchasePriceExcl,
          salePriceIncl: data.salePriceIncl,
          vatRate: data.vatRate,
          stockQuantity: data.stockQuantity,
          minStock: data.minStock,
        },
        select: { id: true, stockQuantity: true },
      });

      // Alleen een echte voorraadwijziging krijgt een grootboekregel (SPEC §4).
      // Wijzigt de gebruiker alleen een prijs of de locatie, dan verandert de
      // voorraad niet en komt er niets in het grootboek.
      if (before && before.stockQuantity !== updated.stockQuantity) {
        await tx.stockMutation.create({
          data: {
            partId: updated.id,
            delta: updated.stockQuantity - before.stockQuantity,
            quantityBefore: before.stockQuantity,
            quantityAfter: updated.stockQuantity,
            reason: StockMutationReason.CORRECTION,
            note: `Voorraad handmatig gewijzigd van ${before.stockQuantity} naar ${updated.stockQuantity} op het bewerkformulier.`,
          },
          select: { id: true },
        });
      }
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
