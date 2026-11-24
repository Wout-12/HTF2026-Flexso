/**
 * Handlers of `WaterSupplyService` (see `water-supply-service.cds`).
 *
 * Everything you can read from the service is served by CAP's generic provider — no code needed.
 * Add a handler here only when you need logic: `this.before(...)` to validate, `this.on(...)` to
 * implement an action, `this.after(...)` to enrich what is read.
 *
 * `@sap/cds` ships no TypeScript declarations in this project, so it is loaded with `require`
 * and the part of its API this file uses is described in the small interfaces below.
 */
import { randomUUID } from 'node:crypto';
import { startDemoSensorFeed } from './lib/demo-freshness';
import { isDemoScenario, resetDemo, setDemo } from './lib/demo-overrides';
import { readRoute } from './lib/read-water';

// 👋 EXAMPLE — the shape of a WaterPipes row as our handler sees it. Every field is optional:
//    the client decides which fields it asks for ($select).
interface PipeRow {
  ID?: string;
  lastMaintenance?: string | null;
  daysSinceMaintenance?: number | null;
}

/** What an action handler gets from CAP. */
interface ActionRequest {
  readonly data: Readonly<Record<string, string | null | undefined>>;
  readonly subject: unknown;
  error(code: number, message: string, target?: string): void;
}

/** The slice of a CAP service this file uses. */
interface CdsService {
  init(): Promise<void>;
  after(event: string, entity: string, handler: (results: unknown) => unknown): void;
  on(event: string, handler: (req: ActionRequest) => unknown): void;
  on(event: string, entity: string, handler: (req: ActionRequest) => unknown): void;
}

