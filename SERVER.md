# 3D-Front Server Documentation

## Overview

**3D-Front Server** is a **Node.js** WebSocket relay server for multiplayer lobby management and game state synchronization. Built with **Express** (HTTP/health endpoints) and **ws** (WebSocket), written in **TypeScript** (CommonJS output).

- **Runtime**: Node.js 18+ (uses `fetch`, `WebSocket` globals)
- **Protocol**: JSON over WebSocket (msgpackr ready)
- **Architecture**: Single-process, in-memory state, no database
- **Deployment**: Render.com (or any Node.js host)

---

## Project Structure

```
server/
├── package.json              # Dependencies & scripts
├── tsconfig.json             # TypeScript config (CommonJS)
├── src/
│   ├── index.ts              # Entry point: Express + WS server
│   ├── lobby.ts              # LobbyManager: codes, players, host election
│   ├── broadcast.ts          # Broadcaster: message routing
│   └── shared/
│       └── protocol.ts       # Shared types (identical to client)
├── dist/                     # Compiled output (gitignored)
│   ├── index.js
│   ├── lobby.js
│   ├── broadcast.js
│   └── shared/protocol.js
└── node_modules/
```

---

## Entry Point: `src/index.ts`

### Server Initialization (Lines 1-50)

```typescript
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
```

**Middleware Stack:**
1. **CORS** (lines 15-21) - Allows all origins (`*`), methods (GET/POST/OPTIONS), headers (Content-Type)
2. **Health endpoints** (lines 23-42):
   - `GET /health` - Returns `"ok"`, `Cache-Control: no-store`
   - `GET /stats` - Returns `LobbyManager.getStats()` JSON
   - `GET /warm` - Keep-alive: `{ ok, uptime, memory }`
3. **JSON body parser** (line 45) - `express.json()`

**Managers** (lines 48-49):
```typescript
const lobbyManager = new LobbyManager();
const broadcaster = new Broadcaster(lobbyManager);
```

### WebSocket Connection Handler (Lines 59-95)

```typescript
wss.on('connection', (ws, req) => {
  const clientId = generateClientId();        // 'client_' + random
  const ip = req.socket.remoteAddress;
  
  // Register client
  const client = lobbyManager.addClient(clientId, ws, `Player_${clientId.slice(-4)}`);
  clients.set(ws, clientId);
  
  // Message handling
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as ClientMessage;
    handleClientMessage(clientId, msg, lobbyManager, broadcaster);
  });
  
  // Disconnect cleanup
  ws.on('close', (code, reason) => {
    const lobby = lobbyManager.leaveLobby(clientId);
    if (lobby) {
      broadcaster.notifyPlayerLeft(lobby, clientId);
      if (lobby.hostId !== clientId && lobby.players.length > 0) {
        broadcaster.notifyHostChanged(lobby);
      }
    }
    lobbyManager.removeClient(clientId);
    clients.delete(ws);
  });
  
  ws.on('error', (err) => console.error(...));
});
```

### Periodic Cleanup (Lines 98-113)

- Runs every 30 seconds
- Iterates `clients` Map, removes any `ws.readyState !== WebSocket.OPEN`
- Calls `leaveLobby` + `removeClient` for each dead connection

### Server Start (Lines 115-121)

```typescript
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Relay server running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  console.log(`[Server] Stats: http://localhost:${PORT}/stats`);
});
```

### Graceful Shutdown (Lines 123-143)

Handles `SIGTERM` and `SIGINT`:
1. `lobbyManager.destroy()` - Clears intervals, lobbies, clients
2. `wss.close()` - Closes WebSocket server
3. `server.close()` - Closes HTTP server
4. `process.exit(0)`

---

## Lobby Manager: `src/lobby.ts`

### Class: `LobbyManager`

#### Data Structures

```typescript
interface ConnectedClient {
  id: string;
  ws: any;              // WebSocket
  name: string;
  lobbyCode?: string;
  ready: boolean;
}

