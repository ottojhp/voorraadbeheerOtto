/**
 * Welke navigatielink "actief" is bij een bepaald pad.
 *
 * Staat apart van `@/components/AppNav` omdat dat bestand `"use client"` is en zo'n
 * bestand alleen componenten en types mag exporteren — een gewone functie daaruit
 * exporteren en die vanuit een server component aanroepen laat de pagina bij élk
 * bezoek crashen zonder dat de build of de tests iets merken (zie de notities in
 * `docs/PROGRESS.md`). Bijkomend voordeel: zo is dit zonder browser te testen.
 *
 * ## Waarom "de langste match wint" en niet "begint ermee"
 * Sinds T20 staan `/onderdelen` en `/onderdelen/scannen` beide in de navigatie.
 * Met een simpele `pathname.startsWith(href)`-regel zouden op `/onderdelen/scannen`
 * BEIDE links oplichten, en dan staat er twee keer `aria-current="page"` in de
 * balk — voor een schermlezer betekent dat twee huidige pagina's. Door de link met
 * het langste passende pad te kiezen, is er altijd precies één actieve link, en
 * blijft `/onderdelen/abc123` (een detailpagina zonder eigen navigatielink) netjes
 * onder "Voorraad" vallen.
 */

/**
 * Geeft de href terug die bij dit pad hoort, of `null` als geen enkele link past.
 *
 * - `/` past alleen op precies `/`; anders zou de dashboardlink op élke pagina
 *   actief zijn.
 * - Een andere href past bij een exacte gelijkheid of als het pad eronder valt
 *   (`/onderdelen/abc` valt onder `/onderdelen`). Dat laatste moet op een `/`
 *   eindigen: zonder die eis zou `/onderdelenlijst` ook onder `/onderdelen` vallen.
 * - Passen er meerdere, dan wint de langste — de meest specifieke dus.
 */
export function pickActiveNavHref(
  pathname: string,
  hrefs: readonly string[],
): string | null {
  let best: string | null = null;

  for (const href of hrefs) {
    if (!matchesNavHref(pathname, href)) {
      continue;
    }
    if (best === null || href.length > best.length) {
      best = href;
    }
  }

  return best;
}

/** Of dit pad onder deze href valt. Zie de uitleg bij {@link pickActiveNavHref}. */
export function matchesNavHref(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
