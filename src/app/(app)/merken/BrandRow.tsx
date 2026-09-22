"use client";

import { useActionState, useEffect, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import type { BrandWithPartCountDTO } from "@/lib/queries/brands";
import { deleteBrandAction, renameBrandAction } from "./actions";
import { initialBrandActionState } from "./form-state";

/** Eén rij in het merkenoverzicht: naam, aantal onderdelen, hernoemen en verwijderen. */
export function BrandRow({ brand }: { brand: BrandWithPartCountDTO }) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameState, renameAction, isRenamePending] = useActionState(
    renameBrandAction,
    initialBrandActionState,
  );
  const [deleteState, deleteAction, isDeletePending] = useActionState(
    deleteBrandAction,
    initialBrandActionState,
  );

  useEffect(() => {
    if (renameState.status === "success") {
      setIsRenaming(false);
    }
  }, [renameState]);

  return (
    <li className="flex flex-col gap-2 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          {isRenaming ? (
            <form
              action={renameAction}
              className="flex w-full flex-col gap-2 sm:flex-row sm:items-end"
            >
              <input type="hidden" name="id" value={brand.id} />
              <div className="flex-1 sm:max-w-xs">
                <Input
                  id={`rename-${brand.id}`}
                  name="name"
                  label="Nieuwe naam"
                  defaultValue={brand.name}
                  error={
                    renameState.status === "error"
                      ? renameState.fieldErrors?.name
                      : undefined
                  }
                  required
                  maxLength={100}
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={isRenamePending}>
                  {isRenamePending ? "Opslaan..." : "Opslaan"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsRenaming(false)}
                >
                  Annuleren
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="font-medium text-gray-900">{brand.name}</p>
              <Badge variant={brand.partCount > 0 ? "info" : "default"}>
                {brand.partCount}{" "}
                {brand.partCount === 1 ? "onderdeel" : "onderdelen"}
              </Badge>
            </>
          )}
        </div>

        {!isRenaming && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setIsRenaming(true)}>
              Hernoemen
            </Button>
            <form
              action={deleteAction}
              onSubmit={(event) => {
                const confirmed = window.confirm(
                  `Weet je zeker dat je merk "${brand.name}" wilt verwijderen? Dit kan niet ongedaan gemaakt worden.`,
                );
                if (!confirmed) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="id" value={brand.id} />
              <Button type="submit" variant="danger" disabled={isDeletePending}>
                {isDeletePending ? "Verwijderen..." : "Verwijderen"}
              </Button>
            </form>
          </div>
        )}
      </div>

      {deleteState.status === "error" && (
        <p className="text-sm text-red-600" role="alert">
          {deleteState.message}
        </p>
      )}
      {renameState.status === "error" && renameState.message && (
        <p className="text-sm text-red-600" role="alert">
          {renameState.message}
        </p>
      )}
    </li>
  );
}
