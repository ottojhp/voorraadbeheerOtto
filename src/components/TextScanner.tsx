"use client";

/**
 * Scanscherm voor ARTIKELNUMMERS (T20, SPEC §F4).
 *
 * Bovenop de bestaande barcodescanner (T10) uit `./BarcodeScanner`, die hier niet
 * opnieuw gebouwd maar hergebruikt wordt: die houdt de camera, de toestemming, het
 * richtkader, de Nederlandse foutmeldingen en het stoppen van de stream vast. Dit
 * component leest alleen MEE in dezelfde stream (`onVideoReady`) en laat de
 * tekstherkenning uit `@/lib/ocr-engine` op de frames los.
 *
 * ## Barcode heeft voorrang — hoe dat geregeld is
 * Een barcode is een complete, door een checksum beschermde code; OCR op een
 * bedrukte verpakking is een gok. Daarom:
 *
 *  1. de barcodedetectie van `BarcodeScanner` loopt vanaf het eerste frame, de
 *     tekstherkenning begint pas na {@link OCR_HEAD_START_MS} — een barcode die in
 *     beeld ligt is dan al gevonden;
 *  2. zodra er een barcode gelezen is, wordt die meteen doorgegeven en gaat de
 *     OCR-lus uit;
 *  3. een OCR-resultaat dat binnenkomt nadat er een barcode was, wordt weggegooid.
 *     Die situatie bestaat echt: één OCR-ronde duurt op een telefoon een seconde of
 *     langer, dus de barcode kan ertussen vallen.
 *
 * ## Wat er NIET gebeurt
 * Dit component zoekt niets op en wijzigt niets. Het geeft alleen door wat het
 * gelezen heeft, met de herkomst erbij. Het opzoeken, het tonen van kandidaten en
 * het vragen om bevestiging doet `ScanScreen` (T20 verbiedt automatisch wijzigen).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  createOcrEngine,
  drawOcrFrame,
  type OcrEngine,
  type OcrProgress,
} from "@/lib/ocr-engine";
import { MIN_OCR_AGREEMENT, pickOcrConsensus } from "@/lib/ocr-consensus";

import { BarcodeScanner } from "./BarcodeScanner";

/* -------------------------------------------------------------------------- */
/* Afstemming                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Voorsprong voor de barcodedetectie voordat de tekstherkenning begint. Lang genoeg
 * dat een barcode die gewoon in beeld ligt eerst gevonden wordt, kort genoeg dat de
 * gebruiker het niet als wachten ervaart.
 */
export const OCR_HEAD_START_MS = 1200;

/** Rust tussen twee OCR-rondes, zodat de telefoon niet volledig dichtloopt. */
const OCR_INTERVAL_MS = 700;

/**
 * Na zoveel rondes zonder overeenstemming geven we op en laten we zien wat er dán
 * het vaakst gelezen is. Niet eerder: de eerste rondes zijn vaak onscherp doordat
 * de gebruiker de telefoon nog aan het richten is, en met `rotateAuto` is pas de
 * tweede ronde op een scheef beeld bruikbaar (T20). Niet later: blijven draaien
 * zonder ooit iets te zeggen is precies de stille mislukking die SPEC §F8 verbiedt.
 */
const MAX_ATTEMPTS = 6;

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export interface TextScanResult {
  /** De gelezen tekst. Kan leeg zijn: "de camera zag niets leesbaars". */
  text: string;
  /** Waar hij vandaan komt. Bepaalt hoe streng er gematcht wordt. */
  source: "barcode" | "ocr";
  /**
   * Hoeveel van de metingen hetzelfde artikelnummer opleverden, en hoeveel
   * metingen er gedaan zijn (T25). Alleen bij `source: "ocr"`; een barcode wordt
   * niet meerdere keren gemeten, die heeft een checksum.
   */
  agreement?: number;
  readings?: number;
}

export interface TextScannerProps {
  /** Of het scanscherm open staat. Bij `false` staat de camera gegarandeerd uit. */
  open: boolean;
  /**
   * Eén resultaat. Wordt per keer dat de scanner opengaat maximaal één keer
   * aangeroepen; daarna hoort de aanroeper `open` op `false` te zetten en het
   * resultaat te tonen (bevestigen gebeurt op een rustig scherm, niet over een
   * bewegend camerabeeld heen).
   */
  onResult: (result: TextScanResult) => void;
  /** Sluitknop of Escape. */
  onClose: () => void;
  title?: string;
}

