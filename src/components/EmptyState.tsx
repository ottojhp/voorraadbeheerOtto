import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/**
 * Nette lege staat in plaats van een blanco scherm, bv. bij lege
 * zoekresultaten in het voorraadoverzicht (SPEC §F2).
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center ${className}`}
    >
      {icon}
      <p className="text-base font-medium text-gray-900">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-gray-500">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
