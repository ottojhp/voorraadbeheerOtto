import type { Metadata } from "next";

import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { SALE_CHANNEL_LABELS } from "@/lib/labels";
import { formatEuro } from "@/lib/money";
import {
  findPartByBarcode,
  getPartById,
  searchPartsForSale,
} from "@/lib/queries/parts";
import { listRecentSales } from "@/lib/queries/sales";
import type { PartDTO, PartSaleOptionDTO } from "@/lib/queries/types";

import { SaleScreen } from "./SaleScreen";

export const metadata: Metadata = {
  title: "Verkoop registreren — Voorraadbeheer",
};

/** Aantal regels in "laatste verkopen" onder het verkoopscherm. */
const RECENT_SALES_LIMIT = 5;

interface SearchParams {
  /** Vrije zoekterm. */
  q?: string | string[];
  /** Gekozen onderdeel. */
  partId?: string | string[];
  /** Zojuist gescande code. */
  scan?: string | string[];
}

/** Next geeft een herhaalde parameter als array terug; we gebruiken de eerste waarde. */
function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }
  return value?.trim() ?? "";
}

/**
 * `PartDTO` (volledig onderdeel) → `PartSaleOptionDTO`, het beknopte type dat het
 * verkoopscherm gebruikt. Zo krijgt de client altijd dezelfde vorm, of het onderdeel
 * nu uit een zoekopdracht, uit een barcode of uit `?partId=` komt.
 */
function toSaleOption(part: PartDTO): PartSaleOptionDTO {
  return {
    id: part.id,
    name: part.name,
    brandName: part.brand?.name ?? null,
    category: part.category,
    sku: part.sku,
    barcode: part.barcode,
    stockQuantity: part.stockQuantity,
    salePrice: part.salePrice,
    vatRate: part.vatRate,
    salePriceInclVat: part.salePriceInclVat,
  };
}

/**
 * Verkoop registreren (SPEC §F4, T12) — het belangrijkste baliescherm.
 *
 * Deze server component doet al het lezen via de bestaande datalaag
 * (`@/lib/queries/parts`) en geeft plain DTO's door aan `SaleScreen`. De
 * schermtoestand staat in de URL:
 *
 * - `?q=` — zoekterm (naam, sku of barcode, alleen niet-gearchiveerde onderdelen);
 * - `?scan=` — zojuist gescande code; precies één match selecteert direct, anders
 *   komt de code terug in een melding;
 * - `?partId=` — het gekozen onderdeel; de voorraad die de balie ziet komt zo bij
 *   elke render vers uit de database.
 */
export default async function VerkoopPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = first(params.q);
  const partId = first(params.partId);
  const scan = first(params.scan);

  let selectedPart: PartSaleOptionDTO | null = null;
  let results: PartSaleOptionDTO[] = [];
  let scanMiss: string | null = null;
  let notice: string | null = null;

  if (scan) {
    // Eerst de exacte barcode (die is uniek en sluit gearchiveerde onderdelen uit).
    const byBarcode = await findPartByBarcode(scan);
    if (byBarcode) {
      selectedPart = toSaleOption(byBarcode);
    } else {
      // Sommige codes op de schappen zijn het artikelnummer zelf; precies één
      // match telt nog steeds als "direct selecteren", meer dan één niet.
      const matches = await searchPartsForSale(scan);
      if (matches.length === 1) {
        selectedPart = matches[0];
      } else {
        scanMiss = scan;
        results = matches;
      }
    }
  } else if (partId) {
    const part = await getPartById(partId);
    if (!part) {
      notice = "Dit onderdeel bestaat niet (meer). Zoek of scan het opnieuw.";
    } else if (part.archivedAt !== null) {
      // Gearchiveerde onderdelen zijn niet selecteerbaar (SPEC §3 regel 4).
      notice = `"${part.name}" is gearchiveerd en kan niet verkocht worden.`;
    } else {
      selectedPart = toSaleOption(part);
    }
  } else if (query && query !== "demo") {
    results = await searchPartsForSale(query);
  }

  // TIJDELIJK
  if (query === "demo") {
    selectedPart = {
      id: "demo_1",
      name: "Remblokset voor Vespa Primavera",
      brandName: "Vespa",
      category: "SCOOTER_PART",
      sku: "REM-001",
      barcode: "8712345678901",
      stockQuantity: 8,
      salePrice: 24.95,
      vatRate: 21,
      salePriceInclVat: 30.19,
    };
  }

  const recentSales = await listRecentSales(RECENT_SALES_LIMIT).catch(() => []); // TIJDELIJK

  return (
    <>
      <PageHeader
        title="Verkoop registreren"
        description="Scan of zoek een onderdeel, kies het aantal en bevestig. De voorraad wordt direct bijgewerkt."
      />

      <SaleScreen
        query={query}
        results={results}
        selectedPart={selectedPart}
        scanMiss={scanMiss}
        notice={notice}
      />

      <div className="mt-6">
        <Card title="Laatste verkopen">
          {recentSales.length === 0 ? (
            <p className="text-sm text-gray-600">
              Er zijn nog geen verkopen geregistreerd.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-gray-200">
              {recentSales.map((sale) => (
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
                      {new Date(sale.soldAt).toLocaleString("nl-NL", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-medium text-gray-900">
                    {formatEuro(sale.lineTotalExclVat)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
