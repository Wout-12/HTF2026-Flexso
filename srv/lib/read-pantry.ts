/**
 * Reads the pantry and works out the forecast of every product. Shared by Tobin's board and the
 * council sheet; nothing here changes data.
 */
import { dayOf, realToday, today } from './demo-clock';
import { forecast, type Forecast } from './pantry-forecast';
import { readTrust, type Trust } from './read-ledger';

export type Num = number | string | null;
export type Row = Record<string, unknown>;

export interface ItemRow {
  ID: string; name: string; unit: string; currentQuantity: Num; minStockLevel: Num; consumptionRate: Num;
  marketDayFactor: Num; supplier_ID: string | null; stockAsOf: string | null; countedAt: string | null;
  modifiedAt: string | null; modifiedBy: string | null;
  /** Ilse's mark on exactly this value, if there is one. */
  trust: Trust | null;
}
export interface SupplierRow { ID: string; name: string; leadDays: number; isEstimate: boolean | null }
export interface OrderRow { ID: string; item_ID: string; orderedQuantity: Num; dueOn: string }

/** The edit of 17 Nov that also touched a water sensor and dated a repair in the future. */
export const SUSPICIOUS_EDIT = { by: 'system', at: '2026-11-17T03:13' };
export const RISK_ORDER: Readonly<Record<string, number>> = { panic: 0, dontTrust: 1, belowComfort: 2, orderDue: 3, ok: 4 };

export interface Board {
  readonly item: ItemRow;
  readonly supplier: SupplierRow | undefined;
  readonly order: OrderRow | undefined;
  readonly result: Forecast;
  readonly rank: number;
}

/** The slice of the `cds` facade this file uses. */
interface CdsApi {
  readonly ql: {
    readonly SELECT: {
      from(entity: string): {
        columns(...columns: readonly string[]): PromiseLike<unknown> & { where(predicate: Row): PromiseLike<unknown> };
      };
    };
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT } = cds.ql;
const DB = 'oakhaven.curse';

export function isTrusted(item: ItemRow): boolean {
  if (Number(item.currentQuantity) < 0 || item.trust?.status === 'notTrusted') return false;
  const suspicious = item.modifiedBy === SUSPICIOUS_EDIT.by && (item.modifiedAt ?? '').startsWith(SUSPICIOUS_EDIT.at);
  return item.countedAt !== null || !suspicious;
}

export async function readItems(): Promise<ItemRow[]> {
  const trust = await readTrust();
  const items = (await SELECT.from(`${DB}.StockItems`).columns(
    'ID', 'name', 'unit', 'currentQuantity', 'minStockLevel', 'consumptionRate', 'marketDayFactor',
    'supplier_ID', 'stockAsOf', 'countedAt', 'modifiedAt', 'modifiedBy',
  )) as ItemRow[];
  return items.map((item) => ({ ...item, trust: trust('StockItem', item.ID, item.currentQuantity, item.modifiedAt) }));
}

export async function readSuppliers(): Promise<SupplierRow[]> {
  return (await SELECT.from(`${DB}.Suppliers`).columns('ID', 'name', 'leadDays', 'isEstimate')) as SupplierRow[];
}

async function readOpenOrders(): Promise<OrderRow[]> {
  return (await SELECT.from(`${DB}.PurchaseOrders`).columns('ID', 'item_ID', 'orderedQuantity', 'dueOn').where({ open: true })) as OrderRow[];
}

/** Forecast of every product, keyed by ID. The rank compares them all. */
export async function readBoard(day: string = today()): Promise<Map<string, Board>> {
  const [items, suppliers, orders] = [await readItems(), await readSuppliers(), await readOpenOrders()];
  const rows = items.map((item) => {
    const supplier = suppliers.find((row) => row.ID === item.supplier_ID);
    const order = orders.find((row) => row.item_ID === item.ID);
    const result = forecast({
      stock: Number(item.currentQuantity),
      // An old record cannot be rolled forward honestly: it is read as today's stock until counted.
      stockAsOf: item.stockAsOf ? dayOf(item.stockAsOf) : realToday(),
      today: day,
      usePerDay: Number(item.consumptionRate),
      marketFactor: Number(item.marketDayFactor ?? 1),
      leadDays: supplier?.leadDays ?? null,
      comfort: Number(item.minStockLevel),
      trusted: isTrusted(item),
      openOrderDue: order?.dueOn ?? null,
    });
    return { item, supplier, order, result };
  });
  const gap = (row: (typeof rows)[number]): number => (row.result.arrivalGap ?? 0) / Number(row.item.minStockLevel || 1);
  rows.sort((a, b) =>
    RISK_ORDER[a.result.risk] - RISK_ORDER[b.result.risk] || gap(b) - gap(a)
    || (a.result.daysLeft ?? 0) - (b.result.daysLeft ?? 0) || a.item.name.localeCompare(b.item.name));
  return new Map(rows.map((row, index) => [row.item.ID, { ...row, rank: index + 1 }]));
}
