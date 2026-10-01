"use server";

/**
 * Server actions voor het scanscherm (T20, SPEC §F4).
 *
 * Het scanscherm is een client component: de camera, de barcodedetectie en
 * Tesseract draaien in de browser. De database mag het daarom niet rechtstreeks
 * aanraken (SPEC §3 regel 1 en §2) — deze module is de brug.
 *
 * Twee dingen die deze actions met opzet NIET doen:
 *
 *  1. **niets wijzigen.** Opzoeken is lezen. Het aanpassen van de voorraad loopt
 *     daarna via `adjustStockAction()` uit T19, nadat de gebruiker een kandidaat
 *     bevestigd heeft. Een scan die zelf al zou bijboeken is precies wat T20
 *     verbiedt: OCR op een bedrukte verpakking is niet betrouwbaar genoeg om er
 *     zonder tussenkomst voorraad op te veranderen.
 *  2. **nooit gooien.** "Geen onderdeel gevonden" is de normale uitkomst van een
 *     scan op een slecht bedrukt pakje. Dat komt als `{ ok: true, matches: [] }`
 *     terug; een échte fout (database onbereikbaar) als `{ ok: false, message }`,
 *     zodat de melding in het scanscherm staat en de camera gewoon open blijft
 *     (SPEC §F8: geen stille mislukkingen, maar ook geen foutpagina).
 */

import {
  findPartsByScannedText,
  getPartForScanById,
  MAX_SCAN_MATCHES,
} from "@/lib/queries/parts";
import type { PartScanDTO } from "@/lib/queries/types";
import { scanLookupSchema } from "@/lib/validation/scan";

import type { ScanLookupResult } from "./scan-state";

/**
 * Zoekt het onderdeel dat bij een gescande code of gelezen tekst hoort.
 *
 * De invoer gaat eerst door het Zod-schema (SPEC §3 regel 7). Mislukt dat, dan komt
 * de Nederlandse melding uit het schema terug samen met de tekst zoals hij binnenkwam
 * — die moet de gebruiker kunnen zien en verbeteren, ook als hij ongeldig was.
 */
export async function lookupScannedTextAction(input: {
  text: string;
  source: "barcode" | "ocr" | "manual";
}): Promise<ScanLookupResult> {
  // Wat er ook binnenkomt: de gebruiker krijgt zijn eigen tekst terug te zien.
  const rawText = typeof input?.text === "string" ? input.text : "";

  const parsed = scanLookupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      recognizedText: rawText,
      message:
        parsed.error.issues[0]?.message ??
        "De gescande tekst kon niet verwerkt worden.",
    };
  }

  const { text, source } = parsed.data;

  try {
    const matches = await findPartsByScannedText(text, source, MAX_SCAN_MATCHES);
    return { ok: true, recognizedText: text, source, matches };
  } catch (error) {
    console.error("Kon gescande code niet opzoeken", error);
    return {
      ok: false,
      recognizedText: text,
      message:
        "Het opzoeken is niet gelukt. Probeer het opnieuw of zoek het onderdeel handmatig op in de voorraad.",
    };
  }
}

/**
 * Haalt één onderdeel opnieuw op met een VERSE voorraadstand.
 *
 * Nodig omdat het scanscherm een client component is: na het bijboeken ververst
 * `revalidatePath` in `adjustStockAction` de serverpagina's, maar niet de stand die
 * dit scherm in zijn eigen state heeft. Bij het openen van het
 * snel-aanpassen-scherm wordt de stand daarom hier nog één keer opgehaald — tussen
 * het scannen en het bevestigen kan de balie er alweer twee verkocht hebben.
 *
 * Geeft `null` voor een onbekend of inmiddels gearchiveerd onderdeel.
 */
export async function getScannedPartAction(
  partId: string,
): Promise<PartScanDTO | null> {
  if (typeof partId !== "string" || partId.trim().length === 0) {
    return null;
  }

  try {
    return await getPartForScanById(partId.trim());
  } catch (error) {
    console.error("Kon onderdeel na scan niet opnieuw ophalen", error);
    return null;
  }
}
