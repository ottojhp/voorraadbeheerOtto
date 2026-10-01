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
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ErrorMessage } from "@/components/ErrorMessage";
import { MarginBasisNote, PriceWithVat } from "@/components/PriceWithVat";
import { SALE_CHANNEL_LABELS, type SaleChannel } from "@/lib/labels";
import type { PartSaleOptionDTO } from "@/lib/queries/types";
import {
  applyDiscountAmount,
  applyDiscountPct,
  calcMargin,
  calcMarginPct,
  describeSalePricing,
  formatEuro,
  formatPercent,
  readMoneyInput,
  toMoneyInput,
} from "@/lib/money";

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

/** De kortingspercentages van de snelknoppen (T26). */
const DISCOUNT_PRESETS = [5, 10, 15] as const;

/**
 * Maximale lengte van het veld "reden korting", gelijk aan
 * `MAX_DISCOUNT_REASON_LENGTH` in `@/lib/validation/sales`.
 *
 * Hier als eigen constante en niet via een import, net als de 120 bij de
 * werkorderreferentie hieronder: `@/lib/validation/sales` trekt zod in de bundel van
 * dit baliescherm, en dat is zo'n 13 kB die een telefoon aan de balie over een
 * mobiele verbinding moet binnenhalen voor één getal. De autoritatieve grens is en
 * blijft het Zod-schema op de server; dit is alleen het `maxLength`-hulpje in de
 * browser.
 */
