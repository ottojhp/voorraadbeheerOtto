/**
 * Paginering voor het voorraadoverzicht (SPEC §F2: "paginering vanaf 50
 * rijen"). Server Component — de links zijn gewone `<Link>`s die de huidige
 * filters uit de URL behouden (via `buildPartsQuery` uit `./search-params`) en
 * alleen `page` overschrijven, dus geen client-side state nodig.
 */

import Link from "next/link";

import { buildPartsQuery } from "./search-params";

const ONDERDELEN_PATH = "/onderdelen";

const NAV_LINK_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600";
const NAV_DISABLED_CLASSES =
  "inline-flex min-h-[44px] cursor-not-allowed items-center justify-center rounded-md border border-gray-200 bg-gray-50 px-4 text-sm font-medium text-gray-400";

export interface PartsPaginationProps {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  /** Huidige filters/sortering uit de URL, genormaliseerd (zie `normalizeSearchParams`). */
  current: Record<string, string>;
}

export function PartsPagination({
  page,
  pageCount,
  total,
  pageSize,
  current,
}: PartsPaginationProps) {
  if (pageCount <= 1) {
    return (
      <p className="mt-4 text-sm text-gray-500">
        {total} {total === 1 ? "onderdeel" : "onderdelen"} — pagina 1 van 1.
      </p>
    );
  }

  const hasPrev = page > 1;
  const hasNext = page < pageCount;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const hrefFor = (targetPage: number) =>
    `${ONDERDELEN_PATH}${buildPartsQuery(current, { page: targetPage })}`;

  return (
    <nav
      aria-label="Paginering onderdelen"
      className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row"
    >
      <p className="text-sm text-gray-500">
        {from}–{to} van {total} onderdelen — pagina {page} van {pageCount}
      </p>
      <div className="flex gap-2">
        {hasPrev ? (
          <Link href={hrefFor(page - 1)} className={NAV_LINK_CLASSES}>
            Vorige
          </Link>
        ) : (
          <span aria-disabled="true" className={NAV_DISABLED_CLASSES}>
            Vorige
          </span>
        )}
        {hasNext ? (
          <Link href={hrefFor(page + 1)} className={NAV_LINK_CLASSES}>
            Volgende
          </Link>
        ) : (
          <span aria-disabled="true" className={NAV_DISABLED_CLASSES}>
            Volgende
          </span>
        )}
      </div>
    </nav>
  );
}
