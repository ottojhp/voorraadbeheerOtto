"use client";

/**
 * Formulier voor een nieuw of bestaand onderdeel. Gebruikt door `/onderdelen/nieuw`
 * en `/onderdelen/[id]/bewerken`; de server action wordt als prop meegegeven zodat
 * dit component zelf niet weet of het om aanmaken of bewerken gaat (zelfde patroon
 * als `SupplierForm`, SPEC §2: mutaties via server actions).
 *
 * Prijsinvoer (SPEC §3 regel 0, datamodel v2 + T18): de VERKOOPprijs wordt inclusief
 * btw ingevoerd — dat is het bedrag dat de winkel vaststelt en zo wordt hij ook
 * opgeslagen, zodat er geen cent verloren gaat bij het terugrekenen. Onder het veld
 * staat live het afgeleide excl.-bedrag, expliciet gelabeld.
 *
 * Bij de INKOOPprijs kiest de gebruiker met een zichtbare schakelaar of het ingetypte
 * bedrag incl. of excl. btw is. **Standaard excl.**, want leveranciersfacturen zijn
 * exclusief btw. De keuze zit in het veld `purchasePriceVatMode` en wordt SERVER-SIDE
 * verwerkt (`partFormSchema` rekent bij `"incl"` terug naar excl. vóór het opslaan) —
 * dit component rekent alleen voor de weergave. De keuze staat in React-state en
 * blijft daardoor ook na een validatiefout staan: een server action laat dit
 * component gemount, net zoals de prijsvelden hun waarde houden.
 *
 * Live berekening (SPEC §F3): marge in € en %, het afgeleide verkoopbedrag excl. btw
 * en het tegenhangerbedrag van de inkoopprijs worden bijgewerkt terwijl de gebruiker
 * typt. Marge staat op excl.-basis, want btw is geen winst; dat staat er ook bij.
 * Dit gebruikt dezelfde helpers als de datalaag (`@/lib/money`) zodat de weergave
 * nooit afwijkt van wat er straks in het overzicht staat. De preview is best-effort
 * (ongeldige invoer telt als 0) — de echte validatie gebeurt server-side in
 * `@/lib/validation/parts`.
 *
 * Barcodeveld (T11, SPEC §F3): afgesplitst naar `BarcodeField` (scanknop via de T10
 * `BarcodeScanner`, plus de "vriendelijke" dubbele-barcodecontrole die vooraf
 * waarschuwt en opslaan blokkeert — de echte controle blijft server-side, zie
 * `@/lib/queries/barcode-lookup`). Het veld is hier CONTROLLED (`barcode`-state) in
 * plaats van `defaultValue`, zodat een geslaagde scan het veld programmatisch kan
 * vullen; net als de prijs-/btw-velden hieronder wordt de state geïnitialiseerd
 * vanuit `initialValues`, zodat de waarde na een serverfout behouden blijft.
 *
 * `PartForm` kent het `id` van het onderdeel-in-bewerking niet als prop (dat zit
 * gebonden in de `action`-prop via `.bind(null, part.id)`, niet uitleesbaar vanuit
 * JS). Om de eigen barcode bij het bewerken uit te sluiten van de dubbele-
 * barcodecontrole wordt het daarom uit het pad gehaald (`/onderdelen/[id]/bewerken`)
 * met `usePathname()` — geen wijziging nodig aan de paginabestanden die `PartForm`
 * aanroepen.
 */

import { usePathname } from "next/navigation";
import { useActionState, useMemo, useState } from "react";

import { Button } from "@/components/Button";
import { ErrorMessage } from "@/components/ErrorMessage";
import { MARGIN_BASIS_NOTE } from "@/components/PriceWithVat";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { Textarea } from "@/components/Textarea";
import { CATEGORY_LABELS, CATEGORY_OPTIONS, type Category } from "@/lib/labels";
import {
  calcMargin,
  calcMarginPct,
  formatEuro,
  priceExclVat,
  priceWithVat,
} from "@/lib/money";
import type { BarcodeConflict } from "@/lib/queries/barcode-lookup";
import type { PurchasePriceVatMode } from "@/lib/validation/parts";

import { BarcodeField } from "./BarcodeField";
import { initialPartFormState, type PartFormState } from "./form-state";