type OcrState =
  | { phase: "idle" }
  | { phase: "loading"; progress: OcrProgress }
  | { phase: "ready"; attempts: number; busy: boolean }
  | { phase: "unavailable" };

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export function TextScanner({
  open,
  onResult,
  onClose,
  title = "Artikelnummer scannen",
}: TextScannerProps) {
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [ocr, setOcr] = useState<OcrState>({ phase: "idle" });

  /**
   * Of er al een resultaat doorgegeven is. Een ref en geen state: de OCR-lus moet
   * hier middenin een `await` op kunnen controleren, en dat moet de actuele waarde
   * zijn en niet die van de render waarin de lus begon.
   */
  const reportedRef = useRef(false);
  /** Barcode gezien? Dan verliest elk OCR-resultaat dat daarna binnenkomt. */
  const barcodeSeenRef = useRef(false);
  /** Vraagt de lus om NU te lezen in plaats van op het volgende interval. */
  const readNowRef = useRef(false);

  const engineRef = useRef<OcrEngine | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Nieuwe scansessie: alles weer open.
  useEffect(() => {
    if (!open) {
      return;
    }
    reportedRef.current = false;
    barcodeSeenRef.current = false;
    readNowRef.current = false;
    setOcr({ phase: "idle" });
  }, [open]);

  const report = useCallback((result: TextScanResult) => {
    if (reportedRef.current) {
      return;
    }
    reportedRef.current = true;
    onResultRef.current(result);
  }, []);

  /** De barcode wint altijd; zie de uitleg bovenaan. */
  const handleBarcode = useCallback(
    (code: string) => {
      barcodeSeenRef.current = true;
      report({ text: code, source: "barcode" });
    },
    [report],
  );

  /* ---------------------------------------------------------------------- */
  /* De tekstherkenning: laden en de leeslus                                */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!open || video === null) {
      return;
    }

    /**
     * Zelfde race-oplossing als in `BarcodeScanner`: het laden van de engine en elke
     * leesronde zijn async, en de gebruiker kan het scherm ondertussen sluiten. Na
     * ELKE `await` wordt `cancelled` gecontroleerd.
     */
    let cancelled = false;
    let timer: number | null = null;
    /**
     * Alle metingen van deze scansessie, in leesvolgorde. Eén losse meting is te
     * wisselvallig gebleken; `pickOcrConsensus` vergelijkt ze (T25).
     */
    const readings: string[] = [];

    const canvas =
      canvasRef.current ?? (canvasRef.current = document.createElement("canvas"));

    const run = async () => {
      setOcr({ phase: "loading", progress: { label: "Tekstherkenning laden…", fraction: 0 } });

      let engine: OcrEngine;
      try {
        engine = await createOcrEngine({
          onProgress: (progress) => {
            if (!cancelled) {
              setOcr({ phase: "loading", progress });
            }
          },
        });
      } catch (error) {
        console.error("Tekstherkenning kon niet geladen worden", error);
        if (!cancelled) {
          setOcr({ phase: "unavailable" });
        }
        return;
      }

      if (cancelled) {
        // Het scherm is tussendoor gesloten: de worker meteen weer opruimen.
        void engine.terminate();
        return;
      }
      engineRef.current = engine;

      let attempts = 0;
      setOcr({ phase: "ready", attempts, busy: false });

      const tick = async () => {
        if (cancelled || reportedRef.current) {
          return;
        }

        const schedule = (delay: number) => {
          if (cancelled || reportedRef.current) {
            return;
          }
          timer = window.setTimeout(() => {
            void tick();
          }, delay);
        };

        // Nog geen beeld (de stream is net gestart): gewoon nog een rondje.
        if (!drawOcrFrame(video, canvas)) {
          schedule(OCR_INTERVAL_MS);
          return;
        }

        attempts += 1;
        readNowRef.current = false;
        setOcr({ phase: "ready", attempts, busy: true });

        let text = "";
        try {
          text = await engine.recognize(canvas);
        } catch (error) {
          // Eén mislukte ronde is geen storing: een half frame, een te donker
          // beeld. We tellen hem mee en gaan door.
          console.warn("Eén OCR-ronde mislukte", error);
        }

        if (cancelled || reportedRef.current) {
          return;
        }

        // Een barcode die tijdens deze ronde binnenkwam, heeft voorrang: dit
        // OCR-resultaat gaat de prullenbak in.
        if (barcodeSeenRef.current) {
          return;
        }

        readings.push(text.trim());

        // T25: alleen doorgeven wat in minstens twee metingen hetzelfde opleverde.
        // Eén verminkte ronde haalt het daarmee niet meer — dat was de oorzaak van
        // "soms komt er onzin uit".
        const agreed = pickOcrConsensus(readings);
        if (agreed !== null) {
          report({
            text: agreed.text,
            source: "ocr",
            agreement: agreed.agreement,
            readings: agreed.readings,
          });
          return;
        }

        if (attempts >= MAX_ATTEMPTS) {
          // Opgeven, maar niet zwijgen: de vaakst voorkomende kandidaat, of anders
          // de langste gelezen tekst, zodat de gebruiker het kan verbeteren (T20
          // criterium 7). Het aantal metingen gaat mee, zodat het scherm kan
          // zeggen dat dit resultaat door niets bevestigd is.
          const fallback = pickOcrConsensus(readings, 1);
          const nonEmpty = readings.filter((item) => item.length > 0);
          const longest = nonEmpty.reduce(
            (best, item) => (item.length > best.length ? item : best),
            "",
          );
          report({
            text: fallback?.text ?? longest,
            source: "ocr",
            agreement: fallback?.agreement ?? 0,
            readings: nonEmpty.length,
          });
          return;
        }

        setOcr({ phase: "ready", attempts, busy: false });
        schedule(readNowRef.current ? 0 : OCR_INTERVAL_MS);
      };

      // De barcodedetectie krijgt een voorsprong; zie de uitleg bovenaan.
      timer = window.setTimeout(() => {
        void tick();
      }, OCR_HEAD_START_MS);
    };

    void run();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      const engine = engineRef.current;
      engineRef.current = null;
      if (engine) {
        void engine.terminate();
      }
    };
  }, [open, video, report]);

  // Buiten het scanscherm houden we geen videoelement vast.
  useEffect(() => {
    if (!open) {
      setVideo(null);
    }
  }, [open]);

  /* ---------------------------------------------------------------------- */
  /* Weergave                                                               */
  /* ---------------------------------------------------------------------- */

  const hint = describeOcrState(ocr, video !== null);

  const canReadNow = ocr.phase === "ready" && !ocr.busy;

  return (
    <BarcodeScanner
      open={open}
      title={title}
      hint={hint}
      onScan={handleBarcode}
      onClose={onClose}
      onVideoReady={setVideo}
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              readNowRef.current = true;
            }}
            disabled={!canReadNow}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md border border-white/70 bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Nu lezen
          </button>
          <span className="text-xs text-white/70">
            Houd de telefoon stil boven het artikelnummer.
          </span>
        </>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Hulpstukken                                                                 */
