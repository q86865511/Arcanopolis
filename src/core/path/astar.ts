// A* 網格尋路：4 向移動，曼哈頓距離啟發函式。
//
// 決定論設計（M3-T3 規格裁決）：
// - 啟發函式：|dx| + |dy|（曼哈頓距離，4 向移動網格的標準選擇）。
// - tie-break：open list 中 f 值相同時，依 (y, x) 由小到大決定 pop 順序（y 優先於 x）。
//   因 (y,x) 唯一對應一個格子，此鍵在 f 相同時已是全序，使整個搜索過程（pop 順序、
//   每格首次到達即定 parent）完全決定論。
// - parent 覆寫規則：同一格若以「相等」的 g 值被重新到達，不覆寫既有 parent（標準 A*
//   語義——只有嚴格更小的 g 才更新 parent/g，維持首次到達優先）。

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  w: number;
  h: number;
}

export type IsBlocked = (x: number, y: number) => boolean;

/** 4 向移動的相鄰格位移；掃描順序不影響搜索結果（見上方 tie-break 說明：結果只取決於
 *  pop 順序與「首次到達不覆寫」規則，同一節點的鄰居彼此是不同格子，不會互相搶 parent）。 */
const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function inBounds(x: number, y: number, bounds: Bounds): boolean {
  return x >= 0 && y >= 0 && x < bounds.w && y < bounds.h;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * 4 向網格 A* 尋路。
 * - start === goal：即使該格 isBlocked 仍回傳只含該點的路徑 [start]（規則不因 blocked 而例外）。
 * - start 或 goal 越界：回傳 null。
 * - goal 格本身即使 isBlocked 仍可作為終點（可走進建築格）；其餘格 isBlocked 則不可通行。
 * - 找不到路徑：回傳 null。
 */
export function findPath(start: Point, goal: Point, isBlocked: IsBlocked, bounds: Bounds): Point[] | null {
  if (!inBounds(start.x, start.y, bounds) || !inBounds(goal.x, goal.y, bounds)) {
    return null;
  }
  if (start.x === goal.x && start.y === goal.y) {
    return [{ x: start.x, y: start.y }];
  }

  const gScore = new Map<string, number>();
  const parent = new Map<string, string>();
  const openKeys = new Set<string>();
  const open: Point[] = [];

  const startKey = key(start.x, start.y);
  gScore.set(startKey, 0);
  open.push({ x: start.x, y: start.y });
  openKeys.add(startKey);

  const h = (x: number, y: number): number => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  const popLowest = (): Point => {
    let bestIdx = 0;
    let bestF = gScore.get(key(open[0].x, open[0].y))! + h(open[0].x, open[0].y);
    for (let i = 1; i < open.length; i++) {
      const p = open[i];
      const f = gScore.get(key(p.x, p.y))! + h(p.x, p.y);
      const best = open[bestIdx];
      const better = f < bestF || (f === bestF && (p.y < best.y || (p.y === best.y && p.x < best.x)));
      if (better) {
        bestF = f;
        bestIdx = i;
      }
    }
    const [node] = open.splice(bestIdx, 1);
    openKeys.delete(key(node.x, node.y));
    return node;
  };

  while (open.length > 0) {
    const current = popLowest();
    const currentKey = key(current.x, current.y);

    if (current.x === goal.x && current.y === goal.y) {
      const path: Point[] = [];
      let curKey: string | undefined = currentKey;
      while (curKey !== undefined) {
        const [xs, ys] = curKey.split(',');
        path.push({ x: Number(xs), y: Number(ys) });
        curKey = parent.get(curKey);
      }
      path.reverse();
      return path;
    }

    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (!inBounds(nx, ny, bounds)) continue;
      const isGoalCell = nx === goal.x && ny === goal.y;
      if (!isGoalCell && isBlocked(nx, ny)) continue;

      const nKey = key(nx, ny);
      const tentativeG = gScore.get(currentKey)! + 1;
      const existingG = gScore.get(nKey);
      if (existingG === undefined || tentativeG < existingG) {
        gScore.set(nKey, tentativeG);
        parent.set(nKey, currentKey);
        if (!openKeys.has(nKey)) {
          open.push({ x: nx, y: ny });
          openKeys.add(nKey);
        }
      }
      // tentativeG === existingG：不覆寫既有 parent（首次到達優先，見檔頭說明）。
    }
  }

  return null;
}

/** 對單一 goal 預算好的「到 goal 的最短步數」查詢表（見 distanceField）。 */
export interface DistanceField {
  /** 由 (x,y) 出發抵達 goal 的最短步數；越界或不可達回傳 null。goal 本身為 0。 */
  get(x: number, y: number): number | null;
}

/**
 * 由 goal 反向 BFS 一次算出全圖的最短步數場，語義與 findPath 逐格呼叫完全一致：
 * - 4 向移動、每步成本 1（無權重圖，BFS 距離即 A* 最佳解長度）。
 * - goal 格即使 isBlocked 仍可作為終點，且可由它向外擴散。
 * - 其餘 isBlocked 的格「可作為起點但不可穿越」（對應 findPath 不檢查 start 是否 blocked、
 *   只擋中途格）：因此 blocked 格會被賦予距離值，但不從它繼續擴散。
 * 用途：多名居民共用同一 goal 時，一次 O(w*h) 取代每人一次 O(V²) 的 A*。
 */
export function distanceField(goal: Point, isBlocked: IsBlocked, bounds: Bounds): DistanceField {
  const { w, h } = bounds;
  const empty: DistanceField = { get: () => null };
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return empty;
  if (!inBounds(goal.x, goal.y, bounds)) return empty;

  const dist = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  const goalIndex = goal.y * w + goal.x;
  dist[goalIndex] = 0;
  queue.push(goalIndex);

  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const cx = index % w;
    const cy = (index - cx) / w;
    const nextDist = dist[index] + 1;
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny, bounds)) continue;
      const nIndex = ny * w + nx;
      if (dist[nIndex] >= 0) continue;
      dist[nIndex] = nextDist;
      // blocked 格只登記距離、不繼續擴散——它可以是起點（走出建築），但不能被穿越。
      if (!isBlocked(nx, ny)) queue.push(nIndex);
    }
  }

  return {
    get(x: number, y: number): number | null {
      if (!Number.isInteger(x) || !Number.isInteger(y) || !inBounds(x, y, bounds)) return null;
      const d = dist[y * w + x];
      return d >= 0 ? d : null;
    },
  };
}
