"use client";

/**
 * Snel voorraad aanpassen (T19, SPEC §F2/§F3/§F8).
 *
 * Eén component voor twee plekken, zodat de knoppen zich overal hetzelfde gedragen:
 *
 * - `variant="compact"` — op elke rij en elke kaart in `/onderdelen`: alleen − en +
 *   (±1), zodat de detailpagina niet nodig is om een stuk bij of af te boeken;
 * - `variant="full"` — op `/onderdelen/[id]`: dezelfde − en +, plus "bijboeken"
 *   (bv. een levering van 10 stuks) en "exact aantal instellen" (bv. na een telling).
 *
 * De garagehouder gebruikt dit op zijn telefoon in de werkplaats. Daarom:
 *
 * - elk raakvlak is 48×48px (SPEC §3 regel 8 vraagt minimaal 44×44px);
 * - − en + staan náást de stand, ver genoeg van elkaar om met één duim te raken
 *   zonder de verkeerde te treffen;
 * - de knoppen worden NIET uitgeschakeld terwijl een vorige wijziging nog onderweg
 *   is. Dat is bewust: twee keer snel tikken moet +2 opleveren en geen verloren tik.
 *   Zie de uitleg bij `submit()` hieronder.
 *
 * ### Optimistisch, maar nooit stil als het misgaat
 * De stand springt direct met `useOptimistic`. Komt de server met een weigering terug
 * (de voorraad kan niet onder 0, of iemand anders was net sneller), dan verdwijnt de
 * optimistische wijziging automatisch zodra de transitie klaar is — de stand springt
 * dus terug naar de echte waarde — en komt er een Nederlandse melding bij de knoppen
 * te staan (SPEC §F8).
 *
 * ### De redenkeuze is GEEN gecontroleerde radiogroep
 * Bij T18 liep een gecontroleerde `checked`-radiogroep binnen een
 * server-action-formulier na een validatiefout uit de pas met de verstuurde waarde:
 * het scherm toonde iets anders dan wat er verzonden werd. Daarom hier hetzelfde
 * patroon als in `PartForm`: één verborgen veld dat uit de React-state gevuld wordt,
 * met `type="button"`-knoppen (`aria-pressed`) ernaast. De verzonden waarde is per
 * constructie dezelfde als de ingedrukte knop, want beide komen uit één state.
 */

import { useEffect, useId, useOptimistic, useRef, useState, useTransition } from "react";

import {
  MANUAL_STOCK_REASON_OPTIONS,
  STOCK_MUTATION_REASON_LABELS,
  type ManualStockReason,
} from "@/lib/labels";
import type { StockAdjustmentResultDTO } from "@/lib/queries/types";
import type { StockAdjustmentInput } from "@/lib/validation/stock";

import { adjustStockAction } from "./stock-actions";
import {
  applyPendingStockChange,
  buildUndoInput,
  describeStockChange,
  type PendingStockChange,
  type StockActionResult,
} from "./stock-state";

// ---------------------------------------------------------------------------
// Vormgeving
// ---------------------------------------------------------------------------

/**
 * 48×48px raakvlak — ruim boven de 44px uit SPEC §3 regel 8, met werkhandschoenen
 * aan is dat geen overdaad. `select-none` voorkomt dat snel dubbeltikken de stand
 * selecteert in plaats van de knop te raken.
 */
const STEP_BUTTON_CLASSES =
  "flex h-12 w-12 shrink-0 select-none items-center justify-center rounded-md border border-gray-300 bg-white text-2xl font-semibold leading-none text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-40";

const PANEL_TOGGLE_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center whitespace-nowrap rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600";

const REASON_BUTTON_BASE =
  "flex min-h-[44px] flex-1 items-center justify-center rounded-md border px-2 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600";

const NUMBER_INPUT_CLASSES =
  "h-12 w-24 rounded-md border border-gray-300 px-3 text-center text-lg font-semibold text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600";

const SUBMIT_BUTTON_CLASSES =
  "inline-flex min-h-[48px] items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";

/**
 * Hoe lang de bevestiging met de "ongedaan maken"-knop blijft staan. Lang genoeg om
 * een misgetikte wijziging terug te draaien, kort genoeg om het overzicht met
 * tientallen rijen niet vol te laten lopen. Een foutmelding verdwijnt NIET
 * automatisch: die moet gelezen worden.
 */
