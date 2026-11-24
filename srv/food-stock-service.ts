/**
 * Handlers of `FoodStockService` (see `food-stock-service.cds`): Tobin's Pantry Board.
 * The arithmetic is in `lib/pantry-forecast.ts`; this file only reads, calls it and writes.
 *
 * `@sap/cds` ships no TypeScript declarations in this project, so it is loaded with `require`
 * and the part of its API this file uses is described in the small interfaces below.
 */
import { randomUUID } from 'node:crypto';
import { dayOf, isDemo, realToday, setDemoDay, today } from './lib/demo-clock';
import { addDays, daysBetween } from './lib/pantry-forecast';
import { readBoard, readItems, readSuppliers, RISK_ORDER, type Board, type Num, type Row } from './lib/read-pantry';

interface StateRow { itemID: string; risk: string; orderState: string }

interface ActionRequest {
  readonly data: Row;
  error(code: number, message: string, target?: string): void;
}

/** The slice of a CAP service this file uses. */
interface CdsService {
  init(): Promise<void>;
  after(event: string, entity: string, handler: (results: unknown) => unknown): void;
  on(event: string, handler: (req: ActionRequest) => unknown): void;
}

/** The slice of the `cds` facade this file uses. */
interface CdsApi {
  readonly ApplicationService: new (...args: readonly never[]) => CdsService;
  readonly ql: {
    readonly SELECT: {
      from(entity: string): {
        columns(...columns: readonly string[]): PromiseLike<unknown> & { where(predicate: Row): PromiseLike<unknown> };
      };
    };
    readonly INSERT: { into(entity: string): { entries(rows: Row | readonly Row[]): PromiseLike<unknown> } };
    UPDATE(entity: string): { with(data: Row): { where(predicate: Row): PromiseLike<unknown> } };
    readonly UPSERT: { into(entity: string): { entries(rows: Row | readonly Row[]): PromiseLike<unknown> } };
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT, INSERT, UPDATE, UPSERT } = cds.ql;

const DB = 'oakhaven.curse';
const OLD_COUNT_DAYS = 7;
const MAX_QUANTITY = 100_000;
const nowAsDateTime = (): string => `${new Date().toISOString().slice(0, 19)}Z`;
const isValidQuantity = (value: unknown): boolean => {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) && number >= 0 && number <= MAX_QUANTITY;
};

async function addForecast(results: unknown): Promise<void> {
  const rows = (Array.isArray(results) ? results : [results]).filter(
    (row): row is Row => row !== null && typeof row === 'object' && 'ID' in row,
  );
  if (rows.length === 0) return;
  const board = await readBoard();
  for (const row of rows) {
    const entry = board.get(row.ID as string);
    if (!entry) continue;
    const { item, supplier, order, result, rank } = entry;
    const recordedOn = dayOf(item.countedAt ?? item.stockAsOf ?? item.modifiedAt ?? new Date());
    Object.assign(row, result, {
      rank,
      supplierName: supplier?.name ?? null,
      leadDays: supplier?.leadDays ?? null,
      isEstimate: supplier?.isEstimate ?? false,
      orderedQuantity: order?.orderedQuantity ?? null,
      dueOn: order?.dueOn ?? null,
      recordedOn,
      oldCount: item.countedAt === null || daysBetween(recordedOn, today()) > OLD_COUNT_DAYS,
      boardDay: today(),
    });
  }
}

// ---- messages ------------------------------------------------------------------------------

const dayText = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const readableDay = (day: string | undefined): string => (day ? dayText.format(new Date(`${day}T00:00:00Z`)) : '');

