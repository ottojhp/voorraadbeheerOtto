"use server";

/**
 * Server action voor het verkoopscherm (SPEC §F4, T12).
 *
 * Mutaties lopen via een server action, niet via een REST-route (SPEC §2). De action
 * doet zelf geen businesslogica: valideren, de voorraadcontrole en de transactie
 * zitten in `registerSale()` (`@/lib/queries/sales`). Hier wordt alleen `FormData`
 * gelezen, de fout vertaald naar iets dat het formulier kan tonen, en de betrokken
 * pagina's worden opnieuw opgehaald.
 */

import { revalidatePath } from "next/cache";

import {
  isSaleError,
  registerSale,
  type SaleErrorCode,
  type SaleResultDTO,
} from "@/lib/queries/sales";
import type { SaleFormFieldName } from "@/lib/validation/sales";

export interface SaleFormState {
  status: "idle" | "success" | "invalid" | "error";
  fieldErrors: Partial<Record<SaleFormFieldName, string>>;
  /** Melding boven het formulier (fout) — altijd Nederlands en toonbaar. */
  formError?: string;
  /** Onderscheidbare oorzaak, zodat de UI kan sturen zonder teksten te vergelijken. */
  errorCode?: SaleErrorCode;
  /** Alleen gevuld bij `status === "success"`; bevat de NIEUWE voorraadstand. */
  result?: SaleResultDTO;
}

// Let op: een `"use server"`-bestand mag alleen async functies exporteren. De
// beginwaarde van de formulierstatus staat daarom in `SaleScreen.tsx` en niet hier;
// `SaleFormState` mag wel, want types verdwijnen bij het compileren.

/**
 * Registreert een verkoop of werkplaatsverbruik.
 *
 * Over dubbele verzending: het formulier zet de bevestigknop meteen op `disabled` via
 * de pending-status van `useActionState`, maar dat is UI. De echte bescherming tegen
 * twee tegelijk binnenkomende verzoeken zit in de datalaag: de voorwaardelijke
 * voorraadupdate binnen de transactie weigert elke verkoop waarvoor geen voorraad
 * (meer) is, dus een tweede klik kan hooguit een tweede geldige verkoop worden — nooit
 * een negatieve voorraad of een halve verkoop.
 */
export async function registerSaleAction(
  _prevState: SaleFormState,
  formData: FormData,
): Promise<SaleFormState> {
  const partId = formData.get("partId")?.toString() ?? "";
  const quantity = formData.get("quantity")?.toString() ?? "";
  const channel = formData.get("channel")?.toString() ?? "";
  const reference = formData.get("reference")?.toString() ?? "";

  try {
    const { sale } = await registerSale({
      partId,
      quantity,
      // Onbekende waarden worden door het Zod-schema afgekeurd; hier bewust geen
      // cast naar het enum-type, zodat een geknutselde POST niet langs de validatie
      // glipt.
      channel: channel as "COUNTER" | "WORKSHOP",
      reference,
    });

    // Voorraad en verkoophistorie zijn gewijzigd: de schermen die daarop leunen
    // moeten hun servercache weggooien.
    revalidatePath("/verkoop");
    revalidatePath("/onderdelen");
    revalidatePath("/");

    return { status: "success", fieldErrors: {}, result: sale };
  } catch (error) {
    if (isSaleError(error)) {
      if (error.code === "INVALID_INPUT") {
        return {
          status: "invalid",
          fieldErrors: (error.fieldErrors ?? {}) as Partial<
            Record<SaleFormFieldName, string>
          >,
          errorCode: error.code,
          formError: error.message,
        };
      }

      return {
        status: "error",
        // Bij een voorraadprobleem hoort de melding óók bij het aantalveld, want
        // daar kan de gebruiker iets aan doen.
        fieldErrors:
          error.code === "INSUFFICIENT_STOCK"
            ? { quantity: `Maximaal ${error.availableStock ?? 0} beschikbaar` }
            : {},
        errorCode: error.code,
        formError: error.message,
      };
    }

    console.error("Kon verkoop niet registreren", error);
    return {
      status: "error",
      fieldErrors: {},
      formError:
        "Registreren is niet gelukt. Er is niets gewijzigd aan de voorraad. Probeer het opnieuw.",
    };
  }
}
