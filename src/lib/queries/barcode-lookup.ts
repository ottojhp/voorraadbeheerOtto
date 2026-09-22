"use server";

/**
 * Server action voor de "vriendelijke" dubbele-barcodecontrole in het
 * onderdeelformulier (T11, SPEC §F3: "Duplicate sku of barcode geeft een veldgebonden
 * foutmelding, geen 500"). `PartForm`/`BarcodeField` zijn client components en mogen
 * `@/lib/db` niet rechtstreeks importeren; deze losse "use server"-module is de brug.
 *
 * Dit is bewust NIET hetzelfde als `findPartByBarcode` in `@/lib/queries/parts.ts`:
 * die sluit gearchiveerde onderdelen uit (voor het verkoopscherm, T12), terwijl de
 * unique constraint op `Part.barcode` (schema.prisma) ook voor gearchiveerde
 * onderdelen geldt. Een barcode die aan een gearchiveerd onderdeel hangt zou dus nog
 * steeds een P2002 geven bij opslaan — die controle willen we hier juist wél maken.
 *
 * De beslissing "is dit een conflict" gebeurt hier op de server (rechtstreekse
 * Prisma-query); de client krijgt alleen het resultaat terug en mag het niet zelf
 * bepalen. De bestaande P2002-afhandeling in `actions.ts` blijft het laatste
 * vangnet — deze functie verandert daar niets aan.
 */

import { prisma } from "@/lib/db";

/** Minimale gegevens van het onderdeel waaraan een barcode al hangt. */
export interface BarcodeConflict {
  id: string;
  name: string;
}

/**
 * Zoekt een ANDER onderdeel met deze barcode.
 *
 * - Lege of ontbrekende barcode → `null` (niets om op te controleren).
 * - `excludePartId` sluit het onderdeel dat je zelf aan het bewerken bent uit, zodat
 *   de eigen barcode nooit als conflict met zichzelf telt (de valkuil van deze taak).
 * - Bewust géén `archivedAt`-filter: zie de moduledoc hierboven.
 */
export async function findBarcodeConflict(
  barcode: string | null | undefined,
  excludePartId?: string | null,
): Promise<BarcodeConflict | null> {
  const value = barcode?.trim();
  if (!value) {
    return null;
  }

  const part = await prisma.part.findFirst({
    where: {
      barcode: value,
      ...(excludePartId ? { id: { not: excludePartId } } : {}),
    },
    select: { id: true, name: true },
  });

  return part;
}
