/** Checks the council sheet against the tables of Rowan's plan. Run: npx tsx --test srv/lib/council-sheet.test.ts */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSheet, type Decision, type PreviousCopy, type SheetInput, type SheetProduct } from './council-sheet';

const NOW = '2026-11-24T16:00:00Z';
const FRESH = '2026-11-24T15:58:00Z';
const SYSTEM = { modifiedAt: '2026-11-17T03:13:00Z', modifiedBy: 'system' };
const pipe = (ID: string, startPoint: string, endPoint: string, pipelineType: string, nominalFlowRate: number, currentFlowRate: number, currentPressure: number) =>
  ({ ID, pipeID: ID, startPoint, endPoint, pipelineType, nominalFlowRate, currentFlowRate, currentPressure });
const PIPES = [
  pipe('PRIMARY-MAIN', 'Spring', 'Market', 'mainLine', 150, 142, 58),
  pipe('NORTH-BRANCH-01', 'Market', 'Mill', 'branch', 80, 76, 52),
  pipe('NORTH-BRANCH-02', 'Mill', 'North', 'branch', 65, 20, 22),
  pipe('BAKERY-BRANCH', 'Market', 'Bakery', 'branch', 50, 47, 47),
  pipe('SOUTH-BRANCH', 'Market', 'Farms', 'branch', 60, 40, 38),
  pipe('SECONDARY-LOOP', 'Mill', 'Spring', 'secondary', 40, 12, 20),
];
const sensorsFor = (pipes: typeof PIPES, at = FRESH): SheetInput['sensors'] => pipes.map((p) => ({
  pipe_ID: p.ID, sensorID: p.ID, flowRate: p.ID === 'BAKERY-BRANCH' ? 140 : p.currentFlowRate, pressure: p.currentPressure, lastReading: at,
  ...(p.ID === 'BAKERY-BRANCH' ? SYSTEM : { modifiedAt: null, modifiedBy: 'maren.holt' }),
}));
const place = (name: string, kind: string, suppliedBy: string | null = null, servicePriority: number | null = null, serviceNote: string | null = null) =>
  ({ name, kind, suppliedBy, servicePriority, serviceNote });