private lobbies = new Map<string, LobbyState>();    // code → LobbyState
private clients = new Map<string, ConnectedClient>(); // clientId → ConnectedClient
private cleanupInterval: NodeJS.Timeout;            // 5-min lobby cleanup
```

#### Lobby Creation (`createLobby`, lines 33-71)

```typescript
createLobby(clientId: string, settings: LobbySettings): LobbyState
```

- Generates unique 4-char code (max 100 attempts)
- Creates host player: `ready=true`, `isHost=true`, color index 0
- Sets lobby state: `'lobby'`, records `createdAt`
- Registers `client.lobbyCode = code`, `client.ready = true`

#### Lobby Update (`updateLobby`, lines 74-86)

- Host only, only in `'lobby'` state
- Merges partial settings: `{ ...lobby.settings, ...settings }`

#### Join Lobby (`joinLobby`, lines 89-116)

- Validates: exists, state=`'lobby'`, not full
- Creates player: `ready=false`, `isHost=false`, color by player index
- Adds to `lobby.players`, sets `client.lobbyCode`

#### Leave Lobby (`leaveLobby`, lines 119-145)

- Removes player from `lobby.players`
- Clears `client.lobbyCode`, `client.ready`
- **Host Migration**: If host left and players remain:
  - New host = first player in array
  - Sets `lobby.hostId = newHost.id`, `newHost.isHost = true`
  - Returns lobby for broadcaster to notify

#### Ready State (`setReady`, lines 148-162)

- Updates both `player.ready` and `client.ready`

#### Start Game (`startGame`, lines 165-177)

- Host only, only in `'lobby'` state
- Sets `lobby.state = 'playing'`
- Host will send initial snapshot via separate channel

#### Client Management

| Method | Purpose |
|--------|---------|
| `addClient(id, ws, name)` | Register new connection |
| `removeClient(id)` | Leave lobby + delete client |
| `getClient(id)` | Get ConnectedClient |
| `setClientName(id, name)` | Update display name |
| `isHost(id)` | Check if client is lobby host |
| `getLobby(code)` | Get lobby by code |
| `getClientLobby(id)` | Get lobby for client |
| `getLobbyClients(code)` | Get all ConnectedClient in lobby |

#### Cleanup (`cleanup`, lines 255-265)

- Runs every 5 minutes (set in constructor)
- Removes lobbies with 0 players OR age > 1 hour
- Logs: `[Lobby] Cleaned up lobby ${code}`

#### Stats (`getStats`, lines 275-285)

```typescript
{ lobbies: number; players: number; clients: number }
```

#### Shutdown (`destroy`, lines 268-272)

- Clears cleanup interval
- Clears all maps

#### Color Generation (lines 235-252)

- 12 distinct hues: `[0, 30, 60, 120, 180, 210, 240, 270, 300, 330, 15, 45]`
- HSL: hue from array, saturation 70%, lightness 55%
- Converts to hex RGB number: `(r << 16) | (g << 8) | b`

---

## Broadcaster: `src/broadcast.ts`

### Class: `Broadcaster`

**Constructor**: `new Broadcaster(lobbyManager: LobbyManager)`

#### Core Send Methods

```typescript
send(client: ConnectedClient, msg: ServerMessage): boolean
broadcast(lobby: LobbyState, msg: ServerMessage, excludeClientId?: string): number
broadcastToClients(lobby: LobbyState, msg: ServerMessage): number  // excludes host
sendToHost(lobby: LobbyState, msg: ServerMessage): boolean
```

- Checks `ws.readyState === 1` (WebSocket.OPEN)
- `JSON.stringify` + `ws.send()`
- Returns success count / boolean

#### Lobby Notification Methods

| Method | Message Sent | Recipients |
|--------|--------------|------------|
| `notifyLobbyCreated(client, lobby, player)` | `lobby_created` | Creating client |
| `notifyLobbyJoined(client, lobby, player)` | `lobby_joined` (sanitized) | Joining client |
| `notifyPlayerJoined(lobby, newPlayer, excludeId?)` | `player_joined` + `lobby_players_updated` | All others |
| `notifyPlayerLeft(lobby, playerId)` | `player_left` + `lobby_players_updated` | All others |
| `notifyPlayerReady(lobby, playerId, ready)` | `player_ready` | All |
| `notifyHostChanged(lobby)` | `host_changed` | All |
| `notifyGameStart(lobby, snapshot)` | `game_start` (per-player `yourPlayerId`) | All players |
| `broadcastSnapshot(lobby, tick, entities)` | `snapshot` | All |
| `sendError(client, message)` | `error` | Single client |
| `kickPlayer(lobby, playerId, reason)` | `kicked` | Target client |

#### State Sanitization (lines 153-161)

```typescript
private sanitizeLobbyState(lobby: LobbyState): LobbyState {
  return {
    ...lobby,
    players: lobby.players.map(p => ({ ...p }))  // Shallow copy, no connection info
  };
}
```

---

## Message Handler: `handleClientMessage` (lines 165-276)

Routes incoming `ClientMessage` to lobby/broadcaster actions:

```typescript
function handleClientMessage(
  clientId: string,
  msg: ClientMessage,
  lobbyManager: LobbyManager,
  broadcaster: Broadcaster
): void
```

### Message Type Handling

| Client Message | Action |
|----------------|--------|
| `create_lobby` | Update name → `createLobby` → `notifyLobbyCreated` |
| `update_lobby` | `updateLobby` (host only) → `broadcast(lobby_updated)` |
| `join_lobby` | Update name → `joinLobby` → `notifyLobbyJoined` + `notifyPlayerJoined` |
| `leave_lobby` | `leaveLobby` → `notifyPlayerLeft` + `notifyHostChanged` if needed |
| `player_ready` | `setReady` → `notifyPlayerReady` |
| `start_game` | Host check → `startGame` → `notifyGameStart` (empty snapshot) |
| `command` | No-op (host simulates locally, sends snapshots directly) |
| `chat` | `broadcast(chat)` to lobby |
| `ping` | Respond with `pong` (same timestamp) |

### Error Handling

- All cases wrapped in try/catch or validation checks
- Errors sent via `broadcaster.sendError(client, message)`
- Invalid JSON caught at WS `message` handler (index.ts line 70-76)

---

## Shared Protocol: `src/shared/protocol.ts`

**Identical to client's `shared/protocol.ts`** - see [CLIENT.md#shared-protocol](../CLIENT.md#shared-protocol-srsharedprotocolts) for full type definitions.

Key exports:
- `LobbySettings`, `Player`, `LobbyState`
- `Vec3`, `Command`, `Entity`, `Snapshot`
- `ClientMessage`, `ServerMessage` (discriminated unions)
- `generateLobbyCode()`, `generatePlayerId()`, `generateEntityId()`

---

## Build & Development

### `package.json` Scripts
```json
{
  "dev": "tsx watch src/index.ts",     // Hot-reload dev server
  "prebuild": "npm install",           // Ensure deps before build
  "build": "tsc",                      // Compile to dist/
  "start": "node dist/index.js",       // Run production build
  "test": "echo \"No tests yet\" && exit 0"
}
```

### Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `express` | ^5.3.0 | HTTP server + middleware |
| `ws` | ^8.23.0 | WebSocket server |
| `msgpackr` | ^2.1.4 | Binary serialization (future) |

### Dev Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `@types/express` | ^5.0.6 | Express types |
| `@types/node` | ^26.6.6 | Node.js types |
| `@types/ws` | ^8.18.2 | ws types |
| `tsx` | ^4.19.0 | TypeScript execution (dev) |
| `typescript` | ^7.0.2 | Compiler |

### `tsconfig.json` (implied)
- Target: ES2022
- Module: CommonJS (for Node.js)
- OutDir: `dist/`
- Strict: true
- Declaration: true

---

## Deployment

### Render.com (Current)

**Build Command**: `npm run build`
**Start Command**: `npm start`
**Environment**: Node.js
**Port**: Assigned via `process.env.PORT` (Render sets this)
**Health Check**: `GET /health` → `"ok"`

### Required Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Auto (Render) | HTTP/WSS port |

### Health Endpoints

| Endpoint | Method | Response | Purpose |
|----------|--------|----------|---------|
| `/health` | GET | `200 "ok"` | Load balancer health check |
| `/stats` | GET | `200 { lobbies, players, clients }` | Monitoring |
| `/warm` | GET | `200 { ok, uptime, memory }` | Keep-alive / pre-warm |

### WebSocket Endpoint
- Same host/port as HTTP: `ws://host:port` or `wss://host:port`
- No path prefix: connects directly to `/`

