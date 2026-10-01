"use client";

/**
 * Het scanscherm voor artikelnummers (T20, SPEC §F4/§F8).
 *
 * Eén client component dat de hele scanflow vasthoudt, in vijf rustige stappen:
 *
 *  1. **uitleg** — wat dit scherm doet, plus een knop om de camera te openen en een
 *     veld om het nummer alsnog zelf te typen. Dat veld staat er van begin af aan:
 *     de camera is een snelkoppeling, geen voorwaarde. Werkt hij niet (geen https,
 *     geen toestemming, geen camera), dan is de terugval al in beeld.
 *  2. **scannen** — `TextScanner` (barcode + tekstherkenning in één camerastream).
 *  3. **opzoeken** — de gelezen tekst gaat naar `lookupScannedTextAction`.
 *  4. **bevestigen** — de kandidaat of kandidaten, elk met de verantwoording waarom
 *     ze gevonden zijn. Hier gebeurt NOG NIETS; de gebruiker kiest.
 *  5. **aanpassen** — de voorraadknoppen uit T19 (`StockStepper`, variant `full`:
 *     −, +, bijboeken en exact aantal instellen) voor het bevestigde onderdeel.
 *
 * ## Waarom de camera dichtgaat zodra er iets gelezen is
 * Bevestigen boven een bewegend camerabeeld is vragen om een misklik, en een camera
 * die open blijft staan tijdens het nadenken kost batterij. Na een resultaat gaat de
 * stream dus uit (stap 4 en 5 hebben hem niet nodig) en opent "Volgende scan" hem
 * opnieuw.
 *
 * ## Waarom de voorraadstand hier in client-state staat
 * Dit scherm is geen server component: het onderdeel komt uit een server action en
 * niet uit de render. De `revalidatePath` in `adjustStockAction` ververst daarom
 * `/onderdelen` en `/onderdelen/[id]`, maar niet dit scherm. Daarom twee dingen: de
 * stand wordt bij het openen van stap 5 nog één keer VERS opgehaald
 * (`getScannedPartAction`), en elke geslaagde wijziging komt via `onAdjusted` terug
 * in de state. Zonder dat laatste zou de stand na het bijboeken terugspringen naar
 * de waarde van vóór de scan.
 */

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PriceWithVat } from "@/components/PriceWithVat";
import { TextScanner, type TextScanResult } from "@/components/TextScanner";
import { getCategoryLabel } from "@/lib/labels";
import type { PartScanDTO, PartScanMatchDTO, ScanSource } from "@/lib/queries/types";

import { StockStepper } from "../StockStepper";
import { getScannedPartAction, lookupScannedTextAction } from "../scan-actions";
import {
  SCAN_SOURCE_LABELS,
  describeScanMatch,
  describeScanOutcome,
  isStrongMatch,
  type ScanLookupResult,
} from "../scan-state";

/* -------------------------------------------------------------------------- */
/* Stappen                                                                     */
/* -------------------------------------------------------------------------- */

