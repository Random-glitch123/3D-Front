// Server-side economy calculations
// Pure functions for soldier/income/building calculation - must match client exactly

import { BIOME_MULTIPLIERS, BASE_SOLDIERS_PER_HEX, MAX_SOLDIERS_PER_HEX, SOLDIERS_PER_SECOND_PER_HEX, PLAYER_COLORS } from '../shared/protocol';
import type { HexOwnership, WorldMapData, PlayerEconomy, Building, BuildingType } from '../shared/protocol';

// Re-export constants for easy tuning
export {
  BIOME_MULTIPLIERS,
  BASE_SOLDIERS_PER_HEX,
  MAX_SOLDIERS_PER_HEX,
  SOLDIERS_PER_SECOND_PER_HEX,
  OWNERSHIP_TINT_OPACITY,
  PLAYER_COLORS
} from '../shared/protocol';

/**
 * Get the base soldier value a hex provides based on its biome
 * This is the starting soldier count when a hex is captured
 */
export function getHexBaseValue(biome: number): number {
  const multiplier = BIOME_MULTIPLIERS[biome] ?? 1.0;
  return Math.floor(BASE_SOLDIERS_PER_HEX * multiplier);
}

/**
 * Calculate player's total soldier CAP from owned hexes
 * Each hex caps at MAX_SOLDIERS_PER_HEX (500 by default)
 * Cities will increase this cap later
 */
export function calculateSoldierCap(ownedHexes: HexOwnership[], worldHexes: WorldMapData['hexes']): number {
  return ownedHexes.length * MAX_SOLDIERS_PER_HEX;
}

/**
 * Calculate passive income per second based on owned hex count
 */
export function calculateIncomePerSecond(ownedHexCount: number): number {
  return ownedHexCount * SOLDIERS_PER_SECOND_PER_HEX;
}

/**
 * Calculate max population from owned buildings.
 * Each city contributes 10 population per level.
 * Capital applies 1.5x multiplier to the TOTAL population.
 */
export function calculateMaxPopulation(hexOwnership: HexOwnership[], playerId: string): number {
  let basePopulation = 50; // Base population for every player
  let hasCapital = false;

  for (const hex of hexOwnership) {
    if (hex.ownerId !== playerId || !hex.building) continue;

    if (hex.building.type === 'city') {
      basePopulation += 10 * hex.building.level;
    } else if (hex.building.type === 'capital') {
      hasCapital = true;
      basePopulation += 10 * hex.building.level;
    }
  }

  if (hasCapital) {
    return Math.floor(basePopulation * 1.5);
  }
  return basePopulation;
}

/**
 * Calculate gold income per second from factories.
 * Each factory level generates 5 gold/sec.
 */
export function calculateGoldIncome(hexOwnership: HexOwnership[], playerId: string): number {
  let gold = 0;
  for (const hex of hexOwnership) {
    if (hex.ownerId !== playerId || !hex.building) continue;
    if (hex.building.type === 'factory') {
      gold += 5 * hex.building.level;
    }
  }
  return gold;
}

/**
 * Calculate soldier generation rate bonus from bases.
 * Each base adds 2% (stacks). Returns multiplier (e.g., 1.04 for 2 bases).
 */
export function calculateBaseMultiplier(hexOwnership: HexOwnership[], playerId: string): number {
  let baseCount = 0;
  for (const hex of hexOwnership) {
    if (hex.ownerId !== playerId || !hex.building) continue;
    if (hex.building.type === 'base') {
      baseCount++;
    }
  }
  return 1 + (baseCount * 0.02);
}

/**
 * Calculate soldiers available from population allocation.
 * soldiers = floor(population * soldierAllocationRatio)
 */
export function calculateAllocatedSoldiers(population: number, soldierAllocationRatio: number): number {
  return Math.floor(population * soldierAllocationRatio);
}

/**
 * Calculate soldiers committed to an attack based on attack allocation ratio.
 * committed = floor(availableSoldiers * attackAllocationRatio)
 */
export function calculateAttackForce(availableSoldiers: number, attackAllocationRatio: number): number {
  return Math.floor(availableSoldiers * attackAllocationRatio);
}

/**
 * Apply passive generation over a time delta.
 * Each owned hex trains soldiers based on base rate * baseMultiplier, capped at MAX_SOLDIERS_PER_HEX.
 * Also generates gold from factories.
 */
