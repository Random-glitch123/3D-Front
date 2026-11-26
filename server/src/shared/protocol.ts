// Shared protocol types for client-server communication
// Used by both client (browser) and server (Node.js)

// ===== Lobby =====

export interface LobbySettings {
  maxPlayers: number;
  public: boolean;
  map: string; // e.g., "earth", "mars"
  // Future: game mode, win conditions, etc.
}

export interface Player {
  id: string;
  name: string;
  ready: boolean;
  color: number; // Hex color for units
  isHost: boolean;
}

export interface LobbyState {
  code: string;
  hostId: string;
  players: Player[];
  settings: LobbySettings;
  state: 'lobby' | 'playing' | 'finished';
  createdAt: number;
}

// ===== Game Commands =====

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Command {
  type: 'move' | 'attack' | 'build' | 'patrol' | 'stop';
  unitIds: string[];     // Selected units
  target?: Vec3;         // World position (for move/patrol)
  targetId?: string;     // Target entity (for attack)
  buildType?: string;    // For build command
  queue?: boolean;       // Shift-click queue
}

// ===== World State =====

export interface Entity {
  id: string;
  type: 'unit' | 'building' | 'projectile' | 'resource';
  owner: string;         // Player ID
  position: Vec3;
  velocity?: Vec3;
  rotation?: Vec3;
  health: number;
  maxHealth: number;
  // Unit-specific
  unitType?: string;
  targetId?: string;
  // Building-specific
  buildProgress?: number;
  // Projectile-specific
  projectileType?: string;
  damage?: number;
  expireAt?: number;     // Timestamp
}

export interface Snapshot {
  tick: number;
  timestamp: number;     // Server time (ms)
  entities: Entity[];
  // Future: events, resource counts, etc.
}

// ===== Network Messages =====

// Client → Server
export type ClientMessage =
  | { type: 'create_lobby'; settings: LobbySettings; name: string }
  | { type: 'update_lobby'; settings: Partial<LobbySettings> }
  | { type: 'join_lobby'; code: string; name: string }
  | { type: 'leave_lobby' }
  | { type: 'player_ready'; ready: boolean }
  | { type: 'start_game' }
  | { type: 'command'; tick: number; commands: Command[] }
  | { type: 'ping'; time: number }
  | { type: 'chat'; message: string };

// Server → Client
export type ServerMessage =
  | { type: 'lobby_created'; code: string; playerId: string; player: Player }
  | { type: 'lobby_joined'; state: LobbyState; playerId: string; player: Player }
  | { type: 'lobby_updated'; settings: LobbySettings }
  | { type: 'lobby_players_updated'; players: Player[] }
  | { type: 'lobby_error'; message: string }
  | { type: 'player_joined'; player: Player }
  | { type: 'player_left'; playerId: string }
  | { type: 'player_ready'; playerId: string; ready: boolean }
  | { type: 'host_changed'; newHostId: string }
  | { type: 'game_start'; initialSnapshot: Snapshot; yourPlayerId: string }
  | { type: 'snapshot'; tick: number; entities: Entity[] }
  | { type: 'pong'; time: number }
  | { type: 'chat'; playerId: string; playerName: string; message: string }
  | { type: 'error'; message: string }
  | { type: 'kicked'; reason: string };

// ===== Utility =====

export function generateLobbyCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function generatePlayerId(): string {
  return 'player_' + Math.random().toString(36).substring(2, 10);
}

export function generateEntityId(): string {
  return 'entity_' + Math.random().toString(36).substring(2, 12);
}