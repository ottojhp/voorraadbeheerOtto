"use client";

/**
 * Formulier voor een nieuwe of bestaande leverancier. Gebruikt door
 * `/leveranciers/nieuw` en `/leveranciers/[id]/bewerken`; de server action wordt als
 * prop meegegeven zodat dit component zelf niet weet of het om aanmaken of bewerken
 * gaat (SPEC §2: mutaties via server actions).
 */

import { useActionState } from "react";

import { Button } from "@/components/Button";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Input } from "@/components/Input";
import { Textarea } from "@/components/Textarea";

import {
  initialSupplierFormState,
  type SupplierFormState,
} from "./form-state";

export interface SupplierFormInitialValues {
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
}

export interface SupplierFormProps {
  action: (
    prevState: SupplierFormState,
    formData: FormData,
  ) => Promise<SupplierFormState>;
  initialValues?: SupplierFormInitialValues;
  submitLabel: string;
}

export function SupplierForm({
  action,
  initialValues,
  submitLabel,
}: SupplierFormProps) {
  const [state, formAction, pending] = useActionState(
    action,
    initialSupplierFormState,
  );

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.status === "error" && state.formError && (
        <ErrorMessage message={state.formError} />
      )}

      <Input
        id="name"
        name="name"
        label="Naam"
        required
        autoComplete="organization"
        defaultValue={initialValues?.name ?? ""}
        error={state.fieldErrors.name}
      />
      <Input
        id="contactPerson"
        name="contactPerson"
        label="Contactpersoon"
        autoComplete="name"
        defaultValue={initialValues?.contactPerson ?? ""}
        error={state.fieldErrors.contactPerson}
      />
      <Input
        id="phone"
        name="phone"
        label="Telefoon"
        type="tel"
        autoComplete="tel"
        defaultValue={initialValues?.phone ?? ""}
        error={state.fieldErrors.phone}
      />
      <Input
        id="email"
        name="email"
        label="E-mail"
        type="email"
        autoComplete="email"
        defaultValue={initialValues?.email ?? ""}
        error={state.fieldErrors.email}
      />
      <Textarea
        id="address"
        name="address"
        label="Adres"
        helpText="Meerdere regels zijn toegestaan."
        defaultValue={initialValues?.address ?? ""}
        error={state.fieldErrors.address}
      />
      <Textarea
        id="notes"
        name="notes"
        label="Notities"
        defaultValue={initialValues?.notes ?? ""}
        error={state.fieldErrors.notes}
      />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Opslaan…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
