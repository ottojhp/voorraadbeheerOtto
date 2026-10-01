import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { MarginBasisNote, PriceWithVat } from "@/components/PriceWithVat";
import { CATEGORY_LABELS } from "@/lib/labels";
import { formatEuro } from "@/lib/money";
import { getPartById } from "@/lib/queries/parts";

import { archivePartAction } from "../actions";
import { ArchivePartButton } from "../ArchivePartButton";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ opgeslagen?: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const part = await getPartById(id);
  return { title: part ? `${part.name} — Onderdelen` : "Onderdeel" };
}

const EDIT_LINK_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2";

const CONFIRMATION_MESSAGES: Record<string, string> = {
  aangemaakt: "Onderdeel is aangemaakt.",
  bijgewerkt: "Wijzigingen zijn opgeslagen.",
  gearchiveerd: "Onderdeel is gearchiveerd.",
};

/**
 * Detailpagina van een onderdeel (SPEC §F3, T08): alle gegevens, marge, prijzen met
 * het incl.-bedrag als hoofdbedrag en het excl.-bedrag eronder (T18, via
 * `PriceWithVat`), voorraadstand, leverancier (met link naar `/leveranciers/[id]`,
 * T13) en knoppen naar bewerken en archiveren. Toont een duidelijke melding na
 * aanmaken/bewerken/archiveren via `?opgeslagen=` (gezet door de server actions in
 * `../actions.ts`, die na afloop hierheen redirecten) en een duidelijke markering als
 * het onderdeel gearchiveerd is.
 *
 * Gebruikt `getPartById` (T06), die ook een gearchiveerd onderdeel teruggeeft — nodig
 * om de archiefstatus hier te kunnen tonen (SPEC §3 regel 4: gearchiveerde
 * onderdelen blijven zichtbaar in rapportages en op hun eigen pagina).
 */
export default async function OnderdeelDetailPagina({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const { opgeslagen } = await searchParams;
  const part = await getPartById(id);

  if (!part) {
    notFound();
  }

  const boundArchiveAction = archivePartAction.bind(null, part.id);
  const isArchived = part.archivedAt !== null;
  const confirmationMessage = opgeslagen
    ? CONFIRMATION_MESSAGES[opgeslagen]
    : undefined;

  return (
    <div>
      <PageHeader
        title={part.name}
        description={`SKU: ${part.sku}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/onderdelen/${part.id}/bewerken`} className={EDIT_LINK_CLASSES}>
              Bewerken
            </Link>
            {!isArchived && (
              <ArchivePartButton action={boundArchiveAction} partName={part.name} />
            )}
          </div>
        }
      />

      {confirmationMessage && (
        <p
          role="status"
          className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900"
        >
          {confirmationMessage}
        </p>
      )}

      {isArchived && (
        <Badge variant="warning" className="mb-4">
          Gearchiveerd
        </Badge>
      )}
      {part.isLowStock && !isArchived && (
        <Badge variant="danger" className="mb-4 ml-2">
          Lage voorraad
        </Badge>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Gegevens">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-gray-500">Categorie</dt>
              <dd className="text-gray-900">{CATEGORY_LABELS[part.category]}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Merk</dt>
              <dd className="text-gray-900">{part.brand?.name ?? "Geen merk / universeel"}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">SKU</dt>
              <dd className="text-gray-900">{part.sku}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Barcode</dt>
              <dd className="text-gray-900">{part.barcode ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Leverancier</dt>
              <dd className="text-gray-900">
                {part.supplier ? (
                  <Link
                    href={`/leveranciers/${part.supplier.id}`}
                    className="text-blue-700 hover:underline"
                  >
                    {part.supplier.name}
                  </Link>
                ) : (
                  "Geen leverancier"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Schaplocatie</dt>
              <dd className="text-gray-900">{part.location ?? "—"}</dd>
            </div>
            {part.fitsModels && (
              <div className="sm:col-span-2">
                <dt className="text-sm text-gray-500">Past op</dt>
                <dd className="whitespace-pre-line text-gray-900">{part.fitsModels}</dd>
              </div>
            )}
            {part.description && (
              <div className="sm:col-span-2">
                <dt className="text-sm text-gray-500">Omschrijving</dt>
                <dd className="whitespace-pre-line text-gray-900">{part.description}</dd>
              </div>
            )}
          </dl>
        </Card>

        <Card title="Prijs en voorraad">
          <dl className="grid gap-3 sm:grid-cols-2">
            {/* Prijzen in de vaste T18-vorm: incl. btw als hoofdbedrag, excl. btw
                kleiner eronder — voor de verkoopprijs én de inkoopprijs. */}
            <div>
              <dt className="text-sm text-gray-500">Verkoopprijs</dt>
              <dd>
                <PriceWithVat
                  incl={part.salePriceIncl}
                  excl={part.salePriceExcl}
                  size="md"
                />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Inkoopprijs</dt>
              <dd>
                <PriceWithVat
                  incl={part.purchasePriceIncl}
                  excl={part.purchasePriceExcl}
                  size="md"
                />
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Btw-tarief</dt>
              <dd className="text-gray-900">{part.vatRate}%</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Marge (excl. btw)</dt>
              <dd className="font-semibold text-gray-900">
                {formatEuro(part.margin)} ({part.marginPct.toFixed(1).replace(".", ",")}%)
              </dd>
              <MarginBasisNote className="mt-0.5" />
            </div>
            <div>
              <dt className="text-sm text-gray-500">Voorraad</dt>
              <dd className="text-gray-900">
                {part.stockQuantity} stuks
                {part.isLowStock && (
                  <span className="ml-1 text-amber-700">(onder minimum)</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Minimumvoorraad</dt>
              <dd className="text-gray-900">{part.minStock} stuks</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
