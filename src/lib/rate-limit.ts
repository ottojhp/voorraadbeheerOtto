/**
 * In-memory rate limiting voor de loginpogingen (SPEC §F7).
 *
 * Maximaal 10 **mislukte** pogingen per IP per 15 minuten. Een geslaagde login zet de
 * teller voor dat IP terug op nul.
 *
 * LET OP — bewuste beperking voor v1: deze teller staat in het geheugen van één
 * serverinstantie. Op een serverless of meervoudig geschaalde omgeving (Vercel) heeft
 * elke instantie een eigen teller en kan een aanvaller door spreiding over instanties
 * meer pogingen doen; bovendien verdwijnt de stand bij een koude start. Dat is voor v1
 * bewust geaccepteerd (SPEC §F7: "in-memory volstaat voor v1"). Wil je het waterdicht
 * maken, dan is een gedeelde store (Redis/Upstash) of de rate limiting van de
 * hostingprovider nodig.
 */

/** Tijdvenster waarin mislukte pogingen worden geteld: 15 minuten. */
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Maximum aantal mislukte pogingen binnen het venster. */
export const RATE_LIMIT_MAX_ATTEMPTS = 10;

/**
 * Bovengrens op het aantal bijgehouden IP's. Voorkomt dat een aanvaller met veel
 * gespoofte `x-forwarded-for`-waarden het geheugen laat vollopen. Bij overschrijding
 * ruimen we eerst op en gooien we daarna de oudste entries weg.
 */
const MAX_TRACKED_IPS = 10_000;

/** Hoe vaak we hoogstens een volledige opruimronde doen. */
const CLEANUP_INTERVAL_MS = 60 * 1000;

type Entry = {
  /** Aantal mislukte pogingen binnen het huidige venster. */
  failures: number;
  /** Tijdstip waarop het huidige venster afloopt. */
  windowEndsAt: number;
};

const attempts = new Map<string, Entry>();
let lastCleanupAt = 0;

/**
 * Verwijdert verlopen entries. Wordt hoogstens één keer per minuut echt uitgevoerd,
 * zodat de kosten verwaarloosbaar blijven bij veel verkeer.
 */
function cleanup(now: number, force = false): void {
  if (!force && now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  for (const [ip, entry] of attempts) {
    if (entry.windowEndsAt <= now) {
      attempts.delete(ip);
    }
  }
}

/** Haalt de entry op als het venster nog loopt; ruimt verlopen entries meteen op. */
function getLiveEntry(ip: string, now: number): Entry | undefined {
  const entry = attempts.get(ip);
  if (entry === undefined) return undefined;
  if (entry.windowEndsAt <= now) {
    attempts.delete(ip);
    return undefined;
  }
  return entry;
}

export type RateLimitStatus = {
  /** Is dit IP op dit moment geblokkeerd? */
  limited: boolean;
  /** Hoeveel mislukte pogingen er nog over zijn voordat de blokkade ingaat. */
  remaining: number;
  /** Aantal seconden tot het venster afloopt (0 als er geen venster loopt). */
  retryAfterSeconds: number;
};

/**
 * Geeft de huidige stand voor een IP, zonder de teller te wijzigen. Roep dit aan
 * vóórdat het wachtwoord gecontroleerd wordt.
 */
export function checkRateLimit(ip: string, now: number = Date.now()): RateLimitStatus {
  cleanup(now);
  const entry = getLiveEntry(ip, now);
  if (entry === undefined) {
    return {
      limited: false,
      remaining: RATE_LIMIT_MAX_ATTEMPTS,
      retryAfterSeconds: 0,
    };
  }
  const remaining = Math.max(0, RATE_LIMIT_MAX_ATTEMPTS - entry.failures);
  return {
    limited: entry.failures >= RATE_LIMIT_MAX_ATTEMPTS,
    remaining,
    retryAfterSeconds: Math.max(0, Math.ceil((entry.windowEndsAt - now) / 1000)),
  };
}

/**
 * Registreert één mislukte poging en geeft de nieuwe stand terug. Alleen mislukte
 * pogingen tellen mee; een geslaagde login hoort `resetRateLimit` aan te roepen.
 */
export function registerFailedAttempt(
  ip: string,
  now: number = Date.now(),
): RateLimitStatus {
  cleanup(now);

  const existing = getLiveEntry(ip, now);
  const entry: Entry = existing ?? {
    failures: 0,
    // Het venster start bij de eerste mislukte poging en schuift daarna niet op.
    windowEndsAt: now + RATE_LIMIT_WINDOW_MS,
  };
  entry.failures += 1;
  attempts.set(ip, entry);

  if (attempts.size > MAX_TRACKED_IPS) {
    cleanup(now, true);
    // Nog steeds te groot: gooi de oudste entries weg (Map bewaart invoegvolgorde).
    while (attempts.size > MAX_TRACKED_IPS) {
      const oldest = attempts.keys().next();
      if (oldest.done) break;
      attempts.delete(oldest.value);
    }
  }

  return checkRateLimit(ip, now);
}

/** Zet de teller voor dit IP terug op nul. Aanroepen na een geslaagde login. */
export function resetRateLimit(ip: string): void {
  attempts.delete(ip);
}

/** Wist alle tellers. Alleen bedoeld voor tests. */
export function resetAllRateLimits(): void {
  attempts.clear();
  lastCleanupAt = 0;
}

/**
 * Bepaalt het IP van een inkomend verzoek. Achter een proxy (Vercel) staat het echte
 * IP vooraan in `x-forwarded-for`. Ontbreekt alles, dan vallen we terug op één
 * gedeelde sleutel: liever te streng dan helemaal geen limiet.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);
  return "onbekend";
}
