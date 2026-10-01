"use client";

/**
 * Barcodeveld van het onderdeelformulier, afgesplitst van `PartForm` (T11, SPEC §F3:
 * "Barcode: handmatig invoeren óf scannen met de camera"). Combineert:
 * - een gewoon tekstveld (handmatige invoer blijft altijd werken, ook zonder camera),
 * - een "Scan barcode"-knop die `BarcodeScanner` (T10) opent,
 * - de "vriendelijke" dubbele-barcodecontrole: na een korte stilte na typen/scannen
 *   wordt server-side (`findBarcodeConflict`) gecontroleerd of de barcode al aan een
 *   ANDER onderdeel hangt. Zo ja, dan verschijnt een waarschuwing met een link naar
 *   dat onderdeel en meldt dit veld dat via `onConflictChange` aan `PartForm`, dat
 *   daarmee de opslaanknop blokkeert.
 *
 * De echte, harde controle blijft server-side in `actions.ts` (Prisma's P2002) — deze
 * component beslist niets zelf, hij toont alleen het resultaat van de serverfunctie.
 *
 * Faalt die servercontrole zelf (netwerk weg, database even niet bereikbaar), dan
 * blokkeert dat het opslaan NIET — de unique constraint vangt een echte dubbele
 * barcode bij opslaan alsnog af. Maar het blijft niet onzichtbaar: zonder melding kan
 * de gebruiker "geen waarschuwing" niet onderscheiden van "controle niet uitgevoerd",
 * en dat is de stille mislukking die SPEC §F8 verbiedt. Er verschijnt daarom een
 * neutrale regel dat de controle niet gelukt is (T21).
 */

import { useEffect, useState } from "react";
import Link from "next/link";

import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import {
  findBarcodeConflict,
  type BarcodeConflict,
} from "@/lib/queries/barcode-lookup";

/** Hoe lang gewacht wordt na de laatste toetsaanslag vóór de servercontrole. */
const CHECK_DEBOUNCE_MS = 400;

export interface BarcodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /**
   * Id van het onderdeel dat op dit moment bewerkt wordt, zodat de eigen barcode
   * nooit als conflict met zichzelf telt. `null`/`undefined` bij een nieuw onderdeel.
   */
  excludePartId?: string | null;
  /** Meldt elke wijziging van de conflictstatus aan de aanroeper (voor de opslaanknop). */
  onConflictChange?: (conflict: BarcodeConflict | null) => void;
}

export function BarcodeField({
  value,
  onChange,
  error,
  excludePartId,
  onConflictChange,
}: BarcodeFieldProps) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [conflict, setConflict] = useState<BarcodeConflict | null>(null);
  const [checking, setChecking] = useState(false);
  /** De servercontrole zelf is mislukt; de gebruiker hoort dat te weten. */
  const [checkFailed, setCheckFailed] = useState(false);

  // Server-side controle, gedebounced: elke toetsaanslag hoeft niet meteen een
  // aanroep te doen, en een scan (die het veld in één keer vult) triggert hem ook via
  // deze zelfde `value`-wijziging.
  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      setConflict(null);
      setCheckFailed(false);
      setChecking(false);
      return;
    }

    let cancelled = false;
    setChecking(true);

    const timer = setTimeout(() => {
      findBarcodeConflict(trimmed, excludePartId ?? null)
        .then((result) => {
          if (!cancelled) {
            setConflict(result);
            setCheckFailed(false);
          }
        })
        .catch((error: unknown) => {
          // De vriendelijke controle mag falen zonder het opslaan te blokkeren — de
          // unique constraint vangt een echte dubbele barcode alsnog af — maar niet
          // stil: de gebruiker krijgt te zien dat de controle niet is uitgevoerd
          // (SPEC §F8, T21).
          console.error("Barcodecontrole mislukt", error);
          if (!cancelled) {
            setConflict(null);
            setCheckFailed(true);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setChecking(false);
          }
        });
    }, CHECK_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, excludePartId]);

  // Aparte effect (niet in dezelfde als hierboven): `onConflictChange` mag van
  // aanroep tot aanroep een nieuwe functie zijn zonder de debounce-timer te
  // verstoren.
  useEffect(() => {
    onConflictChange?.(conflict);
  }, [conflict, onConflictChange]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <Input
          id="barcode"
          name="barcode"
          label="Barcode"
          className="flex-1"
          helpText="EAN/QR, optioneel. Moet uniek zijn indien ingevuld."
          value={value}
          onChange={(event) => onChange(event.target.value)}
          error={error}
        />
        <Button
          type="button"
          variant="secondary"
          className="min-h-[44px] min-w-[44px] shrink-0"
          onClick={() => setScannerOpen(true)}
        >
          Scan barcode
        </Button>
      </div>

      {checking && !conflict && (
        <p className="text-sm text-gray-500">Barcode controleren…</p>
      )}

      {checkFailed && !checking && (
        <p
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          De controle op dubbele barcodes kon niet worden uitgevoerd. Je kunt gewoon
          opslaan; is de barcode al in gebruik, dan meldt de server dat bij het
          opslaan.
        </p>
      )}

      {conflict && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          Deze barcode is al in gebruik bij{" "}
          <Link
            href={`/onderdelen/${conflict.id}`}
            className="font-medium underline hover:text-red-800"
          >
            {conflict.name}
          </Link>
          . Wijzig de barcode om dit onderdeel te kunnen opslaan.
        </p>
      )}

      <BarcodeScanner
        open={scannerOpen}
        title="Barcode scannen"
        onScan={(code) => {
          onChange(code);
          setScannerOpen(false);
        }}
        onClose={() => setScannerOpen(false)}
      />
    </div>
  );
}
