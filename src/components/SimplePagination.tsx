/**
 * Vorige/volgende-paginering met gewone links (T24). Server component zonder
 * client-state: de bestemming van elke link komt van de aanroeper, zodat de huidige
 * filters in de URL behouden blijven en de pagina deelbaar en herlaadbaar is.
 */

import Link from "next/link";

const LINK_CLASSES =
  "inline-flex min-h-[44px] items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600";
const DISABLED_CLASSES =
  "inline-flex min-h-[44px] cursor-not-allowed items-center justify-center rounded-md border border-gray-200 bg-gray-50 px-4 text-sm font-medium text-gray-400";

export interface SimplePaginationProps {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  /** Eenheid voor de tekst, bv. `"regels"`. */
  noun: string;
  ariaLabel: string;
  /** Href voor een doelpagina. */
  hrefFor: (page: number) => string;
  prevLabel?: string;
  nextLabel?: string;
}

export function SimplePagination({
  page,
  pageCount,
  total,
  pageSize,
  noun,
  ariaLabel,
  hrefFor,
  prevLabel = "Vorige",
  nextLabel = "Volgende",
}: SimplePaginationProps) {
  if (pageCount <= 1) {
    return null;
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label={ariaLabel}
      className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row"
    >
      <p className="text-sm text-gray-500">
        {from}–{to} van {total} {noun} — pagina {page} van {pageCount}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={LINK_CLASSES}>
            {prevLabel}
          </Link>
        ) : (
          <span aria-disabled="true" className={DISABLED_CLASSES}>
            {prevLabel}
          </span>
        )}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className={LINK_CLASSES}>
            {nextLabel}
          </Link>
        ) : (
          <span aria-disabled="true" className={DISABLED_CLASSES}>
            {nextLabel}
          </span>
        )}
      </div>
    </nav>
  );
}
