// 預設順序固定為 jobs → production → population → tax → regrowth → movement；
// M6-W4 的 connectivity 會插在最前面。

import type { BuildingDef, EconomyConfig, PopulationConfig, TerrainEconomy } from '../../data/types';
import { createJobsSystem } from '../systems/jobs';
import { createMovementSystem } from '../systems/movement';
import { createPopulationSystem } from '../systems/population';
import { createProductionSystem } from '../systems/production';
import { createRegrowthSystem } from '../systems/regrowth';
import { createTaxSystem } from '../systems/tax';
import type { System } from './system';

export interface SystemStackConfig {
  buildingDefs: BuildingDef[];
  terrainEconomy: TerrainEconomy;
  populationConfig: PopulationConfig;
  economyConfig: EconomyConfig;
  bounds: { w: number; h: number };
}

export function createDefaultSystems(config: SystemStackConfig): System[] {
  return [
    createJobsSystem(config.buildingDefs, config.populationConfig.maxCommuteDistance),
    createProductionSystem(config.buildingDefs, config.terrainEconomy),
    createPopulationSystem(config.buildingDefs, config.populationConfig),
    createTaxSystem(config.economyConfig),
    createRegrowthSystem(config.terrainEconomy),
    createMovementSystem(config.buildingDefs, config.bounds),
  ];
}