const LANDMARKS = [
  place('Spring', 'spring'), place('Mill', 'mill'), place('Market', 'market'), place('Inn', 'inn'),
  place('North', 'residential', 'NORTH-BRANCH-02', 1, 'about 140 families'),
  place('Bakery', 'bakery', 'BAKERY-BRANCH', 2), place('Farms', 'farm', 'SOUTH-BRANCH', 3), place('Forest', 'forest'),
];
const FARM = { id: 'farm', name: 'South Meadow Farms', leadDays: 2, isEstimate: false };
const MILL = { id: 'mill', name: 'North Mill', leadDays: 3, isEstimate: false };
const DAIRY = { id: 'dairy', name: 'Local Dairy Farm', leadDays: 1, isEstimate: false };
const MERCHANT = { id: 'merchant', name: 'Travelling merchant', leadDays: 7, isEstimate: true };
const product = (name: string, stock: number, comfort: number, usePerDay: number, marketFactor: number, supplier: SheetProduct['supplier'], recordedAt: string): SheetProduct => ({
  id: name, name, unit: 'KG', stock, comfort, usePerDay, marketFactor, supplier, order: null, trusted: stock >= 0, recordedAt, recordedBy: 'council',
  stockAsOf: null, countedAt: null, countedBy: null,
});
const PRODUCTS = [
  product('Eggs', 5, 12, 1.5, 1, FARM, '2026-11-16T09:10:00Z'), product('Milk', 180, 120, 60, 2, DAIRY, '2026-11-16T08:40:00Z'),
  product('Flour', 40, 45, 6, 2, MILL, '2026-11-15T11:30:00Z'), product('Butter', -3, 12, 1.5, 1, FARM, '2026-11-17T03:13:00Z'),
  product('Bread', 35, 20, 5, 2, null, '2026-11-13T08:20:00Z'), product('Grain', 45, 30, 4, 1, MILL, '2026-11-03T10:15:00Z'),
  product('Potatoes', 80, 50, 8, 1, MERCHANT, '2026-10-28T13:20:00Z'), product('Apples', 35, 25, 2.5, 1, MERCHANT, '2026-10-21T14:05:00Z'),
  product('Cheese', 12, 8, 1, 1, MERCHANT, '2026-10-09T15:35:00Z'), product('Salt', 15, 10, 0.2, 1, MERCHANT, '2026-09-18T10:50:00Z'),
];
const FUTURE = { pipe_ID: 'SOUTH-BRANCH', issue: 'Replaced valve seal', repairDate: '2026-12-30T10:00:00Z', repairedBy: 'Tobin Reyes', tierAtRepair: null, ...SYSTEM };
const base: SheetInput = {
  now: NOW, pipes: PIPES, sensors: sensorsFor(PIPES), repairs: [FUTURE], landmarks: LANDMARKS, products: PRODUCTS, deliveries: [],
  costs: { repair: 120, emergencyFood: 80, weeklyBudget: 500 }, rule: null, previous: null, isDemo: false,
};
const change = (pipes: Record<string, Partial<(typeof PIPES)[number]>>): typeof PIPES => PIPES.map((p) => ({ ...p, ...pipes[p.ID] }));
const withPipes = (pipes: typeof PIPES, extra: Partial<SheetInput> = {}): SheetInput => ({ ...base, pipes, sensors: sensorsFor(pipes), ...extra });
const counted = (extra: Partial<Record<string, Partial<SheetProduct>>> = {}): SheetProduct[] => PRODUCTS.map((p) => ({
  ...p, stock: p.name === 'Butter' ? 50 : p.stock, trusted: true, stockAsOf: '2026-11-24T05:00:00Z', countedAt: '2026-11-24T05:00:00Z', countedBy: 'Tobin Reyes', ...extra[p.name],
}));
const food = (products: SheetProduct[], now = NOW) => buildSheet({ ...base, products, now }).food;
const repairAt = (pipe_ID: string, repairDate: string) => ({ pipe_ID, issue: 'cracked joint', repairDate, repairedBy: 'Maren Holt', tierAtRepair: 'alarm', modifiedAt: null, modifiedBy: null });
const copy = (decisions: Record<string, Decision>, input: SheetInput = base): PreviousCopy => ({ copyNo: '2026-W48', createdAt: NOW, result: buildSheet(input), decisions });
const ALL_YES: Record<string, Decision> = { 'repair:NORTH-BRANCH-02': 'yes', 'repair:SOUTH-BRANCH': 'yes', buffer: 'yes', 'cart:farm': 'yes' };
const MONDAY = '2026-11-30T18:00:00Z'; // 19:00 in the village

test("water: this week's table", () => {
  const { water } = buildSheet(base);
  assert.equal(water.verdict, 'notAllRight');
  assert.deepEqual(water.areas.map((a) => [a.name, a.state, a.worst?.pipeID ?? null]), [
    ['North', 'badlyShort', 'NORTH-BRANCH-02'], ['Farms', 'runningLow', 'SOUTH-BRANCH'], ['Bakery', 'fine', null], ['Market', 'fine', null], ['Mill', 'fine', null],
  ]);
  assert.deepEqual(water.areas[0].path, ['PRIMARY-MAIN', 'NORTH-BRANCH-01', 'NORTH-BRANCH-02']);
  assert.deepEqual([water.areas[0].worst?.flowPercent, water.areas[0].worst?.pressure], [31, 22]);
  assert.deepEqual(water.offNetwork, ['Inn']);
});

test("food: this week's table", () => {
  const { food: result } = buildSheet(base);
  assert.equal(result.verdict, 'cantTell');
  assert.equal(result.unreliable, 9);
  const line = (name: string) => result.lines.find((item) => item.name === name);
  assert.deepEqual(['Eggs', 'Milk', 'Flour'].map((name) => [line(name)?.ageDays, line(name)?.lastsDays, line(name)?.runsOutOn]),
    [[8, 3.3, '2026-11-27'], [8, 3, '2026-11-26'], [9, 5.7, '2026-11-29']]);
  assert.equal(line('Butter')?.state, 'doubtful');
  assert.deepEqual([line('Salt')?.reliable, line('Salt')?.ageDays], [true, 67]);
  assert.equal(line('Cheese')?.ageDays, 46);
  assert.equal(line('Potatoes')?.runsOutOn, null);
});