export function applyPassiveGeneration(
  hexOwnership: HexOwnership[],
  playerId: string,
  deltaSeconds: number,
  economy: PlayerEconomy
): { hexOwnership: HexOwnership[]; economy: PlayerEconomy } {
  const baseMultiplier = calculateBaseMultiplier(hexOwnership, playerId);
  const gainPerHex = SOLDIERS_PER_SECOND_PER_HEX * baseMultiplier * deltaSeconds;
  const goldGain = calculateGoldIncome(hexOwnership, playerId) * deltaSeconds;

  const updated = [...hexOwnership];
  let totalSoldiers = 0;
  let ownedHexCount = 0;

  for (let i = 0; i < updated.length; i++) {
    const hex = updated[i];
    if (!hex || hex.ownerId !== playerId) continue;

    ownedHexCount++;
    // Each hex trains soldiers up to its per-hex cap
    hex.soldiers = Math.min(MAX_SOLDIERS_PER_HEX, hex.soldiers + gainPerHex);
    totalSoldiers += hex.soldiers;
  }

  const soldierCap = calculateSoldierCap(updated.filter(h => h.ownerId === playerId), [] as any);
  totalSoldiers = Math.min(totalSoldiers, soldierCap);

  const updatedEconomy: PlayerEconomy = {
    ...economy,
    ownedHexCount,
    totalSoldiers: Math.floor(totalSoldiers),
    incomePerSecond: ownedHexCount * SOLDIERS_PER_SECOND_PER_HEX,
    gold: Math.floor(economy.gold + goldGain),
    lastUpdate: Date.now(),
  };

  return { hexOwnership: updated, economy: updatedEconomy };
}

/**
 * Calculate total soldiers from all owned hexes (sum of base values)
 * Used for initial soldier count when capturing hexes
 */
export function calculateTotalBaseSoldiers(
  ownedHexes: HexOwnership[],
  worldHexes: WorldMapData['hexes']
): number {
  return ownedHexes.reduce((sum, hex) => {
    const worldHex = worldHexes[hex.hexId];
    if (!worldHex) return sum;
    return sum + getHexBaseValue(worldHex.biome);
  }, 0);
}
export function getBiomeName(biome: number): string {
  const names: Record<number, string> = {
    0: 'Ocean',
    1: 'Beach',
    2: 'Grassland',
    3: 'Forest',
    4: 'Desert',
    5: 'Tundra',
    6: 'Snow',
    7: 'Mountain',
    8: 'Ice',
  };
  return names[biome] ?? 'Unknown';
}

/**
 * Check if a hex is ownable (land biomes only)
 */
export function isHexOwnable(biome: number): boolean {
  return biome >= 2; // Grassland and above are land
}

/**
 * Recalculate a player's economy from current game state
 * Called on each tick to update economy
 */
export function recalculatePlayerEconomy(
  playerId: string,
  hexOwnership: HexOwnership[],
  worldHexes: WorldMapData['hexes'],
  previousEconomy?: PlayerEconomy
): PlayerEconomy {
  const ownedHexes = hexOwnership.filter(h => h.ownerId === playerId);
  const ownedHexCount = ownedHexes.length;

  const incomePerSecond = calculateIncomePerSecond(ownedHexCount);
  const soldierCap = calculateSoldierCap(ownedHexes, worldHexes);
  const maxPopulation = calculateMaxPopulation(hexOwnership, playerId);
  const goldIncome = calculateGoldIncome(hexOwnership, playerId);

  // Total soldiers are the sum of the garrisons actually stationed on owned
  // hexes. Passive growth is applied once per tick by the game-state manager.
  let totalSoldiers = 0;
  for (const hex of ownedHexes) {
    totalSoldiers += hex.soldiers;
  }
  totalSoldiers = Math.min(totalSoldiers, soldierCap);

  // Allocated soldiers from population
  const population = Math.min(totalSoldiers, maxPopulation); // population capped by max
  const soldierAllocationRatio = previousEconomy?.soldierAllocationRatio ?? 0.2;
  const attackAllocationRatio = previousEconomy?.attackAllocationRatio ?? 0.5;

  return {
    playerId,
    ownedHexCount,
    totalSoldiers: Math.floor(totalSoldiers),
    incomePerSecond,
    lastUpdate: Date.now(),
    color: previousEconomy?.color ?? 0,
    colorIndex: previousEconomy?.colorIndex ?? 0,
    population,
    maxPopulation,
    gold: previousEconomy?.gold ?? 0,
    soldierAllocationRatio,
    attackAllocationRatio,
  };
}

/**
 * Get building cost from config
 */
export function getBuildingCost(buildingType: BuildingType): { gold: number; population: number; timeSeconds: number } | null {
  const costs: Record<BuildingType, { gold: number; population: number; timeSeconds: number } | null> = {
    city: { gold: 120, population: 10, timeSeconds: 10 },
    factory: { gold: 180, population: 5, timeSeconds: 10 },
    base: { gold: 250, population: 20, timeSeconds: 10 },
    capital: { gold: 600, population: 50, timeSeconds: 15 },
    ruin: null,
  };
  return costs[buildingType] ?? null;
}

/**
 * Get biome color for UI display
 */
export function getBiomeColor(biome: number): string {
  const colors: Record<number, string> = {
    0: '#2978bc', // Ocean
    1: '#e6d69e', // Beach
    2: '#7dae66', // Grassland
    3: '#33703d', // Forest
    4: '#d9c58a', // Desert
    5: '#9eab87', // Tundra
    6: '#edf2f8', // Snow
    7: '#858075', // Rock/Mountain
    8: '#f5faff', // Ice
  };
  return colors[biome] ?? '#888';
}

/**
 * Check if a player already has a capital
 */
export function hasCapital(hexOwnership: HexOwnership[], playerId: string): boolean {
  return hexOwnership.some(h => h.ownerId === playerId && h.building?.type === 'capital');
}
