/**
 * Ilse's Ledger: finds the records that may not be trusted and says why. It finds, Ilse decides.
 * Pure function: no database and no clock of its own. Times are compared as they are stored, which
 * we take as Oakhaven time (it matches Ilse's "03:13").
 */
export const CONFIG = {
  /** A sensor above this many times its pipe's reference flow cannot be true (Ilse). */
  IMPOSSIBLE_FACTOR: 2,
  /** Our choice, provisional: more than a fifth of the reference flow apart is a contradiction. */
  FLOW_TOLERANCE: 0.2,
  NIGHT: { from: 0, until: 4 },
  STALE_MINUTES: 15,
  SAME_TIME_MINUTES: 5,
} as const;

/** Who writes under which name. */
export const PEOPLE: Readonly<Record<string, string>> = {
  'maren.holt': 'Maren Holt', maren: 'Maren Holt', 'tobin.reyes': 'Tobin Reyes', tobin: 'Tobin Reyes',
  'rowan.ashby': 'Rowan Ashby', rowan: 'Rowan Ashby', hilde: 'Hilde', bram: 'Bram', 'ilse.vermeer': 'Ilse Vermeer', ilse: 'Ilse Vermeer',
};
/** Known, but nobody can tell which person it was. */
export const SHARED_ACCOUNTS: readonly string[] = ['council'];

export type RecordType = 'WaterPipe' | 'Sensor' | 'Repair' | 'StockItem' | 'Landmark';
/** Whose usual work a record is. Provisional: to be confirmed by Maren, Tobin and Rowan. */
const USUAL: Readonly<Record<RecordType, string>> = { WaterPipe: 'Maren Holt', Sensor: 'Maren Holt', Repair: 'Maren Holt', StockItem: 'Tobin Reyes', Landmark: 'council' };

export type Reason =
  | 'impossibleFlow' | 'negativeStock' | 'contradiction' | 'nightCreated' | 'nightChanged' | 'notPerson' // sure
  | 'futureRepair' | 'attribution' | 'outsideCreated' | 'outsideChanged'; // needs confirmation, or worth asking
const SURE: readonly Reason[] = ['impossibleFlow', 'negativeStock', 'contradiction', 'nightCreated', 'nightChanged', 'notPerson'];
const ASK: readonly Reason[] = ['outsideCreated', 'outsideChanged'];

type Num = number | string | null;
interface Written { readonly ID: string; readonly createdAt: string | null; readonly createdBy: string | null; readonly modifiedAt: string | null; readonly modifiedBy: string | null }

export interface ScanInput {
  readonly pipes: readonly (Written & { pipeID: string; nominalFlowRate: Num; currentFlowRate: Num; currentPressure: Num })[];
  readonly sensors: readonly (Written & { sensorID: string; pipe_ID: string; flowRate: Num; pressure: Num; lastReading: string | null })[];
  readonly repairs: readonly (Written & { pipe_ID: string; issue: string | null; repairDate: string | null; repairedBy: string | null })[];
  readonly stock: readonly (Written & { itemID: string; name: string; unit: string; currentQuantity: Num })[];
  readonly landmarks: readonly (Written & { name: string })[];
}

/** What was seen, frozen: it stays the same when the record changes later. */
export interface Evidence {
  readonly name: string;
  readonly pipeID: string | null;
  readonly unit: string;
  readonly createdAt: string; readonly createdBy: string; readonly modifiedAt: string; readonly modifiedBy: string;
  readonly sensorFlow: number | null; readonly pipeFlow: number | null; readonly reference: number | null; readonly tolerance: number | null;
  readonly sensorPressure: number | null; readonly pipePressure: number | null;
  readonly sensorReportedAt: string | null; readonly pipeWrittenAt: string | null;
  /** How many of the other pipes were updated together with their sensor; null when this one was too. */
  readonly changedAlone: number | null;
  readonly issue: string | null; readonly repairDate: string | null; readonly repairedBy: string | null;
}

