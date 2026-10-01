/**
 * Types en PURE hulpfuncties voor het scanscherm (T20).
 *
 * Net als `./stock-state` heeft dit bestand met opzet géén `"use server"` en géén
 * `"use client"`:
 *
 * - een `"use server"`-bestand mag alleen async functies exporteren, dus de
 *   resultaattypes kunnen niet in `scan-actions.ts` staan;
 * - een `"use client"`-bestand mag alleen componenten en types exporteren.
 *
 * Alles hieronder is puur: geen database, geen React, geen DOM, geen camera.
 */

import type { PartScanMatchDTO, ScanSource } from "@/lib/queries/types";

// ---------------------------------------------------------------------------
// Resultaat van de server action
// ---------------------------------------------------------------------------

/**
 * Wat `lookupScannedTextAction()` teruggeeft. De action gooit NOOIT: "niets
 * gevonden" is de normale uitkomst van een scan op een verpakking en hoort als
 * melding in het scanscherm te belanden, niet als foutpagina (SPEC §F8).
 *
 * `recognizedText` komt altijd terug, ook bij `ok: false` en bij nul treffers: de
 * gebruiker moet kunnen zien WAT de camera meende te lezen om het te kunnen
 * verbeteren (T20 criterium 7).
 */
export type ScanLookupResult =
  | {
      ok: true;
      recognizedText: string;
      source: ScanSource;
      matches: PartScanMatchDTO[];
    }
  | {
      ok: false;
      recognizedText: string;
      message: string;
    };

// ---------------------------------------------------------------------------
// Teksten
// ---------------------------------------------------------------------------

/** Nederlandse naam van het veld waarop de treffer zat. */
export const SCAN_FIELD_LABELS: Record<PartScanMatchDTO["field"], string> = {
  barcode: "barcode",
  sku: "artikelcode",
  supplierArticleNumber: "leveranciersnummer",
};

/**
 * Hoe hard het bewijs is, in woorden die aan de balie iets zeggen. Dit staat bij
 * elke kandidaat op het scherm, want het verschil tussen "dit is letterlijk dezelfde
 * barcode" en "dit lijkt erop als je O en 0 door elkaar haalt" bepaalt of je nog
 * even naar de verpakking kijkt voordat je bevestigt.
 */
export const SCAN_KIND_LABELS: Record<PartScanMatchDTO["kind"], string> = {
  exact: "exacte treffer",
  normalized: "treffer na verbeteren van verwisselbare tekens",
  contained: "zwakke treffer: het nummer komt voor in de gelezen tekst",
  approximate: "treffer na correctie van losse tekens",
};

/** Of deze treffer zonder meer te vertrouwen is. Bepaalt de kleur van de kaart. */
export function isStrongMatch(match: PartScanMatchDTO): boolean {
  return match.kind === "exact";
}

/**
 * Hoe zeker deze treffer is, in woorden (T25).
 *
 * Bij een benaderende treffer staat het AANTAL gecorrigeerde tekens erin, want dat
 * is het verschil dat aan de balie iets zegt: één teken gecorrigeerd op een nummer
 * van twaalf is iets anders dan twee tekens op een nummer van zes. De vaste tekst
 * uit {@link SCAN_KIND_LABELS} blijft de terugval voor het geval het getal
 * ontbreekt (een oud resultaat, of een treffer die niet uit stap 4 komt).
 */
export function describeScanCertainty(match: PartScanMatchDTO): string {
  if (match.kind !== "approximate") {
    return SCAN_KIND_LABELS[match.kind];
  }
  const corrected = match.distance ?? 0;
  if (corrected <= 0) {
    return SCAN_KIND_LABELS.approximate;
  }
  return corrected === 1
    ? "treffer na correctie van 1 teken"
    : `treffer na correctie van ${corrected} tekens`;
}

/** "barcode 8712345000019 — exacte treffer" */
export function describeScanMatch(match: PartScanMatchDTO): string {
  return `${SCAN_FIELD_LABELS[match.field]} ${match.value} — ${describeScanCertainty(
    match,
  )}`;
}

/** Hoe de tekst gelezen is, voor de regel boven de kandidaten. */
export const SCAN_SOURCE_LABELS: Record<ScanSource, string> = {
  barcode: "Gelezen van de barcode",
  ocr: "Gelezen met tekstherkenning",
  manual: "Zelf ingevoerd",
};

/**
 * De kopregel boven het resultaat. Noemt het aantal kandidaten, want "1 kandidaat"
 * en "4 kandidaten" vragen om een ander soort aandacht.
 */
export function describeScanOutcome(matchCount: number): string {
  if (matchCount === 0) {
    return "Geen onderdeel gevonden";
  }
  if (matchCount === 1) {
    return "Eén onderdeel gevonden";
  }
  return `${matchCount} mogelijke onderdelen gevonden`;
}
