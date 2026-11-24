/**
 * The Oakhaven Square: village weather and village news, for everybody. Pure function: no database
 * and no clock of its own. It only returns finished sentences, because the square is public: no
 * names behind a doubtful change, no raw readings, no money unless the council said yes.
 */
import type { Decision, MoneyLine, SheetResult } from './council-sheet';
import { addDays, daysBetween } from './pantry-forecast';

export type Mood = 'sunny' | 'cloudy' | 'rain' | 'storm';
export type Kind = 'water' | 'bakery' | 'council' | 'library' | 'mystery';

export interface SquareInput {
  readonly now: string;
  readonly sheet: SheetResult;
  /** Job number of today per pipe, from Maren's route. */
  readonly jobSlots: Readonly<Record<string, number | null>>;
  /** Real, unmarked repairs; `by` is only filled for a known villager. */
  readonly repairs: readonly { readonly pipeID: string; readonly at: string; readonly by: string | null }[];
  readonly deliveries: readonly { readonly product: string; readonly supplier: string; readonly at: string }[];
  readonly orders: readonly { readonly product: string; readonly supplier: string; readonly dueOn: string }[];
  /** Products at panic in Tobin's forecast. */
  readonly panic: readonly string[];
  /** The last sheet the council ticked. */
  readonly decided: { readonly at: string; readonly lines: readonly MoneyLine[]; readonly decisions: Readonly<Record<string, Decision>> } | null;
  /** Only what Ilse decided herself, on the value that is still there. */
  readonly notices: readonly { readonly recordType: string; readonly name: string; readonly pipeID: string | null; readonly cleared: boolean }[];
}

export interface NewsItem { readonly kind: Kind; readonly text: string; readonly date: string; readonly good: boolean }
export interface Square {
  readonly mood: Mood;
  readonly sentence: string;
  readonly news: readonly NewsItem[];
  readonly isDemo: boolean;
}

const REPAIR_DAYS = 7;
const DELIVERY_DAYS = 3;
const COUNCIL_DAYS = 7;
const OLD_COUNT_DAYS = 7;
const SATURDAY = 6;
const MONDAY = 1;
const MEETING_TIME = '19:00';

const stampFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short' });
const longFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const weekFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' });
const localStamp = (at: string): string => stampFormat.format(new Date(at));
const dayOf = (at: string): string => localStamp(at).slice(0, 10);
const date = (day: string): Date => new Date(`${day}T00:00:00Z`);
const weekday = (day: string): number => date(day).getUTCDay();

/** "today", "yesterday", "on Monday" (this week) or "on 16 November". */
function dayText(day: string, today: string): string {
  const ago = daysBetween(day, today);
  if (ago === 0) return 'today';
  if (ago === 1) return 'yesterday';
  if (ago === -1) return 'tomorrow';
  return Math.abs(ago) < 7 ? `on ${weekFormat.format(date(day))}` : `on ${longFormat.format(date(day))}`;
}

