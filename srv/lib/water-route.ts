/**
 * Today's Route: decides how bad every pipe is and where Maren's crew goes first.
 * Pure functions, no database. Every rule here comes from the interview with Maren,
 * except the ones marked "our choice".
 */

export type Tier = 'alarm' | 'unknown' | 'thisWeek' | 'ok';

type Num = number | string | null;

export interface RouteInput {
  readonly pipes: readonly {
    ID: string; pipeID: string; pipelineType: string | null; startPoint: string | null; endPoint: string | null;
    nominalFlowRate: Num; currentFlowRate: Num; currentPressure: Num;
  }[];
  readonly sensors: readonly { pipe_ID: string; flowRate: Num; pressure: Num; lastReading: string | null }[];
  readonly repairs: readonly { pipe_ID: string; repairDate: string | null; tierAtRepair: string | null }[];
  readonly deferrals: readonly { pipe_ID: string; reason: string | null; deferredAt: string | null; tierAtDeferral: string | null }[];
  readonly landmarks: readonly { name: string; suppliedBy: string | null; servicePriority: number | null; serviceNote: string | null }[];
}

/** The virtual fields of WaterPipes, by name. */
export interface RouteFields {
  tier: Tier;
  rank: number | null;
  jobSlot: number | null;
  flowPercent: number | null;
  affects: string;
  upstreamOf: string;
  reason: string;
  isBackup: boolean;
  readingsFresh: boolean;
  readingAgeMinutes: number | null;
  sendToIlse: boolean;
  repairedToday: boolean;
  deferredToday: boolean;
  carriedSince: string | null;
  carriedReason: string | null;
}

export interface RouteResult {
  readonly fields: RouteFields;
  readonly flow: number | null;
  readonly pressure: number | null;
}

type Pipe = RouteInput['pipes'][number];
type Landmark = RouteInput['landmarks'][number];

/** Alarm and "visit this week" lines: below the line counts, on the line does not. */
const LIMITS = {
  alarm: { flowPercent: 50, pressure: 25 },
  thisWeek: { flowPercent: 80, pressure: 40 },
} as const;
const MAX_READING_AGE_MINUTES = 15;
const JOBS_PER_DAY = 2;
const NO_PRIORITY = Number.MAX_SAFE_INTEGER;
const TIER_ORDER: Readonly<Record<string, number>> = { alarm: 0, unknown: 1, thisWeek: 2, ok: 3 };

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' });
const dayOf = (date: string | Date): string => dayFormat.format(new Date(date));
const toNumber = (value: Num | undefined): number | null => (value === null || value === undefined ? null : Number(value));

/**
 * The pipe itself and every pipe downstream of it.
 * Backup loops are not followed (our choice): they run back to the spring, which would make the
 * whole village depend on them.
 */
function pipesFedBy(pipe: Pipe, pipes: readonly Pipe[]): Set<Pipe> {
  const reached = new Set<Pipe>([pipe]);
  if (pipe.pipelineType !== 'secondary') {
    for (const current of reached) {
      for (const next of pipes) {
        if (next.startPoint === current.endPoint && next.pipelineType !== 'secondary') reached.add(next);
      }
    }
  }
  return reached;
}

/** The places that lose water with these pipes, most important first. */
function placesOf(pipes: ReadonlySet<Pipe>, landmarks: readonly Landmark[]): Landmark[] {
  const pipeIDs = new Set([...pipes].map((item) => item.pipeID));
  return landmarks
    .filter((place) => place.suppliedBy !== null && pipeIDs.has(place.suppliedBy))
    .sort((a, b) => (a.servicePriority ?? NO_PRIORITY) - (b.servicePriority ?? NO_PRIORITY));
}

function tierOf(flowPercent: number | null, pressure: number | null, fresh: boolean): Tier {
  if (!fresh || flowPercent === null || pressure === null) return 'unknown';
  if (flowPercent < LIMITS.alarm.flowPercent || pressure < LIMITS.alarm.pressure) return 'alarm';
  if (flowPercent < LIMITS.thisWeek.flowPercent || pressure < LIMITS.thisWeek.pressure) return 'thisWeek';
  return 'ok';
}

/** How far the worst reading sits below its tier's line, 0 … 1. */
function shortfall(tier: Tier, flowPercent: number | null, pressure: number | null): number {
  if ((tier !== 'alarm' && tier !== 'thisWeek') || flowPercent === null || pressure === null) return 0;
  const limit = LIMITS[tier];
  return Math.max((limit.flowPercent - flowPercent) / limit.flowPercent, (limit.pressure - pressure) / limit.pressure);
}

const isWorse = (tier: Tier, than: string | null): boolean => than !== null && TIER_ORDER[tier] < (TIER_ORDER[than] ?? 0);

interface Judged {
  readonly pipe: Pipe;
  readonly fields: RouteFields;
  readonly flow: number | null;
  readonly pressure: number | null;
  readonly feeds: ReadonlySet<Pipe>;
  readonly priority: number;
  readonly shortfall: number;
  readonly offToday: boolean;
}

