import { SpinnerIcon } from "@/components/icons";

/**
 * Route-specifieke laadstatus voor `/onderdelen`, getoond door Next.js tijdens
 * het streamen van de servercomponent — bv. vlak na het wijzigen van een
 * filter, sortering of paginanummer in de URL (SPEC §F8: nooit een stille
 * mislukking of een blanco scherm). Vervangt de generieke `(app)/loading.tsx`
 * voor deze route.
 */
export default function OnderdelenLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div role="status" className="flex items-center gap-3 text-sm text-gray-500">
        <SpinnerIcon className="h-5 w-5 text-blue-600" />
        Onderdelen laden…
      </div>
      <div className="flex flex-col gap-2" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="h-14 w-full animate-pulse rounded-md bg-gray-100"
          />
        ))}
      </div>
    </div>
  );
}
