/**
 * The Monday Council Sheet: two verdicts, how reliable their evidence is, and a recommended order
 * for the council's money. Pure function: no database and no clock of its own.
 *
 * It returns data, not sentences; the app writes the sentences. Rules come from the interviews with
 * Rowan, Maren and Tobin, except the ones marked "our rule".
 */
import { addDays, daysBetween, forecast, type ForecastInput } from './pantry-forecast';
import { buildRoute, type RouteInput, type Tier } from './water-route';

export const RULE_VERSION = 1;

type Num = number | string | null;

export interface SheetProduct {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly stock: number;
  readonly comfort: number;
  readonly usePerDay: number;
  readonly marketFactor: number;
  readonly supplier: { readonly id: string; readonly name: string; readonly leadDays: number; readonly isEstimate: boolean } | null;
  readonly order: { readonly quantity: number; readonly dueOn: string } | null;
  /** False: impossible, or written by the suspicious edit. */
  readonly trusted: boolean;
  /** Last recorded update: a count, a delivery, an import or a correction. Nobody knows which. */
  readonly recordedAt: string | null;
  readonly recordedBy: string | null;
  readonly stockAsOf: string | null;
  readonly countedAt: string | null;
  readonly countedBy: string | null;
}

export interface SheetRepair {
  readonly pipe_ID: string;
  readonly issue: string | null;
  readonly repairDate: string | null;
  readonly repairedBy: string | null;
  readonly tierAtRepair: string | null;
  readonly modifiedAt: string | null;
  readonly modifiedBy: string | null;
}

export interface SheetSensor {
  readonly pipe_ID: string;
  readonly sensorID: string;
  readonly flowRate: Num;
  readonly pressure: Num;
  readonly lastReading: string | null;
  readonly modifiedAt: string | null;
  readonly modifiedBy: string | null;
}

export type Decision = 'yes' | 'no' | 'later';

export interface PreviousCopy {
  readonly copyNo: string;
  readonly createdAt: string;
  readonly result: SheetResult;
  readonly decisions: Readonly<Record<string, Decision>>;
}

export interface SheetInput {
  readonly now: string;
  readonly pipes: RouteInput['pipes'];
  readonly sensors: readonly SheetSensor[];
  readonly repairs: readonly SheetRepair[];
  readonly landmarks: readonly (RouteInput['landmarks'][number] & { readonly kind: string | null })[];
  readonly products: readonly SheetProduct[];
  readonly deliveries: readonly { readonly productId: string; readonly quantity: number; readonly receivedAt: string | null }[];
  readonly costs: { readonly repair: number; readonly emergencyFood: number; readonly weeklyBudget: number };
  /** What the council once chose about urgent repairs, if they did. */
  readonly rule: { readonly choice: string; readonly decidedBy: string; readonly decidedAt: string } | null;
  readonly previous: PreviousCopy | null;
  readonly isDemo: boolean;
}

export type WaterState = 'badlyShort' | 'cantTell' | 'runningLow' | 'fine';
export type FoodState = 'doubtful' | 'unreliable' | 'notAllRight' | 'notYet' | 'atRisk' | 'fine' | 'baked';
export type Verdict = 'allRight' | 'notAllRight' | 'notYet' | 'atRisk' | 'cantTell';

export interface PipeLine {
  readonly pipeID: string;
  readonly tier: Tier;
  readonly flow: number | null;
  readonly nominal: number | null;
  readonly flowPercent: number | null;
  readonly pressure: number | null;
  readonly readingAt: string | null;
}

export interface Place { readonly name: string; readonly note: string | null; readonly priority: number | null }

export interface AreaLine extends Place {
  readonly state: WaterState;
  readonly path: readonly string[];
  /** The pipe that decides; null when the path is fine or missing. */
  readonly worst: PipeLine | null;
  /** Other pipes on the path that fail or have no fresh readings. */
  readonly also: readonly PipeLine[];
}

