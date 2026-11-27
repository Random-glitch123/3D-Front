// Lobby Manager for the relay server
// Handles 4-letter codes, player management, host election

import { LobbyState, LobbySettings, Player, generateLobbyCode, generatePlayerId, PLAYER_COLORS } from './shared/protocol';

export interface ConnectedClient {
  id: string;
  ws: any; // WebSocket
  name: string;
  lobbyCode?: string;
  ready: boolean;
}

export class LobbyManager {
  private lobbies = new Map<string, LobbyState>();
  private clients = new Map<string, ConnectedClient>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup empty lobbies every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  // Update client's display name
  setClientName(clientId: string, name: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) return false;
    client.name = name;
    return true;
  }

  // Create a new lobby
  createLobby(clientId: string, settings: LobbySettings, colorIndex: number = 0): LobbyState {
    let code: string;
    let attempts = 0;
    do {
      code = generateLobbyCode();
      attempts++;
    } while (this.lobbies.has(code) && attempts < 100);

    if (attempts >= 100) {
      throw new Error('Failed to generate unique lobby code');
    }

    const client = this.clients.get(clientId);
    if (!client) throw new Error('Client not found');

    // Clamp color index to valid range
    const safeColorIndex = Math.max(0, Math.min(colorIndex, PLAYER_COLORS.length - 1));
    
    const player: Player = {
      id: clientId,
      name: client.name,
      ready: true, // Host is auto-ready
      color: PLAYER_COLORS[safeColorIndex] ?? 0x00ffff,
      colorIndex: safeColorIndex,
      isHost: true
    };

    const lobby: LobbyState = {
      code,
      hostId: clientId,
      players: [player],
      settings,
      state: 'lobby',
      createdAt: Date.now()
    };

    this.lobbies.set(code, lobby);
    client.lobbyCode = code;
    client.ready = true;

    console.log(`[Lobby] Created lobby ${code} by ${client.name} (${clientId})`);
    return lobby;
  }

  // Update lobby settings (host only)
  updateLobby(clientId: string, settings: Partial<LobbySettings>): LobbyState | null {
    const client = this.clients.get(clientId);
    if (!client || !client.lobbyCode) return null;

    const lobby = this.lobbies.get(client.lobbyCode);
    if (!lobby) return null;
    if (lobby.hostId !== clientId) return null;
    if (lobby.state !== 'lobby') return null;

    lobby.settings = { ...lobby.settings, ...settings };
    console.log(`[Lobby] Updated lobby ${lobby.code} settings:`, settings);
    return lobby;
  }

  // Join existing lobby
  joinLobby(clientId: string, code: string, colorIndex: number = 0): LobbyState | null {
    const lobby = this.lobbies.get(code.toUpperCase());
    if (!lobby) return null;
    if (lobby.state !== 'lobby') return null;
    if (lobby.players.length >= lobby.settings.maxPlayers) return null;

    const client = this.clients.get(clientId);
    if (!client) return null;

    // Check if already in lobby
    if (lobby.players.some((p: Player) => p.id === clientId)) return lobby;

    // Check if color is already taken
    const takenColors = new Set(lobby.players.map(p => p.colorIndex));
    let safeColorIndex = Math.max(0, Math.min(colorIndex, PLAYER_COLORS.length - 1));
    while (takenColors.has(safeColorIndex)) {
      safeColorIndex = (safeColorIndex + 1) % PLAYER_COLORS.length;
    }
    
    const player: Player = {
      id: clientId,
      name: client.name,
      ready: false,
      color: PLAYER_COLORS[safeColorIndex] ?? 0x00ffff,
      colorIndex: safeColorIndex,
      isHost: false
    };

    lobby.players.push(player);
    client.lobbyCode = code;
    client.ready = false;

    console.log(`[Lobby] ${client.name} (${clientId}) joined lobby ${code}`);
    return lobby;
  }

  // Leave lobby
  leaveLobby(clientId: string): LobbyState | null {
    const client = this.clients.get(clientId);
    if (!client || !client.lobbyCode) return null;

    const lobby = this.lobbies.get(client.lobbyCode);
    if (!lobby) return null;

    const playerIndex = lobby.players.findIndex((p: Player) => p.id === clientId);
    if (playerIndex === -1) return null;

    const wasHost = lobby.hostId === clientId;
    lobby.players.splice(playerIndex, 1);
    client.lobbyCode = undefined;
    client.ready = false;

    console.log(`[Lobby] ${client.name} (${clientId}) left lobby ${lobby.code}`);

    // If host left, elect new host
    if (wasHost && lobby.players.length > 0) {
      const newHost = lobby.players[0]!;
      lobby.hostId = newHost.id;
      newHost.isHost = true;
      console.log(`[Lobby] New host for ${lobby.code}: ${newHost.name} (${lobby.hostId})`);
    }

    return lobby;
  }

  // Set player ready state
  setReady(clientId: string, ready: boolean): LobbyState | null {
    const client = this.clients.get(clientId);
    if (!client || !client.lobbyCode) return null;

    const lobby = this.lobbies.get(client.lobbyCode);
    if (!lobby) return null;

    const player = lobby.players.find((p: Player) => p.id === clientId);
    if (player) {
      player.ready = ready;
      client.ready = ready;
    }

    return lobby;
  }

  // Start game (host only)
  startGame(clientId: string): LobbyState | null {
    const client = this.clients.get(clientId);
    if (!client || !client.lobbyCode) return null;

    const lobby = this.lobbies.get(client.lobbyCode);
    if (!lobby) return null;
    if (lobby.hostId !== clientId) return null;
    if (lobby.state !== 'lobby') return null;

    lobby.state = 'playing';
    console.log(`[Lobby] Game started in ${lobby.code}`);
    return lobby;
  }

  // Get lobby by code
  getLobby(code: string): LobbyState | undefined {
    return this.lobbies.get(code.toUpperCase());
  }

  // Get lobby for client
  getClientLobby(clientId: string): LobbyState | undefined {
    const client = this.clients.get(clientId);
    if (!client || !client.lobbyCode) return undefined;
    return this.lobbies.get(client.lobbyCode);
  }

  // Register client
  addClient(clientId: string, ws: any, name: string): ConnectedClient {
    const client: ConnectedClient = {
      id: clientId,
      ws,
      name,
      ready: false
    };
    this.clients.set(clientId, client);
    return client;
  }

  // Remove client
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client?.lobbyCode) {
      this.leaveLobby(clientId);
    }
    this.clients.delete(clientId);
  }

  // Get client
  getClient(clientId: string): ConnectedClient | undefined {
    return this.clients.get(clientId);
  }

  // Get all clients in lobby
  getLobbyClients(lobbyCode: string): ConnectedClient[] {
    const lobby = this.lobbies.get(lobbyCode);
    if (!lobby) return [];
    return lobby.players
      .map((p: Player) => this.clients.get(p.id))
      .filter((c): c is ConnectedClient => c !== undefined);
  }

  // Check if client is host of their lobby
  isHost(clientId: string): boolean {
    const client = this.clients.get(clientId);
    if (!client || !client.lobbyCode) return false;
    const lobby = this.lobbies.get(client.lobbyCode);
    return lobby?.hostId === clientId;
  }

  

  // Cleanup empty/old lobbies
  private cleanup(): void {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    for (const [code, lobby] of this.lobbies) {
      if (lobby.players.length === 0 || now - lobby.createdAt > maxAge) {
        this.lobbies.delete(code);
        console.log(`[Lobby] Cleaned up lobby ${code}`);
      }
    }
  }

  // Shutdown
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.lobbies.clear();
    this.clients.clear();
  }

  // Stats
  getStats(): { lobbies: number; players: number; clients: number } {
    let players = 0;
    for (const lobby of this.lobbies.values()) {
      players += lobby.players.length;
    }
    return {
      lobbies: this.lobbies.size,
      players,
      clients: this.clients.size
    };
  }
}