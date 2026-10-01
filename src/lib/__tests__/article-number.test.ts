/**
 * Tests voor de normalisatie- en matchlogica achter het scannen (T20).
 *
 * Dit is het enige deel van de scanfunctie dat hard te bewijzen is: of de camera een
 * verpakking goed leest, hangt af van licht, lens en bedrukking — of twee nummers
 * daarna als hetzelfde gelden, is pure logica.
 *
 * De tests zijn in twee helften geschreven:
 *
 *  1. **moet matchen** — echte artikelnummers uit `prisma/seed.ts`, verminkt zoals
 *     OCR dat doet (O voor 0, I voor 1, S voor 5, spaties erbij, streepjes eraf);
 *  2. **mag NIET matchen** — nummers die écht van elkaar verschillen. Dat is de
 *     belangrijkste helft: een valse treffer leidt tot een voorraadmutatie op het
 *     verkeerde onderdeel, en dat is erger dan geen treffer.
 */

import { describe, expect, it } from "vitest";

import {
  MIN_CONTAINED_LENGTH,
  MIN_TOKEN_LENGTH,
  articleNumbersMatch,
  extractArticleNumberTokens,
  matchScannedText,
  normalizeArticleNumber,
  normalizedScanLines,
  type ArticleNumberCandidate,
} from "@/lib/article-number";

// ---------------------------------------------------------------------------
// Kandidaten: echte waarden uit prisma/seed.ts
// ---------------------------------------------------------------------------

interface TestPart extends ArticleNumberCandidate {
  name: string;
}

const PARTS: TestPart[] = [
  {
    id: "p1",
    name: "Remblokset voor Piaggio Zip",
    sku: "REM-ZIP-001",
    barcode: "8712345000019",
    supplierArticleNumber: "PIA-4T-8412",
  },
  {
    id: "p2",
    name: "Remblokset achter Piaggio Zip",
    sku: "REM-ZIP-002",
    barcode: "8712345000026",
    supplierArticleNumber: "PIA-4T-8455",
  },
  {
    id: "p3",
    name: "Luchtfilter Peugeot Speedfight",
    sku: "FIL-SPF-010",
    barcode: "8712345000101",
    supplierArticleNumber: "PEU-AF-72310",
  },
  {
    id: "p4",
    name: "Bougie NGK CR7HSA",
    sku: "BOU-CR7HSA",
    barcode: "8712345000309",
    supplierArticleNumber: "NGK-CR7HSA",
  },
  {
    id: "p5",
    name: "Buitenband 100/80-16",
    sku: "BUI-10080-16",
    barcode: null,
    supplierArticleNumber: "NZ-TYR-10080-16",
  },
  {
    id: "p6",
    name: "Buitenband 120/70-12",
    sku: "BUI-12070-12",
    barcode: null,
    supplierArticleNumber: "NZ-TYR-12070-12",
  },
  {
    id: "p7",
    name: "Universele olie 10W40",
    sku: "OLI-1040-1L",
    barcode: "8712345000902",
    // Onderdeel zonder leverancier-artikelnummer: mag nooit matchen op "niets".
    supplierArticleNumber: null,
  },
];

// ---------------------------------------------------------------------------
// normalizeArticleNumber
// ---------------------------------------------------------------------------

