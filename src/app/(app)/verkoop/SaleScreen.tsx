"use client";

/**
 * Het baliescherm (SPEC §F4, T12). Eén client component dat de hele verkoopflow
 * vasthoudt: zoeken, scannen, het gekozen onderdeel, aantal, kanaal en bevestigen.
 *
 * Waarom zoeken en selecteren via de URL loopt (`?q=`, `?partId=`, `?scan=`) en niet
 * via een eigen client-side fetch: de pagina is een server component die de bestaande
 * datalaag (`searchPartsForSale`, `findPartByBarcode`, `getPartById`) gebruikt. Zo is
 * de getoonde voorraad altijd vers uit de database, is er geen tweede leespad dat kan
 * afwijken, en werkt de terugknop gewoon. Dit component blijft bij zo'n navigatie
 * gemount (het staat op elke variant van de route), waardoor de bevestiging van de
 * vorige verkoop zichtbaar blijft terwijl de URL alweer leeg is.
 *
 * Dubbelklikbescherming — drie lagen, van buiten naar binnen:
 *  1. de bevestigknop is `disabled` zodra `useActionState` pending is (en zolang er
 *     geen geldig onderdeel/aantal is);
 *  2. een `submittingRef` blokkeert een tweede submit in het venster tussen de eerste
 *     tik en de eerstvolgende render — precies het gaatje waar een dubbeltik op een
 *     telefoon in valt;
 *  3. na succes wordt de selectie gewist, dus een late tweede verzending heeft geen
 *     `partId` meer.
 * De harde garantie zit daaronder in de datalaag: de voorwaardelijke voorraadupdate
 * binnen de transactie kan de voorraad nooit onder nul brengen.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PriceWithVat } from "@/components/PriceWithVat";
import { SALE_CHANNEL_LABELS, type SaleChannel } from "@/lib/labels";
import type { PartSaleOptionDTO } from "@/lib/queries/types";
import { calcLineTotal, formatEuro } from "@/lib/money";

import { QuantityStepper } from "./QuantityStepper";
import { registerSaleAction, type SaleFormState } from "./actions";

/**
 * Beginwaarde van de formulierstatus. Staat hier en niet in `actions.ts`, omdat een
 * `"use server"`-bestand alleen async functies mag exporteren.
 */
const INITIAL_SALE_FORM_STATE: SaleFormState = {
  status: "idle",
  fieldErrors: {},
};

export interface SaleScreenProps {
  /** De actieve zoekterm uit de URL. */
  query: string;
  /** Zoekresultaten (leeg als er niet gezocht is). */
  results: PartSaleOptionDTO[];
  /** Het gekozen onderdeel, of `null` zolang er niets gekozen is. */
  selectedPart: PartSaleOptionDTO | null;
  /** De gescande code waarvoor géén onderdeel gevonden is. */
  scanMiss: string | null;
  /** Melding vanuit de server, bv. "onderdeel is gearchiveerd". */
  notice: string | null;
}

const CHANNELS: SaleChannel[] = ["COUNTER", "WORKSHOP"];

