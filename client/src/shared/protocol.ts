// Shared protocol types for client-server communication
// Used by both client (browser) and server (Node.js)

// ===== World Map Data =====

export interface WorldMapData {
  meta: {
    name: string;
    subdivisions: number;
    radius: number;
    hexCount: number;
    cornerCount: number;
    triangleCount: number;
    biomeColors: Record<string, [number, number, number]>;
  };
  corners: number[];
  cornerHeights: number[];
  hexes: Array<{
    id: number;
    center: [number, number, number];
    corners: number[];
    neighbors: number[];
    biome: number;
    elevation: number;
    height: number;
  }>;
}

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
  colorIndex: number; // Index into PLAYER_COLORS (0-14)
  isHost: boolean;
}

export interface LobbyState {
  code: string;
  hostId: string;
  players: Player[];
  settings: LobbySettings;
  state: 'lobby' | 'playing' | 'finished';
  createdAt: number;
  // Game state (when state === 'playing')
  gameState?: GameState;
}

// ===== Economy & Game State =====

// 15 distinct player colors for lobby selection
export const PLAYER_COLORS: number[] = [
  0xFF4444, 0x44FF44, 0x4444FF, 0xFFFF44, 0xFF44FF, 0x44FFFF,
  0xFF8844, 0x88FF44, 0x4488FF, 0xFF4488, 0x8844FF, 0x44FFAA,
  0xAA44FF, 0xFFAA44, 0xAAFF44
];

// Biome multipliers (shared but not exposed to UI directly - players discover through play)
export const BIOME_MULTIPLIERS: Record<number, number> = {
  2: 1.2,  // Grassland (Plains)
  3: 1.2,  // Forest
  5: 1.0,  // Tundra
  4: 0.7,  // Desert
  8: 0.7,  // Ice
  7: 1.0,  // Rock (Mountain)
  6: 1.0,  // Snow
  1: 1.0,  // Beach
  0: 0,    // Ocean (unownable)
};

// Base economy constants
export const BASE_SOLDIERS_PER_HEX = 10;
export const MAX_SOLDIERS_PER_HEX = 500;
export const SOLDIERS_PER_SECOND_PER_HEX = 50;
export const OWNERSHIP_TINT_OPACITY = 0.45;

// Visual constants
export const ATTACK_FLASH_DURATION_MS = 200;
export const ATTACK_FLASH_COLOR = 0xFF1111; // Deep neon red
export const TERRITORY_BORDER_WIDTH = 2; // Thick black border between territories (px)

// Dynamic territory (emerges from ownership)
export interface TerritoryBorder {
  enemyId: string;
  borderHexIds: number[];        // Our hexes on this border
  enemyBorderHexIds: number[];   // Enemy hexes on this border
  length: number;                // Number of border hexes
}

export interface Territory {
  ownerId: string;
  hexIds: number[];              // All hexes owned by this player
  borderHexIds: number[];        // Owned hexes adjacent to neutral
  frontlineHexIds: number[];     // Owned hexes directly bordering enemy
  interiorHexIds: number[];      // Owned hexes fully surrounded by own territory
  neighboringTerritories: Map<string, TerritoryBorder>; // Enemy territories we border
}

// Hex ownership
export interface HexOwnership {
  hexId: number;
  ownerId: string | null;  // null = unowned
  soldiers: number;        // Soldiers stationed on this hex
  building?: Building;     // Building on this hex (if any)
}

// Player economy
export interface PlayerEconomy {
  playerId: string;
  ownedHexCount: number;
  totalSoldiers: number;
  incomePerSecond: number;   // Passive generation per second
  lastUpdate: number;        // Server timestamp of last update
  color: number;             // Player color (from PLAYER_COLORS)
  colorIndex: number;        // Color index for rendering
  // Population system
  population: number;        // Current population (from cities)
  maxPopulation: number;     // Max population cap (cities + capital multiplier)
  gold: number;              // Gold currency (from factories)
  soldierAllocationRatio: number; // 0-1: % of population assigned to soldiers (default 0.2)
  attackAllocationRatio: number;  // 0-1: % of soldiers committed to attacks (default 0.5)
}

