// 指令：呈現層唯一能影響模擬的管道。純資料物件，於 tick 開頭依 FIFO 套用。

import { addResource, type GameState } from '../world/state';

export interface AddResourceCommand {
  type: 'addResource';
  resource: string;
  amount: number;
}

export type Command = AddResourceCommand;

/** 於 enqueue 入口呼叫：先驗證再入列，避免批次套用中途 throw 吃掉同批後續指令 */
export function validateCommand(command: Command): void {
  switch (command.type) {
    case 'addResource':
      if (!Number.isFinite(command.amount)) {
        throw new Error(`addResource: amount 必須是有限數值，收到 ${command.amount}`);
      }
      break;
  }
}

export function applyCommand(state: GameState, command: Command): void {
  switch (command.type) {
    case 'addResource':
      addResource(state, command.resource, command.amount);
      break;
  }
}
