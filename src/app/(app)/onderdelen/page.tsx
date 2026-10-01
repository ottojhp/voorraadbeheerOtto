import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ScanIcon, StockIcon } from "@/components/icons";
import { listBrandsWithPartCounts } from "@/lib/queries/brands";
import { countUnbrandedParts, listParts } from "@/lib/queries/parts";
import { listSuppliers } from "@/lib/queries/suppliers";

import { PartsFilters } from "./PartsFilters";
import { PartsPagination } from "./PartsPagination";
import { PartsTable } from "./PartsTable";
import {
  normalizeSearchParams,
  parsePartsSearchParams,
  type RawSearchParams,
} from "./search-params";

export const metadata: Metadata = {
  title: "Onderdelen — Voorraadbeheer",
};

const NEW_PART_LINK_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";

/** De scanknop is een gewone link naar `/onderdelen/scannen` (T20). */
const SCAN_LINK_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2";

/**
 * Voorraadoverzicht (SPEC §F2, taak T07). Server Component: leest de filters uit
 * `searchParams` (in Next.js 15 een Promise, dus `await`) en haalt daarmee direct
 * de juiste, al gefilterde/gesorteerde/gepagineerde pagina op via `listParts` —
 * er wordt hier zelf niets gefilterd, gesorteerd of berekend (dat is de taak van
 * de datalaag in `@/lib/queries/parts`, T06).
 *
 * ALLE filterstatus staat in de URL (SPEC §F2: deelbaar en herlaadbaar): search,
 * brandId (of `brandId=unbranded` voor "zonder merk"), category, supplierId,
 * lowStockOnly, sort, sortDir, page en group (groepering per merk). De
 * URL-logica zelf staat in `./search-params` (puur, getest zonder database in
 * `src/lib/__tests__/parts-overview.test.ts`).
 */
export default async function OnderdelenPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const current = normalizeSearchParams(raw);
  const { listParams, groupByBrand } = parsePartsSearchParams(current);

  const [result, brands, suppliers, unbrandedPartsCount] = await Promise.all([
    listParts(listParams),
    listBrandsWithPartCounts(),
    listSuppliers(),
    countUnbrandedParts(),
  ]);

  const hasAnyFilter = Boolean(
    listParams.search ||
      listParams.brandId ||
      listParams.brandIsNull ||
      listParams.category ||
      listParams.supplierId ||
      listParams.lowStockOnly,
  );

  return (
    <div>
      <PageHeader
        title="Onderdelen"
        description={`${result.total} ${result.total === 1 ? "onderdeel" : "onderdelen"}${
          hasAnyFilter ? " gevonden" : " in de voorraad"
        }.`}
        actions={
          <>
            {/* Scannen staat vóór "Nieuw onderdeel": in de werkplaats is de
                camera de snelste weg naar het juiste onderdeel (T20). */}
            <Link href="/onderdelen/scannen" className={SCAN_LINK_CLASSES}>
              <ScanIcon className="h-5 w-5 shrink-0" />
              Scan
            </Link>
            <Link href="/onderdelen/nieuw" className={NEW_PART_LINK_CLASSES}>
              Nieuw onderdeel
            </Link>
          </>
        }
      />

      <PartsFilters
        brands={brands}
        suppliers={suppliers}
        unbrandedPartsCount={unbrandedPartsCount}
      />

      {result.items.length === 0 ? (
        <EmptyState
          icon={<StockIcon className="h-10 w-10 text-gray-400" />}
          title={hasAnyFilter ? "Geen onderdelen gevonden" : "Nog geen onderdelen"}
          description={
            hasAnyFilter
              ? "Er zijn geen onderdelen die aan deze zoekopdracht of filters voldoen. Pas de filters aan of wis ze."
              : "Voeg het eerste onderdeel toe om de voorraad te gaan bijhouden."
          }
          action={
            hasAnyFilter ? (
              <Link
                href="/onderdelen"
                className="text-sm font-medium text-blue-700 hover:underline"
              >
                Filters wissen
              </Link>
            ) : (
              <Link href="/onderdelen/nieuw" className={NEW_PART_LINK_CLASSES}>
                Nieuw onderdeel
              </Link>
            )
          }
        />
      ) : (
        <>
          <PartsTable items={result.items} groupByBrand={groupByBrand} />
          <PartsPagination
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            pageSize={result.pageSize}
            current={current}
          />
        </>
      )}
    </div>
  );
}
