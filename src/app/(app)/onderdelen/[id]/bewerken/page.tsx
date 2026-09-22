import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/PageHeader";
import { listBrandsWithPartCounts } from "@/lib/queries/brands";
import { getPartById } from "@/lib/queries/parts";
import { listSuppliers } from "@/lib/queries/suppliers";

import { archivePartAction, updatePartAction } from "../../actions";
import { ArchivePartButton } from "../../ArchivePartButton";
import { PartForm } from "../../PartForm";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: "Onderdeel bewerken — Voorraadbeheer",
};

/**
 * Bewerkpagina van een onderdeel (SPEC §F3, T08). Zelfde formulier als
 * `/onderdelen/nieuw`, nu gevuld met de huidige waarden en gekoppeld aan
 * `updatePartAction`. Archiveren kan ook vanaf hier, met bevestiging (SPEC: "vanaf de
 * bewerkpagina").
 *
 * Gebruikt `getPartById` (T06) — geeft ook een al gearchiveerd onderdeel terug, zodat
 * een bestaande link blijft werken en de archiefstatus getoond kan worden.
 */
export default async function OnderdeelBewerkenPagina({ params }: PageProps) {
  const { id } = await params;
  const [part, brands, suppliers] = await Promise.all([
    getPartById(id),
    listBrandsWithPartCounts(),
    listSuppliers(),
  ]);

  if (!part) {
    notFound();
  }

  const boundUpdateAction = updatePartAction.bind(null, part.id);
  const boundArchiveAction = archivePartAction.bind(null, part.id);
  const isArchived = part.archivedAt !== null;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={`${part.name} bewerken`}
        description="Naam, SKU en categorie zijn verplicht. Merk en leverancier mogen leeg blijven."
      />

      {isArchived && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Dit onderdeel is gearchiveerd. Wijzigingen opslaan blijft mogelijk, maar het
          onderdeel blijft daarna verborgen in het voorraadoverzicht.
        </p>
      )}

      <PartForm
        action={boundUpdateAction}
        submitLabel="Wijzigingen opslaan"
        brands={brands.map((brand) => ({ id: brand.id, name: brand.name }))}
        suppliers={suppliers.map((supplier) => ({
          id: supplier.id,
          name: supplier.name,
        }))}
        initialValues={{
          name: part.name,
          sku: part.sku,
          category: part.category,
          brandId: part.brand?.id ?? null,
          supplierId: part.supplier?.id ?? null,
          barcode: part.barcode,
          description: part.description,
          fitsModels: part.fitsModels,
          location: part.location,
          purchasePrice: part.purchasePrice,
          salePrice: part.salePrice,
          vatRate: part.vatRate,
          stockQuantity: part.stockQuantity,
          minStock: part.minStock,
        }}
      />

      {!isArchived && (
        <div className="mt-8 border-t border-gray-200 pt-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            Onderdeel archiveren
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            Het onderdeel verdwijnt dan uit het voorraadoverzicht; de
            verkoophistorie blijft bewaard.
          </p>
          <ArchivePartButton action={boundArchiveAction} partName={part.name} />
        </div>
      )}
    </div>
  );
}
