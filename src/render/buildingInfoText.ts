import { eraOfBuilding, isBuildingUnlocked, unlockPopulationOf } from '../data/eras';
import type { BuildingDef, EraDef } from '../data/types';

export interface InfoLine {
  text: string;
  tone: 'title' | 'normal' | 'dim' | 'danger' | 'ok';
}

export interface BuildingInfoContext {
  population: number;
  resourceAmount: (id: string) => number;
  resourceName: (id: string) => string;
  terrainName: (id: string) => string;
  eras: readonly EraDef[];
}

// core 省略 workTicks 時是逐 tick 入帳，沒有批次預設值；資訊卡以目前資料表一致採用的 60 工時呈現批次。
const DATA_TABLE_WORK_TICKS = 60;

function formatAmounts(
  amounts: Record<string, number>,
  multiplier: number,
  nameOf: (id: string) => string,
): string {
  return Object.entries(amounts)
    .map(([id, amount]) => `${nameOf(id)}${amount * multiplier}`)
    .join(' ');
}

export function buildingInfoLines(def: BuildingDef, ctx: BuildingInfoContext): InfoLine[] {
  const sizedName = def.size.w === 1 && def.size.h === 1
    ? def.name
    : `${def.name}（${def.size.w}×${def.size.h}）`;
  const lines: InfoLine[] = [{ text: sizedName, tone: 'title' }];

  const costEntries = Object.entries(def.cost);
  const cannotAfford = costEntries.some(([id, amount]) => ctx.resourceAmount(id) < amount);
  const formattedCost = costEntries.length === 0
    ? '免費'
    : costEntries
      .map(([id, amount]) => `${ctx.resourceName(id)}${amount}${ctx.resourceAmount(id) < amount ? '!' : ''}`)
      .join(' ');
  lines.push({ text: `成本：${formattedCost}`, tone: cannotAfford ? 'danger' : 'normal' });

  if (Object.keys(def.production).length > 0) {
    const workTicks = def.workTicks ?? DATA_TABLE_WORK_TICKS;
    const inputs = formatAmounts(def.inputs ?? {}, workTicks, ctx.resourceName);
    const outputs = formatAmounts(def.production, workTicks, ctx.resourceName);
    lines.push({
      text: `${inputs}${inputs.length > 0 ? ' ' : ''}→ ${outputs}／批（${workTicks} 工時）`,
      tone: 'normal',
    });
  }

  if (def.jobs > 0) lines.push({ text: `工人 ${def.jobs}`, tone: 'normal' });
  if (def.housing > 0) lines.push({ text: `住 ${def.housing} 人`, tone: 'normal' });

  const terrain = def.terrain;
  if (terrain?.on !== undefined) {
    lines.push({ text: `需建於 ${terrain.on.map(ctx.terrainName).join('／')}`, tone: 'normal' });
  }
  if (terrain?.near !== undefined) {
    lines.push({ text: `需鄰近 ${terrain.near.map(ctx.terrainName).join('／')}`, tone: 'normal' });
  }
  if (terrain?.consumes !== undefined) {
    lines.push({ text: `消耗 ${terrain.consumes.map(ctx.terrainName).join('／')}`, tone: 'normal' });
  }

  if (isBuildingUnlocked(def, ctx.population)) {
    lines.push({ text: '已解鎖', tone: 'dim' });
  } else {
    const threshold = unlockPopulationOf(def);
    const era = eraOfBuilding(def, ctx.eras);
    lines.push({
      text: `${era.name}：需人口 ${threshold}（目前 ${ctx.population}）`,
      tone: 'danger',
    });
  }

  return lines;
}