describe("normalizeArticleNumber", () => {
  it("negeert hoofdletters, spaties en streepjes", () => {
    const key = normalizeArticleNumber("PIA-4T-8412");

    expect(normalizeArticleNumber("pia-4t-8412")).toBe(key);
    expect(normalizeArticleNumber("PIA 4T 8412")).toBe(key);
    expect(normalizeArticleNumber("  pia4t8412  ")).toBe(key);
    expect(normalizeArticleNumber("PIA.4T/8412")).toBe(key);
  });

  it("vouwt de klassieke OCR-verwisselingen samen", () => {
    // O/0
    expect(normalizeArticleNumber("O")).toBe(normalizeArticleNumber("0"));
    // I/1/l
    expect(normalizeArticleNumber("I")).toBe(normalizeArticleNumber("1"));
    expect(normalizeArticleNumber("l")).toBe(normalizeArticleNumber("1"));
    // S/5
    expect(normalizeArticleNumber("S")).toBe(normalizeArticleNumber("5"));
    // B/8
    expect(normalizeArticleNumber("B")).toBe(normalizeArticleNumber("8"));
    // Z/2
    expect(normalizeArticleNumber("Z")).toBe(normalizeArticleNumber("2"));
  });

  it("laat tekens buiten die groepen ongemoeid", () => {
    // G lijkt in print ook op 6, maar staat niet in de lijst uit de criteria en
    // wordt dus NIET samengevouwen. Expliciet vastgelegd zodat een latere
    // uitbreiding een bewuste keuze is.
    expect(normalizeArticleNumber("G")).not.toBe(normalizeArticleNumber("6"));
    expect(normalizeArticleNumber("D")).not.toBe(normalizeArticleNumber("0"));
    expect(normalizeArticleNumber("U")).not.toBe(normalizeArticleNumber("V"));
  });

  it("verwijdert geen tekens uit het nummer zelf en behoudt de lengte", () => {
    expect(normalizeArticleNumber("NZ-TYR-10080-16")).toHaveLength(
      "NZTYR1008016".length,
    );
    // Voorloopnullen blijven staan: 0080 mag nooit 80 worden.
    expect(normalizeArticleNumber("0080")).not.toBe(normalizeArticleNumber("80"));
  });

  it("geeft een lege sleutel voor niets, witruimte en pure scheidingstekens", () => {
    expect(normalizeArticleNumber("")).toBe("");
    expect(normalizeArticleNumber("   ")).toBe("");
    expect(normalizeArticleNumber("---")).toBe("");
    expect(normalizeArticleNumber(null)).toBe("");
    expect(normalizeArticleNumber(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// articleNumbersMatch — en vooral: wat NIET mag matchen
// ---------------------------------------------------------------------------

describe("articleNumbersMatch", () => {
  it("ziet OCR-verminkingen van hetzelfde nummer als gelijk", () => {
    expect(articleNumbersMatch("PIA-4T-8412", "PlA 4T 84I2")).toBe(true);
    expect(articleNumbersMatch("PEU-AF-72310", "PEU AF 723l0")).toBe(true);
    expect(articleNumbersMatch("NGK-CR7HSA", "NGK CR7H5A")).toBe(true);
    expect(articleNumbersMatch("REM-ZIP-001", "rem zip oo1")).toBe(true);
  });

  it("matcht twee écht verschillende nummers NIET", () => {
    // Zelfde prefix, ander nummer — het geval dat aan de balie echt voorkomt.
    expect(articleNumbersMatch("PIA-4T-8412", "PIA-4T-8455")).toBe(false);
    expect(articleNumbersMatch("REM-ZIP-001", "REM-ZIP-002")).toBe(false);
    expect(articleNumbersMatch("NZ-TYR-10080-16", "NZ-TYR-12070-12")).toBe(false);
    // Eén cijfer verschil, buiten de samengevouwen groepen.
    expect(articleNumbersMatch("SYM-RL-3320", "SYM-RL-3420")).toBe(false);
    // Verschillende lengte kan per constructie nooit matchen.
    expect(articleNumbersMatch("8712345000019", "871234500001")).toBe(false);
    // Twee barcodes die op één cijfer verschillen.
    expect(articleNumbersMatch("8712345000019", "8712345000026")).toBe(false);
  });

  it("matcht nooit op een leeg of ontbrekend nummer", () => {
    expect(articleNumbersMatch("", "")).toBe(false);
    expect(articleNumbersMatch(null, null)).toBe(false);
    expect(articleNumbersMatch("---", "")).toBe(false);
    expect(articleNumbersMatch("PIA-4T-8412", null)).toBe(false);
  });

  it("legt de bekende keerzijde vast: I/1/l en L vallen samen", () => {
    // Dit IS een botsing, en een bewuste: het criterium vraagt I/1/l als gelijk te
    // behandelen, en na toUpperCase() is de lowercase l niet meer van een L te
    // onderscheiden. Een leverancier die "-L" (large) en "-1" naast elkaar
    // gebruikt, krijgt hier dus twee kandidaten te zien in plaats van één.
    expect(articleNumbersMatch("ROF-RO9-L", "ROF-RO9-1")).toBe(true);
    // Zelfde verhaal voor de andere groepen: dit is de prijs van de normalisatie.
    expect(articleNumbersMatch("APR-SM-5802I", "APR-SM-58021")).toBe(true);
    expect(articleNumbersMatch("BTC-MIR-L-O8", "8TC-MIR-1-08")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractArticleNumberTokens
// ---------------------------------------------------------------------------

describe("extractArticleNumberTokens", () => {
  it("haalt de artikelnummers uit een rommelige OCR-lap", () => {
    const text = [
      "PIAGGIO ORIGINAL",
      "Remblokset voor",
      "Art.nr: PIA-4T-8412",
      "EAN 8712345000019",
      "Made in Italy",
    ].join("\n");

    expect(extractArticleNumberTokens(text)).toEqual([
      "PIA-4T-8412",
      "8712345000019",
    ]);
  });

  it("negeert woorden zonder cijfer", () => {
    // Zonder deze eis zou "REMBLOKKEN" matchen tegen een sku die alleen uit
    // letters bestaat, en dat is precies de valse treffer die we niet willen.
    expect(extractArticleNumberTokens("REMBLOKKEN SCOOTER VOOR")).toEqual([]);
  });

  it(`negeert stukken korter dan ${MIN_TOKEN_LENGTH} tekens`, () => {
    expect(extractArticleNumberTokens("12 V2 XL 4T")).toEqual([]);
    expect(extractArticleNumberTokens("A1B2")).toEqual(["A1B2"]);
  });

  it("ontdubbelt op hoofdletterniveau en houdt de leesvolgorde aan", () => {
    expect(extractArticleNumberTokens("abc1 ABC1 def2")).toEqual(["abc1", "def2"]);
  });

  it("knipt losse scheidingstekens van de randen", () => {
    expect(extractArticleNumberTokens("-PIA-4T-8412.")).toEqual(["PIA-4T-8412"]);
  });

  it("geeft een lege lijst voor lege invoer", () => {
    expect(extractArticleNumberTokens("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizedScanLines
// ---------------------------------------------------------------------------

describe("normalizedScanLines", () => {
  it("geeft per regel een sleutel, plus de hele tekst als sleutel", () => {
    const keys = normalizedScanLines("PIA 4T 8412\nEAN 8712345000019");

    expect(keys).toContain("P1A4T8412");
    expect(keys).toContain("EAN8712345000019");
    // En de hele tekst aan elkaar, voor het geval OCR de regelafbreking verzon.
    expect(keys).toContain("P1A4T8412EAN8712345000019");
  });

  it("laat lege regels weg", () => {
    expect(normalizedScanLines("\n\n  \n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matchScannedText
// ---------------------------------------------------------------------------

describe("matchScannedText", () => {
  it("vindt een onderdeel op een schone barcode", () => {
    const matches = matchScannedText("8712345000019", PARTS, {
      exactOnly: true,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].candidate.id).toBe("p1");
    expect(matches[0].field).toBe("barcode");
    expect(matches[0].kind).toBe("exact");
  });

  it("vindt een onderdeel op een door OCR verminkt leverancier-artikelnummer", () => {
    const matches = matchScannedText("Art.nr PlA-4T-84I2", PARTS);

    expect(matches).toHaveLength(1);
    expect(matches[0].candidate.id).toBe("p1");
    expect(matches[0].field).toBe("supplierArticleNumber");
    expect(matches[0].kind).toBe("normalized");
    // De UI toont de OPGESLAGEN waarde, niet wat de camera meende te lezen.
    expect(matches[0].value).toBe("PIA-4T-8412");
  });

  it("vindt een onderdeel waarvan OCR het nummer in losse stukken brak", () => {
    const matches = matchScannedText("PIA 4T 8412", PARTS);

    expect(matches.map((match) => match.candidate.id)).toEqual(["p1"]);
    expect(matches[0].kind).toBe("normalized");
  });

  it("geeft een barcodetreffer voorrang boven een artikelnummertreffer", () => {
    // Deze tekst bevat de barcode van p1 én het artikelnummer van p2.
    const matches = matchScannedText("8712345000019 PIA-4T-8455", PARTS);

    expect(matches).toHaveLength(2);
    expect(matches[0].candidate.id).toBe("p1");
    expect(matches[0].field).toBe("barcode");
    expect(matches[1].candidate.id).toBe("p2");
    expect(matches[1].field).toBe("supplierArticleNumber");
  });

  it("geeft meerdere kandidaten terug als de scan er niet één uitwijst", () => {
    // De sleutel van "BUI-10080-16" en "BUI-12070-12" verschillen, maar beide
    // artikelnummers staan in deze tekst. Dan moet de gebruiker kiezen.
    const matches = matchScannedText("NZ-TYR-10080-16 / NZ-TYR-12070-12", PARTS);

    expect(matches.map((match) => match.candidate.id).sort()).toEqual(["p5", "p6"]);
  });

  it("matcht een onderdeel zonder barcode of artikelnummer nergens op", () => {
    // p7 heeft `supplierArticleNumber: null`. Een mislukte scan mag hem niet
    // aanwijzen, ook niet op een lege sleutel.
    expect(matchScannedText("", PARTS)).toEqual([]);
    expect(matchScannedText("   ", PARTS)).toEqual([]);
    expect(matchScannedText("------", PARTS)).toEqual([]);
  });

  it("levert geen treffer op voor een nummer dat er alleen op lijkt", () => {
    expect(matchScannedText("PIA-4T-8499", PARTS)).toEqual([]);
    expect(matchScannedText("REM-ZIP-009", PARTS)).toEqual([]);
    expect(matchScannedText("8712345999999", PARTS, { exactOnly: true })).toEqual([]);
  });

  it("gebruikt 'komt voor in de regel' alleen als er niets hards is", () => {
    // "8712345000019" zit in deze langere cijferreeks. Zonder harde treffer mag dat
    // als zwak bewijs meedoen...
    const weak = matchScannedText("X98712345000019Y", PARTS);
    expect(weak).toHaveLength(1);
    expect(weak[0].kind).toBe("contained");

    // ...maar zodra er een harde treffer is, verdwijnt de zwakke uit de lijst.
    const strong = matchScannedText("PIA-4T-8455 X98712345000019Y", PARTS);
    expect(strong.map((match) => match.candidate.id)).toEqual(["p2"]);
  });

  it(`staat geen 'komt voor in'-treffer toe onder ${MIN_CONTAINED_LENGTH} tekens`, () => {
    const short: TestPart[] = [
      { id: "s1", name: "Kort", sku: "A1B2", barcode: null, supplierArticleNumber: null },
    ];

    // "A1B2" zit letterlijk in deze reeks, maar is te kort om als bewijs te gelden.
    expect(matchScannedText("ZZA1B299", short)).toEqual([]);
  });

  it("staat bij een barcode geen 'komt voor in'-treffer toe", () => {
    // Een scanner die een langere code leest, mag nooit "bijna" een bestaande
    // barcode raken: bij `exactOnly` wordt stap 3 overgeslagen.
    expect(
      matchScannedText("98712345000019", PARTS, { exactOnly: true }),
    ).toEqual([]);
  });

  it("respecteert de limiet", () => {
    const matches = matchScannedText(
      "REM-ZIP-001 REM-ZIP-002 FIL-SPF-010 BOU-CR7HSA",
      PARTS,
      { limit: 2 },
    );

    expect(matches).toHaveLength(2);
  });

  it("geeft per onderdeel maximaal één treffer: de sterkste", () => {
    // Zowel de sku als de barcode van p1 staan in deze tekst; p1 hoort één keer in
    // de lijst te staan, met de barcode als bron (het hardste bewijs).
    const matches = matchScannedText("REM-ZIP-001 8712345000019", PARTS);

    expect(matches).toHaveLength(1);
    expect(matches[0].candidate.id).toBe("p1");
    expect(matches[0].field).toBe("barcode");
    expect(matches[0].kind).toBe("exact");
  });

  it("is deterministisch: dezelfde scan geeft dezelfde volgorde", () => {
    const text = "NZ-TYR-10080-16 NZ-TYR-12070-12";
    const first = matchScannedText(text, PARTS).map((match) => match.candidate.id);
    const second = matchScannedText(text, [...PARTS].reverse()).map(
      (match) => match.candidate.id,
    );

    expect(second).toEqual(first);
  });
});
