// terrain.ts 演算法規格（實作者請照此公式實作 hashNoise，測試以 known-answer 鎖定）：
//
//   hashNoise(seed, x, y) — 決定性雜訊，回傳 [0,1) 浮點：
//     h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0
//     h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
//     h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
//     h ^= h >>> 16
//     return (h >>> 0) / 4294967296
//   （murmur3 fmix32 finalizer 套用在 x/y/seed 以 Math.imul 加權合成的整數上；純函數、無狀態、
//    全程使用 32 位元整數運算，故大座標/負座標不會有浮點精度問題。）
//
// R1：地形型別（TerrainType/TERRAIN_TYPES/isWalkable/isBuildable）
// R2：hashNoise 決定性雜訊
// R3：baseTerrainAt 島嶼生成（性質測試，不鎖死內部門檻——门槛由實作者自行決定）
// R5：terrainAt 查詢（terrainOverrides 優先，own-property 語義）
import { describe, expect, it } from 'vitest';
import {
  TERRAIN_TYPES,
  isWalkable,
  isBuildable,
  hashNoise,
  baseTerrainAt,
  terrainAt,
  type TerrainType,
  type TerrainOverride,
} from '../../src/core/world/terrain';
import { createInitialState } from '../../src/core/world/state';
import type { GameState } from '../../src/core/world/state';

describe('R1：地形型別', () => {
  it('TERRAIN_TYPES 恰為六種地形（water/sand/grass/forest/rock/mountain），無重複', () => {
    expect(TERRAIN_TYPES).toHaveLength(6);
    expect(new Set(TERRAIN_TYPES).size).toBe(6);
    expect(new Set(TERRAIN_TYPES)).toEqual(
      new Set(['water', 'sand', 'grass', 'forest', 'rock', 'mountain']),
    );
  });

  it('isWalkable：water 與 mountain 為 false，其餘四種為 true', () => {
    const expected: Record<TerrainType, boolean> = {
      water: false,
      sand: true,
      grass: true,
      forest: true,
      rock: true,
      mountain: false,
    };
    for (const t of TERRAIN_TYPES) {
      expect(isWalkable(t)).toBe(expected[t]);
    }
  });

  it('isBuildable：規則與 isWalkable 相同（W2 才加建築各自的地形需求）', () => {
    for (const t of TERRAIN_TYPES) {
      expect(isBuildable(t)).toBe(isWalkable(t));
    }
  });
});

