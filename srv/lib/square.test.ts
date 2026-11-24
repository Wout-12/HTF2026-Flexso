/** Checks the village square, above all what it must never say. Run: npx tsx --test srv/lib/square.test.ts */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { AreaLine, Decision, FoodLine, MoneyLine, PipeLine, SheetResult, Verdict, WaterState } from './council-sheet';
import { buildSquare, fraction, type SquareInput } from './square';

const pipe = (pipeID: string, tier: PipeLine['tier'], flowPercent: number): PipeLine => ({ pipeID, tier, flow: 20, nominal: 65, flowPercent, pressure: 22, readingAt: '2026-11-24T15:58:00Z' });
const area = (name: string, state: WaterState, path: string[], worst: PipeLine | null = null): AreaLine => ({ name, note: null, priority: 1, state, path, worst, also: [] });
const NORTH = area('North Residential Area', 'badlyShort', ['PRIMARY-MAIN', 'NORTH-BRANCH-02'], pipe('NORTH-BRANCH-02', 'alarm', 31));
const FARMS = area('South Meadow Farms', 'runningLow', ['PRIMARY-MAIN', 'SOUTH-BRANCH'], pipe('SOUTH-BRANCH', 'thisWeek', 67));
const FINE = [area('The Bakery', 'fine', ['PRIMARY-MAIN', 'BAKERY-BRANCH']), area('North Mill House', 'fine', ['PRIMARY-MAIN']), area('Central Market Square', 'fine', ['PRIMARY-MAIN'])];
const line = (extra: Partial<MoneyLine>): MoneyLine => ({ key: 'k', kind: 'approve', crowns: 120, evidence: '', pipe: null, places: [{ name: 'North Residential Area', note: null, priority: 1 }], everyone: false, checkAfter: [], supplier: null, products: [], oneCart: null, history: null, ...extra });
const food = (name: string, extra: Partial<FoodLine> = {}): FoodLine => ({ id: name, name, unit: 'KG', stock: -3, state: 'unreliable', reliable: false, source: 'record', recordedOn: '2026-11-16', countedBy: null, ageDays: 8, lastsDays: 3, runsOutOn: null, orderedFor: null, timingUncertain: false, ...extra });
const sheet = (areas: AreaLine[], verdict: Verdict, lines: FoodLine[] = [food('Eggs'), food('Butter')]): SheetResult =>
  ({ water: { verdict: 'allRight', readingAt: null, areas, offNetwork: [] }, food: { verdict, lines, unreliable: 0 }, isDemo: false } as unknown as SheetResult);
const base: SquareInput = {
  now: '2026-11-24T16:00:00Z', sheet: sheet([NORTH, FARMS, ...FINE], 'cantTell'), jobSlots: { 'NORTH-BRANCH-02': 1, 'SOUTH-BRANCH': 2 },
  repairs: [], deliveries: [], orders: [], panic: [], decided: null, notices: [],
};
const texts = (extra: Partial<SquareInput> = {}): string[] => buildSquare({ ...base, ...extra }).news.map((item) => item.text);
const mood = (areas: AreaLine[], verdict: Verdict, extra: Partial<SquareInput> = {}): string => buildSquare({ ...base, sheet: sheet(areas, verdict), ...extra }).mood;
const BUTTER = { recordType: 'StockItem', name: 'Butter', pipeID: null, cleared: false };

test("today's weather", () => {
  const { mood: today, sentence } = buildSquare(base);
  assert.equal(today, 'storm');
  assert.equal(sentence, "Stormy. North Residential is badly short on water, and South Meadow Farms is running low on water. We can't be sure about food until Tobin's recount.");
});

test("today's news", () => {
  assert.deepEqual(texts(), [
    "North Residential is getting about a third of its usual water. It's first on Maren's route today.",
    'South Meadow Farms is getting about two-thirds of its usual water. Maren plans a visit this week.',
    'Full water today at the Bakery, North Mill House and Central Market Square.',
    "We can't tell about food yet. Most pantry counts are over a week old, so Tobin needs to count again.",
    'Market day this Saturday, 28 November. Expect a busy bakery.',
    "The council meets on Monday 30 November at 7pm at Shepherd's Inn.",
    'An old line in the repair book is signed only "W. S.", from the longest night of 2024. The library would like to know who wrote it.',
  ]);
});

test('weather: the worst rule wins', () => {
  assert.equal(mood(FINE, 'notAllRight'), 'storm');
  assert.equal(mood([FARMS, ...FINE], 'allRight'), 'rain');
  assert.equal(mood(FINE, 'notYet'), 'rain');
  assert.equal(mood(FINE, 'atRisk'), 'rain');
  assert.equal(mood(FINE, 'allRight'), 'sunny');
});

test('weather: never sunny without proof', () => {
  assert.equal(mood(FINE, 'cantTell'), 'cloudy');
  assert.equal(mood([area('The Bakery', 'cantTell', [])], 'allRight'), 'cloudy');
  assert.equal(mood(FINE, 'allRight', { notices: [BUTTER] }), 'cloudy');
  assert.equal(mood(FINE, 'allRight', { notices: [{ ...BUTTER, cleared: true }] }), 'sunny');
});