export interface Finding {
  readonly key: string;
  readonly recordType: RecordType; readonly recordId: string; readonly field: string;
  readonly observedValue: string; readonly observedVersion: string;
  readonly reasons: readonly Reason[];
  readonly level: 'sure' | 'ask';
  readonly group: string; // case:…, sure, confirm, W1 … W5, other
  readonly evidence: Evidence;
}

export const stamp = (at: string | null): string => (at ? new Date(at).toISOString() : '');
export const personOf = (writer: string | null): string | null => PEOPLE[writer ?? ''] ?? null;
export const isKnown = (writer: string | null): boolean => personOf(writer) !== null || SHARED_ACCOUNTS.includes(writer ?? '');
export function isNight(at: string | null): boolean {
  if (!at) return false;
  const hour = new Date(at).getUTCHours();
  return hour >= CONFIG.NIGHT.from && hour < CONFIG.NIGHT.until;
}
const num = (value: Num): number | null => (value === null ? null : Number(value));
const minutesApart = (a: string | null, b: string | null): number => Math.abs(Date.parse(a ?? '') - Date.parse(b ?? '')) / 60_000;

/** Reasons that only depend on who wrote a record, and when. Creation and change are two events. */
function writingReasons(type: RecordType, row: Written): Reason[] {
  const reasons: Reason[] = [];
  const changed = stamp(row.modifiedAt) !== stamp(row.createdAt);
  if (isNight(row.createdAt)) reasons.push('nightCreated');
  if (changed && isNight(row.modifiedAt)) reasons.push('nightChanged');
  if (!isKnown(row.createdBy) || (changed && !isKnown(row.modifiedBy))) reasons.push('notPerson');
  // The council account set up the records in January; only its later changes are worth asking about.
  const outside = (writer: string | null): boolean => isKnown(writer) && (personOf(writer) ?? writer) !== USUAL[type];
  if (outside(row.createdBy) && !SHARED_ACCOUNTS.includes(row.createdBy ?? '')) reasons.push('outsideCreated');
  if (changed && outside(row.modifiedBy)) reasons.push('outsideChanged');
  return reasons;
}

function groupOf(type: RecordType, reasons: readonly Reason[], row: Written): string {
  if (!reasons.some((reason) => ASK.includes(reason))) return 'confirm';
  const writer = reasons.includes('outsideChanged') ? row.modifiedBy : row.createdBy;
  if (type === 'StockItem') return personOf(writer) === 'Maren Holt' ? 'W1' : SHARED_ACCOUNTS.includes(writer ?? '') ? 'W2' : 'other';
  if (personOf(writer) !== 'Tobin Reyes') return 'other';
  return ({ Sensor: 'W3', WaterPipe: 'W4', Repair: 'W5' } as Readonly<Record<string, string>>)[type] ?? 'other';
}

