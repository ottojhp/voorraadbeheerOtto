import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { listBrandsWithPartCounts } from "@/lib/queries/brands";
import { BrandRow } from "./BrandRow";
import { NewBrandForm } from "./NewBrandForm";

/**
 * Merkenbeheer (T09): een klein CRUD-scherm zodat een nieuw merk toegevoegd kan
 * worden zonder seed of database-toegang. Merken worden gebruikt bij onderdelen
 * (`Part.brandId`, optioneel — universele onderdelen zoals olie en remblokken
 * hebben geen merk); de koppeling vanuit het onderdeelformulier zelf wordt in een
 * andere taak (T08) gelegd.
 */
export default async function BrandsPage() {
  const brands = await listBrandsWithPartCounts();

  return (
    <>
      <PageHeader
        title="Merken"
        description="Merken worden gebruikt bij onderdelen. Elk onderdeel kan een merk hebben, of geen — voor universele onderdelen zoals olie, remblokken en kabels."
      />

      <div className="flex flex-col gap-6">
        <Card title="Nieuw merk">
          <NewBrandForm />
        </Card>

        <Card title={`Merken (${brands.length})`}>
          {brands.length === 0 ? (
            <EmptyState
              title="Nog geen merken"
              description="Voeg hierboven het eerste merk toe, bijvoorbeeld Vespa of Piaggio."
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {brands.map((brand) => (
                <BrandRow key={brand.id} brand={brand} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
