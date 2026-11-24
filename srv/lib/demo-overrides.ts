/**
 * Demo readings for Today's Route: makes a pipe look broken, silent or recovered.
 * Lives in memory on top of the data, so the records (and who changed them) stay untouched.
 * A server restart or `demoReset` brings back the real readings.
 */
import type { RouteInput } from './water-route';

const SCENARIOS = ['alarm', 'silent', 'recovered'] as const;
export type DemoScenario = (typeof SCENARIOS)[number];

const SILENT_MINUTES = 20;
const overrides = new Map<string, DemoScenario>();

export function isDemoScenario(value: unknown): value is DemoScenario {
  return SCENARIOS.some((scenario) => scenario === value);
}

export function setDemo(pipeID: string, scenario: DemoScenario): void {
  overrides.set(pipeID, scenario);
}

export function resetDemo(): void {
  overrides.clear();
}

/** Returns the input with the demo readings applied; the original is not changed. */
export function applyDemo(input: RouteInput, now: Date): RouteInput {
  if (overrides.size === 0) return input;
  const scenarioById = new Map(input.pipes.map((pipe) => [pipe.ID, overrides.get(pipe.pipeID)]));
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
