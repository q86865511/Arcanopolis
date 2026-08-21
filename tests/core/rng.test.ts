// R1：seeded RNG（src/core/sim/rng.ts）
import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/sim/rng';

describe('createRng：seeded 決定論隨機數產生器', () => {
  it('next() 回傳 [0,1) 範圍內的浮點數', () => {
    const rng = createRng(1);
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(typeof v).toBe('number');
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(min, max) 回傳含兩端的整數', () => {
    const rng = createRng(2);
    for (let i = 0; i < 200; i++) {
      const v = rng.nextInt(1, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
    }
  });

  it('nextInt(min, max) 於 min===max 時恆回傳該值（驗證含兩端）', () => {
    const rng = createRng(3);
    for (let i = 0; i < 10; i++) {
      expect(rng.nextInt(5, 5)).toBe(5);
    }
  });

  it('同 seed 產生完全相同的序列', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = [a.next(), a.next(), a.next(), a.nextInt(0, 100), a.nextInt(0, 100)];
    const seqB = [b.next(), b.next(), b.next(), b.nextInt(0, 100), b.nextInt(0, 100)];
    expect(seqA).toEqual(seqB);
  });

  it('不同 seed 產生不同的序列', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).not.toEqual(seqB);
  });

  it('known-answer：seed 1 的前四個值鎖定 mulberry32 演算法（換演算法=既有存檔隨機序列斷裂）', () => {
    const rng = createRng(1);
    expect([rng.next(), rng.next(), rng.next(), rng.next()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
    ]);
  });

  it('nextInt(0, 1) 在 200 次抽樣中兩端都實際出現（上界包含語義）', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(rng.nextInt(0, 1));
    expect(seen.has(0)).toBe(true);
    expect(seen.has(1)).toBe(true);
  });

  it('seed 0 與 uint32 wrap 邊界：可運作且狀態維持 uint32', () => {
    const zero = createRng(0);
    expect(zero.next()).toBe(0.26642920868471265);
    expect(zero.getState()).toBe(1831565813);

    const wrap = createRng(0xffffffff);
    expect(wrap.next()).toBe(0.8964226141106337);
    const s = wrap.getState();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });

  it('參數驗證：非整數或 min>max 的 nextInt、非有限的 seed/setState 都 throw', () => {
    const rng = createRng(1);
    expect(() => rng.nextInt(1.5, 3.5)).toThrow();
    expect(() => rng.nextInt(3, 1)).toThrow();
    expect(() => createRng(Number.NaN)).toThrow();
    expect(() => createRng(Infinity)).toThrow();
    expect(() => rng.setState(Number.NaN)).toThrow();
  });

  it('getState() 取出的狀態可用於還原序列，還原後續序列與原 rng 一致', () => {
    const original = createRng(999);
    // 先消耗幾次，讓狀態偏離初始 seed
    original.next();
    original.next();
    const savedState = original.getState();
    const expectedNext = [original.next(), original.next(), original.next()];

    // 用不同的 seed 建立新 rng，再以 savedState 還原，之後序列應與 original 接續的序列相同
    const restored = createRng(1);
    restored.setState(savedState);
    const actualNext = [restored.next(), restored.next(), restored.next()];

    expect(actualNext).toEqual(expectedNext);
  });
});
