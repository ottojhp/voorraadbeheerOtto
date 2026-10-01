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
  allowedCorrections,
  approximateSubstringDistance,
  articleNumbersMatch,
  damerauLevenshtein,
  extractArticleNumberTokens,
  matchScannedText,
  minDistanceToOtherCandidate,
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

// ---------------------------------------------------------------------------
// T25 — bewerkingsafstand
// ---------------------------------------------------------------------------

describe("damerauLevenshtein", () => {
  it("is 0 voor gelijke tekst en de lengte tegenover niets", () => {
    expect(damerauLevenshtein("P1A4T8412", "P1A4T8412")).toBe(0);
    expect(damerauLevenshtein("", "")).toBe(0);
    expect(damerauLevenshtein("ABC", "")).toBe(3);
    expect(damerauLevenshtein("", "ABC")).toBe(3);
  });

  it("telt vervangen, invoegen en verwijderen elk als één stap", () => {
    expect(damerauLevenshtein("8412", "8419")).toBe(1); // vervangen
    expect(damerauLevenshtein("8412", "84112")).toBe(1); // invoegen
    expect(damerauLevenshtein("8412", "812")).toBe(1); // verwijderen
    expect(damerauLevenshtein("8412", "9419")).toBe(2);
  });

  it("rekent twee verwisselde tekens als ÉÉN stap, niet twee", () => {
    // Dit is waarom het Damerau-Levenshtein moet zijn en niet gewoon
    // Levenshtein: OCR draait regelmatig twee tekens om, en dat is één leesfout.
    expect(damerauLevenshtein("8412", "8142")).toBe(1);
    expect(damerauLevenshtein("PIA4T8412", "PIA4T8421")).toBe(1);
  });

  it("is de echte Damerau-Levenshtein en niet 'optimal string alignment'", () => {
    // Het schoolvoorbeeld: met OSA is dit 3, met de echte afstand 2 (verwissel
    // CA → AC en voeg de B in). De naam in de acceptatiecriteria is de echte.
    expect(damerauLevenshtein("CA", "ABC")).toBe(2);
  });

  it("is symmetrisch", () => {
    expect(damerauLevenshtein("REM21P001", "P1A4T8412")).toBe(
      damerauLevenshtein("P1A4T8412", "REM21P001"),
    );
  });

  it("kapt af boven de meegegeven grens", () => {
    // De exacte waarde boven de grens is niet betrouwbaar; dat hij GROTER is dan
    // de grens, is wat de aanroeper gebruikt.
    expect(damerauLevenshtein("AAAA", "BBBB", 1)).toBeGreaterThan(1);
    expect(damerauLevenshtein("AAAA", "AAAAAAAAAA", 2)).toBeGreaterThan(2);
    // En binnen de grens blijft hij exact.
    expect(damerauLevenshtein("8412", "8419", 2)).toBe(1);
  });
});

describe("approximateSubstringDistance", () => {
  it("maakt de randen gratis: een nummer dat ergens in de regel staat is 0", () => {
    expect(approximateSubstringDistance("P1A4T8455", "ARTNRP1A4T8455")).toBe(0);
    expect(approximateSubstringDistance("P1A4T8455", "P1A4T8455EAN871")).toBe(0);
  });

  it("meet in zo'n regel precies de fouten in het nummer zelf", () => {
    // Dit is letterlijk wat T20 op een 10° gedraaid beeld las voor PIA-4T-8455:
    // "Art.nr- PlA-4T.g 455" → sleutel ARTNRP1A4TG455. Eén teken fout (G voor 8),
    // en dat moet ook één zijn en niet vijf.
    expect(approximateSubstringDistance("P1A4T8455", "ARTNRP1A4TG455")).toBe(1);
  });

  it("geeft de lengte terug als er niets te vinden is", () => {
    expect(approximateSubstringDistance("ABC", "")).toBe(3);
    expect(approximateSubstringDistance("", "ABC")).toBe(0);
  });
});

