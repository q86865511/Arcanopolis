// 拆除確認：判斷一次拆除會不會造成玩家看不見的損失，並產出警告文字。
//
// 為什麼需要這道關卡：拆掉民居時，住在裡面的居民會在下一個 tick 被 jobs system
// 連帶清除（home 指向不存在的建築 → citizen 整個移除）。畫面上只是一棟房子消失，
// 人口數字卻同時掉了好幾點，而且無法復原——右鍵是單擊操作，太容易誤觸。

import type { BuildingDef } from '../data/types';
import type { Building, GameState } from '../core/world/state';

/** 以此建築為家的居民數。 */
export function residentCount(state: GameState, buildingId: string): number {
  let count = 0;
  for (const citizen of state.citizens) {
    if (citizen.home === buildingId) count += 1;
  }
  return count;
}

/** 在此建築工作的居民數。 */
export function workerCount(state: GameState, buildingId: string): number {
  let count = 0;
  for (const citizen of state.citizens) {
    if (citizen.job === buildingId) count += 1;
  }
  return count;
}

/**
 * 回傳警告文字；不需要確認就回 null。
 *
 * 只有「住戶會消失」值得攔一次——工人被拆只是失去工作，下一 tick 就會被重新指派到別處，
 * 是可回復的；住戶則是直接從人口中消失，不可回復。把兩者都攔會讓確認變成噪音，
 * 玩家開始無腦連按兩次右鍵，這道關卡就白設了。
 */
export function demolitionWarning(
  state: GameState,
  building: Building,
  def: BuildingDef | undefined,
): string | null {
  const residents = residentCount(state, building.id);
  if (residents <= 0) return null;
  const name = def?.name ?? building.type;
  return `拆除「${name}」會讓 ${residents} 名居民失去住所並消失——再按一次右鍵確認，或按 Esc 取消`;
}
