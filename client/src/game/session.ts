// Minimal game-session abstraction.
//
// GameModule only needs `on`, `send` and `getPlayerId`. Both RelayClient
// (multiplayer) and LocalGameClient (singleplayer) satisfy this shape, so the
// same gameplay/UI code runs in both modes.

import type { ClientMessage } from '../shared/protocol';
import type { RelayClientEvents } from '../net/relay-client';

export type GameSessionClient = {
  on<K extends keyof RelayClientEvents>(event: K, handler: RelayClientEvents[K]): void;
  send(message: ClientMessage): void;
  getPlayerId(): string;
  dispose?(): void;
};
