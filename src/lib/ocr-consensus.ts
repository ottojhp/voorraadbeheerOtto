/**
 * Meerdere metingen van dezelfde scène vergelijken (T25).
 *
 * De klacht uit de werkplaats was "soms pakt hij hem, soms komt er onzin uit". Dat
 * is precies wat één losse meting oplevert: Tesseract leest hetzelfde stilstaande
 * beeld per ronde anders, afhankelijk van de scherpte van dat frame en — met
 * `rotateAuto` — van de scheefstand die hij in de VORIGE ronde gemeten heeft.
 *
 * T20 nam de eerste ronde waarin er iets stond dat op een artikelnummer leek. Deze
 * module legt daar een eis boven: een leesresultaat telt pas als er een stuk tekst
 * in zit dat in minstens twee metingen hetzelfde opleverde. Eén verminkte ronde
 * haalt het dan niet meer, en als er na alle rondes nog geen overeenstemming is
 * wordt de vaakst voorkomende kandidaat genomen — met het aantal metingen erbij,
 * zodat het scherm kan zeggen hoe wankel het is.
 *
 * PUUR: geen DOM, geen camera, geen Tesseract. In gaat een lijst gelezen teksten,
 * uit komt de meting die doorgegeven wordt.
 */

import {
  extractArticleNumberTokens,
  normalizeArticleNumber,
} from "@/lib/article-number";

/**
 * Hoeveel metingen hetzelfde moeten opleveren voordat een resultaat doorgegeven
 * wordt. Twee: drie zou betrouwbaarder zijn, maar elke ronde kost op een telefoon
 * een seconde of meer en de gebruiker staat met een pakje in zijn hand.
 */
export const MIN_OCR_AGREEMENT = 2;

export interface OcrConsensus {
  /**
   * De gelezen tekst die doorgegeven wordt: de volledige, RUWE tekst van de
   * gekozen meting. Met opzet niet "alleen het stabiele stuk" — het scherm hoort
   * te tonen wat de camera werkelijk las, en het matchen gebruikt zowel de losse
   * stukken als de hele regel.
   */
  text: string;
  /**
   * De genormaliseerde sleutels die in minstens {@link MIN_OCR_AGREEMENT} metingen
   * voorkwamen (of, bij een lagere eis, de vaakst voorkomende). Alleen om te
   * verantwoorden waarom déze meting gekozen is.
   */
  keys: string[];
  /** In hoeveel metingen de best scorende sleutel voorkwam. */
  agreement: number;
  /** Hoeveel metingen er meegedaan hebben (lege metingen tellen niet mee). */
  readings: number;
}

/**
 * Kiest het resultaat uit een reeks metingen van dezelfde scène.
 *
 * Geeft `null` als geen enkele kandidaat de eis haalt — dan hoort de aanroeper nog
 * een ronde te doen.
 *
 * `minAgreement: 1` zet de eis uit en levert de vaakst voorkomende kandidaat. Dat
 * is de terugval na de laatste ronde: liever een wankel resultaat met "slechts in
 * één meting gelezen" erbij dan een scherm dat blijft draaien zonder iets te
 * zeggen (SPEC §F8).
 *
 * Bij een gelijke stand wint de EERSTE meting waarin de kandidaat voorkwam. Niet
 * omdat die beter is, maar omdat dezelfde invoer dan altijd dezelfde uitkomst geeft
 * en dat te testen is.
 */
export function pickOcrConsensus(
  texts: readonly string[],
  minAgreement: number = MIN_OCR_AGREEMENT,
): OcrConsensus | null {
  const readings: { text: string; keys: Set<string> }[] = [];

  for (const raw of texts) {
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text.length === 0) {
      continue;
    }
    const keys = new Set<string>();
    for (const token of extractArticleNumberTokens(text)) {
      const key = normalizeArticleNumber(token);
      if (key.length > 0) {
        keys.add(key);
      }
    }
    readings.push({ text, keys });
  }

  if (readings.length === 0) {
    return null;
  }

  /** Per sleutel: in hoeveel METINGEN hij voorkwam (niet hoe vaak in totaal). */
  const counts = new Map<string, number>();
  for (const reading of readings) {
    for (const key of reading.keys) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  let best = 0;
  for (const count of counts.values()) {
    if (count > best) {
      best = count;
    }
  }

  const required = Math.max(1, minAgreement);
  if (best < required) {
    return null;
  }

  const keys = [...counts.entries()]
    .filter(([, count]) => count === best)
    .map(([key]) => key)
    .sort();

  // De meting die de meeste van die sleutels bevat; bij gelijke stand de meting
  // met het LANGSTE bevestigde nummer, en pas daarna de eerste.
  //
  // Die middelste regel doet echt werk. Een verminkte meting kan zich net zo goed
  // herhalen als een goede: op het 10° gedraaide proefbeeld uit T20 las Tesseract
  // tweemaal `Art.nr: PIA-4T-8455` en tweemaal `Art.nr- PlA-4T.g 455`, en in dat
  // tweede geval blijft `P1A4TG` als "bevestigd" nummer over. Beide komen in twee
  // metingen voor, dus de telling alleen wijst niets uit — het langere nummer is
  // specifieker en is het nummer dat de gebruiker te zien hoort te krijgen.
  let chosen = readings[0];
  let chosenCount = -1;
  let chosenLength = -1;
  for (const reading of readings) {
    const matched = keys.filter((key) => reading.keys.has(key));
    const length = matched.reduce((total, key) => total + key.length, 0);
    if (
      matched.length > chosenCount ||
      (matched.length === chosenCount && length > chosenLength)
    ) {
      chosenCount = matched.length;
      chosenLength = length;
      chosen = reading;
    }
  }

  return { text: chosen.text, keys, agreement: best, readings: readings.length };
}

/**
 * De tekst onder het resultaat: hoe hard de METING zelf is, los van de vraag welk
 * onderdeel erbij hoort.
 *
 * Deze regel hoort bij elk OCR-resultaat op het scherm te staan. Eén meting die
 * nergens door bevestigd is, is precies het geval waarin de eigenaar "onzin" zag.
 */
export function describeOcrAgreement(
  agreement: number,
  readings: number,
): string {
  if (readings <= 1) {
    return "Eén meting, niet door een tweede bevestigd — controleer het nummer.";
  }
  if (agreement <= 1) {
    return `In ${readings} metingen gelezen, maar geen twee metingen gaven hetzelfde — controleer het nummer.`;
  }
  return `In ${agreement} van de ${readings} metingen hetzelfde gelezen.`;
}
