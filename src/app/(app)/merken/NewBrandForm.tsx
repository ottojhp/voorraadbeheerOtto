"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { createBrandAction } from "./actions";
import { initialBrandActionState } from "./form-state";

/** Formulier om een nieuw merk aan te maken (T09). */
export function NewBrandForm() {
  const [state, formAction, isPending] = useActionState(
    createBrandAction,
    initialBrandActionState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1">
        <Input
          id="new-brand-name"
          name="name"
          label="Merknaam"
          placeholder="Bijv. Vespa"
          error={state.status === "error" ? state.fieldErrors?.name : undefined}
          required
          maxLength={100}
        />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Toevoegen..." : "Merk toevoegen"}
      </Button>
      {state.status === "success" && (
        <p className="text-sm text-green-700" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
