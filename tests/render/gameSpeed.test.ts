// 遊戲速度檔位（src/render/gameSpeed.ts）
import { describe, expect, it } from 'vitest';
import {
  INITIAL_SPEED,
  SPEED_STEPS,
  changeSpeed,
  speedLabel,
  speedMultiplier,
  togglePause,
} from '../../src/render/gameSpeed';

describe('speedMultiplier', () => {
  it('未暫停時回傳對應檔位倍率', () => {
    for (const [index, step] of SPEED_STEPS.entries()) {
      expect(speedMultiplier({ stepIndex: index, paused: false })).toBe(step);
    }
  });

  it('暫停時恆為 0：模擬時間完全不前進', () => {
    for (let index = 0; index < SPEED_STEPS.length; index++) {
      expect(speedMultiplier({ stepIndex: index, paused: true })).toBe(0);
    }
  });

  it('開局是 1× 且未暫停', () => {
    expect(speedMultiplier(INITIAL_SPEED)).toBe(1);
    expect(INITIAL_SPEED.paused).toBe(false);
  });
});

describe('changeSpeed', () => {
  it('加速與減速各移動一檔', () => {
    expect(changeSpeed({ stepIndex: 0, paused: false }, 1).stepIndex).toBe(1);
    expect(changeSpeed({ stepIndex: 1, paused: false }, -1).stepIndex).toBe(0);
  });

  it('在頭尾夾住，不會越界', () => {
    expect(changeSpeed({ stepIndex: 0, paused: false }, -1).stepIndex).toBe(0);
    const lastIndex = SPEED_STEPS.length - 1;
    expect(changeSpeed({ stepIndex: lastIndex, paused: false }, 1).stepIndex).toBe(lastIndex);
  });

  it('暫停中按加速：先解除暫停且不跳檔（玩家要的是「動起來」，不是更快）', () => {
    const result = changeSpeed({ stepIndex: 1, paused: true }, 1);
    expect(result.paused).toBe(false);
    expect(result.stepIndex).toBe(1);
  });

  it('暫停中按減速：仍維持暫停，只調整解除後會用的檔位', () => {
    const result = changeSpeed({ stepIndex: 2, paused: true }, -1);
    expect(result.paused).toBe(true);
    expect(result.stepIndex).toBe(1);
  });

  it('回傳新物件，不就地修改輸入', () => {
    const original = { stepIndex: 0, paused: false };
    changeSpeed(original, 1);
    expect(original.stepIndex).toBe(0);
  });
});

describe('togglePause 與 speedLabel', () => {
  it('togglePause 來回切換且不動檔位', () => {
    const paused = togglePause({ stepIndex: 2, paused: false });
    expect(paused).toEqual({ stepIndex: 2, paused: true });
    expect(togglePause(paused)).toEqual({ stepIndex: 2, paused: false });
  });

  it('標籤：暫停顯示「暫停」，否則顯示倍率', () => {
    expect(speedLabel({ stepIndex: 0, paused: true })).toBe('暫停');
    expect(speedLabel({ stepIndex: 0, paused: false })).toBe('1×');
    expect(speedLabel({ stepIndex: SPEED_STEPS.length - 1, paused: false })).toBe(
      `${SPEED_STEPS[SPEED_STEPS.length - 1]}×`,
    );
  });
});