export interface FoodLine {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly stock: number;
  readonly state: FoodState;
  readonly reliable: boolean;
  readonly source: 'counted' | 'record' | 'delivery' | 'noDate';
  readonly recordedOn: string | null;
  readonly countedBy: string | null;
  readonly ageDays: number | null;
  readonly lastsDays: number | null;
  /** If the quantity is accurate and nothing arrives; only when that is this week. */
  readonly runsOutOn: string | null;
  readonly orderedFor: string | null;
  readonly timingUncertain: boolean;
}

interface History { readonly decision: Decision; readonly copyNo: string; readonly decidedOn: string }

export interface MoneyLine {
  readonly key: string;
  readonly kind: 'approve' | 'approveIf' | 'buffer' | 'reserve';
  readonly crowns: number;
  /** What this line rests on; a refused line only comes back when it changes. */
  readonly evidence: string;
  readonly pipe: PipeLine | null;
  readonly places: readonly Place[];
  readonly everyone: boolean;
  /** Pipes further down that may have the same fault. */
  readonly checkAfter: readonly string[];
  readonly supplier: string | null;
  readonly products: readonly { readonly id: string; readonly name: string; readonly unit: string; readonly doubtful: boolean; readonly cartDue: string | null; readonly shortUnder: number | null }[];
  /** One cart for everything, if the farm confirms that. */
  readonly oneCart: number | null;
  readonly history: History | null;
}

export interface Budget {
  readonly weekly: number;
  readonly pending: number;
  readonly approve: number;
  readonly approveIf: number;
  readonly buffer: number;
  readonly reserve: number;
  readonly total: number;
  readonly short: number;
  readonly unallocated: number;
}

export type Option =
  | { readonly kind: 'askFarm'; readonly total: number }
  | { readonly kind: 'smallerBuffer'; readonly crowns: number; readonly enough: boolean }
  | { readonly kind: 'wait'; readonly pipeID: string; readonly crowns: number }
  | { readonly kind: 'smallerReserve'; readonly crowns: number; readonly full: number }
  | { readonly kind: 'sayNo' };

export interface Doubt {
  readonly kind: 'stock' | 'sensor' | 'repair';
  readonly name: string;
  readonly value: number | null;
  readonly unit: string;
  readonly expected: number | null;
  readonly date: string | null;
  readonly changedBy: string | null;
  readonly changedAt: string | null;
}

export type HelpLabel = 'back' | 'improved' | 'none' | 'worse' | 'notCompleted' | 'cantTell' | 'released' | 'held' | 'bufferPending';

export interface HelpLine {
  readonly key: string;
  readonly kind: MoneyLine['kind'];
  readonly crowns: number;
  readonly pipeID: string | null;
  readonly supplier: string | null;
  readonly before: PipeLine | null;
  readonly after: PipeLine | null;
  readonly work: { readonly at: string; readonly by: string | null; readonly what: string | null } | null;
  readonly label: HelpLabel;
}

export interface SheetResult {
  readonly ruleVersion: number;
  readonly asOf: string;
  readonly from: string;
  readonly until: string;
  readonly expiresOn: string;
  readonly isDemo: boolean;
  readonly water: { readonly verdict: Verdict; readonly readingAt: string | null; readonly areas: readonly AreaLine[]; readonly offNetwork: readonly string[] };
  readonly food: { readonly verdict: Verdict; readonly lines: readonly FoodLine[]; readonly unreliable: number };
  readonly pipes: readonly PipeLine[];
  readonly lines: readonly MoneyLine[];
  readonly pending: readonly { readonly pipeID: string; readonly at: string; readonly by: string | null; readonly issue: string | null; readonly crowns: number; readonly stillFailing: boolean }[];
  readonly toCheck: readonly PipeLine[];
  readonly deferred: readonly { readonly pipe: PipeLine; readonly crowns: number; readonly total: number; readonly totalOneCart: number }[];
  readonly refused: readonly { readonly key: string; readonly copyNo: string; readonly pipeID: string | null; readonly supplier: string | null }[];
  readonly budget: Budget;
  readonly oneCartBudget: Budget | null;
  readonly options: readonly Option[];
  readonly doubts: readonly Doubt[];
  readonly agenda: { readonly rule: SheetInput['rule']; readonly repairsLastYear: number; readonly urgentRepairs: number };
  readonly help: { readonly copyNo: string; readonly createdAt: string; readonly water: Verdict; readonly food: Verdict; readonly lines: readonly HelpLine[] } | null;
  /** Changes when something the council decides on changes. */
  readonly signature: string;
}

