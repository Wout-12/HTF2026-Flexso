/** Reads everything the council sheet is made of. Shared by the council's sheet and the village square; nothing here changes data. */
import type { Decision, PreviousCopy, SheetInput, SheetRepair, SheetResult, SheetSensor } from './council-sheet';
import { dayOf, realToday } from './demo-clock';
import { isTrusted, readBoard, type Num, type Row } from './read-pantry';
import { readWater } from './read-water';

interface CopyRow { ID: string; copyNo: string; createdAt: string; decidedAt: string | null; decidedBy: string | null; resultJson: string }
interface DecisionRow { sheet_ID: string; lineKey: string; decision: Decision; note: string | null }

interface Query extends PromiseLike<unknown> {
  where(predicate: Row): Query;
  orderBy(order: string): Query;
  limit(rows: number): Query;
}
/** The slice of the `cds` facade this file uses. */
interface CdsApi { readonly ql: { readonly SELECT: { from(entity: string): { columns(...columns: readonly string[]): Query } } } }

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT } = cds.ql;
const DB = 'oakhaven.curse';

export async function readDecisions(sheet: string): Promise<DecisionRow[]> {
  return (await SELECT.from(`${DB}.CouncilDecisions`).columns('sheet_ID', 'lineKey', 'decision', 'note').where({ sheet_ID: sheet })) as DecisionRow[];
}

/** The last copy the council ticked, before `day` when that is given. */
export async function readDecided(day?: string): Promise<PreviousCopy | null> {
  const copies = (await SELECT.from(`${DB}.CouncilSheets`).columns('ID', 'copyNo', 'createdAt', 'decidedAt', 'decidedBy')
    .where({ decidedAt: { '!=': null } }).orderBy('createdAt desc').limit(50)) as Omit<CopyRow, 'resultJson'>[];
  const copy = copies.find((row) => day === undefined || dayOf(row.createdAt) < day);
  if (!copy) return null;
  const [{ resultJson }] = (await SELECT.from(`${DB}.CouncilSheets`).columns('resultJson').where({ ID: copy.ID })) as { resultJson: string }[];
  const decisions: Record<string, Decision> = {};
  for (const row of await readDecisions(copy.ID)) decisions[row.lineKey] = row.decision;
  return { copyNo: copy.copyNo, createdAt: copy.createdAt, result: JSON.parse(resultJson) as SheetResult, decisions };
}

export async function readInput(): Promise<SheetInput> {
  const now = new Date();
  const read = async <T>(entity: string, ...columns: string[]): Promise<T[]> => (await SELECT.from(`${DB}.${entity}`).columns(...columns)) as T[];
  const water = await readWater(now);
  const sensors = await read<SheetSensor & { ID: string }>('Sensors', 'ID', 'pipe_ID', 'sensorID', 'lastReading', 'modifiedAt', 'modifiedBy', 'flowRate', 'pressure');
  const kinds = await read<{ name: string; kind: string | null }>('Landmarks', 'name', 'kind');
  // Today's real day: a day Tobin only pretends for a demo never ends up on the council's table.
  const board = [...(await readBoard(realToday())).values()];
  const counts = await read<{ item_ID: string; countedBy: string | null; countedAt: string }>('StockCounts', 'item_ID', 'countedBy', 'countedAt');
  counts.sort((a, b) => b.countedAt.localeCompare(a.countedAt));
  const costs = new Map((await read<{ code: string; crowns: number }>('CouncilCosts', 'code', 'crowns')).map((row) => [row.code, row.crowns]));
  const rules = (await SELECT.from(`${DB}.CouncilRules`).columns('choice', 'decidedBy', 'decidedAt').orderBy('decidedAt desc').limit(1)) as NonNullable<SheetInput['rule']>[];
  const deliveries = await read<{ item_ID: string; quantityReceived: Num; receivedAt: string | null }>('StockReceivals', 'item_ID', 'quantityReceived', 'receivedAt');
  return {
    now: now.toISOString(),
    pipes: water.input.pipes,
    // Maren's demo readings, with who changed the sensor last.
    sensors: sensors.map((sensor) => ({ ...sensor, ...water.input.sensors.find((item) => item.pipe_ID === sensor.pipe_ID) })),
    repairs: await read<SheetRepair>('Repairs', 'pipe_ID', 'issue', 'repairDate', 'repairedBy', 'tierAtRepair', 'modifiedAt', 'modifiedBy'),
    landmarks: water.input.landmarks.map((place) => ({ ...place, kind: kinds.find((row) => row.name === place.name)?.kind ?? null })),
    products: board.map(({ item, supplier, order }) => ({
      id: item.ID, name: item.name, unit: item.unit, stock: Number(item.currentQuantity), comfort: Number(item.minStockLevel), usePerDay: Number(item.consumptionRate),
      marketFactor: Number(item.marketDayFactor ?? 1),
      supplier: supplier ? { id: supplier.ID, name: supplier.name, leadDays: supplier.leadDays, isEstimate: supplier.isEstimate ?? false } : null,
      order: order ? { quantity: Number(order.orderedQuantity), dueOn: order.dueOn } : null,
      trusted: isTrusted(item), recordedAt: item.modifiedAt, recordedBy: item.modifiedBy, stockAsOf: item.stockAsOf, countedAt: item.countedAt,
      countedBy: counts.find((row) => row.item_ID === item.ID)?.countedBy ?? null,
    })),
    deliveries: deliveries.map((row) => ({ productId: row.item_ID, quantity: Number(row.quantityReceived), receivedAt: row.receivedAt })),
    costs: { repair: costs.get('repair') ?? 0, emergencyFood: costs.get('emergencyFood') ?? 0, weeklyBudget: costs.get('weeklyBudget') ?? 0 },
    rule: rules[0] ?? null,
    previous: await readDecided(realToday()),
    isDemo: water.isDemo,
  };
}
