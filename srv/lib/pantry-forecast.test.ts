/** Checks the forecast against the tables of Tobin's plan. Run: npx tsx --test srv/lib/pantry-forecast.test.ts */
import assert from 'node:assert/strict';
import test from 'node:test';
import { forecast, type Forecast, type ForecastInput } from './pantry-forecast';

const base = { today: '2026-11-24', stockAsOf: '2026-11-24', trusted: true, openOrderDue: null };
const run = (stock: number, comfort: number, usePerDay: number, marketFactor: number, leadDays: number | null, extra: Partial<ForecastInput> = {}): Forecast =>
  forecast({ ...base, stock, comfort, usePerDay, marketFactor, leadDays, ...extra });

// name, result, risk, days left, order on, arrives, quantity, on arrival, gap, runs out, below on, panic on
const rows: [string, Forecast, ...(string | number | null)[]][] = [
  ['eggs', run(5, 12, 1.5, 1, 2), 'panic', 3.3, '2026-11-24', '2026-11-26', 21, 2, 10, '2026-11-27', null, null],
  ['flour', run(40, 45, 6, 2, 3), 'belowComfort', 5.7, '2026-11-24', '2026-11-27', 71, 22, 23, '2026-11-29', null, '2026-11-27'],
  ['potatoes', run(80, 50, 8, 1, 7), 'orderDue', 10, '2026-11-24', '2026-12-01', 82, 24, 26, '2026-12-03', '2026-11-28', '2026-12-01'],
  ['apples', run(35, 25, 2.5, 1, 7), 'orderDue', 14, '2026-11-24', '2026-12-01', 25, 17.5, 7.5, '2026-12-07', '2026-11-29', '2026-12-04'],
  ['cheese', run(12, 8, 1, 1, 7), 'orderDue', 12, '2026-11-24', '2026-12-01', 10, 5, 3, '2026-12-05', '2026-11-29', '2026-12-03'],
  ['milk', run(180, 120, 60, 2, 1), 'orderDue', 3, '2026-11-24', '2026-11-25', 480, 120, 0, '2026-11-26', '2026-11-26', '2026-11-27'],
  ['grain', run(45, 30, 4, 1, 3), 'orderDue', 11.3, '2026-11-24', '2026-11-27', 25, 33, 0, '2026-12-05', '2026-11-28', '2026-12-02'],
  ['salt', run(15, 10, 0.2, 1, 7), 'ok', 75, '2026-12-12', '2026-12-19', 2, 10, 0, '2027-02-06', '2026-12-20', '2027-01-14'],
  ['bread', run(35, 20, 5, 2, null), 'ok', 6, null, null, null, null, null, '2026-11-29', '2026-11-28', '2026-11-29'],
];

for (const [name, f, ...expected] of rows) {
  test(name, () => {
    assert.deepEqual(
      [f.risk, f.daysLeft, f.orderOn, f.arrivesOn, f.orderQuantity, f.arrivalStock, f.arrivalGap, f.runsOutOn, f.belowOn, f.panicOn],
      expected,
    );
  });
}

test('flour covers market Saturday', () => {
  const f = run(40, 45, 6, 2, 3);
  assert.deepEqual([f.weekUse, f.target, f.marketDay, f.useUntilArrival], [48, 93, '2026-11-28', 18]);
});

test('butter: an untrusted number is never used', () => {
  const f = run(-3, 12, 1.5, 1, 2, { trusted: false });
  assert.deepEqual([f.risk, f.daysLeft, f.projected, f.orderQuantity], ['dontTrust', null, null, 23]);
  assert.equal(run(1, 12, 1.5, 1, 2).orderQuantity, 23);
});

test('rolls forward from the count, Saturday double', () => {
  assert.equal(run(40, 45, 6, 2, 3, { stockAsOf: '2026-11-24', today: '2026-11-29' }).projected, 4);
});

test('open orders', () => {
  assert.equal(run(5, 12, 1.5, 1, 2, { openOrderDue: '2026-11-24' }).orderState, 'placed');
  assert.equal(run(5, 12, 1.5, 1, 2, { openOrderDue: '2026-11-23' }).orderState, 'late');
});

test('empty and oversupplied stock', () => {
  assert.equal(run(0, 12, 1.5, 1, 2).daysLeft, 0);
  assert.equal(run(-10, 12, 1.5, 1, 2).orderQuantity, 23);
});
