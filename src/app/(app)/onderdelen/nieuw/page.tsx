import type { Metadata } from "next";

import { PageHeader } from "@/components/PageHeader";
import { listBrandsWithPartCounts } from "@/lib/queries/brands";
import { listSuppliers } from "@/lib/queries/suppliers";

import { createPartAction } from "../actions";
import { PartForm } from "../PartForm";

export const metadata: Metadata = {
  title: "Nieuw onderdeel — Voorraadbeheer",
};

/**
 * Nieuw onderdeel aanmaken (SPEC §F3, T08). Server-side Zod-validatie zit in
 * `createPartAction`; na opslaan volgt een redirect naar de detailpagina met een
 * bevestiging en een gerevalideerd overzicht.
 *
 * Merk- en leverancierdropdown herhalen bewust de datalagen van T09/T13
 * (`listBrandsWithPartCounts`, `listSuppliers`) in plaats van een eigen leesquery:
 * `listSuppliers` sluit gearchiveerde leveranciers al uit (SPEC §F3/§F5).
 */
export default async function NieuwOnderdeelPagina() {
  const [brands, suppliers] = await Promise.all([
    listBrandsWithPartCounts(),
    listSuppliers(),
  ]);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Nieuw onderdeel"
        description="Naam, SKU en categorie zijn verplicht. Merk en leverancier mogen leeg blijven."
      />
      <PartForm
        action={createPartAction}
        submitLabel="Onderdeel opslaan"
        brands={brands.map((brand) => ({ id: brand.id, name: brand.name }))}
        suppliers={suppliers.map((supplier) => ({
          id: supplier.id,
          name: supplier.name,
        }))}
      />
    </div>
  );
}
