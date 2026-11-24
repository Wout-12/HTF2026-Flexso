/** Reads the records the Ledger looks at, stores what the scan finds, and tells the other apps what to flag. */
import { randomUUID } from 'node:crypto';
import { scanLedger, stamp, type Finding, type ScanInput } from './ledger-scan';

type Row = Record<string, unknown>;

interface Query extends PromiseLike<unknown> { where(predicate: Row): Query }
/** The slice of the `cds` facade this file uses. */
interface CdsApi {
  readonly ql: {
    readonly SELECT: { from(entity: string): { columns(...columns: readonly string[]): Query } };
    readonly INSERT: { into(entity: string): { entries(rows: Row | readonly Row[]): PromiseLike<unknown> } };
    UPDATE(entity: string): { with(data: Row): { where(predicate: Row): PromiseLike<unknown> } };
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT, INSERT, UPDATE } = cds.ql;
const DB = 'oakhaven.curse';
const WRITTEN = ['ID', 'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy'];

export async function readRecords(): Promise<ScanInput> {
  const read = async <T>(entity: string, ...columns: string[]): Promise<T[]> => (await SELECT.from(`${DB}.${entity}`).columns(...WRITTEN, ...columns)) as T[];
  return {
    pipes: await read('WaterPipes', 'pipeID', 'nominalFlowRate', 'currentFlowRate', 'currentPressure'),
    sensors: await read('Sensors', 'sensorID', 'pipe_ID', 'flowRate', 'pressure', 'lastReading'),
    repairs: await read('Repairs', 'pipe_ID', 'issue', 'repairDate', 'repairedBy'),
    stock: await read('StockItems', 'itemID', 'name', 'unit', 'currentQuantity'),
    landmarks: await read('Landmarks', 'name'),
  };
}

const keyOf = (row: { recordType: string; recordId: string; field: string; observedVersion: string }): string =>
  [row.recordType, row.recordId, row.field, stamp(row.observedVersion)].join('|');

/** Stores new findings. A finding that is already known keeps its status; scanning twice changes nothing. */
export async function storeScan(): Promise<number> {
  const found = scanLedger(await readRecords(), new Date().toISOString());
  const known = (await SELECT.from(`${DB}.Findings`).columns('ID', 'recordType', 'recordId', 'field', 'observedVersion', 'reasons', 'reviewStatus')) as
    { ID: string; recordType: string; recordId: string; field: string; observedVersion: string; reasons: string; reviewStatus: string }[];
  const byKey = new Map(known.map((row) => [keyOf(row), row]));
  const toRow = (finding: Finding): Row => ({
    ID: randomUUID(), recordType: finding.recordType, recordId: finding.recordId, field: finding.field, observedValue: finding.observedValue, observedVersion: finding.observedVersion,
    reasons: finding.reasons.join(','), level: finding.level, groupKey: finding.group, evidenceJson: JSON.stringify(finding.evidence),
  });
  const fresh = found.filter((finding) => !byKey.has(finding.key));
  if (fresh.length > 0) await INSERT.into(`${DB}.Findings`).entries(fresh.map(toRow));
  // A sensor that was silent at the first scan may only be comparable now; an unread card is completed.
  for (const finding of found) {
    const row = byKey.get(finding.key);
    if (!row || row.reviewStatus !== 'New' || finding.reasons.length <= row.reasons.split(',').length) continue;
    await UPDATE(`${DB}.Findings`).with({ reasons: finding.reasons.join(','), level: finding.level, groupKey: finding.group, evidenceJson: JSON.stringify(finding.evidence) }).where({ ID: row.ID });
  }
  return fresh.length;
}

export interface Trust { readonly status: 'review' | 'notTrusted'; readonly note: string | null; readonly at: string | null; readonly recordType: string }
interface TrustRow { recordType: string; recordId: string; observedValue: string; observedVersion: string; level: string; reviewStatus: string; reviewNote: string | null; reviewedAt: string | null }

/** Looks up the mark on exactly this value and version: never on the record as such. */
export async function readTrust(): Promise<(recordType: string, id: string, value: unknown, version: string | null) => Trust | null> {
  const rows = ((await SELECT.from(`${DB}.Findings`).columns('recordType', 'recordId', 'observedValue', 'observedVersion', 'level', 'reviewStatus', 'reviewNote', 'reviewedAt')) as TrustRow[])
    // Worth asking stays with Ilse until she marks one herself.
    .filter((row) => row.reviewStatus === 'NotTrusted' || (row.level === 'sure' && row.reviewStatus !== 'Cleared'));
  return (recordType, id, value, version) => {
    const row = rows.find((item) => item.recordType === recordType && item.recordId === id && stamp(item.observedVersion) === stamp(version)
      && item.observedValue === String(recordType === 'Repair' ? stamp(value as string | null) : Number(value)));
    if (!row) return null;
    const isMarked = row.reviewStatus === 'NotTrusted';
    return { status: isMarked ? 'notTrusted' : 'review', note: isMarked ? row.reviewNote : null, at: isMarked ? row.reviewedAt : null, recordType };
  };
}

/** The mark a pipe shows: its own, its sensor's or a repair's. Ilse's decision goes before a note. */
export async function readPipeTrust(): Promise<Map<string, Trust>> {
  const [records, trust] = [await readRecords(), await readTrust()];
  const result = new Map<string, Trust>();
  const put = (pipe: string, mark: Trust | null): void => {
    if (mark && (!result.has(pipe) || (mark.status === 'notTrusted' && result.get(pipe)?.status !== 'notTrusted'))) result.set(pipe, mark);
  };
  for (const sensor of records.sensors) put(sensor.pipe_ID, trust('Sensor', sensor.ID, sensor.flowRate, sensor.modifiedAt));
  for (const pipe of records.pipes) put(pipe.ID, trust('WaterPipe', pipe.ID, pipe.currentFlowRate, pipe.modifiedAt));
  for (const repair of records.repairs) put(repair.pipe_ID, trust('Repair', repair.ID, repair.repairDate, repair.modifiedAt));
  return result;
}