export function SaleScreen({
  query,
  results,
  selectedPart,
  scanMiss,
  notice,
}: SaleScreenProps) {
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();

  const [state, formAction, pending] = useActionState(
    registerSaleAction,
    INITIAL_SALE_FORM_STATE,
  );

  const [searchText, setSearchText] = useState(query);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [channel, setChannel] = useState<SaleChannel>("COUNTER");
  const [reference, setReference] = useState("");

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const submittingRef = useRef(false);
  /** Laatste verkoop waarvoor het scherm al opgeruimd is (voorkomt een lus). */
  const handledSaleRef = useRef<string | null>(null);

  const selectedId = selectedPart?.id ?? null;

  // Zoekveld volgt de URL, zodat de terugknop ook het tekstveld herstelt.
  useEffect(() => {
    setSearchText(query);
  }, [query]);

  // Een ander onderdeel = een nieuwe verkoop: aantal en kanaal terug naar de
  // standaardwaarden uit SPEC §F4 (1 stuk, balie).
  useEffect(() => {
    setQuantity(1);
    setChannel("COUNTER");
    setReference("");
  }, [selectedId]);

  // Laag 2 van de dubbelklikbescherming vrijgeven zodra de action klaar is.
  useEffect(() => {
    if (!pending) {
      submittingRef.current = false;
    }
  }, [pending]);

  const navigate = (search: string) => {
    startNavigation(() => {
      router.push(search ? `/verkoop?${search}` : "/verkoop");
    });
  };

  // Na een geslaagde verkoop: selectie wissen, URL opschonen en de focus terug naar
  // het zoekveld, zodat de volgende klant direct geholpen kan worden. De bevestiging
  // zelf blijft staan (die komt uit `state`, niet uit de URL).
  const successSaleId =
    state.status === "success" ? (state.result?.saleId ?? null) : null;

  useEffect(() => {
    if (!successSaleId || handledSaleRef.current === successSaleId) {
      return;
    }
    handledSaleRef.current = successSaleId;
    setSearchText("");
    setQuantity(1);
    setChannel("COUNTER");
    setReference("");
    router.replace("/verkoop");
    searchInputRef.current?.focus();
  }, [successSaleId, router]);

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = searchText.trim();
    navigate(value ? `q=${encodeURIComponent(value)}` : "");
  };

  const handleScan = (code: string) => {
    setScannerOpen(false);
    navigate(`scan=${encodeURIComponent(code)}`);
  };

  const stock = selectedPart?.stockQuantity ?? 0;
  const outOfStock = selectedPart !== null && stock < 1;
  const tooMany = selectedPart !== null && quantity > stock;
  const confirmDisabled =
    pending || isNavigating || selectedPart === null || outOfStock || tooMany;

  const showConfirmation =
    state.status === "success" && state.result && selectedPart === null;

  return (
    <div className="flex flex-col gap-4">
      {/* Bevestiging van de vorige verkoop, met de NIEUWE voorraadstand. */}
      {showConfirmation && state.result && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-green-300 bg-green-50 p-4"
        >
          <p className="text-base font-semibold text-green-900">
            {state.result.quantity}&times; {state.result.partName} geregistreerd
            {state.result.channel === "WORKSHOP" ? " (werkplaats)" : ""}
          </p>
          <p className="mt-1 text-sm text-green-800">
            Nieuwe voorraad:{" "}
            <span className="font-semibold">
              {state.result.newStockQuantity}
            </span>{" "}
            stuks
          </p>
          {/* Het betaalde bedrag (incl. btw) is het hoofdbedrag (T18). */}
          <p className="mt-1 text-sm text-green-800">
            Afgerekend:{" "}
            <span className="font-semibold">
              {formatEuro(state.result.lineTotalInclVat)} incl. btw
            </span>{" "}
            <span className="whitespace-nowrap text-xs">
              ({formatEuro(state.result.lineTotalExclVat)} excl. btw)
            </span>
          </p>
          {state.result.reference && (
            <p className="mt-1 text-sm text-green-800">
              Werkorder: {state.result.reference}
            </p>
          )}
        </div>
      )}

      {/* Zoeken en scannen. Staat bovenaan en blijft altijd bereikbaar. */}
      <Card>
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-3">
          <label
            htmlFor="sale-search"
            className="text-sm font-medium text-gray-700"
          >
            Zoek op naam, artikelnummer of barcode
          </label>
          <input
            ref={searchInputRef}
            id="sale-search"
            name="q"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="bv. remblok, REM-001 of 8712345678901"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="min-h-[48px] w-full rounded-md border border-gray-300 px-3 py-2 text-base text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            {/* Scanknop prominent (SPEC §F4/§F8): eerst en het breedst. */}
            <Button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="min-h-[48px] flex-1"
            >
              Barcode scannen
            </Button>
            <Button
              type="submit"
              variant="secondary"
              disabled={isNavigating}
              className="min-h-[48px] sm:w-32"
            >
              {isNavigating ? "Bezig…" : "Zoeken"}
            </Button>
          </div>
        </form>
      </Card>

      {/* Scan zonder match: mét de gescande code, zodat de balie ziet wat er
          gelezen is. */}
      {scanMiss && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4"
        >
          <p className="text-sm font-semibold text-amber-900">
            Geen onderdeel gevonden voor de gescande code
          </p>
          <p className="mt-1 break-all font-mono text-sm text-amber-900">
            {scanMiss}
          </p>
          <p className="mt-2 text-sm text-amber-800">
            Controleer of het onderdeel bestaat en niet gearchiveerd is, of zoek
            handmatig op naam of artikelnummer.
          </p>
        </div>
      )}

      {notice && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {notice}
        </div>
      )}

      {/* Zoekresultaten */}
      {selectedPart === null && results.length > 0 && (
        <Card title={`${results.length} gevonden`}>
          <ul className="flex flex-col divide-y divide-gray-200">
            {results.map((part) => (
              <li key={part.id}>
                <button
                  type="button"
                  onClick={() => navigate(`partId=${encodeURIComponent(part.id)}`)}
                  className="flex min-h-[56px] w-full flex-col items-start gap-0.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <span className="text-base font-medium text-gray-900">
                    {part.name}
                  </span>
                  <span className="text-sm text-gray-500">
                    {part.brandName ?? "Universeel"} &middot; {part.sku}
                  </span>
                  <span className="text-sm text-gray-700">
                    {part.stockQuantity} op voorraad
                  </span>
                  <PriceWithVat
                    incl={part.salePriceIncl}
                    excl={part.salePriceExcl}
                  />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {selectedPart === null &&
        results.length === 0 &&
        query !== "" &&
        !scanMiss && (
          <p className="px-1 text-sm text-gray-600">
            Geen onderdeel gevonden voor &ldquo;{query}&rdquo;. Gearchiveerde
            onderdelen worden niet getoond.
          </p>
        )}

      {/* Gekozen onderdeel + verkoopformulier */}
      {selectedPart && (
        <form
          action={formAction}
          onSubmit={(event) => {
            // Laag 2: een tweede tik binnen dezelfde render wordt genegeerd.
            if (submittingRef.current) {
              event.preventDefault();
              return;
            }
            submittingRef.current = true;
          }}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="partId" value={selectedPart.id} />

          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedPart.name}
                </h2>
                <p className="mt-0.5 text-sm text-gray-500">
                  {selectedPart.brandName ?? "Universeel (geen merk)"} &middot;{" "}
                  {selectedPart.sku}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("")}
                className="min-h-[44px] shrink-0 rounded-md px-3 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                Wissen
              </button>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-gray-500">Voorraad</dt>
                <dd
                  className={`text-base font-semibold ${
                    outOfStock ? "text-red-700" : "text-gray-900"
                  }`}
                >
                  {selectedPart.stockQuantity} stuks
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Verkoopprijs per stuk</dt>
                <dd>
                  <PriceWithVat
                    incl={selectedPart.salePriceIncl}
                    excl={selectedPart.salePriceExcl}
                    size="md"
                  />
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-gray-700">
                Kanaal
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {CHANNELS.map((option) => {
                  const active = channel === option;
                  return (
                    <label
                      key={option}
                      className={`flex min-h-[48px] cursor-pointer items-center justify-center rounded-md border px-3 text-base font-medium ${
                        active
                          ? "border-blue-600 bg-blue-50 text-blue-800"
                          : "border-gray-300 bg-white text-gray-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="channel"
                        value={option}
                        checked={active}
                        onChange={() => setChannel(option)}
                        className="sr-only"
                      />
                      {SALE_CHANNEL_LABELS[option]}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {channel === "WORKSHOP" && (
              <div className="mt-4 flex flex-col gap-1">
                <label
                  htmlFor="sale-reference"
                  className="text-sm font-medium text-gray-700"
                >
                  Werkorderreferentie (optioneel)
                </label>
                <input
                  id="sale-reference"
                  name="reference"
                  type="text"
                  autoComplete="off"
                  maxLength={120}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder="bv. WO-2026-0412"
                  aria-describedby="sale-reference-avg"
                  className={`min-h-[48px] rounded-md border px-3 py-2 text-base text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                    state.fieldErrors.reference
                      ? "border-red-500"
                      : "border-gray-300"
                  }`}
                />
                {/* AVG-waarschuwing, zichtbaar bij het veld (SPEC §4, §F4). */}
                <p
                  id="sale-reference-avg"
                  className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                >
                  Vul hier alleen een werkordernummer in. <strong>Geen</strong>{" "}
                  klantnaam en <strong>geen</strong> kenteken — dat zijn
                  persoonsgegevens (AVG).
                </p>
                {state.fieldErrors.reference && (
                  <p className="text-sm text-red-600">
                    {state.fieldErrors.reference}
                  </p>
                )}
              </div>
            )}

            <div className="mt-4">
              <QuantityStepper
                name="quantity"
                value={quantity}
                onChange={setQuantity}
                max={stock}
                disabled={outOfStock || pending}
                error={state.fieldErrors.quantity}
              />
            </div>

            {/* Het totaal dat de klant betaalt staat voorop (T18); het
                excl.-stuurgetal eronder. */}
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="text-sm text-gray-700">Totaal</span>
              <PriceWithVat
                incl={calcLineTotal(selectedPart.salePriceIncl, quantity)}
                excl={calcLineTotal(selectedPart.salePriceExcl, quantity)}
                size="md"
                align="right"
              />
            </div>

            {outOfStock && (
              <p className="mt-2 text-sm font-medium text-red-700">
                Dit onderdeel ligt niet meer op voorraad en kan niet verkocht
                worden.
              </p>
            )}
            {!outOfStock && tooMany && (
              <p className="mt-2 text-sm font-medium text-red-700">
                Er zijn maar {stock} stuks op voorraad.
              </p>
            )}
          </Card>

          {state.status === "error" && state.formError && (
            <ErrorMessage
              title="Verkoop niet geregistreerd"
              message={state.formError}
            />
          )}
          {state.status === "invalid" && state.formError && (
            <ErrorMessage
              title="Controleer de invoer"
              message={state.formError}
            />
          )}

          {/* Bevestigen: onderin, binnen duimbereik, en op mobiel zwevend boven de
              vaste onderbalk van de app-layout. */}
          <div className="sticky bottom-20 z-10 md:bottom-4">
            <Button
              type="submit"
              disabled={confirmDisabled}
              className="min-h-[56px] w-full text-base shadow-lg"
            >
              {pending
                ? "Bezig met registreren…"
                : `Verkoop bevestigen (${quantity}×)`}
            </Button>
          </div>
        </form>
      )}

      {selectedPart === null && results.length === 0 && query === "" && !scanMiss && (
        <p className="px-1 text-sm text-gray-600">
          Scan een barcode of zoek een onderdeel om een verkoop te registreren.
          Staat een onderdeel er nog niet in? Voeg het toe via{" "}
          <Link href="/onderdelen" className="text-blue-700 underline">
            Voorraad
          </Link>
          .
        </p>
      )}

      <BarcodeScanner
        open={scannerOpen}
        onScan={handleScan}
        onClose={() => setScannerOpen(false)}
        title="Onderdeel scannen"
      />
    </div>
  );
}
