// 遊戲速度檔位：純資料與純函式，與 Phaser 無關，方便單元測試。
//
// 為什麼需要調速：首個日界＝實時 60 秒（600 tick × 100ms），而人口成長、糧食消耗、
// 稅收全都掛在日界上。玩家蓋完開局那幾棟之後就只能乾等一分鐘才看得到下一次變化，
// 這不是難度，是空轉。暫停則讓玩家能在不被時間推著走的情況下規劃佈局。

/** 可選的倍率檔位，由慢到快。暫停不是其中一檔，而是獨立的開關（見 GameSpeed.paused）。 */
export const SPEED_STEPS = [1, 2, 4] as const;

export interface GameSpeed {
  /** SPEED_STEPS 的索引 */
  stepIndex: number;
  paused: boolean;
}

export const INITIAL_SPEED: GameSpeed = { stepIndex: 0, paused: false };

/** 實際套用到模擬時間的倍率；暫停時為 0，模擬完全不前進。 */
export function speedMultiplier(speed: GameSpeed): number {
  return speed.paused ? 0 : SPEED_STEPS[speed.stepIndex];
}

/**
 * 調快/調慢一檔。加速時若正處於暫停，先解除暫停而不跳檔——
 * 玩家按「加速」時想要的是「動起來」，直接跳到更快的檔位會超出他的預期。
 */
export function changeSpeed(speed: GameSpeed, delta: number): GameSpeed {
  if (speed.paused && delta > 0) {
    return { ...speed, paused: false };
  }
  const next = Math.min(SPEED_STEPS.length - 1, Math.max(0, speed.stepIndex + delta));
  return { ...speed, stepIndex: next };
}

export function togglePause(speed: GameSpeed): GameSpeed {
  return { ...speed, paused: !speed.paused };
}

export function speedLabel(speed: GameSpeed): string {
  return speed.paused ? '暫停' : `${SPEED_STEPS[speed.stepIndex]}×`;
}
