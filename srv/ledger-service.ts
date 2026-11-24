/**
 * Handlers of `LedgerService` (see `ledger-service.cds`): Ilse's Ledger.
 * The checks are in `lib/ledger-scan.ts`. The scan finds; only Ilse's own actions move a finding.
 */
import { randomUUID } from 'node:crypto';
import { scanLedger, stamp } from './lib/ledger-scan';
import { buildTimeline, type LogLine } from './lib/ledger-timeline';
import { readRecords, storeScan } from './lib/read-ledger';

type Row = Record<string, unknown>;

interface FindingRow {
  ID: string; createdAt: string; recordType: string; recordId: string; field: string; observedValue: string; observedVersion: string; reasons: string; level: string; groupKey: string;
  evidenceJson: string; reviewStatus: string; reviewNote: string | null; reviewedAt: string | null; councilStatus: string; councilAnswer: string | null;
}
interface EventRow { finding_ID: string; action: string; note: string | null; who: string; at: string }
interface LogRow extends LogLine { field: string; oldValue: string | null; newValue: string | null; action: string }

interface ActionRequest {
  readonly data: Row;
  error(code: number, message: string, target?: string): void;
}

/** The slice of a CAP service this file uses. */
interface CdsService {
  init(): Promise<void>;
  on(event: string, handler: (req: ActionRequest) => unknown): void;
}

interface Query extends PromiseLike<unknown> { where(predicate: Row): Query }

