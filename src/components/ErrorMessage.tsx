import type { ReactNode } from "react";

export interface ErrorMessageProps {
  title?: string;
  message: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Duidelijke foutmelding — nooit een stille mislukking (SPEC §F8). Gebruikt
 * door `app/(app)/error.tsx` en door features bij mislukte acties (bv. een
 * server action die een fout teruggeeft).
 */
export function ErrorMessage({
  title = "Er is iets misgegaan",
  message,
  action,
  className = "",
}: ErrorMessageProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-6 py-8 text-center ${className}`}
    >
      <p className="text-base font-semibold text-red-800">{title}</p>
      <p className="max-w-sm text-sm text-red-700">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
