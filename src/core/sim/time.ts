// 時間系統：tick 是唯一時間來源，遊戲時間一律由 tick 純函式推算（不得使用 Date）。

export const TICKS_PER_DAY = 600;
export const DAYS_PER_SEASON = 30;

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;

export interface GameTime {
  /** 日內 tick，0 ~ TICKS_PER_DAY-1 */
  tickOfDay: number;
  /** 季內日，1 ~ DAYS_PER_SEASON */
  day: number;
  season: Season;
  /** 從 1 起算 */
  year: number;
  /** 全域日序，從 1 起算 */
  totalDay: number;
}

export function timeFromTick(tick: number): GameTime {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new Error(`timeFromTick: tick 必須是非負整數，收到 ${tick}`);
  }
  const dayIndex = Math.floor(tick / TICKS_PER_DAY);
  return {
    tickOfDay: tick % TICKS_PER_DAY,
    day: (dayIndex % DAYS_PER_SEASON) + 1,
    season: SEASONS[Math.floor(dayIndex / DAYS_PER_SEASON) % SEASONS.length],
    year: Math.floor(dayIndex / DAYS_PER_YEAR) + 1,
    totalDay: dayIndex + 1,
  };
}
