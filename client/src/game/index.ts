// Game Module - Main entry point for gameplay systems
// Initializes economy, ownership, UI, and connects to a game session
// (multiplayer relay or local singleplayer simulation).

import type { GlobeRenderer } from '../globe/renderer';
import type { WorldMapData, GameState, PlayerEconomy, BuildingType } from '../shared/protocol';
import { ATTACK_FLASH_COLOR, ATTACK_FLASH_DURATION_MS, isHexOwnable } from '../shared/protocol';
import type { GameSessionClient } from './session';
import { PlayerState } from './player-state';
import { HexInfoTooltip } from './ui/hex-info-tooltip';
import { EconomyPanel } from './ui/economy-panel';
import { RadialMenu } from './ui/radial-menu';
import { StartingHexSelector } from './starting-hex-selector';
import { eventToCanvasPoint, pickHexAtScreen } from './input/raycast';

export interface GameModuleConfig {
  session: GameSessionClient;
  globeRenderer: GlobeRenderer;
  worldMap: WorldMapData;
  camera: any;
  canvas: HTMLCanvasElement;
  localPlayerId: string;
  playerName: string;
}

export class GameModule {
  private config: GameModuleConfig;
  private playerState: PlayerState;
  private hexTooltip: HexInfoTooltip | null = null;
  private economyPanel: EconomyPanel | null = null;
  private radialMenu: RadialMenu | null = null;
  private hexSelector: StartingHexSelector | null = null;
  private isInitialized: boolean = false;
  private hasGameStarted: boolean = false;
  private cleanup: (() => void)[] = [];

  // Interaction state
  private selectedHexIds: number[] = [];
  private flashHexIds: Set<number> = new Set();
  private flashTimeouts: Set<number> = new Set();
  private forceOwnershipUpdate: boolean = true;
  private lastOwnershipVersion: number = -1;

  constructor(config: GameModuleConfig) {
    this.config = config;
    this.playerState = new PlayerState({
      totalHexes: config.worldMap.hexes.length,
      localPlayerId: config.localPlayerId,
    });
  }

  /** Initialize game module - called when game starts */
  async initialize() {
    if (this.isInitialized) return;

    // Register listeners BEFORE any await. The server sends `game_start`,
    // then `game_state_sync` and `start_hex_countdown` back-to-back; if we
    // yield to the event loop first, those messages arrive with no handler
    // and are silently dropped (no initial state, frozen countdown bar).
    this.setupNetworkEvents();

    await this.waitForGlobeReady();
    this.startHexSelection();

    this.isInitialized = true;
  }

