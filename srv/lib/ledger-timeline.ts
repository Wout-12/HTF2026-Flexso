/** When was what written? Every moment the records and the change log still show. Pure function. */
import { isKnown, isNight, stamp, type RecordType, type ScanInput } from './ledger-scan';

export interface LogLine {
  readonly recordType: string; readonly recordId: string; readonly oldVersion: string | null; readonly oldWriter: string | null;
  readonly changedAt: string; readonly changedBy: string; readonly newVersion: string | null;
}

export interface Moment {
  readonly at: string; readonly recordType: RecordType; readonly recordId: string; readonly name: string; readonly who: string;
  readonly event: 'created' | 'changed'; readonly night: boolean; readonly stranger: boolean;
}
/** A date written inside a record; never mixed up with when something was really written. */
export interface InnerDate { readonly at: string; readonly recordId: string; readonly name: string; readonly writtenAt: string }

export interface Timeline {
  readonly moments: readonly Moment[];
  readonly inner: readonly InnerDate[];
  readonly odd: { readonly count: number; readonly first: string | null; readonly last: string | null; readonly minutes: number; readonly writtenAfter: number };
}

const INNER_DAYS = 2;
const DAY_MS = 86_400_000;

export function buildTimeline(input: ScanInput, log: readonly LogLine[]): Timeline {
  const moments = new Map<string, Moment>();
  const names = new Map<string, string>();
  const add = (at: string | null, recordType: RecordType, recordId: string, who: string | null, event: Moment['event']): void => {
    if (!at) return;
    const key = `${recordType}|${recordId}|${stamp(at)}`;
    if (!moments.has(key)) moments.set(key, { at: stamp(at), recordType, recordId, name: names.get(recordId) ?? '', who: who ?? '', event, night: isNight(at), stranger: !isKnown(who) });
  };
  const rows: [RecordType, readonly { ID: string; createdAt: string | null; createdBy: string | null; modifiedAt: string | null; modifiedBy: string | null }[], (row: never) => string][] = [
    ['WaterPipe', input.pipes, (row: ScanInput['pipes'][number]) => row.pipeID], ['Sensor', input.sensors, (row: ScanInput['sensors'][number]) => row.sensorID],
    ['Repair', input.repairs, (row: ScanInput['repairs'][number]) => row.issue ?? ''], ['StockItem', input.stock, (row: ScanInput['stock'][number]) => row.name],
    ['Landmark', input.landmarks, (row: ScanInput['landmarks'][number]) => row.name],
  ];
  for (const [type, list, nameOf] of rows) {
    for (const row of list) {
      names.set(row.ID, nameOf(row as never));
      add(row.createdAt, type, row.ID, row.createdBy, 'created');
      add(row.modifiedAt, type, row.ID, row.modifiedBy, 'changed');
    }
  }
  // The log remembers the versions a record no longer shows.
  for (const line of log) {
    add(line.oldVersion, line.recordType as RecordType, line.recordId, line.oldWriter, 'changed');
    add(line.newVersion ?? line.changedAt, line.recordType as RecordType, line.recordId, line.changedBy, 'changed');
  }
  const sorted = [...moments.values()].sort((a, b) => a.at.localeCompare(b.at));
  const inner = input.repairs
    .filter((repair) => repair.repairDate !== null && Math.abs(Date.parse(repair.repairDate) - Date.parse(repair.createdAt ?? '')) > INNER_DAYS * DAY_MS)
    .map((repair) => ({ at: stamp(repair.repairDate), recordId: repair.ID, name: repair.issue ?? '', writtenAt: stamp(repair.createdAt) }));
  const odd = sorted.filter((moment) => moment.night || moment.stranger);
  const [first, last] = [odd[0]?.at ?? null, odd.at(-1)?.at ?? null];
  return {
    moments: sorted, inner,
    odd: {
      count: odd.length, first, last, minutes: first && last ? Math.round((Date.parse(last) - Date.parse(first)) / 60_000) : 0,
      writtenAfter: last ? sorted.filter((moment) => moment.at > last).length : 0,
    },
  };
}
