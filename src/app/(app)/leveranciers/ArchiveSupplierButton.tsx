"use client";

/**
 * Archiveerknop met bevestigingsstap, gebruikt op de leveranciersdetail- en
 * bewerkpagina (SPEC §F5). De harde regel ("mag niet als er nog actieve onderdelen
 * gekoppeld zijn") wordt server-side gecontroleerd in `archiveSupplierAction`; dit
 * component toont alleen de melding die daaruit terugkomt.
 */

import { useActionState, useState } from "react";

import { Button } from "@/components/Button";

import {
  initialArchiveSupplierFormState,
  type ArchiveSupplierFormState,
} from "./form-state";

export interface ArchiveSupplierButtonProps {
  action: (
    prevState: ArchiveSupplierFormState,
    formData: FormData,
  ) => Promise<ArchiveSupplierFormState>;
  supplierName: string;
}

export function ArchiveSupplierButton({
  action,
  supplierName,
}: ArchiveSupplierButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    action,
    initialArchiveSupplierFormState,
  );

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="danger"
        onClick={() => setConfirming(true)}
      >
        Archiveren
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm text-red-900">
        Weet je zeker dat je <strong>{supplierName}</strong> wilt archiveren? De
        leverancier verdwijnt dan uit het overzicht en is niet meer kiesbaar bij
        onderdelen.
      </p>

      {state.status === "error" && state.message && (
        <p role="alert" className="text-sm font-medium text-red-800">
          {state.message}
        </p>
      )}

      <form action={formAction} className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Bezig…" : "Ja, archiveren"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Annuleren
        </Button>
      </form>
    </div>
  );
}
