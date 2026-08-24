// 地形過渡選圖（src/render/terrainTiles.ts）
import { describe, expect, it } from 'vitest';
import {
  EDGE_OFFSETS,
  TERRAIN_BASE_TEXTURE,
  terrainTextureKeyFor,
} from '../../src/render/terrainTiles';
import { gridToScreen } from '../../src/render/iso';
import type { TerrainType } from '../../src/core/world/terrain';

/** 造一個「只有指定方向是 other、其餘都是 self」的鄰格查詢。 */
function onlyDirIs(dx: number, dy: number, other: TerrainType, rest: TerrainType) {
  return (qx: number, qy: number): TerrainType => (qx === dx && qy === dy ? other : rest);
}

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
    expect(terrainTextureKeyFor('water', () => 'water')).toBe(TERRAIN_BASE_TEXTURE.water);
  });

  it('每個方向單獨臨陸時，選中該方向的浪花', () => {
    for (const { dir, dx, dy } of EDGE_OFFSETS) {
      const key = terrainTextureKeyFor('water', onlyDirIs(dx, dy, 'sand', 'water'));
      expect(key).toBe(`tile-water-shore-${dir}`);
    }
  });

  it('臨的是岩石或高山一樣長浪花——浪打在什麼上面不影響水這一側', () => {
    expect(terrainTextureKeyFor('water', onlyDirIs(-1, 0, 'rock', 'water'))).toBe('tile-water-shore-tl');
    expect(terrainTextureKeyFor('water', onlyDirIs(0, 1, 'mountain', 'water'))).toBe('tile-water-shore-bl');
  });

  it('多面臨陸時取固定優先序的第一個，同輸入必得同輸出', () => {
    // 決定性是硬需求：分塊 RenderTexture 會重烘，選圖若不穩定畫面會閃爍。
    const neighbor = (): TerrainType => 'sand';
    const first = terrainTextureKeyFor('water', neighbor);
    expect(first).toBe('tile-water-shore-tl');
    expect(terrainTextureKeyFor('water', neighbor)).toBe(first);
  });
});

describe('terrainTextureKeyFor：沙草交界', () => {
  it('四面皆沙時用底圖', () => {
    expect(terrainTextureKeyFor('sand', () => 'sand')).toBe(TERRAIN_BASE_TEXTURE.sand);
  });

  it('每個方向單獨臨草時，選中該方向的草緣', () => {
    for (const { dir, dx, dy } of EDGE_OFFSETS) {
      const key = terrainTextureKeyFor('sand', onlyDirIs(dx, dy, 'grass', 'sand'));
      expect(key).toBe(`tile-sand-grass-${dir}`);
    }
  });

  it('臨森林不算——林緣自己就不規則，再加草緣會糊成一片', () => {
    expect(terrainTextureKeyFor('sand', onlyDirIs(-1, 0, 'forest', 'sand'))).toBe(TERRAIN_BASE_TEXTURE.sand);
  });

  it('臨水不算——沙灘靠海那側由水格的浪花負責', () => {
    expect(terrainTextureKeyFor('sand', onlyDirIs(0, 1, 'water', 'sand'))).toBe(TERRAIN_BASE_TEXTURE.sand);
  });
});

describe('terrainTextureKeyFor：其餘地形', () => {
  it('草地/森林/岩石/高山一律用底圖，鄰格是什麼都不影響', () => {
    for (const type of ['grass', 'forest', 'rock', 'mountain'] as const) {
      expect(terrainTextureKeyFor(type, () => 'water')).toBe(TERRAIN_BASE_TEXTURE[type]);
    }
  });
});
