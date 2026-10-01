/**
 * Types en PURE hulpfuncties voor de snelle voorraadknoppen (T19).
 *
 * Dit bestand heeft met opzet géén `"use server"` en géén `"use client"`:
 *
 * - een `"use server"`-bestand mag in Next.js 15 alleen async functies exporteren,
 *   dus de resultaattypes en de beginwaarden kunnen niet in `stock-actions.ts` staan;
 * - een `"use client"`-bestand mag alleen componenten en types exporteren. Exporteert
 *   het óók gewone functies en roept een server component die aan, dan crasht die
 *   pagina bij élk bezoek zonder dat de build, `tsc` of de tests iets merken (die
 *   fout is in dit project al eerder gemaakt, zie de FIX-notitie van 2026-09-22 in
 *   `docs/PROGRESS.md`). Daarom staan de pure functies hier.
 *
 * Alles hieronder is puur: geen database, geen React, geen DOM. Daardoor is het
 * zonder browser te testen (`src/lib/__tests__/stock-ui.test.ts`), en dat is juist
 * voor de optimistische rekenregels belangrijk — "twee keer tikken is +2" is een
 * rekenregel, geen kwestie van styling.
 */

import {
  STOCK_MUTATION_REASON_LABELS,
  type ManualStockReason,
} from "@/lib/labels";
import type {
  StockAdjustmentErrorCode,
  StockAdjustmentResultDTO,
} from "@/lib/queries/types";
import type { StockAdjustmentInput } from "@/lib/validation/stock";

// ---------------------------------------------------------------------------
// Resultaat van de server action
// ---------------------------------------------------------------------------

/**
 * Wat `adjustStockAction()` teruggeeft. De action gooit NOOIT: een afgewezen
 * wijziging is een normale uitkomst (de voorraad kan niet onder 0, of iemand anders
 * was sneller) en moet als Nederlandse melding bij de knop belanden, niet als een
 * foutpagina (SPEC §F8: geen stille mislukkingen, maar ook geen hele pagina stuk).
 */
export type StockActionResult =
  | { ok: true; result: StockAdjustmentResultDTO }
  | {
      ok: false;
      /** `"UNKNOWN"` voor een onverwachte fout; de rest komt uit de datalaag. */
      code: StockAdjustmentErrorCode | "UNKNOWN";
      message: string;
    };

// ---------------------------------------------------------------------------
// Optimistische stand
// ---------------------------------------------------------------------------

/**
 * Eén nog niet bevestigde wijziging, zoals `useOptimistic` die in de wachtrij houdt.
 * `id` maakt elke tik uniek, zodat twee snelle tikken op **+** twee aparte
 * wijzigingen zijn en niet per ongeluk als dezelfde worden gezien.
 */
export interface PendingStockChange {
  id: number;
  delta: number;
}

/**
 * Reducer voor `useOptimistic`: telt één nog niet bevestigde wijziging bij de stand
 * op. React past alle wijzigingen in de wachtrij ná elkaar toe op de serverwaarde,
 * dus twee keer snel **+** geeft `stand + 1 + 1` = **+2**. Precies dáárom is dit een
 * optelling en niet "zet op de waarde die ik net zag": dat laatste zou bij twee
 * overlappende tikken één tik verliezen.
 *
 * De uitkomst wordt afgekapt op 0: de voorraad kan nooit negatief zijn (SPEC §3
 * regel 6), dus ook niet even optimistisch op het scherm. De server weigert zo'n
 * verlaging alsnog en dan springt de stand terug.
 */
export function applyPendingStockChange(
  current: number,
  change: PendingStockChange,
): number {
  return Math.max(0, current + change.delta);
}

// ---------------------------------------------------------------------------
// Teksten
// ---------------------------------------------------------------------------

/** "1 stuk" / "3 stuks". */
export function stuksLabel(count: number): string {
  return `${count} ${count === 1 ? "stuk" : "stuks"}`;
}

/**
 * De korte bevestiging onder de knoppen, bv.:
 * "Levering bijgeboekt: 12 → 22 stuks." of "Correctie: 12 → 11 stuks."
 *
 * Noemt altijd zowel de oude als de nieuwe stand: de garagehouder ziet in de
 * werkplaats alleen een getal veranderen en moet kunnen controleren dat zijn tik
 * precies één keer is aangekomen.
 */
export function describeStockChange(result: StockAdjustmentResultDTO): string {
  if (!result.changed) {
    return `De voorraad stond al op ${stuksLabel(result.quantityAfter)}; er is niets gewijzigd.`;
  }

  const reasonLabel = result.reason
    ? STOCK_MUTATION_REASON_LABELS[result.reason]
    : "Wijziging";
  const verb = result.delta > 0 ? "bijgeboekt" : "afgeboekt";
  const amount = stuksLabel(Math.abs(result.delta));

  return `${reasonLabel}: ${amount} ${verb}. Voorraad ${result.quantityBefore} → ${result.quantityAfter}.`;
}

/**
 * De toelichting die in het grootboek komt bij het ongedaan maken. Verwijst naar de
 * mutatie die teruggedraaid wordt, zodat de twee regels later aan elkaar te knopen
 * zijn — de oorspronkelijke regel blijft gewoon staan.
 */
export function buildUndoNote(result: StockAdjustmentResultDTO): string {
  const reasonLabel = result.reason
    ? STOCK_MUTATION_REASON_LABELS[result.reason].toLowerCase()
    : "wijziging";
  const sign = result.delta > 0 ? "+" : "";
  return `Ongedaan gemaakt: ${reasonLabel} van ${sign}${result.delta} stuks${
    result.mutationId ? ` (mutatie ${result.mutationId})` : ""
  }.`;
}

// ---------------------------------------------------------------------------
// Ongedaan maken
// ---------------------------------------------------------------------------

/**
 * Bouwt de invoer voor het ongedaan maken van een geslaagde wijziging: een NIEUWE,
 * tegengestelde, RELATIEVE mutatie met reden `CORRECTION`.
 *
 * Twee keuzes die hier bindend zijn:
 *
 *  1. er wordt nooit een bestaande regel gewist of bijgewerkt — een grootboek waarin
 *     regels verdwijnen is geen grootboek (SPEC §4);
 *  2. de tegenboeking is RELATIEF (`-delta`) en niet "zet terug op de oude stand".
 *     Verkocht iemand tussendoor twee stuks, dan zou terugzetten op de oude stand die
 *     verkoop stilletjes wegpoetsen.
 *
 * De reden is altijd `CORRECTION`: het terugdraaien van een levering is geen
 * levering en het terugdraaien van een telling is geen telling.
 *
 * Geeft `null` als er niets te herstellen is (`changed: false`).
 */
export function buildUndoInput(
  result: StockAdjustmentResultDTO,
): Extract<StockAdjustmentInput, { mode: "relative" }> | null {
  if (!result.changed || result.delta === 0) {
    return null;
  }
  return {
    mode: "relative",
    partId: result.partId,
    delta: -result.delta,
    reason: "CORRECTION" satisfies ManualStockReason,
    note: buildUndoNote(result),
  };
}
