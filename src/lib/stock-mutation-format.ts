/**
 * Pure weergavehulpjes voor het voorraadgrootboek (T24). Geen React, geen database:
 * dit bestand wordt door server components én door Vitest gebruikt.
 */

import { formatDateTime } from "@/lib/datetime";

/** Het echte minteken (U+2212), zoals in de taakomschrijving: `+10` / `−1`. */
const MINUS = "−";

/** `+10` voor bijboeken, `−1` voor afboeken. Nul krijgt geen teken (komt niet voor). */
export function formatDelta(delta: number): string {
  if (delta > 0) {
    return `+${delta}`;
  }
  if (delta < 0) {
    return `${MINUS}${Math.abs(delta)}`;
  }
  return "0";
}

/** Voor schermlezers: "plus 10 stuks" of "min 1 stuk". */
export function describeDelta(delta: number): string {
  const amount = Math.abs(delta);
  const unit = amount === 1 ? "stuk" : "stuks";
  return `${delta < 0 ? "min" : "plus"} ${amount} ${unit}`;
}

/**
 * Datum en tijd zoals de winkel ze beleeft, bv. `1 okt 2026, 14:05` (altijd
 * Europe/Amsterdam, zie `@/lib/datetime`). Bewaard als eigen naam voor de bestaande
 * aanroepers.
 */
export function formatMutationDateTime(iso: string): string {
  return formatDateTime(iso);
}
