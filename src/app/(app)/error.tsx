"use client";

import { useEffect } from "react";
import { Button } from "@/components/Button";
import { ErrorMessage } from "@/components/ErrorMessage";

/**
 * Gedeelde foutstatus voor alle beschermde routes. Client component:
 * Next.js vereist dit voor `error.tsx` (React error boundary).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-8">
      <ErrorMessage
        title="Er is iets misgegaan"
        message="Deze pagina kon niet worden geladen. Probeer het opnieuw."
        action={
          <Button variant="secondary" onClick={() => reset()}>
            Opnieuw proberen
          </Button>
        }
      />
    </div>
  );
}
