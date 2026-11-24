/**
 * Simulated weather for the fair: there is no weather in Oakhaven's data. It only depends on the
 * date, so every screen shows the same forecast and it rolls on from day to day. The square says
 * that it is simulated, and nothing else in the village uses it.
 */
import { addDays } from './pantry-forecast';

export type Sky = 'sunny' | 'cloudy' | 'rain' | 'storm';
export interface WeatherDay {
  readonly day: string; // yyyy-mm-dd
  readonly sky: Sky;
  readonly high: number; // °C
  readonly low: number;
  readonly rainChance: number; // %
  readonly wind: number; // km/h
}

const DAYS = 5;
/** A mild northern climate: usual day temperature per month. */
const MONTH_HIGH = [6, 7, 10, 14, 18, 21, 23, 23, 19, 15, 10, 7];

/** 0 … 1, always the same for the same text. */
function chance(text: string): number {
  let hash = 2166136261;
  for (const letter of text) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  return ((hash ^ (hash >>> 13)) >>> 0) / 4294967296;
}

function weatherOn(day: string): WeatherDay {
  const roll = chance(`${day} sky`);
  const sky: Sky = roll < 0.3 ? 'sunny' : roll < 0.62 ? 'cloudy' : roll < 0.92 ? 'rain' : 'storm';
  const range: Readonly<Record<Sky, readonly [number, number, number]>> = { sunny: [0, 10, 5], cloudy: [15, 25, 10], rain: [55, 35, 15], storm: [80, 20, 40] };
  const [rain, spread, wind] = range[sky];
  const high = MONTH_HIGH[Number(day.slice(5, 7)) - 1] + Math.round(chance(`${day} high`) * 6 - 3);
  return {
    day, sky, high, low: high - 3 - Math.round(chance(`${day} low`) * 4),
    rainChance: Math.round((rain + chance(`${day} rain`) * spread) / 5) * 5, wind: wind + Math.round(chance(`${day} wind`) * 12),
  };
}

/** Today and the next four days. */
export const simulatedWeather = (today: string): WeatherDay[] => Array.from({ length: DAYS }, (_, index) => weatherOn(addDays(today, index)));