test('fractions', () => {
  assert.deepEqual([25, 31, 40, 55, 67, 70, 85, 86].map(fraction), ['a quarter', 'a third', 'a third', 'half', 'two-thirds', 'two-thirds', 'three-quarters', null]);
});

test('repairs: readings beat the log, old and future ones are no news, nor is the backup loop', () => {
  const at = (pipeID: string, when: string, by: string | null = 'Maren') => ({ pipeID, at: when, by });
  assert.ok(texts({ repairs: [at('NORTH-BRANCH-02', '2026-11-24T10:00:00Z')] }).includes("Maren worked on North Branch 02 today. The water isn't back to normal yet."));
  const fixed = sheet([{ ...NORTH, state: 'fine', worst: null }, FARMS], 'cantTell');
  assert.ok(texts({ sheet: fixed, repairs: [at('NORTH-BRANCH-02', '2026-11-24T10:00:00Z')] }).includes("Water is back to normal at North Residential after Maren's repair today."));
  assert.ok(texts({ sheet: fixed, repairs: [at('NORTH-BRANCH-02', '2026-11-23T10:00:00Z', null)] }).includes('Water is back to normal at North Residential after a repair yesterday.'));
  const none = [at('SOUTH-BRANCH', '2026-12-30T10:00:00Z'), at('PRIMARY-MAIN', '2026-11-10T10:00:00Z'), at('SECONDARY-LOOP', '2026-11-24T10:00:00Z')];
  assert.deepEqual(texts({ repairs: none }), texts());
});

test('bakery: deliveries, orders, scarce, market day', () => {
  const delivery = (product: string, at: string) => ({ product, supplier: 'South Meadow Farms', at });
  const news = texts({ deliveries: [delivery('Eggs', '2026-11-24T07:00:00Z'), delivery('Butter', '2026-11-24T07:00:00Z'), delivery('Milk', '2026-11-20T07:00:00Z')], orders: [{ product: 'Eggs', supplier: 'South Meadow Farms', dueOn: '2026-11-26' }] });
  assert.ok(news.includes('Fresh eggs and butter arrived from South Meadow Farms today.'));
  assert.ok(news.includes('Eggs are on order from South Meadow Farms, due on Thursday.'));
  assert.equal(news.some((text) => text.includes('milk')), false);
  const counted = sheet(FINE, 'notYet', [food('Eggs', { reliable: true, state: 'notYet' })]);
  assert.ok(texts({ sheet: counted, panic: ['Eggs'] }).includes('Eggs will be scarce until the next delivery.'));
  assert.equal(texts({ panic: ['Eggs'] }).some((text) => text.includes('scarce')), false); // not a reliable count
  assert.ok(texts({ now: '2026-11-27T10:00:00Z' }).includes('Market day tomorrow! Expect a busy bakery.'));
});

test('council: only what got a Yes, and only this week', () => {
  const decisions: Record<string, Decision> = { a: 'yes', b: 'no', c: 'later', d: 'yes' };
  const lines = [line({ key: 'a' }), line({ key: 'b', crowns: 111 }), line({ key: 'c', crowns: 222 }), line({ key: 'd', kind: 'reserve', crowns: 160, supplier: 'South Meadow Farms' }), line({ key: 'e', crowns: 333 })];
  const news = texts({ decided: { at: '2026-11-24T12:00:00Z', lines, decisions } }).filter((text) => text.includes('crowns'));
  assert.deepEqual(news, ['The council set aside about 120 crowns to repair the pipe to North Residential.', "The council set aside about 160 crowns for an emergency food cart from South Meadow Farms, if it's needed."]);
  assert.equal(texts({ decided: { at: '2026-11-10T12:00:00Z', lines, decisions } }).some((text) => text.includes('crowns')), false);
  assert.ok(texts({ now: '2026-11-30T10:00:00Z' }).includes("The council meets tonight at 7pm at Shepherd's Inn."));
});

test('library: what Ilse decided, without why or who', () => {
  const news = texts({ notices: [BUTTER, { recordType: 'Sensor', name: 'SENS-004', pipeID: 'BAKERY-BRANCH', cleared: false }, { recordType: 'Repair', name: 'x', pipeID: 'SOUTH-BRANCH', cleared: true }] });
  assert.ok(news.includes("Don't rely on the butter count for now. The library is checking it."));
  assert.ok(news.includes("Don't rely on the water meter on Bakery Branch for now. The library is checking it."));
  assert.ok(news.includes('The library has finished checking the repair record for South Branch.'));
});

test('nothing private leaks', () => {
  const full = JSON.stringify(buildSquare({
    ...base, notices: [BUTTER, { recordType: 'Sensor', name: 'SENS-004', pipeID: 'BAKERY-BRANCH', cleared: false }], repairs: [{ pipeID: 'NORTH-BRANCH-02', at: '2026-11-24T10:00:00Z', by: 'Maren' }],
    decided: { at: '2026-11-24T12:00:00Z', lines: [line({ key: 'a' })], decisions: { a: 'yes' } },
  }));
  for (const word of ['system', '03:13', 'tamper', 'PSI', 'L/min', '31%', '-3', 'SENS-', 'anonymous', 'Holt', 'Reyes', 'reveal', 'L3Jl', 'door', '500']) assert.equal(full.includes(word), false, word);
});
