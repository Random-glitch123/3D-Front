// Singleplayer local game authority.
//
// Mirrors the server's authoritative loop in the browser: starting-hex claim,
// 1s passive soldier generation, and adjacent-hex conquest. It implements the
// same `on`/`send`/`getPlayerId` surface as RelayClient so GameModule and all
// gameplay UI are shared between singleplayer and multiplayer.

import type {
  ClientMessage,
  GameState,
  HexOwnership,
  PlayerEconomy,
  Territory,
  WorldMapData,
} from '../shared/protocol';
import {
  MAX_SOLDIERS_PER_HEX,
  PLAYER_COLORS,
  SOLDIERS_PER_SECOND_PER_HEX,
  isHexOwnable,
} from '../shared/protocol';
import type { BuildingType } from '../shared/protocol';
import type { RelayClientEvents } from '../net/relay-client';
import { getHexBaseValue, getBuildingCost } from './economy';

const TICK_MS = 1000;
const STATE_SYNC_INTERVAL_MS = 5000;
const START_COUNTDOWN_SECONDS = 5;

export class LocalGameClient {
  private worldMap: WorldMapData;
  private playerId = 'local_player';
  private colorIndex: number;
  private color: number;

  private hexOwnership: HexOwnership[];
  private economy: PlayerEconomy;
  private events: Partial<RelayClientEvents> = {};

  private tickTimer: number | null = null;
  private stateSyncTimer: number | null = null;
  private countdownTimer: number | null = null;
  private countdown = START_COUNTDOWN_SECONDS;
  private hasClaimedStart = false;
  private disposed = false;

  constructor(worldMap: WorldMapData, colorIndex: number = 0) {
    this.worldMap = worldMap;
    this.colorIndex = Math.max(0, Math.min(colorIndex, PLAYER_COLORS.length - 1));
    this.color = PLAYER_COLORS[this.colorIndex] ?? 0x00ffff;

    this.hexOwnership = worldMap.hexes.map((_, i) => ({
      hexId: i,
      ownerId: null,
      soldiers: 0,
    }));

    this.economy = {
      playerId: this.playerId,
      ownedHexCount: 0,
      totalSoldiers: 0,
      incomePerSecond: 0,
      lastUpdate: Date.now(),
      color: this.color,
      colorIndex: this.colorIndex,
      population: 0,
      maxPopulation: 0,
      gold: 0,
      soldierAllocationRatio: 0.2,
      attackAllocationRatio: 0.5,
    };
  }

  // --- GameSessionClient surface -------------------------------------------

  on<K extends keyof RelayClientEvents>(event: K, handler: RelayClientEvents[K]): void {
    (this.events as any)[event] = handler;
  }

  getPlayerId(): string {
    return this.playerId;
  }

  send(message: ClientMessage): void {
    if (this.disposed) return;

    switch (message.type) {
      case 'select_start_hex':
        this.claimStartHex(message.hexId);
        break;
      case 'select_hex':
        // Selection is purely client-side in singleplayer; nothing to store.
        break;
      case 'attack_hex':
        this.attackHex(message.hexId, message.fromHexIds);
        break;
      case 'build_structure':
        this.buildStructure(message.hexId, message.buildingType);
        break;
      case 'demolish_building':
        this.demolishBuilding(message.hexId);
        break;
      case 'set_soldier_allocation':
        this.setSoldierAllocation(message.ratio);
        break;
      case 'set_attack_allocation':
        this.setAttackAllocation(message.ratio);
        break;
      default:
        break;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopCountdown();
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.stateSyncTimer !== null) {
      window.clearInterval(this.stateSyncTimer);
      this.stateSyncTimer = null;
    }
  }

  // --- Lifecycle ------------------------------------------------------------

