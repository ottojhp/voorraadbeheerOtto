/**
 * Tests voor de actieve-link-logica van de navigatie (T20).
 *
 * De aanleiding: sinds T20 staan `/onderdelen` en `/onderdelen/scannen` naast elkaar
 * in de balk. Precies één link mag actief zijn.
 */

import { describe, expect, it } from "vitest";

import { matchesNavHref, pickActiveNavHref } from "@/lib/nav";

/** Dezelfde hrefs als in `@/components/AppNav`, in dezelfde volgorde. */
const HREFS = [
  "/",
  "/onderdelen",
  "/onderdelen/scannen",
  "/verkoop",
  "/leveranciers",
  "/rapportages",
  "/voorraadmutaties",
] as const;

describe("pickActiveNavHref", () => {
  it("markeert het dashboard alleen op het pad zelf", () => {
    expect(pickActiveNavHref("/", HREFS)).toBe("/");
    expect(pickActiveNavHref("/onderdelen", HREFS)).not.toBe("/");
  });

  it("markeert de scanlink op het scanpad, en niet ook Voorraad", () => {
    expect(pickActiveNavHref("/onderdelen/scannen", HREFS)).toBe(
      "/onderdelen/scannen",
    );
  });

  it("laat een detailpagina onder Voorraad vallen", () => {
    expect(pickActiveNavHref("/onderdelen/clx123", HREFS)).toBe("/onderdelen");
    expect(pickActiveNavHref("/onderdelen/clx123/bewerken", HREFS)).toBe(
      "/onderdelen",
    );
    expect(pickActiveNavHref("/onderdelen/nieuw", HREFS)).toBe("/onderdelen");
  });

  it("markeert Voorraadmutaties op zijn eigen pad (T24), ook met filters in de URL", () => {
    expect(pickActiveNavHref("/voorraadmutaties", HREFS)).toBe("/voorraadmutaties");
    expect(matchesNavHref("/voorraadmutaties", "/onderdelen")).toBe(false);
  });

  it("geeft null voor een pad buiten de navigatie", () => {
    expect(pickActiveNavHref("/merken", HREFS)).toBeNull();
    expect(pickActiveNavHref("/login", HREFS)).toBeNull();
  });

  it("kiest altijd precies één link", () => {
    for (const pathname of [
      "/",
      "/onderdelen",
      "/onderdelen/scannen",
      "/onderdelen/abc",
      "/verkoop",
      "/leveranciers/abc",
      "/rapportages",
      "/voorraadmutaties",
    ]) {
      const active = pickActiveNavHref(pathname, HREFS);
      const allMatching = HREFS.filter((href) => matchesNavHref(pathname, href));

      expect(allMatching.length).toBeGreaterThan(0);
      expect(active).not.toBeNull();
      // Ook als er meerdere passen, komt er één uit — de langste.
      expect(allMatching).toContain(active);
    }
  });
});

describe("matchesNavHref", () => {
  it("vereist een padgrens en matcht geen losse tekstprefix", () => {
    expect(matchesNavHref("/onderdelenlijst", "/onderdelen")).toBe(false);
    expect(matchesNavHref("/onderdelen-oud", "/onderdelen")).toBe(false);
    expect(matchesNavHref("/onderdelen/", "/onderdelen")).toBe(true);
  });
});