const COVER_DAYS = 7;
const EXPIRY_TIME = '19:00';
const MONDAY = 1;
const NO_PRIORITY = Number.MAX_SAFE_INTEGER;
/** Places where people live or work; they need a supply path. Others only count when they have one. */
const NEEDS_WATER = ['residential', 'bakery', 'farm', 'mill', 'market'];
const TIER_ORDER: Readonly<Record<Tier, number>> = { alarm: 0, unknown: 1, thisWeek: 2, ok: 3 };
const WATER_STATE: Readonly<Record<Tier, WaterState>> = { alarm: 'badlyShort', unknown: 'cantTell', thisWeek: 'runningLow', ok: 'fine' };

const stampFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short' });
/** `yyyy-mm-dd hh:mm` in the village. */
const localStamp = (at: string): string => stampFormat.format(new Date(at));
const dayOf = (at: string): string => localStamp(at).slice(0, 10);
const number = (value: Num): number | null => (value === null ? null : Number(value));
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
const isFailing = (tier: Tier): boolean => tier === 'alarm' || tier === 'thisWeek';

/** The first Monday after this day. */
function nextMonday(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, ((MONDAY - weekday + 6) % 7) + 1);
}

// ---- water ---------------------------------------------------------------------------------

type Pipe = SheetInput['pipes'][number];

/** The pipes from the spring to this pipe, spring first; null when they do not reach the spring. */
function pathTo(last: Pipe, input: SheetInput): Pipe[] | null {
  const springs = new Set(input.landmarks.filter((place) => place.kind === 'spring').map((place) => place.name));
  const path: Pipe[] = [];
  for (let current: Pipe | undefined = last; current && !path.includes(current);) {
    path.unshift(current);
    const from: string | null = current.startPoint;
    if (from !== null && springs.has(from)) return path;
    current = input.pipes.find((pipe) => pipe.endPoint === from && pipe.pipelineType !== 'secondary');
  }
  return null;
}

interface Water {
  readonly pipes: Map<string, PipeLine>;
  readonly areas: readonly AreaLine[];
  readonly paths: Map<string, string[]>;
  readonly offNetwork: readonly string[];
}

function judgeWater(input: SheetInput): Water {
  const route = buildRoute({
    pipes: input.pipes, sensors: input.sensors, repairs: input.repairs, deferrals: [], landmarks: input.landmarks,
  }, new Date(input.now));
  const pipes = new Map<string, PipeLine>();
  for (const pipe of input.pipes) {
    const judged = route.get(pipe.ID);
    if (!judged) continue;
    const readings = input.sensors.filter((sensor) => sensor.pipe_ID === pipe.ID && sensor.lastReading !== null).map((sensor) => sensor.lastReading ?? '');
    pipes.set(pipe.pipeID, {
      pipeID: pipe.pipeID, tier: judged.fields.tier, flow: judged.flow, nominal: number(pipe.nominalFlowRate),
      flowPercent: judged.fields.flowPercent, pressure: judged.pressure, readingAt: readings.sort().at(-1) ?? null,
    });
  }

  const areas: AreaLine[] = [];
  const offNetwork: string[] = [];
  const paths = new Map<string, string[]>();
  for (const place of input.landmarks) {
    const last = place.suppliedBy !== null
      ? input.pipes.find((pipe) => pipe.pipeID === place.suppliedBy)
      : input.pipes.find((pipe) => pipe.endPoint === place.name && pipe.pipelineType !== 'secondary');
    if (place.kind === 'spring' || place.kind === 'forest') continue;
    if (!last && !NEEDS_WATER.includes(place.kind ?? '')) {
      offNetwork.push(place.name);
      continue;
    }
    const path = last ? pathTo(last, input) : null;
    const base = { name: place.name, note: place.serviceNote, priority: place.servicePriority };
    if (!path) {
      areas.push({ ...base, state: 'cantTell', path: [], worst: null, also: [] });
      continue;
    }
    const ids = path.map((pipe) => pipe.pipeID);
    paths.set(place.name, ids);
    // Equally bad: the one nearest the spring.
    const bad = ids.map((id) => pipes.get(id)).filter((pipe): pipe is PipeLine => pipe !== undefined && pipe.tier !== 'ok')
      .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
    const worst = bad[0] ?? null;
    areas.push({ ...base, state: WATER_STATE[worst?.tier ?? 'ok'], path: ids, worst, also: bad.slice(1) });
  }
  const order: Readonly<Record<WaterState, number>> = { badlyShort: 0, cantTell: 1, runningLow: 2, fine: 3 };
  areas.sort((a, b) => order[a.state] - order[b.state] || (a.priority ?? NO_PRIORITY) - (b.priority ?? NO_PRIORITY) || a.name.localeCompare(b.name));
  return { pipes, areas, paths, offNetwork };
}

