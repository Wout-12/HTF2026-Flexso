/** Handler of `SquareService` (see `square-service.cds`): only reads, and passes on finished sentences. */
import { buildSheet } from './lib/council-sheet';
import { realToday } from './lib/demo-clock';
import { simulatedWeather } from './lib/demo-weather';
import { PEOPLE, stamp } from './lib/ledger-scan';
import { readDecided, readInput } from './lib/read-council';
import { readRecords, readTrust } from './lib/read-ledger';
import { readBoard, type Row } from './lib/read-pantry';
import { readRoute } from './lib/read-water';
import { buildSquare, type SquareInput } from './lib/square';

interface CdsService { init(): Promise<void>; on(event: string, handler: () => unknown): void }
interface Query extends PromiseLike<unknown> { where(predicate: Row): Query }
/** The slice of the `cds` facade this file uses. */
interface CdsApi {
  readonly ApplicationService: new (...args: readonly never[]) => CdsService;
  readonly ql: { readonly SELECT: { from(entity: string): { columns(...columns: readonly string[]): Query } } };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT } = cds.ql;

const DB = 'oakhaven.curse';
const CLEARED_DAYS = 7;
const FIRST_NAMES = new Map(Object.values(PEOPLE).map((name) => [name, name.split(' ')[0]]));

/** Only what Ilse decided herself, on the value that is still in the records. */
async function readNotices(): Promise<SquareInput['notices']> {
  const findings = (await SELECT.from(`${DB}.Findings`).columns('ID', 'recordType', 'recordId', 'observedVersion', 'evidenceJson', 'reviewStatus', 'reviewedAt')
    .where({ reviewStatus: { in: ['NotTrusted', 'Cleared'] } })) as { ID: string; recordType: string; recordId: string; observedVersion: string; evidenceJson: string; reviewStatus: string; reviewedAt: string }[];
  if (findings.length === 0) return [];
  const marked = new Set(((await SELECT.from(`${DB}.FindingEvents`).columns('finding_ID').where({ action: 'notTrusted' })) as { finding_ID: string }[]).map((row) => row.finding_ID));
  const records = await readRecords();
  const versions = new Map([...records.pipes, ...records.sensors, ...records.repairs, ...records.stock, ...records.landmarks].map((row) => [row.ID, stamp(row.modifiedAt)]));
  return findings
    .filter((finding) => versions.get(finding.recordId) === stamp(finding.observedVersion))
    // "Finished checking" only when people were told it was being checked.
    .filter((finding) => finding.reviewStatus === 'NotTrusted' || (marked.has(finding.ID) && Date.now() - Date.parse(finding.reviewedAt) < CLEARED_DAYS * 86_400_000))
    .map((finding) => {
      const { name, pipeID } = JSON.parse(finding.evidenceJson) as { name: string; pipeID: string | null };
      return { recordType: finding.recordType, name, pipeID, cleared: finding.reviewStatus === 'Cleared' };
    });
}

async function square(): Promise<string> {
  const input = await readInput();
  const [route, board, trust, records, decided] = [await readRoute(), [...(await readBoard(realToday())).values()], await readTrust(), await readRecords(), await readDecided()];
  const received = (await SELECT.from(`${DB}.StockReceivals`).columns('item_ID', 'supplier', 'receivedAt')) as { item_ID: string; supplier: string; receivedAt: string }[];
  const nameOf = (id: string): string => board.find((entry) => entry.item.ID === id)?.item.name ?? '';
  const pipeOf = (id: string): string => input.pipes.find((pipe) => pipe.ID === id)?.pipeID ?? '';
  return JSON.stringify(buildSquare({
    now: input.now,
    sheet: buildSheet(input),
    weather: simulatedWeather(realToday()),
    jobSlots: Object.fromEntries(input.pipes.map((pipe) => [pipe.pipeID, route.get(pipe.ID)?.fields.jobSlot ?? null])),
    // A repair the library is looking at is no news.
    repairs: records.repairs.filter((repair) => repair.repairDate !== null && trust('Repair', repair.ID, repair.repairDate, repair.modifiedAt) === null)
      .map((repair) => ({ pipeID: pipeOf(repair.pipe_ID), at: repair.repairDate ?? '', by: FIRST_NAMES.get(repair.repairedBy ?? '') ?? null })),
    deliveries: received.map((row) => ({ product: nameOf(row.item_ID), supplier: row.supplier, at: row.receivedAt })),
    orders: board.filter((entry) => entry.order && entry.supplier).map((entry) => ({ product: entry.item.name, supplier: entry.supplier?.name ?? '', dueOn: entry.order?.dueOn ?? '' })),
    panic: board.filter((entry) => entry.result.risk === 'panic').map((entry) => entry.item.name),
    decided: decided && { at: decided.createdAt, lines: decided.result.lines, decisions: decided.decisions },
    notices: await readNotices(),
  }));
}

export default class SquareService extends cds.ApplicationService {
  override async init(): Promise<void> {
    this.on('square', square);
    return super.init();
  }
}
