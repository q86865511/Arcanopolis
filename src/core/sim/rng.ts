// 決定論隨機數：mulberry32。狀態為單一 32 位元整數，可直接存進 GameState 並 JSON 序列化。

export interface Rng {
  /** [0, 1) 浮點數 */
  next(): number;
  /** [min, max] 含兩端的整數 */
  nextInt(min: number, max: number): number;
  getState(): number;
  setState(state: number): void;
}

export function createRng(seed: number): Rng {
  if (!Number.isFinite(seed)) {
    throw new Error(`createRng: seed 必須是有限數值，收到 ${seed}`);
  }
  // seed 直接作為初始狀態，因此 createRng(rng.getState()) 等同於還原該 rng。
  let s = seed >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    nextInt(min: number, max: number): number {
      if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
        throw new Error(`nextInt: 需要整數且 min <= max，收到 (${min}, ${max})`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    getState(): number {
      return s;
    },
    setState(state: number): void {
      if (!Number.isFinite(state)) {
        throw new Error(`setState: 狀態必須是有限數值，收到 ${state}`);
      }
      s = state >>> 0;
    },
  };
}
