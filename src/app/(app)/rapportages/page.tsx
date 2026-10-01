import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { MarginBasisNote, PriceWithVat } from "@/components/PriceWithVat";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
} from "@/components/Table";
import { ReportIcon } from "@/components/icons";
import { getSaleChannelLabel } from "@/lib/labels";
import { formatEuro } from "@/lib/money";
import { getReportData } from "@/lib/queries/reports";

import {
  normalizeSearchParams,
  parseReportSearchParams,
  reportsExportQuery,
  type RawSearchParams,
} from "./report-filters";
import { ReportsFilters } from "./ReportsFilters";
import { RevenueBarChart } from "./RevenueBarChart";

export const metadata: Metadata = {
  title: "Rapportages — Voorraadbeheer",
};

/** Nederlandse notatie voor een percentage, bv. `12,5%`. */
function formatMarginPct(value: number): string {
  const formatted = new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted}%`;
}

/**
 * Rapportagepagina (SPEC §F6, taak T15). Server Component: leest de filters uit
 * `searchParams` (in Next.js 15 een Promise, dus `await`) en haalt daarmee direct de
 * juiste, al in de database geaggregeerde cijfers op via `getReportData` — deze
 * pagina rekent zelf niets uit (dat is de taak van `@/lib/queries/reports`).
 *
 * ALLE filterstatus staat in de URL (`preset`/`from`/`to`, `category`, `bucket`),
 * zodat een gedeelde link exact dezelfde rapportage toont.
 */
export default async function RapportagesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const current = normalizeSearchParams(raw);
  const { period, category, bucketSize } = parseReportSearchParams(current);

  const data = await getReportData(
    { from: period.from, to: period.to, category },
    { bucketSize },
  );

  const hasSales = data.summary.transactionCount > 0;
  const exportHref = `/rapportages/export?${reportsExportQuery(period, category, bucketSize)}`;

  return (
    <div>
      <PageHeader
        title="Rapportages"
        description="Omzet, marge en bestsellers over de gekozen periode. De omzet staat met het bedrag inclusief btw als hoofdbedrag en het bedrag exclusief btw eronder; marge, margepercentage en alle uitsplitsingen hieronder rekenen op excl.-basis."
      />

      <ReportsFilters warning={period.warning} />

      {!hasSales ? (
        <EmptyState
          icon={<ReportIcon className="h-10 w-10 text-gray-400" />}
          title="Geen verkopen in deze periode"
          description="Er zijn geen verkopen of werkplaatsregels die aan de gekozen periode en filters voldoen. Kies een andere periode of wis de categoriefilter."
          action={
            <Link href="/rapportages" className="text-sm font-medium text-blue-700 hover:underline">
              Filters wissen
            </Link>
          }
        />
      ) : (
        <>
          {/* Kerncijfers */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {/* Omzet: incl. btw als hoofdbedrag, excl. eronder (T18). De marge
                ernaast blijft uitsluitend excl., met de toelichting erbij — dit is de
                plek waar "btw is winst" het meeste geld zou kosten. */}
            <Card>
              <p className="text-sm text-gray-500">Omzet</p>
              <PriceWithVat
                incl={data.summary.revenueIncl}
                excl={data.summary.revenue}
                size="lg"
                className="mt-1"
              />
            </Card>
            <Card>
              <p className="text-sm text-gray-500">Marge (excl. btw)</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {formatEuro(data.summary.margin)}
              </p>
              <MarginBasisNote className="mt-0.5" />
            </Card>
            <Card>
              <p className="text-sm text-gray-500">Margepercentage (excl. btw)</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {formatMarginPct(data.summary.marginPct)}
              </p>
            </Card>
            <Card>
              <p className="text-sm text-gray-500">Verkochte stuks</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {data.summary.itemsSold}
              </p>
            </Card>
            <Card>
              <p className="text-sm text-gray-500">Transacties</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">
                {data.summary.transactionCount}
              </p>
            </Card>
          </div>

          {/* Balie versus werkplaats */}
          <Card title="Balie versus werkplaats" className="mb-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {data.channelBreakdown.map((row) => (
                <div key={row.channel} className="rounded-md border border-gray-100 p-3">
                  <p className="text-sm font-medium text-gray-700">
                    {getSaleChannelLabel(row.channel)}
                  </p>
                  <PriceWithVat
                    incl={row.revenueIncl}
                    excl={row.revenue}
                    size="md"
                    className="mt-1"
                  />
                  <p className="text-sm text-gray-500">
                    Marge {formatEuro(row.margin)} excl. btw · {row.itemsSold} stuks ·{" "}
                    {row.transactionCount} transacties
                  </p>
                </div>
              ))}
            </div>
          </Card>

          {/* Omzetverloop */}
          <Card title="Omzetverloop (excl. btw)" className="mb-6">
            <RevenueBarChart points={data.revenueOverTime} bucketSize={bucketSize} />
          </Card>

          {/* Omzet per merk en per categorie */}
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Omzet per merk (excl. btw)">
              {data.revenueByBrand.length === 0 ? (
                <p className="text-sm text-gray-500">Geen gegevens.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {data.revenueByBrand.map((row) => (
                    <li
                      key={row.brandId ?? "unbranded"}
                      className="flex items-center justify-between gap-2 py-2 text-sm"
                    >
                      <span className="text-gray-900">{row.brandName}</span>
                      <span className="text-right text-gray-700">
                        <span className="whitespace-nowrap">
                          {formatEuro(row.revenue)}
                        </span>
                        <span className="ml-1 whitespace-nowrap text-gray-400">
                          ({formatEuro(row.margin)} marge)
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Omzet per categorie (excl. btw)">
              {data.revenueByCategory.length === 0 ? (
                <p className="text-sm text-gray-500">Geen gegevens.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {data.revenueByCategory.map((row) => (
                    <li
                      key={row.category}
                      className="flex items-center justify-between gap-2 py-2 text-sm"
                    >
                      <span className="text-gray-900">{row.categoryLabel}</span>
                      <span className="text-right text-gray-700">
                        <span className="whitespace-nowrap">
                          {formatEuro(row.revenue)}
                        </span>
                        <span className="ml-1 whitespace-nowrap text-gray-400">
                          ({formatEuro(row.margin)} marge)
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Bestsellers */}
          <Card
            title="Bestsellers"
            actions={
              <a
                href={exportHref}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                Exporteren als CSV
              </a>
            }
          >
            <p className="mb-3 text-xs text-gray-500">
              De CSV gebruikt een puntkomma als scheidingsteken en een komma als
              decimaalteken (Excel-NL-conventie) en bevat een UTF-8 BOM zodat Excel
              het bestand automatisch correct opent — zie de toelichting in{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5">@/lib/csv</code>. De
              kolommen omzet en marge staan <strong>exclusief btw</strong>; dat staat
              ook in de kopregel van het bestand.
            </p>

            <Table className="hidden md:block">
              <TableHead>
                <tr>
                  <TableHeaderCell>Onderdeel</TableHeaderCell>
                  <TableHeaderCell>SKU</TableHeaderCell>
                  <TableHeaderCell>Merk</TableHeaderCell>
                  <TableHeaderCell className="text-right">Stuks</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Omzet (excl. btw)
                  </TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Marge (excl. btw)
                  </TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {data.bestsellers.map((row) => (
                  <tr key={row.partId}>
                    <TableCell>
                      {row.name}
                      {row.isArchived && (
                        <span className="ml-2 text-xs text-gray-400">(gearchiveerd)</span>
                      )}
                    </TableCell>
                    <TableCell>{row.sku}</TableCell>
                    <TableCell>{row.brandName ?? "—"}</TableCell>
                    <TableCell className="text-right">{row.quantitySold}</TableCell>
                    <TableCell className="text-right">{formatEuro(row.revenue)}</TableCell>
                    <TableCell className="text-right">{formatEuro(row.margin)}</TableCell>
                  </tr>
                ))}
              </TableBody>
            </Table>

            <div className="grid gap-3 md:hidden">
              {data.bestsellers.map((row) => (
                <Card key={row.partId} className="p-3">
                  <p className="font-medium text-gray-900">
                    {row.name}
                    {row.isArchived && (
                      <span className="ml-2 text-xs text-gray-400">(gearchiveerd)</span>
                    )}
                  </p>
                  <p className="text-sm text-gray-500">
                    {row.sku} · {row.brandName ?? "Zonder merk"}
                  </p>
                  <p className="mt-1 text-sm text-gray-700">
                    {row.quantitySold} stuks · {formatEuro(row.revenue)} omzet ·{" "}
                    {formatEuro(row.margin)} marge{" "}
                    <span className="text-gray-500">(beide excl. btw)</span>
                  </p>
                </Card>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
