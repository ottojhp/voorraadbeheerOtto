"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
// Alleen types: deze imports verdwijnen bij het compileren, dus @zxing belandt
// NIET in de initiële bundle. De code zelf wordt pas geladen met een dynamische
// import op het moment dat de fallback echt nodig is (zie `startZxing`).
import type { IScannerControls } from "@zxing/browser";
import type { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Button } from "./Button";
import {
  CAMERA_ERROR_MESSAGES,
  DEFAULT_BARCODE_FORMATS,
  classifyCameraError,
  createScanGate,
  pickDetectorFormats,
  toDetectorFormats,
  toZxingFormatNames,
  type BarcodeFormatName,
  type CameraErrorCode,
} from "@/lib/barcode";

/* -------------------------------------------------------------------------- */
/* Minimale typedeclaratie voor de BarcodeDetector-API                         */
/* -------------------------------------------------------------------------- */
/**
 * TypeScript kent `BarcodeDetector` (nog) niet in zijn DOM-types. Hieronder
 * staat precies het stukje API dat dit component gebruikt — geen `any`, geen
 * `@ts-ignore`. Bewust géén `declare global`, zodat andere bestanden die
 * hetzelfde nodig hebben niet botsen met deze declaratie.
 */
interface DetectedBarcodeLike {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcodeLike[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

type WindowWithBarcodeDetector = Window &
  typeof globalThis & {
    BarcodeDetector?: BarcodeDetectorConstructor;
  };

/** Hoe vaak het BarcodeDetector-pad een frame bekijkt (ms). */
const DETECT_INTERVAL_MS = 200;

/**
 * Zoveel detectiefouten achter elkaar en we geven het snelle pad op en gaan
 * alsnog via @zxing verder — anders zou een detector die wel bestaat maar niets
 * kan, stil blijven falen.
 */
const MAX_DETECTOR_FAILURES = 5;

/* -------------------------------------------------------------------------- */
/* Component                                                                   */
/* -------------------------------------------------------------------------- */

export interface BarcodeScannerProps {
  /**
   * Of de scanner zichtbaar is. Bij `false` rendert het component niets en
   * staat de camera gegarandeerd uit; het aanroepende scherm houdt deze vlag
   * vast (bv. een "Scan barcode"-knop die hem op `true` zet).
   */
  open: boolean;
  /**
   * Wordt aangeroepen met de opgeschoonde, ontdubbelde code bij een geslaagde
   * scan. Dezelfde code wordt binnen ~2 seconden niet nog eens gemeld.
   * De scanner blijft openstaan: sluiten doet het aanroepende scherm door
   * `open` op `false` te zetten (dat is meteen het stopsignaal voor de camera).
   */
  onScan: (code: string) => void;
  /** Aangeroepen bij de sluitknop of Escape. */
  onClose?: () => void;
  /** Te herkennen formaten. Standaard EAN-13, EAN-8, Code-128 en QR. */
  formats?: readonly BarcodeFormatName[];
  /** Titel in de kop van het scannerscherm. */
  title?: string;
  /**
   * De tekst onder het richtkader, als de standaardtekst niet past. Toegevoegd voor
   * T20: het scanscherm voor artikelnummers moet daar zijn eigen voortgang kunnen
   * melden ("Tekstherkenning laden…", "Tekst lezen…"), want die stap duurt de
   * eerste keer merkbaar lang. Bij `undefined` blijft de oorspronkelijke tekst
   * staan. Alleen zichtbaar zolang er geen camerafout is.
   */
  hint?: ReactNode;
  /**
   * Extra bedieningselementen onder de statustekst, binnen duimbereik. Ook voor
   * T20: het scanscherm zet daar een "Lees nu"-knop, zodat de gebruiker zelf het
   * moment kiest waarop hij de telefoon stilhoudt. Buiten de `aria-live`-regio van
   * de statustekst, anders leest een schermlezer de knop bij elke statuswijziging
   * opnieuw voor.
   */
  footer?: ReactNode;
  /**
   * Wordt aangeroepen met het `<video>`-element zodra het beeld loopt, en met
   * `null` zodra de camera stopt.
   *
   * Toegevoegd voor T20, zodat de tekstherkenning frames uit DEZELFDE stream kan
   * halen als de barcodedetectie. Een tweede `getUserMedia` zou een tweede stream
   * openen — op een telefoon lukt dat vaak niet, en als het lukt kost het dubbel
   * zoveel batterij. Het element blijft eigendom van dit component: de aanroeper
   * mag eruit lezen, maar nooit de stream stoppen of `srcObject` aanpassen.
   */
  onVideoReady?: (video: HTMLVideoElement | null) => void;
}

type ScannerStatus = "starting" | "scanning" | "error";

/**
 * Camerascanner voor de balie (SPEC §F4). Gebruikt `BarcodeDetector` waar de
 * browser die heeft (snel pad, Android/Chrome) en valt anders terug op
 * `@zxing/browser` (o.a. Safari op iOS). Alle meldingen zijn Nederlands en
 * wijzen bij problemen naar handmatig invoeren.
 *
 * Sinds T20 kan een aanroeper meelezen in dezelfde camerastream (`onVideoReady`) en
 * de tekst onder het richtkader overschrijven (`hint`). Dat is bewust additief: het
 * barcodepad zelf is niet veranderd, en wie die twee props niet meegeeft, krijgt
 * exact het gedrag van T10. Zie `@/components/TextScanner` voor het gebruik.
 *
 * Gebruik:
 * ```tsx
 * const [open, setOpen] = useState(false);
 * <BarcodeScanner
 *   open={open}
 *   onScan={(code) => { setBarcode(code); setOpen(false); }}
 *   onClose={() => setOpen(false)}
 * />
 * ```
 */
export function BarcodeScanner({
  open,
  onScan,
  onClose,
  formats = DEFAULT_BARCODE_FORMATS,
  title = "Barcode scannen",
  hint,
  footer,
  onVideoReady,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // `onScan` mag van aanroep tot aanroep een nieuwe functie zijn zonder dat de
  // camera daardoor herstart; daarom via een ref in plaats van via de deps.
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Zelfde reden als bij `onScanRef`: deze callback mag de camera niet herstarten.
  const onVideoReadyRef = useRef(onVideoReady);
  useEffect(() => {
    onVideoReadyRef.current = onVideoReady;
  }, [onVideoReady]);

  const [status, setStatus] = useState<ScannerStatus>("starting");
  const [errorCode, setErrorCode] = useState<CameraErrorCode | null>(null);
  /** Ophogen herstart het effect, en daarmee de camera ("Opnieuw proberen"). */
  const [attempt, setAttempt] = useState(0);

  // Een stabiele sleutel van de formaten: zo herstart de camera niet bij elke
  // render alleen omdat de aanroeper een nieuwe array-literal doorgeeft.
  const formatKey = [...formats].join(",");

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const wanted = formatKey.split(",") as BarcodeFormatName[];
    const gate = createScanGate();

    /**
     * Race-oplossing (belangrijk aan de balie): `getUserMedia` en de dynamische
     * import zijn async. De gebruiker kan het scherm al verlaten hebben voordat
     * de toestemming binnen is. `cancelled` wordt door de cleanup op `true`
     * gezet; na ELKE `await` controleren we hem. Komt de stream daarna alsnog
     * binnen, dan wordt hij meteen weer gestopt in plaats van bewaard — anders
     * blijft het cameralampje branden op een scherm dat niet meer bestaat.
     */
    let cancelled = false;
    let stream: MediaStream | null = null;
    let zxingControls: IScannerControls | null = null;
    let detectorTimer: number | null = null;

    const stopEverything = () => {
      if (detectorTimer !== null) {
        window.clearTimeout(detectorTimer);
        detectorTimer = null;
      }
      if (zxingControls) {
        try {
          zxingControls.stop();
        } catch {
          // De reader was al gestopt; niets aan de hand.
        }
        zxingControls = null;
      }
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        stream = null;
      }
      // Losknippen van het videoelement, anders houdt Safari de stream vast.
      if (video.srcObject) {
        video.srcObject = null;
      }
      // Meteen melden dat er geen beeld meer is, zodat een meelezende
      // tekstherkenning (T20) stopt met frames pakken uit een dode stream.
      onVideoReadyRef.current?.(null);
    };

    const fail = (code: CameraErrorCode) => {
      setErrorCode(code);
      setStatus("error");
    };

    const handleCandidate = (raw: string) => {
      if (cancelled) {
        return;
      }
      // Ontdubbeling: de camera ziet dezelfde code tientallen keren per
      // seconde, `onScan` hoort er één keer op af te gaan.
      const code = gate.accept(raw);
      if (code !== null) {
        onScanRef.current(code);
      }
    };

    /** Snel pad: de ingebouwde BarcodeDetector. Geeft `false` als die er niet is. */
    const startDetector = async (): Promise<boolean> => {
      const detectorWindow = window as WindowWithBarcodeDetector;
      const Detector = detectorWindow.BarcodeDetector;
      if (!Detector) {
        return false;
      }

      let usable = wanted;
      if (typeof Detector.getSupportedFormats === "function") {
        try {
          const supported = await Detector.getSupportedFormats();
          if (cancelled) {
            return true; // cleanup ruimt op; niet ook nog zxing starten
          }
          usable = pickDetectorFormats(wanted, supported);
        } catch {
          // Geen lijst beschikbaar: gewoon de gevraagde formaten proberen.
        }
      }
      if (usable.length === 0) {
        // Deze browser kent BarcodeDetector maar geen van onze formaten.
        return false;
      }

      let detector: BarcodeDetectorLike;
      try {
        detector = new Detector({ formats: toDetectorFormats(usable) });
      } catch {
        return false;
      }

      let failures = 0;
      const tick = async () => {
        if (cancelled) {
          return;
        }
        try {
          const found = await detector.detect(video);
          if (cancelled) {
            return;
          }
          failures = 0;
          const hit = found.find((item) => item.rawValue.length > 0);
          if (hit) {
            handleCandidate(hit.rawValue);
          }
        } catch {
          // Losse fout (frame nog niet klaar, of een detector die het toch niet
          // aankan). Pas na een reeks fouten stappen we over op @zxing.
          failures += 1;
          if (cancelled) {
            return;
          }
          if (failures >= MAX_DETECTOR_FAILURES) {
            void startZxing();
            return;
          }
        }
        detectorTimer = window.setTimeout(() => {
          void tick();
        }, DETECT_INTERVAL_MS);
      };

      void tick();
      return true;
    };

    /** Fallback: @zxing/browser, o.a. voor Safari op iOS. */
    const startZxing = async (): Promise<void> => {
      // Dynamische import: de bibliotheek wordt pas opgehaald als ze nodig is.
      const [{ BrowserMultiFormatReader }, zxing] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      if (cancelled) {
        return;
      }

      const zxingFormats: BarcodeFormat[] = toZxingFormatNames(wanted).map(
        (name) => zxing.BarcodeFormat[name],
      );
      const hints = new Map<DecodeHintType, BarcodeFormat[]>([
        [zxing.DecodeHintType.POSSIBLE_FORMATS, zxingFormats],
      ]);

      const reader = new BrowserMultiFormatReader(hints);
      // `decodeFromVideoElement` laat de stream met rust: wij blijven eigenaar
      // en kunnen hem in `stopEverything` deterministisch afbreken.
      const controls = await reader.decodeFromVideoElement(
        video,
        (result, _error, activeControls) => {
          if (cancelled) {
            activeControls.stop();
            return;
          }
          if (result) {
            handleCandidate(result.getText());
          }
        },
      );
      if (cancelled) {
        controls.stop();
        return;
      }
      zxingControls = controls;
    };

    const start = async () => {
      setStatus("starting");
      setErrorCode(null);

      // Zonder https geeft de browser geen camera vrij; dat eerst zelf melden
      // in plaats van de gebruiker een vage fout laten zien.
      if (window.isSecureContext === false) {
        fail("insecure-context");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        fail("not-supported");
        return;
      }

      try {
        const media = await navigator.mediaDevices.getUserMedia({
          // Achtercamera heeft de voorkeur op telefoons; `ideal` (niet `exact`)
          // zodat een laptop met alleen een frontcamera gewoon blijft werken.
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });

        if (cancelled) {
          // De toestemming kwam binnen nadat het scherm al gesloten was:
          // meteen weer stoppen, niets bewaren.
          for (const track of media.getTracks()) {
            track.stop();
          }
          return;
        }
        stream = media;

        video.srcObject = media;
        try {
          await video.play();
        } catch {
          // Autoplay kan geweigerd worden; het beeld start dan alsnog zodra de
          // gebruiker het scherm aanraakt. Geen reden om af te breken.
        }
        if (cancelled) {
          stopEverything();
          return;
        }

        const detectorStarted = await startDetector();
        if (cancelled) {
          stopEverything();
          return;
        }
        if (!detectorStarted) {
          await startZxing();
          if (cancelled) {
            stopEverything();
            return;
          }
        }
        setStatus("scanning");
        // Het beeld loopt: een meelezende tekstherkenning (T20) mag nu frames uit
        // deze stream halen. Het element blijft van dit component.
        onVideoReadyRef.current?.(video);
      } catch (error) {
        if (cancelled) {
          stopEverything();
          return;
        }
        stopEverything();
        fail(classifyCameraError(error));
      }
    };

    void start();

    return () => {
      cancelled = true;
      stopEverything();
    };
  }, [open, formatKey, attempt]);

