"use client";

/**
 * Filterbalk voor `/rapportages` (SPEC §F6): periodekeuze (7/30/90 dagen, dit jaar,
 * eigen datumbereik) en filter op categorie. Elke wijziging navigeert naar een
 * nieuwe URL — de URL-logica zelf staat in `./report-filters` (puur, getest zonder
 * database of React in `src/lib/__tests__/reports.test.ts`).
 *
 * De eigen-datumbereik-velden verschijnen alleen als preset `"custom"` is, en
 * navigeren pas op "Toepassen" — anders zou elke toetsaanslag in het datumveld al
 * een (ongeldige, halftypte) navigatie triggeren.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { CATEGORY_OPTIONS, getCategoryLabel } from "@/lib/labels";
import { PERIOD_PRESET_OPTIONS } from "@/lib/reporting-period";

import { buildReportsQuery, normalizeSearchParams } from "./report-filters";

export interface ReportsFiltersProps {
  /** Melding van `resolveReportingPeriod` als de invoer ongeldig was, anders `null`. */
  warning: string | null;
}

export function ReportsFilters({ warning }: ReportsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const current = normalizeSearchParams(Object.fromEntries(searchParams.entries()));
  const preset = current.preset ?? "30d";
  const isCustom = preset === "custom";

  const [fromInput, setFromInput] = useState(current.from ?? "");
  const [toInput, setToInput] = useState(current.to ?? "");

  function navigate(overrides: Record<string, string | null | undefined>) {
    const qs = buildReportsQuery(current, overrides);
    router.push(`${pathname}${qs}`);
  }

  function handlePresetChange(value: string) {
    if (value === "custom") {
      // Nog geen geldig datumbereik: niet meteen navigeren met lege from/to (dat
      // zou stil terugvallen op de standaardperiode). Wachten op "Toepassen".
      navigate({ preset: "custom", from: fromInput || null, to: toInput || null });
      return;
    }
    navigate({ preset: value, from: null, to: null });
  }

  function handleCustomSubmit() {
    navigate({ preset: "custom", from: fromInput || null, to: toInput || null });
  }

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <Select
            id="report-preset"
            label="Periode"
            value={preset}
            onChange={(event) => handlePresetChange(event.target.value)}
          >
            {PERIOD_PRESET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="min-w-[200px]">
          <Select
            id="report-category"
            label="Categorie"
            value={current.category ?? ""}
            onChange={(event) => navigate({ category: event.target.value || null })}
          >
            <option value="">Alle categorieën</option>
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {getCategoryLabel(option)}
              </option>
            ))}
          </Select>
        </div>

        <div className="min-w-[180px]">
          <Select
            id="report-bucket"
            label="Omzetverloop per"
            value={current.bucket ?? "day"}
            onChange={(event) => navigate({ bucket: event.target.value })}
          >
            <option value="day">Dag</option>
            <option value="week">Week</option>
          </Select>
        </div>
      </div>

      {isCustom && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[160px]">
            <Input
              id="report-from"
              type="date"
              label="Van"
              value={fromInput}
              onChange={(event) => setFromInput(event.target.value)}
            />
          </div>
          <div className="min-w-[160px]">
            <Input
              id="report-to"
              type="date"
              label="Tot en met"
              value={toInput}
              onChange={(event) => setToInput(event.target.value)}
            />
          </div>
          <Button type="button" onClick={handleCustomSubmit}>
            Toepassen
          </Button>
        </div>
      )}

      {warning && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {warning}
        </p>
      )}
    </div>
  );
}
