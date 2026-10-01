/**
 * Tests voor de PURE delen van de tekstherkenning (T20).
 *
 * De engines zelf (Tesseract, `TextDetector`) zijn hier niet te testen: die willen
 * een echte browser, een worker en een camerabeeld. Wat wél te testen is — en wat
 * stil fout kan gaan zonder dat iemand het merkt — is het rekenwerk eromheen: welke
 * uitsnede van het beeld naar de herkenning gaat, en of de Engelse statusmeldingen
 * van Tesseract altijd als Nederlandse tekst op het scherm belanden.
 */

import { describe, expect, it } from "vitest";

import {
  OCR_CHAR_WHITELIST,
  OCR_CROP,
  OCR_UPSCALE,
  computeOcrCrop,
  describeTesseractStatus,
  enhanceOcrPixels,
  hasTextDetector,
} from "@/lib/ocr-engine";

describe("computeOcrCrop", () => {
  it("snijdt een gecentreerde strook uit het beeld", () => {
    const crop = computeOcrCrop(1280, 720);

    expect(crop).not.toBeNull();
    if (crop === null) return;

    expect(crop.sourceWidth).toBe(Math.round(1280 * OCR_CROP.widthRatio));
    expect(crop.sourceHeight).toBe(Math.round(720 * OCR_CROP.heightRatio));
    // Even veel ruimte links als rechts, en boven als onder: het richtkader staat
    // in het midden van het scherm. Eén pixel scheelte is afronding op hele
    // pixels, niet een scheve uitsnede.
    const marginRight = 1280 - (crop.sourceX + crop.sourceWidth);
    const marginBottom = 720 - (crop.sourceY + crop.sourceHeight);
    expect(Math.abs(crop.sourceX - marginRight)).toBeLessThanOrEqual(1);
    expect(Math.abs(crop.sourceY - marginBottom)).toBeLessThanOrEqual(1);
  });

  it("blijft binnen het beeld, ook bij een vierkant of staand frame", () => {
    for (const [width, height] of [
      [640, 480],
      [480, 640],
      [720, 720],
      [1920, 1080],
    ]) {
      const crop = computeOcrCrop(width, height);
      expect(crop).not.toBeNull();
      if (crop === null) continue;

      expect(crop.sourceX).toBeGreaterThanOrEqual(0);
      expect(crop.sourceY).toBeGreaterThanOrEqual(0);
      expect(crop.sourceX + crop.sourceWidth).toBeLessThanOrEqual(width);
      expect(crop.sourceY + crop.sourceHeight).toBeLessThanOrEqual(height);
    }
  });

  it("schaalt een kleine uitsnede op, maar nooit verder dan 2×", () => {
    const small = computeOcrCrop(320, 240);
    expect(small).not.toBeNull();
    if (small !== null) {
      // Kleine druk op een telefooncamera leest beter als het beeld groter is.
      expect(small.canvasWidth).toBe(small.sourceWidth * 2);
    }

    const large = computeOcrCrop(3840, 2160);
    expect(large).not.toBeNull();
    if (large !== null) {
      // Een al groot beeld wordt niet verkleind en ook niet verder opgeblazen.
      expect(large.canvasWidth).toBe(large.sourceWidth);
    }
  });

  it("geeft null als er nog geen beeld is", () => {
    // Dit is de normale toestand in de eerste tienden van een seconde na het
    // starten van de camera: `videoWidth` is dan 0.
    expect(computeOcrCrop(0, 0)).toBeNull();
    expect(computeOcrCrop(0, 480)).toBeNull();
    expect(computeOcrCrop(Number.NaN, 480)).toBeNull();
  });
});

describe("describeTesseractStatus", () => {
  it("vertaalt de bekende statussen naar het Nederlands", () => {
    expect(describeTesseractStatus("loading language traineddata", 0.4)).toEqual({
      label: "Taalmodel downloaden…",
      fraction: 0.4,
    });
    expect(describeTesseractStatus("recognizing text", 1).label).toBe(
      "Tekst lezen…",
    );
  });

  it("laat nooit Engels doorsijpelen bij een onbekende status", () => {
    const result = describeTesseractStatus("some future status", 0.5);

    expect(result.label).toBe("Tekstherkenning voorbereiden…");
    expect(result.label).not.toContain("status");
  });

  it("negeert een onbruikbare voortgangswaarde", () => {
    expect(describeTesseractStatus("recognizing text", Number.NaN).fraction).toBeNull();
    expect(describeTesseractStatus("recognizing text", -1).fraction).toBeNull();
    expect(describeTesseractStatus("recognizing text", 42).fraction).toBeNull();
  });
});

