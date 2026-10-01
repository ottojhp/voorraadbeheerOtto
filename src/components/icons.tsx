/**
 * Kleine set inline SVG-iconen voor de navigatie. Geen externe icon-library
 * (geen extra dependency nodig): eenvoudige, zelf getekende lijniconen.
 */
import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

export function DashboardIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9" />
      <path d="M9.5 20v-6h5v6" />
    </svg>
  );
}

export function StockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

export function SaleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
      <path d="M2.5 3h2.2l2.2 12.2h10.3l1.8-8.2H6" />
    </svg>
  );
}

export function SupplierIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 6.5h11v9h-11z" />
      <path d="M13.5 10h3.4l3.1 3v2.5h-6.5z" />
      <circle cx="7" cy="17.5" r="1.6" />
      <circle cx="16.5" cy="17.5" r="1.6" />
    </svg>
  );
}

export function ReportIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M20 20H4" />
    </svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 20H5.5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M16 16.5 20.5 12 16 7.5" />
      <path d="M20.5 12H9" />
    </svg>
  );
}

/**
 * Scannen (T20): een richtkader met een leeslijn erdoor. Bewust niet het
 * streepjescode-icoon — dit scherm leest ook gewone tekst van een verpakking.
 */
export function ScanIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5" />
      <path d="M15.5 4H18a2 2 0 0 1 2 2v2.5" />
      <path d="M20 15.5V18a2 2 0 0 1-2 2h-2.5" />
      <path d="M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
      <path d="M7 12h10" />
    </svg>
  );
}

export function SpinnerIcon(props: IconProps) {
  return (
    <svg
      {...base(props)}
      className={`animate-spin ${props.className ?? ""}`}
    >
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}
