// System 介面：模擬的行為單元。Simulation 依註冊順序每 tick 呼叫一次 update。

import type { GameState } from '../world/state';
import type { Rng } from './rng';
import type { GameTime } from './time';

/** 每 tick 重組的執行環境；system 只能透過 ctx.rng 取得隨機性 */
export interface SimContext {
  rng: Rng;
  time: GameTime;
}

export interface System {
  id: string;
  update(state: GameState, ctx: SimContext): void;
}
