// 來源：commit 51c328b，src/core/systems/movement.ts L46–51、L200–261。
// BFS 核心逐字保留；僅改匯出簽章、加入 pop 記錄並以序列取代路徑回傳。
import type { Bounds, Point } from '../../../src/core/path/astar';

export interface LegacyPop {
  index: number;
  hops: number;
  firstStepIndex: number;
}

const STEP_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function legacyRoute(
  start: Point,
  target: Point,
  isBlocked: (x: number, y: number) => boolean,
  bounds: Bounds,
  maxNodes: number,
): LegacyPop[] {
  const pops: LegacyPop[] = [];
  const startDistance = Math.abs(start.x - target.x) + Math.abs(start.y - target.y);
  const nodeLimit = Math.floor(maxNodes);
  const startIndex = start.y * bounds.w + start.x;
  const queue: number[] = [startIndex];
  const firstSteps: number[] = [startIndex];
  const pathLengths: number[] = [0];
  const visited = new Set<number>([startIndex]);
  let bestQueueIndex = 0;
  let bestX = start.x;
  let bestY = start.y;
  let bestDistance = startDistance;

  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    pops.push({ index, hops: pathLengths[head], firstStepIndex: head === 0 ? -1 : firstSteps[head] });
    const x = index % bounds.w;
    const y = (index - x) / bounds.w;
    const distance = Math.abs(x - target.x) + Math.abs(y - target.y);
    const better =
      distance < bestDistance ||
      (distance === bestDistance && (y < bestY || (y === bestY && x < bestX)));
    if (better) {
      bestQueueIndex = head;
      bestX = x;
      bestY = y;
      bestDistance = distance;
    }
    if (bestDistance === 0) break;

    for (const [dx, dy] of STEP_OFFSETS) {
      if (visited.size >= nodeLimit) break;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= bounds.w || ny >= bounds.h) continue;
      const neighborIndex = ny * bounds.w + nx;
      if (visited.has(neighborIndex)) continue;
      const isTarget = nx === target.x && ny === target.y;
      if (!isTarget && isBlocked(nx, ny)) continue;
      visited.add(neighborIndex);
      queue.push(neighborIndex);
      firstSteps.push(head === 0 ? neighborIndex : firstSteps[head]);
      pathLengths.push(pathLengths[head] + 1);
    }
  }

  return pops;
}
