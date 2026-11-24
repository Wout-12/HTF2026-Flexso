/** Checks the Ledger against the repo's own seed data and Ilse's plan. Run: npx tsx --test srv/lib/ledger-scan.test.ts */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isAsking, scanLedger, type ScanInput } from './ledger-scan';
import { buildTimeline } from './ledger-timeline';

/** Small CSV reader: enough for the seed files (quoted fields, no line breaks). */
function rows<T>(entity: string): T[] {
  const [head, ...lines] = readFileSync(path.join(__dirname, `../../db/data/oakhaven.curse-${entity}.csv`), 'utf8').trim().split(/\r?\n/);
  const cells = (line: string): string[] => [...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((match) => match[2] ?? match[1]);
  return lines.map((line) => Object.fromEntries(head.split(',').map((name, i) => [name, cells(line)[i] || null])) as T);
}
const NOW = '2026-11-24T12:00:00Z';
const seed: ScanInput = {
  pipes: rows('WaterPipes'), sensors: rows<ScanInput['sensors'][number]>('Sensors').map((s) => ({ ...s, lastReading: '2026-11-24T11:59:50Z' })),
  repairs: rows('Repairs'), stock: rows('StockItems'), landmarks: rows('Landmarks'),
};
const found = scanLedger(seed, NOW);
const sensorCase = (extra: Partial<ScanInput['sensors'][number]>) => scanLedger({ ...seed, sensors: seed.sensors.map((s) => (s.sensorID === 'SENS-001' ? { ...s, ...extra } : s)) }, NOW)
  .find((f) => f.evidence.name === 'SENS-001');
const eggs = (extra: Record<string, unknown>) => scanLedger({ ...seed, stock: seed.stock.map((s) => (s.name === 'Eggs' ? { ...s, ...extra } : s)) }, NOW).find((f) => f.evidence.name === 'Eggs');

test('3 sure findings in one linked case', () => {
  const sure = found.filter((f) => f.level === 'sure');
  assert.deepEqual(sure.map((f) => f.evidence.name), ['SENS-004', 'Butter', 'Replaced valve seal at the meadow junction']);
  assert.deepEqual(new Set(sure.map((f) => f.group)).size, 1);
  assert.deepEqual(sure[0].reasons, ['impossibleFlow', 'contradiction', 'nightChanged', 'notPerson', 'outsideCreated']);
  assert.deepEqual(sure[1].reasons, ['negativeStock', 'nightChanged', 'notPerson']);
  assert.deepEqual(sure[2].reasons, ['futureRepair', 'attribution', 'nightCreated', 'notPerson']);
  assert.deepEqual([sure[0].evidence.sensorFlow, sure[0].evidence.pipeFlow, sure[0].evidence.reference, sure[0].evidence.tolerance, sure[0].evidence.changedAlone], [140, 47, 50, 10, 5]);
});

test('19 records worth asking about, one of them also sure', () => {
  const asking = found.filter((f) => isAsking(f.reasons));
  assert.equal(asking.length, 19);
  assert.equal(asking.filter((f) => f.level === 'sure').length, 1);
  const size = (group: string) => found.filter((f) => f.group === group).length;
  assert.deepEqual(['W1', 'W2', 'W3', 'W4', 'W5', 'confirm', 'other'].map(size), [4, 4, 5, 3, 2, 0, 0]);
});

test('a stale sensor is not compared', () => {
  const stale = { ...seed, sensors: seed.sensors.map((s) => ({ ...s, lastReading: '2026-11-24T11:40:00Z' })) };
  assert.equal(scanLedger(stale, NOW).some((f) => f.reasons.includes('contradiction')), false);
});

test('exactly a fifth apart is not a contradiction, a bit more is', () => {
  assert.equal(sensorCase({ flowRate: 112 })?.reasons.includes('contradiction'), false); // 142 - 112 = 30 = 20% of 150
  assert.equal(sensorCase({ flowRate: 111.9 })?.reasons.includes('contradiction'), true);
  assert.equal(sensorCase({ flowRate: 300 })?.reasons.includes('impossibleFlow'), false); // exactly double
  assert.equal(sensorCase({ flowRate: 301 })?.reasons.includes('impossibleFlow'), true);
});

test('night is 00:00 to 03:59', () => {
  const at = (modifiedAt: string) => eggs({ modifiedAt, modifiedBy: 'tobin.reyes' })?.reasons.includes('nightChanged') ?? false;
  assert.deepEqual(['2026-11-20T23:59:00Z', '2026-11-20T00:00:00Z', '2026-11-20T03:59:00Z', '2026-11-20T04:00:00Z'].map(at), [false, true, true, false]);
});

test('names: aliases are one person, council is known, anything else is not a person', () => {
  const by = (modifiedBy: string) => eggs({ modifiedBy })?.reasons ?? [];
  assert.deepEqual(by('tobin'), []);
  assert.deepEqual(by('maren'), ['outsideChanged']);
  assert.deepEqual(by('council'), ['outsideChanged']);
  assert.deepEqual(by('anonymous'), ['notPerson']);
});

test('a future repair by a villager only needs confirmation; a repairer who differs is no reason by itself', () => {
  const repair = { ...seed.repairs[0], repairDate: '2026-12-01T10:00:00Z', repairedBy: 'Tobin Reyes' };
  const [finding] = scanLedger({ ...seed, repairs: [repair] }, NOW).filter((f) => f.recordType === 'Repair');
  assert.deepEqual([finding.reasons, finding.level, finding.group], [['futureRepair'], 'ask', 'confirm']);
});

test('negative flow and different pressure are not judged', () => {
  assert.equal(sensorCase({ flowRate: 142, pressure: -5 })?.reasons.some((r) => r === 'impossibleFlow' || r === 'contradiction'), false);
});

test('corrected butter is clean; a corrected value that breaks a rule gets its own key', () => {
  const butter = (currentQuantity: number, modifiedAt: string) => scanLedger({ ...seed, stock: seed.stock.map((s) => (s.name === 'Butter' ? { ...s, currentQuantity, modifiedAt, modifiedBy: 'tobin.reyes' } : s)) }, NOW).find((f) => f.evidence.name === 'Butter');
  assert.equal(butter(2, '2026-11-24T10:00:00Z'), undefined);
  assert.notEqual(butter(-1, '2026-11-24T10:00:00Z')?.key, found.find((f) => f.evidence.name === 'Butter')?.key);
});

test('scanning twice gives the same keys', () => {
  assert.deepEqual(scanLedger(seed, NOW).map((f) => f.key), found.map((f) => f.key));
  assert.equal(new Set(found.map((f) => f.key)).size, found.length);
});

test('timeline: 60 moments, all odd ones in one minute, the last thing written', () => {
  const { moments, inner, odd } = buildTimeline(seed, []);
  assert.equal(moments.length, 60);
  assert.deepEqual(inner.map((i) => i.at.slice(0, 10)).sort(), ['2024-12-21', '2026-12-30']);
  assert.deepEqual([odd.count, odd.minutes, odd.writtenAfter, odd.first], [3, 0, 0, '2026-11-17T03:13:00.000Z']);
});

test('timeline: the log keeps a moment the record no longer shows', () => {
  const at = '2026-11-24T10:00:00.000Z';
  const butter = seed.stock.find((s) => s.name === 'Butter');
  const changed = { ...seed, stock: seed.stock.map((s) => (s === butter ? { ...s, modifiedAt: at, modifiedBy: 'tobin.reyes' } : s)) };
  const log = [{ recordType: 'StockItem', recordId: butter?.ID ?? '', oldVersion: '2026-11-17T03:13:00Z', oldWriter: 'system', changedAt: at, changedBy: 'tobin.reyes', newVersion: at }];
  const { moments, odd } = buildTimeline(changed, log);
  assert.equal(moments.length, 61);
  assert.deepEqual([odd.count, odd.writtenAfter], [3, 1]);
});
