export interface LobbySettings {
    maxPlayers: number;
    public: boolean;
    map: string;
}
export interface Player {
    id: string;
    name: string;
    ready: boolean;
    color: number;
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
export interface Vec3 {
    x: number;
    y: number;
    z: number;
}
export interface Command {
    type: 'move' | 'attack' | 'build' | 'patrol' | 'stop';
    unitIds: string[];
    target?: Vec3;
    targetId?: string;
    buildType?: string;
    queue?: boolean;
}
export interface Entity {
    id: string;
    type: 'unit' | 'building' | 'projectile' | 'resource';
    owner: string;
    position: Vec3;
    velocity?: Vec3;
    rotation?: Vec3;
    health: number;
    maxHealth: number;
    unitType?: string;
    targetId?: string;
    buildProgress?: number;
    projectileType?: string;
    damage?: number;
    expireAt?: number;
}
export interface Snapshot {
    tick: number;
    timestamp: number;
    entities: Entity[];
}
export type ClientMessage = {
    type: 'create_lobby';
    settings: LobbySettings;
} | {
    type: 'join_lobby';
    code: string;
    name: string;
} | {
    type: 'leave_lobby';
} | {
    type: 'player_ready';
    ready: boolean;
} | {
    type: 'start_game';
} | {
    type: 'command';
    tick: number;
    commands: Command[];
} | {
    type: 'ping';
    time: number;
} | {
    type: 'chat';
    message: string;
};
export type ServerMessage = {
    type: 'lobby_created';
    code: string;
    playerId: string;
    player: Player;
} | {
    type: 'lobby_joined';
    state: LobbyState;
    playerId: string;
    player: Player;
} | {
    type: 'lobby_error';
    message: string;
} | {
    type: 'player_joined';
    player: Player;
} | {
    type: 'player_left';
    playerId: string;
} | {
    type: 'player_ready';
    playerId: string;
    ready: boolean;
} | {
    type: 'host_changed';
    newHostId: string;
} | {
    type: 'game_start';
    initialSnapshot: Snapshot;
    yourPlayerId: string;
} | {
    type: 'snapshot';
    tick: number;
    entities: Entity[];
} | {
    type: 'pong';
    time: number;
} | {
    type: 'chat';
    playerId: string;
    playerName: string;
    message: string;
} | {
    type: 'error';
    message: string;
} | {
    type: 'kicked';
    reason: string;
};
export declare function generateLobbyCode(): string;
export declare function generatePlayerId(): string;
export declare function generateEntityId(): string;
//# sourceMappingURL=protocol.d.ts.map