import type { Metadata } from "next";
import Link from "next/link";

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
import { DashboardIcon, SaleIcon, StockIcon } from "@/components/icons";
import { getSaleChannelLabel } from "@/lib/labels";
import { formatEuro } from "@/lib/money";
import {
  getDashboardData,
  type BestsellerDTO,
  type DashboardRecentSaleDTO,
} from "@/lib/queries/dashboard";

export const metadata: Metadata = {
  title: "Dashboard — Voorraadbeheer",
};

/** Datum + tijd in Nederlandse notatie, bv. `22 sep 2026, 14:05`. */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Eén bestsellerlijst, gedeeld tussen de "laatste 30 dagen"- en de all-time-kaart. */
function BestsellerList({ items }: { items: BestsellerDTO[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">Nog geen verkopen.</p>;
  }

  return (
    <ol className="divide-y divide-gray-100">
      {items.map((item, index) => (
        <li key={item.partId} className="flex items-center justify-between gap-2 py-2 text-sm">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="text-gray-400">{index + 1}.</span>
            <span className="truncate text-gray-900">
              {item.name}
              {item.isArchived && (
                <span className="ml-2 text-xs text-gray-400">(gearchiveerd)</span>
              )}
            </span>
          </span>
          <span className="shrink-0 text-right text-gray-700">
            {item.quantitySold} stuks
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Dashboard op `/` (SPEC §F1, taak T14). Server Component: haalt alle aggregaties in
 * één keer op via `getDashboardData` (die de vijf blokken zelf parallel ophaalt met
 * `Promise.all`) — deze pagina rekent zelf niets uit, dat is de taak van
 * `@/lib/queries/dashboard`.
 *
 * Alle bedragen zijn EXCLUSIEF btw (SPEC §3 regel 0), wat hier expliciet bij staat
 * omdat dit de eerste pagina is die een eigenaar ziet.
 */
export default async function HomePage() {
  const data = await getDashboardData();
  const { totals } = data;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Overzicht van voorraad en verkopen — alle bedragen exclusief btw."
      />

      {/* Kerncijfers */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card>
          <p className="text-sm text-gray-500">Voorraadwaarde inkoop</p>
          <p className="mt-1 text-xl font-semibold text-gray-900">
            {formatEuro(totals.stockValuePurchase)}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Voorraadwaarde verkoop</p>
          <p className="mt-1 text-xl font-semibold text-gray-900">
            {formatEuro(totals.stockValueSale)}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Unieke onderdelen</p>
          <p className="mt-1 text-xl font-semibold text-gray-900">
            {totals.uniquePartCount}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Totaal aantal stuks</p>
          <p className="mt-1 text-xl font-semibold text-gray-900">
            {totals.totalStockQuantity}
          </p>
        </Card>
        <Link href="/onderdelen?lowStockOnly=1" className="block">
          <Card
            className={
              totals.lowStockCount > 0
                ? "h-full border-amber-300 bg-amber-50 transition-colors hover:bg-amber-100"
                : "h-full transition-colors hover:bg-gray-50"
            }
          >
            <p className="text-sm text-gray-500">Onder minimumvoorraad</p>
            <p
              className={`mt-1 text-xl font-semibold ${
                totals.lowStockCount > 0 ? "text-amber-800" : "text-gray-900"
              }`}
            >
              {totals.lowStockCount}
            </p>
          </Card>
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Lage voorraad */}
        <Card title="Lage voorraad">
          {data.lowStockParts.length === 0 ? (
            <EmptyState
              icon={<StockIcon className="h-10 w-10 text-gray-400" />}
              title="Geen onderdelen onder de minimumvoorraad"
              description="Alle onderdelen met een ingestelde drempel zitten boven hun minimumvoorraad."
            />
          ) : (
            <>
              <Table className="hidden md:block">
                <TableHead>
                  <tr>
                    <TableHeaderCell>Onderdeel</TableHeaderCell>
                    <TableHeaderCell>Leverancier</TableHeaderCell>
                    <TableHeaderCell className="text-right">Voorraad</TableHeaderCell>
                    <TableHeaderCell className="text-right">Min.</TableHeaderCell>
                    <TableHeaderCell className="text-right">Tekort</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {data.lowStockParts.map((part) => (
                    <tr key={part.id}>
                      <TableCell>
                        <Link
                          href={`/onderdelen/${part.id}`}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {part.name}
                        </Link>
                        <span className="ml-2 text-xs text-gray-400">{part.sku}</span>
                      </TableCell>
                      <TableCell>{part.supplierName ?? "—"}</TableCell>
                      <TableCell className="text-right">{part.stockQuantity}</TableCell>
                      <TableCell className="text-right">{part.minStock}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="danger">-{part.shortage}</Badge>
                      </TableCell>
                    </tr>
                  ))}
                </TableBody>
              </Table>

              <div className="grid gap-3 md:hidden">
                {data.lowStockParts.map((part) => (
                  <Card key={part.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/onderdelen/${part.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {part.name}
                      </Link>
                      <Badge variant="danger">-{part.shortage}</Badge>
                    </div>
                    <p className="text-sm text-gray-500">
                      {part.sku} · {part.supplierName ?? "Geen leverancier"}
                    </p>
                    <p className="mt-1 text-sm text-gray-700">
                      Voorraad {part.stockQuantity} · minimum {part.minStock}
                    </p>
                  </Card>
                ))}
              </div>

              <div className="mt-3 text-right">
                <Link
                  href="/onderdelen?lowStockOnly=1"
                  className="text-sm font-medium text-blue-700 hover:underline"
                >
                  Alle onderdelen met lage voorraad bekijken
                </Link>
              </div>
            </>
          )}
        </Card>

        {/* Laatste verkopen */}
        <Card title="Laatste verkopen">
          {data.recentSales.length === 0 ? (
            <EmptyState
              icon={<SaleIcon className="h-10 w-10 text-gray-400" />}
              title="Nog geen verkopen"
              description="Zodra er verkocht of werkplaatsverbruik geregistreerd wordt, staat het hier."
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.recentSales.map((sale: DashboardRecentSaleDTO) => (
                <li key={sale.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-gray-900">
                      {sale.partName}
                      {sale.isArchived && (
                        <span className="ml-2 text-xs text-gray-400">(gearchiveerd)</span>
                      )}
                    </span>
                    <span className="shrink-0 text-right text-gray-700">
                      {formatEuro(sale.lineTotalExclVat)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-gray-500">
                    <span>
                      {sale.quantity}x · {getSaleChannelLabel(sale.channel)}
                    </span>
                    <span>{formatDateTime(sale.soldAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Bestsellers */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Bestsellers — laatste 30 dagen">
          <BestsellerList items={data.bestsellersLast30Days} />
        </Card>
        <Card title="Bestsellers — all-time">
          <BestsellerList items={data.bestsellersAllTime} />
        </Card>
      </div>

      {totals.uniquePartCount === 0 && data.recentSales.length === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={<DashboardIcon className="h-10 w-10 text-gray-400" />}
            title="Nog geen gegevens"
            description="Voeg onderdelen toe en registreer verkopen om hier cijfers te zien."
            action={
              <Link
                href="/onderdelen/nieuw"
                className="text-sm font-medium text-blue-700 hover:underline"
              >
                Eerste onderdeel toevoegen
              </Link>
            }
          />
        </div>
      )}
    </div>
  );
}