function waterVerdict(areas: readonly AreaLine[]): Verdict {
  if (areas.some((area) => area.state === 'badlyShort' || area.state === 'runningLow')) return 'notAllRight';
  return areas.some((area) => area.state === 'cantTell') ? 'cantTell' : 'allRight';
}

// ---- food ----------------------------------------------------------------------------------

function forecastInput(product: SheetProduct, today: string, stockAsOf: string): ForecastInput {
  return {
    stock: product.stock, stockAsOf, today, usePerDay: product.usePerDay, marketFactor: product.marketFactor,
    leadDays: product.supplier?.leadDays ?? null, comfort: product.comfort, trusted: product.trusted, openOrderDue: product.order?.dueOn ?? null,
  };
}

/** Stock is only rolled forward from a real count; an old record is read as if it were today's. */
function startDay(product: SheetProduct, today: string): string {
  return product.countedAt !== null ? dayOf(product.stockAsOf ?? product.countedAt) : today;
}

function judgeProduct(product: SheetProduct, today: string): FoodLine {
  const counted = product.countedAt !== null;
  const recordedAt = counted ? (product.stockAsOf ?? product.countedAt) : product.recordedAt;
  const recordedOn = recordedAt === null ? null : dayOf(recordedAt);
  const ageDays = recordedOn === null ? null : Math.max(0, daysBetween(recordedOn, today));
  const start = startDay(product, today);
  const lastsDays = forecast(forecastInput(product, start, start)).daysLeft;
  // Our rule: a figure is too old once the shelf could be empty by now. A delivery on top of a
  // number nobody counted does not make that number reliable.
  const onlyDelivery = !counted && product.stockAsOf !== null;
  const reliable = product.trusted && ageDays !== null && !onlyDelivery && (lastsDays === null || ageDays <= lastsDays);

  const result = forecast(forecastInput(product, today, start));
  const runsOut = result.runsOutOn !== null && daysBetween(today, result.runsOutOn) < COVER_DAYS ? result.runsOutOn : null;
  const order = product.order;
  const late = order !== null && daysBetween(order.dueOn, today) > 0;
  const timingUncertain = runsOut !== null && order !== null && (late || (product.supplier?.isEstimate ?? false));

  let state: FoodState = 'fine';
  if (!product.trusted) state = 'doubtful';
  else if (product.supplier === null) state = 'baked';
  else if (!reliable) state = 'unreliable';
  else if (runsOut !== null) {
    const arrives = order?.dueOn ?? addDays(today, product.supplier.leadDays);
    if (arrives > runsOut) state = 'notAllRight';
    else state = order ? 'atRisk' : 'notYet';
  }
  return {
    id: product.id, name: product.name, unit: product.unit, stock: result.projected ?? product.stock, state, reliable,
    source: recordedOn === null ? 'noDate' : counted ? 'counted' : onlyDelivery ? 'delivery' : 'record',
    recordedOn, countedBy: product.countedBy, ageDays, lastsDays, runsOutOn: runsOut, orderedFor: order?.dueOn ?? null, timingUncertain,
  };
}

function foodVerdict(lines: readonly FoodLine[]): Verdict {
  const has = (...states: FoodState[]): boolean => lines.some((line) => states.includes(line.state));
  if (has('notAllRight')) return 'notAllRight';
  if (has('notYet')) return 'notYet';
  if (has('unreliable', 'doubtful')) return 'cantTell';
  return has('atRisk') ? 'atRisk' : 'allRight';
}