/* -------------------------------------------------------------------------- */

/** De tekst onder het richtkader: altijd Nederlands, altijd eerlijk over de stap. */
function describeOcrState(state: OcrState, hasVideo: boolean): string {
  if (!hasVideo) {
    return "Camera starten…";
  }
  switch (state.phase) {
    case "idle":
      return "Tekstherkenning voorbereiden…";
    case "loading": {
      const { label, fraction } = state.progress;
      if (fraction === null || fraction <= 0 || fraction >= 1) {
        return label;
      }
      return `${label} ${Math.round(fraction * 100)}%`;
    }
    case "ready":
      if (state.busy) {
        return `Tekst lezen… (meting ${state.attempts} van ${MAX_ATTEMPTS})`;
      }
      if (state.attempts === 0) {
        return "Richt op het artikelnummer of de barcode";
      }
      // Waarom het nog doorgaat terwijl er al iets gelezen is: er zijn minstens
      // twee metingen nodig die hetzelfde zeggen (T25).
      return `Houd stil — ${MIN_OCR_AGREEMENT} metingen moeten hetzelfde lezen (${state.attempts} van ${MAX_ATTEMPTS} gedaan)`;
    case "unavailable":
      return "Tekstherkenning is niet beschikbaar. De barcodescanner werkt nog wel.";
  }
}