### Graceful Shutdown
- Handles `SIGTERM` (Render) and `SIGINT` (local Ctrl+C)
- Closes WS connections, then HTTP server
- 30-second timeout on Render before SIGKILL

---

## Scaling Considerations

### Current Limitations (Single Process)
- **In-memory only**: Lobby state lost on restart
- **No horizontal scaling**: Single Node.js process
- **No persistence**: No database

### Future Scaling Paths
1. **Redis Pub/Sub** - Multi-instance message routing
2. **Sticky Sessions** - Load balancer routes same lobby to same instance
3. **External State Store** - Redis/PostgreSQL for lobby persistence
4. **Game Server Separation** - Dedicated authoritative game servers per match

### Message Rate Limits (Recommended)
- Commands: ~20/sec per client (host sends snapshots at 20Hz)
- Chat: ~5/sec per client
- Ping: 1/sec (built-in)

---

## Protocol Details

### Connection Flow

```
Client                          Server
  │                                │
  ├─ WebSocket connect ──────────► │
  │                                │
  │  (assigns clientId)           │
  │                                │
  ├─ create_lobby ───────────────► │
  │                                ├─ Creates lobby, host player
  │                                │
  │ ◄─ lobby_created ───────────── ┤
  │   { code, playerId, player }  │
  │                                │
  ├─ join_lobby { code, name } ──► │
  │                                ├─ Validates, adds player
  │                                │
  │ ◄─ lobby_joined ────────────── ┤
  │   { state, playerId, player } │
  │                                │
  │ ◄─ player_joined ───────────── ┤ (to other players)
  │ ◄─ lobby_players_updated ───── ┤ (to all)
  │                                │
  ├─ player_ready { ready:true } ─► │
  │                                │
  │ ◄─ player_ready ────────────── ┤ (to all)
  │                                │
  ├─ start_game ─────────────────► │ (host only)
  │                                ├─ state = 'playing'
  │                                │
  │ ◄─ game_start ──────────────── ┤ (to all)
  │   { snapshot, yourPlayerId }  │
  │                                │
  │  (Host simulates, sends snapshots)
  │                                │
  ├─ snapshot { tick, entities } ─► │ (host → server)
  │                                │
  │ ◄─ snapshot ────────────────── ┤ (server → all clients)
```

