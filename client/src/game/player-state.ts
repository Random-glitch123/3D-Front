// Client-side player state management
// Handles economy updates, soldier count animations, and UI events

import type { PlayerEconomy, GameState } from '../shared/protocol';
import { HexOwnershipManager } from './hex-ownership';

type EconomyListener = (economy: PlayerEconomy) => void;
type SoldierCountListener = (current: number, target: number, incomePerSecond: number) => void;

export interface PlayerStateConfig {
  totalHexes: number;
  localPlayerId: string;
}

export class PlayerState {
  private hexManager: HexOwnershipManager;
  private localPlayerId: string;
  private currentSoldiers: number = 0;
  private targetSoldiers: number = 0;
  private incomePerSecond: number = 0;
  private economyListeners: Set<EconomyListener> = new Set();
  private soldierCountListeners: Set<SoldierCountListener> = new Set();
  private animationFrame: number | null = null;
  private isAnimating: boolean = false;

  constructor(config: PlayerStateConfig) {
    this.localPlayerId = config.localPlayerId;
    this.hexManager = new HexOwnershipManager(config.totalHexes);
  }

  /** Initialize from game state sync */
  initialize(gameState: GameState) {
    this.hexManager.applyGameStateSync(gameState, this.localPlayerId);
    const economy = this.hexManager.getLocalEconomy();
    if (economy) {
      this.currentSoldiers = economy.totalSoldiers;
      this.targetSoldiers = economy.totalSoldiers;
      this.incomePerSecond = economy.incomePerSecond;
      this.notifyEconomyListeners(economy);
    }
  }

  /** Apply economy update from server */
  applyEconomyUpdate(economy: PlayerEconomy) {
    this.hexManager.applyEconomyUpdate(economy);
    
    if (economy.playerId === this.localPlayerId) {
      // Smooth animate to new target
      this.targetSoldiers = economy.totalSoldiers;
      this.incomePerSecond = economy.incomePerSecond;
      this.startAnimation();
      this.notifyEconomyListeners(economy);
    }
  }

  /** Apply full game state sync */
  applyGameStateSync(gameState: GameState) {
    this.hexManager.applyGameStateSync(gameState, this.localPlayerId);
    const economy = this.hexManager.getLocalEconomy();
    if (economy) {
      this.currentSoldiers = economy.totalSoldiers;
      this.targetSoldiers = economy.totalSoldiers;
      this.incomePerSecond = economy.incomePerSecond;
      this.notifySoldierCountListeners();
      this.notifyEconomyListeners(economy);
    }
  }

  /** Start smooth animation to target soldier count */
  private startAnimation() {
    if (this.isAnimating) return;
    this.isAnimating = true;
    this.animate();
  }

  private animate() {
    const diff = this.targetSoldiers - this.currentSoldiers;
    if (Math.abs(diff) < 0.5) {
      this.currentSoldiers = this.targetSoldiers;
      this.isAnimating = false;
      this.notifySoldierCountListeners();
      return;
    }

    // Smooth interpolation (adjust speed as needed)
    this.currentSoldiers += diff * 0.15;
    this.notifySoldierCountListeners();
    this.animationFrame = requestAnimationFrame(() => this.animate());
  }

  private notifySoldierCountListeners() {
    for (const listener of this.soldierCountListeners) {
      listener(this.currentSoldiers, this.targetSoldiers, this.incomePerSecond);
    }
  }

  private notifyEconomyListeners(economy: PlayerEconomy) {
    for (const listener of this.economyListeners) {
      listener(economy);
    }
  }

  /** Subscribe to economy updates */
  onEconomyUpdate(listener: EconomyListener): () => void {
    this.economyListeners.add(listener);
    return () => this.economyListeners.delete(listener);
  }

  /** Subscribe to soldier count changes (for UI animation) */
  onSoldierCountChange(listener: SoldierCountListener): () => void {
    this.soldierCountListeners.add(listener);
    return () => this.soldierCountListeners.delete(listener);
  }

  /** Get current animated soldier count */
  getCurrentSoldiers(): number {
    return this.currentSoldiers;
  }

  /** Get target soldier count (server authoritative) */
  getTargetSoldiers(): number {
    return this.targetSoldiers;
  }

  /** Get income per second */
  getIncomePerSecond(): number {
    return this.incomePerSecond;
  }

  /** Get hex ownership manager */
  getHexManager(): HexOwnershipManager {
    return this.hexManager;
  }

  /** Get local player ID */
  getLocalPlayerId(): string {
    return this.localPlayerId;
  }

  /** Cleanup */
  dispose() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.economyListeners.clear();
    this.soldierCountListeners.clear();
  }
}