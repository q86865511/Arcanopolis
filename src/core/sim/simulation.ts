// 固定時步模擬迴圈。同 seed ＋同指令序列（相同 tick 時點 enqueue）必須產出相同的 state。

import { applyCommand, validateCommand, type Command, type TradeContext } from './commands';
import { createRng } from './rng';
import type { System } from './system';
import { timeFromTick } from './time';
import type { GameState } from '../world/state';
import type { BuildingDef, RoadsConfig } from '../../data/types';

export class Simulation {
  constructor(
    private readonly state: GameState,
    private readonly systems: System[],
    private readonly defs: BuildingDef[] = [],
    /** 省略時 trade 指令一律靜默跳過——headless 工具與既有測試不需要市場即可建構 Simulation。 */
    private readonly trade?: TradeContext,
    /** 省略時道路指令一律靜默跳過，保持既有呼叫端語義。 */
    private readonly roads?: RoadsConfig,
  ) {}

  /** 指令不立即生效，於下一次 tick 開頭依 FIFO 套用；非法指令在入口即拒收，保持批次套用原子
   *  佇列存於 state.pendingCommands（而非 Simulation 私有欄位），使存檔可攜帶尚未套用的指令。 */
  enqueue(command: Command): void {
    validateCommand(command);
    this.state.pendingCommands.push(command);
  }

  // tick 語義：指令套用 → tick+1 → systems。ctx 以遞增後的 tick 組成，
  // 因此 system 眼中的時間從 tick=1 開始（第 1 日只出現 tickOfDay 1~599，tickOfDay 0 首見於第 2 日）；
  // ctx 僅在該 tick 內有效，system 不得留存 ctx.rng 供 tick 之外使用。
  tick(): void {
    // 佇列在 state 上是公開資料（可能被繞過 enqueue 直接塞），套用前整批重驗：
    // 驗證失敗時佇列原封不動、零套用，維持批次原子性。
    for (const command of this.state.pendingCommands) {
      validateCommand(command);
    }
    // 先取出整批再清空：system 於本 tick 內 enqueue 的指令留到下一 tick。
    const batch = this.state.pendingCommands.splice(0, this.state.pendingCommands.length);
    for (const command of batch) {
      applyCommand(this.state, command, this.defs, this.trade, this.roads);
    }

    this.state.tick += 1;

    // rng 由 state 還原再寫回，使模擬可從任一存檔點接續而不影響隨機序列。
    const rng = createRng(this.state.rngState);
    const ctx = { rng, time: timeFromTick(this.state.tick) };
    try {
      for (const system of this.systems) {
        // async/thenable update 會在 rngState 寫回後才消耗 rng，靜默破壞決定論——直接擋下。
        const result = (system.update as (s: GameState, c: typeof ctx) => unknown)(this.state, ctx);
        if (typeof (result as { then?: unknown } | null | undefined)?.then === 'function') {
          throw new Error(`Simulation: system "${system.id}" 的 update 回傳 Promise/thenable，System.update 必須是同步函式`);
        }
      }
    } finally {
      // system 拋錯也要寫回：已消耗的隨機數不可因例外而重播，否則 catch 後續跑即狀態撕裂。
      this.state.rngState = rng.getState();
    }
  }

  run(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new Error(`run: ticks 必須是非負整數，收到 ${ticks}`);
    }
    for (let i = 0; i < ticks; i++) {
      this.tick();
    }
  }
}
