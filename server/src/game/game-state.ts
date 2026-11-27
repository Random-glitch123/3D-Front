// Server-side authoritative game state
// Manages hex ownership, player economies, territories, and game logic

import { 
  LobbyState, 
  Player, 
  GameState, 
  HexOwnership, 
  PlayerEconomy, 
  WorldMapData, 
  PLAYER_COLORS,
  MAX_SOLDIERS_PER_HEX,
  SOLDIERS_PER_SECOND_PER_HEX,
  Territory,
  TerritoryBorder,
  Building,
  BuildingType
} from '../shared/protocol';
import { isHexOwnable } from '../shared/protocol';
import * as economyModule from './economy';
import {
  getHexBaseValue,
  hasCapital,
  getBuildingCost,
  calculateAllocatedSoldiers,
  recalculatePlayerEconomy
} from './economy';
import { computeTerritories, getHexTerritoryType } from './territory';
import { findPath, findAttackPaths, isFrontlineHex, getFrontlineHexes } from './pathfinding';

export interface GameStateManager {
  initializeGameState(lobby: LobbyState, worldMap: WorldMapData): void;
  selectStartHex(playerId: string, hexId: number): { success: boolean; error?: string };
  selectHex(playerId: string, hexId: number, shiftKey: boolean): { success: boolean; error?: string };
  deselectHex(playerId: string, hexId: number): { success: boolean; error?: string };
  attackHex(attackerId: string, fromHexIds: number[], targetHexId: number): { success: boolean; error?: string; casualties?: number; captured?: boolean; defenderId?: string; capitalDestroyed?: boolean };
  buildStructure(playerId: string, hexId: number, buildingType: BuildingType): { success: boolean; error?: string; durationSeconds?: number };
  demolishBuilding(playerId: string, hexId: number): { success: boolean; error?: string };
  setSoldierAllocation(playerId: string, ratio: number): { success: boolean; error?: string };
  setAttackAllocation(playerId: string, ratio: number): { success: boolean; error?: string };
  tickBuildings(deltaSeconds: number): Array<{ hexId: number; buildingType: BuildingType; playerId: string }>;
  getGameState(): GameState;
  getHexOwner(hexId: number): string | null;
  getPlayerEconomy(playerId: string): PlayerEconomy | undefined;
  recalculateAllEconomies(): void;
  applyPassiveGeneration(deltaSeconds: number): void;
}

