// Connection Manager
// Handles local-first connection with automatic fallback to remote (dev only)

import { RelayClient, type ConnectionState, type RelayClientEvents } from './relay-client';

export type ConnectionTarget = 'local' | 'remote' | 'manual';

export interface ConnectionManagerEvents extends RelayClientEvents {
  onTargetChange: (target: ConnectionTarget, url: string) => void;
  onFallbackAttempt: (fromTarget: ConnectionTarget, toTarget: ConnectionTarget) => void;
  onFallbackFailed: (originalTarget: ConnectionTarget) => void;
}

interface TargetConfig {
  target: ConnectionTarget;
  url: string;
  label: string;
}

export class ConnectionManager {
  private relayClient: RelayClient | null = null;
  private playerName: string;
  private events: Partial<ConnectionManagerEvents> = {};
  private targets: TargetConfig[] = [];
  private currentTargetIndex = 0;
  private isConnecting = false;

  constructor(playerName: string = 'Player') {
    this.playerName = playerName;
    this.buildTargets();
  }

  private buildTargets(): void {
    const isProd = import.meta.env.PROD;
    const manualUrl = localStorage.getItem('3d-front-server-url');

    // Manual override always takes priority
    if (manualUrl) {
      this.targets.push({
        target: 'manual',
        url: manualUrl,
        label: 'Manual Override'
      });
    }

    if (isProd) {
      // Production: only remote
      this.targets.push({
        target: 'remote',
        url: 'wss://threed-front-server.onrender.com',
        label: 'Production Server'
      });
    } else {
      // Development: local first, then remote fallback
      this.targets.push({
        target: 'local',
        url: 'ws://localhost:3000',
        label: 'Local Server'
      });
      this.targets.push({
        target: 'remote',
        url: 'wss://threed-front-server.onrender.com',
        label: 'Remote Server (Render)'
      });
    }
  }

  // Event handlers
  on<K extends keyof ConnectionManagerEvents>(event: K, handler: ConnectionManagerEvents[K]): void {
    (this.events as any)[event] = handler;
  }

  private emit<K extends keyof ConnectionManagerEvents>(event: K, ...args: any[]): void {
    const handler = (this.events as any)[event];
    if (handler) handler(...args);
  }

  // Get current target info
  getCurrentTarget(): TargetConfig | null {
    return this.targets[this.currentTargetIndex] || null;
  }

  getCurrentUrl(): string {
    return this.getCurrentTarget()?.url || '';
  }

  // Get the relay client instance (for direct access if needed)
  getRelayClient(): RelayClient | null {
    return this.relayClient;
  }

  // Connect with automatic fallback
  async connect(): Promise<void> {
    if (this.isConnecting) return;
    if (this.relayClient?.getState() === 'connected') return;

    this.isConnecting = true;
    this.currentTargetIndex = 0;

    await this.tryConnect();
    this.isConnecting = false;
  }

  private async tryConnect(): Promise<void> {
    const target = this.getCurrentTarget();
    if (!target) {
      this.emit('onError', 'No server targets configured');
      return;
    }

    console.log(`[ConnectionManager] Trying ${target.label}: ${target.url}`);
    this.emit('onTargetChange', target.target, target.url);

    // Create new relay client for this target
    this.relayClient = new RelayClient(target.url, this.playerName);
    this.setupRelayEvents();

    try {
      await this.relayClient.connect();
      console.log(`[ConnectionManager] Connected to ${target.label}`);
    } catch (err) {
      console.warn(`[ConnectionManager] Failed to connect to ${target.label}:`, err);
      await this.handleConnectionFailure(target.target);
    }
  }

