/**
 * Compacte lijst met voorraadmutaties (T24), gedeeld door het blok
 * "Voorraadgeschiedenis" op `/onderdelen/[id]` en de pagina `/voorraadmutaties`.
 *
 * Bewust een lijst van kaartjes en geen brede tabel: de zes gegevens per regel
 * (verandering, reden, stand, tijdstip, notitie, onderdeel) passen op 375px alleen
 * onder elkaar. Vanaf `md` staan dezelfde elementen naast elkaar op één regel. Eén
 * stuk markup voor beide breedtes, dus geen dubbele DOM en geen verborgen kopie.
 *
 * Server component zonder `"use client"`; krijgt uitsluitend plain DTO's (SPEC §3
 * regel 1) en rendert niets met een `Decimal` of `Date`.
 */

import Link from "next/link";

import { Badge } from "@/components/Badge";
import { getStockMutationReasonLabel } from "@/lib/labels";
import type { StockMutationDTO } from "@/lib/queries/types";
import {
  describeDelta,
  formatDelta,
  formatMutationDateTime,
} from "@/lib/stock-mutation-format";

export interface StockMutationListProps {
  items: StockMutationDTO[];
  /**
   * Toon de onderdeelnaam (met link) per regel. Uit op de detailpagina van een
   * onderdeel, daar staat het onderdeel al in de kop; aan op `/voorraadmutaties`.
   */
  showPart: boolean;
  /** Toegankelijke naam van de lijst. */
  ariaLabel: string;
}

export function StockMutationList({
  items,
  showPart,
  ariaLabel,
}: StockMutationListProps) {
  return (
    <ul aria-label={ariaLabel} className="divide-y divide-gray-100">
      {items.map((item) => (
        <StockMutationRow key={item.id} item={item} showPart={showPart} />
      ))}
    </ul>
  );
}

function StockMutationRow({
  item,
  showPart,
}: {
  item: StockMutationDTO;
  showPart: boolean;
}) {
  const positive = item.delta > 0;

  return (
    <li className="flex items-start gap-3 py-3 md:items-center md:gap-4">
      {/* Verandering: het belangrijkste getal, dus links en opvallend. */}
      <span
        className={`inline-flex min-w-[3.5rem] shrink-0 items-center justify-center rounded-md px-2 py-1 text-sm font-semibold tabular-nums ${
          positive ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
        }`}
      >
        <span aria-hidden="true">{formatDelta(item.delta)}</span>
        <span className="sr-only">{describeDelta(item.delta)}</span>
      </span>

      <div className="min-w-0 flex-1">
        {showPart && (
          <Link
            href={`/onderdelen/${item.partId}`}
            className="block truncate font-medium text-blue-700 hover:underline"
          >
            {item.partName}
            {item.partIsArchived && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                (gearchiveerd)
              </span>
            )}
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700">
          <span className={showPart ? "" : "font-medium text-gray-900"}>
            {getStockMutationReasonLabel(item.reason)}
          </span>
          {item.fromSale && <Badge variant="info">Uit verkoop</Badge>}
          <span className="text-gray-500">
            {showPart && <span>{item.partSku} · </span>}
            <span className="tabular-nums">
              {item.quantityBefore} → {item.quantityAfter}
            </span>
            <span className="sr-only"> stuks</span>
          </span>
        </div>
        {item.note && (
          // `break-words`: een lange pakbon- of werkorderreferentie zonder spaties
          // mag de kaart niet breder duwen dan het scherm.
          <p className="mt-0.5 break-words text-sm text-gray-600">{item.note}</p>
        )}
        <time
          dateTime={item.createdAt}
          className="mt-0.5 block text-xs text-gray-500 md:hidden"
        >
          {formatMutationDateTime(item.createdAt)}
        </time>
      </div>

      {/* Tijdstip: op mobiel onder de tekst, vanaf `md` rechts op dezelfde regel. */}
      <time
        dateTime={item.createdAt}
        className="hidden shrink-0 text-sm text-gray-500 md:block"
      >
        {formatMutationDateTime(item.createdAt)}
      </time>
    </li>
  );
}