  // Escape sluit de scanner, net als de sluitknop.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Scanner sluiten"
          className="inline-flex h-11 min-h-[44px] w-11 min-w-[44px] items-center justify-center rounded-md text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
            aria-hidden="true"
          >
            <path d="M6 6l12 12" />
            <path d="M18 6 6 18" />
          </svg>
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`h-full w-full object-cover ${
            status === "error" ? "invisible" : ""
          }`}
        />

        {status !== "error" && (
          // Richtkader: een uitsnede midden in beeld, puur decoratief.
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="h-40 w-11/12 max-w-sm rounded-lg border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}

        {status === "error" && errorCode && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              role="alert"
              className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-6 py-8 text-center"
            >
              <p className="text-base font-semibold text-red-800">
                Scannen lukt niet
              </p>
              <p className="text-sm text-red-700">
                {CAMERA_ERROR_MESSAGES[errorCode]}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Opnieuw proberen
                </Button>
                <Button variant="secondary" onClick={handleClose}>
                  Sluiten
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pb-6 pt-3 text-center">
        <p aria-live="polite" className="min-h-[24px] text-sm text-white">
          {status === "error"
            ? "Camera niet beschikbaar"
            : (hint ??
              (status === "starting"
                ? "Camera starten…"
                : "Richt op de streepjescode"))}
        </p>
        {status !== "error" && footer !== undefined && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