  private setupRelayEvents(): void {
    if (!this.relayClient) return;

    // Forward all relay events
    this.relayClient.on('onStateChange', (state) => this.emit('onStateChange', state));
    this.relayClient.on('onLobbyCreated', (code, playerId, player) => this.emit('onLobbyCreated', code, playerId, player));
    this.relayClient.on('onLobbyJoined', (state, playerId, player) => this.emit('onLobbyJoined', state, playerId, player));
    this.relayClient.on('onLobbyUpdated', (settings) => this.emit('onLobbyUpdated', settings));
    this.relayClient.on('onLobbyPlayersUpdated', (players) => this.emit('onLobbyPlayersUpdated', players));
    this.relayClient.on('onLobbyError', (msg) => this.emit('onLobbyError', msg));
    this.relayClient.on('onPlayerJoined', (player) => this.emit('onPlayerJoined', player));
    this.relayClient.on('onPlayerLeft', (playerId) => this.emit('onPlayerLeft', playerId));
    this.relayClient.on('onPlayerReady', (playerId, ready) => this.emit('onPlayerReady', playerId, ready));
    this.relayClient.on('onHostChanged', (newHostId) => this.emit('onHostChanged', newHostId));
    this.relayClient.on('onGameStart', (snapshot, yourPlayerId) => this.emit('onGameStart', snapshot, yourPlayerId));
    this.relayClient.on('onSnapshot', (tick, entities) => this.emit('onSnapshot', tick, entities));
    this.relayClient.on('onChat', (playerId, playerName, message) => this.emit('onChat', playerId, playerName, message));
    this.relayClient.on('onError', (msg) => this.emit('onError', msg));
    this.relayClient.on('onKicked', (reason) => this.emit('onKicked', reason));
  }

  private async handleConnectionFailure(failedTarget: ConnectionTarget): Promise<void> {
    const isProd = import.meta.env.PROD;

    // In production, or if manual override failed, don't fallback
    if (isProd || failedTarget === 'manual') {
      this.emit('onFallbackFailed', failedTarget);
      this.emit('onError', `Failed to connect to ${failedTarget} server. Check your connection.`);
      return;
    }

    // In dev, try next target if available
    const nextIndex = this.currentTargetIndex + 1;
    if (nextIndex < this.targets.length) {
      const nextTarget = this.targets[nextIndex];
      this.emit('onFallbackAttempt', failedTarget, nextTarget.target);
      console.log(`[ConnectionManager] Falling back to ${nextTarget.label}...`);
      this.currentTargetIndex = nextIndex;
      await this.tryConnect();
    } else {
      this.emit('onFallbackFailed', failedTarget);
      this.emit('onError', 'All connection attempts failed. Open Settings to configure server URL.');
    }
  }

  // Force reconnection (e.g., after manual URL change)
  async reconnect(newUrl?: string): Promise<void> {
    if (newUrl) {
      // Manual URL change - rebuild targets with new manual override
      localStorage.setItem('3d-front-server-url', newUrl);
      this.targets = [];
      this.buildTargets();
    }

    this.disconnect();
    await this.connect();
  }

  // Disconnect and cleanup
  disconnect(): void {
    if (this.relayClient) {
      this.relayClient.disconnect();
      this.relayClient = null;
    }
    this.currentTargetIndex = 0;
  }

  // Delegate methods to relay client
  createLobby(settings: any, colorIndex: number = 0): void { this.relayClient?.createLobby(settings, colorIndex); }
  updateLobby(settings: any): void { this.relayClient?.updateLobby(settings); }
  joinLobby(code: string, colorIndex: number = 0): void { this.relayClient?.joinLobby(code, colorIndex); }
  leaveLobby(): void { this.relayClient?.leaveLobby(); }
  setReady(ready: boolean): void { this.relayClient?.setReady(ready); }
  startGame(): void { this.relayClient?.startGame(); }
  sendCommands(tick: number, commands: any[]): void { this.relayClient?.sendCommands(tick, commands); }
  sendChat(message: string): void { this.relayClient?.sendChat(message); }
  ping(): void { this.relayClient?.ping(); }
  getPlayerId(): string { return this.relayClient?.getPlayerId() || ''; }
  setPlayerName(name: string): void {
    this.playerName = name;
    this.relayClient?.setPlayerName(name);
  }
  getState(): ConnectionState { return this.relayClient?.getState() || 'disconnected'; }
}