test('money: two carts is 520, 20 short; one cart is 440, 60 left', () => {
  const { lines, budget, oneCartBudget, options, deferred } = buildSheet(base);
  assert.deepEqual(lines.map((l) => [l.key, l.kind, l.crowns]), [
    ['repair:NORTH-BRANCH-02', 'approve', 120], ['repair:SOUTH-BRANCH', 'approveIf', 120], ['buffer', 'buffer', 120], ['cart:farm', 'reserve', 160],
  ]);
  assert.deepEqual([budget.total, budget.short, budget.unallocated], [520, 20, 0]);
  assert.deepEqual([oneCartBudget?.total, oneCartBudget?.unallocated], [440, 60]);
  assert.deepEqual(options, [
    { kind: 'askFarm', total: 440 }, { kind: 'smallerBuffer', crowns: 100, enough: false }, { kind: 'wait', pipeID: 'SOUTH-BRANCH', crowns: 120 },
    { kind: 'smallerReserve', crowns: 140, full: 160 },
  ]);
  assert.deepEqual(deferred.map((d) => [d.pipe.pipeID, d.total, d.totalOneCart]), [['SECONDARY-LOOP', 640, 560]]);
  assert.deepEqual(lines[3].products.map((p) => [p.name, p.cartDue, p.shortUnder]), [['Eggs', '2026-11-26', null], ['Butter', null, 3]]);
});

test('doubtful: butter, bakery sensor and the repair in the future', () => {
  assert.deepEqual(buildSheet(base).doubts.map((d) => [d.kind, d.name, d.value, d.date]), [
    ['stock', 'Butter', -3, null], ['sensor', 'BAKERY-BRANCH', 140, null], ['repair', 'SOUTH-BRANCH', null, '2026-12-30'],
  ]);
});

test('the sheet runs to next Monday 19:00', () => {
  const at = (now: string) => buildSheet({ ...base, now });
  assert.deepEqual([at(NOW).from, at(NOW).until, at(NOW).expiresOn], ['2026-11-24', '2026-11-30', '2026-11-30']);
  assert.equal(at('2026-11-30T15:00:00Z').expiresOn, '2026-12-07'); // made on Monday afternoon
  assert.equal(at('2026-11-29T15:00:00Z').expiresOn, '2026-11-30');
});

test('one upstream alarm affects two areas and is repaired once', () => {
  const { water, lines } = buildSheet(withPipes(change({ 'NORTH-BRANCH-01': { currentFlowRate: 16, currentPressure: 20 } })));
  assert.deepEqual(water.areas.filter((a) => a.state === 'badlyShort').map((a) => a.name), ['North', 'Mill']);
  const repairs = lines.filter((l) => l.pipe).map((l) => l.key);
  assert.deepEqual(repairs, ['repair:NORTH-BRANCH-01', 'repair:SOUTH-BRANCH']); // 20% reaches it, 31% is no worse
  assert.deepEqual(lines[0].checkAfter, ['NORTH-BRANCH-02']);
});

test('a clearly worse downstream pipe is a separate fault', () => {
  const { lines } = buildSheet(withPipes(change({ 'NORTH-BRANCH-01': { currentFlowRate: 36, currentPressure: 24 } })));
  assert.deepEqual(lines.filter((l) => l.kind === 'approve').map((l) => l.key), ['repair:NORTH-BRANCH-01', 'repair:NORTH-BRANCH-02'].sort((a, b) => a.localeCompare(b)));
});

test('a failing main line hits everyone and comes first', () => {
  const { lines, water } = buildSheet(withPipes(change({ 'PRIMARY-MAIN': { currentFlowRate: 60 } })));
  assert.equal(lines[0].key, 'repair:PRIMARY-MAIN');
  assert.equal(lines[0].everyone, true);
  assert.equal(water.areas.every((a) => a.state === 'badlyShort'), true);
});

test('a known alarm shows next to a pipe without fresh readings', () => {
  const sensors = base.sensors.map((s) => (s.pipe_ID === 'NORTH-BRANCH-01' ? { ...s, lastReading: '2026-11-24T10:00:00Z' } : s));
  const { water, toCheck } = buildSheet({ ...base, sensors });
  const north = water.areas.find((a) => a.name === 'North');
  assert.deepEqual([north?.state, north?.also.map((p) => p.pipeID)], ['badlyShort', ['NORTH-BRANCH-01']]);
  assert.equal(water.areas.find((a) => a.name === 'Mill')?.state, 'cantTell');
  assert.deepEqual(toCheck.map((p) => p.pipeID), ['NORTH-BRANCH-01']);
});

