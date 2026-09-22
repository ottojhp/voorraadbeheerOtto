import type { Metadata } from "next";

import { PageHeader } from "@/components/PageHeader";

import { createSupplierAction } from "../actions";
import { SupplierForm } from "../SupplierForm";

export const metadata: Metadata = {
  title: "Nieuwe leverancier — Voorraadbeheer",
};

/**
 * Nieuwe leverancier aanmaken (SPEC §F5, T13). Server-side Zod-validatie zit in
 * `createSupplierAction`; na opslaan volgt een redirect naar de detailpagina met een
 * gerevalideerd overzicht.
 */
export default function NieuweLeverancierPage() {
  return (
    <div className="max-w-xl">
      <PageHeader
        title="Nieuwe leverancier"
        description="Naam is verplicht. Overige velden zijn optioneel."
      />
      <SupplierForm action={createSupplierAction} submitLabel="Leverancier opslaan" />
    </div>
  );
}
