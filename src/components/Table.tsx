import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

/**
 * Tabel-primitives voor brede gegevenstabellen (bv. het voorraadoverzicht,
 * SPEC §F2). `Table` is standaard verborgen onder het `md`-breakpoint: op
 * 375px mag een tabel nooit horizontaal scrollen, dus features die deze
 * component gebruiken bouwen ZELF een mobiele kaartweergave ernaast met
 * dezelfde data, bv.:
 *
 * ```tsx
 * <Table className="hidden md:block">
 *   <TableHead>
 *     <tr><TableHeaderCell>Naam</TableHeaderCell>...</tr>
 *   </TableHead>
 *   <TableBody>
 *     {rows.map((r) => <tr key={r.id}><TableCell>{r.naam}</TableCell>...</tr>)}
 *   </TableBody>
 * </Table>
 * <div className="grid gap-3 md:hidden">
 *   {rows.map((r) => (
 *     <Card key={r.id}>
 *       <p className="font-medium">{r.naam}</p>
 *       <p className="text-sm text-gray-500">{r.sku}</p>
 *       ...
 *     </Card>
 *   ))}
 * </div>
 * ```
 *
 * Zo blijft dezelfde databron leidend voor beide weergaven zonder dat de
 * primitive zelf hoeft te weten welke kolommen een feature toont.
 */
export function Table({
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-gray-200">
      <table
        className={`w-full min-w-full divide-y divide-gray-200 text-left text-sm ${className}`}
        {...rest}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHead({
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={`bg-gray-50 ${className}`} {...rest}>
      {children}
    </thead>
  );
}

export function TableBody({
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={`divide-y divide-gray-100 bg-white ${className}`} {...rest}>
      {children}
    </tbody>
  );
}

export function TableHeaderCell({
  className = "",
  children,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TableCell({
  className = "",
  children,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-4 py-3 text-gray-900 ${className}`} {...rest}>
      {children}
    </td>
  );
}