const place = (name: string): string => name.replace(/ Area$/, '').replace(/^The /, 'the ');
const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
function joined(names: readonly string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
export const pipeName = (pipeID: string): string => pipeID.toLowerCase().replace(/(^|-)(\w)/g, (_match, dash: string, letter: string) => (dash ? ' ' : '') + letter.toUpperCase());

/** Words instead of a reading; null when the flow itself is nearly normal. */
export function fraction(percent: number): string | null {
  const steps: readonly [number, string][] = [[25, 'a quarter'], [40, 'a third'], [55, 'half'], [70, 'two-thirds'], [85, 'three-quarters']];
  return steps.find(([limit]) => percent <= limit)?.[1] ?? null;
}

// ---- weather -------------------------------------------------------------------------------

function weather(input: SquareInput): { mood: Mood; sentence: string } {
  const { water, food } = input.sheet;
  const inState = (state: string): string[] => water.areas.filter((area) => area.state === state).map((area) => place(area.name));
  const [short, low, unknown] = [inState('badlyShort'), inState('runningLow'), inState('cantTell')];
  const open = input.notices.filter((notice) => !notice.cleared);
  const is = (names: readonly string[], text: string): string => `${joined(names)} ${names.length > 1 ? 'are' : 'is'} ${text}`;

  const shortages: string[] = [];
  if (short.length > 0) shortages.push(is(short, 'badly short on water'));
  if (food.verdict === 'notAllRight') shortages.push('some food runs out before it can arrive');
  if (low.length > 0) shortages.push(is(low, 'running low on water'));
  if (food.verdict === 'notYet') shortages.push('some food runs out this week unless it is ordered in time');
  if (food.verdict === 'atRisk') shortages.push('some food depends on a delivery that is still on its way');
  const doubts: string[] = [];
  if (unknown.length > 0) doubts.push(`We can't tell about the water at ${joined(unknown)}.`);
  if (food.verdict === 'cantTell') doubts.push("We can't be sure about food until Tobin's recount.");
  if (open.length > 0) doubts.push('The library is checking a number.');

  const mood: Mood = short.length > 0 || food.verdict === 'notAllRight' ? 'storm' : shortages.length > 0 ? 'rain' : doubts.length > 0 ? 'cloudy' : 'sunny';
  const word = { storm: 'Stormy.', rain: 'Rainy.', cloudy: 'Cloudy.', sunny: 'Sunny.' }[mood];
  if (mood === 'sunny') return { mood, sentence: `${word} Everyone has water and the pantry is fine this week.` };
  const parts = [word];
  if (shortages.length > 0) parts.push(`${capital(shortages.slice(0, 2).join(', and '))}.`);
  parts.push(...doubts.slice(0, shortages.length > 0 ? 1 : 2));
  if (shortages.length > 2) parts.push('More on the board.');
  return { mood, sentence: parts.join(' ') };
}

// ---- news ----------------------------------------------------------------------------------

function waterNews(input: SquareInput, today: string): NewsItem[] {
  const { areas } = input.sheet.water;
  const item = (text: string, day = today, good = false): NewsItem => ({ kind: 'water', text, date: day, good });
  const news: NewsItem[] = [];
  for (const area of areas.filter((entry) => entry.worst !== null && (entry.state === 'badlyShort' || entry.state === 'runningLow'))) {
    const part = fraction(area.worst?.flowPercent ?? 100);
    const slot = input.jobSlots[area.worst?.pipeID ?? ''] ?? null;
    const plan = slot === 1 ? " It's first on Maren's route today." : slot !== null && area.state === 'badlyShort' ? " It's on Maren's route today." : area.state === 'runningLow' ? ' Maren plans a visit this week.' : '';
    news.push(item(`${capital(place(area.name))} is getting ${part ? `about ${part} of its usual water` : 'its water at low pressure'}.${plan}`));
  }
  for (const area of areas.filter((entry) => entry.state === 'cantTell')) news.push(item(`We can't tell about the water at ${place(area.name)} yet. Maren is checking.`));

  const seen = new Set<string>();
  const recent = input.repairs.filter((repair) => Date.parse(repair.at) <= Date.parse(input.now) && daysBetween(dayOf(repair.at), today) < REPAIR_DAYS).sort((a, b) => b.at.localeCompare(a.at));
  for (const repair of recent) {
    const fed = areas.filter((area) => area.path.includes(repair.pipeID));
    if (seen.has(repair.pipeID) || fed.length === 0) continue; // nobody depends on the backup loop
    seen.add(repair.pipeID);
    const [day, who] = [dayOf(repair.at), repair.by ?? 'The water crew'];
    const back = fed.filter((area) => area.state === 'fine').map((area) => place(area.name));
    if (back.length === fed.length) news.push(item(`Water is back to normal at ${joined(back)} after ${repair.by ? `${repair.by}'s` : 'a'} repair ${dayText(day, today)}.`, day, true));
    else news.push(item(`${who} worked on ${pipeName(repair.pipeID)} ${dayText(day, today)}. The water isn't back to normal yet.`, day));
  }
  const fine = areas.filter((area) => area.state === 'fine').map((area) => place(area.name));
  if (fine.length > 0) news.push(item(`Full water today at ${joined(fine)}.`, today, true));
  return news;
}

function bakeryNews(input: SquareInput, today: string): NewsItem[] {
  const item = (text: string, day = today, good = false): NewsItem => ({ kind: 'bakery', text, date: day, good });
  const news: NewsItem[] = [];
  const { food } = input.sheet;
  const carts = new Map<string, { supplier: string; day: string; products: string[] }>();
  for (const delivery of input.deliveries) {
    const day = dayOf(delivery.at);
    if (Date.parse(delivery.at) > Date.parse(input.now) || daysBetween(day, today) >= DELIVERY_DAYS) continue;
    const key = `${day} ${delivery.supplier}`;
    const cart = carts.get(key) ?? { supplier: delivery.supplier, day, products: [] };
    const name = delivery.product.toLowerCase();
    if (!cart.products.includes(name)) cart.products.push(name);
    carts.set(key, cart);
  }
  for (const cart of carts.values()) news.push(item(`Fresh ${joined(cart.products)} arrived from ${cart.supplier} ${dayText(cart.day, today)}.`, cart.day, true));
  for (const line of food.lines.filter((entry) => entry.reliable && (entry.state === 'notAllRight' || input.panic.includes(entry.name)))) {
    news.push(item(`${line.name} will be scarce until ${line.orderedFor && line.orderedFor >= today ? `the delivery ${dayText(line.orderedFor, today)}` : 'the next delivery'}.`));
  }
  if (food.verdict === 'cantTell') {
    const old = food.lines.filter((line) => (line.ageDays ?? 0) > OLD_COUNT_DAYS).length > food.lines.length / 2;
    news.push(item(`We can't tell about food yet. ${old ? 'Most pantry counts are over a week old' : 'Some pantry counts are not sure enough'}, so Tobin needs to count again.`));
  }
  const saturday = addDays(today, (SATURDAY - weekday(today) + 7) % 7);
  const until = daysBetween(today, saturday);
  if (until === 0) news.push(item('Market day today! Expect a busy bakery.', today, true));
  else if (until === 1) news.push(item('Market day tomorrow! Expect a busy bakery.', today, true));
  else news.push(item(`Market day this Saturday, ${longFormat.format(date(saturday))}. Expect a busy bakery.`, today, true));
  for (const order of input.orders.filter((entry) => entry.dueOn >= today)) news.push(item(`${order.product} ${/s$/.test(order.product) ? 'are' : 'is'} on order from ${order.supplier}, due ${dayText(order.dueOn, today)}.`));
  return news;
}

function councilNews(input: SquareInput, today: string): NewsItem[] {
  const news: NewsItem[] = [];
  const { decided } = input;
  if (decided && daysBetween(dayOf(decided.at), today) < COUNCIL_DAYS) {
    for (const line of decided.lines.filter((entry) => decided.decisions[entry.key] === 'yes')) {
      const pipe = line.everyone ? 'the main pipe' : `the pipe to ${joined(line.places.map((entry) => place(entry.name)))}`;
      const what = { approve: `to repair ${pipe}`, approveIf: `to repair ${pipe}, if it's needed`, buffer: "for one urgent repair, if it's needed", reserve: `for an emergency food cart from ${line.supplier}, if it's needed` }[line.kind];
      news.push({ kind: 'council', text: `The council set aside about ${line.crowns} crowns ${what}.`, date: dayOf(decided.at), good: true });
    }
  }
  const tonight = weekday(today) === MONDAY && localStamp(input.now).slice(11) < MEETING_TIME;
  const monday = addDays(today, ((MONDAY - weekday(today) + 6) % 7) + 1);
  news.push({ kind: 'council', text: tonight ? "The council meets tonight at 7pm at Shepherd's Inn." : `The council meets on Monday ${longFormat.format(date(monday))} at 7pm at Shepherd's Inn.`, date: today, good: false });
  return news;
}

function libraryNews(input: SquareInput, today: string): NewsItem[] {
  return input.notices.map((notice) => {
    const pipe = notice.pipeID ? pipeName(notice.pipeID) : notice.name;
    const things: Readonly<Record<string, string>> = { StockItem: `${notice.name.toLowerCase()} count`, Sensor: `water meter on ${pipe}`, Repair: `repair record for ${pipe}`, WaterPipe: `reading of ${pipe}` };
    const thing = things[notice.recordType] ?? 'record of a village place';
    return { kind: 'library', text: notice.cleared ? `The library has finished checking the ${thing}.` : `Don't rely on the ${thing} for now. The library is checking it.`, date: today, good: notice.cleared };
  });
}

/** Trouble first, then what changed, then the rest; good news in between, so it never reads as only bad. */
function ordered(news: readonly NewsItem[], today: string): NewsItem[] {
  const weight = (item: NewsItem): number => {
    if (item.kind === 'mystery') return 9;
    if (item.kind === 'water' && !item.good) return 0;
    if (item.kind === 'library') return 1;
    if (item.good && item.kind !== 'council' && !item.text.startsWith('Full') && !item.text.startsWith('Market')) return 2;
    if (item.kind === 'council' && item.good) return 3;
    if (item.kind === 'water') return 4;
    return item.kind === 'bakery' ? 5 : 6;
  };
  return news.map((item, index) => ({ item, index })).sort((a, b) => weight(a.item) - weight(b.item) || daysBetween(a.item.date, b.item.date) || a.index - b.index).map(({ item }) => ({ ...item, date: item.date || today }));
}

export function buildSquare(input: SquareInput): Square {
  const today = dayOf(input.now);
  const mystery: NewsItem = {
    kind: 'mystery', good: false, date: today, text: 'An old line in the repair book is signed only "W. S.", from the longest night of 2024. The library would like to know who wrote it.',
  };
  return {
    ...weather(input),
    news: ordered([...waterNews(input, today), ...libraryNews(input, today), ...bakeryNews(input, today), ...councilNews(input, today), mystery], today),
    isDemo: input.sheet.isDemo,
  };
}