type Stage =
  | { kind: "intro" }
  | { kind: "scanning" }
  | { kind: "looking-up"; text: string; source: ScanSource }
  | { kind: "result"; result: ScanLookupResult }
  | { kind: "adjust"; part: PartScanDTO; note: string | null };

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function ScanScreen() {
  const [stage, setStage] = useState<Stage>({ kind: "intro" });
  const [manualText, setManualText] = useState("");
  const [, startTransition] = useTransition();
  /** Melding die niet bij één stap hoort, bv. "onderdeel is inmiddels gearchiveerd". */
  const [notice, setNotice] = useState<string | null>(null);

  /* ---------------------------------------------------------------------- */
  /* Opzoeken                                                              */
  /* ---------------------------------------------------------------------- */

  const lookup = useCallback((text: string, source: ScanSource) => {
    setNotice(null);

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      // Niets gelezen. Dat is geen fout van de gebruiker, maar hij moet het wél
      // weten en verder kunnen (SPEC §F8).
      setStage({
        kind: "result",
        result: {
          ok: false,
          recognizedText: "",
          message:
            "De camera kon geen tekst lezen. Houd de telefoon stiller en zorg voor meer licht, of typ het nummer hieronder in.",
        },
      });
      return;
    }

    setStage({ kind: "looking-up", text: trimmed, source });
    setManualText(trimmed);

    startTransition(async () => {
      const result = await lookupScannedTextAction({ text: trimmed, source });
      setStage({ kind: "result", result });
    });
  }, []);

  const handleScanResult = useCallback(
    (result: TextScanResult) => {
      // Camera uit; bevestigen gebeurt op een rustig scherm.
      lookup(result.text, result.source);
    },
    [lookup],
  );

  /* ---------------------------------------------------------------------- */
  /* Bevestigen                                                            */
  /* ---------------------------------------------------------------------- */

  const confirmMatch = useCallback((match: PartScanMatchDTO) => {
    setNotice(null);
    startTransition(async () => {
      // Verse stand ophalen: tussen het scannen en het bevestigen kan de balie er
      // alweer twee verkocht hebben.
      const fresh = await getScannedPartAction(match.part.id);
      if (fresh === null) {
        setNotice(
          `${match.part.name} is niet meer te wijzigen. Het onderdeel is inmiddels gearchiveerd of verwijderd.`,
        );
        return;
      }
      setStage({
        kind: "adjust",
        part: fresh,
        note: `Gevonden via ${describeScanMatch(match)}.`,
      });
    });
  }, []);

  /* ---------------------------------------------------------------------- */
  /* Weergave per stap                                                     */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {notice}
        </p>
      )}

      {stage.kind === "intro" && (
        <Card>
          <h2 className="text-base font-semibold text-gray-900">
            Artikelnummer of barcode scannen
          </h2>
          <p className="mt-2 text-sm text-gray-700">
            Richt de camera op de verpakking. Zit er een barcode op, dan wordt die
            gebruikt — dat is het betrouwbaarst. Anders wordt het artikelnummer
            gelezen met tekstherkenning.
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Tekstherkenning op bedrukte verpakkingen gaat regelmatig mis. Er wordt
            daarom nooit automatisch iets gewijzigd: je ziet eerst welk onderdeel
            gevonden is en bevestigt zelf.
          </p>
          <div className="mt-4">
            <Button
              className="min-h-[52px] w-full text-base sm:w-auto"
              onClick={() => setStage({ kind: "scanning" })}
            >
              Camera openen
            </Button>
          </div>
        </Card>
      )}

      {stage.kind === "looking-up" && (
        <Card>
          <p className="text-sm text-gray-700" aria-live="polite">
            Onderdeel opzoeken…
          </p>
          <p className="mt-2 break-all font-mono text-sm text-gray-900">
            {stage.text}
          </p>
        </Card>
      )}

      {stage.kind === "result" && !stage.result.ok && (
        <ErrorMessage
          title="Opzoeken niet gelukt"
          message={stage.result.message}
          action={
            <Button variant="secondary" onClick={() => setStage({ kind: "scanning" })}>
              Opnieuw scannen
            </Button>
          }
        />
      )}

      {stage.kind === "result" && stage.result.ok && (
        <ScanResultPanel
          result={stage.result}
          onConfirm={confirmMatch}
          onRescan={() => setStage({ kind: "scanning" })}
        />
      )}

      {stage.kind === "adjust" && (
        <AdjustPanel
          part={stage.part}
          note={stage.note}
          onPartChange={(part) => setStage({ kind: "adjust", part, note: stage.note })}
          onRescan={() => setStage({ kind: "scanning" })}
        />
      )}

      {/* Handmatig invoeren staat ALTIJD op het scherm, in elke stap. De camera is
          een snelkoppeling; dit is de weg die altijd werkt (T20: terugval op
          handmatig zoeken bij elke camerafout). */}
      <ManualLookupCard
        value={manualText}
        onChange={setManualText}
        onSubmit={(value) => lookup(value, "manual")}
      />

      <TextScanner
        open={stage.kind === "scanning"}
        onResult={handleScanResult}
        onClose={() => setStage({ kind: "intro" })}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Kandidaten                                                                  */
/* -------------------------------------------------------------------------- */

interface ScanResultPanelProps {
  result: Extract<ScanLookupResult, { ok: true }>;
  onConfirm: (match: PartScanMatchDTO) => void;
  onRescan: () => void;
}

function ScanResultPanel({ result, onConfirm, onRescan }: ScanResultPanelProps) {
  const { matches, recognizedText, source } = result;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <p className="text-base font-semibold text-gray-900">
          {describeScanOutcome(matches.length)}
        </p>
        <p className="mt-1 text-xs uppercase tracking-wide text-gray-500">
          {SCAN_SOURCE_LABELS[source]}
        </p>
        {/* Altijd zichtbaar WAT er gelezen is — ook bij een treffer. Dan kan de
            gebruiker zelf zien of de camera iets anders las dan er staat. */}
        <p className="mt-2 whitespace-pre-wrap break-all rounded-md bg-gray-50 px-3 py-2 font-mono text-sm text-gray-800">
          {recognizedText}
        </p>
        {matches.length === 0 && (
          <p className="mt-3 text-sm text-gray-700">
            Geen onderdeel met deze barcode, artikelcode of leveranciersnummer. Pas
            de tekst hieronder aan en zoek opnieuw, of zoek het onderdeel op in de
            voorraad.
          </p>
        )}
        {matches.length > 1 && (
          <p className="mt-3 text-sm text-gray-700">
            De gelezen tekst past bij meer dan één onderdeel. Kies het onderdeel dat
            je in je hand hebt.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onRescan}>
            Opnieuw scannen
          </Button>
          <Link
            href={`/onderdelen?search=${encodeURIComponent(recognizedText)}`}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50"
          >
            Zoeken in voorraad
          </Link>
        </div>
      </Card>

      {matches.map((match) => (
        <MatchCard key={match.part.id} match={match} onConfirm={onConfirm} />
      ))}
    </div>
  );
}

interface MatchCardProps {
  match: PartScanMatchDTO;
  onConfirm: (match: PartScanMatchDTO) => void;
}