function messageFor({ item, result, order }: Board, worse: boolean, orderChanged: boolean): string {
  const unit = item.unit === 'Number' ? '' : ` ${item.unit === 'L' ? 'L' : item.unit.toLowerCase()}`;
  if (orderChanged && result.orderState === 'late') return `${item.name}: the order of ${Number(order?.orderedQuantity)}${unit} is late. There is no other supplier.`;
  if (orderChanged && result.orderState === 'placed') return `${item.name}: order placed, due ${readableDay(order?.dueOn)}.`;
  if (result.risk === 'dontTrust') return `${item.name}: this number can't be trusted, please count it.`;
  const stock = `${result.projected}${unit} left, comfort is ${Number(item.minStockLevel)}${unit}`;
  if (!worse) return result.risk === 'ok' ? `${item.name} is fine again: ${stock}.` : `${item.name} is better: ${stock}.`;
  const orderNow = result.orderQuantity && result.orderState === 'none' ? ` Order ${result.orderQuantity}${unit} today.` : '';
  const what = { panic: 'dropped to panic', belowComfort: 'is below comfort', orderDue: 'has to be ordered today', ok: 'changed' }[result.risk];
  return `${item.name} ${what}: ${stock}.${orderNow}`;
}

async function checkAlerts(): Promise<void> {
  if (isDemo()) return; // a pretended day must not leave messages behind
  const board = await readBoard();
  const known = new Map(((await SELECT.from(`${DB}.StockStates`).columns('itemID', 'risk', 'orderState')) as StateRow[]).map((row) => [row.itemID, row]));
  const day = today();
  const sent = new Set(((await SELECT.from(`${DB}.Notifications`).columns('item_ID', 'state').where({ day })) as { item_ID: string; state: string }[])
    .map((row) => `${row.item_ID} ${row.state}`));
  const states: Row[] = [];
  const messages: Row[] = [];
  for (const entry of board.values()) {
    const { item, result } = entry;
    const before = known.get(item.ID);
    if (before && before.risk === result.risk && before.orderState === result.orderState) continue;
    states.push({ itemID: item.ID, risk: result.risk, orderState: result.orderState });
    if (!before) continue; // first look: nothing changed yet
    const riskChanged = before.risk !== result.risk;
    const orderChanged = before.orderState !== result.orderState && result.orderState !== 'none';
    if (!riskChanged && !orderChanged) continue;
    const state = `${result.risk} ${result.orderState}`;
    if (sent.has(`${item.ID} ${state}`)) continue;
    const worse = RISK_ORDER[result.risk] < RISK_ORDER[before.risk];
    messages.push({ ID: randomUUID(), item_ID: item.ID, state, day, message: messageFor(entry, worse, orderChanged) });
  }
  if (messages.length > 0) await INSERT.into(`${DB}.Notifications`).entries(messages);
  if (states.length > 0) await UPSERT.into(`${DB}.StockStates`).entries(states);
}

// ---- actions -------------------------------------------------------------------------------

async function countStock(req: ActionRequest): Promise<string[] | void> {
  const lines = (req.data.lines ?? []) as { item?: string; counted?: Num }[];
  const items = new Map((await readItems()).map((item) => [item.ID, item]));
  if (lines.length === 0) return req.error(400, 'Nothing was counted', 'lines');
  if (new Set(lines.map((line) => line.item)).size !== lines.length) return req.error(400, 'A product is on the list twice', 'lines');
  const now = nowAsDateTime();
  const counts: Row[] = [];
  for (const line of lines) {
    const item = items.get(line.item ?? '');
    if (!item) return req.error(404, 'This product does not exist', 'lines');
    if (!isValidQuantity(line.counted)) return req.error(400, `${item.name}: this count is not possible`, 'lines');
    counts.push({
      ID: randomUUID(), item_ID: item.ID, oldQuantity: item.currentQuantity, counted: line.counted, countedAt: now,
      countedBy: 'Tobin Reyes', oldModifiedAt: item.modifiedAt, oldModifiedBy: item.modifiedBy,
    });
  }
  await INSERT.into(`${DB}.StockCounts`).entries(counts);
  for (const count of counts) {
    await UPDATE(`${DB}.StockItems`).with({ currentQuantity: count.counted, stockAsOf: now, countedAt: now }).where({ ID: count.item_ID });
  }
  await checkAlerts();
  return counts.map((count) => count.ID as string);
}