test('only stale readings: cannot tell, and no money', () => {
  const healthy = change({ 'NORTH-BRANCH-02': { currentFlowRate: 60, currentPressure: 50 }, 'SOUTH-BRANCH': { currentFlowRate: 58, currentPressure: 50 } });
  const result = buildSheet({ ...base, pipes: healthy, sensors: sensorsFor(healthy, '2026-11-24T10:00:00Z') });
  assert.equal(result.water.verdict, 'cantTell');
  assert.deepEqual(result.lines.filter((l) => l.pipe), []);
  assert.equal(buildSheet(withPipes(healthy)).water.verdict, 'allRight');
});

test('a missing supply path is "can\'t tell"', () => {
  const landmarks = LANDMARKS.map((l) => (l.name === 'Farms' ? { ...l, suppliedBy: 'GONE' } : l));
  const farms = buildSheet({ ...base, landmarks }).water.areas.find((a) => a.name === 'Farms');
  assert.deepEqual([farms?.state, farms?.path], ['cantTell', []]);
});

test('the bakery sensor never reaches the verdict', () => {
  assert.equal(buildSheet(base).water.areas.find((a) => a.name === 'Bakery')?.state, 'fine');
});

test('a full stocktake gives a firm food verdict', () => {
  const result = food(counted());
  assert.equal(result.unreliable, 0);
  assert.equal(result.verdict, 'notYet');
  assert.deepEqual(result.lines.filter((l) => l.state === 'notYet').map((l) => l.name).sort(), ['Eggs', 'Flour', 'Milk']);
  assert.equal(food(counted({ Eggs: { stock: 50 }, Milk: { stock: 900 }, Flour: { stock: 200 } })).verdict, 'allRight');
});

test('an order on its way: at risk until delivery; too late: not all right', () => {
  const plenty = { Milk: { stock: 900 }, Flour: { stock: 200 } };
  assert.equal(food(counted({ ...plenty, Eggs: { order: { quantity: 21, dueOn: '2026-11-26' } } })).verdict, 'atRisk');
  assert.equal(food(counted({ ...plenty, Eggs: { order: { quantity: 21, dueOn: '2026-11-28' } } })).verdict, 'notAllRight');
  assert.equal(food(counted({ ...plenty, Eggs: { stock: 1 } })).verdict, 'notAllRight'); // two days is too slow
});

test('unknown delivery timing stays visible', () => {
  const lines = food(counted({ Cheese: { stock: 5, order: { quantity: 10, dueOn: '2026-11-27' } } })).lines;
  assert.deepEqual([lines.find((l) => l.name === 'Cheese')?.state, lines.find((l) => l.name === 'Cheese')?.timingUncertain], ['atRisk', true]);
  const late = food(counted({ Eggs: { order: { quantity: 21, dueOn: '2026-11-23' } } })).lines.find((l) => l.name === 'Eggs');
  assert.equal(late?.timingUncertain, true);
});

test('figures without a date, too old, or only a delivery are not reliable', () => {
  const of = (extra: Partial<SheetProduct>) => food([{ ...PRODUCTS[9], ...extra }]).lines[0];
  assert.deepEqual([of({ recordedAt: null }).reliable, of({ recordedAt: null }).source], [false, 'noDate']);
  assert.deepEqual([of({ stockAsOf: NOW, recordedAt: NOW }).reliable, of({ stockAsOf: NOW, recordedAt: NOW }).source], [false, 'delivery']);
  const old = food(counted(), '2026-12-01T16:00:00Z').lines.find((l) => l.name === 'Eggs');
  assert.deepEqual([old?.reliable, old?.state], [false, 'unreliable']); // a count expires too
});

test('counted butter leaves the reserve with one cart for the eggs', () => {
  const result = buildSheet({ ...base, products: counted() });
  assert.equal(result.lines.find((l) => l.key === 'cart:farm')?.crowns, 80);
  assert.deepEqual([result.budget.total, result.budget.unallocated, result.oneCartBudget, result.options], [440, 60, null, []]);
});

test('a repair Maren already reported is pending, not approved', () => {
  const result = buildSheet({ ...base, repairs: [FUTURE, repairAt('NORTH-BRANCH-02', '2026-11-24T10:00:00Z')] });
  assert.deepEqual(result.pending.map((p) => [p.pipeID, p.crowns, p.stillFailing]), [['NORTH-BRANCH-02', 120, true]]);
  assert.equal(result.lines.some((l) => l.key === 'repair:NORTH-BRANCH-02'), false);
  assert.deepEqual([result.budget.pending, result.budget.approve, result.budget.total], [120, 0, 520]);
  assert.equal(result.options.some((o) => o.kind === 'sayNo'), false);
});

