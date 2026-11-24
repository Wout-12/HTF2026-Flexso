/** Demo only: lets the pantry pretend it is another day. In memory; a restart brings back today. */
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' });
let demoDay: string | null = null;

export const dayOf = (date: string | Date): string => dayFormat.format(new Date(date));
export const realToday = (): string => dayOf(new Date());
export const today = (): string => demoDay ?? realToday();
export const isDemo = (): boolean => demoDay !== null;
export function setDemoDay(day: string | null): void {
  demoDay = day;
}
