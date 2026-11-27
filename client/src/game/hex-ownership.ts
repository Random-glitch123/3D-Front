// Client-side hex ownership tracking
// Provides instant UI feedback, reconciles with server snapshots

import type { HexOwnership, PlayerEconomy, GameState, Building, BuildingType } from '../shared/protocol';

export interface HexOwnershipState {
  hexOwnership: HexOwnership[];
  playerEconomies: Map<string, PlayerEconomy>;
  localPlayerId: string | null;
}

type Listener = () => void;

export class HexOwnershipManager {
  private hexOwnership: HexOwnership[] = [];
  private playerEconomies: Map<string, PlayerEconomy> = new Map();
  private localPlayerId: string | null = null;
  private listeners: Set<Listener> = new Set();
  private totalHexes: number;
  private version: number = 0;

  constructor(totalHexes: number) {
    this.totalHexes = totalHexes;
    // Initialize all hexes as unowned
    this.hexOwnership = new Array(totalHexes).fill(null).map((_, i) => ({
      hexId: i,
      ownerId: null,
      soldiers: 0
    }));
  }

  /** Subscribe to ownership changes */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.version++;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Monotonic version, bumped whenever ownership/economy data changes. */
  getVersion(): number {
    return this.version;
  }

  /** Apply full game state sync from server */
  applyGameStateSync(state: GameState, localPlayerId: string) {
    this.localPlayerId = localPlayerId;
    this.hexOwnership = state.hexOwnership;
    // Wire format is an array of [id, economy] entries; local/typed state uses
    // a real Map. Accept both (and plain objects) so nothing silently breaks.
    const econData = state.playerEconomies as unknown;
    if (econData instanceof Map) {
      this.playerEconomies = new Map(econData as Map<string, PlayerEconomy>);
    } else if (Array.isArray(econData)) {
      this.playerEconomies = new Map(econData as Array<[string, PlayerEconomy]>);
    } else if (econData && typeof econData === 'object') {
      this.playerEconomies = new Map(Object.entries(econData) as Array<[string, PlayerEconomy]>);
    } else {
      this.playerEconomies = new Map();
    }
    this.notify();
  }

  /** Apply incremental economy update */
  applyEconomyUpdate(economy: PlayerEconomy) {
    const previous = this.playerEconomies.get(economy.playerId);
    this.playerEconomies.set(economy.playerId, economy);

    const colorChanged =
      !previous ||
      previous.color !== economy.color ||
      previous.colorIndex !== economy.colorIndex;
    if (colorChanged) this.notify();
  }

  /** Apply building started (construction began) */
  applyBuildingStarted(_hexId: number, _buildingType: BuildingType, _playerId: string) {
    // Building started is informational; completion is what matters
  }

  /** Apply building completed */
  applyBuildingCompleted(_hexId: number, _buildingType: BuildingType, _playerId: string) {
    // Building completion is reflected in game_state_sync
  }

  /** Apply building demolished */
  applyBuildingDemolished(_hexId: number, _playerId: string) {
    // Demolition is reflected in game_state_sync
  }

  /** Apply capital destroyed (hex captured, capital removed) */
  applyCapitalDestroyed(_hexId: number, _formerOwnerId: string, _capturedBy: string | null) {
    // Capital destruction is reflected in game_state_sync
  }

  /** Optimistic update for hex capture (confirmed by server later) */
  optimisticCapture(hexId: number, playerId: string, soldiers: number) {
    if (hexId < 0 || hexId >= this.totalHexes) return;
    // When capturing a hex, capital is destroyed, other buildings may transfer
    // Server will send authoritative state; we clear building optimistically
    this.hexOwnership[hexId] = { hexId, ownerId: playerId, soldiers, building: undefined };
    this.notify();
  }

  /** Get all owned hex IDs for a player */
  getOwnedHexIds(playerId: string): number[] {
    return this.hexOwnership
      .filter(h => h.ownerId === playerId)
      .map(h => h.hexId);
  }

  /** Get owner of a specific hex */
  getHexOwner(hexId: number): string | null {
    if (hexId < 0 || hexId >= this.totalHexes) return null;
    return this.hexOwnership[hexId]?.ownerId ?? null;
  }

  /** Get soldiers on a specific hex */
  getHexSoldiers(hexId: number): number {
    if (hexId < 0 || hexId >= this.totalHexes) return 0;
    return this.hexOwnership[hexId]?.soldiers ?? 0;
  }

  /** Get full hex ownership data */
  getHexOwnership(hexId: number): HexOwnership | null {
    if (hexId < 0 || hexId >= this.totalHexes) return null;
    return this.hexOwnership[hexId] ?? null;
  }

  /** Get building on a hex */
  getHexBuilding(hexId: number): Building | null {
    const hex = this.getHexOwnership(hexId);
    return hex?.building ?? null;
  }

  /** Get all hex ownership array (for renderer) */
  getAllHexOwnership(): HexOwnership[] {
    return this.hexOwnership;
  }

  /** Get economy for a player */
  getEconomy(playerId: string): PlayerEconomy | undefined {
    return this.playerEconomies.get(playerId);
  }

  /** Get local player's economy */
  getLocalEconomy(): PlayerEconomy | undefined {
    if (!this.localPlayerId) return undefined;
    return this.playerEconomies.get(this.localPlayerId);
  }

  /** Get all player economies */
  getAllEconomies(): Map<string, PlayerEconomy> {
    return this.playerEconomies;
  }

  /** Get local player ID */
  getLocalPlayerId(): string | null {
    return this.localPlayerId;
  }

  /** Check if local player owns a hex */
  isLocalPlayerOwner(hexId: number): boolean {
    if (!this.localPlayerId) return false;
    return this.getHexOwner(hexId) === this.localPlayerId;
  }

  /** Get total hex count */
  getTotalHexes(): number {
    return this.totalHexes;
  }
}