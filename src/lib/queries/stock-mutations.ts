/**
 * Datalaag voor het LEZEN van het voorraadgrootboek (T24, SPEC §4 `StockMutation`).
 *
 * Geschreven wordt er elders (`registerSale()` in `./sales`, `adjustStock()` in
 * `./stock` en de onderdeelacties); deze module doet uitsluitend lezen en wijzigt
 * nooit een regel — een grootboek is onveranderlijk.
 *
 * ### Alles gebeurt in de database
 * - Filteren op onderdeel, reden en periode staat in de `where` (SQL), niet in Node.
 * - Paginering is `skip`/`take` (`OFFSET`/`LIMIT`) met een vaste, totale volgorde
 *   (`createdAt` aflopend, dan `id`): twee regels die in dezelfde milliseconde zijn
 *   geschreven (een verkoop met meerdere mutaties in één transactie krijgt dezelfde
 *   `now()`) wisselen anders per query van plek en verdwijnen of verdubbelen tussen
 *   pagina's.
 * - De totalen (aantal, bijgeboekt, afgeboekt) zijn drie `aggregate`-queries over
 *   dezelfde `where`, dus over álle gefilterde regels en niet alleen de getoonde pagina.
 *
 * Afweging OFFSET versus keyset: `OFFSET n` laat Postgres de eerste n rijen alsnog
 * aflopen. Voor de omvang van één winkel (honderden tot enkele tienduizenden regels,
 * met een index op `createdAt` en op `partId`) is dat onmerkbaar, en OFFSET geeft de
 * "pagina 3 van 12"-weergave en deelbare `?page=3`-links die keyset niet geeft.
 *
 * ### DTO-regel (SPEC §3 regel 1)
 * Naar buiten gaan alleen `number`, `string`, `boolean` en `null`; `createdAt` is een
 * ISO-string. Er zit geen geld in het grootboek, dus ook geen `Decimal`.
 *
 * Server-only: importeer dit bestand niet in een client component.
 */

import { Prisma, type StockMutationReason } from "@prisma/client";

import { prisma } from "@/lib/db";
import { normalizePagination } from "@/lib/queries/parts";

import type {
  PaginatedResult,
  StockMutationDTO,
  StockMutationTotalsDTO,
} from "./types";

/** Standaard aantal regels per pagina op `/voorraadmutaties`. */
export const DEFAULT_MUTATIONS_PAGE_SIZE = 25;

/** Standaard aantal regels in het blok op de onderdeeldetailpagina (T24: "de laatste 10"). */
export const PART_HISTORY_PAGE_SIZE = 10;

export interface StockMutationFilters {
  /** Alleen de regels van dit onderdeel. */
  partId?: string;
  /** Alleen deze reden. */
  reason?: StockMutationReason;
  /** Vanaf dit tijdstip, INCLUSIEF (`createdAt >= from`). */
  from?: Date;
  /** Tot dit tijdstip, INCLUSIEF (`createdAt <= to`). */
  to?: Date;
}

export interface ListStockMutationsParams extends StockMutationFilters {
  page?: number;
  pageSize?: number;
}

export interface StockMutationsResult extends PaginatedResult<StockMutationDTO> {
  /** Totalen over ALLE regels die aan het filter voldoen. */
  totals: StockMutationTotalsDTO;
}

/** Relatie die elke regel nodig heeft: alleen wat de weergave toont. */
const MUTATION_INCLUDE = {
  part: { select: { id: true, name: true, sku: true, archivedAt: true } },
} satisfies Prisma.StockMutationInclude;

type MutationRecord = Prisma.StockMutationGetPayload<{
  include: typeof MUTATION_INCLUDE;
}>;

/**
 * Bouwt de `where` voor alle drie de queries (regels, telling en sommen), zodat de
 * getoonde totalen nooit een ander filter gebruiken dan de getoonde regels.
 */
export function buildStockMutationWhere(
  filters: StockMutationFilters = {},
): Prisma.StockMutationWhereInput {
  const where: Prisma.StockMutationWhereInput = {};

  if (filters.partId) {
    where.partId = filters.partId;
  }
  if (filters.reason) {
    where.reason = filters.reason;
  }
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    };
  }

  return where;
}

/** Vaste, totale volgorde: nieuwste bovenaan, `id` als tiebreak. */
export const STOCK_MUTATION_ORDER_BY: Prisma.StockMutationOrderByWithRelationInput[] =
  [{ createdAt: "desc" }, { id: "desc" }];

/** Een Prisma-regel naar het plain DTO. */
export function toStockMutationDTO(row: MutationRecord): StockMutationDTO {
  return {
    id: row.id,
    partId: row.partId,
    partName: row.part.name,
    partSku: row.part.sku,
    partIsArchived: row.part.archivedAt !== null,
    delta: row.delta,
    quantityBefore: row.quantityBefore,
    quantityAfter: row.quantityAfter,
    reason: row.reason,
    note: row.note,
    fromSale:
      row.saleId !== null || row.reason === "SALE" || row.reason === "WORKSHOP",
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Totalen over alle regels die aan `where` voldoen: aantal, bijgeboekt en afgeboekt.
 * Drie aggregaties in de database; geen enkele regel wordt naar Node gehaald.
 */
async function getTotals(
  where: Prisma.StockMutationWhereInput,
): Promise<StockMutationTotalsDTO> {
  const [all, plus, minus] = await Promise.all([
    prisma.stockMutation.aggregate({ where, _count: { _all: true } }),
    prisma.stockMutation.aggregate({
      where: { AND: [where, { delta: { gt: 0 } }] },
      _sum: { delta: true },
    }),
    prisma.stockMutation.aggregate({
      where: { AND: [where, { delta: { lt: 0 } }] },
      _sum: { delta: true },
    }),
  ]);

  return {
    count: all._count._all,
    added: plus._sum.delta ?? 0,
    // `0 - x` in plaats van `-x`: `-(0)` is in JavaScript `-0`, en dat toont als "−0".
    removed: 0 - (minus._sum.delta ?? 0),
  };
}

/**
 * Gepagineerde lijst met grootboekregels, nieuwste bovenaan, voor beide weergaven:
 * mét `partId` de geschiedenis van één onderdeel (`/onderdelen/[id]`), zonder alle
 * wijzigingen over alle onderdelen (`/voorraadmutaties`).
 *
 * Een paginanummer voorbij het einde (bv. een oude bladwijzer nadat de filters
 * smaller werden) wordt teruggebracht naar de laatste pagina in plaats van een lege
 * lijst te tonen; daarom staat de telling vóór de rijen en niet ernaast.
 */
export async function listStockMutations(
  params: ListStockMutationsParams = {},
): Promise<StockMutationsResult> {
  const where = buildStockMutationWhere(params);
  const requested = normalizePagination(
    params.page,
    params.pageSize ?? DEFAULT_MUTATIONS_PAGE_SIZE,
  );

  const totals = await getTotals(where);
  const total = totals.count;
  const pageCount = total === 0 ? 0 : Math.ceil(total / requested.pageSize);
  const page = pageCount === 0 ? 1 : Math.min(requested.page, pageCount);

  const rows =
    total === 0
      ? []
      : await prisma.stockMutation.findMany({
          where,
          include: MUTATION_INCLUDE,
          orderBy: STOCK_MUTATION_ORDER_BY,
          skip: (page - 1) * requested.pageSize,
          take: requested.pageSize,
        });

  return {
    items: rows.map(toStockMutationDTO),
    total,
    page,
    pageSize: requested.pageSize,
    pageCount,
    totals,
  };
}
