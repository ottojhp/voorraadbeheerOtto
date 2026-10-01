/**
 * Tests voor het vergelijken van meerdere metingen (T25).
 *
 * De klacht die deze module moet oplossen is "soms pakt hij hem, soms komt er
 * onzin uit". De teksten hieronder zijn daarom geen verzinsels: het zijn de echte
 * uitkomsten die Tesseract in de meting voor T20 en T25 op dezelfde afbeelding
 * gaf, ronde na ronde.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MIN_OCR_AGREEMENT,
  describeOcrAgreement,
  pickOcrConsensus,
} from "@/lib/ocr-consensus";

describe("pickOcrConsensus", () => {
  it("geeft niets terug na één meting", () => {
    // Dit is de kern van T25: één losse meting is nooit genoeg, hoe mooi hij ook
    // lijkt. De leeslus hoort dan nog een ronde te doen.
    expect(pickOcrConsensus(["Art.nr: PIA-4T-8455"])).toBeNull();
  });

  it("geeft niets terug als twee metingen iets anders zeggen", () => {
    expect(
      pickOcrConsensus(["Art.nr- PlA-4T.g 455", "Art nr PIA 4T 8455"]),
    ).toBeNull();
  });

  it("accepteert zodra twee metingen hetzelfde nummer opleveren", () => {
    // Het gemeten patroon op een 10° gedraaid beeld: ronde 1 en 3 verminkt, ronde
    // 2 en 4 goed, doordat `rotateAuto` de rotatie van de vorige ronde toepast.
    const consensus = pickOcrConsensus([
      "Art.nr- PlA-4T.g 455",
      "Art.nr: PIA-4T-8455",
      "Art.nr- PlA-4T.g 455",
      "Art.nr: PIA-4T-8455",
    ]);

    expect(consensus).not.toBeNull();
    expect(consensus?.agreement).toBe(2);
    expect(consensus?.readings).toBe(4);
    // De doorgegeven tekst is de RUWE tekst van de gekozen meting, niet een
    // opgeschoonde versie: het scherm hoort te tonen wat de camera las.
    expect(consensus?.text).toBe("Art.nr: PIA-4T-8455");
    expect(consensus?.keys).toContain("P1A4T8455");
  });

  it("kijkt naar hetzelfde NUMMER, niet naar dezelfde letterlijke tekst", () => {
    // Twee metingen die het nummer anders opschrijven (een punt voor een
    // streepje, een I voor een 1) zijn wél overeenstemming: na normaliseren is het
    // hetzelfde nummer. Anders zou de eis van twee metingen bijna nooit gehaald
    // worden, want letterlijk identieke OCR-uitvoer is zeldzaam.
    const consensus = pickOcrConsensus([
      "PIA.4T.8455 ORIGINAL",
      "PlA-4T-8455 0RIGINAL",
    ]);

    expect(consensus?.agreement).toBe(2);
    expect(consensus?.keys).toContain("P1A4T8455");
  });

  it("kiest bij gelijke stand het LANGSTE bevestigde nummer", () => {
    // Een verminkte meting kan zich net zo goed herhalen als een goede. Op het
    // gedraaide proefbeeld uit T20 kwam tweemaal `Art.nr: PIA-4T-8455` en tweemaal
    // `Art.nr- PlA-4T.g 455`; dat laatste laat `P1A4TG` als "bevestigd" nummer
    // achter. Beide staan in twee metingen, dus de telling wijst niets uit.
    const consensus = pickOcrConsensus([
      "Art.nr- PlA-4T.g 455",
      "Art.nr: PIA-4T-8455",
      "Art.nr- PlA-4T.g 455",
      "Art.nr: PIA-4T-8455",
    ]);

    expect(consensus?.text).toBe("Art.nr: PIA-4T-8455");
  });

  it("negeert lege metingen in de telling", () => {
    const consensus = pickOcrConsensus([
      "",
      "   ",
      "PIA-4T-8455",
      "PIA-4T-8455",
    ]);

    expect(consensus?.readings).toBe(2);
    expect(consensus?.agreement).toBe(2);
  });

  it("geeft niets terug als er helemaal niets gelezen is", () => {
    expect(pickOcrConsensus([])).toBeNull();
    expect(pickOcrConsensus(["", "  ", "\n"])).toBeNull();
  });

  it("negeert tekst zonder artikelnummer, ook als die zich herhaalt", () => {
    // "REMBLOKKEN VOOR" staat in elke meting, maar is geen nummer. Zonder deze
    // eis zou de merknaam op de verpakking als overeenstemming gelden.
    expect(
      pickOcrConsensus(["REMBLOKKEN VOOR", "REMBLOKKEN VOOR", "REMBLOKKEN VOOR"]),
    ).toBeNull();
  });

  it("neemt met minAgreement 1 de vaakst voorkomende kandidaat", () => {
    // De terugval na de laatste ronde: liever een wankel resultaat met het aantal
    // metingen erbij dan een scherm dat blijft draaien (SPEC §F8).
    const consensus = pickOcrConsensus(
      ["PIA-4T-8455", "NGK-CR7HSA", "PEU-AF-72310"],
      1,
    );

    expect(consensus).not.toBeNull();
    expect(consensus?.agreement).toBe(1);
    expect(consensus?.readings).toBe(3);
  });

  it("kiest de meting met de meeste bevestigde nummers", () => {
    const consensus = pickOcrConsensus([
      "PIA-4T-8455",
      "EAN 8712345000026",
      "PIA-4T-8455 EAN 8712345000026",
      "PIA-4T-8455 EAN 8712345000026",
    ]);

    expect(consensus?.text).toBe("PIA-4T-8455 EAN 8712345000026");
    expect(consensus?.keys).toEqual(["8712345000026", "P1A4T8455"]);
  });

  it("is deterministisch: dezelfde metingen geven dezelfde uitkomst", () => {
    const readings = [
      "PIA-4T-8455",
      "PlA-4T-8455",
      "NGK-CR7HSA",
      "PIA 4T 8455",
    ];

    expect(pickOcrConsensus(readings)).toEqual(pickOcrConsensus(readings));
  });

  it("eist standaard twee metingen", () => {
    expect(MIN_OCR_AGREEMENT).toBe(2);
  });
});

describe("describeOcrAgreement", () => {
  it("zegt hoe hard de meting was, in het Nederlands", () => {
    expect(describeOcrAgreement(2, 3)).toBe(
      "In 2 van de 3 metingen hetzelfde gelezen.",
    );
  });

  it("waarschuwt als niets bevestigd is", () => {
    // Dit is het geval waarin de eigenaar "onzin" zag: één meting, door niets
    // bevestigd. Dat moet op het scherm staan.
    expect(describeOcrAgreement(1, 1)).toContain("controleer het nummer");
    expect(describeOcrAgreement(1, 6)).toContain("controleer het nummer");
    expect(describeOcrAgreement(0, 6)).toContain("controleer het nummer");
  });

  it("laat nooit een lege of Engelse tekst zien", () => {
    for (const readings of [0, 1, 2, 6]) {
      for (const agreement of [0, 1, 2, 6]) {
        const text = describeOcrAgreement(agreement, readings);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toContain("reading");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Client/server-scheiding (zie CLAUDE.md: dit is twee keer eerder stukgegaan)
// ---------------------------------------------------------------------------

describe("client/server-scheiding", () => {
  it("ocr-consensus.ts heeft geen 'use client' en raakt geen DOM aan", () => {
    // Deze module exporteert gewone functies. Zou er een `"use client"` boven
    // staan, dan maakt Next.js van elke export een client-referentie en crasht
    // elke server component die hem aanroept — precies de bug uit reviewronde 3.
    const source = readFileSync(
      path.resolve(__dirname, "../ocr-consensus.ts"),
      "utf8",
    );

    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/\b(document|window|navigator)\./);
    expect(source).not.toMatch(/from\s+["']react["']/);
    expect(source).not.toMatch(/from\s+["']@\/lib\/db["']/);
  });

  it("TextScanner.tsx ('use client') exporteert alleen het component en types", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../components/TextScanner.tsx"),
      "utf8",
    );
    expect(source.trimStart().startsWith('"use client"')).toBe(true);

    const valueExports = [
      ...source.matchAll(
        /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm,
      ),
    ].map((groups) => groups[1]);
    // `OCR_HEAD_START_MS` is een constante en geen functie: die mag wel, want een
    // client-referentie naar een getal is onschadelijk. Een geëxporteerde FUNCTIE
    // is dat niet.
    expect(valueExports).toEqual(["OCR_HEAD_START_MS", "TextScanner"]);
  });
});
