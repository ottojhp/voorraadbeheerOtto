"use server";

/**
 * Server actions voor merkenbeheer (T09, SPEC §2: mutaties via server actions).
 *
 * Elke actie volgt hetzelfde patroon: Zod-validatie, dan een voorafgaande
 * businessregel-controle (duplicaatnaam / gekoppelde onderdelen) voor een snelle
 * nette melding, en tot slot de mutatie zelf met een `catch` op de bijbehorende
 * Prisma-foutcode als laatste vangnet voor een race tussen twee gelijktijdige
 * verzoeken. Bij succes wordt `/merken` gerevalideerd zodat het overzicht direct
 * klopt.
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { countPartsForBrand, findBrandByName } from "@/lib/queries/brands";
import {
  createBrandSchema,
  deleteBrandSchema,
  renameBrandSchema,
  evaluateBrandDeletion,
  isUniqueConstraintViolation,
  isRecordNotFoundError,
  DUPLICATE_BRAND_NAME_ERROR,
} from "@/lib/validation/brands";

import type { BrandActionState } from "./form-state";

const BRANDS_PATH = "/merken";

/** Haalt een string-veld uit FormData op; ontbrekende/foute waarden worden "". */
function readFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function createBrandAction(
  _prevState: BrandActionState,
  formData: FormData,
): Promise<BrandActionState> {
  const parsed = createBrandSchema.safeParse({
    name: readFormString(formData, "name"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      fieldErrors: { name: parsed.error.flatten().fieldErrors.name?.[0] },
    };
  }

  const { name } = parsed.data;

  // Voorafgaande controle: nette melding in het gangbare pad. Dekt de race met
  // een gelijktijdig verzoek NIET af — dat vangt de catch op P2002 hieronder.
  const existing = await findBrandByName(name);
  if (existing) {
    return {
      status: "error",
      fieldErrors: { name: DUPLICATE_BRAND_NAME_ERROR },
    };
  }

  try {
    await prisma.brand.create({ data: { name } });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return {
        status: "error",
        fieldErrors: { name: DUPLICATE_BRAND_NAME_ERROR },
      };
    }
    throw error;
  }

  revalidatePath(BRANDS_PATH);
  return { status: "success", message: `Merk "${name}" is toegevoegd.` };
}

export async function renameBrandAction(
  _prevState: BrandActionState,
  formData: FormData,
): Promise<BrandActionState> {
  const parsed = renameBrandSchema.safeParse({
    id: readFormString(formData, "id"),
    name: readFormString(formData, "name"),
  });

  if (!parsed.success) {
    const flattened = parsed.error.flatten().fieldErrors;
    return {
      status: "error",
      fieldErrors: { name: flattened.name?.[0] },
      message: flattened.id?.[0] ?? "Ongeldig merk.",
    };
  }

  const { id, name } = parsed.data;

  const existing = await findBrandByName(name);
  if (existing && existing.id !== id) {
    return {
      status: "error",
      fieldErrors: { name: DUPLICATE_BRAND_NAME_ERROR },
    };
  }

  try {
    await prisma.brand.update({ where: { id }, data: { name } });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return {
        status: "error",
        fieldErrors: { name: DUPLICATE_BRAND_NAME_ERROR },
      };
    }
    if (isRecordNotFoundError(error)) {
      return { status: "error", message: "Dit merk bestaat niet meer." };
    }
    throw error;
  }

  revalidatePath(BRANDS_PATH);
  return { status: "success", message: `Merk hernoemd naar "${name}".` };
}

export async function deleteBrandAction(
  _prevState: BrandActionState,
  formData: FormData,
): Promise<BrandActionState> {
  const parsed = deleteBrandSchema.safeParse({
    id: readFormString(formData, "id"),
  });

  if (!parsed.success) {
    return { status: "error", message: "Ongeldig merk." };
  }

  const { id } = parsed.data;

  // Server-side controle (verplicht, niet alleen in de UI): het schema staat
  // onDelete: SetNull toe op Part.brand, dus de database zou het verwijderen
  // gewoon toestaan. De applicatie blokkeert het zelf zolang er onderdelen
  // gekoppeld zijn — ook gearchiveerde (vandaar `total`, niet `active`).
  const { total } = await countPartsForBrand(id);
  const check = evaluateBrandDeletion(total);
  if (!check.allowed) {
    return { status: "error", message: check.message };
  }

  try {
    await prisma.brand.delete({ where: { id } });
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      return { status: "error", message: "Dit merk bestaat niet meer." };
    }
    throw error;
  }

  revalidatePath(BRANDS_PATH);
  return { status: "success", message: "Merk is verwijderd." };
}