/** Haalt het onderdeel-id uit `/onderdelen/[id]/bewerken`, anders `null`. */
const EDIT_PATH_PATTERN = /^\/onderdelen\/([^/]+)\/bewerken\/?$/;

function extractEditingPartId(pathname: string | null): string | null {
  if (!pathname) {
    return null;
  }
  const match = EDIT_PATH_PATTERN.exec(pathname);
  return match ? match[1] : null;
}

/** Minimale merk-/leverancieroptie voor de dropdowns. */
export interface PartFormOption {
  id: string;
  name: string;
}

export interface PartFormInitialValues {
  name: string;
  sku: string;
  category: Category;
  /** `null` = geen merk (universeel onderdeel). */
  brandId: string | null;
  /** `null` = geen leverancier. */
  supplierId: string | null;
  barcode: string | null;
  description: string | null;
  fitsModels: string | null;
  location: string | null;
  /** Inkoopprijs EXCL. btw, zoals opgeslagen. Het formulier start dus op "excl.". */
  purchasePriceExcl: number;
  /** Verkoopprijs INCL. btw. */
  salePriceIncl: number;
  vatRate: number;
  stockQuantity: number;
  minStock: number;
}

export interface PartFormProps {
  action: (
    prevState: PartFormState,
    formData: FormData,
  ) => Promise<PartFormState>;
  initialValues?: PartFormInitialValues;
  submitLabel: string;
  /** Actieve merken voor de dropdown (SPEC §4: `Brand` heeft geen archivering). */
  brands: PartFormOption[];
  /** Niet-gearchiveerde leveranciers voor de dropdown (SPEC §F3/§F5: gearchiveerde
   * leveranciers zijn hier niet kiesbaar — de aanroeper geeft daarom het resultaat
   * van `listSuppliers()` door, die al op `archivedAt: null` filtert). */
  suppliers: PartFormOption[];
}

const DEFAULT_VAT_RATE_DISPLAY = "21";

/** De twee keuzes van de incl./excl.-schakelaar; excl. staat eerst en is de standaard. */
const PURCHASE_VAT_MODES: PurchasePriceVatMode[] = ["excl", "incl"];

const PURCHASE_VAT_MODE_LABELS: Record<PurchasePriceVatMode, string> = {
  excl: "Excl. btw (factuur)",
  incl: "Incl. btw",
};

/**
 * Zet Nederlandse ("12,50") of gewone ("12.50") notatie om naar een getal voor de
 * LIVE preview. Best-effort: ongeldige invoer telt als 0. De autoritatieve validatie
 * (incl. foutmelding bij >2 decimalen) staat in `@/lib/validation/parts`.
 */
function parsePreviewAmount(raw: string): number {
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) ? value : 0;
}

/** Getal → NL-weergavestring voor een `defaultValue`/gecontroleerde invoer, bv. 21 → "21". */
function toDisplayString(value: number): string {
  return String(value).replace(".", ",");
}

/**
 * Geldbedrag → NL-weergavestring met ALTIJD twee decimalen, bv. 10 → "10,00".
 *
 * Apart van {@link toDisplayString}, die voor het btw-tarief wordt gebruikt: daar
 * hoort "21" te staan en niet "21,00". Bij een prijs is het omgekeerde waar. Zonder
 * deze functie zag de gebruiker na het opslaan van €10,00 het veld terugkomen met
 * "10" — hetzelfde bedrag, maar het ziet eruit alsof het formulier iets anders heeft
 * bewaard dan hij intypte, en juist bij deze bedragen (T18) gaat het erom dat
 * zichtbaar is dat er niets is kwijtgeraakt.
 */