  /** Begin the 5-second starting-hex countdown. Call after GameModule is ready. */
  begin(): void {
    if (this.disposed) return;
    this.emit('onStateChange', 'connected');
    this.emitCountdown();

    this.countdownTimer = window.setInterval(() => {
      this.countdown--;
      this.emitCountdown();

      if (this.countdown <= 0) {
        this.stopCountdown();
        if (!this.hasClaimedStart) {
          this.autoAssignStartHex();
        }
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private emitCountdown(): void {
    this.emit('onStartHexCountdown', { secondsRemaining: this.countdown });
  }

  // --- Starting hex ---------------------------------------------------------

  private claimStartHex(hexId: number): boolean {
    if (this.hasClaimedStart) return false;

    const hex = this.worldMap.hexes[hexId];
    if (!hex || !isHexOwnable(hex.biome)) {
      this.emit('onError', 'Choose a land hex (not ocean or beach).');
      return false;
    }
    if (this.hexOwnership[hexId]?.ownerId) {
      this.emit('onError', 'That hex is already owned.');
      return false;
    }

    this.hexOwnership[hexId] = {
      hexId,
      ownerId: this.playerId,
      soldiers: getHexBaseValue(hex.biome),
    };

    this.hasClaimedStart = true;
    this.stopCountdown();
    this.recalculateEconomy();

    this.emit('onStartHexConfirmed', { hexId });
    this.emitState();
    this.startTicks();
    return true;
  }

  private autoAssignStartHex(): void {
    const candidates: number[] = [];
    for (let i = 0; i < this.worldMap.hexes.length; i++) {
      if (!this.hexOwnership[i].ownerId && isHexOwnable(this.worldMap.hexes[i].biome)) {
        candidates.push(i);
      }
    }
    if (candidates.length === 0) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    this.claimStartHex(pick);
  }

  // --- Tick loop ------------------------------------------------------------

  private startTicks(): void {
    if (this.tickTimer !== null) return;

    this.tickTimer = window.setInterval(() => {
      const gain = SOLDIERS_PER_SECOND_PER_HEX;
      for (const hex of this.hexOwnership) {
        if (hex.ownerId === this.playerId) {
          hex.soldiers = Math.min(MAX_SOLDIERS_PER_HEX, hex.soldiers + gain);
        }
      }
      this.recalculateEconomy();
      this.emit('onEconomyUpdate', { ...this.economy });
    }, TICK_MS);

    this.stateSyncTimer = window.setInterval(() => this.emitState(), STATE_SYNC_INTERVAL_MS);
  }

  private recalculateEconomy(): void {
    let ownedHexCount = 0;
    let totalSoldiers = 0;

    for (const hex of this.hexOwnership) {
      if (hex.ownerId === this.playerId) {
        ownedHexCount++;
        totalSoldiers += hex.soldiers;
      }
    }

    this.economy = {
      ...this.economy,
      ownedHexCount,
      totalSoldiers: Math.floor(totalSoldiers),
      incomePerSecond: ownedHexCount * SOLDIERS_PER_SECOND_PER_HEX,
      lastUpdate: Date.now(),
      color: this.color,
      colorIndex: this.colorIndex,
    };
  }

  // --- Conquest -------------------------------------------------------------

  private attackHex(targetHexId: number, fromHexIds: number[]): void {
    const target = this.hexOwnership[targetHexId];
    const targetHex = this.worldMap.hexes[targetHexId];
    if (!target || !targetHex) return;

    if (target.ownerId === this.playerId) {
      this.emit('onError', 'That hex is already yours.');
      return;
    }
    if (!isHexOwnable(targetHex.biome)) {
      this.emit('onError', 'Ocean and beach tiles cannot be captured.');
      return;
    }

    // Only adjacent, owned hexes can launch the attack.
    const neighbors = new Set(targetHex.neighbors);
    const sources = fromHexIds.filter(
      (id) => this.hexOwnership[id]?.ownerId === this.playerId && neighbors.has(id),
    );

    if (sources.length === 0) {
      this.emit('onError', 'Select one of your hexes next to the target first.');
      return;
    }

    let committedTotal = 0;
    let attackForce = 0;

    for (const id of sources) {
      const source = this.hexOwnership[id];
      const committed = Math.floor(source.soldiers * 0.5);
      source.soldiers -= committed;
      committedTotal += committed;
      // 30% losses while marching.
      attackForce += Math.floor(committed * 0.7);
    }

    if (attackForce <= 0) {
      this.emit('onError', 'Not enough soldiers to attack.');
      return;
    }

    const defenderId = target.ownerId ?? undefined;
    const defense = defenderId
      ? target.soldiers
      : getHexBaseValue(targetHex.biome);

    let captured = false;
    if (attackForce > defense) {
      captured = true;
      target.ownerId = this.playerId;
      target.soldiers = Math.max(1, attackForce - defense);
    } else if (defenderId) {
      // Only owned hexes keep a damaged garrison; neutral hexes always defend
      // at full biome base value on the next attempt.
      target.soldiers = Math.max(0, defense - attackForce);
    }

    const casualties = Math.max(0, committedTotal - (captured ? target.soldiers : 0));

    this.recalculateEconomy();

    this.emit('onAttackResult', {
      success: true,
      hexId: targetHexId,
      attackerId: this.playerId,
      defenderId,
      casualties,
    });

    if (captured) {
      this.emit('onHexCaptured', {
        hexId: targetHexId,
        newOwner: this.playerId,
        soldiers: target.soldiers,
      });
    }

    this.emit('onEconomyUpdate', { ...this.economy });
    this.emitState();
  }

  // --- Building ---------------------------------------------------------------

  private buildStructure(hexId: number, buildingType: BuildingType): void {
    const hex = this.hexOwnership[hexId];
    const worldHex = this.worldMap.hexes[hexId];
    if (!hex || !worldHex) return;
    if (hex.ownerId !== this.playerId) {
      this.emit('onError', 'You do not own this hex.');
      return;
    }
    if (hex.building) {
      this.emit('onError', 'This hex already has a building.');
      return;
    }

    const cost = getBuildingCost(buildingType);
    if (!cost) return;

    if (this.economy.gold < cost.gold) {
      this.emit('onError', 'Not enough gold.');
      return;
    }

    if (buildingType === 'capital' && this.hasAnyCapital()) {
      this.emit('onError', 'You already have a capital.');
      return;
    }

    // Deduct costs
    this.economy.gold -= cost.gold;
    this.economy.maxPopulation -= cost.population;

    // Start construction
    hex.building = {
      type: buildingType,
      level: 1,
      progress: 0,
      maxProgress: cost.timeSeconds,
      ownerId: this.playerId,
      startedAt: Date.now(),
    };

    this.emit('onBuildingStarted', { hexId, buildingType, playerId: this.playerId });

    // Complete construction after timeSeconds
    window.setTimeout(() => {
      if (hex.building && hex.building.type === buildingType) {
        hex.building.progress = hex.building.maxProgress;
        this.recalculateEconomy();
        this.emit('onBuildingCompleted', { hexId, buildingType, playerId: this.playerId });
        this.emitState();
        this.emit('onEconomyUpdate', { ...this.economy });
      }
    }, cost.timeSeconds * 1000);
  }

  private demolishBuilding(hexId: number): void {
    const hex = this.hexOwnership[hexId];
    if (!hex || hex.ownerId !== this.playerId) return;
    if (!hex.building) return;

    const cost = getBuildingCost(hex.building.type);
    if (cost) {
      this.economy.gold += Math.floor(cost.gold * 0.5);
      this.economy.maxPopulation += Math.floor(cost.population * 0.5);
    }

    hex.building = undefined;
    this.recalculateEconomy();
    this.emit('onBuildingDemolished', { hexId, playerId: this.playerId });
    this.emitState();
    this.emit('onEconomyUpdate', { ...this.economy });
  }

  private setSoldierAllocation(ratio: number): void {
    this.economy.soldierAllocationRatio = Math.max(0, Math.min(1, ratio));
    this.recalculateEconomy();
    this.emit('onEconomyUpdate', { ...this.economy });
  }

  private setAttackAllocation(ratio: number): void {
    this.economy.attackAllocationRatio = Math.max(0, Math.min(1, ratio));
  }

  private hasAnyCapital(): boolean {
    return this.hexOwnership.some(h => h.ownerId === this.playerId && h.building?.type === 'capital');
  }

  // --- Helpers --------------------------------------------------------------

  private emit<K extends keyof RelayClientEvents>(event: K, ...args: any[]): void {
    const handler = (this.events as any)[event];
    if (handler) handler(...args);
  }

  private emitState(): void {
    if (this.disposed) return;

    const territories = new Map<string, Territory>();
    const state: GameState = {
      hexOwnership: this.hexOwnership,
      playerEconomies: new Map([[this.playerId, { ...this.economy }]]),
      territories,
      selectedHexes: new Map<string, number[]>(),
    };

    this.emit('onGameStateSync', state);
  }
}
