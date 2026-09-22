/**
 * Sessiebeveiliging voor de hele site (SPEC §F7).
 *
 * Eén gedeeld wachtwoord uit `APP_PASSWORD`, en een sessiecookie waarvan de waarde
 * HMAC-SHA-256 ondertekend is met `SESSION_SECRET`.
 *
 * BELANGRIJK — Edge-compatibiliteit: dit bestand wordt geïmporteerd door
 * `src/middleware.ts`, dat in Next.js op de **Edge runtime** draait. Daar bestaat
 * `node:crypto` niet. Alle cryptografie gebruikt daarom uitsluitend de Web Crypto API
 * (`crypto.subtle`), die zowel op de Edge runtime, in Node 18+ route handlers als in
 * Vitest beschikbaar is als global. Importeer hier nooit `node:crypto`, `Buffer` of
 * een andere Node-only API.
 *
 * Omdat `crypto.subtle` asynchroon is, zijn onderteken- en verifieerfuncties `async`.
 */

const encoder = new TextEncoder();

/** Naam van het sessiecookie. */
export const SESSION_COOKIE_NAME = "vb_session";

/** Geldigheidsduur van de sessie: 30 dagen (SPEC §F7). */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Versietag in de cookie-payload, zodat het formaat later kan wijzigen. */
const PAYLOAD_VERSION = "v1";

/**
 * Bovengrens op de lengte van een cookiewaarde die we überhaupt bekijken. Voorkomt dat
 * een absurd lange waarde onnodig werk kost bij het verifiëren.
 */
const MAX_COOKIE_VALUE_LENGTH = 512;

/* -------------------------------------------------------------------------- */
/* Omgevingsvariabelen                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Leest een verplichte omgevingsvariabele. Ontbreekt of is hij leeg, dan falen we
 * luid en duidelijk. De waarde zelf komt nooit in de foutmelding terecht.
 */