function toMoneyDisplayString(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function PartForm({
  action,
  initialValues,
  submitLabel,
  brands,
  suppliers,
}: PartFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    initialPartFormState,
  );

  const pathname = usePathname();
  const editingPartId = useMemo(
    () => extractEditingPartId(pathname),
    [pathname],
  );

  // De barcode is gecontroleerd (nodig om een scan programmatisch in te vullen, en
  // om de dubbele-barcodecontrole op elke wijziging te laten meelopen); de
  // conflictstatus komt van `BarcodeField` en blokkeert de opslaanknop hieronder.
  const [barcode, setBarcode] = useState(initialValues?.barcode ?? "");
  const [barcodeConflict, setBarcodeConflict] = useState<BarcodeConflict | null>(
    null,
  );

  // Alleen de prijs- en btw-velden waren al gecontroleerd: die heeft de
  // live-berekening nodig. De rest blijft ongecontroleerd (`defaultValue`), zoals in
  // `SupplierForm` — dat behoudt ingevulde waarden na een serverfout zonder extra
  // state.
  const [purchasePriceExclRaw, setPurchasePriceExclRaw] = useState(
    initialValues ? toMoneyDisplayString(initialValues.purchasePriceExcl) : "",
  );
  const [salePriceInclRaw, setSalePriceInclRaw] = useState(
    initialValues ? toMoneyDisplayString(initialValues.salePriceIncl) : "",
  );
  const [vatRateRaw, setVatRateRaw] = useState(
    initialValues ? toDisplayString(initialValues.vatRate) : DEFAULT_VAT_RATE_DISPLAY,
  );
  // De opgeslagen inkoopprijs is altijd excl. btw, dus zowel een nieuw als een
  // bestaand onderdeel start op "excl." (T18: standaard excl., want
  // leveranciersfacturen zijn exclusief btw).
  //
  // Deze state is de ENIGE bron van waarheid voor de keuze: ze stuurt zowel de
  // knoppen, het label, de live omrekening ALS het verborgen veld dat meegaat met
  // het formulier. Dat is geen stijlkeuze maar een bugfix. De eerste versie gebruikte
  // twee `<input type="radio">`-knoppen. Na een validatiefout rendert de server het
  // formulier opnieuw, en die server weet niets van de keuze in de browser: hij
  // schrijft `checked` altijd op "excl". React werkte de DOM dan niet bij — de
  // `checked`-prop was in zijn ogen niet veranderd — waardoor het scherm "Incl. btw"
  // gemarkeerd liet en "wordt opgeslagen als € 5,58" toonde, terwijl het formulier
  // "excl" zou versturen en er € 6,75 opgeslagen werd. Precies de stille fout van 21%
  // die deze schakelaar hoort te voorkomen. Met één verborgen veld kan de verzonden
  // waarde per constructie niet afwijken van wat er op het scherm staat.
  //
  // Zonder JavaScript doen de knoppen niets en gaat altijd "excl" mee. Dat is de
  // veilige kant: het ingetypte bedrag wordt dan ongewijzigd opgeslagen.
  const [purchaseVatMode, setPurchaseVatMode] =
    useState<PurchasePriceVatMode>("excl");

  const preview = useMemo(() => {
    const purchaseEntered = parsePreviewAmount(purchasePriceExclRaw);
    const saleIncl = parsePreviewAmount(salePriceInclRaw);
    const vat = parsePreviewAmount(vatRateRaw);

    // Wat er ingetypt is bij de inkoopprijs hangt af van de schakelaar. Dezelfde
    // omrekening als server-side in `partFormSchema`, met dezelfde helper, zodat het
    // getal op het scherm gelijk is aan wat er straks opgeslagen wordt.
    const purchaseExcl =
      purchaseVatMode === "incl"
        ? priceExclVat(purchaseEntered, vat)
        : purchaseEntered;
    const purchaseIncl =
      purchaseVatMode === "incl"
        ? purchaseEntered
        : priceWithVat(purchaseEntered, vat);

    // De ingevoerde verkoopprijs is INCL. btw, dus eerst terugrekenen voordat er met
    // de inkoopprijs (excl. btw) vergeleken wordt. Rechtstreeks vergelijken zou de
    // marge ~21% te hoog laten zien.
    const saleExcl = priceExclVat(saleIncl, vat);
    return {
      purchaseExcl,
      purchaseIncl,
      saleExcl,
      margin: calcMargin(purchaseExcl, saleExcl),
      marginPct: calcMarginPct(purchaseExcl, saleExcl),
    };
  }, [purchasePriceExclRaw, purchaseVatMode, salePriceInclRaw, vatRateRaw]);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.status === "error" && state.formError && (
        <ErrorMessage message={state.formError} />
      )}

      <Input
        id="name"
        name="name"
        label="Naam"
        required
        defaultValue={initialValues?.name ?? ""}
        error={state.fieldErrors.name}
      />
      <Input
        id="sku"
        name="sku"
        label="SKU (artikelnummer)"
        required
        defaultValue={initialValues?.sku ?? ""}
        error={state.fieldErrors.sku}
      />

      <Select
        id="category"
        name="category"
        label="Categorie"
        required
        defaultValue={initialValues?.category ?? ""}
        error={state.fieldErrors.category}
      >
        <option value="" disabled>
          Kies een categorie
        </option>
        {CATEGORY_OPTIONS.map((category) => (
          <option key={category} value={category}>
            {CATEGORY_LABELS[category]}
          </option>
        ))}
      </Select>

      <Select
        id="brandId"
        name="brandId"
        label="Merk"
        defaultValue={initialValues?.brandId ?? ""}
        error={state.fieldErrors.brandId}
        helpText="Leeg laten voor een universeel onderdeel (bv. olie, remblokken, kabels)."
      >
        <option value="">Geen merk / universeel</option>
        {brands.map((brand) => (
          <option key={brand.id} value={brand.id}>
            {brand.name}
          </option>
        ))}
      </Select>

      <Select
        id="supplierId"
        name="supplierId"
        label="Leverancier"
        defaultValue={initialValues?.supplierId ?? ""}
        error={state.fieldErrors.supplierId}
      >
        <option value="">Geen leverancier</option>
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.name}
          </option>
        ))}
      </Select>

      {/* Barcode: handmatig invoerbaar én scanbaar (SPEC §F3, T11). */}
      <BarcodeField
        value={barcode}
        onChange={setBarcode}
        error={state.fieldErrors.barcode}
        excludePartId={editingPartId}
        onConflictChange={setBarcodeConflict}
      />

      <Input
        id="vatRate"
        name="vatRate"
        label="Btw-tarief (%)"
        inputMode="decimal"
        value={vatRateRaw}
        onChange={(event) => setVatRateRaw(event.target.value)}
        helpText="Standaard 21%. Bepaalt alle omrekeningen hieronder."
        error={state.fieldErrors.vatRate}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Inkoopprijs met zichtbare incl./excl.-schakelaar (T18). De keuze staat
            als radiogroep in het formulier (`purchasePriceVatMode`), niet achter een
            menu of een vinkje: wie hier verkeerd gokt, koopt 21% verkeerd in. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-gray-700">Inkoopprijs</legend>

          {/* De keuze gaat als ÉÉN verborgen veld mee, gevuld vanuit de React-state.
              Zie de uitleg bij `purchaseVatMode` hierboven: met een radiogroep raakte
              de verzonden waarde na een validatiefout uit de pas met wat het scherm
              toonde. */}
          <input
            type="hidden"
            name="purchasePriceVatMode"
            value={purchaseVatMode}
          />

          <div
            role="group"
            aria-label="Is het ingevoerde inkoopbedrag inclusief of exclusief btw?"
            className="grid grid-cols-2 gap-2"
          >
            {PURCHASE_VAT_MODES.map((mode) => {
              const active = purchaseVatMode === mode;
              return (
                <button
                  key={mode}
                  // `type="button"`: deze knoppen mogen het formulier NOOIT
                  // verzenden, ze zetten alleen de keuze.
                  type="button"
                  aria-pressed={active}
                  onClick={() => setPurchaseVatMode(mode)}
                  className={`flex min-h-[44px] items-center justify-center rounded-md border px-2 text-center text-sm font-medium ${
                    active
                      ? "border-blue-600 bg-blue-50 text-blue-800"
                      : "border-gray-300 bg-white text-gray-700"
                  }`}
                >
                  {PURCHASE_VAT_MODE_LABELS[mode]}
                </button>
              );
            })}
          </div>

          <Input
            id="purchasePriceExcl"
            name="purchasePriceExcl"
            label={
              purchaseVatMode === "incl"
                ? "Ingevoerd bedrag (incl. btw)"
                : "Ingevoerd bedrag (excl. btw)"
            }
            required
            inputMode="decimal"
            placeholder="0,00"
            value={purchasePriceExclRaw}
            onChange={(event) => setPurchasePriceExclRaw(event.target.value)}
            error={state.fieldErrors.purchasePriceExcl}
          />

          <p aria-live="polite" className="text-sm text-gray-600">
            {purchaseVatMode === "incl" ? (
              <>
                Wordt opgeslagen als{" "}
                <span className="font-medium text-gray-900">
                  {formatEuro(preview.purchaseExcl)} excl. btw
                </span>
                . Terugrekenen rondt af op centen, dus het incl.-bedrag kan daarna een
                cent afwijken.
              </>
            ) : (
              <>
                Dat is{" "}
                <span className="font-medium text-gray-900">
                  {formatEuro(preview.purchaseIncl)} incl. btw
                </span>
                . Leveranciersfacturen staan exclusief btw, dus dit is de normale
                keuze.
              </>
            )}
          </p>
          {state.fieldErrors.purchasePriceVatMode && (
            <p className="text-sm text-red-600">
              {state.fieldErrors.purchasePriceVatMode}
            </p>
          )}
        </fieldset>

        {/* Verkoopprijs: altijd incl. btw invoeren (SPEC §3 regel 0). Het
            excl.-bedrag staat er live onder, gelabeld. */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-gray-700">Verkoopprijs</legend>

          <div className="flex min-h-[44px] items-center rounded-md border border-gray-200 bg-gray-50 px-2 text-sm text-gray-600">
            Altijd inclusief btw — dit bedrag betaalt de klant
          </div>

          <Input
            id="salePriceIncl"
            name="salePriceIncl"
            label="Ingevoerd bedrag (incl. btw)"
            required
            inputMode="decimal"
            placeholder="0,00"
            value={salePriceInclRaw}
            onChange={(event) => setSalePriceInclRaw(event.target.value)}
            error={state.fieldErrors.salePriceIncl}
          />

          <p aria-live="polite" className="text-sm text-gray-600">
            Dat is{" "}
            <span className="font-medium text-gray-900">
              {formatEuro(preview.saleExcl)} excl. btw
            </span>
            . Dit bedrag wordt exact zo opgeslagen als je het intypt; het
            excl.-bedrag is afgeleid.
          </p>
        </fieldset>
      </div>

      <div
        aria-live="polite"
        className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"
      >
        <p className="font-medium">Live berekend op basis van de prijzen hierboven</p>
        <dl className="mt-2 flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <dt>Marge per stuk (excl. btw)</dt>
            <dd className="font-medium">
              {formatEuro(preview.margin)} (
              {preview.marginPct.toFixed(1).replace(".", ",")}%)
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt>Verkoopprijs excl. btw</dt>
            <dd className="font-medium">{formatEuro(preview.saleExcl)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt>Inkoopprijs excl. btw (wordt opgeslagen)</dt>
            <dd className="font-medium">{formatEuro(preview.purchaseExcl)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-blue-800">{MARGIN_BASIS_NOTE}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="stockQuantity"
          name="stockQuantity"
          label="Voorraad"
          required
          inputMode="numeric"
          defaultValue={
            initialValues ? String(initialValues.stockQuantity) : "0"
          }
          error={state.fieldErrors.stockQuantity}
        />
        <Input
          id="minStock"
          name="minStock"
          label="Minimumvoorraad"
          required
          inputMode="numeric"
          defaultValue={initialValues ? String(initialValues.minStock) : "0"}
          helpText="Drempel voor de lage-voorraadmelding."
          error={state.fieldErrors.minStock}
        />
      </div>

      <Textarea
        id="fitsModels"
        name="fitsModels"
        label="Past op (modellen)"
        helpText='Vrije tekst, bv. "Vespa Primavera 2016-2021, Sprint 125". Doorzoekbaar in het overzicht.'
        defaultValue={initialValues?.fitsModels ?? ""}
        error={state.fieldErrors.fitsModels}
      />
      <Input
        id="location"
        name="location"
        label="Schaplocatie"
        defaultValue={initialValues?.location ?? ""}
        error={state.fieldErrors.location}
      />
      <Textarea
        id="description"
        name="description"
        label="Omschrijving"
        defaultValue={initialValues?.description ?? ""}
        error={state.fieldErrors.description}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || barcodeConflict !== null}>
          {pending ? "Opslaan…" : submitLabel}
        </Button>
        {barcodeConflict !== null && (
          <p className="text-sm text-red-700">
            Los eerst de dubbele barcode hierboven op.
          </p>
        )}
      </div>
    </form>
  );
}
