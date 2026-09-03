import { describe, expect, it } from 'vitest';
import {
  DAY_PHASE_LABEL,
  clockLabel,
  dayPhase,
  nightStrength,
  nightTint,
  quantizeStrength,
} from '../../src/render/dayNight';

describe('nightStrength', () => {
  it('白天為 0、夜晚為 1，黃昏中段介於兩者之間', () => {
    expect(nightStrength(0)).toBe(0);
    expect(nightStrength(125)).toBe(0);
    expect(nightStrength(375)).toBe(1);
    expect(nightStrength(425)).toBe(1);
    expect(nightStrength(300)).toBeGreaterThan(0);
    expect(nightStrength(300)).toBeLessThan(1);
  });

  it('18:00→20:00 單調增強，05:00→07:00 單調減弱', () => {
    const dusk = [275, 287, 300, 312, 325].map(nightStrength);
    const dawn = [550, 562, 575, 587, 600].map(nightStrength);
    expect(dusk).toEqual([...dusk].sort((a, b) => a - b));
    expect(dawn).toEqual([...dawn].sort((a, b) => b - a));
    expect(dusk[0]).toBe(0);
    expect(dusk.at(-1)).toBe(1);
    expect(dawn[0]).toBe(1);
    expect(dawn.at(-1)).toBe(0);
  });
});

describe('dayPhase 與 clockLabel', () => {
  it('依時段邊界分類並提供繁中標籤', () => {
    expect(dayPhase(0)).toBe('day');
    expect(dayPhase(275)).toBe('dusk');
    expect(dayPhase(325)).toBe('night');
    expect(dayPhase(550)).toBe('dawn');
    expect(DAY_PHASE_LABEL).toEqual({ dawn: '清晨', day: '白天', dusk: '黃昏', night: '夜晚' });
  });

  it('把日內 tick 格式化為 HH:MM', () => {
    expect(clockLabel(0)).toBe('07:00');
    expect(clockLabel(125)).toBe('12:00');
    expect(clockLabel(285)).toBe('18:24');
    expect(clockLabel(425)).toBe('00:00');
  });
});

describe('nightTint 與 quantizeStrength', () => {
  it('夜色保留偏藍亮度並額外降飽和', () => {
    expect(nightTint(0)).toEqual({ r: 1, g: 1, b: 1, saturationDelta: -0 });
    const fullNight = nightTint(1);
    expect(fullNight.r).toBeCloseTo(0.45);
    expect(fullNight.g).toBeCloseTo(0.55);
    expect(fullNight.b).toBeCloseTo(0.75);
    expect(fullNight.saturationDelta).toBeCloseTo(-0.2);
  });

  it('以 1/64 量化並夾在 0..1', () => {
    expect(quantizeStrength(-1)).toBe(0);
    expect(quantizeStrength(0.01)).toBe(1 / 64);
    expect(quantizeStrength(0.5)).toBe(0.5);
    expect(quantizeStrength(2)).toBe(1);
  });
});
