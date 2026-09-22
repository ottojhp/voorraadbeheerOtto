import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/PageHeader";
import { getSupplierById } from "@/lib/queries/suppliers";

import { archiveSupplierAction, updateSupplierAction } from "../../actions";
import { ArchiveSupplierButton } from "../../ArchiveSupplierButton";
import { SupplierForm } from "../../SupplierForm";

interface PageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: "Leverancier bewerken — Voorraadbeheer",
};

/**
 * Bewerkpagina van een leverancier (SPEC §F5, T13). Zelfde formulier als
 * `/leveranciers/nieuw`, nu gevuld met de huidige waarden en gekoppeld aan
 * `updateSupplierAction`. Archiveren kan ook vanaf hier (SPEC: "vanaf de bewerk- of
 * detailpagina").
 */
export default async function LeverancierBewerkenPagina({ params }: PageProps) {
  const { id } = await params;
  const supplier = await getSupplierById(id);

  if (!supplier) {
    notFound();
  }

  const boundUpdateAction = updateSupplierAction.bind(null, supplier.id);
  const boundArchiveAction = archiveSupplierAction.bind(null, supplier.id);
  const isArchived = supplier.archivedAt !== null;

  return (
    <div className="max-w-xl">
      <PageHeader
        title={`${supplier.name} bewerken`}
        description="Naam is verplicht. Overige velden zijn optioneel."
      />
      <SupplierForm
        action={boundUpdateAction}
        submitLabel="Wijzigingen opslaan"
        initialValues={{
          name: supplier.name,
          contactPerson: supplier.contactPerson,
          phone: supplier.phone,
          email: supplier.email,
          address: supplier.address,
          notes: supplier.notes,
        }}
      />

      {!isArchived && (
        <div className="mt-8 border-t border-gray-200 pt-6">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            Leverancier archiveren
          </h2>
          <p className="mb-3 text-sm text-gray-500">
            Dit kan alleen als er geen actieve onderdelen meer aan deze leverancier
            gekoppeld zijn.
          </p>
          <ArchiveSupplierButton
            action={boundArchiveAction}
            supplierName={supplier.name}
          />
        </div>
      )}
    </div>
  );
}
