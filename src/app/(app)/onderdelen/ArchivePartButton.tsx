"use client";

/**
 * Archiveerknop met bevestigingsstap, gebruikt op de onderdeeldetail- en
 * bewerkpagina (SPEC §F3: "archiveren vanaf de bewerkpagina, met bevestiging"; hier
 * ook op de detailpagina, net als bij leveranciers). De soft delete zelf gebeurt
 * server-side in `archivePartAction`; dit component toont alleen de bevestigingsstap
 * en een eventuele foutmelding.
 */

import { useActionState, useState } from "react";

import { Button } from "@/components/Button";

import {
  initialArchivePartFormState,
  type ArchivePartFormState,
} from "./form-state";

export interface ArchivePartButtonProps {
  action: (
    prevState: ArchivePartFormState,
    formData: FormData,
  ) => Promise<ArchivePartFormState>;
  partName: string;
}

export function ArchivePartButton({ action, partName }: ArchivePartButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    action,
    initialArchivePartFormState,
  );

  if (!confirming) {
    return (
      <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
        Archiveren
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <p className="text-sm text-red-900">
        Weet je zeker dat je <strong>{partName}</strong> wilt archiveren? Het
        onderdeel verdwijnt dan uit het voorraadoverzicht en is niet meer
        selecteerbaar bij een nieuwe verkoop. De verkoophistorie blijft bewaard.
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