async function markOrdered(req: ActionRequest): Promise<void> {
  const entry = (await readBoard()).get(req.data.item as string);
  if (!entry) return req.error(404, 'This product does not exist', 'item');
  if (!entry.supplier) return req.error(400, `${entry.item.name} is never ordered`, 'item');
  if (entry.order) return req.error(409, `${entry.item.name} is already ordered`, 'item');
  if (!isValidQuantity(req.data.quantity) || Number(req.data.quantity) === 0) return req.error(400, 'How much did you order?', 'quantity');
  await INSERT.into(`${DB}.PurchaseOrders`).entries({
    item_ID: entry.item.ID, orderedQuantity: req.data.quantity, orderedAt: nowAsDateTime(), dueOn: addDays(today(), entry.supplier.leadDays), open: true,
  });
  await checkAlerts();
}

async function logDelivery(req: ActionRequest): Promise<string | void> {
  const lines = (req.data.lines ?? []) as { item?: string; received?: Num }[];
  const supplier = (await readSuppliers()).find((row) => row.ID === req.data.supplier);
  if (!supplier) return req.error(404, 'This supplier does not exist', 'supplier');
  const receivedAt = (req.data.receivedAt as string | null) ?? nowAsDateTime();
  if (Date.parse(receivedAt) > Date.now() + 60_000) return req.error(400, 'A delivery cannot arrive in the future', 'receivedAt');
  const board = await readBoard();
  if (new Set(lines.map((line) => line.item)).size !== lines.length) return req.error(400, 'A product is on the list twice', 'lines');
  for (const line of lines) {
    const entry = board.get(line.item ?? '');
    if (!entry || entry.supplier?.ID !== supplier.ID) return req.error(400, `${supplier.name} does not bring this product`, 'lines');
    if (!isValidQuantity(line.received)) return req.error(400, `${entry.item.name}: this amount is not possible`, 'lines');
  }
  const arrived = lines.filter((line) => Number(line.received) > 0);
  if (arrived.length === 0) return req.error(400, 'Nothing arrived', 'lines');

  const deliveryID = randomUUID();
  const now = nowAsDateTime();
  await INSERT.into(`${DB}.StockReceivals`).entries(arrived.map((line) => ({
    ID: randomUUID(), item_ID: line.item, quantityReceived: line.received, supplier: supplier.name, receivedAt, deliveryID,
  })));
  for (const line of arrived) {
    const entry = board.get(line.item ?? '');
    if (!entry) continue;
    // A number we don't trust stays as it is: the next count includes this delivery.
    if (entry.result.projected !== null) {
      const stock = Math.max(0, entry.result.projected) + Number(line.received);
      await UPDATE(`${DB}.StockItems`).with({ currentQuantity: stock, stockAsOf: now }).where({ ID: line.item });
    }
    if (entry.order) {
      await UPDATE(`${DB}.PurchaseOrders`).with({ open: false, receivedQuantity: line.received }).where({ ID: entry.order.ID });
    }
  }
  await checkAlerts();
  return deliveryID;
}

export default class FoodStockService extends cds.ApplicationService {
  override async init(): Promise<void> {
    this.after('READ', 'StockItems', addForecast);
    this.on('countStock', countStock);
    this.on('markOrdered', markOrdered);
    this.on('logDelivery', logDelivery);
    this.on('checkAlerts', checkAlerts);
    this.on('markSeen', (req) => UPDATE(`${DB}.Notifications`).with({ acknowledged: true }).where({ ID: req.data.notification }));
    this.on('demoSetDay', (req) => {
      const day = req.data.day as string | null;
      if (!day || daysBetween(realToday(), day) < 0) return req.error(400, 'Pick today or a later day', 'day');
      setDemoDay(day);
    });
    this.on('demoReset', () => setDemoDay(null));
    return super.init();
  }
}
