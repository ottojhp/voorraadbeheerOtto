import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, verifySessionValue } from "@/lib/auth";

/**
 * Middleware die de hele site achter het gedeelde wachtwoord zet (SPEC §F7).
 *
 * Draait op de Edge runtime: `@/lib/auth` gebruikt daarom uitsluitend de Web Crypto
 * API en geen `node:crypto`. Importeer hier niets dat Node-only is (geen Prisma, geen
 * `node:*` modules).
 */

/** Paden die zonder sessie bereikbaar moeten blijven. */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Next.js' eigen assets en de bekende statische bestanden in de root.
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  const isValid = await verifySessionValue(cookie?.value);

  if (isValid) {
    return NextResponse.next();
  }

  // Geen geldige sessie: naar /login, met de oorspronkelijke URL als `next` zodat de
  // gebruiker na het inloggen terugkeert waar hij was.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);

  const response = NextResponse.redirect(loginUrl);
  if (cookie !== undefined) {
    // Een geknoeid of verlopen cookie meteen opruimen.
    response.cookies.delete(SESSION_COOKIE_NAME);
  }
  return response;
}

/**
 * De matcher houdt statische assets buiten de middleware: alles onder `_next/static`
 * en `_next/image`, `favicon.ico` en de gebruikelijke bestandsextensies van publieke
 * assets. De overige uitzonderingen (`/login`, de auth-endpoints) staan hierboven in
 * `isPublicPath`, omdat ze wél door de middleware heen gaan maar geen sessie eisen.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|bmp|css|js|mjs|map|json|txt|xml|woff|woff2|ttf|otf|eot|mp4|webm)$).*)",
  ],
};
