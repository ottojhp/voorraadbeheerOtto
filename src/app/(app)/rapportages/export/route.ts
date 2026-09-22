import { NextResponse, type NextRequest } from "next/server";

import { buildCsv, contentDispositionAttachment, csvFilename } from "@/lib/csv";
import { MAX_BESTSELLERS_LIMIT, getBestsellers } from "@/lib/queries/reports";
import { amsterdamCalendarDateOf, formatIsoDate } from "@/lib/reporting-period";

import { normalizeSearchParams, parseReportSearchParams } from "../report-filters";

/**
 * GET /rapportages/export — CSV-export van de bestsellerslijst (SPEC §F6).
 *
 * Leest exact dezelfde filters (`preset`/`from`/`to`, `category`) als de
 * rapportagepagina uit de querystring, via dezelfde pure `report-filters`-logica —
 * zo exporteert deze route altijd precies de periode/categorie die op het scherm
 * stond, inclusief de eventuele terugval op de standaardperiode bij ongeldige
 * invoer (SPEC-eis: ongeldige invoer geeft nooit een fout).
 *
 * CSV-conventie (Nederlandse Excel, zie `@/lib/csv` voor de volledige toelichting):
 * puntkomma als scheidingsteken, komma als decimaalteken, UTF-8 BOM.
 *
 * Deze route zit al achter de globale auth-middleware (SPEC §F7: alles behalve
 * `/login` is beschermd), dus hier is geen aparte sessiecontrole nodig.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const current = normalizeSearchParams(
    Object.fromEntries(url.searchParams.entries()),
  );
  const { period, category } = parseReportSearchParams(current);

  const bestsellers = await getBestsellers(
    { from: period.from, to: period.to, category },
    MAX_BESTSELLERS_LIMIT,
  );

  const header = [
    "Onderdeel",
    "SKU",
    "Merk",
    "Stuks verkocht",
    "Omzet excl. btw",
    "Marge excl. btw",
  ];
  const rows = bestsellers.map((row) => [
    row.name,
    row.sku,
    row.brandName ?? "Zonder merk",
    row.quantitySold,
    row.revenue,
    row.margin,
  ]);

  const csv = buildCsv(header, rows);

  const fromLabel = formatIsoDate(amsterdamCalendarDateOf(period.from));
  const toLabel = formatIsoDate(amsterdamCalendarDateOf(period.to));
  const filename = csvFilename("bestsellers", fromLabel, toLabel);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDispositionAttachment(filename),
    },
  });
}