/** The slice of the `cds` facade this file uses. */
interface CdsApi {
  once(event: string, handler: () => unknown): void;
  log(module: string): { warn(...args: readonly unknown[]): void };
  readonly ApplicationService: new (...args: readonly never[]) => CdsService;
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
const LIBRARIAN = 'Ilse Vermeer';
const FINDING = ['ID', 'createdAt', 'recordType', 'recordId', 'field', 'observedValue', 'observedVersion', 'reasons', 'level', 'groupKey', 'evidenceJson',
  'reviewStatus', 'reviewNote', 'reviewedAt', 'councilStatus', 'councilAnswer'];
/** The first scan waits for the sensors' first report, or it could not compare them. */
const FIRST_SCAN_MS = 5_000;
const nowAsDateTime = (): string => `${new Date().toISOString().slice(0, 19)}Z`;

async function ledger(): Promise<string> {
  const records = await readRecords();
  const findings = (await SELECT.from(`${DB}.Findings`).columns(...FINDING)) as FindingRow[];
  const events = (await SELECT.from(`${DB}.FindingEvents`).columns('finding_ID', 'action', 'note', 'who', 'at')) as EventRow[];
  const log = (await SELECT.from(`${DB}.ChangeLog`).columns('recordType', 'recordId', 'field', 'oldValue', 'newValue', 'oldVersion', 'oldWriter', 'newVersion', 'changedAt', 'changedBy', 'action')) as LogRow[];
  const versions = new Map([...records.pipes, ...records.sensors, ...records.repairs, ...records.stock, ...records.landmarks].map((row) => [row.ID, row]));
  return JSON.stringify({
    findings: findings.map(({ evidenceJson, ...finding }) => {
      const current = versions.get(finding.recordId);
      const changes = log.filter((line) => line.recordId === finding.recordId && line.changedAt >= stamp(finding.observedVersion)).sort((a, b) => a.changedAt.localeCompare(b.changedAt));
      const isCurrent = stamp(current?.modifiedAt ?? null) === stamp(finding.observedVersion);
      return {
        ...finding, evidence: JSON.parse(evidenceJson) as unknown,
        // Superseded: the new version came from its owner's own action in the app.
        recordStatus: isCurrent ? 'current' : changes.some((line) => line.field === finding.field) ? 'superseded' : 'changed',
        changes: changes.filter((line) => line.field === finding.field),
        events: events.filter((event) => event.finding_ID === finding.ID).sort((a, b) => a.at.localeCompare(b.at)),
      };
    }),
    timeline: buildTimeline(records, log),
    checked: { records: versions.size, now: new Date().toISOString(), hits: scanLedger(records, new Date().toISOString()).length },
  });
}

async function urgentNew(): Promise<string> {
  const rows = (await SELECT.from(`${DB}.Findings`).columns('ID').where({ level: 'sure', reviewStatus: 'New' })) as { ID: string }[];
  return rows.map((row) => row.ID).sort().join(',');
}

interface Move { readonly from: readonly string[]; readonly to: string; readonly action: string; readonly noteField?: string; readonly noteMessage?: string }

/** One move of Ilse's review; anything else is refused, and every move is kept. */
function review(move: Move): (req: ActionRequest) => Promise<void> {
  return async (req) => {
    const note = move.noteField ? String(req.data[move.noteField] ?? '').trim() : '';
    if (move.noteField && !note) return req.error(400, move.noteMessage ?? 'Say why', move.noteField);
    if (note.length > 300) return req.error(400, 'This reason is too long', move.noteField);
    const [row] = (await SELECT.from(`${DB}.Findings`).columns('ID', 'reviewStatus').where({ ID: req.data.finding })) as FindingRow[];
    if (!row) return req.error(404, 'This card does not exist', 'finding');
    if (!move.from.includes(row.reviewStatus)) return req.error(409, row.reviewStatus === 'New' ? 'Read the card first' : 'This card is already past that step', 'finding');
    await UPDATE(`${DB}.Findings`).with({ reviewStatus: move.to, reviewNote: note || null, reviewedAt: nowAsDateTime() }).where({ ID: row.ID });
    await keep(row.ID, move.action, note);
  };
}

async function keep(finding: string, action: string, note: string): Promise<void> {
  await INSERT.into(`${DB}.FindingEvents`).entries({ ID: randomUUID(), finding_ID: finding, action, note: note || null, who: LIBRARIAN, at: nowAsDateTime() });
}

/** Beside the review: what was told to the council, and what it said. */
async function council(req: ActionRequest, from: string, to: string, action: string, text: string | null): Promise<void> {
  const [row] = (await SELECT.from(`${DB}.Findings`).columns('ID', 'reviewStatus', 'councilStatus').where({ ID: req.data.finding })) as FindingRow[];
  if (!row) return req.error(404, 'This card does not exist', 'finding');
  if (row.reviewStatus === 'New') return req.error(409, 'Read the card first', 'finding');
  if (row.councilStatus !== from) return req.error(409, 'This card is already past that step', 'finding');
  await UPDATE(`${DB}.Findings`).with({ councilStatus: to, ...(text === null ? {} : { councilAnswer: text }) }).where({ ID: row.ID });
  await keep(row.ID, action, text ?? '');
}

export default class LedgerService extends cds.ApplicationService {
  override async init(): Promise<void> {
    this.on('ledger', ledger);
    this.on('urgentNew', urgentNew);
    this.on('scan', storeScan);
    this.on('markRead', review({ from: ['New'], to: 'Read', action: 'read' }));
    this.on('markNotTrusted', review({ from: ['Read', 'Cleared'], to: 'NotTrusted', action: 'notTrusted', noteField: 'note', noteMessage: 'Say in one line why it is not to be trusted' }));
    this.on('clearFinding', review({ from: ['Read', 'NotTrusted'], to: 'Cleared', action: 'cleared', noteField: 'reason', noteMessage: 'Say why it is fine' }));
    this.on('reopen', review({ from: ['Cleared', 'NotTrusted'], to: 'Read', action: 'reopened', noteField: 'reason', noteMessage: 'Say why you open it again' }));
    this.on('bringToCouncil', (req) => council(req, 'NotBrought', 'Brought', 'brought', null));
    this.on('recordAnswer', (req) => {
      const text = String(req.data.text ?? '').trim();
      if (!text || text.length > 300) return req.error(400, 'Write the council\'s answer in one line', 'text');
      return council(req, 'Brought', 'Answered', 'answered', text);
    });
    cds.once('listening', () => {
      setTimeout(() => void storeScan().catch((error: unknown) => cds.log('ledger').warn('First scan failed', error)), FIRST_SCAN_MS);
    });
    return super.init();
  }
}
