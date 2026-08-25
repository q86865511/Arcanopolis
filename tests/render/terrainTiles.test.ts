// 地形過渡選圖（src/render/terrainTiles.ts）
import { describe, expect, it } from 'vitest';
import {
  EDGE_OFFSETS,
  TERRAIN_BASE_TEXTURE,
  TERRAIN_VARIANTS,
  terrainTextureKeyFor,
} from '../../src/render/terrainTiles';
import { gridToScreen } from '../../src/render/iso';
import type { TerrainType } from '../../src/core/world/terrain';

/** 造一個「只有指定方向是 other、其餘都是 self」的鄰格查詢。 */
function onlyDirIs(dx: number, dy: number, other: TerrainType, rest: TerrainType) {
  return (qx: number, qy: number): TerrainType => (qx === dx && qy === dy ? other : rest);
}

/** 測試預設 seed／座標：多數 case 不關心變體挑選，固定一組值即可。 */
const SEED = 1;
const GX = 10;
const GY = 10;

describe('EDGE_OFFSETS 的方位對應', () => {
  // 這組偏移是選圖正確與否的地基：接錯方向會讓浪花長在背海的那一側，
  // 而那種錯誤在單張素材上看不出來，只有鋪成地圖才會發現。
  it('每個方位的格偏移在螢幕上真的落在該方位', () => {
    const origin = gridToScreen(10, 10);
    for (const { dir, dx, dy } of EDGE_OFFSETS) {
      const neighbor = gridToScreen(10 + dx, 10 + dy);
      const right = neighbor.x > origin.x;
      const down = neighbor.y > origin.y;
      const expected = `${down ? 'b' : 't'}${right ? 'r' : 'l'}`;
      expect(`${dir} -> ${expected}`).toBe(`${dir} -> ${dir}`);
    }
  });

  it('四個方位齊全且互不重複', () => {
    expect(new Set(EDGE_OFFSETS.map((e) => e.dir))).toEqual(new Set(['tl', 'tr', 'br', 'bl']));
  });
});

describe('terrainTextureKeyFor：水面海岸線', () => {
  it('四面皆水時用底圖', () => {
    expect(terrainTextureKeyFor('water', () => 'water', SEED, GX, GY)).toBe(TERRAIN_BASE_TEXTURE.water);
  });

  it('每個方向單獨臨陸時，選中該方向的浪花', () => {
    for (const { dir, dx, dy } of EDGE_OFFSETS) {
      const key = terrainTextureKeyFor('water', onlyDirIs(dx, dy, 'sand', 'water'), SEED, GX, GY);
      expect(key).toBe(`tile-water-shore-${dir}`);
    }
  });

  it('臨的是岩石或高山一樣長浪花——浪打在什麼上面不影響水這一側', () => {
    expect(terrainTextureKeyFor('water', onlyDirIs(-1, 0, 'rock', 'water'), SEED, GX, GY)).toBe(
      'tile-water-shore-tl',
    );
    expect(terrainTextureKeyFor('water', onlyDirIs(0, 1, 'mountain', 'water'), SEED, GX, GY)).toBe(
      'tile-water-shore-bl',
    );
  });

  it('多面臨陸時取固定優先序的第一個，同輸入必得同輸出', () => {
    // 決定性是硬需求：分塊 RenderTexture 會重烘，選圖若不穩定畫面會閃爍。
    const neighbor = (): TerrainType => 'sand';
    const first = terrainTextureKeyFor('water', neighbor, SEED, GX, GY);
    expect(first).toBe('tile-water-shore-tl');
    expect(terrainTextureKeyFor('water', neighbor, SEED, GX, GY)).toBe(first);
  });
});

describe('terrainTextureKeyFor：沙草交界', () => {
  // 沙灘現在有兩張變體，「用底圖」的不變量改為「不是過渡 tile」（挑到哪張變體不是本組重點）。
  it('四面皆沙時不觸發過渡', () => {
    expect(TERRAIN_VARIANTS.sand).toContain(terrainTextureKeyFor('sand', () => 'sand', SEED, GX, GY));
  });

  it('每個方向單獨臨草時，選中該方向的草緣', () => {
    for (const { dir, dx, dy } of EDGE_OFFSETS) {
      const key = terrainTextureKeyFor('sand', onlyDirIs(dx, dy, 'grass', 'sand'), SEED, GX, GY);
      expect(key).toBe(`tile-sand-grass-${dir}`);
    }
  });

  it('臨森林不算——林緣自己就不規則，再加草緣會糊成一片', () => {
    const key = terrainTextureKeyFor('sand', onlyDirIs(-1, 0, 'forest', 'sand'), SEED, GX, GY);
    expect(TERRAIN_VARIANTS.sand).toContain(key);
  });

  it('臨水不算——沙灘靠海那側由水格的浪花負責', () => {
    const key = terrainTextureKeyFor('sand', onlyDirIs(0, 1, 'water', 'sand'), SEED, GX, GY);
    expect(TERRAIN_VARIANTS.sand).toContain(key);
  });
});

describe('terrainTextureKeyFor：其餘地形（決定論變體混鋪）', () => {
  it('草地/森林/岩石/高山的回傳值一律屬於該地形的變體集合，鄰格是什麼都不影響', () => {
    for (const type of ['grass', 'forest', 'rock', 'mountain'] as const) {
      for (let gx = 0; gx < 20; gx++) {
        const key = terrainTextureKeyFor(type, () => 'water', SEED, gx, gx + 1);
        expect(TERRAIN_VARIANTS[type]).toContain(key);
      }
    }
  });

  it('同 (seed,gx,gy) 重複呼叫恆得同一張——分塊重烘不能閃爍', () => {
    for (const type of ['grass', 'forest', 'rock', 'mountain'] as const) {
      const first = terrainTextureKeyFor(type, () => 'water', SEED, 42, 7);
      for (let i = 0; i < 5; i++) {
        expect(terrainTextureKeyFor(type, () => 'water', SEED, 42, 7)).toBe(first);
      }
    }
  });

  it('掃 1000 格，grass 三張變體都出現且第一變體占比最高', () => {
    const counts = new Map<string, number>();
    for (let gx = 0; gx < 40; gx++) {
      for (let gy = 0; gy < 25; gy++) {
        const key = terrainTextureKeyFor('grass', () => 'water', SEED, gx, gy);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    for (const variant of TERRAIN_VARIANTS.grass) {
      expect(counts.get(variant) ?? 0).toBeGreaterThan(0);
    }
    const firstCount = counts.get(TERRAIN_VARIANTS.grass[0]) ?? 0;
    for (const variant of TERRAIN_VARIANTS.grass.slice(1)) {
      expect(firstCount).toBeGreaterThan(counts.get(variant) ?? 0);
    }
  });
});