// ---- money ---------------------------------------------------------------------------------

function reportedRepairs(input: SheetInput): SheetRepair[] {
  const now = Date.parse(input.now);
  const since = input.previous ? Date.parse(input.previous.createdAt) : now - COVER_DAYS * 86_400_000;
  return input.repairs.filter((repair) => {
    const at = Date.parse(repair.repairDate ?? '');
    return at > since && at <= now; // a repair dated in the future never happened
  });
}

function repairLines(input: SheetInput, water: Water, repaired: ReadonlySet<string>): MoneyLine[] {
  const placesOf = (pipeID: string): AreaLine[] => water.areas.filter((area) => area.path.includes(pipeID));
  const failing = [...water.pipes.values()].filter((pipe) => isFailing(pipe.tier) && placesOf(pipe.pipeID).length > 0);
  // Counted once: a pipe no worse than a failing pipe before it may just pass on that failure.
  const sameFault = new Map<string, string>();
  for (const pipe of failing) {
    const path = [...water.paths.values()].find((ids) => ids.includes(pipe.pipeID)) ?? [];
    const before = path.slice(0, path.indexOf(pipe.pipeID)).reverse().map((id) => failing.find((item) => item.pipeID === id)).find(Boolean);
    if (before && (pipe.flowPercent ?? 0) >= (before.flowPercent ?? 0)) sameFault.set(pipe.pipeID, before.pipeID);
  }
  const lines = failing.filter((pipe) => !sameFault.has(pipe.pipeID) && !repaired.has(pipe.pipeID)).map((pipe): MoneyLine => {
    const places = placesOf(pipe.pipeID).map(({ name, note, priority }) => ({ name, note, priority }));
    return {
      key: `repair:${pipe.pipeID}`, kind: pipe.tier === 'alarm' ? 'approve' : 'approveIf', crowns: input.costs.repair, evidence: pipe.tier, pipe, places,
      everyone: places.length === water.areas.length,
      checkAfter: [...sameFault].filter(([, upstream]) => upstream === pipe.pipeID).map(([id]) => id),
      supplier: null, products: [], oneCart: null, history: null,
    };
  });
  // Our recommended order: how soon, then everyone before one area, then Maren's people-first order.
  const first = (line: MoneyLine): number => Math.min(...line.places.map((place) => place.priority ?? NO_PRIORITY));
  return lines.sort((a, b) =>
    TIER_ORDER[a.pipe?.tier ?? 'ok'] - TIER_ORDER[b.pipe?.tier ?? 'ok'] || Number(b.everyone) - Number(a.everyone) || first(a) - first(b) || a.key.localeCompare(b.key));
}

/** A contingency, never a fix: nobody knows whether a farm sends emergency carts. */
function cartLines(input: SheetInput, today: string): MoneyLine[] {
  const bySupplier = new Map<string, SheetProduct[]>();
  for (const product of input.products) {
    if (!product.supplier || product.supplier.isEstimate) continue;
    const { risk } = forecast(forecastInput(product, today, startDay(product, today)));
    if (risk !== 'panic' && risk !== 'dontTrust') continue;
    bySupplier.set(product.supplier.id, [...(bySupplier.get(product.supplier.id) ?? []), product]);
  }
  return [...bySupplier].map(([id, products]): MoneyLine => ({
    key: `cart:${id}`, kind: 'reserve', crowns: products.length * input.costs.emergencyFood,
    evidence: products.map((product) => `${product.name}:${product.trusted}`).sort().join(','),
    pipe: null, places: [], everyone: true, checkAfter: [], supplier: products[0].supplier?.name ?? null,
    products: products.map((product) => {
      const result = forecast(forecastInput(product, today, startDay(product, today)));
      return {
        id: product.id, name: product.name, unit: product.unit, doubtful: !product.trusted,
        cartDue: product.trusted ? (product.order?.dueOn ?? result.arrivesOn) : null,
        shortUnder: product.trusted ? null : result.useUntilArrival,
      };
    }),
    oneCart: products.length > 1 ? input.costs.emergencyFood : null, history: null,
  }));
}

