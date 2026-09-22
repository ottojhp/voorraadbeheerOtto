import type { Metadata } from "next";
import Link from "next/link";

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
import { SupplierIcon } from "@/components/icons";
import { listSuppliers } from "@/lib/queries/suppliers";

export const metadata: Metadata = {
  title: "Leveranciers — Voorraadbeheer",
};

const NEW_SUPPLIER_LINK_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";

/**
 * Leveranciersoverzicht (SPEC §F5, T13). Toont naam, contactpersoon, telefoon,
 * e-mail en het aantal gekoppelde ACTIEVE onderdelen. Telefoon en e-mail zijn
 * `tel:`/`mailto:`-links (belangrijk aan de balie op mobiel). Op 375px een
 * kaartweergave in plaats van een brede tabel; gearchiveerde leveranciers verschijnen
 * hier niet (afgehandeld in `listSuppliers`).
 */
export default async function LeveranciersPage() {
  const suppliers = await listSuppliers();

  return (
    <div>
      <PageHeader
        title="Leveranciers"
        description="Contactgegevens en het aantal gekoppelde actieve onderdelen."
        actions={
          <Link href="/leveranciers/nieuw" className={NEW_SUPPLIER_LINK_CLASSES}>
            Nieuwe leverancier
          </Link>
        }
      />

      {suppliers.length === 0 ? (
        <EmptyState
          icon={<SupplierIcon className="h-10 w-10 text-gray-400" />}
          title="Nog geen leveranciers"
          description="Voeg een leverancier toe om onderdelen aan te koppelen en besteladvies bruikbaar te maken."
          action={
            <Link href="/leveranciers/nieuw" className={NEW_SUPPLIER_LINK_CLASSES}>
              Nieuwe leverancier
            </Link>
          }
        />
      ) : (
        <>
          {/* Desktop/tablet: tabel. Nooit zichtbaar op 375px (SPEC §3 regel 8). */}
          <Table className="hidden md:block">
            <TableHead>
              <tr>
                <TableHeaderCell>Naam</TableHeaderCell>
                <TableHeaderCell>Contactpersoon</TableHeaderCell>
                <TableHeaderCell>Telefoon</TableHeaderCell>
                <TableHeaderCell>E-mail</TableHeaderCell>
                <TableHeaderCell>Actieve onderdelen</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id}>
                  <TableCell>
                    <Link
                      href={`/leveranciers/${supplier.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {supplier.name}
                    </Link>
                  </TableCell>
                  <TableCell>{supplier.contactPerson ?? "—"}</TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>{supplier.activePartCount}</TableCell>
                </tr>
              ))}
            </TableBody>
          </Table>

          {/* Mobiel: kaarten in plaats van een brede tabel (SPEC §F2/§F8-stijl, §3 regel 8). */}
          <div className="grid gap-3 md:hidden">
            {suppliers.map((supplier) => (
              <Card key={supplier.id}>
                <Link
                  href={`/leveranciers/${supplier.id}`}
                  className="font-medium text-blue-700 hover:underline"
                >
                  {supplier.name}
                </Link>
                {supplier.contactPerson && (
                  <p className="mt-1 text-sm text-gray-600">
                    {supplier.contactPerson}
                  </p>
                )}
                <div className="mt-2 flex flex-col gap-1 text-sm">
                  {supplier.phone && (
                    <a
                      href={`tel:${supplier.phone}`}
                      className="text-blue-700 hover:underline"
                    >
                      {supplier.phone}
                    </a>
                  )}
                  {supplier.email && (
                    <a
                      href={`mailto:${supplier.email}`}
                      className="text-blue-700 hover:underline"
                    >
                      {supplier.email}
                    </a>
                  )}
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  {supplier.activePartCount}{" "}
                  {supplier.activePartCount === 1
                    ? "actief onderdeel"
                    : "actieve onderdelen"}
                </p>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