/** The slice of the `cds` facade this file uses. */
interface CdsApi {
  readonly ApplicationService: new (...args: readonly never[]) => CdsService;
  readonly ql: {
    readonly SELECT: {
      from(entity: string): {
        columns(...columns: readonly string[]): {
          where(predicate: Readonly<Record<string, unknown>>): PromiseLike<PipeRow[]>;
        } & PromiseLike<unknown>;
      };
      readonly one: { from(target: unknown): { columns(...columns: readonly string[]): PromiseLike<{ ID: string } | null> } };
    };
    readonly INSERT: { into(entity: string): { entries(row: Readonly<Record<string, unknown>>): PromiseLike<unknown> } };
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT, INSERT } = cds.ql;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 👋 EXAMPLE — fills in the computed field `daysSinceMaintenance` on every pipe that is read.
 *
 * Registered with `this.after('READ', 'WaterPipes', …)`: CAP has already read the rows from the
 * database and hands them to us just before it sends them to the client — we only add a value.
 */
async function addDaysSinceMaintenance(results: unknown): Promise<void> {
  // 👋 EXAMPLE — reading a collection (/WaterPipes) gives an array; reading one pipe
  //    (/WaterPipes(<ID>)) gives a single object. Treat both the same way.
  const rows = (Array.isArray(results) ? results : [results]).filter(
    (row): row is PipeRow => row !== null && typeof row === 'object',
  );

  // 👋 EXAMPLE — the client may ask for only SOME fields, e.g. `$select=pipeID,daysSinceMaintenance`.
  //    UI5 always does that: it only requests the fields a view binds. Then `lastMaintenance` — the
  //    input we need — is not in the row. CAP always adds the key (`ID`), so we look the missing
  //    inputs up ourselves: ONE query for all rows that need it (never one query per row).
  const missingIds = rows.filter((row) => !('lastMaintenance' in row) && row.ID).map((row) => row.ID);
  const lastMaintenanceById = new Map<string, string | null | undefined>();
  if (missingIds.length > 0) {
    const pipes = await SELECT.from('oakhaven.curse.WaterPipes')
      .columns('ID', 'lastMaintenance')
      .where({ ID: { in: missingIds } });
    for (const pipe of pipes) lastMaintenanceById.set(pipe.ID ?? '', pipe.lastMaintenance);
  }

  // 👋 EXAMPLE — the actual calculation: whole days between the last maintenance and now.
  //    Computed on every read, so it is always up to date — nothing is stored.
  const now = Date.now();
  for (const row of rows) {
    const lastMaintenance = 'lastMaintenance' in row ? row.lastMaintenance : lastMaintenanceById.get(row.ID ?? '');
    row.daysSinceMaintenance = lastMaintenance
      ? Math.floor((now - Date.parse(lastMaintenance)) / MS_PER_DAY)
      : null;
  }
}

/** Fills in the route fields. The rank compares all pipes, so it is always computed over all. */
async function addRoute(results: unknown): Promise<void> {
  const rows = (Array.isArray(results) ? results : [results]).filter(
    (row): row is PipeRow & Record<string, unknown> => row !== null && typeof row === 'object' && 'ID' in row,
  );
  if (rows.length === 0) return;
  const route = await readRoute();
  for (const row of rows) {
    const result = route.get(row.ID ?? '');
    if (!result) continue;
    Object.assign(row, result.fields);
    // Show the readings the tier is based on (they differ from the database only during a demo).
    if ('currentFlowRate' in row) row.currentFlowRate = result.flow;
    if ('currentPressure' in row) row.currentPressure = result.pressure;
  }
}

/** `yyyy-mm-ddThh:mm:ssZ`, as CAP stores a DateTime. */
function nowAsDateTime(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

async function logRepair(req: ActionRequest): Promise<void> {
  const issue = req.data.issue?.trim();
  if (!issue) return req.error(400, 'Say what was wrong with the pipe', 'issue');
  const pipe = await SELECT.one.from(req.subject).columns('ID');
  if (!pipe) return req.error(404, 'This pipe does not exist');
  const tier = (await readRoute()).get(pipe.ID)?.fields.tier;
  await INSERT.into('oakhaven.curse.Repairs').entries({
    pipe_ID: pipe.ID,
    repairID: randomUUID(),
    issue,
    repairedBy: req.data.repairedBy?.trim() || 'Maren Holt',
    repairDate: nowAsDateTime(),
    tierAtRepair: tier,
  });
}

async function deferJob(req: ActionRequest): Promise<void> {
  const reason = req.data.reason?.trim();
  if (!reason) return req.error(400, 'Say why it has to wait', 'reason');
  const pipe = await SELECT.one.from(req.subject).columns('ID');
  if (!pipe) return req.error(404, 'This pipe does not exist');
  const tier = (await readRoute()).get(pipe.ID)?.fields.tier;
  await INSERT.into('oakhaven.curse.JobDeferrals').entries({
    pipe_ID: pipe.ID,
    reason,
    deferredAt: nowAsDateTime(),
    tierAtDeferral: tier,
  });
}

async function demoSet(req: ActionRequest): Promise<void> {
  const { pipeID, scenario } = req.data;
  if (!isDemoScenario(scenario)) return req.error(400, 'Unknown demo scenario', 'scenario');
  const known = await SELECT.from('oakhaven.curse.WaterPipes').columns('ID').where({ pipeID });
  if (!pipeID || known.length === 0) return req.error(404, 'This pipe does not exist', 'pipeID');
  setDemo(pipeID, scenario);
}

export default class WaterSupplyService extends cds.ApplicationService {
  override async init(): Promise<void> {
    // 👋 EXAMPLE — register the handler: after every READ of WaterPipes, add daysSinceMaintenance.
    this.after('READ', 'WaterPipes', addDaysSinceMaintenance);

    // Today's Route (Maren)
    this.after('READ', 'WaterPipes', addRoute);
    this.on('logRepair', 'WaterPipes', logRepair);
    this.on('deferJob', 'WaterPipes', deferJob);
    this.on('demoSet', demoSet);
    this.on('demoReset', () => resetDemo());

    startDemoSensorFeed();
    return super.init();
  }
}
