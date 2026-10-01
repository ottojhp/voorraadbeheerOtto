/**
 * Regressietest voor de tijdzonebug: Vercel draait op UTC, de winkel in Amsterdam.
 * Een verkoop van 16:30 toonde als 14:30 omdat formatters zonder `timeZone` de
 * proces-tijdzone gebruiken.
 *
 * `process.env.TZ` wordt hier op UTC gezet, dus ook op een Amsterdamse ontwikkelmachine
 * gedraagt Node zich als de productieserver. Node leest TZ opnieuw uit bij wijziging;
 * de eerste test controleert dat dat echt werkt, anders zou de rest niets bewijzen.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// De formatters worden bij het laden van de module aangemaakt en nemen op dat moment de
// proces-tijdzone over. Daarom zetten we TZ eerst op UTC en importeren de modules daarna
// pas (dynamisch). Een statische import zou op een Amsterdamse machine nog de oude
// tijdzone vastleggen en de test zou dan niets bewijzen.
type DatetimeModule = typeof import("@/lib/datetime");
type MutationFormatModule = typeof import("@/lib/stock-mutation-format");

let APP_TIME_ZONE: DatetimeModule["APP_TIME_ZONE"];
let formatCalendarDayMonth: DatetimeModule["formatCalendarDayMonth"];
let formatCompactDateTime: DatetimeModule["formatCompactDateTime"];
let formatDateTime: DatetimeModule["formatDateTime"];
let formatMutationDateTime: MutationFormatModule["formatMutationDateTime"];

const originalTz = process.env.TZ;

beforeAll(async () => {
  process.env.TZ = "UTC";
  vi.resetModules();
  ({ APP_TIME_ZONE, formatCalendarDayMonth, formatCompactDateTime, formatDateTime } =
    await import("@/lib/datetime"));
  ({ formatMutationDateTime } = await import("@/lib/stock-mutation-format"));
});

afterAll(() => {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

describe("omgeving staat op UTC (zoals Vercel)", () => {
  it("een formatter zonder timeZone toont UTC, en dat is precies de bug", () => {
    const naive = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" });
    // 14:30 UTC = 16:30 Amsterdam (zomertijd). Zonder timeZone komt hier 14:30 uit.
    expect(naive.format(new Date("2026-10-01T14:30:00.000Z"))).toBe("14:30");
    expect(new Date("2026-10-01T14:30:00.000Z").getHours()).toBe(14);
  });
});

describe("formatDateTime", () => {
  it("toont zomertijd (UTC+2) ook als het proces op UTC draait", () => {
    expect(formatDateTime("2026-10-01T14:30:00.000Z")).toBe("1 okt 2026, 16:30");
  });

  it("toont wintertijd (UTC+1)", () => {
    expect(formatDateTime("2026-12-01T15:30:00.000Z")).toBe("1 dec 2026, 16:30");
  });

  it("neemt de overgang naar zomertijd mee (29 maart 2026)", () => {
    expect(formatDateTime("2026-03-28T23:30:00.000Z")).toBe("29 mrt 2026, 00:30");
    expect(formatDateTime("2026-03-29T00:30:00.000Z")).toBe("29 mrt 2026, 01:30");
    expect(formatDateTime("2026-03-29T01:30:00.000Z")).toBe("29 mrt 2026, 03:30");
  });

  it("laat de dag over middernacht doorlopen (22:30 UTC is al de volgende dag)", () => {
    expect(formatDateTime("2026-09-30T22:30:00.000Z")).toBe("1 okt 2026, 00:30");
  });

  it("accepteert ook een Date", () => {
    expect(formatDateTime(new Date("2026-10-01T14:30:00.000Z"))).toBe("1 okt 2026, 16:30");
  });
});

describe("formatCompactDateTime", () => {
  it("toont Amsterdamse tijd (de verkoopkaart op /verkoop)", () => {
    expect(formatCompactDateTime("2026-10-01T14:30:00.000Z")).toBe("01-10, 16:30");
    expect(formatCompactDateTime("2026-12-31T23:30:00.000Z")).toBe("01-01, 00:30");
  });
});

describe("formatCalendarDayMonth", () => {
  it("toont de kalenderdag ongewijzigd, ook rond tijdzonegrenzen", () => {
    expect(formatCalendarDayMonth(2026, 9, 22)).toBe("22 sep");
    expect(formatCalendarDayMonth(2026, 1, 1)).toBe("1 jan");
    expect(formatCalendarDayMonth(2026, 3, 29)).toBe("29 mrt");
    expect(formatCalendarDayMonth(2026, 10, 25)).toBe("25 okt");
  });
});

describe("formatMutationDateTime (bestaande naam)", () => {
  it("geeft hetzelfde als formatDateTime", () => {
    expect(formatMutationDateTime("2026-10-01T14:30:00.000Z")).toBe(
      formatDateTime("2026-10-01T14:30:00.000Z"),
    );
  });
});

describe("APP_TIME_ZONE", () => {
  it("is Europe/Amsterdam", () => {
    expect(APP_TIME_ZONE).toBe("Europe/Amsterdam");
  });
});

// ---------------------------------------------------------------------------
// Statische bewaking: niemand mag opnieuw een tijdzone-loze formatter toevoegen.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe("geen datumopmaak buiten @/lib/datetime", () => {
  const root = path.resolve(__dirname, "../..");
  const files = sourceFiles(root);

  it("vindt bronbestanden (anders bewijst de test niets)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("gebruikt toLocaleString/-DateString/-TimeString nergens", () => {
    const offenders = files.filter((file) =>
      /\.toLocale(Date|Time)?String\(/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });

  it("heeft elke Intl.DateTimeFormat met een expliciete timeZone", () => {
    const offenders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      const matches = text.match(/new Intl\.DateTimeFormat\([^)]*?\{[\s\S]*?\}\s*\)/g) ?? [];
      return matches.some((m) => !/timeZone\s*:/.test(m));
    });
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});
