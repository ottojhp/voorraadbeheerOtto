import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  SESSION_COOKIE_NAME,
  createSessionValue,
  safeNextPath,
  sessionCookieOptions,
  verifyAppPassword,
} from "@/lib/auth";
import {
  checkRateLimit,
  clientIpFromHeaders,
  registerFailedAttempt,
  resetRateLimit,
} from "@/lib/rate-limit";

/**
 * POST /api/auth/login — controleert het gedeelde wachtwoord (SPEC §F7).
 *
 * Volgorde: rate limit → wachtwoord constant-time vergelijken → cookie zetten →
 * redirect naar de gevalideerde `next`. Het wachtwoord wordt nooit gelogd, ook niet
 * bij een fout.
 */

/** Server-side validatie via Zod (SPEC §3 regel 7). */
const loginSchema = z.object({
  password: z.string().min(1).max(512),
  next: z.string().max(2048).optional(),
});

/**
 * Terug naar de loginpagina met een generieke foutcode. De `next` blijft behouden
 * zodat de gebruiker na een geslaagde poging alsnog op de juiste pagina uitkomt.
 */
function redirectToLogin(
  request: NextRequest,
  code: "onjuist" | "limiet" | "config",
  next: string,
): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", code);
  if (next !== "/") {
    url.searchParams.set("next", next);
  }
  // 303: de browser volgt de redirect met GET in plaats van de POST te herhalen.
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let next = "/";

  try {
    const formData = await request.formData();
    const parsed = loginSchema.safeParse({
      password: formData.get("password"),
      next: formData.get("next") ?? undefined,
    });

    next = safeNextPath(parsed.success ? parsed.data.next : undefined);

    const ip = clientIpFromHeaders(request.headers);

    // 1. Rate limit vóór elke wachtwoordcontrole.
    if (checkRateLimit(ip).limited) {
      return redirectToLogin(request, "limiet", next);
    }

    // 2. Een ongeldig formulier (leeg veld, geen string) telt als mislukte poging en
    //    krijgt exact dezelfde melding als een fout wachtwoord.
    if (!parsed.success) {
      const status = registerFailedAttempt(ip);
      return redirectToLogin(request, status.limited ? "limiet" : "onjuist", next);
    }

    // 3. Constant-time wachtwoordvergelijking.
    const ok = await verifyAppPassword(parsed.data.password);

    if (!ok) {
      const status = registerFailedAttempt(ip);
      return redirectToLogin(request, status.limited ? "limiet" : "onjuist", next);
    }

    // 4. Geslaagd: teller terug op nul en een ondertekend sessiecookie zetten.
    resetRateLimit(ip);

    const response = NextResponse.redirect(new URL(next, request.url), 303);
    response.cookies.set(
      SESSION_COOKIE_NAME,
      await createSessionValue(),
      sessionCookieOptions(),
    );
    return response;
  } catch (error) {
    // Alleen de foutmelding loggen; die bevat nooit het wachtwoord of het secret.
    console.error(
      "[auth] Inloggen mislukt door een serverfout:",
      error instanceof Error ? error.message : "onbekende fout",
    );
    return redirectToLogin(request, "config", next);
  }
}
