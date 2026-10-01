/**
 * "Laatste verkopen" onder het verkoopscherm (SPEC §F4), afgesplitst van
 * `verkoop/page.tsx` (T21).
 *
 * ### Waarom een eigen component
 *
 * Dit lijstje is bijzaak: de balie moet kunnen zoeken, scannen en verkopen, ook als
 * het ophalen van de historie faalt. Tot T21 stond hier
 * `listRecentSales(...).catch(() => [])` in de pagina — die slikte élke databasefout
 * stil weg en toonde "Er zijn nog geen verkopen geregistreerd.", precies de stille
 * mislukking die SPEC §F8 verbiedt: de gebruiker kon niet zien of er echt niets
 * verkocht was of dat de query stuk was.
 *
 * Door dit deel in een eigen async server component te zetten met een expliciet
 * `{ ok, ... }`-resultaat geldt:
 *
 * - faalt de query, dan verschijnt hier een duidelijke Nederlandse melding op de plek
 *   van de lijst (en een regel in de serverlog), terwijl de rest van de pagina normaal
 *   rendert;
 * - de fout wordt BINNEN deze component afgehandeld en niet doorgegooid. Een
 *   `error.tsx`-boundary zou de hele route vervangen — dus ook het verkoopformulier —
 *   en dat is precies wat hier niet mag gebeuren.
 */

import { Card } from "@/components/Card";
import { PriceWithVat } from "@/components/PriceWithVat";
import { formatCompactDateTime } from "@/lib/datetime";
import { SALE_CHANNEL_LABELS } from "@/lib/labels";
import { formatEuro, formatPercent } from "@/lib/money";
import { listRecentSales, type RecentSaleDTO } from "@/lib/queries/sales";

/** Resultaat van het ophalen: gelukt met data, of mislukt met een toonbare melding. */
type RecentSalesResult =
  | { ok: true; sales: RecentSaleDTO[] }
  | { ok: false; error: string };

/**
 * Haalt de laatste verkopen op en vertaalt een mislukking naar een toonbare
 * Nederlandse melding in plaats van een lege lijst.
 */
async function loadRecentSales(limit: number): Promise<RecentSalesResult> {
  try {
    return { ok: true, sales: await listRecentSales(limit) };
  } catch (error) {
    // De technische oorzaak hoort in de serverlog, niet op het scherm van de balie.
    console.error("Kon de laatste verkopen niet ophalen", error);
    return {
      ok: false,
      error:
        "De laatste verkopen konden niet worden opgehaald. Verkopen registreren werkt wel; vernieuw de pagina om het opnieuw te proberen.",
    };
  }
}

export interface RecentSalesCardProps {
  /** Aantal regels dat maximaal wordt getoond. */
  limit: number;
}

export async function RecentSalesCard({ limit }: RecentSalesCardProps) {
  const result = await loadRecentSales(limit);

  return (
    <Card title="Laatste verkopen">
      {!result.ok ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {result.error}
        </p>
      ) : result.sales.length === 0 ? (
        <p className="text-sm text-gray-600">
          Er zijn nog geen verkopen geregistreerd.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-gray-200">
          {result.sales.map((sale) => (
            <li
              key={sale.id}
              className="flex items-start justify-between gap-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {sale.quantity}&times; {sale.partName}
                </p>
                <p className="text-xs text-gray-500">
                  {SALE_CHANNEL_LABELS[sale.channel]}
                  {sale.reference ? ` · ${sale.reference}` : ""} ·{" "}
                  {formatCompactDateTime(sale.soldAt)}
                </p>
                {/* Gegeven korting met de reden, als die er is (T26). */}
                {sale.hasDiscount && (
                  <p className="text-xs text-amber-800">
                    {formatEuro(sale.discountTotalIncl)} korting (
                    {formatPercent(sale.discountPct)})
                    {sale.discountReason ? ` · ${sale.discountReason}` : ""}
                  </p>
                )}
              </div>
              {/* Het betaalde bedrag (incl. btw) is het hoofdbedrag; het
                  excl.-stuurgetal staat eronder (T18). Is er korting gegeven, dan
                  staat de originele prijs doorgestreept erboven (T26) — zo is in
                  één blik te zien dát er korting is gegeven. */}
              <div className="shrink-0 text-right">
                {sale.hasDiscount && (
                  <s className="block whitespace-nowrap text-xs text-gray-400">
                    {formatEuro(sale.lineTotalListInclVat)}
                  </s>
                )}
                <PriceWithVat
                  incl={sale.lineTotalInclVat}
                  excl={sale.lineTotalExclVat}
                  align="right"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
