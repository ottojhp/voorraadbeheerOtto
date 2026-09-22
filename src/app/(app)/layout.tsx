import type { ReactNode } from "react";
import { DesktopNavLinks, MobileBottomNav } from "@/components/AppNav";
import { LogoutButton } from "@/components/LogoutButton";

// Deze hele routegroep zit achter een login en toont voorraadcijfers die per
// verzoek vers uit de database moeten komen (voorraadstanden, lage-voorraad-
// meldingen, bestsellers, rapportages). Statisch prerenderen zou verouderde
// cijfers vastzetten op het buildmoment en levert door de login ook geen
// publieke, cachebare pagina op, dus forceren we dynamisch renderen.
export const dynamic = "force-dynamic";

/**
 * Gedeelde layout voor alle beschermde routes (T05). Op desktop een
 * zijbalk met navigatie + uitlogknop; op mobiel (vanaf 375px) een compacte
 * topbalk plus een vaste onderbalk met de vijf hoofdroutes. Geen
 * horizontaal scrollen op 375px.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Desktop/tablet zijbalk */}
      <aside className="hidden shrink-0 border-r border-gray-200 bg-white md:flex md:w-60 md:flex-col md:justify-between md:p-4">
        <div>
          <p className="mb-4 px-1 text-sm font-semibold text-gray-900">
            Voorraadbeheer
          </p>
          <DesktopNavLinks />
        </div>
        <LogoutButton />
      </aside>

      {/* Mobiele topbalk */}
      <header className="flex min-h-[56px] items-center justify-between border-b border-gray-200 bg-white px-4 md:hidden">
        <p className="text-sm font-semibold text-gray-900">Voorraadbeheer</p>
        <LogoutButton iconOnly />
      </header>

      <div className="flex-1">
        <main className="mx-auto w-full max-w-6xl px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-8">
          {children}
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
}
