// 存檔持久化：把 core 的 serialize/deserialize 接到瀏覽器的 localStorage。
//
// core 的存檔模組（schema v5、遷移鏈、欄位驗證）先前完全沒有被遊戲用到——存了五個版本、
// 寫了三個測試檔，玩家卻連一次都存不了，重新整理就整座城市歸零。這個模組補上那條線。
//
// 儲存介面抽成參數而非直接抓全域 localStorage：headless 測試沒有 localStorage，
// 且真實環境會因為無痕模式或配額用盡而丟例外，兩者都要能在不碰瀏覽器的情況下測到。

import { OutdatedSaveError, deserializeGameState, serializeGameState } from '../core/save/save';
import type { GameState } from '../core/world/state';

export const SAVE_KEY = 'arcanopolis:save';

/** localStorage 的最小可用面；真實的 Storage 物件天然符合。 */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type SaveOutcome =
  | { ok: true }
  /** 寫入失敗（配額用盡、無痕模式停用寫入等）。存檔失敗不該中斷遊戲，回報給呼叫端顯示即可。 */
  | { ok: false; reason: string };

export type LoadOutcome =
  | { status: 'loaded'; state: GameState }
  | { status: 'empty' }
  /** 存檔存在但讀不回來：schema 損毀、被手動改壞、或舊版遷移失敗。 */
  | { status: 'corrupt'; reason: string }
  /** 存檔是已作廢的舊版本（v6 起 v1–v5 一律作廢）。與 corrupt 分開是為了讓 UI
   *  說「舊版不相容」而不是「讀不回來」——後者會讓玩家以為遊戲有 bug。 */
  | { status: 'outdated'; savedVersion: number };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function saveGame(storage: SaveStorage, state: GameState): SaveOutcome {
  let json: string;
  try {
    json = serializeGameState(state);
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }
  try {
    storage.setItem(SAVE_KEY, json);
  } catch (error) {
    // 配額用盡是最可能的原因，而且會在城市變大後才發生——訊息要帶原因，
    // 否則玩家只會看到「存檔失敗」卻不知道是自己的城市太大還是瀏覽器設定問題。
    return { ok: false, reason: describe(error) };
  }
  return { ok: true };
}

export function loadGame(storage: SaveStorage): LoadOutcome {
  let json: string | null;
  try {
    json = storage.getItem(SAVE_KEY);
  } catch (error) {
    return { status: 'corrupt', reason: describe(error) };
  }
  if (json === null || json.length === 0) return { status: 'empty' };

  try {
    return { status: 'loaded', state: deserializeGameState(json) };
  } catch (error) {
    if (error instanceof OutdatedSaveError) {
      return { status: 'outdated', savedVersion: error.savedVersion };
    }
    // 壞掉的存檔不自動刪除：玩家可能想手動搶救，而靜默清掉會讓「我的城市不見了」
    // 完全無跡可循。由呼叫端決定要不要開新局。
    return { status: 'corrupt', reason: describe(error) };
  }
}

export function clearSave(storage: SaveStorage): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // 清不掉就算了：呼叫端接著會開新局並覆寫，不值得為此中斷流程。
  }
}

/** 瀏覽器的 localStorage；取不到（SSR、隱私設定）時回 null，呼叫端退化為不存檔。 */
export function browserStorage(): SaveStorage | null {
  try {
    const storage = globalThis.localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}