function MatchCard({ match, onConfirm }: MatchCardProps) {
  const { part } = match;
  const strong = isStrongMatch(match);

  return (
    <Card
      className={strong ? "border-green-300" : "border-amber-300"}
      data-testid="scan-match"
    >
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-gray-900">{part.name}</p>
        <p className="text-sm text-gray-600">
          {part.brandName ?? "Universeel (geen merk)"} ·{" "}
          {getCategoryLabel(part.category)}
        </p>
        <p className="text-sm text-gray-700">{describeScanMatch(match)}</p>
        {!strong && (
          <p className="text-sm text-amber-800">
            Controleer de verpakking voordat je bevestigt: deze treffer berust op
            interpretatie van de gelezen tekens.
          </p>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">
            Artikelcode
          </dt>
          <dd className="font-mono text-gray-900">{part.sku}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Barcode</dt>
          <dd className="font-mono text-gray-900">{part.barcode ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">
            Leveranciersnummer
          </dt>
          <dd className="font-mono text-gray-900">
            {part.supplierArticleNumber ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-gray-500">Locatie</dt>
          <dd className="text-gray-900">{part.location ?? "—"}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-700">
          Voorraad:{" "}
          <span className="font-semibold tabular-nums">{part.stockQuantity}</span>{" "}
          stuks
          {part.isLowStock && (
            <Badge variant="warning" className="ml-2">
              Lage voorraad
            </Badge>
          )}
        </p>
        <PriceWithVat incl={part.salePriceIncl} excl={part.salePriceExcl} />
      </div>

      <div className="mt-4">
        <Button
          className="min-h-[52px] w-full text-base"
          onClick={() => onConfirm(match)}
        >
          Dit is het onderdeel
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Voorraad aanpassen (T19)                                                    */
/* -------------------------------------------------------------------------- */

interface AdjustPanelProps {
  part: PartScanDTO;
  note: string | null;
  onPartChange: (part: PartScanDTO) => void;
  onRescan: () => void;
}

function AdjustPanel({ part, note, onPartChange, onRescan }: AdjustPanelProps) {
  return (
    <Card className="border-green-300">
      <p className="text-base font-semibold text-gray-900">{part.name}</p>
      <p className="mt-0.5 text-sm text-gray-600">
        {part.brandName ?? "Universeel (geen merk)"} ·{" "}
        <span className="font-mono">{part.sku}</span>
        {part.location ? ` · ${part.location}` : ""}
      </p>
      {note && <p className="mt-1 text-xs text-gray-500">{note}</p>}

      <div className="mt-4">
        <p className="mb-2 text-sm font-medium text-gray-700">Voorraad aanpassen</p>
        <StockStepper
          // Een nieuw onderdeel = een nieuwe stepper: de `key` gooit de
          // optimistische stand en de vorige bevestiging weg, zodat de melding van
          // het vorige onderdeel niet bij dit onderdeel blijft staan.
          key={part.id}
          partId={part.id}
          partName={part.name}
          stockQuantity={part.stockQuantity}
          minStock={part.minStock}
          variant="full"
          onAdjusted={(result) => {
            // De stand in dit scherm meebewegen; zie de uitleg bovenaan.
            onPartChange({
              ...part,
              stockQuantity: result.quantityAfter,
              minStock: result.minStock,
              isLowStock: result.isLowStock,
            });
          }}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button className="min-h-[48px]" onClick={onRescan}>
          Volgende scan
        </Button>
        <Link
          href={`/onderdelen/${part.id}`}
          className="inline-flex min-h-[48px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50"
        >
          Onderdeel openen
        </Link>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Handmatig invoeren — de terugval die altijd werkt                           */
/* -------------------------------------------------------------------------- */

interface ManualLookupCardProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}

function ManualLookupCard({
  value,
  onChange,
  onSubmit,
}: ManualLookupCardProps) {
  const trimmed = value.trim();

  return (
    <Card>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed.length > 0) {
            onSubmit(trimmed);
          }
        }}
        className="flex flex-col gap-2"
      >
        <label
          htmlFor="scan-manual"
          className="text-sm font-medium text-gray-700"
        >
          Nummer zelf invoeren of de gelezen tekst verbeteren
        </label>
        <input
          id="scan-manual"
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="bv. PIA-4T-8412"
          className="min-h-[48px] rounded-md border border-gray-300 px-3 py-2 font-mono text-base text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
        <p className="text-sm text-gray-500">
          Er wordt gezocht op barcode, artikelcode en leveranciersnummer. Hoofdletters,
          spaties en streepjes maken niet uit, en de tekens die er in print op elkaar
          lijken (O/0, I/1, S/5, B/8, Z/2) worden als gelijk behandeld.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={trimmed.length === 0}>
            Opzoeken
          </Button>
          {trimmed.length > 0 && (
            <Link
              href={`/onderdelen?search=${encodeURIComponent(trimmed)}`}
              className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50"
            >
              Zoeken in voorraad
            </Link>
          )}
        </div>
      </form>
    </Card>
  );
}
