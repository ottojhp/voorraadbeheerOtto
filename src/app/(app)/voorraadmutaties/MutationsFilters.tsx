"use client";

/**
 * Filterbalk voor `/voorraadmutaties` (T24): reden en periode. Elke wijziging
 * navigeert naar een nieuwe URL en bewaart zelf geen filterstatus; de URL-logica
 * staat in `./search-params` (puur, zonder `"use client"`, getest zonder database).
 *
 * Dit bestand exporteert uitsluitend het component en zijn props-type. Gewone functies
 * horen hier niet in: een server component die ze aanroept laat de pagina crashen.
 *
 * De datumvelden van "Eigen periode" navigeren pas op "Toepassen", anders zou elke
 * toetsaanslag in het datumveld een halfingevulde navigatie geven. Beide kanten zijn
 * optioneel: alleen "van" of alleen "tot en met" mag ook.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import {
  STOCK_MUTATION_REASON_OPTIONS,
  getStockMutationReasonLabel,
} from "@/lib/labels";

import {
  MUTATION_PRESET_OPTIONS,
  buildMutationsQuery,
  normalizeSearchParams,
} from "./search-params";

export interface MutationsFiltersProps {
  /** Melding als een deel van de URL ongeldig was, anders `null`. */
  warning: string | null;
}

export function MutationsFilters({ warning }: MutationsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = normalizeSearchParams(Object.fromEntries(searchParams.entries()));
  const preset = current.preset ?? "";
  const isCustom = preset === "custom";

  const [fromInput, setFromInput] = useState(current.from ?? "");
  const [toInput, setToInput] = useState(current.to ?? "");

  function navigate(overrides: Record<string, string | null | undefined>) {
    router.push(`${pathname}${buildMutationsQuery(current, overrides)}`);
  }

  function handlePresetChange(value: string) {
    if (value === "custom") {
      navigate({ preset: "custom", from: fromInput || null, to: toInput || null });
      return;
    }
    navigate({ preset: value || null, from: null, to: null });
  }

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Select
          id="mutation-reason"
          label="Reden"
          value={current.reason ?? ""}
          onChange={(event) => navigate({ reason: event.target.value || null })}
        >
          <option value="">Alle redenen</option>
          {STOCK_MUTATION_REASON_OPTIONS.map((reason) => (
            <option key={reason} value={reason}>
              {getStockMutationReasonLabel(reason)}
            </option>
          ))}
        </Select>

        <Select
          id="mutation-preset"
          label="Periode"
          value={preset}
          onChange={(event) => handlePresetChange(event.target.value)}
        >
          {MUTATION_PRESET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      {isCustom && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end lg:max-w-2xl">
          <Input
            id="mutation-from"
            type="date"
            label="Van"
            value={fromInput}
            onChange={(event) => setFromInput(event.target.value)}
          />
          <Input
            id="mutation-to"
            type="date"
            label="Tot en met"
            value={toInput}
            onChange={(event) => setToInput(event.target.value)}
          />
          <Button
            type="button"
            onClick={() =>
              navigate({ preset: "custom", from: fromInput || null, to: toInput || null })
            }
          >
            Toepassen
          </Button>
        </div>
      )}

      {warning && (
        <p
          role="status"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {warning}
        </p>
      )}
    </div>
  );
}
