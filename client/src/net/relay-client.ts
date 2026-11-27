// WebSocket Relay Client for multiplayer
// Connects to Render server, handles lobby codes, reconnection

import type { ClientMessage, ServerMessage, LobbyState, Player, LobbySettings, PlayerEconomy, GameState, Territory, BuildingType } from '../shared/protocol';
import { generatePlayerId } from '../shared/protocol';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface RelayClientEvents {
  onStateChange: (state: ConnectionState) => void;
  onLobbyCreated: (code: string, playerId: string, player: Player) => void;
  onLobbyJoined: (state: LobbyState, playerId: string, player: Player) => void;
  onLobbyUpdated: (settings: LobbySettings) => void;
  onLobbyPlayersUpdated: (players: Player[]) => void;
  onLobbyError: (message: string) => void;
  onPlayerJoined: (player: Player) => void;
  onPlayerLeft: (playerId: string) => void;
  onPlayerReady: (playerId: string, ready: boolean) => void;
  onHostChanged: (newHostId: string) => void;
  onGameStart: (snapshot: any, yourPlayerId: string) => void;
  onSnapshot: (tick: number, entities: any[]) => void;
  onChat: (playerId: string, playerName: string, message: string) => void;
  onError: (message: string) => void;
  onKicked: (reason: string) => void;
  // Game state events
  onGameStateSync: (state: GameState) => void;
  onEconomyUpdate: (economy: PlayerEconomy) => void;
  onHexCaptured: (data: { hexId: number; newOwner: string; soldiers: number }) => void;
  onStartHexConfirmed: (data: { hexId: number }) => void;
  onStartHexCountdown: (data: { secondsRemaining: number }) => void;
  onHexSelected: (data: { hexId: number; playerId: string; isMultiSelect: boolean }) => void;
  onHexDeselected: (data: { hexId: number; playerId: string }) => void;
  onAttackResult: (data: { success: boolean; hexId: number; attackerId: string; defenderId?: string; casualties: number }) => void;
  onTerritoryUpdated: (data: { territory: Territory }) => void;
  onPathfindingResult: (data: { path: number[]; accessible: boolean }) => void;
  onBuildingStarted: (data: { hexId: number; buildingType: BuildingType; playerId: string }) => void;
  onBuildingCompleted: (data: { hexId: number; buildingType: BuildingType; playerId: string }) => void;
  onBuildingDemolished: (data: { hexId: number; playerId: string }) => void;
  onCapitalDestroyed: (data: { hexId: number; formerOwnerId: string; capturedBy: string | null }) => void;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private url: string;
  private playerId: string;
  private playerName: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private pendingMessages: ClientMessage[] = [];
  private state: ConnectionState = 'disconnected';
  private events: Partial<RelayClientEvents> = {};

  constructor(url: string, playerName: string = 'Player') {
    this.url = url.replace(/^http/, 'ws'); // http:// → ws://, https:// → wss://
    this.playerName = playerName;
    this.playerId = generatePlayerId();
  }

  // Event handlers
  on<K extends keyof RelayClientEvents>(event: K, handler: RelayClientEvents[K]): void {
    (this.events as any)[event] = handler;
  }

  private emit<K extends keyof RelayClientEvents>(event: K, ...args: any[]): void {
    const handler = (this.events as any)[event];
    if (handler) handler(...args);
  }

  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('onStateChange', newState);
    }
  }

  // Connect to server
  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.setState('connecting');

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('[RelayClient] Connected to', this.url);
          this.reconnectAttempts = 0;
          this.setState('connected');
          this.flushPendingMessages();
          resolve();
        };

        this.ws.onmessage = (event) => this.handleMessage(event.data);

        this.ws.onclose = (event) => {
          console.log('[RelayClient] Disconnected:', event.code, event.reason);
          this.setState('disconnected');
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[RelayClient] Error:', error);
          this.setState('error');
          if (this.state === 'connecting') reject(new Error('Connection failed'));
        };
      } catch (err) {
        this.setState('error');
        reject(err);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[RelayClient] Max reconnect attempts reached');
      this.emit('onError', 'Connection lost. Please refresh the page.');
      return;
    }

    this.setState('reconnecting');
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(`[RelayClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => this.connect().catch(() => {}), delay);
  }

  private flushPendingMessages(): void {
    while (this.pendingMessages.length > 0) {
      const msg = this.pendingMessages.shift()!;
      this.send(msg);
    }
  }

  // Send message (queues if not connected)
  send(message: ClientMessage): void {
    const data = this.encode(message);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.pendingMessages.push(message);
    }
  }

  // Message encoding (msgpackr)
  private encode(msg: ClientMessage): ArrayBuffer {
    // Simple JSON for now — replace with msgpackr later
    return new TextEncoder().encode(JSON.stringify(msg)).buffer;
  }

  private decode(data: ArrayBuffer | string): ServerMessage {
    // Handle both binary (ArrayBuffer) and text (string) messages
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
    return JSON.parse(text);
  }

  private handleMessage(data: ArrayBuffer | string): void {
    try {
      const msg = this.decode(data);
      this.processMessage(msg);
    } catch (err) {
      console.error('[RelayClient] Failed to parse message:', err);
    }
  }

  private processMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'lobby_created':
        this.emit('onLobbyCreated', msg.code, msg.playerId, msg.player);
        break;
      case 'lobby_joined':
        this.emit('onLobbyJoined', msg.state, msg.playerId, msg.player);
        break;
      case 'lobby_updated':
        this.emit('onLobbyUpdated', msg.settings);
        break;
      case 'lobby_players_updated':
        this.emit('onLobbyPlayersUpdated', msg.players);
        break;
      case 'lobby_error':
        this.emit('onLobbyError', msg.message);
        break;
      case 'player_joined':
        this.emit('onPlayerJoined', msg.player);
        break;
      case 'player_left':
        this.emit('onPlayerLeft', msg.playerId);
        break;
      case 'player_ready':
        this.emit('onPlayerReady', msg.playerId, msg.ready);
        break;
      case 'host_changed':
        this.emit('onHostChanged', msg.newHostId);
        break;
      case 'game_start':
        this.emit('onGameStart', msg.initialSnapshot, msg.yourPlayerId);
        break;
      case 'snapshot':
        this.emit('onSnapshot', msg.tick, msg.entities);
        break;
      case 'chat':
        this.emit('onChat', msg.playerId, msg.playerName, msg.message);
        break;
      case 'error':
        this.emit('onError', msg.message);
        break;
      case 'kicked':
        this.emit('onKicked', msg.reason);
        break;
      case 'pong':
        // Handle ping/pong for latency measurement
        break;
      case 'game_state_sync':
        this.emit('onGameStateSync', msg.state);
        break;
      case 'economy_update':
        this.emit('onEconomyUpdate', msg.economy);
        break;
      case 'hex_captured':
        this.emit('onHexCaptured', { hexId: msg.hexId, newOwner: msg.newOwner, soldiers: msg.soldiers });
        break;
      case 'start_hex_confirmed':
        this.emit('onStartHexConfirmed', { hexId: msg.hexId });
        break;
      case 'start_hex_countdown':
        this.emit('onStartHexCountdown', { secondsRemaining: msg.secondsRemaining });
        break;
      case 'hex_selected':
        this.emit('onHexSelected', { hexId: msg.hexId, playerId: msg.playerId, isMultiSelect: msg.isMultiSelect });
        break;
      case 'hex_deselected':
        this.emit('onHexDeselected', { hexId: msg.hexId, playerId: msg.playerId });
        break;
      case 'attack_result':
        this.emit('onAttackResult', {
          success: msg.success,
          hexId: msg.hexId,
          attackerId: msg.attackerId,
          defenderId: msg.defenderId,
          casualties: msg.casualties,
        });
        break;
      case 'territory_updated':
        this.emit('onTerritoryUpdated', { territory: msg.territory });
        break;
      case 'building_started':
        this.emit('onBuildingStarted', { hexId: msg.hexId, buildingType: msg.buildingType, playerId: msg.playerId });
        break;
      case 'building_completed':
        this.emit('onBuildingCompleted', { hexId: msg.hexId, buildingType: msg.buildingType, playerId: msg.playerId });
        break;
      case 'building_demolished':
        this.emit('onBuildingDemolished', { hexId: msg.hexId, playerId: msg.playerId });
        break;
      case 'capital_destroyed':
        this.emit('onCapitalDestroyed', { hexId: msg.hexId, formerOwnerId: msg.formerOwnerId, capturedBy: msg.capturedBy });
        break;
      case 'pathfinding_result':
        this.emit('onPathfindingResult', { path: msg.path, accessible: msg.accessible });
        break;
    }
  }

  // Convenience methods
  createLobby(settings: any, colorIndex: number = 0): void {
    this.send({ type: 'create_lobby', settings, name: this.playerName, colorIndex });
  }

  updateLobby(settings: Partial<LobbySettings>): void {
    this.send({ type: 'update_lobby', settings });
  }

  joinLobby(code: string, colorIndex: number = 0): void {
    this.send({ type: 'join_lobby', code, name: this.playerName, colorIndex });
  }

  leaveLobby(): void {
    this.send({ type: 'leave_lobby' });
  }

  setReady(ready: boolean): void {
    this.send({ type: 'player_ready', ready });
  }

  startGame(): void {
    this.send({ type: 'start_game' });
  }

  sendCommands(tick: number, commands: any[]): void {
    this.send({ type: 'command', tick, commands });
  }

  sendChat(message: string): void {
    this.send({ type: 'chat', message });
  }

  ping(): void {
    this.send({ type: 'ping', time: Date.now() });
  }

  disconnect(): void {
    this.maxReconnectAttempts = 0; // Prevent reconnect
    this.ws?.close(1000, 'Client disconnect');
    this.ws = null;
    this.setState('disconnected');
  }

  getState(): ConnectionState {
    return this.state;
  }

  getPlayerId(): string {
    return this.playerId;
  }

  setPlayerName(name: string): void {
    this.playerName = name;
  }
}

// Simple latency tracker
export class LatencyTracker {
  private samples: number[] = [];
  private maxSamples = 20;
  private lastPingTime = 0;
  private pendingPing = false;

  startPing(): number {
    this.lastPingTime = performance.now();
    this.pendingPing = true;
    return this.lastPingTime;
  }

  endPing(): number | null {
    if (!this.pendingPing) return null;
    const rtt = performance.now() - this.lastPingTime;
    this.pendingPing = false;
    this.samples.push(rtt);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    return rtt;
  }

  getAverageRTT(): number {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  getJitter(): number {
    if (this.samples.length < 2) return 0;
    const avg = this.getAverageRTT();
    const variance = this.samples.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / this.samples.length;
    return Math.sqrt(variance);
  }
}