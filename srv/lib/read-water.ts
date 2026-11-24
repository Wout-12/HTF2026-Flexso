/** Reads the water network. Shared by Maren's route and the council sheet; nothing here changes data. */
import { applyDemo } from './demo-overrides';
import { buildRoute, type RouteInput, type RouteResult } from './water-route';

/** The slice of the `cds` facade this file uses. */
interface CdsApi {
  readonly ql: { readonly SELECT: { from(entity: string): { columns(...columns: readonly string[]): PromiseLike<unknown> } } };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require('@sap/cds') as CdsApi;
const { SELECT } = cds.ql;

/** Everything the route depends on, one query per entity, with Maren's demo readings on top. */
export async function readWater(now: Date): Promise<{ input: RouteInput; isDemo: boolean }> {
  const read = async <T>(entity: string, ...columns: string[]): Promise<T[]> =>
    (await SELECT.from(`oakhaven.curse.${entity}`).columns(...columns)) as T[];
  const input: RouteInput = {
    pipes: await read('WaterPipes', 'ID', 'pipeID', 'pipelineType', 'startPoint', 'endPoint', 'nominalFlowRate', 'currentFlowRate', 'currentPressure'),
    sensors: await read('Sensors', 'pipe_ID', 'flowRate', 'pressure', 'lastReading'),
    repairs: await read('Repairs', 'pipe_ID', 'repairDate', 'tierAtRepair'),
    deferrals: await read('JobDeferrals', 'pipe_ID', 'reason', 'deferredAt', 'tierAtDeferral'),
    landmarks: await read('Landmarks', 'name', 'suppliedBy', 'servicePriority', 'serviceNote'),
  };
  const shown = applyDemo(input, now);
  return { input: shown, isDemo: shown !== input };
}

/** All pipes, judged and ranked. Keyed by the pipe's `ID`. */
export async function readRoute(): Promise<Map<string, RouteResult>> {
  const now = new Date();
  return buildRoute((await readWater(now)).input, now);
}