function judge(pipe: Pipe, input: RouteInput, now: Date): Judged {
  const sensor = input.sensors
    .filter((item) => item.pipe_ID === pipe.ID)
    .sort((a, b) => Date.parse(b.lastReading ?? '1970-01-01') - Date.parse(a.lastReading ?? '1970-01-01'))[0];
  const ageMs = sensor?.lastReading ? now.getTime() - Date.parse(sensor.lastReading) : null;
  const readingsFresh = ageMs !== null && ageMs <= MAX_READING_AGE_MINUTES * 60_000;

  // Odd numbers are not Maren's to judge: a sensor that contradicts its pipe never counts here.
  const sensorFlow = toNumber(sensor?.flowRate);
  const sensorPressure = toNumber(sensor?.pressure);
  const rawFlow = toNumber(pipe.currentFlowRate);
  const rawPressure = toNumber(pipe.currentPressure);
  const isImpossible = (value: number | null): boolean => value !== null && value < 0;
  const sendToIlse =
    [sensorFlow, sensorPressure, rawFlow, rawPressure].some(isImpossible) ||
    (sensorFlow !== null && rawFlow !== null && sensorFlow !== rawFlow) ||
    (sensorPressure !== null && rawPressure !== null && sensorPressure !== rawPressure);

  const flow = isImpossible(rawFlow) ? null : rawFlow;
  const pressure = isImpossible(rawPressure) ? null : rawPressure;
  const nominal = toNumber(pipe.nominalFlowRate);
  // A sensor that reports nothing makes the pipe unknown, like a missing pipe value does.
  const complete = sensorFlow !== null && sensorPressure !== null;
  const exactPercent = flow !== null && nominal ? (flow / nominal) * 100 : null;
  const tier = tierOf(exactPercent, pressure, readingsFresh && complete);

  const today = dayOf(now);
  const repairs = input.repairs.filter(
    (item) => item.pipe_ID === pipe.ID && item.repairDate !== null && Date.parse(item.repairDate) <= now.getTime(),
  );
  const todaysRepair = repairs.find((item) => dayOf(item.repairDate ?? '') === today);
  const lastRepair = Math.max(0, ...repairs.map((item) => Date.parse(item.repairDate ?? '')));
  const deferrals = input.deferrals
    .filter((item) => item.pipe_ID === pipe.ID && item.deferredAt !== null && Date.parse(item.deferredAt) > lastRepair)
    .sort((a, b) => Date.parse(a.deferredAt ?? '') - Date.parse(b.deferredAt ?? ''));
  const todaysDeferral = deferrals.filter((item) => dayOf(item.deferredAt ?? '') === today).at(-1);
  const carried = deferrals.filter((item) => dayOf(item.deferredAt ?? '') < today);

  const feeds = pipesFedBy(pipe, input.pipes);
  const places = placesOf(feeds, input.landmarks);
  const served = input.landmarks.filter((place) => place.suppliedBy !== null);
  const affects = places.length > 1 && places.length === served.length ? 'The whole village' : places.map((place) => (place.serviceNote ? `${place.name} (${place.serviceNote})` : place.name)).join(', ');
  const flowPercent = exactPercent === null ? null : Math.round(exactPercent);
  const readings = tier === 'unknown' ? "I don't know, go and look" : `flow at ${flowPercent}%, pressure ${pressure} PSI`;

  const repairHolds = todaysRepair !== undefined && !isWorse(tier, todaysRepair.tierAtRepair);
  const deferralHolds = todaysDeferral !== undefined && !isWorse(tier, todaysDeferral.tierAtDeferral);
  return {
    pipe,
    flow,
    pressure,
    feeds,
    priority: places[0]?.servicePriority ?? NO_PRIORITY,
    shortfall: shortfall(tier, exactPercent, pressure),
    offToday: repairHolds || deferralHolds,
    fields: {
      tier,
      rank: null,
      jobSlot: null,
      flowPercent,
      affects,
      upstreamOf: '',
      reason: `${readings}${affects ? `; ${affects}` : '; backup, nobody depends on it'}`,
      isBackup: places.length === 0,
      readingsFresh,
      readingAgeMinutes: ageMs === null ? null : Math.max(0, Math.floor(ageMs / 60_000)),
      sendToIlse,
      repairedToday: todaysRepair !== undefined,
      deferredToday: deferralHolds,
      carriedSince: carried[0]?.deferredAt ?? null,
      carriedReason: carried.at(-1)?.reason ?? null,
    },
  };
}

function compare(a: Judged, b: Judged): number {
  return (
    Number(a.fields.isBackup) - Number(b.fields.isBackup) ||
    TIER_ORDER[a.fields.tier] - TIER_ORDER[b.fields.tier] ||
    a.priority - b.priority ||
    // Equally bad on the same line: upstream first, it hits more people. Pipes that share their most
    // important place are always on one line, and the upstream one feeds more pipes.
    b.feeds.size - a.feeds.size ||
    Number(a.fields.carriedSince === null) - Number(b.fields.carriedSince === null) ||
    b.shortfall - a.shortfall ||
    a.pipe.pipeID.localeCompare(b.pipe.pipeID)
  );
}

/** Ranks all pipes and hands out today's jobs. Keyed by the pipe's `ID`. */
export function buildRoute(input: RouteInput, now: Date): Map<string, RouteResult> {
  const judged = input.pipes.map((pipe) => judge(pipe, input, now));
  const flagged = judged.filter((item) => item.fields.tier !== 'ok').sort(compare);
  flagged.forEach((item, index) => { item.fields.rank = index + 1; });

  for (const item of flagged) {
    item.fields.upstreamOf = flagged
      .filter((other) => other !== item && other.fields.tier === item.fields.tier && item.feeds.has(other.pipe))
      .map((other) => other.pipe.pipeID)
      .join(',');
  }

  // Every pipe repaired today used up one of the crew's two half days.
  const jobsDone = judged.filter((item) => item.fields.repairedToday).length;
  flagged
    .filter((item) => !item.offToday)
    .slice(0, Math.max(0, JOBS_PER_DAY - jobsDone))
    .forEach((item, index) => { item.fields.jobSlot = jobsDone + index + 1; });

  return new Map(judged.map(({ pipe, fields, flow, pressure }) => [pipe.ID, { fields, flow, pressure }]));
}
