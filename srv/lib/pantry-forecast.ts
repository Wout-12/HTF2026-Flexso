/**
 * Pantry forecast: how long a product lasts, when to order it and how much.
 * Pure functions: no database and no clock of its own, `today` is passed in.
 *
 * Conventions: stock is checked at 5am, a delivery arrives before that day's use, and an order
 * placed on day D arrives on D + lead.
 */

export type Risk = 'panic' | 'dontTrust' | 'belowComfort' | 'orderDue' | 'ok';
export type OrderState = 'none' | 'placed' | 'late';

export interface ForecastInput {
  /** Stock as recorded on `stockAsOf`. */
  readonly stock: number;
  readonly stockAsOf: string; // yyyy-mm-dd
  readonly today: string; // yyyy-mm-dd
  readonly usePerDay: number;
  /** How many times the normal use on market Saturdays (1 = like any other day). */
  readonly marketFactor: number;
  /** Delivery days; null = never ordered. */
  readonly leadDays: number | null;
  readonly comfort: number;
  readonly trusted: boolean;
  /** Due day of the open order, if there is one. */
  readonly openOrderDue: string | null;
}

export interface Forecast {
  readonly risk: Risk;
  readonly orderState: OrderState;
  /** Stock expected at 5am today. */
  readonly projected: number | null;
  readonly daysLeft: number | null;
  readonly runsOutOn: string | null;
  /** If he waits: first day below comfort / at panic (only when that is not already so today). */
  readonly belowOn: string | null;
  readonly panicOn: string | null;
  readonly orderOn: string | null;
  readonly orderQuantity: number | null;
  readonly arrivesOn: string | null;
  /** Usable stock when the order arrives, never below 0. */
  readonly arrivalStock: number | null;
  /** How far `arrivalStock` is below comfort; 0 = not. */
  readonly arrivalGap: number | null;
  readonly useUntilArrival: number | null;
  readonly weekUse: number | null;
  readonly target: number | null;
  /** The market Saturday the order has to cover, for products that sell more that day. */
  readonly marketDay: string | null;
}

const DAY_MS = 86_400_000;
const EPSILON = 1e-9;
const COVER_DAYS = 7;
const HORIZON_DAYS = 400;
const SATURDAY = 6;

const toDay = (date: string): number => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const toDate = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);
const isSaturday = (day: number): boolean => new Date(day * DAY_MS).getUTCDay() === SATURDAY;
const round = (value: number): number => Math.round(value * 100) / 100;

export const addDays = (date: string, days: number): string => toDate(toDay(date) + days);
export const daysBetween = (from: string, to: string): number => toDay(to) - toDay(from);

export function forecast(input: ForecastInput): Forecast {
  const { usePerDay, marketFactor, leadDays, comfort, trusted } = input;
  const today = toDay(input.today);
  const useOn = (day: number): number => usePerDay * (isSaturday(day) ? marketFactor : 1);
  const useBetween = (from: number, until: number): number => {
    let total = 0;
    for (let day = from; day < until; day++) total += useOn(day);
    return total;
  };
  const start = Math.min(toDay(input.stockAsOf), today);
  // Not clamped: a negative number is demand that cannot be met. A number we don't trust is never
  // used; the order is then worked out as if nothing is left.
  const stock = trusted ? input.stock - useBetween(start, today) : 0;
  const projected = (day: number): number => stock - useBetween(today, day);
  const firstDay = (matches: (day: number) => boolean): number | null => {
    if (usePerDay <= 0) return null;
    for (let day = today; day < today + HORIZON_DAYS; day++) if (matches(day)) return day;
    return null;
  };

  let daysLeft: number | null = null;
  let runsOut: number | null = null;
  if (trusted && usePerDay > 0) {
    let left = Math.max(0, stock);
    let day = today;
    while (left > useOn(day) + EPSILON) left -= useOn(day++);
    daysLeft = left <= EPSILON ? 0 : day - today + left / useOn(day);
    runsOut = day;
  }

  let orderOn: number | null = null;
  let order: Pick<Forecast, 'orderQuantity' | 'arrivesOn' | 'arrivalStock' | 'arrivalGap' | 'useUntilArrival' | 'weekUse' | 'target' | 'marketDay'> = {
    orderQuantity: null, arrivesOn: null, arrivalStock: null, arrivalGap: null, useUntilArrival: null, weekUse: null, target: null, marketDay: null,
  };
  if (leadDays !== null && usePerDay > 0) {
    // The last day on which ordering still lands at or above comfort; today when it is too late.
    const tooLate = firstDay((day) => projected(day + leadDays) < comfort - EPSILON);
    orderOn = tooLate === null ? null : Math.max(today, tooLate - 1);
    if (orderOn !== null) {
      const arrival = orderOn + leadDays;
      const usable = Math.max(0, projected(arrival));
      const weekUse = useBetween(arrival, arrival + COVER_DAYS);
      const target = comfort + weekUse;
      const saturday = arrival + ((SATURDAY - new Date(arrival * DAY_MS).getUTCDay() + 7) % 7);
      order = {
        orderQuantity: Math.max(0, Math.ceil(target - usable - EPSILON)),
        arrivesOn: toDate(arrival),
        arrivalStock: round(usable),
        arrivalGap: round(Math.max(0, comfort - usable)),
        useUntilArrival: round(useBetween(orderOn, arrival)),
        weekUse: round(weekUse),
        target: round(target),
        marketDay: marketFactor > 1 ? toDate(saturday) : null,
      };
    }
  }

  let risk: Risk = 'ok';
  if (!trusted) risk = 'dontTrust';
  else if (stock < comfort / 2 - EPSILON) risk = 'panic';
  else if (stock < comfort - EPSILON) risk = 'belowComfort';
  else if (orderOn === today) risk = 'orderDue';

  let orderState: OrderState = 'none';
  if (input.openOrderDue) orderState = daysBetween(input.openOrderDue, input.today) > 0 ? 'late' : 'placed';

  const below = trusted && stock >= comfort - EPSILON ? firstDay((day) => projected(day) < comfort - EPSILON) : null;
  const panic = trusted && stock >= comfort / 2 - EPSILON ? firstDay((day) => projected(day) < comfort / 2 - EPSILON) : null;
  return {
    risk,
    orderState,
    projected: trusted ? round(stock) : null,
    daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
    runsOutOn: runsOut === null ? null : toDate(runsOut),
    belowOn: below === null ? null : toDate(below),
    panicOn: panic === null ? null : toDate(panic),
    orderOn: orderOn === null ? null : toDate(orderOn),
    ...order,
  };
}
