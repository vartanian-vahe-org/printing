import { shipByState, shopDate } from '../orders';

/** Ship-by date, red when late and amber when due today (unshipped orders only). */
export function ShipBy({ shipBy, status }: { shipBy: string | null; status: string }) {
  if (!shipBy) return <span className="muted-inline">—</span>;
  const state = shipByState({ shipBy, status });
  return (
    <span className={state === 'late' ? 'ship-late' : state === 'today' ? 'ship-today' : state === null ? 'muted-inline' : undefined}>
      {shopDate(shipBy)}
      {state === 'late' && ' · late'}
      {state === 'today' && ' · today'}
    </span>
  );
}
