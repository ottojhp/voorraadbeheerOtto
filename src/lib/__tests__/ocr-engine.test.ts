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
  OCR_CROP,
  computeOcrCrop,
  describeTesseractStatus,
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
