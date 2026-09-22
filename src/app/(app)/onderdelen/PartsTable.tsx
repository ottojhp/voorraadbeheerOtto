/**
 * Tabel + mobiele kaartweergave voor het voorraadoverzicht (SPEC §F2, §F8).
 *
 * Puur presentatief: de data komt al gefilterd, gesorteerd en gepagineerd
 * binnen vanuit `listParts` (server component `page.tsx`). Dit bestand rekent
 * niets uit — marge, margepercentage en de prijs incl. btw staan al op de
 * `PartDTO` (zie `@/lib/queries/parts`) — en filtert/sorteert niet opnieuw.
 *
 * Geen "use client": er is geen interactiviteit nodig (sorteren/filteren loopt
 * via URL-navigatie in `PartsFilters`), dus dit blijft een Server Component.
 */

import Link from "next/link";

import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
} from "@/components/Table";
import { getCategoryLabel } from "@/lib/labels";
import { formatEuro } from "@/lib/money";
import type { PartDTO } from "@/lib/queries/types";

const UNBRANDED_GROUP_KEY = "__unbranded__";
const UNBRANDED_GROUP_LABEL = "Universeel (geen merk)";

export interface PartGroup {
  key: string;
  label: string;
  items: PartDTO[];
}

/**
 * Groepeert onderdelen per merk (SPEC §F2: "groepsweergave per merk als
 * toggle"). Onderdelen zonder merk krijgen een eigen groep, altijd als laatste
 * — merken zelf staan alfabetisch (Nederlandse collatie). Puur en dus los
 * testbaar zonder database of React (zie
 * `src/lib/__tests__/parts-overview.test.ts`).
 */
export function groupPartsByBrand(items: PartDTO[]): PartGroup[] {
  const groups = new Map<string, PartGroup>();

  for (const part of items) {
    const key = part.brand ? part.brand.id : UNBRANDED_GROUP_KEY;
    const label = part.brand ? part.brand.name : UNBRANDED_GROUP_LABEL;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(part);
    } else {
      groups.set(key, { key, label, items: [part] });
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === UNBRANDED_GROUP_KEY) return 1;
    if (b.key === UNBRANDED_GROUP_KEY) return -1;
    return a.label.localeCompare(b.label, "nl");
  });
}

/** Nederlandse notatie voor een percentage, bv. `12,5%`. */
function formatMarginPct(value: number): string {
  const formatted = new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted}%`;
}

export interface PartsTableProps {
  items: PartDTO[];
  /** Groepering per merk aan/uit (URL-parameter `group=merk`, zie `PartsFilters`). */
  groupByBrand: boolean;
}

export function PartsTable({ items, groupByBrand }: PartsTableProps) {
  const groups: PartGroup[] = groupByBrand
    ? groupPartsByBrand(items)
    : [{ key: "all", label: "", items }];

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.key}>
          {groupByBrand && (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
              {group.label} ({group.items.length})
            </h2>
          )}

          {/* Desktop/tablet: tabel. Nooit zichtbaar op 375px (SPEC §3 regel 8). */}
          <Table className="hidden md:block">
            <TableHead>
              <tr>
                <TableHeaderCell>Naam</TableHeaderCell>
                <TableHeaderCell>Merk</TableHeaderCell>
                <TableHeaderCell>Categorie</TableHeaderCell>
                <TableHeaderCell>SKU</TableHeaderCell>
                <TableHeaderCell>Inkoop</TableHeaderCell>
                <TableHeaderCell>Verkoop (excl./incl. btw)</TableHeaderCell>
                <TableHeaderCell>Marge</TableHeaderCell>
                <TableHeaderCell>Voorraad</TableHeaderCell>
                <TableHeaderCell>Min.</TableHeaderCell>
                <TableHeaderCell>Leverancier</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {group.items.map((part) => (
                <tr key={part.id} className={part.isLowStock ? "bg-amber-50/60" : undefined}>
                  <TableCell>
                    <Link
                      href={`/onderdelen/${part.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {part.name}
                    </Link>
                  </TableCell>
                  <TableCell>{part.brand ? part.brand.name : "Universeel"}</TableCell>
                  <TableCell>{getCategoryLabel(part.category)}</TableCell>
                  <TableCell>{part.sku}</TableCell>
                  <TableCell>{formatEuro(part.purchasePrice)}</TableCell>
                  <TableCell>
                    {formatEuro(part.salePrice)}
                    <span className="block text-xs text-gray-500">
                      {formatEuro(part.salePriceInclVat)} incl. btw
                    </span>
                  </TableCell>
                  <TableCell>
                    {formatEuro(part.margin)}
                    <span className="block text-xs text-gray-500">
                      {formatMarginPct(part.marginPct)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {part.stockQuantity}
                      {part.isLowStock && <Badge variant="warning">Laag</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>{part.minStock}</TableCell>
                  <TableCell>{part.supplier ? part.supplier.name : "—"}</TableCell>
                </tr>
              ))}
            </TableBody>
          </Table>

          {/* Mobiel: kaartweergave in plaats van een brede tabel (SPEC §F8). */}
          <div className="grid gap-3 md:hidden">
            {group.items.map((part) => (
              <Link key={part.id} href={`/onderdelen/${part.id}`} className="block">
                <Card
                  className={
                    part.isLowStock ? "border-amber-300 bg-amber-50/60" : undefined
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900">{part.name}</p>
                      <p className="text-sm text-gray-500">
                        {part.brand ? part.brand.name : "Universeel"} ·{" "}
                        {getCategoryLabel(part.category)}
                      </p>
                    </div>
                    {part.isLowStock && <Badge variant="warning">Lage voorraad</Badge>}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div>
                      <dt className="text-gray-500">SKU</dt>
                      <dd className="text-gray-900">{part.sku}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Voorraad</dt>
                      <dd className="text-gray-900">
                        {part.stockQuantity} (min. {part.minStock})
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Verkoop</dt>
                      <dd className="text-gray-900">
                        {formatEuro(part.salePrice)}{" "}
                        <span className="text-gray-500">
                          ({formatEuro(part.salePriceInclVat)} incl.)
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Marge</dt>
                      <dd className="text-gray-900">
                        {formatEuro(part.margin)} ({formatMarginPct(part.marginPct)})
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-gray-500">Leverancier</dt>
                      <dd className="text-gray-900">
                        {part.supplier ? part.supplier.name : "—"}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