const CONFIRMATION_TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Feedback =
  | { kind: "success"; result: Extract<StockActionResult, { ok: true }>["result"] }
  | { kind: "error"; message: string };

type OpenPanel = "none" | "add" | "set";

export interface StockStepperProps {
  partId: string;
  /** Voor de voorleesnaam van de knoppen: in een lijst staan er tientallen. */
  partName: string;
  /** De stand zoals de server die nu kent; dit is de basis voor de optimistische UI. */
  stockQuantity: number;
  minStock: number;
  variant?: "compact" | "full";
  /** Gearchiveerd onderdeel: wijzigen mag niet meer (SPEC §3 regel 4). */
  disabled?: boolean;
  className?: string;
  /**
   * Wordt aangeroepen met het resultaat van elke GESLAAGDE wijziging.
   *
   * Toegevoegd in T20 en alleen nodig als de omliggende pagina GEEN server component
   * is. Op `/onderdelen` en `/onderdelen/[id]` komt `stockQuantity` uit een verse
   * serverrender en zorgt de `revalidatePath` in `adjustStockAction` ervoor dat de
   * optimistische stand op de echte waarde landt. Het scanscherm houdt het onderdeel
   * in client-state: daar moet die state meebewegen, anders springt de stand na het
   * bijboeken terug naar de waarde van vóór de scan. Weglaten verandert niets aan
   * het bestaande gedrag.
   */
  onAdjusted?: (result: StockAdjustmentResultDTO) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StockStepper({
  partId,
  partName,
  stockQuantity,
  minStock,
  variant = "compact",
  disabled = false,
  className = "",
  onAdjusted,
}: StockStepperProps) {
  // Via een ref, zodat een aanroeper die bij elke render een nieuwe functie
  // doorgeeft niets herstart.
  const onAdjustedRef = useRef(onAdjusted);
  useEffect(() => {
    onAdjustedRef.current = onAdjusted;
  }, [onAdjusted]);

  const [optimisticStock, addPendingChange] = useOptimistic<
    number,
    PendingStockChange
  >(stockQuantity, applyPendingStockChange);

  const [, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel>("none");
  const [addReason, setAddReason] = useState<ManualStockReason>("DELIVERY");
  const [setReason, setSetReason] = useState<ManualStockReason>("COUNT");

  /**
   * Loopnummer voor de optimistische wijzigingen. Elke tik krijgt een eigen id,
   * zodat twee tikken binnen één seconde twee aparte wijzigingen in de wachtrij zijn
   * — en dus samen +2 — in plaats van één.
   */
  const changeCounter = useRef(0);

  const fieldId = useId();

  // De bevestiging verdwijnt na een tijdje van het scherm; een foutmelding blijft
  // staan tot de volgende actie.
  useEffect(() => {
    if (!feedback || feedback.kind !== "success") {
      return;
    }
    const timer = setTimeout(() => setFeedback(null), CONFIRMATION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  /**
   * Stuurt één wijziging naar de server en laat de stand meteen meespringen.
   *
   * `optimisticDelta` is wat de UI alvast mag tonen; `input` is wat de server krijgt.
   * Die twee zijn gescheiden omdat de server het laatste woord heeft: bij "exact
   * aantal instellen" rekent de server zelf het verschil uit tegen de stand in de
   * database, en bij ongeldige invoer (een leeg veld, "abc") is de optimistische
   * sprong 0 en komt er een validatiemelding terug.
   *
   * Waarom hier GEEN blokkade op "er loopt al een verzoek": elke wijziging gaat als
   * eigen transitie de deur uit, en `useOptimistic` stapelt de nog niet bevestigde
   * wijzigingen boven op de serverwaarde. Twee keer snel op + levert daardoor
   * `stand + 1 + 1` op het scherm. Dat het ook in de database +2 wordt, komt doordat
   * de datalaag relatief bijwerkt (`stockQuantity + delta`) in plaats van "zet op de
   * waarde die ik las" — zie `@/lib/queries/stock`.
   */
  function submit(input: StockAdjustmentInput, optimisticDelta: number) {
    startTransition(async () => {
      changeCounter.current += 1;
      addPendingChange({ id: changeCounter.current, delta: optimisticDelta });
      // De vorige bevestiging/melding hoort bij de vorige actie en gaat weg.
      setFeedback(null);

      const outcome = await adjustStockAction(input);

      if (outcome.ok) {
        setFeedback({ kind: "success", result: outcome.result });
        // Nog BINNEN de transitie: zo landt een nieuwe `stockQuantity` van de
        // aanroeper in dezelfde render waarin de optimistische wijziging vervalt,
        // en flikkert de stand niet even terug naar de oude waarde.
        onAdjustedRef.current?.(outcome.result);
      } else {
        setFeedback({ kind: "error", message: outcome.message });
      }
    });
  }

  /** De −/+ knoppen: ±1 met `CORRECTION` als impliciete reden (T19 criterium 2). */
  function step(delta: 1 | -1) {
    submit(
      {
        mode: "relative",
        partId,
        delta,
        reason: "CORRECTION",
        note:
          delta > 0
            ? "Eén stuk bijgeboekt met de +-knop."
            : "Eén stuk afgeboekt met de −-knop.",
      },
      delta,
    );
  }

  /** Ongedaan maken: een NIEUWE tegengestelde mutatie, nooit een regel wissen. */
  function undo(result: Extract<Feedback, { kind: "success" }>["result"]) {
    const input = buildUndoInput(result);
    if (!input) {
      return;
    }
    submit(input, -result.delta);
  }

  /** "Bijboeken": relatieve verhoging met een gekozen reden. */
  function handleAddSubmit(formData: FormData) {
    const amount = formData.get("amount")?.toString() ?? "";
    const reason = formData.get("reason")?.toString() ?? "";
    const parsed = Number(amount.trim());
    const optimisticDelta =
      amount.trim() !== "" && Number.isInteger(parsed) && parsed > 0 ? parsed : 0;

    setOpenPanel("none");
    submit(
      {
        mode: "relative",
        partId,
        // De ruwe waarde uit het formulier gaat mee; het Zod-schema accepteert een
        // string en geeft bij onzin een Nederlandse melding terug. Hier zelf
        // voorrekenen zou een tweede, afwijkende validatie opleveren.
        delta: amount,
        reason: reason as ManualStockReason,
        note: null,
      },
      optimisticDelta,
    );
  }

  /** "Exact aantal instellen": absolute stand met een gekozen reden. */
  function handleSetSubmit(formData: FormData) {
    const quantity = formData.get("quantity")?.toString() ?? "";
    const reason = formData.get("reason")?.toString() ?? "";
    const parsed = Number(quantity.trim());
    const optimisticDelta =
      quantity.trim() !== "" && Number.isInteger(parsed) && parsed >= 0
        ? parsed - optimisticStock
        : 0;

    setOpenPanel("none");
    submit(
      {
        mode: "absolute",
        partId,
        targetQuantity: quantity,
        reason: reason as ManualStockReason,
        note: null,
      },
      optimisticDelta,
    );
  }

  const isLow = minStock > 0 && optimisticStock <= minStock;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* `flex-wrap` alleen in de volledige variant: op 375px past de stepper daar
          niet naast "Bijboeken" en "Exact aantal instellen", en dan horen die twee
          op een eigen regel in plaats van hun tekst af te breken. In de compacte
          variant (een tabelcel of een kaart) zou wrappen de knoppen juist ónder
          elkaar duwen, en dan staat − niet meer naast +. */}
      <div
        className={`flex items-center gap-3 ${
          variant === "full" ? "flex-wrap" : "w-max"
        }`}
      >
        <button
          type="button"
          className={STEP_BUTTON_CLASSES}
          onClick={() => step(-1)}
          // Hulp voor de gebruiker, geen beveiliging: de echte ondergrens van 0 staat
          // server-side in de transactie (SPEC §3 regel 6).
          disabled={disabled || optimisticStock <= 0}
          aria-label={`Eén stuk eraf bij ${partName}`}
        >
          &minus;
        </button>

        <span
          className={`min-w-[3rem] text-center text-xl font-semibold tabular-nums ${
            isLow ? "text-amber-700" : "text-gray-900"
          }`}
          aria-live="polite"
          aria-label={`Voorraad ${partName}: ${optimisticStock} stuks`}
          data-testid="stock-value"
        >
          {optimisticStock}
        </span>

        <button
          type="button"
          className={STEP_BUTTON_CLASSES}
          onClick={() => step(1)}
          disabled={disabled}
          aria-label={`Eén stuk erbij bij ${partName}`}
        >
          +
        </button>

        {variant === "full" && !disabled && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={PANEL_TOGGLE_CLASSES}
              aria-expanded={openPanel === "add"}
              onClick={() => setOpenPanel(openPanel === "add" ? "none" : "add")}
            >
              Bijboeken
            </button>
            <button
              type="button"
              className={PANEL_TOGGLE_CLASSES}
              aria-expanded={openPanel === "set"}
              onClick={() => setOpenPanel(openPanel === "set" ? "none" : "set")}
            >
              Exact aantal instellen
            </button>
          </div>
        )}
      </div>

      {variant === "full" && openPanel === "add" && (
        <form
          action={handleAddSubmit}
          className="flex flex-col gap-3 rounded-md border border-gray-200 bg-gray-50 p-3"
        >
          {/* Eén verborgen veld uit de React-state; zie de uitleg bovenaan. */}
          <input type="hidden" name="reason" value={addReason} />
          <ReasonPicker
            legend="Reden van de bijboeking"
            value={addReason}
            onChange={setAddReason}
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${fieldId}-amount`}
                className="text-sm font-medium text-gray-700"
              >
                Aantal erbij
              </label>
              <input
                id={`${fieldId}-amount`}
                name="amount"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                defaultValue="10"
                className={NUMBER_INPUT_CLASSES}
              />
            </div>
            <button type="submit" className={SUBMIT_BUTTON_CLASSES}>
              Bijboeken
            </button>
          </div>
        </form>
      )}

      {variant === "full" && openPanel === "set" && (
        <form
          action={handleSetSubmit}
          className="flex flex-col gap-3 rounded-md border border-gray-200 bg-gray-50 p-3"
        >
          <input type="hidden" name="reason" value={setReason} />
          <ReasonPicker
            legend="Reden van het instellen"
            value={setReason}
            onChange={setSetReason}
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`${fieldId}-quantity`}
                className="text-sm font-medium text-gray-700"
              >
                Nieuwe voorraad
              </label>
              <input
                id={`${fieldId}-quantity`}
                name="quantity"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                defaultValue={String(stockQuantity)}
                className={NUMBER_INPUT_CLASSES}
              />
            </div>
            <button type="submit" className={SUBMIT_BUTTON_CLASSES}>
              Instellen
            </button>
          </div>
          <p className="text-xs text-gray-600">
            De voorraad wordt op dit aantal gezet; het verschil komt als één regel in
            het voorraadgrootboek.
          </p>
        </form>
      )}

      {feedback?.kind === "success" && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900"
        >
          <span>{describeStockChange(feedback.result)}</span>
          {feedback.result.changed && (
            <button
              type="button"
              onClick={() => undo(feedback.result)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-green-300 bg-white px-3 py-1 text-sm font-medium text-green-900 transition-colors hover:bg-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-700"
            >
              Ongedaan maken
            </button>
          )}
        </div>
      )}

      {feedback?.kind === "error" && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Redenkeuze
// ---------------------------------------------------------------------------

interface ReasonPickerProps {
  legend: string;
  value: ManualStockReason;
  onChange: (reason: ManualStockReason) => void;
}

/**
 * Levering / correctie / telling als drie `type="button"`-knoppen met
 * `aria-pressed`. Géén radiogroep: zie de uitleg bovenaan dit bestand. De gekozen
 * waarde gaat via het verborgen veld van het omliggende formulier mee.
 */
function ReasonPicker({ legend, value, onChange }: ReasonPickerProps) {
  return (
    <div role="group" aria-label={legend} className="flex flex-col gap-1">
      <span className="text-sm font-medium text-gray-700">{legend}</span>
      <div className="flex gap-2">
        {MANUAL_STOCK_REASON_OPTIONS.map((reason) => {
          const active = value === reason;
          return (
            <button
              key={reason}
              // `type="button"`: deze knoppen mogen het formulier NOOIT verzenden,
              // ze zetten alleen de keuze.
              type="button"
              aria-pressed={active}
              onClick={() => onChange(reason)}
              className={`${REASON_BUTTON_BASE} ${
                active
                  ? "border-blue-600 bg-blue-50 text-blue-800"
                  : "border-gray-300 bg-white text-gray-700"
              }`}
            >
              {STOCK_MUTATION_REASON_LABELS[reason]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