function budgetOf(lines: readonly MoneyLine[], pending: number, weekly: number, oneCart: boolean): Budget {
  const of = (kind: MoneyLine['kind']): number => sum(lines.filter((line) => line.kind === kind).map((line) => (oneCart ? (line.oneCart ?? line.crowns) : line.crowns)));
  const [approve, approveIf, buffer, reserve] = [of('approve'), of('approveIf'), of('buffer'), of('reserve')];
  const total = pending + approve + approveIf + buffer + reserve;
  return { weekly, pending, approve, approveIf, buffer, reserve, total, short: Math.max(0, total - weekly), unallocated: Math.max(0, weekly - total) };
}

/** What the council could do about a shortfall; the sheet does not pick one. */
function optionsFor(lines: readonly MoneyLine[], budget: Budget, oneCart: Budget | null, repair: number): Option[] {
  if (budget.short === 0) return [];
  const options: Option[] = [];
  if (oneCart && oneCart.total < budget.total) options.push({ kind: 'askFarm', total: oneCart.total });
  if (budget.buffer > budget.short) options.push({ kind: 'smallerBuffer', crowns: budget.buffer - budget.short, enough: budget.buffer - budget.short >= repair });
  // Already approved money is never a candidate for cuts.
  for (const line of lines) {
    if (line.kind === 'approveIf' && line.pipe && line.history?.decision !== 'yes') options.push({ kind: 'wait', pipeID: line.pipe.pipeID, crowns: line.crowns });
  }
  const reserve = lines.find((line) => line.kind === 'reserve' && line.crowns > budget.short && line.history?.decision !== 'yes');
  if (reserve) options.push({ kind: 'smallerReserve', crowns: reserve.crowns - budget.short, full: reserve.crowns });
  return options.length > 0 ? options : [{ kind: 'sayNo' }];
}

// ---- doubtful numbers ----------------------------------------------------------------------

function doubtsIn(input: SheetInput): Doubt[] {
  const doubts: Doubt[] = input.products.filter((product) => !product.trusted).map((product) => ({
    kind: 'stock', name: product.name, value: product.stock, unit: product.unit, expected: null, date: null, changedBy: product.recordedBy, changedAt: product.recordedAt,
  }));
  for (const sensor of input.sensors) {
    const pipe = input.pipes.find((item) => item.ID === sensor.pipe_ID);
    if (!pipe) continue;
    const differs = (a: number | null, b: number | null): boolean => a !== null && b !== null && a !== b;
    const changed = { name: pipe.pipeID, date: null, changedBy: sensor.modifiedBy, changedAt: sensor.modifiedAt };
    if (differs(number(sensor.flowRate), number(pipe.currentFlowRate))) {
      doubts.push({ ...changed, kind: 'sensor', value: number(sensor.flowRate), unit: 'L/min', expected: number(pipe.currentFlowRate) });
    }
    if (differs(number(sensor.pressure), number(pipe.currentPressure))) {
      doubts.push({ ...changed, kind: 'sensor', value: number(sensor.pressure), unit: 'PSI', expected: number(pipe.currentPressure) });
    }
  }
  for (const repair of input.repairs) {
    if (repair.repairDate === null || Date.parse(repair.repairDate) <= Date.parse(input.now)) continue;
    const pipe = input.pipes.find((item) => item.ID === repair.pipe_ID);
    doubts.push({ kind: 'repair', name: pipe?.pipeID ?? '', value: null, unit: '', expected: null, date: dayOf(repair.repairDate), changedBy: repair.modifiedBy, changedAt: repair.modifiedAt });
  }
  return doubts;
}

// ---- did our money help? -------------------------------------------------------------------

/** Only what was measured after the work; it never claims the money caused it. */
function compareReadings(before: PipeLine, after: PipeLine): HelpLabel {
  if (after.tier === 'ok') return 'back';
  const change = (a: number | null, b: number | null): number => Math.sign((b ?? 0) - (a ?? 0));
  const [flow, pressure] = [change(before.flow, after.flow), change(before.pressure, after.pressure)];
  if (flow + pressure > 0) return 'improved';
  return flow + pressure < 0 ? 'worse' : 'none';
}