### Message Format

**All messages**: JSON over WebSocket frames
- Client→Server: `ClientMessage` union
- Server→Client: `ServerMessage` union
- Each has discriminant `type` field

**Future**: Replace JSON with **msgpackr** (already in deps)
- `import { pack, unpack } from 'msgpackr'`
- `ws.send(pack(msg))` / `unpack(data)`

---

## Monitoring & Debugging

### Logs
- Prefixed: `[Server]`, `[Lobby]`, `[Broadcast]`, `[RelayClient]`
- Connection events, lobby lifecycle, errors

### Stats Endpoint (`/stats`)
```json
{
  "lobbies": 3,
  "players": 8,
  "clients": 10
}
```

### Health Check (`/health`)
- Returns `200 OK` with body `"ok"`
- Used by Render.com for auto-healing

### Warm Endpoint (`/warm`)
```json
{
  "ok": true,
  "uptime": 3600.5,
  "memory": "45MB"
}
```

---

## Extending the Server

### Adding a New Message Type
1. Add to `ClientMessage` / `ServerMessage` in `shared/protocol.ts`
2. Add case in `handleClientMessage()` in `broadcast.ts`
3. Add broadcaster method if needs lobby-wide notify
4. Add event in client's `RelayClientEvents`

### Adding Lobby Settings
1. Extend `LobbySettings` in `shared/protocol.ts`
2. Update `createLobby`/`updateLobby` defaults in `lobby.ts`
3. Update client menu options in `menu.ts`

