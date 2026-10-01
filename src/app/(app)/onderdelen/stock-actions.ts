"use server";

/**
 * Server action voor de snelle voorraadknoppen (T19, SPEC §F2/§F3/§F8).
 *
 * Mutaties lopen via een server action, niet via een REST-route (SPEC §2). De action
 * doet zelf geen businesslogica: valideren, de ondergrens van 0, de race tussen twee
 * telefoons en de transactie met de grootboekregel zitten in `adjustStock()`
 * (`@/lib/queries/stock`). Hier wordt alleen de fout vertaald naar iets dat de knop
 * kan tonen, en worden de betrokken pagina's opnieuw opgehaald.
 *
 * ### Waarom deze action een object aanneemt en geen `FormData`
 * De knoppen zijn geen formulier: de −/+ knoppen worden rechtstreeks vanuit een
 * `startTransition` aangeroepen zodat `useOptimistic` zijn werk kan doen. De panelen
 * "bijboeken" en "exact instellen" zijn wél een `<form>`, maar die leest zijn eigen
 * `FormData` in de client en geeft hier een getypeerd object door — zo is er één
 * ingang en één validatieschema voor alle vier de knoppen.
 *
 * ### Waarom hij nooit gooit
 * Een geweigerde wijziging (de voorraad kan niet onder 0, of iemand anders was net
 * sneller) is een NORMALE uitkomst in de werkplaats, geen crash. Hij komt daarom als
 * `{ ok: false, message }` terug, zodat de melding bij de knop staat en de rest van
 * de pagina blijft werken (SPEC §F8: geen stille mislukkingen — maar ook geen
 * foutpagina voor iets wat de gebruiker zelf kan oplossen).
 */

import { revalidatePath } from "next/cache";

import { adjustStock, isStockAdjustmentError } from "@/lib/queries/stock";
import type { StockAdjustmentInput } from "@/lib/validation/stock";

import type { StockActionResult } from "./stock-state";

/**
 * Past de voorraad van één onderdeel aan en schrijft de grootboekregel (in één
 * transactie, in de datalaag).
 *
 * Na een geslaagde wijziging worden álle pagina's die een voorraadstand tonen
 * opnieuw opgehaald:
 *
 * - `/` — het dashboard telt "onder minimumvoorraad" en de voorraadwaarde;
 * - `/onderdelen` — het overzicht met dezelfde knoppen op elke rij en kaart;
 * - `/onderdelen/[id]` — de detailpagina van dit onderdeel;
 * - `/verkoop` — het verkoopscherm toont de voorraad bij het gekozen onderdeel.
 *
 * Dat deze `revalidatePath`-aanroepen in dezelfde response zitten is ook wat de
 * optimistische UI laat "landen": React houdt de optimistische stand vast tot de
 * transitie klaar is, en de verse serverwaarde komt met het antwoord van deze action
 * mee. Zonder revalidatie zou de stand na de bevestiging terugspringen naar de oude
 * waarde.
 */
export async function adjustStockAction(
  input: StockAdjustmentInput,
): Promise<StockActionResult> {
  try {
    const result = await adjustStock(input);

    if (result.changed) {
      revalidatePath("/");
      revalidatePath("/onderdelen");
      revalidatePath(`/onderdelen/${result.partId}`);
      revalidatePath("/verkoop");
    }

    return { ok: true, result };
  } catch (error) {
    if (isStockAdjustmentError(error)) {
      return { ok: false, code: error.code, message: error.message };
    }

    console.error("Kon voorraad niet aanpassen", error);
    return {
      ok: false,
      code: "UNKNOWN",
      message:
        "Aanpassen is niet gelukt. Er is niets gewijzigd aan de voorraad. Probeer het opnieuw.",
    };
  }
}