/** One finding per record version, with every reason that applies. */
export function scanLedger(input: ScanInput, now: string): Finding[] {
  const findings: Finding[] = [];
  const add = (type: RecordType, row: Written, field: string, value: string, extra: readonly Reason[], evidence: Partial<Evidence> & { name: string }): void => {
    const reasons = [...extra, ...writingReasons(type, row)];
    if (reasons.length === 0) return;
    const sure = reasons.some((reason) => SURE.includes(reason));
    findings.push({
      key: [type, row.ID, field, stamp(row.modifiedAt)].join('|'), recordType: type, recordId: row.ID, field, observedValue: value, observedVersion: stamp(row.modifiedAt),
      reasons, level: sure ? 'sure' : 'ask', group: sure ? 'sure' : groupOf(type, reasons, row),
      evidence: {
        pipeID: null, unit: '', createdAt: stamp(row.createdAt), createdBy: row.createdBy ?? '', modifiedAt: stamp(row.modifiedAt), modifiedBy: row.modifiedBy ?? '',
        sensorFlow: null, pipeFlow: null, reference: null, tolerance: null, sensorPressure: null, pipePressure: null, sensorReportedAt: null, pipeWrittenAt: null,
        changedAlone: null, issue: null, repairDate: null, repairedBy: null, ...evidence,
      },
    });
  };
  const together = (sensor: ScanInput['sensors'][number]): boolean =>
    minutesApart(sensor.modifiedAt, input.pipes.find((pipe) => pipe.ID === sensor.pipe_ID)?.modifiedAt ?? null) <= CONFIG.SAME_TIME_MINUTES;

  for (const sensor of input.sensors) {
    const pipe = input.pipes.find((item) => item.ID === sensor.pipe_ID);
    const [flow, own, reference] = [num(sensor.flowRate), num(pipe?.currentFlowRate ?? null), num(pipe?.nominalFlowRate ?? null)];
    const reasons: Reason[] = [];
    if (flow !== null && reference !== null && flow > reference * CONFIG.IMPOSSIBLE_FACTOR) reasons.push('impossibleFlow');
    const fresh = sensor.lastReading !== null && Date.parse(now) - Date.parse(sensor.lastReading) <= CONFIG.STALE_MINUTES * 60_000;
    if (fresh && flow !== null && own !== null && reference !== null && Math.abs(flow - own) > reference * CONFIG.FLOW_TOLERANCE) reasons.push('contradiction');
    add('Sensor', sensor, 'flowRate', String(flow ?? ''), reasons, {
      name: sensor.sensorID, pipeID: pipe?.pipeID ?? null, unit: 'L/min', sensorFlow: flow, pipeFlow: own, reference,
      tolerance: reference === null ? null : reference * CONFIG.FLOW_TOLERANCE, sensorPressure: num(sensor.pressure), pipePressure: num(pipe?.currentPressure ?? null),
      sensorReportedAt: sensor.lastReading, pipeWrittenAt: pipe?.modifiedAt ?? null,
      changedAlone: together(sensor) ? null : input.sensors.filter((other) => other !== sensor && together(other)).length,
    });
  }
  for (const item of input.stock) {
    const quantity = num(item.currentQuantity);
    add('StockItem', item, 'currentQuantity', String(quantity ?? ''), quantity !== null && quantity < 0 ? ['negativeStock'] : [], { name: item.name, unit: item.unit });
  }
  for (const repair of input.repairs) {
    const reasons: Reason[] = [];
    if (repair.repairDate !== null && Date.parse(repair.repairDate) > Date.parse(now)) reasons.push('futureRepair'); // our own date check, not Ilse's
    if (repair.repairedBy && !isKnown(repair.createdBy)) reasons.push('attribution');
    const pipe = input.pipes.find((item) => item.ID === repair.pipe_ID);
    add('Repair', repair, 'repairDate', stamp(repair.repairDate), reasons, {
      name: repair.issue ?? '', pipeID: pipe?.pipeID ?? null, issue: repair.issue, repairDate: repair.repairDate, repairedBy: repair.repairedBy,
      pipeFlow: num(pipe?.currentFlowRate ?? null), reference: num(pipe?.nominalFlowRate ?? null),
    });
  }
  for (const pipe of input.pipes) {
    add('WaterPipe', pipe, 'currentFlowRate', String(num(pipe.currentFlowRate) ?? ''), [], { name: pipe.pipeID, pipeID: pipe.pipeID, unit: 'L/min', pipeFlow: num(pipe.currentFlowRate), reference: num(pipe.nominalFlowRate) });
  }
  for (const place of input.landmarks) add('Landmark', place, 'name', place.name, [], { name: place.name });

  // Same writer, same minute: one linked case. That links them, it does not prove one hand.
  const caseOf = (finding: Finding): string => `case:${finding.evidence.modifiedBy}|${finding.observedVersion.slice(0, 16)}`;
  const linkable = findings.filter((finding) => finding.level === 'sure' && finding.reasons.includes('notPerson'));
  const sizes = new Map<string, number>();
  for (const finding of linkable) sizes.set(caseOf(finding), (sizes.get(caseOf(finding)) ?? 0) + 1);
  return findings.map((finding) => (linkable.includes(finding) && (sizes.get(caseOf(finding)) ?? 0) > 1 ? { ...finding, group: caseOf(finding) } : finding));
}

export const isAsking = (reasons: readonly Reason[]): boolean => reasons.some((reason) => ASK.includes(reason));