// Game state (server authoritative)
export interface GameState {
  hexOwnership: HexOwnership[];           // Length = total hexes (~10k)
  playerEconomies: Map<string, PlayerEconomy>;
  territories: Map<string, Territory>;    // Dynamic territories per player
  selectedHexes: Map<string, number[]>;   // PlayerId -> selected hexIds (for shift-multi-select)
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

// Radial menu actions
export type RadialMenuAction = 
  | 'attack'        // Attack/capture hex
  | 'defend'        // Station soldiers
  | 'scout'         // Reveal nearby
  | 'build'         // Build structure (opens build submenu)
  | 'ally'          // Propose alliance (dynamic, territory-based)
  | 'trade'         // Propose trade (dynamic, territory-based)
  | 'transfer'      // Move soldiers between hexes
  | 'cancel';

// Building types
export type BuildingType = 'city' | 'factory' | 'base' | 'capital' | 'ruin';

export interface Building {
  type: BuildingType;
  level: number;          // Current upgrade level
  progress: number;       // Construction progress (0 to maxProgress)
  maxProgress: number;    // Ticks required to complete
  ownerId: string;        // Player who is building / owns it
  startedAt: number;      // Timestamp construction began
}

// Radial build submenu types
export type BuildAction = 'build_city' | 'build_factory' | 'build_base' | 'build_capital' | 'demolish' | 'upgrade';

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
  | { type: 'create_lobby'; settings: LobbySettings; name: string; colorIndex?: number }
  | { type: 'join_lobby'; code: string; name: string; colorIndex?: number }
  | { type: 'leave_lobby' }
  | { type: 'player_ready'; ready: boolean }
  | { type: 'start_game' }
  | { type: 'command'; tick: number; commands: Command[] }
  | { type: 'ping'; time: number }
  | { type: 'chat'; message: string }
  | { type: 'select_start_hex'; hexId: number }
  | { type: 'select_hex'; hexId: number; shiftKey: boolean }
  | { type: 'deselect_hex'; hexId: number }
  | { type: 'attack_hex'; hexId: number; fromHexIds: number[] }
  | { type: 'radial_menu_action'; action: RadialMenuAction; hexId: number; params?: any }
  | { type: 'move_soldiers'; fromHex: number; toHex: number; amount: number }
  | { type: 'build_structure'; hexId: number; buildingType: BuildingType }
  | { type: 'demolish_building'; hexId: number }
  | { type: 'set_soldier_allocation'; ratio: number }
  | { type: 'set_attack_allocation'; ratio: number }
  | { type: 'update_lobby'; settings: Partial<LobbySettings> };

// Server → Client
export type ServerMessage =
  | { type: 'lobby_created'; code: string; playerId: string; player: Player }
  | { type: 'lobby_joined'; state: LobbyState; playerId: string; player: Player }
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
  | { type: 'kicked'; reason: string }
  | { type: 'game_state_sync'; state: GameState }
  | { type: 'economy_update'; economy: PlayerEconomy }
  | { type: 'hex_captured'; hexId: number; newOwner: string; soldiers: number }
  | { type: 'start_hex_confirmed'; hexId: number }
  | { type: 'lobby_updated'; settings: LobbySettings }
  | { type: 'lobby_players_updated'; players: Player[] }
  | { type: 'start_hex_countdown'; secondsRemaining: number }
  | { type: 'hex_selected'; hexId: number; playerId: string; isMultiSelect: boolean }
  | { type: 'hex_deselected'; hexId: number; playerId: string }
  | { type: 'attack_result'; success: boolean; hexId: number; attackerId: string; defenderId?: string; casualties: number }
  | { type: 'pathfinding_result'; path: number[]; accessible: boolean }
  | { type: 'territory_updated'; territory: Territory }
  | { type: 'building_started'; hexId: number; buildingType: BuildingType; playerId: string }
  | { type: 'building_completed'; hexId: number; buildingType: BuildingType; playerId: string }
  | { type: 'building_demolished'; hexId: number; playerId: string }
  | { type: 'capital_destroyed'; hexId: number; formerOwnerId: string; capturedBy: string | null }
  | { type: 'economy_update'; economy: PlayerEconomy };

// ===== Utility =====

export function isHexOwnable(biome: number): boolean {
  return biome >= 2; // Grassland and above are land
}

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