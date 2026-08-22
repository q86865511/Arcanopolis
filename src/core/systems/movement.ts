// 居民移動 system：依日夜週期在 home/job 間往返，沿最短路徑逐格移動。
//
// 目標選擇（M3-T3 契約）：上半日（tickOfDay < UPPER_HALF_END）且有工作 → 目標為 job 建築格；
// 上半日但無工作、或下半日 → 目標為 home 建築格。home/job 指向的建築找不到時，本 tick 不動。
//
// 阻擋：所有建築 footprint 格皆視為阻擋，但 distanceField 內建「goal 格永遠可走」語義，
// 使居民自己的目標格不因是建築而擋住終點——不需在此另外排除目標建築。
//
// === 步進模型（M3-W2 重工；F1/F2/F3/F7 裁決）===
// 本 system **無任何跨 tick 記憶**：update 的結果是 (state, ctx.time) 的純函數，
// 所有推進資訊都能從 citizen.x/y 完全重建。因此
//   - 建築佈局變動（蓋樓/拆樓）下一 tick 即生效，不可能沿著失效路徑穿牆；
//   - serialize → deserialize → 續跑，與連續跑產出完全相同的 state；
//   - 沒有任何以 citizen.id 為鍵的快取，居民死亡也不會殘留記憶體。
//
// 每 tick 的決策（每位居民）：
//  1. 居民座標恆滿足「至多一軸為非整數」——不是站在格中心，就是正在單一軸上跨越相鄰兩格。
//  2. 站在格中心 (x,y 皆整數)：取 4 鄰格中「可進入且到目標步數最小」者為本 tick 的前進格
//     （平手時依 NEIGHBOR/STEP_OFFSETS 的固定順序，保持決定論）。
//  3. 跨格途中：候選為該軸的兩個相鄰格中心 floor/ceil，取「剩餘距離 ＝ 到候選格的距離
//     ＋ 候選格到目標的步數」較小者。目標翻轉或前方被蓋樓時，本規則會讓居民就地折返，
//     不需要任何歷史資訊。
//  4. 位移一律限制在單一軸、且 clamp 到剩餘距離（不過衝）；剩餘 <= SPEED 時直接貼齊該格中心。
//     其餘情況以 SPEED 前進後正規化到 0.1 網格（round(v*10)/10），避免 0.1 反覆相加的累積誤差。
//  5. 找不到可進入且可達目標的格 → 原地不動（無路可走語義）。
//
// 距離查詢用 distanceField（自 goal 反向 BFS，O(w*h)）而非逐人 A*：同一 tick 內同目標的居民
// 共用同一份距離場（fields memo，tick 結束即丟棄），全城重算的成本與人口無關。

import { distanceField, type Bounds, type DistanceField, type Point } from '../path/astar';
import { footprintTiles } from '../world/occupancy';
import type { BuildingDef } from '../../data/types';
import type { Building, Citizen, GameState } from '../world/state';
import type { System, SimContext } from '../sim/system';

/** 移動速度：格/tick */
const SPEED = 0.1;
/** 上半日／下半日分界：tickOfDay < 300 為上半日（朝 job 前進），否則下半日（朝 home 前進）。 */
const UPPER_HALF_END = 300;
/** 座標正規化網格：所有座標皆為 0.1 的整數倍 */
const COORD_SCALE = 10;
/** 浮點比較容差：座標已正規化到 0.1 網格，1e-9 足以吸收殘留誤差且遠小於半步 */
const EPSILON = 1e-9;

/** 4 鄰格掃描順序（與 astar 的 NEIGHBOR_OFFSETS 一致）：上、右、下、左；距離平手時取先掃到者。 */
const STEP_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** 本 tick 的單軸位移：沿 axis 走到座標 to（to 恆為整數格中心座標） */
interface Step {
  axis: 'x' | 'y';
  to: number;
}

