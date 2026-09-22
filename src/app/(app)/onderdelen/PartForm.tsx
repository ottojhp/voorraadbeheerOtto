"use client";

/**
 * Formulier voor een nieuw of bestaand onderdeel. Gebruikt door `/onderdelen/nieuw`
 * en `/onderdelen/[id]/bewerken`; de server action wordt als prop meegegeven zodat
 * dit component zelf niet weet of het om aanmaken of bewerken gaat (zelfde patroon
 * als `SupplierForm`, SPEC §2: mutaties via server actions).
 *
 * Live berekening (SPEC §F3): marge in € en %, en de verkoopprijs incl. btw, worden
 * bijgewerkt terwijl de gebruiker typt. Dit gebruikt dezelfde helpers als de
 * datalaag (`@/lib/money`) zodat de weergave nooit afwijkt van wat er straks in het
 * overzicht staat. De preview is best-effort (ongeldige invoer telt als 0) — de
 * echte validatie gebeurt server-side in `@/lib/validation/parts`.
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
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { Textarea } from "@/components/Textarea";
import { CATEGORY_LABELS, CATEGORY_OPTIONS, type Category } from "@/lib/labels";
import { calcMargin, calcMarginPct, formatEuro, priceWithVat } from "@/lib/money";
import type { BarcodeConflict } from "@/lib/queries/barcode-lookup";

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
  /** Excl. btw. */
  purchasePrice: number;
  /** Excl. btw. */
  salePrice: number;
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
  const [purchasePriceRaw, setPurchasePriceRaw] = useState(
    initialValues ? toDisplayString(initialValues.purchasePrice) : "",
  );
  const [salePriceRaw, setSalePriceRaw] = useState(
    initialValues ? toDisplayString(initialValues.salePrice) : "",
  );
  const [vatRateRaw, setVatRateRaw] = useState(
    initialValues ? toDisplayString(initialValues.vatRate) : DEFAULT_VAT_RATE_DISPLAY,
  );

  const preview = useMemo(() => {
    const purchase = parsePreviewAmount(purchasePriceRaw);
    const sale = parsePreviewAmount(salePriceRaw);
    const vat = parsePreviewAmount(vatRateRaw);
    return {
      margin: calcMargin(purchase, sale),
      marginPct: calcMarginPct(purchase, sale),
      salePriceInclVat: priceWithVat(sale, vat),
    };
  }, [purchasePriceRaw, salePriceRaw, vatRateRaw]);

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

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          id="purchasePrice"
          name="purchasePrice"
          label="Inkoopprijs (excl. btw)"
          required
          inputMode="decimal"
          placeholder="0,00"
          value={purchasePriceRaw}
          onChange={(event) => setPurchasePriceRaw(event.target.value)}
          error={state.fieldErrors.purchasePrice}
        />
        <Input
          id="salePrice"
          name="salePrice"
          label="Verkoopprijs (excl. btw)"
          required
          inputMode="decimal"
          placeholder="0,00"
          value={salePriceRaw}
          onChange={(event) => setSalePriceRaw(event.target.value)}
          error={state.fieldErrors.salePrice}
        />
      </div>

      <Input
        id="vatRate"
        name="vatRate"
        label="Btw-tarief (%)"
        inputMode="decimal"
        value={vatRateRaw}
        onChange={(event) => setVatRateRaw(event.target.value)}
        helpText="Standaard 21%."
        error={state.fieldErrors.vatRate}
      />

      <div
        aria-live="polite"
        className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"
      >
        <p className="font-medium">Live berekend op basis van de prijzen hierboven</p>
        <dl className="mt-2 flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <dt>Marge (excl. btw)</dt>
            <dd className="font-medium">
              {formatEuro(preview.margin)} (
              {preview.marginPct.toFixed(1).replace(".", ",")}%)
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt>Verkoopprijs incl. btw</dt>
            <dd className="font-medium">{formatEuro(preview.salePriceInclVat)}</dd>
          </div>
        </dl>
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