  private waitForGlobeReady(): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (this.config.globeRenderer && this.config.globeRenderer.landMesh) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }

  private setupNetworkEvents() {
    const session = this.config.session;

    session.on('onGameStateSync', (state: GameState) => {
      this.playerState.applyGameStateSync(state);
      this.onGameStateReady();
    });

    session.on('onEconomyUpdate', (economy: PlayerEconomy) => {
      this.playerState.applyEconomyUpdate(economy);
      this.economyPanel?.updateDisplay(economy);
    });

    session.on('onHexCaptured', (data: { hexId: number; newOwner: string; soldiers: number }) => {
      this.playerState.getHexManager().optimisticCapture(data.hexId, data.newOwner, data.soldiers);
      this.flashHex(data.hexId);
    });

    session.on('onStartHexConfirmed', (data: { hexId: number }) => {
      console.log('[Game] Starting hex confirmed:', data.hexId);
      this.startGameUI();
    });

    session.on('onStartHexCountdown', (data: { secondsRemaining: number }) => {
      this.hexSelector?.updateCountdown(data.secondsRemaining);
    });

    session.on('onAttackResult', (data: { success: boolean; hexId: number }) => {
      if (data.success) this.flashHex(data.hexId);
    });

    session.on('onBuildingStarted', (data: { hexId: number; buildingType: BuildingType; playerId: string }) => {
      this.playerState.getHexManager().applyBuildingStarted(data.hexId, data.buildingType, data.playerId);
    });

    session.on('onBuildingCompleted', (data: { hexId: number; buildingType: BuildingType; playerId: string }) => {
      this.playerState.getHexManager().applyBuildingCompleted(data.hexId, data.buildingType, data.playerId);
    });

    session.on('onBuildingDemolished', (data: { hexId: number; playerId: string }) => {
      this.playerState.getHexManager().applyBuildingDemolished(data.hexId, data.playerId);
    });

    session.on('onCapitalDestroyed', (data: { hexId: number; formerOwnerId: string; capturedBy: string | null }) => {
      this.playerState.getHexManager().applyCapitalDestroyed(data.hexId, data.formerOwnerId, data.capturedBy);
      this.flashHex(data.hexId);
    });

    session.on('onStateChange', (state) => {
      if (state === 'disconnected') this.handleDisconnect();
    });

    session.on('onError', (message: string) => {
      console.warn('[Game] Server error:', message);
    });
  }

  private startHexSelection() {
    this.hexSelector = new StartingHexSelector({
      worldMap: this.config.worldMap,
      globeRenderer: this.config.globeRenderer,
      camera: this.config.camera,
      canvas: this.config.canvas,
      localPlayerId: this.config.localPlayerId,
      onComplete: (hexId) => this.onHexSelected(hexId),
    });

    this.hexSelector.start();
  }

  private onHexSelected(hexId: number) {
    // Keep the selector alive until the server confirms. If the pick is
    // rejected the player can simply click another hex.
    this.config.session.send({ type: 'select_start_hex', hexId });
  }

  private onGameStateReady() {
    // The initial game-state sync arrives before the player has picked a hex.
    // Only transition into the live game UI once we actually own territory.
    const owned = this.playerState
      .getHexManager()
      .getOwnedHexIds(this.config.localPlayerId);
    if (owned.length === 0) return;

    this.startGameUI();
  }

  private startGameUI() {
    if (this.hasGameStarted) return;
    this.hasGameStarted = true;

    if (this.hexSelector) {
      this.hexSelector.dispose();
      this.hexSelector = null;
    }

    this.initializeGameUI();
    this.setupInteraction();
    this.forceOwnershipUpdate = true;
  }

  private initializeGameUI() {
    if (!this.hexTooltip) {
      this.hexTooltip = new HexInfoTooltip({
        hexManager: this.playerState.getHexManager(),
        worldHexes: this.config.worldMap.hexes,
        container: document.body,
        getPlayerName: (playerId: string) => `Player ${playerId.slice(-4)}`,
      });
    }

    if (!this.economyPanel) {
      this.economyPanel = new EconomyPanel({
        container: document.body,
        onSetSoldierAllocation: (ratio) => {
          this.config.session.send({ type: 'set_soldier_allocation', ratio });
        },
        onSetAttackAllocation: (ratio) => {
          this.config.session.send({ type: 'set_attack_allocation', ratio });
        },
      });
    }

    if (!this.radialMenu) {
      this.radialMenu = new RadialMenu({
        container: document.body,
        onAction: (result) => this.handleRadialAction(result),
      });
    }
  }

  private setupInteraction() {
    const canvas = this.config.canvas;
    let lastHoveredHexId = -1;

    const onMouseMove = (e: MouseEvent) => {
      const hexId = this.pickFromEvent(e);

      if (hexId !== lastHoveredHexId) {
        if (lastHoveredHexId >= 0) this.hexTooltip?.hide();
        if (hexId >= 0) this.hexTooltip?.show(hexId, e.clientX, e.clientY);
        lastHoveredHexId = hexId;
      } else if (hexId >= 0) {
        this.hexTooltip?.move(e.clientX, e.clientY);
      }
    };

    const onMouseLeave = () => {
      this.hexTooltip?.hide();
      lastHoveredHexId = -1;
    };

    // Single click: select one of your own hexes (Shift toggles multi-select).
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const hexId = this.pickFromEvent(e);
      if (hexId < 0) return;

      const owner = this.playerState.getHexManager().getHexOwner(hexId);
      if (owner !== this.config.localPlayerId) return;

      if (e.shiftKey) {
        const index = this.selectedHexIds.indexOf(hexId);
        if (index >= 0) this.selectedHexIds.splice(index, 1);
        else this.selectedHexIds.push(hexId);
      } else {
        this.selectedHexIds = [hexId];
      }

      this.config.session.send({ type: 'select_hex', hexId, shiftKey: e.shiftKey });
      this.forceOwnershipUpdate = true;
    };

    // Double click on a non-owned hex: attack from the current selection.
    const onDoubleClick = (e: MouseEvent) => {
      const hexId = this.pickFromEvent(e);
      if (hexId < 0) return;

      const worldHex = this.config.worldMap.hexes[hexId];
      if (!worldHex || !isHexOwnable(worldHex.biome)) return;

      const owner = this.playerState.getHexManager().getHexOwner(hexId);
      if (owner === this.config.localPlayerId) return;

      // Auto-select adjacent owned hexes as attack sources if none selected
      let sourceHexIds = [...this.selectedHexIds];
      if (sourceHexIds.length === 0) {
        sourceHexIds = worldHex.neighbors.filter(
          (nid) => this.playerState.getHexManager().getHexOwner(nid) === this.config.localPlayerId
        );
      }
      if (sourceHexIds.length === 0) return;

      this.config.session.send({
        type: 'attack_hex',
        hexId,
        fromHexIds: sourceHexIds,
      });
      this.flashHex(hexId);
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDoubleClick);

    // Right click: open radial menu on hex
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault(); // Suppress browser context menu
      const hexId = this.pickFromEvent(e);
      if (hexId < 0) return;

      const manager = this.playerState.getHexManager();
      const hexOwnership = manager.getHexOwnership(hexId);
      const worldHex = this.config.worldMap.hexes[hexId];

      const owner = hexOwnership?.ownerId ?? null;
      const building = manager.getHexBuilding(hexId);
      const isOwned = owner === this.config.localPlayerId;

      // Determine if target borders any friendly (owned by us) hex - needed for attack sources
      let bordersFriendly = false;
      if (worldHex) {
        for (const nbId of worldHex.neighbors) {
          const nb = manager.getHexOwnership(nbId);
          if (!nb) continue;
          if (nb.ownerId === this.config.localPlayerId) {
            bordersFriendly = true;
          }
        }
      }

      const context: import('./ui/radial-menu').RadialMenuContext = {
        hexId,
        owner,
        isOwned,
        isFrontline: bordersFriendly, // Can attack from adjacent friendly hex
        selectedHexIds: [...this.selectedHexIds],
        biome: worldHex?.biome ?? 0,
        soldiers: hexOwnership?.soldiers ?? 0,
        hasBuilding: !!building,
        buildingType: building?.type ?? undefined,
        canBuild: !building || building.type === 'ruin',
      };

      this.radialMenu?.show(e.clientX, e.clientY, context);
    };

    canvas.addEventListener('contextmenu', onContextMenu);

    this.cleanup.push(() => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
    });
  }

  /** Handle radial menu action selection */
  private handleRadialAction(result: { action: string; hexId: number; params?: any }): void {
    const { action, hexId, params } = result;

    switch (action) {
      case 'attack': {
        // If no hexes selected, auto-select adjacent owned hexes as attack sources
        let sourceHexIds = [...this.selectedHexIds];
        if (sourceHexIds.length === 0) {
          const targetHex = this.config.worldMap.hexes[hexId];
          if (targetHex) {
            const manager = this.playerState.getHexManager();
            sourceHexIds = targetHex.neighbors.filter(
              (nid) => manager.getHexOwner(nid) === this.config.localPlayerId
            );
          }
        }
        if (sourceHexIds.length === 0) return;
        this.config.session.send({
          type: 'attack_hex',
          hexId,
          fromHexIds: sourceHexIds,
        });
        this.flashHex(hexId);
        break;
      }

      case 'build':
        // Submenu handles this
        break;

      case 'build_city':
      case 'build_factory':
      case 'build_base':
      case 'build_capital': {
        const buildingType = params.buildingType as BuildingType;
        this.config.session.send({
          type: 'build_structure',
          hexId,
          buildingType,
        });
        break;
      }

      case 'demolish': {
        this.config.session.send({
          type: 'demolish_building',
          hexId,
        });
        break;
      }

      case 'upgrade': {
        // Upgrade city to capital
        this.config.session.send({
          type: 'build_structure',
          hexId,
          buildingType: 'capital',
        });
        break;
      }

      case 'ally':
      case 'trade':
      case 'transfer':
      case 'defend':
      case 'scout':
        // Future implementations
        console.log('[Game] Radial action not yet implemented:', action);
        break;

      case 'cancel':
        // Just close
        break;
    }
  }

  private pickFromEvent(e: MouseEvent): number {
    const { x, y } = eventToCanvasPoint(e, this.config.canvas);
    return pickHexAtScreen(
      this.config.globeRenderer.scene,
      this.config.camera,
      this.config.worldMap,
      x,
      y,
    );
  }

  private flashHex(hexId: number) {
    this.flashHexIds.add(hexId);
    this.forceOwnershipUpdate = true;

    const timeout = window.setTimeout(() => {
      this.flashHexIds.delete(hexId);
      this.forceOwnershipUpdate = true;
      this.flashTimeouts.delete(timeout);
    }, ATTACK_FLASH_DURATION_MS);
    this.flashTimeouts.add(timeout);
  }

  private handleDisconnect() {
    this.hexTooltip?.dispose();
    this.hexTooltip = null;
    this.hexSelector?.dispose();
    this.hexSelector = null;
    this.isInitialized = false;
  }

  /** Update ownership visuals on globe renderer (only when state changed). */
  updateGlobeOwnership() {
    const manager = this.playerState.getHexManager();
    const version = manager.getVersion();

    if (!this.forceOwnershipUpdate && version === this.lastOwnershipVersion) {
      return;
    }
    this.forceOwnershipUpdate = false;
    this.lastOwnershipVersion = version;

    const hexOwnership = manager.getAllHexOwnership();
    const economies = manager.getAllEconomies();
    const selected = new Set(this.selectedHexIds);

    const flashR = ((ATTACK_FLASH_COLOR >> 16) & 0xff) / 255;
    const flashG = ((ATTACK_FLASH_COLOR >> 8) & 0xff) / 255;
    const flashB = (ATTACK_FLASH_COLOR & 0xff) / 255;

    const colors = new Float32Array(hexOwnership.length * 3);
    for (let i = 0; i < hexOwnership.length; i++) {
      const owner = hexOwnership[i].ownerId;
      if (!owner) continue;

      const economy = economies.get(owner);
      const color = economy?.color ?? 0x00ffff;
      let r = ((color >> 16) & 0xff) / 255;
      let g = ((color >> 8) & 0xff) / 255;
      let b = (color & 0xff) / 255;

      if (this.flashHexIds.has(i)) {
        r = flashR;
        g = flashG;
        b = flashB;
      } else if (selected.has(i)) {
        // Brighten selected hexes so the current attack sources are obvious.
        r = r + (1 - r) * 0.55;
        g = g + (1 - g) * 0.55;
        b = b + (1 - b) * 0.55;
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    if (this.config.globeRenderer.updateOwnership) {
      this.config.globeRenderer.updateOwnership(colors, this.config.worldMap.hexes);
    }
  }

  /** Get player state for external access */
  getPlayerState(): PlayerState {
    return this.playerState;
  }

  /** Get currently selected hexes */
  getSelectedHexIds(): number[] {
    return [...this.selectedHexIds];
  }

  /** Cleanup everything */
  dispose() {
    this.cleanup.forEach(fn => fn());
    this.cleanup = [];

    for (const timeout of this.flashTimeouts) {
      window.clearTimeout(timeout);
    }
    this.flashTimeouts.clear();
    this.flashHexIds.clear();

    this.hexTooltip?.dispose();
    this.hexSelector?.dispose();
    this.config.session.dispose?.();
    this.playerState.dispose();
    this.isInitialized = false;
  }
}

/** Factory function for easy initialization */
export async function createGameModule(config: GameModuleConfig): Promise<GameModule> {
  const module = new GameModule(config);
  await module.initialize();
  return module;
}