export function createMovementSystem(defs: BuildingDef[], bounds: Bounds): System {
  const defsByType = new Map<string, BuildingDef>(defs.map((d) => [d.id, d]));

  return {
    id: 'movement',
    update(state: GameState, ctx: SimContext): void {
      const blocked = new Set<string>();
      // id → building 先建表，避免每位居民每 tick 對 buildings 線性搜尋；重複 id 保留先出現者
      // （與原本 state.buildings.find 的語義一致）。
      const buildingsById = new Map<string, Building>();
      for (const b of state.buildings) {
        if (!buildingsById.has(b.id)) buildingsById.set(b.id, b);
        const def = defsByType.get(b.type);
        const size = def ? def.size : { w: 1, h: 1 };
        for (const t of footprintTiles(b.x, b.y, size.w, size.h)) {
          blocked.add(`${t.x},${t.y}`);
        }
      }
      const isBlocked = (x: number, y: number): boolean => blocked.has(`${x},${y}`);

      // 距離場 memo：只在本次 update 內有效（區域變數，不跨 tick），純粹是同目標居民的共用計算。
      const fields = new Map<string, DistanceField>();
      const fieldFor = (target: Point): DistanceField => {
        const k = `${target.x},${target.y}`;
        let field = fields.get(k);
        if (field === undefined) {
          field = distanceField(target, isBlocked, bounds);
          fields.set(k, field);
        }
        return field;
      };

      const upperHalf = ctx.time.tickOfDay < UPPER_HALF_END;

      for (const citizen of state.citizens) {
        const targetId = upperHalf && citizen.job !== null ? citizen.job : citizen.home;
        const targetBuilding = buildingsById.get(targetId);
        if (!targetBuilding) continue; // home/job 懸空：本 tick 不動

        const target: Point = { x: targetBuilding.x, y: targetBuilding.y };
        if (citizen.x === target.x && citizen.y === target.y) continue; // 已在目標格：靜止

        const step = chooseStep(citizen, target, fieldFor(target), isBlocked, bounds);
        if (step === null) continue; // 無路可走：原地不動
        advance(citizen, step);
      }
    },
  };
}

/** 決定本 tick 的單軸位移目標格；無可行方向時回傳 null。純函數（只看座標、佈局、目標）。 */
function chooseStep(
  citizen: Citizen,
  target: Point,
  field: DistanceField,
  isBlocked: (x: number, y: number) => boolean,
  bounds: Bounds,
): Step | null {
  const canEnter = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= bounds.w || y >= bounds.h) return false;
    // 目標格即使是建築也可走進去（與 distanceField 的 goal 語義一致）。
    return !isBlocked(x, y) || (x === target.x && y === target.y);
  };

  const onGridX = Number.isInteger(citizen.x);
  const onGridY = Number.isInteger(citizen.y);

  if (onGridX && onGridY) {
    // 站在格中心：挑距離目標最短的可進入鄰格。
    let best: Step | null = null;
    let bestDist = Infinity;
    for (const [dx, dy] of STEP_OFFSETS) {
      const nx = citizen.x + dx;
      const ny = citizen.y + dy;
      if (!canEnter(nx, ny)) continue;
      const d = field.get(nx, ny);
      if (d === null || d >= bestDist) continue;
      bestDist = d;
      best = dx !== 0 ? { axis: 'x', to: nx } : { axis: 'y', to: ny };
    }
    return best;
  }

  // 跨格途中：先解掉非整數的那一軸（兩軸皆非整數只會來自損毀存檔，另一軸暫以四捨五入格參與
  // 距離查詢，待本軸對齊後下一 tick 自然會再解另一軸）。
  const axis: 'x' | 'y' = onGridX ? 'y' : 'x';
  const moving = axis === 'x' ? citizen.x : citizen.y;
  const fixed = axis === 'x' ? Math.round(citizen.y) : Math.round(citizen.x);
  const lo = Math.floor(moving);
  const hi = Math.ceil(moving);

  const costOf = (cell: number): number => {
    const x = axis === 'x' ? cell : fixed;
    const y = axis === 'x' ? fixed : cell;
    if (!canEnter(x, y)) return Infinity;
    const d = field.get(x, y);
    if (d === null) return Infinity;
    return Math.abs(moving - cell) + d;
  };

  const costLo = costOf(lo);
  const costHi = costOf(hi);
  if (costLo === Infinity && costHi === Infinity) return null;
  // 平手（兩格皆可達時不會發生：相鄰格距離必差 1）取座標較小者，維持決定論。
  return { axis, to: costLo <= costHi ? lo : hi };
}

/** 沿單一軸前進：剩餘距離 <= SPEED 時直接貼齊目標格中心，否則前進 SPEED 後正規化到 0.1 網格。 */
function advance(citizen: Citizen, step: Step): void {
  const from = step.axis === 'x' ? citizen.x : citizen.y;
  const remaining = step.to - from;
  const next =
    Math.abs(remaining) <= SPEED + EPSILON
      ? step.to
      : Math.round((from + Math.sign(remaining) * SPEED) * COORD_SCALE) / COORD_SCALE;
  if (step.axis === 'x') {
    citizen.x = next;
  } else {
    citizen.y = next;
  }
}