export function createGameStateManager(): GameStateManager {
  let gameState: GameState | null = null;
  let worldMap: WorldMapData | null = null;
  const buildingsUnderConstruction = new Map<string, { hexId: number; buildingType: BuildingType; playerId: string; startTime: number; durationSeconds: number }>();

  function initializeGameState(lobby: LobbyState, map: WorldMapData) {
    worldMap = map;
    
    const hexCount = map.hexes.length;
    const hexOwnership: HexOwnership[] = new Array(hexCount).fill(null).map((_, i) => ({
      hexId: i,
      ownerId: null,
      soldiers: 0
    }));

    const playerEconomies = new Map<string, PlayerEconomy>();
    const territories = new Map<string, Territory>();
    const selectedHexes = new Map<string, number[]>();
    
    // Initialize economy for each player (empty until they select starting hex)
    for (const player of lobby.players) {
      const safeColorIndex = player.colorIndex ?? 0;
      playerEconomies.set(player.id, {
        playerId: player.id,
        ownedHexCount: 0,
        totalSoldiers: 0,
        incomePerSecond: 0,
        lastUpdate: Date.now(),
        color: PLAYER_COLORS[safeColorIndex % PLAYER_COLORS.length] ?? 0x00ffff,
        colorIndex: safeColorIndex,
        population: 0,
        maxPopulation: 0,
        gold: 0,
        soldierAllocationRatio: 0.2,
        attackAllocationRatio: 0.5,
      });
      selectedHexes.set(player.id, []);
    }

    // Initialize empty territories
    for (const player of lobby.players) {
      territories.set(player.id, {
        ownerId: player.id,
        hexIds: [],
        borderHexIds: [],
        frontlineHexIds: [],
        interiorHexIds: [],
        neighboringTerritories: new Map()
      });
    }

    gameState = {
      hexOwnership,
      playerEconomies,
      territories,
      selectedHexes
    };

    // Attach to lobby
    lobby.gameState = gameState;
    console.log('[GameState] Initialized game state with', hexCount, 'hexes');
  }

  function selectStartHex(playerId: string, hexId: number): { success: boolean; error?: string } {
    if (!gameState || !worldMap) {
      return { success: false, error: 'Game state not initialized' };
    }

    // Validate hex ID
    if (hexId < 0 || hexId >= worldMap.hexes.length) {
      return { success: false, error: 'Invalid hex ID' };
    }

    const hex = worldMap.hexes[hexId];
    if (!hex) {
      return { success: false, error: 'Invalid hex ID' };
    }
    
    // Validate hex is ownable (land)
    if (!isHexOwnable(hex.biome)) {
      return { success: false, error: 'Cannot claim ocean or beach hexes' };
    }

    // Validate hex is unowned
    const currentOwner = gameState.hexOwnership[hexId]?.ownerId;
    if (currentOwner) {
      return { success: false, error: 'Hex already owned' };
    }

    // Exactly one starting hex per player. This also closes the race where a
    // manual click arrives just after the countdown auto-assigned a hex.
    if (gameState.hexOwnership.some(h => h.ownerId === playerId)) {
      return { success: false, error: 'You already have a starting hex' };
    }

    // Assign hex to player (color already set in lobby)
    const baseSoldiers = getHexBaseValue(hex.biome);
    gameState.hexOwnership[hexId] = {
      hexId,
      ownerId: playerId,
      soldiers: baseSoldiers
    };

    // Recalculate economy and territories for this player
    recalculateEconomyForPlayer(playerId);
    updateTerritories();

    console.log('[GameState] Player', playerId, 'claimed starting hex', hexId, '(', getBiomeName(hex.biome), ') with', baseSoldiers, 'soldiers');
    return { success: true };
  }

  function selectHex(playerId: string, hexId: number, shiftKey: boolean): { success: boolean; error?: string } {
    if (!gameState || !worldMap) {
      return { success: false, error: 'Game state not initialized' };
    }

    if (hexId < 0 || hexId >= worldMap.hexes.length) {
      return { success: false, error: 'Invalid hex ID' };
    }

    const hex = worldMap.hexes[hexId];
    if (!hex) {
      return { success: false, error: 'Invalid hex ID' };
    }

    const selection = gameState.selectedHexes.get(playerId) || [];
    
    if (shiftKey) {
      // Toggle in multi-selection
      const index = selection.indexOf(hexId);
      if (index >= 0) {
        selection.splice(index, 1);
      } else {
        // Only allow selecting owned hexes for multi-attack
        const ownership = gameState.hexOwnership[hexId];
        if (!ownership || ownership.ownerId !== playerId) {
          return { success: false, error: 'Can only select your own hexes' };
        }
        selection.push(hexId);
      }
    } else {
      // Single select - replace selection
      const ownership = gameState.hexOwnership[hexId];
      if (ownership && ownership.ownerId === playerId) {
        gameState.selectedHexes.set(playerId, [hexId]);
      } else {
        gameState.selectedHexes.set(playerId, []);
      }
    }

    return { success: true };
  }

  function deselectHex(playerId: string, hexId: number): { success: boolean; error?: string } {
    if (!gameState) {
      return { success: false, error: 'Game state not initialized' };
    }

    const selection = gameState.selectedHexes.get(playerId) || [];
    const index = selection.indexOf(hexId);
    if (index >= 0) {
      selection.splice(index, 1);
    }

    return { success: true };
  }

  function attackHex(attackerId: string, fromHexIds: number[], targetHexId: number): { success: boolean; error?: string; casualties?: number; captured?: boolean; defenderId?: string; capitalDestroyed?: boolean } {
    if (!gameState || !worldMap) {
      return { success: false, error: 'Game state not initialized' };
    }

    const gs = gameState!;
    const wm = worldMap!;

    if (targetHexId < 0 || targetHexId >= wm.hexes.length) {
      return { success: false, error: 'Invalid target hex' };
    }

    const targetOwnership = gs.hexOwnership[targetHexId];
    if (!targetOwnership) {
      return { success: false, error: 'Invalid target hex' };
    }
    if (targetOwnership.ownerId === attackerId) {
      return { success: false, error: 'Cannot attack your own hex' };
    }

    // Ocean/beach are never capturable.
    const targetHexData = wm.hexes[targetHexId]!;
    if (!isHexOwnable(targetHexData.biome)) {
      return { success: false, error: 'Cannot capture ocean or beach hexes' };
    }

    // Conquest is adjacency-based: a source must be one of your hexes that
    // directly neighbours the target. Neutral hexes are expandable this way;
    // enemy hexes can only be hit along the shared border (frontline).
    const targetNeighbors = new Set(targetHexData.neighbors);
    const validSources = fromHexIds.filter(hexId => {
      const ownership = gs.hexOwnership[hexId];
      return !!ownership && ownership.ownerId === attackerId && targetNeighbors.has(hexId);
    });

    if (validSources.length === 0) {
      return { success: false, error: 'Select one of your hexes adjacent to the target' };
    }

    let committedTotal = 0;
    let attackForce = 0;

    for (const sourceHexId of validSources) {
      const sourceOwnership = gs.hexOwnership[sourceHexId]!;
      const committed = Math.floor(sourceOwnership.soldiers * 0.5);
      if (committed <= 0) continue;
      sourceOwnership.soldiers -= committed;
      committedTotal += committed;
      // 30% losses while marching to the target.
      attackForce += Math.floor(committed * 0.7);
    }

    if (attackForce <= 0) {
      return { success: false, error: 'Not enough soldiers to attack' };
    }

    // Neutral hexes defend with their biome base value.
    const defenderId = targetOwnership.ownerId ?? undefined;
    const defense = defenderId
      ? targetOwnership.soldiers
      : getHexBaseValue(targetHexData.biome);

    let captured = false;
    let capitalDestroyed = false;
    if (attackForce > defense) {
      captured = true;
      targetOwnership.ownerId = attackerId;
      targetOwnership.soldiers = Math.max(1, attackForce - defense);
      
      // Capital is destroyed when its hex is captured - the conqueror does NOT get it
      if (targetOwnership.building?.type === 'capital') {
        capitalDestroyed = true;
        targetOwnership.building = undefined;
        // Notify all players - the capital falls to ash
      }
    } else if (defenderId) {
      // Only owned hexes keep a damaged garrison; neutral hexes always defend
      // at their full biome base value on the next attempt.
      targetOwnership.soldiers = Math.max(0, defense - attackForce);
    }

    recalculateEconomyForPlayer(attackerId);
    if (defenderId) recalculateEconomyForPlayer(defenderId);
    updateTerritories();

    const casualties = Math.max(0, committedTotal - (captured ? targetOwnership.soldiers : 0));

    return {
      success: true,
      casualties,
      captured,
      defenderId,
      capitalDestroyed
    };
  }

  function buildStructure(playerId: string, hexId: number, buildingType: BuildingType): { success: boolean; error?: string; durationSeconds?: number } {
    if (!gameState || !worldMap) {
      return { success: false, error: 'Game state not initialized' };
    }

    const gs = gameState!;
    const wm = worldMap!;

    if (hexId < 0 || hexId >= wm.hexes.length) {
      return { success: false, error: 'Invalid hex ID' };
    }

    const hex = wm.hexes[hexId];
    if (!hex || !isHexOwnable(hex.biome)) {
      return { success: false, error: 'Cannot build on ocean or beach hexes' };
    }

    const ownership = gs.hexOwnership[hexId];
    if (!ownership || ownership.ownerId !== playerId) {
      return { success: false, error: 'You do not own this hex' };
    }

    if (ownership.building) {
      return { success: false, error: 'This hex already has a building' };
    }

    // One-per-player check for capital
    if (buildingType === 'capital' && hasCapital(gs.hexOwnership, playerId)) {
      return { success: false, error: 'You already have a capital' };
    }

    const cost = getBuildingCost(buildingType);
    if (!cost) {
      return { success: false, error: 'Unknown building type' };
    }

    const economy = gs.playerEconomies.get(playerId);
    if (!economy) {
      return { success: false, error: 'Player economy not found' };
    }

    // Validate costs
    if (economy.gold < cost.gold) {
      return { success: false, error: 'Not enough gold' };
    }
    if (economy.maxPopulation < cost.population) {
      return { success: false, error: 'Not enough population capacity' };
    }

    // Deduct gold cost only (population is a requirement, not consumed)
    economy.gold -= cost.gold;
    // maxPopulation is calculated from buildings, not consumed by building cost
    gs.playerEconomies.set(playerId, economy);

    // Start construction
    const building: Building = {
      type: buildingType,
      level: 1,
      progress: 0,
      maxProgress: cost.timeSeconds, // ticks (1 second each)
      ownerId: playerId,
      startedAt: Date.now(),
    };
    ownership.building = building;

    const key = `${playerId}:${hexId}`;
    buildingsUnderConstruction.set(key, {
      hexId,
      buildingType,
      playerId,
      startTime: Date.now(),
      durationSeconds: cost.timeSeconds,
    });

    return { success: true, durationSeconds: cost.timeSeconds };
  }

  function demolishBuilding(playerId: string, hexId: number): { success: boolean; error?: string } {
    if (!gameState || !worldMap) {
      return { success: false, error: 'Game state not initialized' };
    }

    const gs = gameState!;

    if (hexId < 0 || hexId >= gs.hexOwnership.length) {
      return { success: false, error: 'Invalid hex ID' };
    }

    const ownership = gs.hexOwnership[hexId];
    if (!ownership || ownership.ownerId !== playerId) {
      return { success: false, error: 'You do not own this hex' };
    }

    if (!ownership.building) {
      return { success: false, error: 'No building on this hex' };
    }

    // Cancel construction if in progress
    const key = `${playerId}:${hexId}`;
    if (buildingsUnderConstruction.has(key)) {
      buildingsUnderConstruction.delete(key);
      // Refund gold (half)
      const economy = gs.playerEconomies.get(playerId);
      if (economy) {
        const cost = getBuildingCost(ownership.building.type);
        if (cost) {
          economy.gold += Math.floor(cost.gold * 0.5);
          economy.maxPopulation += Math.floor(cost.population * 0.5);
          gs.playerEconomies.set(playerId, economy);
        }
      }
    }

    const demolishedType = ownership.building.type;
    ownership.building = undefined;
    recalculateEconomyForPlayer(playerId);
    updateTerritories();

    return { success: true };
  }

  function setSoldierAllocation(playerId: string, ratio: number): { success: boolean; error?: string } {
    if (!gameState) {
      return { success: false, error: 'Game state not initialized' };
    }

    const clamped = Math.max(0, Math.min(1, ratio));
    const economy = gameState.playerEconomies.get(playerId);
    if (!economy) {
      return { success: false, error: 'Player economy not found' };
    }

    economy.soldierAllocationRatio = clamped;
    gameState.playerEconomies.set(playerId, economy);

    // Recalculate allocated soldiers
    const allocated = calculateAllocatedSoldiers(economy.population, clamped);
    economy.totalSoldiers = Math.min(economy.totalSoldiers, allocated);

    return { success: true };
  }

  function setAttackAllocation(playerId: string, ratio: number): { success: boolean; error?: string } {
    if (!gameState) {
      return { success: false, error: 'Game state not initialized' };
    }

    const clamped = Math.max(0, Math.min(1, ratio));
    const economy = gameState.playerEconomies.get(playerId);
    if (!economy) {
      return { success: false, error: 'Player economy not found' };
    }

    economy.attackAllocationRatio = clamped;
    gameState.playerEconomies.set(playerId, economy);

    return { success: true };
  }

  function tickBuildings(deltaSeconds: number): Array<{ hexId: number; buildingType: BuildingType; playerId: string }> {
    if (!gameState || !worldMap) return [];

    const now = Date.now();
    const completed: Array<{ hexId: number; buildingType: BuildingType; playerId: string }> = [];

    for (const [key, construction] of buildingsUnderConstruction) {
      const elapsed = (now - construction.startTime) / 1000;
      if (elapsed >= construction.durationSeconds) {
        // Construction complete
        const hex = gameState.hexOwnership[construction.hexId];
        if (hex && hex.building && hex.building.ownerId === construction.playerId) {
          hex.building.progress = hex.building.maxProgress;
          completed.push({
            hexId: construction.hexId,
            buildingType: construction.buildingType,
            playerId: construction.playerId,
          });
        }
        buildingsUnderConstruction.delete(key);
      }
    }

    // Recalculate economies for affected players
    const affectedPlayers = new Set(completed.map(c => c.playerId));
    for (const playerId of affectedPlayers) {
      recalculateEconomyForPlayer(playerId);
    }
    updateTerritories();

    return completed;
  }

  function updateTerritories(): void {
    if (!gameState || !worldMap) return;

    gameState.territories = computeTerritories(gameState.hexOwnership, worldMap.hexes);
  }

  function recalculateEconomyForPlayer(playerId: string): void {
    if (!gameState || !worldMap) return;
    
    const economy = recalculatePlayerEconomy(
      playerId,
      gameState.hexOwnership,
      worldMap.hexes,
      gameState.playerEconomies.get(playerId)
    );
    
    // Preserve color info
    const existingEconomy = gameState.playerEconomies.get(playerId);
    if (existingEconomy) {
      economy.color = existingEconomy.color;
      economy.colorIndex = existingEconomy.colorIndex;
    }
    
    gameState.playerEconomies.set(playerId, economy);
  }

  function recalculateAllEconomies(): void {
    if (!gameState || !worldMap) return;
    
    for (const playerId of gameState.playerEconomies.keys()) {
      recalculateEconomyForPlayer(playerId);
    }
    updateTerritories();
  }

  function applyPassiveGeneration(deltaSeconds: number): void {
    if (!gameState) return;

    const now = Date.now();

    for (const [playerId, economy] of gameState.playerEconomies) {
      const result = economyModule.applyPassiveGeneration(
        gameState.hexOwnership,
        playerId,
        deltaSeconds,
        economy
      );
      gameState.hexOwnership = result.hexOwnership;
      gameState.playerEconomies.set(playerId, result.economy);
    }
  }

  function getGameState(): GameState {
    if (!gameState) {
      throw new Error('Game state not initialized');
    }
    return gameState;
  }

  function getHexOwner(hexId: number): string | null {
    if (!gameState) return null;
    if (hexId < 0 || hexId >= gameState.hexOwnership.length) return null;
    return gameState.hexOwnership[hexId]?.ownerId ?? null;
  }

  function getPlayerEconomy(playerId: string): PlayerEconomy | undefined {
    if (!gameState) return undefined;
    return gameState.playerEconomies.get(playerId);
  }

  return {
    initializeGameState,
    selectStartHex,
    selectHex,
    deselectHex,
    attackHex,
    buildStructure,
    demolishBuilding,
    setSoldierAllocation,
    setAttackAllocation,
    tickBuildings,
    getGameState,
    getHexOwner,
    getPlayerEconomy,
    recalculateAllEconomies,
    applyPassiveGeneration
  };
}

function getBiomeName(biome: number): string {
  const names: Record<number, string> = {
    0: 'Ocean', 1: 'Beach', 2: 'Grassland', 3: 'Forest',
    4: 'Desert', 5: 'Tundra', 6: 'Snow', 7: 'Mountain', 8: 'Ice'
  };
  return names[biome] ?? 'Unknown';
}