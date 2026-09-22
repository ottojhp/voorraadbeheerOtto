import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
} from "@/components/Table";
import { getSupplierById } from "@/lib/queries/suppliers";

import { archiveSupplierAction } from "../actions";
import { ArchiveSupplierButton } from "../ArchiveSupplierButton";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supplier = await getSupplierById(id);
  return { title: supplier ? `${supplier.name} — Leveranciers` : "Leverancier" };
}

const EDIT_LINK_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2";

/**
 * Detailpagina van een leverancier (SPEC §F5, T13): contactgegevens en de gekoppelde
 * actieve onderdelen, met links naar de onderdeelpagina's (`/onderdelen/[id]`, T08 —
 * die route bestaat op het moment van schrijven nog niet, de link staat er vast).
 * Archiveren kan vanaf hier, met server-side gecontroleerde harde regel.
 */
export default async function LeverancierDetailPagina({ params }: PageProps) {
  const { id } = await params;
  const supplier = await getSupplierById(id);

  if (!supplier) {
    notFound();
  }

  const boundArchiveAction = archiveSupplierAction.bind(null, supplier.id);
  const isArchived = supplier.archivedAt !== null;

  return (
    <div>
      <PageHeader
        title={supplier.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/leveranciers/${supplier.id}/bewerken`}
              className={EDIT_LINK_CLASSES}
            >
              Bewerken
            </Link>
            {!isArchived && (
              <ArchiveSupplierButton
                action={boundArchiveAction}
                supplierName={supplier.name}
              />
            )}
          </div>
        }
      />

      {isArchived && (
        <Badge variant="warning" className="mb-4">
          Gearchiveerd
        </Badge>
      )}

      <Card title="Contactgegevens" className="mb-6">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-gray-500">Contactpersoon</dt>
            <dd className="text-gray-900">{supplier.contactPerson ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Telefoon</dt>
            <dd className="text-gray-900">
              {supplier.phone ? (
                <a
                  href={`tel:${supplier.phone}`}
                  className="text-blue-700 hover:underline"
                >
                  {supplier.phone}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">E-mail</dt>
            <dd className="text-gray-900">
              {supplier.email ? (
                <a
                  href={`mailto:${supplier.email}`}
                  className="text-blue-700 hover:underline"
                >
                  {supplier.email}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Adres</dt>
            <dd className="whitespace-pre-line text-gray-900">
              {supplier.address ?? "—"}
            </dd>
          </div>
          {supplier.notes && (
            <div className="sm:col-span-2">
              <dt className="text-sm text-gray-500">Notities</dt>
              <dd className="whitespace-pre-line text-gray-900">
                {supplier.notes}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <Card title={`Gekoppelde onderdelen (${supplier.parts.length})`}>
        {supplier.parts.length === 0 ? (
          <EmptyState
            title="Geen actieve onderdelen gekoppeld"
            description="Deze leverancier kan gearchiveerd worden."
          />
        ) : (
          <>
            <Table className="hidden md:block">
              <TableHead>
                <tr>
                  <TableHeaderCell>Naam</TableHeaderCell>
                  <TableHeaderCell>SKU</TableHeaderCell>
                  <TableHeaderCell>Voorraad</TableHeaderCell>
                  <TableHeaderCell>Min. voorraad</TableHeaderCell>
                  <TableHeaderCell>Verkoopprijs</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {supplier.parts.map((part) => (
                  <tr key={part.id}>
                    <TableCell>
                      <Link
                        href={`/onderdelen/${part.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {part.name}
                      </Link>
                    </TableCell>
                    <TableCell>{part.sku}</TableCell>
                    <TableCell>{part.stockQuantity}</TableCell>
                    <TableCell>{part.minStock}</TableCell>
                    <TableCell>
                      {new Intl.NumberFormat("nl-NL", {
                        style: "currency",
                        currency: "EUR",
                      }).format(part.salePrice)}
                    </TableCell>
                  </tr>
                ))}
              </TableBody>
            </Table>

            <div className="grid gap-3 md:hidden">
              {supplier.parts.map((part) => (
                <Card key={part.id} className="shadow-none">
                  <Link
                    href={`/onderdelen/${part.id}`}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    {part.name}
                  </Link>
                  <p className="mt-1 text-sm text-gray-500">{part.sku}</p>
                  <p className="mt-1 text-sm text-gray-700">
                    Voorraad: {part.stockQuantity} (min. {part.minStock})
                  </p>
                  <p className="text-sm text-gray-700">
                    {new Intl.NumberFormat("nl-NL", {
                      style: "currency",
                      currency: "EUR",
                    }).format(part.salePrice)}
                  </p>
                </Card>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