const DISCOUNT_REASON_MAX_LENGTH = 200;

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

  // --- Prijs en korting (T26) ---------------------------------------------
  //
  // `priceRaw` is de ENIGE bron van waarheid voor de prijs: het is de waarde van het
  // zichtbare veld `unitPriceIncl` en dus exact wat er verstuurd wordt. De
  // kortingsknoppen en het kortingsbedrag SCHRIJVEN alleen in deze state; er gaat
  // geen percentage en geen kortingsbedrag mee naar de server, en er is dus ook geen
  // tweede waarde die met de getoonde prijs uit de pas kan lopen.
  //
  // Dat is de les uit `PartForm`: daar stond de keuze in een gecontroleerde
  // radiogroep, en na een serverfout rendert de server het formulier opnieuw zonder
  // iets van de keuze in de browser te weten. React zag de `checked`-prop niet
  // veranderen, werkte de DOM niet bij, en het formulier verstuurde iets anders dan
  // het scherm toonde — een stille fout van 21%. Hier kan dat niet: de knoppen zijn
  // `type="button"`, veranderen niets aan het formulier zelf, en zetten alleen de
  // waarde van het veld dat de gebruiker ook gewoon kan overtypen.
  //
  // Zonder JavaScript doen de knoppen niets en gaat de vooringevulde normale prijs
  // mee. Dat is de veilige kant: geen korting.
  const [priceRaw, setPriceRaw] = useState(() =>
    selectedPart ? toMoneyInput(selectedPart.salePriceIncl) : "",
  );
  // Het vaste kortingsbedrag staat BEWUST alleen in de browser en gaat niet mee met
  // het formulier: het is een rekenhulpje dat het prijsveld vult.
  const [discountAmountRaw, setDiscountAmountRaw] = useState("");
  const [discountReason, setDiscountReason] = useState("");

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
    // De prijs begint altijd op de NORMALE prijs van het gekozen onderdeel (T26):
    // het veld is vooringevuld, korting is een bewuste handeling.
    setPriceRaw(selectedPart ? toMoneyInput(selectedPart.salePriceIncl) : "");
    setDiscountAmountRaw("");
    setDiscountReason("");
    // `selectedPart` zelf is geen afhankelijkheid: bij elke render van de
    // serverpagina is dat een nieuw object, en dan zou deze effect de prijs
    // terugzetten terwijl de baliemedewerker aan het typen is. Het id is wat telt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setPriceRaw("");
    setDiscountAmountRaw("");
    setDiscountReason("");
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

  // --- Live doorrekening van de prijs (T26) --------------------------------
  //
  // Met dezelfde `describeSalePricing()` als de datalaag, zodat het bedrag dat hier
  // op het scherm staat per constructie gelijk is aan het bedrag dat straks in de
  // bevestiging en in de database staat.
  const listPriceIncl = selectedPart?.salePriceIncl ?? 0;
  const vatRate = selectedPart?.vatRate ?? 0;

  const priceInput = useMemo(
    () => readMoneyInput(priceRaw, "De prijs"),
    [priceRaw],
  );
  const priceError = priceInput.ok ? null : priceInput.error;
  const enteredPrice = priceInput.ok ? priceInput.value : listPriceIncl;

  const pricing = useMemo(
    () =>
      describeSalePricing(listPriceIncl, enteredPrice, vatRate, quantity),
    [listPriceIncl, enteredPrice, vatRate, quantity],
  );

  // Marge ALTIJD excl. btw tegen excl. btw (SPEC §3 regel 0): de ingevulde prijs is
  // incl. btw en wordt daarom eerst teruggerekend. Rechtstreeks met de inkoopprijs
  // vergelijken zou de marge ~21% te hoog laten zien.
  const purchasePriceExcl = selectedPart?.purchasePriceExcl ?? 0;
  const marginPerUnit = calcMargin(purchasePriceExcl, pricing.paidPriceExcl);
  const marginPct = calcMarginPct(purchasePriceExcl, pricing.paidPriceExcl);
  const belowPurchasePrice =
    selectedPart !== null && priceInput.ok && marginPerUnit < 0;

  const discountAmountInput =
    discountAmountRaw.trim() === ""
      ? null
      : readMoneyInput(discountAmountRaw, "Het kortingsbedrag");
  const discountAmountError =
    discountAmountInput && !discountAmountInput.ok
      ? discountAmountInput.error
      : null;

  /** Zet de prijs vanuit een snelknop of het kortingsbedrag. */
  const setPriceTo = (value: number) => {
    setPriceRaw(toMoneyInput(value));
  };

  const handleDiscountPreset = (pct: number) => {
    setPriceTo(applyDiscountPct(listPriceIncl, pct));
    // Het kortingsbedragveld leegmaken: anders zou daar een bedrag blijven staan dat
    // niet meer bij de prijs hoort, en dat is precies het soort stille afwijking dat
    // dit scherm moet voorkomen.
    setDiscountAmountRaw("");
  };

  const handleDiscountAmountChange = (raw: string) => {
    setDiscountAmountRaw(raw);
    if (raw.trim() === "") {
      // Bedrag gewist = terug naar de normale prijs.
      setPriceTo(listPriceIncl);
      return;
    }
    const parsed = readMoneyInput(raw, "Het kortingsbedrag");
    if (parsed.ok) {
      setPriceTo(applyDiscountAmount(listPriceIncl, parsed.value));
    }
    // Bij onzin in het bedragveld blijft de prijs staan; de melding eronder vertelt
    // wat er mis is. De prijs stilletjes op 0 zetten zou veel erger zijn.
  };

  const handlePriceChange = (raw: string) => {
    setPriceRaw(raw);
    // De gebruiker overschrijft de prijs met de hand; het kortingsbedrag hoort daar
    // dan niet meer bij.
    setDiscountAmountRaw("");
  };

  const confirmDisabled =
    pending ||
    isNavigating ||
    selectedPart === null ||
    outOfStock ||
    tooMany ||
    !priceInput.ok;

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
            {state.result.hasDiscount && (
              <s className="whitespace-nowrap text-xs">
                {formatEuro(state.result.lineTotalListInclVat)}
              </s>
            )}{" "}
            <span className="font-semibold">
              {formatEuro(state.result.lineTotalInclVat)} incl. btw
            </span>{" "}
            <span className="whitespace-nowrap text-xs">
              ({formatEuro(state.result.lineTotalExclVat)} excl. btw)
            </span>
          </p>
          {/* Gegeven korting expliciet in de bevestiging (T26). */}
          {state.result.hasDiscount && (
            <p className="mt-1 text-sm text-green-800">
              Korting:{" "}
              <span className="font-semibold">
                {formatEuro(state.result.discountTotalIncl)} incl. btw
              </span>{" "}
              <span className="whitespace-nowrap text-xs">
                ({formatPercent(state.result.discountPct)})
              </span>
              {state.result.discountReason
                ? ` — ${state.result.discountReason}`
                : ""}
            </p>
          )}
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
            Zoek op naam, artikelnummer, leveranciersnummer of barcode
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
                <dt className="text-gray-500">Normale prijs per stuk</dt>
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

          {/* Prijs en korting (T26). Het prijsveld is leidend: de snelknoppen en het
              kortingsbedrag vullen alleen dit veld, en alleen dit veld gaat mee met
              het formulier. */}
          <Card title="Prijs per stuk">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="sale-unit-price"
                className="text-sm font-medium text-gray-700"
              >
                Prijs per stuk incl. btw
              </label>
              <input
                id="sale-unit-price"
                name="unitPriceIncl"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={priceRaw}
                onChange={(event) => handlePriceChange(event.target.value)}
                aria-invalid={priceError ? true : undefined}
                aria-describedby="sale-unit-price-help"
                className={`min-h-[48px] rounded-md border px-3 py-2 text-base text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                  priceError || state.fieldErrors.unitPriceIncl
                    ? "border-red-500"
                    : "border-gray-300"
                }`}
              />
              <p id="sale-unit-price-help" className="text-sm text-gray-500">
                Vooringevuld met de normale prijs. Overtypen mag altijd; de
                standaardprijs van het onderdeel verandert niet.
              </p>
              {priceError && (
                <p role="alert" className="text-sm text-red-600">
                  {priceError}
                </p>
              )}
              {!priceError && state.fieldErrors.unitPriceIncl && (
                <p className="text-sm text-red-600">
                  {state.fieldErrors.unitPriceIncl}
                </p>
              )}
            </div>

            {/* Snelknoppen. `type="button"`: ze mogen het formulier NOOIT
                verzenden, ze zetten alleen de waarde van het prijsveld hierboven. */}
            <div
              role="group"
              aria-label="Korting toepassen"
              className="mt-3 grid grid-cols-4 gap-2"
            >
              {DISCOUNT_PRESETS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handleDiscountPreset(pct)}
                  className="flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-2 text-sm font-medium text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  -{pct}%
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setPriceTo(listPriceIncl);
                  setDiscountAmountRaw("");
                }}
                className="flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-2 text-sm font-medium text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                Normaal
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-1">
              <label
                htmlFor="sale-discount-amount"
                className="text-sm font-medium text-gray-700"
              >
                Of een vast kortingsbedrag (&euro;, incl. btw)
              </label>
              <input
                id="sale-discount-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="bv. 5,00"
                value={discountAmountRaw}
                onChange={(event) =>
                  handleDiscountAmountChange(event.target.value)
                }
                aria-describedby="sale-discount-amount-help"
                className={`min-h-[48px] rounded-md border px-3 py-2 text-base text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                  discountAmountError ? "border-red-500" : "border-gray-300"
                }`}
              />
              <p
                id="sale-discount-amount-help"
                className="text-sm text-gray-500"
              >
                Vult het prijsveld hierboven. Dit bedrag zelf wordt niet
                opgeslagen.
              </p>
              {discountAmountError && (
                <p role="alert" className="text-sm text-red-600">
                  {discountAmountError}
                </p>
              )}
            </div>

            {/* Live doorrekening: originele prijs, korting in euro's en procenten,
                de nieuwe prijs incl. en excl. btw, en de marge die overblijft. */}
            <dl
              aria-live="polite"
              className="mt-4 flex flex-col gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm"
            >
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-gray-600">Normale prijs</dt>
                <dd className="whitespace-nowrap text-gray-900">
                  {formatEuro(pricing.listPriceIncl)} incl. btw
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-gray-600">Korting</dt>
                <dd
                  className={`whitespace-nowrap font-medium ${
                    pricing.hasDiscount ? "text-amber-800" : "text-gray-900"
                  }`}
                >
                  {formatEuro(pricing.discountPerUnitIncl)} (
                  {formatPercent(pricing.discountPct)})
                </dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-gray-600">Nieuwe prijs</dt>
                <dd>
                  <PriceWithVat
                    incl={pricing.paidPriceIncl}
                    excl={pricing.paidPriceExcl}
                    size="md"
                    align="right"
                  />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-gray-600">Marge per stuk</dt>
                <dd
                  className={`whitespace-nowrap font-medium ${
                    marginPerUnit < 0 ? "text-red-700" : "text-gray-900"
                  }`}
                >
                  {formatEuro(marginPerUnit)} ({formatPercent(marginPct)})
                </dd>
              </div>
              <MarginBasisNote />
            </dl>

            {/* Waarschuwing, GEEN blokkade (T26): de balie mag onder de inkoopprijs
                verkopen, maar moet het wel weten. */}
            {belowPurchasePrice && (
              <p
                role="alert"
                className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                <strong>Let op:</strong> deze prijs ligt onder de inkoopprijs van{" "}
                {formatEuro(purchasePriceExcl)} excl. btw. De verkoop kan gewoon
                geregistreerd worden, maar de marge is negatief (
                {formatEuro(marginPerUnit)} per stuk).
              </p>
            )}

            {pricing.isSurcharge && priceInput.ok && (
              <p
                role="alert"
                className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
              >
                <strong>Let op:</strong> deze prijs is{" "}
                {formatEuro(-pricing.discountPerUnitIncl)} H&Oacute;GER dan de
                normale prijs van {formatEuro(pricing.listPriceIncl)} incl. btw.
                Klopt dat?
              </p>
            )}

            {pricing.hasDiscount && (
              <div className="mt-3 flex flex-col gap-1">
                <label
                  htmlFor="sale-discount-reason"
                  className="text-sm font-medium text-gray-700"
                >
                  Reden korting (optioneel)
                </label>
                <input
                  id="sale-discount-reason"
                  name="discountReason"
                  type="text"
                  autoComplete="off"
                  maxLength={DISCOUNT_REASON_MAX_LENGTH}
                  value={discountReason}
                  onChange={(event) => setDiscountReason(event.target.value)}
                  placeholder="bv. beschadigde doos"
                  aria-describedby="sale-discount-reason-avg"
                  className={`min-h-[48px] rounded-md border px-3 py-2 text-base text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                    state.fieldErrors.discountReason
                      ? "border-red-500"
                      : "border-gray-300"
                  }`}
                />
                {/* AVG-waarschuwing, zichtbaar bij het veld — net als bij de
                    werkorderreferentie. */}
                <p
                  id="sale-discount-reason-avg"
                  className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                >
                  Beschrijf alleen de reden. <strong>Geen</strong> klantnaam en{" "}
                  <strong>geen</strong> kenteken — dat zijn persoonsgegevens
                  (AVG).
                </p>
                {state.fieldErrors.discountReason && (
                  <p className="text-sm text-red-600">
                    {state.fieldErrors.discountReason}
                  </p>
                )}
              </div>
            )}
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
                excl.-stuurgetal eronder. Bij korting staat het normale totaal
                doorgestreept ernaast, zodat de balie ziet wat er weggegeven is. */}
            <div className="mt-3 flex items-start justify-between gap-2">
              <span className="text-sm text-gray-700">Totaal</span>
              <span className="text-right">
                {pricing.hasDiscount && (
                  <span className="block text-xs text-gray-500">
                    <s className="whitespace-nowrap">
                      {formatEuro(pricing.lineTotalListIncl)}
                    </s>{" "}
                    <span className="whitespace-nowrap">
                      &minus;{formatEuro(pricing.discountTotalIncl)} korting
                    </span>
                  </span>
                )}
                <PriceWithVat
                  incl={pricing.lineTotalPaidIncl}
                  excl={pricing.lineTotalPaidExcl}
                  size="md"
                  align="right"
                />
              </span>
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