function helpLine(line: MoneyLine, input: SheetInput, previous: PreviousCopy, water: Water): HelpLine {
  const base = { key: line.key, kind: line.kind, crowns: line.crowns, pipeID: line.pipe?.pipeID ?? null, supplier: line.supplier, before: null, after: null, work: null };
  const copied = Date.parse(previous.createdAt);
  const expired = localStamp(input.now) >= `${previous.result.expiresOn} ${EXPIRY_TIME}`;
  const since = (at: string | null): boolean => at !== null && Date.parse(at) > copied && Date.parse(at) <= Date.parse(input.now);
  if (line.kind === 'buffer') {
    const approved = new Set(Object.entries(previous.decisions).filter(([, decision]) => decision === 'yes').map(([key]) => key));
    const urgent = reportedRepairs(input).some((repair) => !approved.has(`repair:${input.pipes.find((pipe) => pipe.ID === repair.pipe_ID)?.pipeID}`));
    return { ...base, label: urgent ? 'bufferPending' : expired ? 'released' : 'held' };
  }
  if (line.kind === 'reserve') {
    const ids = line.products.map((product) => product.id);
    const delivery = input.deliveries.filter((item) => ids.includes(item.productId) && since(item.receivedAt)).sort((a, b) => (a.receivedAt ?? '').localeCompare(b.receivedAt ?? ''))[0];
    const name = line.products.find((product) => product.id === delivery?.productId)?.name ?? null;
    return { ...base, work: delivery ? { at: delivery.receivedAt ?? '', by: line.supplier, what: name } : null, label: expired ? 'released' : 'held' };
  }
  const pipe = input.pipes.find((item) => item.pipeID === line.pipe?.pipeID);
  const before = line.pipe;
  const after = (pipe && water.pipes.get(pipe.pipeID)) ?? null;
  const repair = input.repairs.filter((item) => item.pipe_ID === pipe?.ID && since(item.repairDate)).sort((a, b) => (b.repairDate ?? '').localeCompare(a.repairDate ?? ''))[0];
  if (!repair) return { ...base, before, after, label: 'notCompleted' };
  const work = { at: repair.repairDate ?? '', by: repair.repairedBy, what: repair.issue };
  const measured = before && after && after.tier !== 'unknown' && after.readingAt !== null && Date.parse(after.readingAt) > Date.parse(work.at);
  return { ...base, before, after: measured ? after : null, work, label: measured ? compareReadings(before, after) : 'cantTell' };
}

// ---- the sheet -----------------------------------------------------------------------------