describe("hasTextDetector", () => {
  it("is onwaar waar geen browser is (zoals hier, in Node)", () => {
    // Belangrijk voor de serverrender: dit mag niet gooien bij het ontbreken van
    // `window`, want het scanscherm wordt ook op de server gerenderd.
    expect(hasTextDetector()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T25 — beeldbewerking vóór de herkenning
// ---------------------------------------------------------------------------

/** Eén RGBA-pixel per grijswaarde, als beeldje van `values.length` pixels. */
function pixels(values: readonly number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, index) => {
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  });
  return data;
}

/** De grijswaarden terug uit een bewerkt beeldje. */
function grays(data: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    out.push(data[i]);
  }
  return out;
}

describe("enhanceOcrPixels", () => {
  it("maakt van kleur grijswaarden met gelijke R, G en B", () => {
    // Rode druk op een donkere ondergrond: met een rekenkundig gemiddelde zou het
    // verschil tussen letter en achtergrond grotendeels verdwijnen.
    const data = new Uint8ClampedArray([200, 30, 30, 255, 30, 30, 200, 255]);
    enhanceOcrPixels(data);

    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
    expect(data[4]).toBe(data[5]);
    // Rood weegt zwaarder dan blauw, dus de rode pixel wordt lichter dan de
    // blauwe. Dat is precies waarom er niet gewoon gedeeld wordt door drie.
    expect(data[0]).toBeGreaterThan(data[4]);
  });

  it("rekt een contrastarm beeld op naar de volle schaal", () => {
    // Dit is het geval uit de werkplaats: grijze druk op een grijze verpakking.
    // Tesseract legt zijn zwart-witdrempel over het hele beeld; hoe verder de
    // waarden uit elkaar liggen, hoe minder die drempel uitmaakt.
    const data = pixels([110, 120, 130, 140, 150]);
    const stretched = enhanceOcrPixels(data);

    expect(stretched).toBe(true);
    const result = grays(data);
    expect(Math.min(...result)).toBe(0);
    expect(Math.max(...result)).toBe(255);
    // De volgorde blijft kloppen: lichter blijft lichter.
    expect(result).toEqual([...result].sort((a, b) => a - b));
  });

  it("laat een beeld dat de schaal al gebruikt ongemoeid", () => {
    // Niet oprekken wat al opgerekt is. De meting van T25 liet zien waarom: op een
    // korrelig beeld blies het oprekken het verschil tussen twee korrels op tot
    // het verschil tussen inkt en papier, en werd leesbare druk onleesbaar.
    const data = pixels([0, 64, 128, 192, 255]);
    const stretched = enhanceOcrPixels(data);

    expect(stretched).toBe(false);
    expect(grays(data)).toEqual([0, 64, 128, 192, 255]);
  });

  it("rekt niet op bij korrel die de volle schaal al beslaat", () => {
    // Een korrelig beeld van een telefooncamera bij weinig licht: lichte
    // achtergrond met ruis, een paar donkere pixels druk. Het bereik is al vol.
    const values = [
      ...new Array<number>(60).fill(210),
      ...new Array<number>(30).fill(245),
      ...new Array<number>(8).fill(20),
      ...new Array<number>(2).fill(0),
    ];
    const data = pixels(values);

    expect(enhanceOcrPixels(data)).toBe(false);
    expect(grays(data).slice(0, 2)).toEqual([210, 210]);
  });

  it("laat een vlak beeld met rust in plaats van ruis te versterken", () => {
    // Lens tegen de doos, of een volledig overbelicht frame. Oprekken zou van
    // korrel letters maken en dat is precies de "onzin" die de eigenaar zag.
    const data = pixels([128, 130, 132, 134, 136]);
    const stretched = enhanceOcrPixels(data);

    expect(stretched).toBe(false);
    expect(grays(data)).toEqual([128, 130, 132, 134, 136]);
  });

  it("laat kleine druk het bereik bepalen in plaats van hem weg te knippen", () => {
    // Een contrastarme strook van 400 pixels waarvan maar 4 (1%) de druk zijn.
    // Met een ruimere knipgrens zou de druk zelf weggeknipt worden, werd de
    // ACHTERGROND het donkerste punt, en ging de bewerking de verkeerde kant op.
    const values = [
      ...new Array<number>(396).fill(150),
      ...new Array<number>(4).fill(100),
    ];
    const data = pixels(values);

    expect(enhanceOcrPixels(data)).toBe(true);
    const result = grays(data);
    expect(result[0]).toBe(255); // achtergrond wit
    expect(result[399]).toBe(0); // de druk zwart
  });

  it("behandelt een doorzichtige pixel als wit en maakt alles dekkend", () => {
    // Dit is geen theorie: de proefbeelden voor de meting kwamen uit een PDF en
    // hadden een doorzichtige achtergrond. Zonder deze regel werd het hele beeld
    // pikzwart en las Tesseract er helemaal niets meer uit.
    const data = new Uint8ClampedArray([
      0, 0, 0, 0, // volledig doorzichtig → wit
      0, 0, 0, 255, // echt zwart
    ]);
    enhanceOcrPixels(data);

    expect(data[0]).toBe(255);
    expect(data[3]).toBe(255);
    expect(data[4]).toBe(0);
    expect(data[7]).toBe(255);
  });

  it("gooit niet op een leeg beeld", () => {
    expect(enhanceOcrPixels(new Uint8ClampedArray(0))).toBe(false);
  });
});

describe("OCR_UPSCALE", () => {
  it("schaalt verder op dan de standaard van computeOcrCrop", () => {
    // De standaardwaarden blijven staan zoals T20 ze gemeten heeft; het
    // scanscherm vraagt expliciet om meer, want op kleine druk van een echte
    // verpakking is 2× te weinig.
    const standaard = computeOcrCrop(640, 480);
    const scan = computeOcrCrop(640, 480, OCR_UPSCALE);

    expect(standaard).not.toBeNull();
    expect(scan).not.toBeNull();
    if (standaard === null || scan === null) return;

    expect(scan.sourceWidth).toBe(standaard.sourceWidth);
    expect(scan.canvasWidth).toBeGreaterThan(standaard.canvasWidth);
    expect(scan.canvasWidth).toBe(standaard.sourceWidth * 3);
  });

  it("blaast een al groot beeld niet op", () => {
    const scan = computeOcrCrop(3840, 2160, OCR_UPSCALE);
    expect(scan).not.toBeNull();
    if (scan === null) return;

    expect(scan.canvasWidth).toBe(scan.sourceWidth);
  });

  it("houdt de breedte onder de bovengrens", () => {
    for (const [width, height] of [
      [320, 240],
      [640, 480],
      [1280, 720],
    ]) {
      const scan = computeOcrCrop(width, height, OCR_UPSCALE);
      expect(scan).not.toBeNull();
      if (scan === null) continue;

      expect(scan.canvasWidth).toBeLessThanOrEqual(OCR_UPSCALE.maxWidth);
      // En de verhoudingen blijven gelijk: vervormde letters leest niemand.
      const sourceRatio = scan.sourceWidth / scan.sourceHeight;
      const canvasRatio = scan.canvasWidth / scan.canvasHeight;
      expect(Math.abs(sourceRatio - canvasRatio)).toBeLessThan(0.02);
    }
  });
});

describe("OCR_CHAR_WHITELIST", () => {
  it("bevat precies wat er in een artikelnummer kan staan", () => {
    expect(OCR_CHAR_WHITELIST).toContain("A");
    expect(OCR_CHAR_WHITELIST).toContain("Z");
    expect(OCR_CHAR_WHITELIST).toContain("0");
    expect(OCR_CHAR_WHITELIST).toContain("9");
    expect(OCR_CHAR_WHITELIST).toContain("-");
    expect(OCR_CHAR_WHITELIST).toContain(".");
  });

  it("bevat geen kleine letters, spaties of leestekens", () => {
    expect(OCR_CHAR_WHITELIST).not.toMatch(/[a-z]/);
    expect(OCR_CHAR_WHITELIST).not.toContain(" ");
    expect(OCR_CHAR_WHITELIST).not.toContain(":");
    expect(OCR_CHAR_WHITELIST).not.toContain(",");
  });

  it("bevat elk teken één keer", () => {
    expect(new Set(OCR_CHAR_WHITELIST).size).toBe(OCR_CHAR_WHITELIST.length);
  });
});
