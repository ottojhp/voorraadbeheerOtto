import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, clearedSessionCookieOptions } from "@/lib/auth";

/**
 * POST /api/auth/logout — wist het sessiecookie en stuurt terug naar `/login`
 * (SPEC §F7).
 *
 * Alleen POST: uitloggen via een GET-link zou met een `<img>`-tag door een andere site
 * getriggerd kunnen worden.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);

  // Overschrijven met een lege waarde én maxAge 0, met dezelfde attributen als bij het
  // zetten — anders wist de browser het cookie niet.
  response.cookies.set(SESSION_COOKIE_NAME, "", clearedSessionCookieOptions());

  return response;
}