export function buildSheet(input: SheetInput): SheetResult {
  const today = dayOf(input.now);
  const water = judgeWater(input);
  const food = input.products.map((product) => judgeProduct(product, today));
  const foodOrder: Readonly<Record<FoodState, number>> = { notAllRight: 0, notYet: 1, doubtful: 2, unreliable: 3, atRisk: 4, baked: 5, fine: 6 };
  food.sort((a, b) => foodOrder[a.state] - foodOrder[b.state] || (a.lastsDays ?? -1) - (b.lastsDays ?? -1) || a.name.localeCompare(b.name));

  const pipeIdOf = (repair: SheetRepair): string => input.pipes.find((pipe) => pipe.ID === repair.pipe_ID)?.pipeID ?? '';
  const reported = reportedRepairs(input);
  const repaired = new Set(reported.map(pipeIdOf));
  // Approved last time and done since: that money is spent, not pending.
  const approvedBefore = new Set(Object.entries(input.previous?.decisions ?? {}).filter(([, decision]) => decision === 'yes').map(([key]) => key));
  const pending = reported.filter((repair) => !approvedBefore.has(`repair:${pipeIdOf(repair)}`)).map((repair) => ({
    pipeID: pipeIdOf(repair), at: repair.repairDate ?? '', by: repair.repairedBy, issue: repair.issue, crowns: input.costs.repair,
    stillFailing: water.pipes.get(pipeIdOf(repair))?.tier !== 'ok',
  }));

  const buffer: MoneyLine = {
    key: 'buffer', kind: 'buffer', crowns: input.costs.repair, evidence: 'weekly', pipe: null, places: [], everyone: false,
    checkAfter: [], supplier: null, products: [], oneCart: null, history: null,
  };
  const withHistory = (line: MoneyLine): MoneyLine => {
    const decision = input.previous?.decisions[line.key];
    if (!input.previous || !decision || line.kind === 'buffer') return line;
    if (line.kind === 'reserve' && decision === 'yes') return line; // it was used or released, this is a new one
    return { ...line, history: { decision, copyNo: input.previous.copyNo, decidedOn: dayOf(input.previous.createdAt) } };
  };
  // A refused line only comes back when the evidence behind it changes.
  const isRefused = (line: MoneyLine): boolean =>
    line.history?.decision === 'no' && input.previous?.result.lines.find((item) => item.key === line.key)?.evidence === line.evidence;
  const all = [...repairLines(input, water, repaired), buffer, ...cartLines(input, today)].map(withHistory);
  const lines = all.filter((line) => !isRefused(line));
  const refused = all.filter(isRefused).map((line) => ({ key: line.key, copyNo: line.history?.copyNo ?? '', pipeID: line.pipe?.pipeID ?? null, supplier: line.supplier }));

  const pendingCrowns = sum(pending.map((item) => item.crowns));
  const budget = budgetOf(lines, pendingCrowns, input.costs.weeklyBudget, false);
  const oneCartBudget = lines.some((line) => line.oneCart !== null) ? budgetOf(lines, pendingCrowns, input.costs.weeklyBudget, true) : null;
  const inUse = new Set([...water.paths.values()].flat());
  const outside = [...water.pipes.values()].filter((pipe) => !inUse.has(pipe.pipeID) && isFailing(pipe.tier) && !repaired.has(pipe.pipeID));

  const readings = water.areas.flatMap((area) => area.path).map((id) => water.pipes.get(id)?.readingAt ?? null);
  const previous = input.previous;
  const verdicts = { water: waterVerdict(water.areas), food: foodVerdict(food) };
  const lastYear = Date.parse(input.now) - 365 * 86_400_000;
  const past = input.repairs.filter((repair) => Date.parse(repair.repairDate ?? '') > lastYear && Date.parse(repair.repairDate ?? '') <= Date.parse(input.now));
  return {
    ruleVersion: RULE_VERSION,
    asOf: input.now,
    from: today,
    until: addDays(today, COVER_DAYS - 1),
    expiresOn: nextMonday(today),
    isDemo: input.isDemo,
    // The oldest reading the verdict rests on.
    water: { verdict: verdicts.water, readingAt: readings.includes(null) ? null : (readings as string[]).sort()[0] ?? null, areas: water.areas, offNetwork: water.offNetwork },
    food: { verdict: verdicts.food, lines: food, unreliable: food.filter((line) => !line.reliable).length },
    pipes: [...water.pipes.values()],
    lines,
    pending,
    toCheck: [...water.pipes.values()].filter((pipe) => pipe.tier === 'unknown' && inUse.has(pipe.pipeID)),
    deferred: outside.map((pipe) => ({
      pipe, crowns: input.costs.repair, total: budget.total + input.costs.repair, totalOneCart: (oneCartBudget ?? budget).total + input.costs.repair,
    })),
    refused,
    budget,
    oneCartBudget,
    options: optionsFor(lines, budget, oneCartBudget, input.costs.repair),
    doubts: doubtsIn(input),
    agenda: { rule: input.rule, repairsLastYear: past.length, urgentRepairs: past.filter((repair) => repair.tierAtRepair === 'alarm').length },
    help: previous && {
      copyNo: previous.copyNo, createdAt: previous.createdAt, water: previous.result.water.verdict, food: previous.result.food.verdict,
      lines: previous.result.lines.filter((line) => previous.decisions[line.key] === 'yes').map((line) => helpLine(line, input, previous, water)),
    },
    signature: JSON.stringify([
      verdicts, water.areas.map((area) => [area.name, area.state]), food.map((line) => [line.name, line.state]),
      lines.map((line) => [line.key, line.crowns, line.evidence]), pending.map((item) => item.pipeID), budget.total,
    ]),
  };
}
