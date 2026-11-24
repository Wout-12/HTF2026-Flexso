/**
 * Demo readings for Today's Route: makes a pipe look broken, silent or recovered.
 * A pipe repaired in the app recovers by itself after a short while (the seed readings never change),
 * unless `repairFails` was chosen for it.
 * Lives in memory on top of the data, so the records (and who changed them) stay untouched.
 * A server restart or `demoReset` brings back the real readings.
 */
import type { RouteInput } from './water-route';

const SCENARIOS = ['alarm', 'silent', 'recovered', 'repairFails'] as const;
export type DemoScenario = (typeof SCENARIOS)[number];

const SILENT_MINUTES = 20;
/** How long after Done the demo readings improve. */
const RECOVERY_MS = 20_000;
const overrides = new Map<string, { scenario: DemoScenario; setAt: number }>();
/** Pipes whose repair does not work. */
const failing = new Set<string>();
/** Repairs logged before "back to the real readings" no longer change anything. */
let resetAt = 0;

/** Repairs are stored in whole seconds, so compare in whole seconds. */
function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000) * 1000;
}

export function isDemoScenario(value: unknown): value is DemoScenario {
  return SCENARIOS.some((scenario) => scenario === value);
}

export function setDemo(pipeID: string, scenario: DemoScenario): void {
  if (scenario === 'repairFails') {
    failing.add(pipeID);
    if (overrides.get(pipeID)?.scenario === 'recovered') overrides.delete(pipeID);
    return;
  }
  failing.delete(pipeID);
  overrides.set(pipeID, { scenario, setAt: nowInSeconds() });
}

export function resetDemo(): void {
  overrides.clear();
  failing.clear();
  resetAt = Date.now();
}

/** The demo choice for a pipe, or `recovered` some time after a repair logged in the app. */
function scenarioOf(pipe: RouteInput['pipes'][number], repairs: RouteInput['repairs'], now: Date): DemoScenario | undefined {
  const override = overrides.get(pipe.pipeID);
  if (failing.has(pipe.pipeID) || override?.scenario === 'silent') return override?.scenario;
  const since = Math.max(resetAt, override?.setAt ?? 0);
  const repaired = repairs.some((repair) => {
    // Only repairs logged in the app carry a tier; the seed repairs do not.
    if (repair.pipe_ID !== pipe.ID || !repair.tierAtRepair || !repair.repairDate) return false;
    const at = Date.parse(repair.repairDate);
    return at >= since && now.getTime() - at >= RECOVERY_MS;
  });
  return repaired ? 'recovered' : override?.scenario;
}

/** Returns the input with the demo readings applied; the original is not changed. */
export function applyDemo(input: RouteInput, now: Date): RouteInput {
  const scenarioById = new Map(input.pipes.map((pipe) => [pipe.ID, scenarioOf(pipe, input.repairs, now)]));
  if (![...scenarioById.values()].some(Boolean)) return input;
  const readings = (scenario: DemoScenario | undefined, nominal: number): { flow: number; pressure: number } | undefined => {
    if (scenario === 'alarm') return { flow: nominal * 0.3, pressure: 18 };
    if (scenario === 'recovered') return { flow: nominal * 0.95, pressure: 50 };
    return undefined;
  };
  const nominalById = new Map(input.pipes.map((pipe) => [pipe.ID, Number(pipe.nominalFlowRate)]));
  return {
    ...input,
    pipes: input.pipes.map((pipe) => {
      const demo = readings(scenarioById.get(pipe.ID), nominalById.get(pipe.ID) ?? 0);
      return demo ? { ...pipe, currentFlowRate: demo.flow, currentPressure: demo.pressure } : pipe;
    }),
    sensors: input.sensors.map((sensor) => {
      const scenario = scenarioById.get(sensor.pipe_ID);
      const demo = readings(scenario, nominalById.get(sensor.pipe_ID) ?? 0);
      if (demo) return { ...sensor, flowRate: demo.flow, pressure: demo.pressure };
      if (scenario === 'silent') return { ...sensor, lastReading: new Date(now.getTime() - SILENT_MINUTES * 60_000).toISOString() };
      return sensor;
    }),
  };
}
