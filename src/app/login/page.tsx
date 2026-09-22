import type { Metadata } from "next";

import { safeNextPath } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Inloggen — Voorraadbeheer",
  robots: { index: false, follow: false },
};

/**
 * Loginpagina (SPEC §F7). Server component met een gewoon HTML-formulier dat naar
 * `/api/auth/login` post, zodat inloggen ook werkt zonder JavaScript. De route handler
 * stuurt bij een fout terug naar deze pagina met `?error=`.
 */

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Foutmeldingen zijn bewust generiek: ze verklappen niet of het veld leeg was, of het
 * wachtwoord bijna goed was, of dat er überhaupt een wachtwoord is ingesteld.
 */
function errorMessage(code: string | undefined): string | null {
  switch (code) {
    case "onjuist":
      return "Onjuist wachtwoord";
    case "limiet":
      return "Te veel mislukte pogingen. Probeer het over 15 minuten opnieuw.";
    case "config":
      return "De applicatie is niet volledig geconfigureerd. Neem contact op met de beheerder.";
    default:
      return null;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const next = safeNextPath(firstValue(params.next));
  const error = errorMessage(firstValue(params.error));
  const isRateLimited = firstValue(params.error) === "limiet";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">Voorraadbeheer</h1>
          <p className="mt-1 text-sm text-gray-600">
            Voer het wachtwoord in om verder te gaan.
          </p>

          {error !== null && (
            <div
              role="alert"
              aria-live="polite"
              className={
                isRateLimited
                  ? "mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  : "mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
              }
            >
              {error}
            </div>
          )}

          <form method="post" action="/api/auth/login" className="mt-5 space-y-4">
            <input type="hidden" name="next" value={next} />

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-900"
              >
                Wachtwoord
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                aria-invalid={error !== null}
                className="mt-1 block h-12 min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-base text-gray-900 outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/20"
              />
            </div>

            <button
              type="submit"
              disabled={isRateLimited}
              className="flex h-12 min-h-[44px] w-full items-center justify-center rounded-lg bg-gray-900 px-4 text-base font-medium text-white transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900/30 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              Inloggen
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-gray-500">
          Interne applicatie. Deel het wachtwoord niet buiten het team.
        </p>
      </div>
    </main>
  );
}