test('later comes back marked; no stays away until the evidence changes', () => {
  const later = buildSheet({ ...base, previous: copy({ 'cart:farm': 'later' }) });
  assert.deepEqual(later.lines.find((l) => l.key === 'cart:farm')?.history, { decision: 'later', copyNo: '2026-W48', decidedOn: '2026-11-24' });
  const no = buildSheet({ ...base, previous: copy({ 'repair:SOUTH-BRANCH': 'no', buffer: 'no' }) });
  assert.deepEqual(no.refused.map((r) => r.key), ['repair:SOUTH-BRANCH']);
  assert.equal(no.lines.some((l) => l.key === 'buffer'), true);
  const worse = change({ 'SOUTH-BRANCH': { currentFlowRate: 20 } });
  assert.equal(buildSheet(withPipes(worse, { previous: copy({ 'repair:SOUTH-BRANCH': 'no' }) })).lines.some((l) => l.key === 'repair:SOUTH-BRANCH'), true);
});

test('a repair approved but not done keeps its mark and is not offered for cuts; a reserve starts anew', () => {
  const result = buildSheet({ ...base, previous: copy(ALL_YES) });
  assert.equal(result.lines.find((l) => l.key === 'repair:SOUTH-BRANCH')?.history?.decision, 'yes');
  assert.equal(result.lines.find((l) => l.key === 'cart:farm')?.history, null);
  assert.equal(result.options.some((o) => o.kind === 'wait'), false);
});

test('did our money help: the first sheet has nothing to compare', () => {
  assert.equal(buildSheet(base).help, null);
});

test('did our money help: measured after the work', () => {
  const label = (north: Partial<(typeof PIPES)[number]>, repairs = [FUTURE, repairAt('NORTH-BRANCH-02', '2026-11-24T18:00:00Z')], lastReading = '2026-11-30T17:58:00Z') => {
    const pipes = change({ 'NORTH-BRANCH-02': north });
    const result = buildSheet({ ...base, now: MONDAY, pipes, sensors: sensorsFor(pipes, lastReading), repairs, previous: copy(ALL_YES) });
    return result.help?.lines.find((l) => l.key === 'repair:NORTH-BRANCH-02')?.label;
  };
  assert.equal(label({ currentFlowRate: 60, currentPressure: 51 }), 'back');
  assert.equal(label({ currentFlowRate: 32, currentPressure: 24 }), 'improved');
  assert.equal(label({}), 'none');
  assert.equal(label({ currentFlowRate: 10 }), 'worse');
  assert.equal(label({}, [FUTURE]), 'notCompleted');
  assert.equal(label({}, undefined, '2026-11-24T17:00:00Z'), 'cantTell');
});

test('did our money help: an expired reserve is released, and approved work is not pending', () => {
  const at = (now: string) => buildSheet({ ...base, now, repairs: [FUTURE, repairAt('NORTH-BRANCH-02', '2026-11-24T18:00:00Z')], previous: copy(ALL_YES) });
  const labels = (now: string) => at(now).help?.lines.filter((l) => l.kind === 'reserve' || l.kind === 'buffer').map((l) => l.label);
  assert.deepEqual(labels('2026-11-26T18:00:00Z'), ['held', 'held']);
  assert.deepEqual(labels('2026-11-30T17:59:00Z'), ['held', 'held']);
  assert.deepEqual(labels(MONDAY), ['released', 'released']);
  assert.deepEqual(at(MONDAY).pending, []);
});

test('did our money help: only the Yes lines are followed', () => {
  assert.deepEqual(buildSheet({ ...base, now: MONDAY, previous: copy({ buffer: 'yes', 'cart:farm': 'later' }) }).help?.lines.map((l) => l.key), ['buffer']);
});

test('the signature only changes when something to decide on changes', () => {
  const same = buildSheet({ ...base, now: '2026-11-24T16:05:00Z', sensors: sensorsFor(PIPES, '2026-11-24T16:04:00Z') });
  assert.equal(same.signature, buildSheet(base).signature);
  assert.notEqual(buildSheet({ ...base, products: counted() }).signature, buildSheet(base).signature);
});