### Adding Game Logic
- Current: Host simulates, sends snapshots
- Future: Server-authoritative simulation
  - Add game loop in `index.ts` (setInterval 50ms)
  - Process `command` messages from host
  - Broadcast `snapshot` to all

### Soldier Generation & Hex Ownership (Server)

#### Overview
The server manages authoritative game state for hex ownership and soldier economies. Each second, passive generation is applied to all players based on owned hex count.

#### Key Modules
- **GameStateManager** (`src/game/game-state.ts`): Authoritative hex ownership array, player economies
- **Economy** (`src/game/economy.ts`): Pure calculation functions (must match client exactly)
- **TickLoop** (`src/game/tick-loop.ts`): 1-second interval for passive generation
- **Territory** (`src/game/territory.ts`): Dynamic territory/border detection from ownership
- **Pathfinding** (`src/game/pathfinding.ts`): A* on hex grid with border accessibility

#### Key Constants (in `src/game/economy.ts`)
```typescript
BASE_SOLDIERS_PER_HEX = 10
MAX_SOLDIERS_PER_HEX = 500
SOLDIERS_PER_SECOND_PER_HEX = 50  // ADJUST TO TUNE SPEED
```

#### Game Flow (Server)
1. **start_game** → Host triggers; server initializes GameStateManager, sends `game_start`, then `game_state_sync`, then the 5s countdown
2. **start_hex_countdown** → Immediate `5`, then one message per second down to `0`
3. **select_start_hex** → Player claims hex; server validates (land, unowned) and recalculates economy
4. **Economy Init** → Base soldiers = biome multiplier × 10 (e.g., Grassland = 12)
5. **Tick Loop** → Every 1000ms: each owned hex trains up to 500, broadcast `economy_update`
6. **Auto-Assign** → At `0`, any player without a hex is claimed a random land hex via `selectStartHex` (economy recalculated)
7. **select_hex / attack_hex** → Selection; attacks launch from owned hexes **adjacent** to the target

#### Combat (Server)
- Each selected source commits 50% of its garrison; 30% are lost marching
- Neutral targets defend with their biome base value; owned targets defend with their garrison
- If the attack force exceeds defence the hex flips owner and keeps the remainder as garrison
- After combat the full `game_state_sync` is broadcast (ownership, garrisons, economies, territories)

#### Territory System (Dynamic)
- **Interior**: Fully surrounded by own territory
- **Border**: Adjacent to neutral hexes
- **Frontline**: Directly adjacent to enemy
- **Territory Borders**: Dynamic between players where frontlines meet
- Note: conquest is adjacency-based, so border hexes (not only frontline) can expand into neutral land

#### Building System (Server)

##### Building Costs
Defined in `client/public/building-costs.json` (shared with client):

| Building | Gold | Population | Time | Effect |
|----------|------|------------|------|--------|
| City | 120 | 10 | 10s | +10 max population per level |
| Factory | 180 | 5 | 10s | +5 gold/sec per level |
| Base | 250 | 20 | 10s | +2% soldier generation per base (stacks) |
| Capital | 600 | 50 | 15s | 1.5× total country population (one per player) |

##### Population
- `maxPopulation = sum(city.level × 10 for all cities) × (1.5 if hasCapital else 1.0)`
- Population is capped by maxPopulation
- `population = min(totalSoldiers, maxPopulation)`

##### Gold
- `goldIncome = sum(factory.level × 5 for all factories)` per second
- Used for building construction

