"use client";

/**
 * Aantalkiezer voor het verkoopscherm (SPEC §F4): plus/min-knoppen én handmatige
 * invoer, standaard 1, minimaal 1.
 *
 * Twee details die aan de balie uitmaken:
 * - de knoppen zijn 48×48px (ruim boven de 44px uit SPEC §3 regel 8) en staan links
 *   en rechts van het veld, zodat ze met één duim te raken zijn;
 * - het zichtbare invoerveld draagt géén `name`. Tijdens het typen mag het veld even
 *   leeg of ongeldig zijn; wat verzonden wordt is de laatst geldige waarde uit een
 *   verborgen veld. Zo kan een half getypt aantal nooit als "" of "1e3" op de server
 *   belanden.
 */

import { useEffect, useRef, useState } from "react";

export interface QuantityStepperProps {
  /** Laatst geldige waarde; dit is wat verzonden wordt. */
  value: number;
  onChange: (value: number) => void;
  /** Bovengrens (de huidige voorraad). Bij 0 staat alles uit. */
  max: number;
  /** Naam van het verborgen veld in het formulier. */
  name: string;
  /** Veldgebonden foutmelding van de server. */
  error?: string;
  disabled?: boolean;
}

const BUTTON_CLASSES =
  "flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-2xl font-semibold text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-not-allowed disabled:opacity-40";

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  const whole = Math.floor(value);
  if (whole < 1) {
    return 1;
  }
  if (max >= 1 && whole > max) {
    return max;
  }
  return whole;
}

export function QuantityStepper({
  value,
  onChange,
  max,
  name,
  error,
  disabled = false,
}: QuantityStepperProps) {
  const [text, setText] = useState(String(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Houdt het veld in de pas als de waarde van buitenaf wijzigt (plus/min-knop,
  // of een reset naar 1 na het kiezen van een ander onderdeel).
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const errorId = error ? `${name}-error` : undefined;

  const commit = (raw: string) => {
    setText(raw);
    const parsed = Number(raw.trim());
    if (raw.trim() === "" || Number.isNaN(parsed)) {
      // Nog niet geldig: de laatst geldige waarde blijft staan tot de gebruiker
      // klaar is met typen (zie `handleBlur`).
      return;
    }
    onChange(clamp(parsed, max));
  };

  const handleBlur = () => {
    setText(String(value));
  };

  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={`${name}-input`}
        className="text-sm font-medium text-gray-700"
      >
        Aantal
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={BUTTON_CLASSES}
          onClick={() => {
            onChange(clamp(value - 1, max));
            inputRef.current?.focus();
          }}
          disabled={disabled || value <= 1}
          aria-label="Aantal verlagen"
        >
          &minus;
        </button>

        <input
          ref={inputRef}
          id={`${name}-input`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          className={`h-12 w-24 rounded-md border px-3 text-center text-lg font-semibold text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:cursor-not-allowed disabled:bg-gray-100 ${
            error ? "border-red-500" : "border-gray-300"
          }`}
          value={text}
          onChange={(event) => commit(event.target.value)}
          onBlur={handleBlur}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
        />

        <button
          type="button"
          className={BUTTON_CLASSES}
          onClick={() => {
            onChange(clamp(value + 1, max));
            inputRef.current?.focus();
          }}
          disabled={disabled || (max >= 1 && value >= max)}
          aria-label="Aantal verhogen"
        >
          +
        </button>

        {/* Dit veld wordt verzonden: altijd een geldig geheel getal. */}
        <input type="hidden" name={name} value={value} />
      </div>
      {error && (
        <p id={errorId} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
