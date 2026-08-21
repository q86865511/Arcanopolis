// R2：時間系統（src/core/sim/time.ts）
import { describe, expect, it } from 'vitest';
import { DAYS_PER_SEASON, TICKS_PER_DAY, timeFromTick } from '../../src/core/sim/time';

describe('時間系統常數', () => {
  it('TICKS_PER_DAY = 600', () => {
    expect(TICKS_PER_DAY).toBe(600);
  });

  it('DAYS_PER_SEASON = 30', () => {
    expect(DAYS_PER_SEASON).toBe(30);
  });
});

describe('timeFromTick：tick 轉遊戲時間', () => {
  it('tick 0 → spring day1 year1 tickOfDay0 totalDay1', () => {
    const t = timeFromTick(0);
    expect(t.tickOfDay).toBe(0);
    expect(t.day).toBe(1);
    expect(t.season).toBe('spring');
    expect(t.year).toBe(1);
    expect(t.totalDay).toBe(1);
  });

  it('日內 tick 換算：tick 650 → day2 tickOfDay50（同日內）', () => {
    const t = timeFromTick(650);
    expect(t.day).toBe(2);
    expect(t.tickOfDay).toBe(50);
    expect(t.season).toBe('spring');
    expect(t.totalDay).toBe(2);
  });

  it('日界：tick 600 → 進入 day2，tickOfDay 歸零', () => {
    const t = timeFromTick(600);
    expect(t.tickOfDay).toBe(0);
    expect(t.day).toBe(2);
    expect(t.totalDay).toBe(2);
  });

  it('季界前：tick 17400（day30 開始，spring 最後一天）', () => {
    const t = timeFromTick(17400);
    expect(t.season).toBe('spring');
    expect(t.day).toBe(30);
    expect(t.year).toBe(1);
    expect(t.totalDay).toBe(30);
  });

  it('季界：tick 18000（day31 起換季為 summer，季內 day 歸1）', () => {
    const t = timeFromTick(18000);
    expect(t.season).toBe('summer');
    expect(t.day).toBe(1);
    expect(t.year).toBe(1);
    expect(t.totalDay).toBe(31);
  });

  it('年界前：tick 71400（year1 winter day30，全年最後一天）', () => {
    const t = timeFromTick(71400);
    expect(t.season).toBe('winter');
    expect(t.day).toBe(30);
    expect(t.year).toBe(1);
    expect(t.totalDay).toBe(120);
  });

  it('年界：tick 72000（第4季第30日之後 → year2 spring day1）', () => {
    const t = timeFromTick(72000);
    expect(t.season).toBe('spring');
    expect(t.day).toBe(1);
    expect(t.year).toBe(2);
    expect(t.totalDay).toBe(121);
    expect(t.tickOfDay).toBe(0);
  });

  it('界線前最後一 tick：599 仍是 day1、17999 仍是 spring、71999 仍是 year1', () => {
    const beforeDay = timeFromTick(599);
    expect(beforeDay.day).toBe(1);
    expect(beforeDay.tickOfDay).toBe(599);
    expect(beforeDay.totalDay).toBe(1);

    const beforeSeason = timeFromTick(17999);
    expect(beforeSeason.season).toBe('spring');
    expect(beforeSeason.day).toBe(30);
    expect(beforeSeason.tickOfDay).toBe(599);

    const beforeYear = timeFromTick(71999);
    expect(beforeYear.year).toBe(1);
    expect(beforeYear.season).toBe('winter');
    expect(beforeYear.day).toBe(30);
    expect(beforeYear.tickOfDay).toBe(599);
  });

  it('非法 tick：負數與非整數都 throw', () => {
    expect(() => timeFromTick(-1)).toThrow();
    expect(() => timeFromTick(0.5)).toThrow();
  });
});
