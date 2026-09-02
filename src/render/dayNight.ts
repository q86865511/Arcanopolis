import { TICKS_PER_DAY } from '../core/sim/time';

const START_HOUR = 7;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export const DAY_PHASE_LABEL: Readonly<Record<DayPhase, string>> = Object.freeze({
  dawn: '清晨',
  day: '白天',
  dusk: '黃昏',
  night: '夜晚',
});

function normalizedTick(tickOfDay: number): number {
  return ((tickOfDay % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
}

function clampStrength(strength: number): number {
  if (!Number.isFinite(strength)) return strength === Number.POSITIVE_INFINITY ? 1 : 0;
  return Math.min(1, Math.max(0, strength));
}

function smoothstep(value: number): number {
  const t = clampStrength(value);
  return t * t * (3 - 2 * t);
}

export function hourOfDay(tickOfDay: number): number {
  return (START_HOUR + (normalizedTick(tickOfDay) / TICKS_PER_DAY) * HOURS_PER_DAY) % HOURS_PER_DAY;
}

export function nightStrength(tickOfDay: number): number {
  const hour = hourOfDay(tickOfDay);
  if (hour >= 7 && hour < 18) return 0;
  if (hour >= 18 && hour < 20) return smoothstep((hour - 18) / 2);
  if (hour >= 5 && hour < 7) return 1 - smoothstep((hour - 5) / 2);
  return 1;
}

export function dayPhase(tickOfDay: number): DayPhase {
  const hour = hourOfDay(tickOfDay);
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 18) return 'day';
  if (hour >= 18 && hour < 20) return 'dusk';
  return 'night';
}

export function clockLabel(tickOfDay: number): string {
  const minutesPerDay = HOURS_PER_DAY * MINUTES_PER_HOUR;
  const minutes = Math.floor(
    (START_HOUR * MINUTES_PER_HOUR + (normalizedTick(tickOfDay) / TICKS_PER_DAY) * minutesPerDay) %
      minutesPerDay,
  );
  const hour = Math.floor(minutes / MINUTES_PER_HOUR);
  const minute = minutes % MINUTES_PER_HOUR;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function nightTint(strength: number): {
  r: number;
  g: number;
  b: number;
  saturationDelta: number;
} {
  const s = clampStrength(strength);
  return {
    r: 1 - 0.55 * s,
    g: 1 - 0.45 * s,
    b: 1 - 0.25 * s,
    saturationDelta: -0.2 * s,
  };
}

export function quantizeStrength(strength: number): number {
  return Math.round(clampStrength(strength) * 64) / 64;
}
