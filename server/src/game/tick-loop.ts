// Server game tick loop
// Runs at 1 second intervals for passive soldier generation

import { Broadcaster } from '../broadcast';
import { LobbyState, BuildingType } from '../shared/protocol';
import { GameStateManager } from './game-state';

interface TickLoopConfig {
  lobby: LobbyState;
  gameStateManager: GameStateManager;
  broadcaster: Broadcaster;
  tickIntervalMs?: number; // Default 1000ms (1 second)
}

export class GameTickLoop {
  private config: TickLoopConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private lastTickTime: number = 0;
  private isRunning: boolean = false;

  constructor(config: TickLoopConfig) {
    this.config = {
      tickIntervalMs: 1000,
      ...config
    };
  }

  /** Start the tick loop */
  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.lastTickTime = Date.now();
    
    this.intervalId = setInterval(() => this.tick(), this.config.tickIntervalMs);
    console.log('[TickLoop] Started with interval', this.config.tickIntervalMs, 'ms');
  }

  /** Stop the tick loop */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[TickLoop] Stopped');
  }

  /** Single tick - apply passive generation, process buildings, broadcast updates */
  private tick(): void {
    const now = Date.now();
    const deltaSeconds = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;

    try {
      // Process building construction first
      const completedBuildings = this.config.gameStateManager.tickBuildings(deltaSeconds);

      // Broadcast building completions
      for (const building of completedBuildings) {
        this.config.broadcaster.broadcast(this.config.lobby, {
          type: 'building_completed',
          hexId: building.hexId,
          buildingType: building.buildingType,
          playerId: building.playerId
        });
      }

      // Apply passive generation (soldiers, gold, population)
      this.config.gameStateManager.applyPassiveGeneration(deltaSeconds);

      // Broadcast economy updates to all players
      this.broadcastEconomyUpdates();

      // Broadcast full game state periodically (buildings changed)
      if (completedBuildings.length > 0) {
        this.config.broadcaster.broadcastGameState(this.config.lobby);
      }
    } catch (err) {
      console.error('[TickLoop] Error during tick:', err);
    }
  }

  /** Broadcast economy updates to all players in the lobby */
  private broadcastEconomyUpdates(): void {
    const { lobby, broadcaster } = this.config;
    const gameState = this.config.gameStateManager.getGameState();

    for (const player of lobby.players) {
      const economy = gameState.playerEconomies.get(player.id);
      if (economy) {
        // Send to specific player
        const client = this.getClientForPlayer(lobby, player.id);
        if (client) {
          broadcaster.send(client, {
            type: 'economy_update',
            economy
          });
        }
      }
    }
  }

  /** Get connected client for a player */
  private getClientForPlayer(lobby: LobbyState, playerId: string): any {
    const clients = this.config.broadcaster.getLobbyClients?.(lobby.code) || [];
    return clients.find((c: any) => c.id === playerId);
  }

  /** Check if loop is running */
  get running(): boolean {
    return this.isRunning;
  }
}

/** Factory function */
export function createTickLoop(config: TickLoopConfig): GameTickLoop {
  return new GameTickLoop(config);
}
