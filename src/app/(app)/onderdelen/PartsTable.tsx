/**
 * Tabel + mobiele kaartweergave voor het voorraadoverzicht (SPEC §F2, §F8).
 *
 * Puur presentatief: de data komt al gefilterd, gesorteerd en gepagineerd
 * binnen vanuit `listParts` (server component `page.tsx`). Dit bestand rekent
 * niets uit — marge, margepercentage en de afgeleide incl./excl.-bedragen staan al op
 * de `PartDTO` (zie `@/lib/queries/parts`) — en filtert/sorteert niet opnieuw.
 *
 * Prijsweergave (T18): elk bedrag gaat door `PriceWithVat`, dus incl. btw als
 * hoofdbedrag met excl. btw kleiner eronder — in de tabel én op de mobiele kaarten,
 * in exact dezelfde vorm. De marge blijft op excl.-basis en staat als zodanig
 * gelabeld, met de toelichting uit `MARGIN_BASIS_NOTE` erbij.
 *
 * Geen "use client": sorteren en filteren lopen via URL-navigatie in `PartsFilters`,
 * dus dit blijft een Server Component. De enige interactiviteit is de
 * `StockStepper` (T19) op elke rij en elke kaart — een eigen client component, zodat
 * de rest van het overzicht niet naar de browser gebundeld hoeft te worden.
 */

import Link from "next/link";

import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { MarginBasisNote, PriceWithVat } from "@/components/PriceWithVat";
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

import { StockStepper } from "./StockStepper";

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
      {/* Eén keer bovenaan: hoe de bedragen hieronder gelezen moeten worden (T18). */}
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
        <p className="text-xs text-gray-600">
          Inkoop- en verkoopprijs staan met het bedrag{" "}
          <strong>inclusief btw</strong> als hoofdbedrag en het bedrag exclusief btw
          kleiner eronder.
        </p>
        <MarginBasisNote className="mt-0.5" />
      </div>

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
                <TableHeaderCell>Verkoop</TableHeaderCell>
                <TableHeaderCell>Marge (excl. btw)</TableHeaderCell>
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
                  <TableCell>
                    <PriceWithVat
                      incl={part.purchasePriceIncl}
                      excl={part.purchasePriceExcl}
                    />
                  </TableCell>
                  <TableCell>
                    <PriceWithVat
                      incl={part.salePriceIncl}
                      excl={part.salePriceExcl}
                    />
                  </TableCell>
                  <TableCell>
                    <span className="block whitespace-nowrap font-medium text-gray-900">
                      {formatEuro(part.margin)}
                    </span>
                    <span className="block whitespace-nowrap text-xs text-gray-500">
                      {formatMarginPct(part.marginPct)} · excl. btw
                    </span>
                  </TableCell>
                  <TableCell>
                    {/* Dezelfde −/+ knoppen als op de detailpagina (T19), zodat die
                        pagina niet nodig is om een stuk bij of af te boeken. */}
                    <div className="flex flex-col gap-1">
                      <StockStepper
                        partId={part.id}
                        partName={part.name}
                        stockQuantity={part.stockQuantity}
                        minStock={part.minStock}
                      />
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
              /* De kaart is NIET meer als geheel een link: sinds T19 staan er
                 −/+ knoppen in, en een knop binnen een link levert op een telefoon
                 onvoorspelbaar gedrag op (de tik activeert dan beide). De naam
                 bovenaan is de link naar de detailpagina en heeft zelf een raakvlak
                 van 44px hoog. */
              <div key={part.id}>
                <Card
                  className={
                    part.isLowStock ? "border-amber-300 bg-amber-50/60" : undefined
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/onderdelen/${part.id}`}
                      className="flex min-h-[44px] flex-col justify-center"
                    >
                      <p className="font-medium text-blue-700 underline-offset-2 hover:underline">
                        {part.name}
                      </p>
                      <p className="text-sm text-gray-500">
                        {part.brand ? part.brand.name : "Universeel"} ·{" "}
                        {getCategoryLabel(part.category)}
                      </p>
                    </Link>
                    {part.isLowStock && <Badge variant="warning">Lage voorraad</Badge>}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div>
                      <dt className="text-gray-500">SKU</dt>
                      <dd className="text-gray-900">{part.sku}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-gray-500">
                        Voorraad (min. {part.minStock})
                      </dt>
                      <dd className="mt-1">
                        <StockStepper
                          partId={part.id}
                          partName={part.name}
                          stockQuantity={part.stockQuantity}
                          minStock={part.minStock}
                        />
                      </dd>
                    </div>
                    {/* Inkoop en verkoop in dezelfde vorm als in de tabel: incl. btw
                        groot, excl. btw eronder (T18). */}
                    <div>
                      <dt className="text-gray-500">Inkoop</dt>
                      <dd>
                        <PriceWithVat
                          incl={part.purchasePriceIncl}
                          excl={part.purchasePriceExcl}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Verkoop</dt>
                      <dd>
                        <PriceWithVat
                          incl={part.salePriceIncl}
                          excl={part.salePriceExcl}
                        />
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-gray-500">Marge (excl. btw)</dt>
                      <dd className="font-medium text-gray-900">
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
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
