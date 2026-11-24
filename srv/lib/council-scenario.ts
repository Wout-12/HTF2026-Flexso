/**
 * Demo only: what the sheet could look like next Monday, if the repairs the council said yes to were
 * done and worked. Calculated from a copy, nothing is stored, and the app labels it as a scenario.
 */
import type { Decision, PreviousCopy, SheetInput, SheetResult } from './council-sheet';

const HOUR_MS = 3_600_000;
const GOOD = { share: 0.92, pressure: 51 };
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit' });

/** Monday 19:00 in the village, in winter and in summer. */
function mondayEvening(day: string): string {
  return ['17', '18'].map((hour) => `${day}T${hour}:00:00Z`).find((at) => hourFormat.format(new Date(at)) === '19') ?? `${day}T18:00:00Z`;
}

/** Stands in for a meeting that said yes to everything, when no ticks were typed in yet. */
export function allYes(result: SheetResult, createdAt: string): PreviousCopy {
  const decisions: Record<string, Decision> = {};
  for (const line of result.lines) decisions[line.key] = 'yes';
  return { copyNo: '', createdAt, result, decisions };
}

export function nextMondayInput(input: SheetInput, copy: PreviousCopy): SheetInput {
  const now = mondayEvening(copy.result.expiresOn);
  const approved = copy.result.lines.filter((line) => copy.decisions[line.key] === 'yes');
  const repaired = new Set(approved.filter((line) => line.kind === 'approve').map((line) => line.pipe?.pipeID));
  // A pipe Maren really repaired since the copy keeps its real readings.
  const worked = new Set(input.repairs.filter((repair) => Date.parse(repair.repairDate ?? '') > Date.parse(copy.createdAt) && Date.parse(repair.repairDate ?? '') <= Date.parse(input.now)).map((repair) => repair.pipe_ID));
  const isWorked = (pipeID: string | undefined): boolean => input.pipes.some((pipe) => pipe.pipeID === pipeID && worked.has(pipe.ID));
  const waiting = new Set(approved.filter((line) => line.kind === 'approveIf' && !isWorked(line.pipe?.pipeID)).map((line) => line.pipe?.pipeID));
  const later = (hours: number): string => new Date(Date.parse(copy.createdAt) + hours * HOUR_MS).toISOString();

  const pipes = input.pipes.map((pipe) => {
    const nominal = Number(pipe.nominalFlowRate);
    if (repaired.has(pipe.pipeID)) return { ...pipe, currentFlowRate: nominal * GOOD.share, currentPressure: GOOD.pressure };
    // A small drop: 67% becomes 66%.
    if (waiting.has(pipe.pipeID)) return { ...pipe, currentFlowRate: Number(pipe.currentFlowRate) - nominal * 0.01 };
    return pipe;
  });
  const changed = new Map(pipes.filter((pipe) => repaired.has(pipe.pipeID) || waiting.has(pipe.pipeID)).map((pipe) => [pipe.ID, pipe]));
  return {
    ...input,
    now,
    pipes,
    sensors: input.sensors.map((sensor) => {
      const pipe = changed.get(sensor.pipe_ID);
      const lastReading = new Date(Date.parse(now) - 2 * 60_000).toISOString();
      return pipe ? { ...sensor, lastReading, flowRate: pipe.currentFlowRate, pressure: pipe.currentPressure } : { ...sensor, lastReading };
    }),
    repairs: [
      ...input.repairs,
      ...input.pipes.filter((pipe) => repaired.has(pipe.pipeID)).map((pipe) => ({
        pipe_ID: pipe.ID, issue: 'Cracked joint', repairDate: later(2), repairedBy: 'Maren Holt', tierAtRepair: 'alarm', modifiedAt: null, modifiedBy: null,
      })),
    ],
    deliveries: [
      ...input.deliveries,
      ...approved.flatMap((line) => line.products).filter((product) => product.cartDue !== null)
        .map((product) => ({ productId: product.id, quantity: 0, receivedAt: `${product.cartDue}T07:00:00Z` })),
    ],
    previous: copy,
  };
}