describe('R2：hashNoise 決定性雜訊', () => {
  it('純函數：同參數多次呼叫回傳同值，呼叫順序不影響結果', () => {
    const a1 = hashNoise(1, 5, 7);
    const b1 = hashNoise(1, 0, 0);
    const a2 = hashNoise(1, 5, 7);
    expect(a1).toBe(a2);
    expect(hashNoise(1, 0, 0)).toBe(b1);
  });

  it('任意座標可直接算，不需先算鄰居（呼叫單一遠座標不 throw、且與獨立呼叫序列結果一致）', () => {
    expect(() => hashNoise(1, 500, 500)).not.toThrow();
    const direct = hashNoise(1, 500, 500);
    // 不先算 (0,0)..(499,499) 也能算出同樣的值
    expect(direct).toBe(hashNoise(1, 500, 500));
  });

  it('不同 seed 對同座標產生不同場（不會退化成與 seed 無關）', () => {
    expect(hashNoise(1, 5, 7)).not.toBe(hashNoise(2, 5, 7));
  });

  it('相鄰座標值不相關（不是線性遞增/等差數列）', () => {
    const v0 = hashNoise(1, 10, 10);
    const v1 = hashNoise(1, 11, 10);
    const v2 = hashNoise(1, 12, 10);
    expect(v0).not.toBe(v1);
    expect(v1).not.toBe(v2);
    // 等差數列會有 v1-v0 === v2-v1；雜訊不應如此
    expect(v1 - v0).not.toBeCloseTo(v2 - v1, 6);
  });

  it('回傳值恆在 [0,1) 範圍內（含大座標與負座標）', () => {
    const coords: Array<[number, number, number]> = [
      [1, 0, 0],
      [1, -50, 30],
      [1, 999999, 999999],
      [1, -999999, -999999],
      [7, 1234567, -1234567],
    ];
    for (const [seed, x, y] of coords) {
      const v = hashNoise(seed, x, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    // 較大範圍抽樣，確保沒有系統性溢出範圍
    for (let x = -100; x <= 100; x += 17) {
      for (let y = -100; y <= 100; y += 23) {
        const v = hashNoise(3, x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('known-answer：鎖定至少 3 組（含大座標、負座標、不同 seed）precise 值', () => {
    expect(hashNoise(1, 0, 0)).toBe(0.4302281867712736);
    expect(hashNoise(1, 5, 7)).toBe(0.09877043915912509);
    expect(hashNoise(1, -3, 4)).toBe(0.06858665402978659);
    expect(hashNoise(2, 5, 7)).toBe(0.6591822144109756);
    expect(hashNoise(1, 999999, 999999)).toBe(0.2229129879269749);
    expect(hashNoise(1, -999999, -999999)).toBe(0.6492358546238393);
  });
});

describe('R3：baseTerrainAt 島嶼生成（worldSize=200, seed=1 為主要驗證場景）', () => {
  const SEED = 1;
  const SIZE = 200;

  it('純函數：同參數多次呼叫回傳同值', () => {
    const a = baseTerrainAt(SEED, SIZE, 42, 88);
    const b = baseTerrainAt(SEED, SIZE, 42, 88);
    expect(a).toBe(b);
  });

  it('越界座標（x<0、y<0、x>=worldSize、y>=worldSize）恆回 water', () => {
    expect(baseTerrainAt(SEED, SIZE, -1, 50)).toBe('water');
    expect(baseTerrainAt(SEED, SIZE, 50, -1)).toBe('water');
    expect(baseTerrainAt(SEED, SIZE, SIZE, 50)).toBe('water');
    expect(baseTerrainAt(SEED, SIZE, 50, SIZE)).toBe('water');
    expect(baseTerrainAt(SEED, SIZE, -100, -100)).toBe('water');
    expect(baseTerrainAt(SEED, SIZE, SIZE + 100, SIZE + 100)).toBe('water');
  });

  it('世界四個角落必為 water（徑向衰減保證）', () => {
    expect(baseTerrainAt(SEED, SIZE, 0, 0)).toBe('water');
    expect(baseTerrainAt(SEED, SIZE, SIZE - 1, 0)).toBe('water');
    expect(baseTerrainAt(SEED, SIZE, 0, SIZE - 1)).toBe('water');
    expect(baseTerrainAt(SEED, SIZE, SIZE - 1, SIZE - 1)).toBe('water');
  });

  it('世界中心區域必為陸地（非 water）', () => {
    const center = Math.floor(SIZE / 2);
    expect(baseTerrainAt(SEED, SIZE, center, center)).not.toBe('water');
  });

  it('陸地比例 20%~70%、六種地形至少出現四種、中心陸地連通率 60% 以上（全圖統計，一次算完共用網格）', () => {
    // 建一次 200x200 網格供以下三項性質共用，避免重複計算 baseTerrainAt。
    const grid: TerrainType[][] = [];
    for (let x = 0; x < SIZE; x++) {
      const col: TerrainType[] = [];
      for (let y = 0; y < SIZE; y++) {
        col.push(baseTerrainAt(SEED, SIZE, x, y));
      }
      grid.push(col);
    }

    // (d) 陸地比例
    let landCount = 0;
    const typesSeen = new Set<TerrainType>();
    for (let x = 0; x < SIZE; x++) {
      for (let y = 0; y < SIZE; y++) {
        const t = grid[x][y];
        typesSeen.add(t);
        if (t !== 'water') landCount++;
      }
    }
    const totalCells = SIZE * SIZE;
    const landRatio = landCount / totalCells;
    expect(landRatio).toBeGreaterThanOrEqual(0.2);
    expect(landRatio).toBeLessThanOrEqual(0.7);

    // (e) 多樣性：六種地形中至少出現四種
    expect(typesSeen.size).toBeGreaterThanOrEqual(4);

    // (f) 連通性：中心點以 4 向 flood fill 可達的「陸地」（type !== 'water'）格數，
    // 佔全部陸地格 60% 以上——避免地圖碎裂成無數小島使玩家無地可建。
    // 注意：連通性以「非 water」判定（含 mountain），與 isWalkable 無關。
    const center = Math.floor(SIZE / 2);
    expect(grid[center][center]).not.toBe('water');

    const visited: boolean[][] = Array.from({ length: SIZE }, () => new Array<boolean>(SIZE).fill(false));
    const stack: Array<[number, number]> = [[center, center]];
    visited[center][center] = true;
    let reachable = 0;
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      reachable++;
      const neighbors: Array<[number, number]> = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        if (visited[nx][ny]) continue;
        if (grid[nx][ny] === 'water') continue;
        visited[nx][ny] = true;
        stack.push([nx, ny]);
      }
    }

    expect(reachable / landCount).toBeGreaterThanOrEqual(0.6);
  });

  it('大座標效能：worldSize=1000 時任取 10000 個座標計算，不 throw 且能跑完', () => {
    const bigSize = 1000;
    let count = 0;
    for (let i = 0; i < 10000; i++) {
      const x = (i * 97) % bigSize;
      const y = (i * 131) % bigSize;
      expect(() => baseTerrainAt(SEED, bigSize, x, y)).not.toThrow();
      count++;
    }
    expect(count).toBe(10000);
  }, 5000);
});

describe('R5：terrainAt 查詢（terrainOverrides 優先，own-property 語義）', () => {
  function stateWithOverrides(overrides: Record<string, TerrainOverride>): GameState {
    const state = createInitialState(1);
    (state as GameState & { terrainOverrides: Record<string, TerrainOverride> }).terrainOverrides = overrides;
    return state;
  }

  it('無 override 時，terrainAt 等同 baseTerrainAt(state.worldSeed, state.worldSize, x, y)', () => {
    const state = createInitialState(1);
    for (const [x, y] of [
      [0, 0],
      [50, 50],
      [199, 199],
      [-5, 5],
    ] as const) {
      expect(terrainAt(state, x, y)).toBe(baseTerrainAt(state.worldSeed, state.worldSize, x, y));
    }
  });

  it('override 有 type 欄位時，terrainAt 回傳 override.type（不管 base 算出什麼）', () => {
    const state = stateWithOverrides({ '5,5': { type: 'sand' }, '9,9': { type: 'mountain' } });
    expect(terrainAt(state, 5, 5)).toBe('sand');
    expect(terrainAt(state, 9, 9)).toBe('mountain');
  });

  it('override 只有 resource（無 type）時，terrainAt 落回 baseTerrainAt', () => {
    const state = stateWithOverrides({ '5,5': { resource: 3 } });
    expect(terrainAt(state, 5, 5)).toBe(baseTerrainAt(state.worldSeed, state.worldSize, 5, 5));
  });

  it('override 只影響該座標，鄰近座標不受影響', () => {
    const state = stateWithOverrides({ '5,5': { type: 'sand' } });
    expect(terrainAt(state, 5, 5)).toBe('sand');
    expect(terrainAt(state, 6, 5)).toBe(baseTerrainAt(state.worldSeed, state.worldSize, 6, 5));
    expect(terrainAt(state, 5, 6)).toBe(baseTerrainAt(state.worldSeed, state.worldSize, 5, 6));
  });

  it('terrainOverrides 上有危險鍵名（如 "constructor"）不會誤命中任意座標查詢（own-property 語義）', () => {
    const state = createInitialState(1);
    const overrides = state.terrainOverrides as Record<string, TerrainOverride>;
    // 模擬損毀/異常存檔：terrainOverrides 上出現非 "x,y" 格式的鍵，且剛好與
    // Object.prototype 成員同名——terrainAt 不得因原型鏈污染而誤判任意座標命中 override。
    Object.defineProperty(overrides, 'constructor', {
      value: { type: 'forest' },
      enumerable: true,
      configurable: true,
      writable: true,
    });

    for (const [x, y] of [
      [0, 0],
      [5, 5],
      [100, 100],
    ] as const) {
      expect(terrainAt(state, x, y)).toBe(baseTerrainAt(state.worldSeed, state.worldSize, x, y));
    }
  });

  // F4：上一條測試的「危險鍵名」是加在 overrides 這個 plain object 自己身上的 own property，
  // 從來不會被 `${x},${y}` 格式的查詢鍵命中，因此就算 ownOverride 被「簡化」成直接索引
  // （state.terrainOverrides[key]）也一樣全綠——不構成保護。真正能分辨 own-property 語義
  // 是否落實的做法是污染 Object.prototype 本身：若 terrainAt 改用直接索引，
  // `state.terrainOverrides['5,5']` 會透過原型鏈讀到污染值；若走 own-property 語義則不受影響。
  it('F4：Object.prototype 遭原型污染時，terrainAt 仍走 own-property 語義、不誤讀污染值', () => {
    const state = createInitialState(1);
    const pollutedKey = '5,5';
    const expected = baseTerrainAt(state.worldSeed, state.worldSize, 5, 5);

    Object.defineProperty(Object.prototype, pollutedKey, {
      value: { type: 'sand' },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    try {
      // 確認情境真的具區辨力：state.terrainOverrides 本身是空物件，若透過原型鏈讀取
      // 會讀到污染值 'sand'；terrainAt 必須忽略它、落回 baseTerrainAt。
      expect((state.terrainOverrides as Record<string, TerrainOverride>)['5,5'].type).toBe('sand');
      expect(terrainAt(state, 5, 5)).toBe(expected);
    } finally {
      delete (Object.prototype as Record<string, unknown>)[pollutedKey];
    }
  });
});

describe('C3：terrainAt 越界防護優先於 override 查詢', () => {
  it('越界座標即使 terrainOverrides 塞了該鍵的 override，terrainAt 仍恆回 water', () => {
    const state = createInitialState(1);
    // 直接構造 state，繞過 save.ts 的鍵座標驗證，模擬「驗證被繞過」的極端情況。
    const overrides = state.terrainOverrides as Record<string, TerrainOverride>;
    overrides['200,200'] = { type: 'mountain' };
    overrides['-1,-1'] = { type: 'forest' };

    expect(terrainAt(state, 200, 200)).toBe('water');
    expect(terrainAt(state, -1, -1)).toBe('water');
  });
});

describe('F3：terrainAt／baseTerrainAt 對非整數座標 fail fast', () => {
  it('terrainAt(state, 2.5, 3) throw，訊息含函式名', () => {
    const state = createInitialState(1);
    expect(() => terrainAt(state, 2.5, 3)).toThrow(/terrainAt/);
  });

  it('baseTerrainAt 對非整數座標 throw，訊息含函式名', () => {
    expect(() => baseTerrainAt(1, 200, 2.5, 3)).toThrow(/baseTerrainAt/);
  });

  it('整數驗證先於越界判定：非整數且越界的座標仍先因非整數 throw', () => {
    const state = createInitialState(1);
    expect(() => terrainAt(state, 200.5, 0)).toThrow(/terrainAt/);
  });
});

describe('F6：地形快照指紋（TERRAIN_GENERATOR_VERSION=1 的行為指紋）', () => {
  // 這是 TERRAIN_GENERATOR_VERSION=1 的行為指紋：seed=1、worldSize=200 下，
  // 20 個散佈全圖（中心/近角/中距離/各象限）座標的實際地形值，逐一鎖死。
  // 任何生成常數（SEA_LEVEL、NOISE_WEIGHT、MOUNTAIN_LEVEL…）被改動都應使本測試變紅。
  // 有意改演算法時必須遞增 TERRAIN_GENERATOR_VERSION 並重新產生本測試的期望值。
  it('seed=1, worldSize=200：20 個固定座標的地形逐一符合已鎖定的指紋', () => {
    const SEED = 1;
    const SIZE = 200;
    const fingerprint: Array<[number, number, TerrainType]> = [
      [100, 100, 'forest'],
      [5, 5, 'water'],
      [194, 5, 'water'],
      [5, 194, 'water'],
      [194, 194, 'water'],
      [50, 50, 'grass'],
      [150, 150, 'forest'],
      [50, 150, 'sand'],
      [150, 50, 'grass'],
      [100, 5, 'water'],
      [100, 194, 'water'],
      [5, 100, 'water'],
      [194, 100, 'water'],
      [70, 130, 'grass'],
      [130, 70, 'forest'],
      [30, 170, 'water'],
      [170, 30, 'water'],
      [90, 110, 'mountain'],
      [110, 90, 'mountain'],
      [20, 20, 'water'],
    ];

    for (const [x, y, expected] of fingerprint) {
      expect(baseTerrainAt(SEED, SIZE, x, y)).toBe(expected);
    }
  });
});