describe("allowedCorrections", () => {
  it("volgt de criteria: 2 vanaf 6 tekens, 1 bij kortere", () => {
    expect(allowedCorrections(6)).toBe(2);
    expect(allowedCorrections(9)).toBe(2);
    expect(allowedCorrections(13)).toBe(2);
    expect(allowedCorrections(5)).toBe(1);
    expect(allowedCorrections(4)).toBe(1);
    expect(allowedCorrections(3)).toBe(1);
  });

  it("staat bij heel korte nummers helemaal niets toe", () => {
    // Een nummer van twee tekens waarin één teken gecorrigeerd mag worden, matcht
    // op bijna elke andere code van twee tekens. Dat is geen hulp maar een val.
    expect(allowedCorrections(2)).toBe(0);
    expect(allowedCorrections(1)).toBe(0);
    expect(allowedCorrections(0)).toBe(0);
    expect(allowedCorrections(Number.NaN)).toBe(0);
  });
});

describe("minDistanceToOtherCandidate", () => {
  it("meet de afstand naar het dichtstbijzijnde nummer van een ANDER onderdeel", () => {
    // PIA-4T-8412 en PIA-4T-8455 staan op afstand 2 van elkaar.
    expect(
      minDistanceToOtherCandidate(normalizeArticleNumber("PIA-4T-8412"), "p1", PARTS),
    ).toBe(2);
    // REM-ZIP-001 en REM-ZIP-002 op afstand 1.
    expect(
      minDistanceToOtherCandidate(normalizeArticleNumber("REM-ZIP-001"), "p1", PARTS),
    ).toBe(1);
  });

  it("negeert de andere nummers van hetzelfde onderdeel", () => {
    // De sku, barcode en het leveranciersnummer van p1 wijzen naar hetzelfde
    // artikel; onderling kunnen ze dus geen verwarring opleveren. Zonder deze
    // uitzondering zou elk onderdeel zijn eigen drempel verpesten.
    const distance = minDistanceToOtherCandidate(
      normalizeArticleNumber("PEU-AF-72310"),
      "p3",
      PARTS,
    );
    expect(distance).toBeGreaterThan(2);
  });

  it("is oneindig als er geen ander nummer is", () => {
    expect(minDistanceToOtherCandidate("P1A4T8412", "p1", [PARTS[0]])).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

// ---------------------------------------------------------------------------
// T25 — benaderend matchen
// ---------------------------------------------------------------------------

describe("matchScannedText met approximate", () => {
  const approx = { approximate: true } as const;

  it("staat standaard UIT", () => {
    // Wie de oude, strenge werking wil, krijgt die nog steeds. Benaderend matchen
    // is een keuze van de aanroeper, niet iets wat er ongemerkt bijkomt.
    expect(matchScannedText("PEU-AF-72319", PARTS)).toEqual([]);
  });

  it("vindt het onderdeel bij één verkeerd gelezen teken", () => {
    // Een 9 voor een 0 valt buiten het verwisselingslijstje (O/0, I/1, S/5, B/8,
    // Z/2) en liet in T20 dus de hele scan mislukken.
    const matches = matchScannedText("PEU-AF-72319", PARTS, approx);

    expect(matches).toHaveLength(1);
    expect(matches[0].candidate.id).toBe("p3");
    expect(matches[0].kind).toBe("approximate");
    expect(matches[0].distance).toBe(1);
    expect(matches[0].value).toBe("PEU-AF-72310");
  });

  it("vindt het onderdeel bij twee verwisselde tekens", () => {
    const matches = matchScannedText("PEU-AF-72301", PARTS, approx);

    expect(matches.map((match) => match.candidate.id)).toEqual(["p3"]);
    expect(matches[0].distance).toBe(1);
  });

  it("leest het nummer uit een regel met tekst eromheen", () => {
    // Het gemeten geval uit T20: 10° gedraaid beeld, PIA-4T-8455 gelezen als
    // "Art.nr- PlA-4T.g 455". Dat leverde toen GEEN treffer op; dit is de reden
    // dat T25 bestaat.
    const matches = matchScannedText("Art.nr- PlA-4T.g 455", PARTS, approx);

    expect(matches).toHaveLength(1);
    expect(matches[0].candidate.id).toBe("p2");
    expect(matches[0].value).toBe("PIA-4T-8455");
    expect(matches[0].distance).toBe(1);
  });

  it("gebruikt benaderend matchen alleen als er niets hards is", () => {
    // p1 staat er exact in; p3 zou op afstand 1 liggen. Alleen de harde treffer
    // komt terug, zodat de gebruiker niet tussen zeker en onzeker moet kiezen.
    const matches = matchScannedText("REM-ZIP-001 PEU-AF-72319", PARTS, approx);

    expect(matches.map((match) => match.candidate.id)).toEqual(["p1"]);
    expect(matches[0].kind).toBe("exact");
    expect(matches[0].distance).toBe(0);
  });

  it("doet niets bij een barcode: die houdt zijn strenge pad", () => {
    // De eigenaar meldde dat barcodes goed werken. Eén cijfer naast een bestaande
    // EAN mag nooit een treffer worden; `exactOnly` overrulet `approximate`.
    expect(
      matchScannedText("8712345000018", PARTS, {
        ...approx,
        exactOnly: true,
      }),
    ).toEqual([]);
  });

  it("toont BEIDE kandidaten op dezelfde afstand en kiest er nooit één", () => {
    // Precies tussen NZ-TYR-10080-16 en NZ-TYR-12070-12 in: van beide twee tekens
    // verwijderd. Dan hoort de gebruiker te kiezen (criterium "nooit gokken").
    const matches = matchScannedText("NZ-TYR-10070-19", PARTS, approx);

    expect(matches.length).toBeGreaterThan(1);
    expect(matches.map((match) => match.candidate.id).sort()).toEqual([
      "p5",
      "p6",
    ]);
    for (const match of matches) {
      expect(match.distance).toBe(matches[0].distance);
    }
  });

  it("laat een verdere kandidaat weg als er een dichtere is", () => {
    // Afstand 1 is harder bewijs dan afstand 2; ze naast elkaar zetten zou de
    // gebruiker laten kiezen tussen ongelijkwaardige dingen.
    const matches = matchScannedText("NGK-CR7H5B", PARTS, approx);

    expect(matches).toHaveLength(1);
    expect(matches[0].candidate.id).toBe("p4");
    expect(matches[0].distance).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T25 — en nu de belangrijkste helft: GEEN valse treffers
// ---------------------------------------------------------------------------

describe("matchScannedText: valse treffers zijn erger dan geen treffer", () => {
  const approx = { approximate: true } as const;

  it("matcht twee écht verschillende nummers nooit op elkaar", () => {
    // Elk nummer van elk onderdeel, letterlijk gescand, mag NOOIT een ander
    // onderdeel aanwijzen. Dit is de test die bewijst dat de hele voorraadlijst
    // intern consistent is onder deze regels.
    for (const part of PARTS) {
      for (const value of [part.sku, part.barcode, part.supplierArticleNumber]) {
        if (value === null) {
          continue;
        }
        const matches = matchScannedText(value, PARTS, approx);
        expect(matches.length).toBeGreaterThan(0);
        for (const match of matches) {
          expect(match.candidate.id).toBe(part.id);
        }
      }
    }
  });

  it("wijst bij nummers die op elkaar lijken liever NIETS aan", () => {
    // PIA-4T-8412 en PIA-4T-8455 staan op afstand 2 van elkaar. Een scan die van
    // beide 2 tekens afwijkt, mag er geen van de twee uitkiezen — de drempel
    // wordt juist STRENGER omdat de bekende nummers op elkaar lijken.
    expect(matchScannedText("PIA-4T-8499", PARTS, approx)).toEqual([]);
    // REM-ZIP-001 en REM-ZIP-002 staan op afstand 1: daar is zelfs één correctie
    // al te veel.
    expect(matchScannedText("REM-ZIP-009", PARTS, approx)).toEqual([]);
    expect(matchScannedText("REM-ZIP-003", PARTS, approx)).toEqual([]);
  });

  it("maakt van onzin geen onderdeel", () => {
    for (const nonsense of [
      "QQQQQQQQQ",
      "1234567890123",
      "REMBLOKKEN SCOOTER",
      "Made in Italy 2026",
      "XX-YY-9999",
      "99999999999999999999",
    ]) {
      const matches = matchScannedText(nonsense, PARTS, approx);
      for (const match of matches) {
        // Als er al iets terugkomt, mag het nooit een benaderende gok zijn.
        expect(match.kind).not.toBe("approximate");
      }
    }
  });

  it("wijst bij één verminkt teken nooit UITSLUITEND een ander onderdeel aan", () => {
    // De sterkste eigenschap die hier te bewijzen is, en systematisch getest in
    // plaats van met een handvol voorbeelden: verminkt elk teken van elk nummer
    // van elk onderdeel, één voor één, met vier vervangingen. Dan is de uitkomst
    // altijd één van deze drie:
    //
    //  - niets (de app durft het niet, dat mag altijd);
    //  - het JUISTE onderdeel staat ertussen;
    //  - of de verminking is per ongeluk exact het nummer van een ander
    //    onderdeel geworden — dan is dát de juiste treffer en geen valse.
    //
    // Wat NIET mag gebeuren is dat er alleen een verkeerd onderdeel staat. Dat
    // zou aan de balie leiden tot een voorraadmutatie op het verkeerde artikel.
    let withMatch = 0;
    let withoutMatch = 0;

    for (const part of PARTS) {
      for (const value of [part.sku, part.barcode, part.supplierArticleNumber]) {
        if (value === null) {
          continue;
        }
        for (let index = 0; index < value.length; index += 1) {
          if (!/[A-Z0-9]/i.test(value[index])) {
            continue;
          }
          for (const replacement of ["Q", "7", "3", "X"]) {
            const broken =
              value.slice(0, index) + replacement + value.slice(index + 1);
            const matches = matchScannedText(broken, PARTS, approx);
            if (matches.length === 0) {
              withoutMatch += 1;
              continue;
            }
            withMatch += 1;

            const ids = matches.map((match) => match.candidate.id);
            if (ids.includes(part.id)) {
              continue;
            }
            // Geen treffer op het eigen onderdeel: dan MOET de verminkte tekst
            // letterlijk het nummer van het aangewezen onderdeel zijn.
            for (const match of matches) {
              expect(normalizeArticleNumber(match.value)).toBe(
                normalizeArticleNumber(broken),
              );
            }
          }
        }
      }
    }

    // Dat deze test iets te controleren had: er moeten verminkingen bij zitten
    // die wél een treffer opleveren, anders bewijst hij niets.
    expect(withMatch).toBeGreaterThan(50);
    expect(withoutMatch).toBeGreaterThan(0);
  });

  it("corrigeert nooit meer tekens dan toegestaan", () => {
    // Drie tekens fout op een nummer van 12 blijft onder de grens van 2.
    expect(matchScannedText("NZ-TYR-99999-16", PARTS, approx)).toEqual([]);
    // En een kort nummer mag maar één correctie krijgen.
    const short: TestPart[] = [
      {
        id: "s1",
        name: "Kort",
        sku: "A1B2",
        barcode: null,
        supplierArticleNumber: null,
      },
    ];
    expect(matchScannedText("A1B7", short, approx)).toHaveLength(1);
    expect(matchScannedText("A7B7", short, approx)).toEqual([]);
  });

  it("is deterministisch, ook benaderend", () => {
    const text = "NZ-TYR-10070-19";
    const first = matchScannedText(text, PARTS, approx).map((m) => m.candidate.id);
    const second = matchScannedText(text, [...PARTS].reverse(), approx).map(
      (m) => m.candidate.id,
    );

    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });
});
