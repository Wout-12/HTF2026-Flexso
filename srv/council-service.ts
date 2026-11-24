/**
 * Handlers of `CouncilService` (see `council-service.cds`): Rowan's Monday Council Sheet.
 * The rules are in `lib/council-sheet.ts`; this file only reads, calls it and freezes copies.
 */
import { randomUUID } from 'node:crypto';
import { allYes, nextMondayInput } from './lib/council-scenario';
import { buildSheet, RULE_VERSION, type SheetResult } from './lib/council-sheet';
import { readDecided, readDecisions, readInput } from './lib/read-council';
import type { Row } from './lib/read-pantry';

interface CopyRow { ID: string; copyNo: string; createdAt: string; decidedAt: string | null; decidedBy: string | null; resultJson: string }

interface ActionRequest {
  readonly data: Row;
  error(code: number, message: string, target?: string): void;
}

/** The slice of a CAP service this file uses. */
interface CdsService {
  init(): Promise<void>;
  on(event: string, handler: (req: ActionRequest) => unknown): void;
}

interface Query extends PromiseLike<unknown> {
  where(predicate: Row): Query;
  orderBy(order: string): Query;
  limit(rows: number): Query;
}

/** The slice of the `cds` facade this file uses. */
interface CdsApi {
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
const DECISIONS = ['yes', 'no', 'later'];
const RULES = ['marenAtOnce', 'askHilde'];
const DAY_MS = 86_400_000;
const nowAsDateTime = (): string => `${new Date().toISOString().slice(0, 19)}Z`;

/** ISO week, e.g. 2026-W48: the week of the Thursday decides the year. */
function weekOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const thursday = new Date(date.getTime() + (3 - ((date.getUTCDay() + 6) % 7)) * DAY_MS);
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(thursday.getUTCFullYear(), 0, 1)) / (7 * DAY_MS));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function currentSheet(req: ActionRequest): Promise<string> {
  const input = await readInput();
  if (req.data.scenario !== true) return JSON.stringify(buildSheet(input));
  const copy = (await readDecided()) ?? allYes(buildSheet(input), input.now);
  return JSON.stringify(buildSheet(nextMondayInput(input, copy)));
}

async function copySheet(req: ActionRequest): Promise<string | void> {
  const [copy] = (await SELECT.from(`${DB}.CouncilSheets`).columns('ID', 'copyNo', 'createdAt', 'decidedAt', 'decidedBy', 'resultJson').where({ ID: req.data.sheet })) as CopyRow[];
  if (!copy) return req.error(404, 'This copy does not exist', 'sheet');
  return JSON.stringify({ ...copy, resultJson: undefined, result: JSON.parse(copy.resultJson) as SheetResult, decisions: await readDecisions(copy.ID) });
}

// ---- actions -------------------------------------------------------------------------------

async function createCouncilCopy(): Promise<string> {
  const input = await readInput();
  const result = buildSheet(input);
  const week = weekOf(result.from);
  const taken = new Set(((await SELECT.from(`${DB}.CouncilSheets`).columns('copyNo')) as { copyNo: string }[]).map((row) => row.copyNo));
  let copyNo = week;
  for (let count = 2; taken.has(copyNo); count++) copyNo = `${week}-${count}`;
  const previous = input.previous && ((await SELECT.from(`${DB}.CouncilSheets`).columns('ID').where({ copyNo: input.previous.copyNo })) as { ID: string }[])[0];
  const ID = randomUUID();
  await INSERT.into(`${DB}.CouncilSheets`).entries({
    ID, copyNo, ruleVersion: RULE_VERSION, dataAsOf: input.now, inputJson: JSON.stringify(input), resultJson: JSON.stringify(result), previousSheet_ID: previous?.ID ?? null,
  });
  return ID;
}

async function recordDecisions(req: ActionRequest): Promise<void> {
  const lines = (req.data.lines ?? []) as { lineKey?: string; decision?: string; note?: string | null }[];
  const decidedBy = String(req.data.decidedBy ?? '').trim();
  const rule = (req.data.rule as string | null) || null;
  const [copy] = (await SELECT.from(`${DB}.CouncilSheets`).columns('ID', 'decidedAt', 'resultJson').where({ ID: req.data.sheet })) as CopyRow[];
  if (!copy) return req.error(404, 'This copy does not exist', 'sheet');
  if (copy.decidedAt !== null) return req.error(409, 'The ticks of this copy are already saved', 'sheet');
  if (!decidedBy) return req.error(400, 'Who types in the ticks?', 'decidedBy');
  if (rule !== null && !RULES.includes(rule)) return req.error(400, 'Unknown choice about urgent repairs', 'rule');
  if (lines.length === 0) return req.error(400, 'Nothing was ticked', 'lines');
  if (new Set(lines.map((line) => line.lineKey)).size !== lines.length) return req.error(400, 'A line is ticked twice', 'lines');
  const onCopy = new Map((JSON.parse(copy.resultJson) as SheetResult).lines.map((line) => [line.key, line]));
  for (const line of lines) {
    if (!onCopy.has(line.lineKey ?? '')) return req.error(400, 'This line is not on the copy', 'lines');
    if (!DECISIONS.includes(line.decision ?? '')) return req.error(400, 'Tick Yes, No or Later', 'lines');
    if ((line.note ?? '').length > 200) return req.error(400, 'This reason is too long', 'lines');
  }
  const decidedAt = nowAsDateTime();
  // The unique rows also stop two people saving at the same moment; amounts come from the copy.
  await INSERT.into(`${DB}.CouncilDecisions`).entries(lines.map((line) => ({
    ID: randomUUID(), sheet_ID: copy.ID, lineKey: line.lineKey, decision: line.decision, note: line.note?.trim() || null,
    amount: line.decision === 'yes' ? onCopy.get(line.lineKey ?? '')?.crowns : 0,
  })));
  await UPDATE(`${DB}.CouncilSheets`).with({ decidedAt, decidedBy }).where({ ID: copy.ID });
  if (rule !== null) await INSERT.into(`${DB}.CouncilRules`).entries({ ID: randomUUID(), choice: rule, decidedBy, decidedAt });
}

export default class CouncilService extends cds.ApplicationService {
  override async init(): Promise<void> {
    this.on('currentSheet', currentSheet);
    this.on('copySheet', copySheet);
    this.on('createCouncilCopy', createCouncilCopy);
    this.on('recordDecisions', recordDecisions);
    return super.init();
  }
}
