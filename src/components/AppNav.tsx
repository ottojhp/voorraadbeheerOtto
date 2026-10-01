"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import {
  DashboardIcon,
  ReportIcon,
  SaleIcon,
  ScanIcon,
  StockIcon,
  SupplierIcon,
  type IconProps,
} from "@/components/icons";
import { pickActiveNavHref } from "@/lib/nav";

interface NavItem {
  href: string;
  label: string;
  /**
   * Kortere tekst voor de vaste onderbalk op mobiel. Sinds T20 staan daar zes
   * items in plaats van vijf: op 375px is elk vakje nog ~62px breed, en
   * "Leveranciers" en "Rapportages" passen daar niet meer heel in. Afkappen met
   * een ellipsis zou "Leverancie…" opleveren — een kortere, volledige term leest
   * beter. Op desktop (zijbalk) blijft het volledige label staan.
   */
  shortLabel?: string;
  icon: ComponentType<IconProps>;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: DashboardIcon },
  { href: "/onderdelen", label: "Voorraad", icon: StockIcon },
  // Scannen staat direct naast Voorraad: het is de snelste weg naar een
  // voorraadwijziging in de werkplaats (T20).
  { href: "/onderdelen/scannen", label: "Scan", icon: ScanIcon },
  { href: "/verkoop", label: "Verkoop", icon: SaleIcon },
  {
    href: "/leveranciers",
    label: "Leveranciers",
    shortLabel: "Levers.",
    icon: SupplierIcon,
  },
  {
    href: "/rapportages",
    label: "Rapportages",
    shortLabel: "Rapport.",
    icon: ReportIcon,
  },
];

const NAV_HREFS = NAV_ITEMS.map((item) => item.href);

/** Navigatielinks voor de zijbalk op tablet/desktop. */
export function DesktopNavLinks() {
  const pathname = usePathname();
  const activeHref = pickActiveNavHref(pathname, NAV_HREFS);

  return (
    <nav aria-label="Hoofdnavigatie" className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === activeHref;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-blue-50 text-blue-700"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Vaste onderbalk met iconen + labels voor mobiel (375px en groter). */
export function MobileBottomNav() {
  const pathname = usePathname();
  const activeHref = pickActiveNavHref(pathname, NAV_HREFS);

  return (
    <nav
      aria-label="Hoofdnavigatie"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV_ITEMS.map(({ href, label, shortLabel, icon: Icon }) => {
        const active = href === activeHref;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            // `min-w-0` hoort bij `truncate`: zonder die regel weigert een
            // flex-item te krimpen onder de breedte van zijn tekst, en dan duwt
            // het langste label de balk breder dan 375px.
            className={`flex min-h-[56px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-[10px] font-medium ${
              active ? "text-blue-700" : "text-gray-500"
            }`}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {/* De volledige naam blijft voorleesbaar; alleen de zichtbare tekst
                is ingekort. */}
            <span className="truncate" aria-hidden={shortLabel ? true : undefined}>
              {shortLabel ?? label}
            </span>
            {shortLabel && <span className="sr-only">{label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
