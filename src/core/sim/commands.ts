// 指令：呈現層唯一能影響模擬的管道。純資料物件，於 tick 開頭依 FIFO 套用。

import { addResource, type GameState } from '../world/state';

export interface AddResourceCommand {
  type: 'addResource';
  resource: string;
  amount: number;
}

export type Command = AddResourceCommand;

/** 於 enqueue 入口與存檔還原時呼叫：輸入可能來自不受信任的 JSON，逐欄驗證、未知 type 一律拒絕 */
export function validateCommand(command: Command): void {
  if (typeof command !== 'object' || command === null) {
    throw new Error(`validateCommand: 指令必須是物件，收到 ${JSON.stringify(command)}`);
  }
  switch (command.type) {
    case 'addResource':
      if (typeof command.resource !== 'string' || command.resource.length === 0) {
        throw new Error(`addResource: resource 必須是非空字串，收到 ${JSON.stringify(command.resource)}`);
      }
      if (!Number.isFinite(command.amount)) {
        throw new Error(`addResource: amount 必須是有限數值，收到 ${command.amount}`);
      }
      break;
    default: {
      const unknownType = (command as { type?: unknown }).type;
      throw new Error(`validateCommand: 未知指令 type，收到 ${JSON.stringify(unknownType)}`);
    }
  }
}

export function applyCommand(state: GameState, command: Command): void {
  switch (command.type) {
    case 'addResource':
      addResource(state, command.resource, command.amount);
      break;
  }
}
