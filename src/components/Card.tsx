import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  actions?: ReactNode;
}

/**
 * Generieke kaartcontainer. Optionele titel + acties in de kop, bv. voor de
 * dashboardkaarten en als bouwsteen voor de mobiele kaartweergave van
 * `Table`.
 */
export function Card({
  title,
  actions,
  className = "",
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${className}`}
      {...rest}
    >
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          )}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