##### Soldier Generation
- Base rate: 50 soldiers/sec/hex
- Each Base building adds +2% (stacks)
- `soldierGenerationRate = 50 × (1 + 0.02 × baseCount)`
- Soldiers allocated from population: `allocatedSoldiers = floor(population × soldierAllocationRatio)`
- Attack force: `attackForce = floor(allocatedSoldiers × attackAllocationRatio)`

##### Capital Rules
- One capital per player (enforced server-side)
- When capital hex is captured: capital is destroyed (removed from hex), capturer does NOT get it
- `capital_destroyed` message broadcast to all players

##### Tick Loop (1 second)
1. Process building construction (tickBuildings)
2. Broadcast `building_completed` for finished buildings
3. Apply passive generation (soldiers, gold)
4. Broadcast `economy_update` to each player
5. Broadcast full `game_state_sync` if buildings changed


#### Network Messages
**Client → Server:**
- `select_start_hex` { hexId }
- `select_hex` { hexId, shiftKey }
- `deselect_hex` { hexId }
- `attack_hex` { hexId, fromHexIds }
- `radial_menu_action` { action, hexId, params }
- `move_soldiers` { fromHex, toHex, amount }
- `build_structure` { hexId, buildingType }
- `demolish_building` { hexId }
- `set_soldier_allocation` { ratio }
- `set_attack_allocation` { ratio }

**Server → Client:**
- `game_state_sync` { state: GameState }
- `economy_update` { economy: PlayerEconomy }
- `start_hex_countdown` { secondsRemaining }
- `start_hex_confirmed` { hexId }
- `hex_selected` { hexId, playerId, isMultiSelect }
- `hex_deselected` { hexId, playerId }
- `attack_result` { success, hexId, attackerId, defenderId, casualties }
- `territory_updated` { territory }
- `hex_captured` { hexId, newOwner, soldiers }
- `building_started` { hexId, buildingType, playerId }
- `building_completed` { hexId, buildingType, playerId }
- `building_demolished` { hexId, playerId }
- `capital_destroyed` { hexId, formerOwnerId, capturedBy }

#### Tuning Generation Speed
Edit `SOLDIERS_PER_SECOND_PER_HEX` in `shared/protocol.ts`, then copy it to `server/src/shared/protocol.ts`
(and `client/src/shared/protocol.ts`). Both sides must use identical values.

### Adding Authentication
- JWT tokens in WebSocket handshake (`req.headers`)
- Validate in `connection` handler before `addClient`
- Store user ID in `ConnectedClient`

---

## Troubleshooting

### "Connection Refused" / "ECONNREFUSED"
- Server not running on expected port
- Check `PORT` env var (default 3000)
- Render: Check service logs for startup errors

### WebSocket Fails in Browser
- **CORS**: Server allows `*` (line 17)
- **Mixed Content**: HTTPS page → WSS required
- **Proxy**: Some corporate proxies block WS → Use WSS

### Lobby Codes Not Working
- Case-sensitive: Server normalizes to uppercase (line 90)
- Cleanup: Empty lobbies removed after 5 min, old after 1 hour
- Max players enforced (default 12)

### Memory Leaks
- `cleanup()` interval clears dead connections (30s)
- `destroy()` clears all on shutdown
- Monitor `/stats` for growing `clients` count

### Host Migration Issues
- New host = first player in `lobby.players` array
- `notifyHostChanged` broadcasts `newHostId`
- Client must re-enable Start button (see client `onHostChanged`)

---

## Security Notes

- **No authentication** - Anyone can connect/create lobbies
- **No rate limiting** - Vulnerable to spam/DoS
- **No encryption** beyond TLS (WSS in production)
- **Input validation** - Minimal (JSON.parse + type checks)
- **CORS**: Wide open (`*`) for development

### Production Hardening (Recommended)
1. Add rate limiting (express-rate-limit)
2. Add lobby code validation (length, charset)
3. Add max message size (ws `maxPayload`)
4. Consider auth tokens for private lobbies
5. Add request logging (morgan)