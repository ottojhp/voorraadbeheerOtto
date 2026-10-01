import type { Metadata } from "next";
import Link from "next/link";

import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { SimplePagination } from "@/components/SimplePagination";
import { StockMutationList } from "@/components/StockMutationList";
import { HistoryIcon } from "@/components/icons";
import { listStockMutations } from "@/lib/queries/stock-mutations";
import { formatDelta } from "@/lib/stock-mutation-format";

import { MutationsFilters } from "./MutationsFilters";
import {
  buildMutationsQuery,
  normalizeSearchParams,
  parseMutationSearchParams,
  type RawSearchParams,
} from "./search-params";

export const metadata: Metadata = {
  title: "Voorraadmutaties — Voorraadbeheer",
};

const PATH = "/voorraadmutaties";

/**
 * Voorraadmutaties op `/voorraadmutaties` (T24): alle wijzigingen van het
 * voorraadgrootboek over alle onderdelen, nieuwste bovenaan. Beantwoordt "wat is er
 * vandaag in de zaak gebeurd"; de vraag "wat is er met dít onderdeel gebeurd"
 * beantwoordt het blok "Voorraadgeschiedenis" op `/onderdelen/[id]`.
 *
 * Server Component. `searchParams` is in Next.js 15 een Promise en wordt dus
 * ge-await. Filters (reden, periode) en paginanummer staan in de URL; de pagina
 * rekent zelf niets uit: filteren, pagineren en de totalen gebeuren in de database
 * (`listStockMutations`).
 */
export default async function VoorraadmutatiesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const current = normalizeSearchParams(raw);
  const { filters, page, hasFilter, warning } = parseMutationSearchParams(current);

  const result = await listStockMutations({ ...filters, page });
  const { totals } = result;

  return (
    <div>
      <PageHeader
        title="Voorraadmutaties"
        description={`${totals.count} ${totals.count === 1 ? "wijziging" : "wijzigingen"}${
          hasFilter ? " gevonden" : " in het voorraadgrootboek"
        }.`}
      />

      <MutationsFilters warning={warning} />

      {result.items.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon className="h-10 w-10 text-gray-400" />}
          title={hasFilter ? "Geen mutaties gevonden" : "Nog geen voorraadmutaties"}
          description={
            hasFilter
              ? "Er zijn geen voorraadwijzigingen die aan deze filters voldoen. Pas de filters aan of wis ze."
              : "Zodra er voorraad wordt bijgeboekt, afgeboekt of verkocht, staat de wijziging hier."
          }
          action={
            hasFilter ? (
              <Link href={PATH} className="text-sm font-medium text-blue-700 hover:underline">
                Filters wissen
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Totalen over ALLE gefilterde regels (uit de database), niet alleen de
              getoonde pagina. */}
          <p className="mb-3 text-sm text-gray-600">
            <span className="font-medium text-green-800">
              {formatDelta(totals.added)} stuks erbij
            </span>
            {" · "}
            <span className="font-medium text-red-800">
              {formatDelta(-totals.removed)} stuks eraf
            </span>
          </p>
          <Card className="px-4 py-1">
            <StockMutationList
              items={result.items}
              showPart
              ariaLabel="Voorraadmutaties"
            />
          </Card>
          <SimplePagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            pageSize={result.pageSize}
            noun="mutaties"
            ariaLabel="Paginering voorraadmutaties"
            hrefFor={(target) => `${PATH}${buildMutationsQuery(current, { page: target })}`}
          />
        </>
      )}
    </div>
  );
}
