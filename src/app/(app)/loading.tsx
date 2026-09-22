import { SpinnerIcon } from "@/components/icons";

/**
 * Gedeelde laadstatus voor alle beschermde routes, getoond door Next.js
 * tijdens het streamen van een Server Component.
 */
export default function Loading() {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 py-24 text-center"
    >
      <SpinnerIcon className="h-8 w-8 text-blue-600" />
      <p className="text-sm text-gray-500">Bezig met laden…</p>
    </div>
  );
}