function requireEnv(name: "APP_PASSWORD" | "SESSION_SECRET"): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Configuratiefout: omgevingsvariabele ${name} ontbreekt of is leeg. ` +
        `Zie docs/SPEC.md §6 en .env.example. De applicatie kan geen sessies ` +
        `verwerken zonder deze waarde.`,
    );
  }
  return value;
}

/* -------------------------------------------------------------------------- */
/* Constant-time vergelijking                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Vergelijkt twee byte-reeksen in constante tijd: de lus breekt nooit vroegtijdig af
 * en verzamelt alle verschillen in één accumulator. Geen `===` op strings en geen
 * `node:crypto.timingSafeEqual` (bestaat niet op de Edge runtime).
 *
 * Een verschil in lengte wordt in dezelfde accumulator meegenomen. De lengte zelf is
 * niet geheim bij de manier waarop we deze functie gebruiken: handtekeningen hebben
 * altijd 32 bytes, en wachtwoorden vergelijken we als HMAC-digest (zie
 * `verifyAppPassword`), dus ook daar zijn beide kanten even lang.
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    const left = i < a.length ? a[i] : 0;
    const right = i < b.length ? b[i] : 0;
    diff |= left ^ right;
  }
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* base64url zonder Buffer                                                     */
/* -------------------------------------------------------------------------- */

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodeert base64url. Geeft `null` terug bij onzin-invoer, gooit nooit. */
function base64UrlDecode(value: string): Uint8Array | null {
  if (!BASE64URL_PATTERN.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  try {
    const binary = atob(withPadding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function bytesToUtf8(bytes: Uint8Array): string | null {
  try {
    // `fatal: true` zorgt dat niet-UTF-8 bytes een fout geven in plaats van U+FFFD.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* HMAC-sleutels                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Cache van geïmporteerde HMAC-sleutels per secret, zodat niet elk verzoek opnieuw
 * `importKey` hoeft te doen. De cache leeft alleen in het geheugen van deze
 * serverinstantie.
 */
const keyCache = new Map<string, Promise<CryptoKey>>();

function getSigningKey(secret: string): Promise<CryptoKey> {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const key = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  keyCache.set(secret, key);
  return key;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(signature);
}

/* -------------------------------------------------------------------------- */
/* Sessiewaarde aanmaken en verifiëren                                         */
/* -------------------------------------------------------------------------- */

/**
 * Maakt een ondertekende sessiewaarde: `<base64url(payload)>.<base64url(handtekening)>`.
 * De payload is `v1:<vervaltijdstip in ms>`. De handtekening wordt gezet over de
 * base64url-payload, zodat er maar één canonieke representatie is om te ondertekenen.
 */
export async function createSessionValue(now: number = Date.now()): Promise<string> {
  const secret = requireEnv("SESSION_SECRET");
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = base64UrlEncode(encoder.encode(`${PAYLOAD_VERSION}:${expiresAt}`));
  const signature = base64UrlEncode(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

/**
 * Verifieert een sessiewaarde. Geeft `false` terug bij een geknoeide handtekening, een
 * verlopen tijdstip, een andere sleutel of onzin-invoer — zonder ooit een exception te
 * gooien. De enige uitzondering is een ontbrekende `SESSION_SECRET`: dat is een
 * configuratiefout en moet luid falen.
 */
export async function verifySessionValue(
  value: unknown,
  now: number = Date.now(),
): Promise<boolean> {
  const secret = requireEnv("SESSION_SECRET");

  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_COOKIE_VALUE_LENGTH) return false;

  const parts = value.split(".");
  if (parts.length !== 2) return false;

  const [payload, providedSignature] = parts;
  if (payload.length === 0 || providedSignature.length === 0) return false;

  const providedBytes = base64UrlDecode(providedSignature);
  if (providedBytes === null) return false;

  const expectedBytes = await hmac(secret, payload);
  if (!timingSafeEqualBytes(providedBytes, expectedBytes)) return false;

  // Pas ná een geldige handtekening kijken we naar de inhoud van de payload.
  const payloadBytes = base64UrlDecode(payload);
  if (payloadBytes === null) return false;
  const payloadText = bytesToUtf8(payloadBytes);
  if (payloadText === null) return false;

  const match = /^v1:(\d{1,15})$/.exec(payloadText);
  if (match === null) return false;

  const expiresAt = Number(match[1]);
  if (!Number.isFinite(expiresAt)) return false;

  return now < expiresAt;
}

/* -------------------------------------------------------------------------- */
/* Wachtwoordcontrole                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Sleutel die alleen in dit proces bestaat en alleen gebruikt wordt om invoer en
 * verwacht wachtwoord te "afvlakken" tot twee digests van gelijke lengte. Zo lekt de
 * vergelijking ook de *lengte* van het wachtwoord niet.
 */
let comparisonKey: Promise<CryptoKey> | null = null;

function getComparisonKey(): Promise<CryptoKey> {
  if (comparisonKey === null) {
    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    comparisonKey = crypto.subtle.importKey(
      "raw",
      raw,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }
  return comparisonKey;
}

/**
 * Controleert de ingevoerde waarde tegen `APP_PASSWORD` in constante tijd.
 *
 * Beide kanten worden eerst gehasht met een procesgebonden willekeurige sleutel; de
 * resulterende digests zijn altijd 32 bytes, zodat de byte-voor-byte vergelijking geen
 * informatie over de lengte of de inhoud van het wachtwoord lekt.
 *
 * Het wachtwoord wordt nooit gelogd of teruggegeven.
 */
export async function verifyAppPassword(input: unknown): Promise<boolean> {
  const expected = requireEnv("APP_PASSWORD");
  if (typeof input !== "string") return false;

  const key = await getComparisonKey();
  const [given, wanted] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(input)),
    crypto.subtle.sign("HMAC", key, encoder.encode(expected)),
  ]);

  return timingSafeEqualBytes(new Uint8Array(given), new Uint8Array(wanted));
}

/* -------------------------------------------------------------------------- */
/* Cookie-opties                                                               */
/* -------------------------------------------------------------------------- */

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

/**
 * Attributen van het sessiecookie (SPEC §F7): `httpOnly`, `sameSite=lax`, `secure` in
 * productie (lokaal draait de dev-server op http, daar zou `secure` het cookie
 * onbruikbaar maken) en `path=/` omdat de cookie voor de hele site geldt.
 */
export function sessionCookieOptions(
  maxAge: number = SESSION_MAX_AGE_SECONDS,
): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/** Opties om het sessiecookie te wissen: zelfde attributen, levensduur 0. */
export function clearedSessionCookieOptions(): SessionCookieOptions {
  return sessionCookieOptions(0);
}

/* -------------------------------------------------------------------------- */
/* Open-redirect bescherming                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Is dit een veilig intern pad om na het inloggen naar terug te keren?
 *
 * Alleen een pad dat begint met precies één `/` is toegestaan. `//evil.example` en
 * `/\evil.example` worden door browsers als protocol-relatieve URL naar een ander
 * domein gelezen en zijn dus een open redirect. Een absolute URL (`https://...`) of een
 * pad met control-tekens wijzen we eveneens af.
 */
export function isSafeNextPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 2048) return false;
  if (value[0] !== "/") return false;
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  if (value.includes("\\")) return false;
  if (/[ -]/.test(value)) return false;
  return true;
}

/** Geeft het pad terug als het veilig is, anders `/`. */
export function safeNextPath(value: unknown): string {
  return isSafeNextPath(value) ? value : "/";
}
