import { LogoutIcon } from "@/components/icons";

export interface LogoutButtonProps {
  className?: string;
  /** Toon alleen het icoon (compacte mobiele topbalk) i.p.v. icoon + tekst. */
  iconOnly?: boolean;
}

/**
 * Uitlogknop. Puur HTML-formulier (`method="post"`) naar `/api/auth/logout`
 * — geen client-JavaScript nodig, werkt ook zonder JS. De route zelf wordt
 * door de authenticatietaak gebouwd.
 */
export function LogoutButton({ className = "", iconOnly = false }: LogoutButtonProps) {
  return (
    <form action="/api/auth/logout" method="post" className={className}>
      <button
        type="submit"
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <LogoutIcon className="h-5 w-5 shrink-0" />
        {!iconOnly && <span>Uitloggen</span>}
      </button>
    </form>
  );
}
