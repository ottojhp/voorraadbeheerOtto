/**
 * Omzetverloop als eenvoudige staafjesgrafiek (SPEC §F6), getekend met gewone
 * `div`'s en CSS — bewust GEEN grafiekbibliotheek (geen nieuwe dependency
 * toegestaan voor deze taak). Geen "use client" nodig: puur presentatief, geen
 * interactiviteit.
 *
 * Horizontaal scrollbaar in plaats van de staven platdrukken: bij een periode van
 * 90 dagen zouden 90 staafjes op 375px breedte onleesbaar smal worden. Elke staaf
 * heeft een `title` (tooltip) met de volledige datum en het bedrag, voor wie meer
 * precisie wil dan de balkhoogte geeft.
 */

import { formatCalendarDayMonth } from "@/lib/datetime";
import { formatEuro } from "@/lib/money";
import type { RevenueBucketDTO } from "@/lib/queries/reports";

const CHART_HEIGHT_PX = 140;
const BAR_WIDTH_PX = 20;

/** `YYYY-MM-DD` of `YYYY-Www` → korte label, bv. `22 sep`. */
function formatBucketLabel(bucket: string): string {
  const [year, month, day] = bucket.split("-").map(Number);
  if (!year || !month || !day) {
    return bucket;
  }
  return formatCalendarDayMonth(year, month, day);
}

export interface RevenueBarChartProps {
  points: RevenueBucketDTO[];
  bucketSize: "day" | "week";
}

export function RevenueBarChart({ points, bucketSize }: RevenueBarChartProps) {
  const max = Math.max(1, ...points.map((point) => point.revenue));
  // Niet elk label tonen op mobiel voorkomt een muur van tekst; bij weinig
  // buckets (bv. 7 dagen) past alles wél.
  const labelEvery = points.length > 14 ? Math.ceil(points.length / 10) : 1;

  return (
    <div className="w-full overflow-x-auto">
      <div
        className="flex items-end gap-1.5"
        style={{ height: CHART_HEIGHT_PX, minWidth: points.length * (BAR_WIDTH_PX + 6) }}
        role="img"
        aria-label={`Omzet per ${bucketSize === "week" ? "week" : "dag"}, van ${points[0]?.bucket ?? ""} tot ${
          points[points.length - 1]?.bucket ?? ""
        }`}
      >
        {points.map((point, index) => {
          const heightPx = Math.round((point.revenue / max) * (CHART_HEIGHT_PX - 20));
          return (
            <div
              key={point.bucket}
              className="flex h-full flex-col items-center justify-end gap-1"
              style={{ width: BAR_WIDTH_PX }}
              title={`${formatBucketLabel(point.bucket)}: ${formatEuro(point.revenue)}`}
            >
              <div
                className="w-full rounded-t bg-blue-500"
                style={{ height: Math.max(2, heightPx) }}
              />
              {index % labelEvery === 0 && (
                <span className="text-[10px] leading-none text-gray-500">
                  {formatBucketLabel(point.bucket)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
