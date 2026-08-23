// W2 資料表：resources.json 的 basePrice、economy.json 的經濟常數、buildings.json 的 enablesTrade
import { describe, expect, it } from 'vitest';
import { parseBuildingDefs, parseEconomyConfig, parseResourceDefs } from '../../src/data/loader';
import resourcesJson from '../../data/resources.json';
import buildingsJson from '../../data/buildings.json';
import economyJson from '../../data/economy.json';

const resourceIds = new Set(['wood', 'stone', 'gold']);

function validBuilding(): Record<string, unknown> {
  return {
    id: 'market',
    name: '市場',
    size: { w: 1, h: 1 },
    cost: { wood: 10 },
    production: {},
  };
}

describe('parseResourceDefs 的 basePrice', () => {
  it('省略 basePrice → def 不帶該欄（代表不可交易）', () => {
    const [def] = parseResourceDefs([{ id: 'gold', name: '金幣' }]);
    expect(def.basePrice).toBeUndefined();
  });

  it('正數 basePrice 原樣帶出', () => {
    const [def] = parseResourceDefs([{ id: 'wood', name: '木材', basePrice: 2.5 }]);
    expect(def.basePrice).toBe(2.5);
  });

  it('basePrice 為 0 或負數 → throw（0 會讓賣出扣光資源卻拿不到金幣）', () => {
    expect(() => parseResourceDefs([{ id: 'wood', name: '木材', basePrice: 0 }])).toThrow(/basePrice/);
    expect(() => parseResourceDefs([{ id: 'wood', name: '木材', basePrice: -1 }])).toThrow(/basePrice/);
  });

  it('basePrice 非有限數或非數字 → throw', () => {
    expect(() => parseResourceDefs([{ id: 'wood', name: '木材', basePrice: Number.NaN }])).toThrow(/basePrice/);
    expect(() => parseResourceDefs([{ id: 'wood', name: '木材', basePrice: Infinity }])).toThrow(/basePrice/);
    expect(() => parseResourceDefs([{ id: 'wood', name: '木材', basePrice: '2' }])).toThrow(/basePrice/);
  });
});

describe('parseEconomyConfig', () => {
  it('合法輸入回傳對應欄位', () => {
    expect(parseEconomyConfig({ taxPerEmployedCitizenPerDay: 2, marketBuyMarkup: 0.5 })).toEqual({
      taxPerEmployedCitizenPerDay: 2,
      marketBuyMarkup: 0.5,
    });
  });

  it('稅率為 0 合法（免稅城），負數 → throw', () => {
    expect(() => parseEconomyConfig({ taxPerEmployedCitizenPerDay: 0, marketBuyMarkup: 0 })).not.toThrow();
    expect(() => parseEconomyConfig({ taxPerEmployedCitizenPerDay: -1, marketBuyMarkup: 0 })).toThrow(/tax/);
  });

  it('marketBuyMarkup 為負 → throw（買價低於賣價會變成無中生有的造幣機）', () => {
    expect(() => parseEconomyConfig({ taxPerEmployedCitizenPerDay: 1, marketBuyMarkup: -0.1 })).toThrow(
      /marketBuyMarkup/,
    );
  });

  it('缺欄位或含未知欄位 → throw 且訊息含欄位名', () => {
    expect(() => parseEconomyConfig({ marketBuyMarkup: 0.5 })).toThrow(/tax/);
    expect(() =>
      parseEconomyConfig({ taxPerEmployedCitizenPerDay: 1, marketBuyMarkup: 0.5, extra: 1 }),
    ).toThrow(/extra/);
  });

  it('非物件 → throw', () => {
    expect(() => parseEconomyConfig([])).toThrow();
    expect(() => parseEconomyConfig(null)).toThrow();
  });
});

describe('parseBuildingDefs 的 enablesTrade', () => {
  it('省略時 def 不帶該欄；為 true 時帶出', () => {
    const [omitted] = parseBuildingDefs([validBuilding()], resourceIds);
    expect(omitted.enablesTrade).toBeUndefined();

    const [enabled] = parseBuildingDefs([{ ...validBuilding(), enablesTrade: true }], resourceIds);
    expect(enabled.enablesTrade).toBe(true);
  });

  it('非布林值 → throw 且訊息含建築 id', () => {
    expect(() => parseBuildingDefs([{ ...validBuilding(), enablesTrade: 'yes' }], resourceIds)).toThrow(
      /market/,
    );
    expect(() => parseBuildingDefs([{ ...validBuilding(), enablesTrade: 1 }], resourceIds)).toThrow(
      /enablesTrade/,
    );
  });
});

describe('實際資料表', () => {
  it('economy.json 通過驗證', () => {
    const config = parseEconomyConfig(economyJson);
    expect(config.taxPerEmployedCitizenPerDay).toBeGreaterThan(0);
    expect(config.marketBuyMarkup).toBeGreaterThan(0);
  });

  it('gold 無 basePrice（不可交易），其餘資源皆有正價', () => {
    const defs = parseResourceDefs(resourcesJson);
    for (const def of defs) {
      if (def.id === 'gold') {
        expect(def.basePrice).toBeUndefined();
      } else {
        expect(def.basePrice).toBeGreaterThan(0);
      }
    }
  });

  it('buildings.json 中恰有一棟 market 且 enablesTrade 為 true', () => {
    const resourceIdsAll = new Set(parseResourceDefs(resourcesJson).map((r) => r.id));
    const defs = parseBuildingDefs(buildingsJson, resourceIdsAll);
    const traders = defs.filter((d) => d.enablesTrade === true);
    expect(traders.map((d) => d.id)).toEqual(['market']);
  });

  it('加工品的價格高於其原料（賣半成品不會比賣原料還虧）', () => {
    const price = new Map(parseResourceDefs(resourcesJson).map((r) => [r.id, r.basePrice ?? 0]));
    expect(price.get('flour')!).toBeGreaterThan(price.get('grain')!);
    expect(price.get('plank')!).toBeGreaterThan(price.get('wood')!);
    expect(price.get('iron')!).toBeGreaterThan(price.get('iron-ore')!);
    expect(price.get('tools')!).toBeGreaterThan(price.get('iron')!);
  });
});
