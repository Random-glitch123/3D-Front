# 3D-Front Client Documentation

## Overview

**3D-Front** is a browser-based 3D multiplayer strategy game built with **Babylon.js** (WebGL/WebGPU), **TypeScript**, and **Vite**. The client renders a hex-tiled globe, provides a menu system for singleplayer/multiplayer, and communicates with a WebSocket relay server for multiplayer lobbies and game state synchronization.

- **Framework**: Babylon.js v7 (WebGPU with WebGL2 fallback)
- **Build Tool**: Vite 8 with esbuild
- **Language**: TypeScript (ES2022, ES modules)
- **Networking**: WebSocket (ws:// / wss://) with JSON messaging (msgpackr ready)
- **Architecture**: Single-page app, modular ES modules

---

## Project Structure

```
client/
├── package.json              # Dependencies & scripts
├── vite.config.ts            # Vite configuration
├── tsconfig.json             # TypeScript config (extends root)
├── index.html                # Entry HTML
├── public/
│   └── world-map.json        # Pre-baked hex globe data
└── src/
    ├── main.ts               # Application entry point
    ├── globe/
    │   └── renderer.ts       # Hex globe mesh + shaders
    ├── menu/
    │   └── menu.ts           # HTML overlay menu system
    ├── net/
    │   ├── relay-client.ts   # WebSocket client with reconnection
    │   └── connection-manager.ts # Local-first with fallback logic
    └── shared/
        └── protocol.ts       # Shared types (client↔server)
```

---

## Entry Point: `src/main.ts`

### Initialization Flow

```typescript
init() → cleanup() → canvas setup → Engine → WebGPU init → GlobeRenderer → Camera → Menu → ConnectionManager → connect() → renderLoop
```

### Key Responsibilities

1. **Canvas & Engine Setup** (lines 78-111)
   - Creates `<canvas>` fixed fullscreen
   - Babylon.js `Engine` with WebGPU preference, WebGL2 fallback
   - Explicit canvas dimensions for driver compatibility

2. **Globe Renderer** (line 114)
   - `createGlobeRenderer(radius, engine)` - async, loads `world-map.json`
   - Returns `{ scene, landMesh, dispose, updateUniforms }`
   - Globe's scene becomes the main scene

3. **Camera** (lines 119-131)
   - `ArcRotateCamera` for orbital globe viewing
   - Limits: radius 1.2×–10×, beta 5°–171° (no polar flip)
   - Auto-rotate enabled for menu background

4. **Menu System** (lines 133-156)
   - `createMenu(callbacks)` returns HTMLElement
   - Callbacks wire menu actions to game logic
   - Player name persisted in `localStorage`

5. **Network** (lines 158-161, 223-362)
   - `ConnectionManager` handles local-first with fallback
   - `setupConnectionEvents()` wires all relay events to UI

6. **Render Loop** (lines 167-190)
   - `engine.runRenderLoop()` - delta time, auto-rotate, uniforms, render
   - WebGL error checking per frame (debug)

### Global State (Module Scope)

| Variable | Type | Purpose |
|----------|------|---------|
| `engine` | `Engine \| null` | Babylon engine |
| `scene` | `Scene \| null` | Main scene (from globe) |
| `camera` | `ArcRotateCamera \| null` | Orbital camera |
| `globe` | `GlobeRenderer \| null` | Globe renderer instance |
| `menu` | `HTMLElement \| null` | Menu DOM root |
| `connectionManager` | `ConnectionManager \| null` | Network manager |
| `preCreatedLobby` | `boolean` | Tracks if host lobby exists |

### Cleanup & HMR

- `cleanup()` disposes all resources, removes canvas, disconnects network
- `window.beforeunload` + `import.meta.hot.dispose` for HMR support

### Dev Debug Hook

```typescript
(window as any).__globe = { camera, globe, setView(alpha, beta) }
```

---

## Globe Renderer: `src/globe/renderer.ts`

### Overview

Generates a **hex-tiled sphere** from pre-baked `world-map.json`. Each hex is a **prism** (top + bottom + side walls) merged into a single mesh. Biome colors, borders, and ocean waves rendered in a custom **ShaderMaterial**.

### Data Format: `world-map.json`

```typescript
interface WorldMapData {
  meta: {
    name: string;
    subdivisions: number;
    radius: number;
    hexCount: number;
    cornerCount: number;
    triangleCount: number;
    biomeColors: Record<string, [number, number, number]>; // biomeId → RGB [0-1]
  };
  corners: number[];           // Flattened [x,y,z] per corner (unit sphere)
  cornerHeights: number[];     // Elevation per corner
  hexes: Hex[];
}

interface Hex {
  id: number;
  center: [number, number, number];  // Unit vector
  corners: number[];                  // Indices into corners array
  neighbors: number[];                // Adjacent hex IDs
  biome: number;                      // Biome ID (0=ocean, 1=coast, 2+=land)
  elevation: number;
  height: number;                     // Extrusion height
}
```

### Mesh Generation (Lines 83-331)

**Per-Hex Prism Topology:**
- **Top face**: 1 center + N corners → N triangles (fan)
- **Bottom face**: 1 center + N corners → N triangles (fan, reversed winding)
- **Side walls**: N quads (2 tris each) with outward normals
- **Total vertices/hex**: 6N + 2 | **Indices**: 12N

**Vertex Attributes:**
| Attribute | Size | Purpose |
|-----------|------|---------|
| `position` | vec3 | World position |
| `normal` | vec3 | Lighting normal |
| `biome` | float | Biome ID for color lookup |
| `edge` | float | 1.0 on tile centers/corners, 0.0 elsewhere (borders) |
| `coastal` | float | 1.0 if water hex bordering land |
| `nearCoast` | float | 1.0 if water hex within 2 hops of land |

**Land Proximity Precompute** (lines 93-118):
- `coastal[i]` = water hex with land neighbor
- `nearCoast[i]` = coastal OR water hex with coastal neighbor

### Shaders

#### Vertex Shader (lines 350-381)
- Passes world position, normal, view dir, and all attributes to fragment
- Uses `viewProjection` uniform from Babylon's `SceneUniforms` buffer

#### Fragment Shader (lines 383-556)

**Biome Colors** (line 64-65, 402):
- GLSL function `biomeColor(float biome)` generated from JSON palette
- Chain of `if (biome < threshold) return vec3(...)` for each biome

**Lighting** (lines 491-497):
- Flat-ish: `0.62 + 0.55 * max(dot(N,L), 0)`
- Atmospheric rim: `pow(1 - max(dot(N,V), 0), 3) * 0.55`

**Ocean Waves** (lines 500-547):
- **Stable direction**: `waveDirection()` uses spherical coords (no pole singularity)
- **3 layers**: swell (42m), chop (16m), cross-chop (24m)
- **Noise-modulated wavelength**: `fbm(pos * 0.008)` varies wavelength spatially
- **Crest detection**: `smoothstep(0.6, 0.8, phase) * smoothstep(0.8, 0.6, phase)` → bell curve
- **Colors**: Cyan/light-blue crests, subtle trough shading, sun glint
- **Proximity modulation**: `mix(0.6, 0.9, coastal/nearCoast)` - subtle coastal brightening

**Borders** (lines 549-553):
- Screen-space width: `fwidth(vEdge)` for 1px at all zoom levels
- `smoothstep(bw-aa, bw+aa, vEdge)` for anti-aliased edges

### Starfield (lines 583-643)
- 2200 points at radius 20×–60× globe
- Additive blending (`ALPHA_ADD`), point size 1.5px
- Random warm tints

### Public API

```typescript
interface GlobeRenderer {
  scene: Scene;
  landMesh: Mesh;
  dispose(): void;
  updateUniforms(cameraPos: Vector3, time: number): void; // Updates uTime
}
```

---

## Menu System: `src/menu/menu.ts`

### Overview

HTML overlay (`position: fixed, z-index: 100`) with four panels:
1. **Main** - Singleplayer, Host, Join, Settings
2. **Host** - Lobby code, settings (max players, public, map), player list, Start/Back
3. **Join** - 4-char code input, player list, Join/Back
4. **Settings** - Server URL input (persisted to localStorage)

### Architecture

- **Single `createMenu(callbacks)` factory** returns container HTMLElement
- **Panels** are sibling divs toggled via `.hidden` class
- **Callbacks** (interface `MenuCallbacks`) decouple UI from logic
- **External mutation** via properties attached to container:
  - `setHostCode(code)`, `setHostPlayerList(players)`, `setJoinPlayerList(players)`, `setJoinStatus(msg, type)`, `show()`, `hide()`

### Styling

- Injected `<style>` with CSS custom properties
- Glassmorphism panels: `rgba(10,10,25,0.95)`, `backdrop-filter: blur(20px)`
- Gradient buttons with hover/tap transitions
- Title animation: `@keyframes pulse` brightness oscillation

### Player List Rendering (lines 282-299)

- Handles duplicate names with `[2]`, `[3]` suffixes
- Shows color dot (from player.color), host badge, ready checkmark
- Used for both host and join panels

### Server URL Persistence (lines 336-348)
- Input binds to `localStorage['3d-front-server-url']`
- Empty = use default (localhost dev, render.com prod)
- Triggers `onServerUrlChange` callback

---

## Networking

### `src/net/relay-client.ts` - WebSocket Client

#### Class: `RelayClient`

**Constructor**: `new RelayClient(url: string, playerName: string)`
- Normalizes `http://` → `ws://`, `https://` → `wss://`
- Generates persistent `playerId` via `generatePlayerId()`

**Connection Management:**
- `connect(): Promise<void>` - Returns promise resolving on open
- Auto-reconnect with exponential backoff (max 10 attempts, base 1s × 1.5ⁿ)
- `disconnect()` - Clean close, prevents reconnect
- Queues messages when disconnected (`pendingMessages`)

**Event System** (interface `RelayClientEvents`):
```typescript
onStateChange: (state: ConnectionState) => void
onLobbyCreated: (code, playerId, player) => void
onLobbyJoined: (state, playerId, player) => void
onLobbyUpdated: (settings) => void
onLobbyPlayersUpdated: (players[]) => void
onLobbyError: (message) => void
onPlayerJoined: (player) => void
onPlayerLeft: (playerId) => void
onPlayerReady: (playerId, ready) => void
onHostChanged: (newHostId) => void
onGameStart: (snapshot, yourPlayerId) => void
onSnapshot: (tick, entities[]) => void
onChat: (playerId, playerName, message) => void
onError: (message) => void
onKicked: (reason) => void
```

**Message Encoding**: JSON (placeholder for msgpackr)

**Convenience Methods:**
| Method | Message Sent |
|--------|--------------|
| `createLobby(settings)` | `{type:'create_lobby', settings, name}` |
| `updateLobby(settings)` | `{type:'update_lobby', settings}` |
| `joinLobby(code)` | `{type:'join_lobby', code, name}` |
| `leaveLobby()` | `{type:'leave_lobby'}` |
| `setReady(ready)` | `{type:'player_ready', ready}` |
| `startGame()` | `{type:'start_game'}` |
| `sendCommands(tick, cmds)` | `{type:'command', tick, commands}` |
| `sendChat(msg)` | `{type:'chat', message}` |
| `ping()` | `{type:'ping', time: Date.now()}` |

#### Class: `LatencyTracker`
- `startPing()/endPing()` → RTT samples
- `getAverageRTT()`, `getJitter()`

---

### `src/net/connection-manager.ts` - Local-First Fallback

#### Purpose

**Development**: Try `ws://localhost:3000` first → on failure, fallback to `wss://threed-front-server.onrender.com`
**Production**: Use remote only (no fallback)
**Manual Override**: Always respected via Settings/localStorage

#### Class: `ConnectionManager`

**Constructor**: `new ConnectionManager(playerName)`
- Builds target list based on environment and localStorage
- Target order: `[manual?, local, remote]` (dev) or `[manual?, remote]` (prod)

**Public API:**
```typescript
connect(): Promise<void>              // Start connection with fallback
reconnect(newUrl?: string): Promise<void>  // Force reconnect (e.g., after URL change)
disconnect(): void                     // Clean disconnect
getCurrentTarget(): TargetConfig | null  // { target, url, label }
getCurrentUrl(): string                // Active WebSocket URL
getRelayClient(): RelayClient | null   // Direct access if needed
getState(): ConnectionState            // From underlying RelayClient
// Delegated methods: createLobby, joinLobby, leaveLobby, etc.
setPlayerName(name: string): void
```

**Events** (extends `RelayClientEvents`):
```typescript
onTargetChange: (target: ConnectionTarget, url: string) => void
onFallbackAttempt: (from: ConnectionTarget, to: ConnectionTarget) => void
onFallbackFailed: (originalTarget: ConnectionTarget) => void
```

**TargetConfig:**
```typescript
{ target: 'local' | 'remote' | 'manual', url: string, label: string }
```

**Fallback Logic** (private `handleConnectionFailure`):
1. If production OR manual override failed → emit error, stop
2. If dev and local failed → try remote, emit `onFallbackAttempt`
3. If all exhausted → emit `onFallbackFailed`, show error in UI

---

## Shared Protocol: `src/shared/protocol.ts`

### Type Definitions (Client ↔ Server)

#### Lobby
```typescript
interface LobbySettings { maxPlayers: number; public: boolean; map: string; }
interface Player { id: string; name: string; ready: boolean; color: number; isHost: boolean; }
interface LobbyState { code: string; hostId: string; players: Player[]; settings: LobbySettings; state: 'lobby'|'playing'|'finished'; createdAt: number; }
```

#### Game Commands
```typescript
interface Vec3 { x: number; y: number; z: number; }
interface Command {
  type: 'move'|'attack'|'build'|'patrol'|'stop';
  unitIds: string[];
  target?: Vec3;
  targetId?: string;
  buildType?: string;
  queue?: boolean;
}
```

#### World State
```typescript
interface Entity {
  id: string;
  type: 'unit'|'building'|'projectile'|'resource';
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
interface Snapshot { tick: number; timestamp: number; entities: Entity[]; }
```

#### Network Messages

**Client → Server** (`ClientMessage`):
```typescript
{ type: 'create_lobby'; settings: LobbySettings; name: string }
{ type: 'join_lobby'; code: string; name: string }
{ type: 'leave_lobby' }
{ type: 'player_ready'; ready: boolean }
{ type: 'start_game' }
{ type: 'command'; tick: number; commands: Command[] }
{ type: 'ping'; time: number }
{ type: 'chat'; message: string }
```

**Server → Client** (`ServerMessage`):
```typescript
{ type: 'lobby_created'; code: string; playerId: string; player: Player }
{ type: 'lobby_joined'; state: LobbyState; playerId: string; player: Player }
{ type: 'lobby_error'; message: string }
{ type: 'player_joined'; player: Player }
{ type: 'player_left'; playerId: string }
{ type: 'player_ready'; playerId: string; ready: boolean }
{ type: 'host_changed'; newHostId: string }
{ type: 'game_start'; initialSnapshot: Snapshot; yourPlayerId: string }
{ type: 'snapshot'; tick: number; entities: Entity[] }
{ type: 'pong'; time: number }
{ type: 'chat'; playerId: string; playerName: string; message: string }
{ type: 'error'; message: string }
{ type: 'kicked'; reason: string }
```

#### Utilities
```typescript
generateLobbyCode(): string      // 4-char, no I/O/0/1
generatePlayerId(): string       // 'player_' + random
generateEntityId(): string       // 'entity_' + random
```

---

## Build & Development

### `package.json` Scripts
```json
{
  "dev": "vite",                    // Dev server on :5173
  "build": "tsc && vite build",     // Type-check + production build
  "preview": "vite preview"         // Preview production build
}
```

### Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `@babylonjs/core` | ^7.0.0 | 3D engine |
| `@babylonjs/loaders` | ^7.0.0 | Asset loaders (unused currently) |
| `msgpackr` | ^2.1.4 | Binary serialization (ready for future) |

### Dev Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `esbuild` | ^0.28.2 | Fast bundler (via Vite) |
| `typescript` | ~7.0.2 | Type checking |
| `vite` | ^8.3.6 | Dev server + build |
| `vite-plugin-string` | ^1.2.3 | Import GLSL shaders as strings |

### `vite.config.ts`
```typescript
export default defineConfig({
  plugins: [string({ include: ['**/*.glsl', '**/*.vs', '**/*.fs'] })],
  build: { target: 'es2022', minify: 'esbuild', sourcemap: true },
  server: { port: 5173, host: true }
});
```

---

## Environment & Configuration

### Environment Variables
- **None required** - Uses `import.meta.env.PROD` / `import.meta.env.DEP` (Vite built-in)

### Runtime Configuration (localStorage)
| Key | Purpose | Default |
|-----|---------|---------|
| `3d-front-player-name` | Player display name | Random `Player_XXXX` |
| `3d-front-server-url` | Manual server override | Auto (localhost/render.com) |

### Default Server URLs
| Environment | URL |
|-------------|-----|
| Development | `ws://localhost:3000` (with fallback to render.com) |
| Production | `wss://threed-front-server.onrender.com` |

---

## Deployment

### Build Output
```
dist/
├── index.html
├── assets/
│   ├── index-<hash>.js
│   ├── index-<hash>.css
│   └── ...
└── world-map.json           # Copied from public/
```

### Hosting
- Static hosting (Netlify, Vercel, Cloudflare Pages, GitHub Pages)
- Requires HTTPS for WebSocket Secure (wss://) in production
- Configure SPA fallback: all routes → `index.html`

### Render.com Backend
- Server deployed separately (see SERVER.md)
- Client connects to `wss://threed-front-server.onrender.com`
- Health checks: `/health`, `/stats`, `/warm`

---

## Extending the Client

### Adding a New Biome
1. Update `world-map.json` meta.biomeColors
2. Regenerate hex data (external tool)
3. Shader auto-adapts via `buildBiomeColorFunction()`

### Adding a New Message Type
1. Add to `ClientMessage` / `ServerMessage` in `shared/protocol.ts`
2. Add handler in `relay-client.ts` `processMessage()`
3. Add event in `RelayClientEvents` and emit
4. Handle in `main.ts` `setupConnectionEvents()`

### Adding a New Menu Panel
1. Create `createXxxPanel()` in `menu.ts`
2. Add to container in `createMenu()`
3. Add navigation in `showPanel()`
4. Add callback to `MenuCallbacks` if needs logic

### Soldier Generation & Hex Ownership System

#### Overview
The game features a soldier economy based on hex ownership with biome-based multipliers. Players claim hexes on the globe, each providing a base soldier value and passive income per second.

#### Key Constants (in `src/game/economy.ts`)
```typescript
BASE_SOLDIERS_PER_HEX = 10          // Starting soldiers per hex
MAX_SOLDIERS_PER_HEX = 500          // Cap per hex (cities increase later)
SOLDIERS_PER_SECOND_PER_HEX = 50    // Passive generation rate (ADJUST THIS TO TUNE SPEED)
OWNERSHIP_TINT_OPACITY = 0.25       // 25% tint on owned hexes
```

#### Biome Multipliers (Hidden from Players)
| Biome | Multiplier | Base Value |
|-------|------------|------------|
| Grassland (2) | 1.2x | 12 |
| Forest (3) | 1.2x | 12 |
| Tundra (5) | 1.0x | 10 |
| Desert (4) | 0.7x | 7 |
| Ice (8) | 0.7x | 7 |
| Mountain/Rock (7) | 1.0x | 10 |
| Snow (6) | 1.0x | 10 |
| Beach (1) | 1.0x | 10 |
| Ocean (0) | 0x | Unownable |

#### Game Flow
1. **Game Start** → Server sends `game_start`, then the initial `game_state_sync`, then starts the 5-second countdown
2. **Countdown Phase** → A thin cyan bar across the very top fills left→right (5→0); the globe stays fully interactive
3. **Select Hex** → Single-click any land hex (biome ≥ 2) to claim it; ocean/beach clicks are rejected with a hint
4. **Color** → Uses faction color selected in lobby (15 distinct colors); no re-pick at game start
5. **Auto-Assign** → If timer expires, the server claims a random unowned land hex through the normal economy path
6. **Passive Generation** → Every second each owned hex trains `+50` soldiers, capped at 500/hex

#### Interaction Model (after start)
- **Single click** your own hex → select it (highlighted); **Shift+click** toggles multi-select
- **Double click** an adjacent non-owned hex → attack from the selected hexes
- **Right click** → reserved for the radial menu (not yet implemented)
- Only hexes adjacent to your territory can launch an attack; neutral hexes defend with their biome base value

#### Singleplayer
Singleplayer reuses the exact same `GameModule`, economy, ownership, selector and UI code as multiplayer.
`src/game/local-game.ts` (`LocalGameClient`) implements the same `on`/`send`/`getPlayerId` surface as
`RelayClient` and runs the authoritative loop locally (claim → tick → adjacent conquest). No lobby or
network connection is involved.

#### UI Components
- **Soldier Panel** (`src/game/ui/soldier-panel.ts`): Top-left display showing `SOLDIERS: 1,234 | INCOME: +50/sec` with smooth animations
- **Hex Tooltip** (`src/game/ui/hex-info-tooltip.ts`): Hover any hex to see biome, owner, soldier count/cap, base value
- **Starting Hex Selector** (`src/game/starting-hex-selector.ts`): 6px top bar (`pointer-events: none`) + subtle bottom hint
- **Economy Panel** (`src/game/ui/economy-panel.ts`): Bottom bar with population slider (0-100%, default 20%), attack allocation slider (0-100%, default 50%), gold and population display
- **Radial Menu** (`src/game/ui/radial-menu.ts`): Right-click context menu with SVG icons - Attack, Build, Ally, Trade, Transfer, Defend, Scout, Cancel. Build opens submenu: City, Factory, Base, Capital, Upgrade, Demolish, Back

#### Building System

##### Buildings (`client/public/building-costs.json`)
Building costs are defined in `client/public/building-costs.json` for easy tuning:

| Building | Gold | Population | Time | Effect |
|----------|------|------------|------|--------|
| City | 120 | 10 | 10s | +10 max population per level |
| Factory | 180 | 5 | 10s | +5 gold/sec per level |
| Base | 250 | 20 | 10s | +2% soldier generation per base (stacks) |
| Capital | 600 | 50 | 15s | 1.5× total country population (one per player) |

##### Population & Soldier Allocation
- Population is generated by cities (10 per level) and capital (1.5× total)
- Bottom slider: 0-100% of population assigned to soldiers (default 20%)
- Attack slider: 0-100% of soldiers committed to attacks (default 50%)
- More soldiers = better attack/defense; less population = worse economy
- `totalSoldiers = floor(population × soldierAllocationRatio)`
- `attackForce = floor(availableSoldiers × attackAllocationRatio)`

##### Capital Rules
- One capital per player
- When an enemy capital hex is captured, the capital is **destroyed** (falls to ash) — the capturer does NOT get it
- The capturer keeps their own capital
- Capital destruction is broadcast to all players with `capital_destroyed` message

##### Construction
- Construction takes ~10 seconds with visual progress
- Only the capital is destroyed when a hex is captured; other buildings transfer to the new owner
- Players can demolish their own buildings (50% gold refund) to build something else


#### Visual Ownership
- Owned hexes: Biome color blended with 25% player faction color
- Unowned hexes: Pure biome color (no tint)
- **Territory borders**: owned hexes on a territory edge get a thicker black outline in the shader
- **Attack flash**: Deep neon red (#FF1111) tint for 200ms when attacking/being attacked
- Updates via `GlobeRenderer.updateOwnership()` only when ownership/economy/selection actually changes
  (version-checked — previously rebuilt a 1.5M-float buffer every frame)

#### Picking Notes
`Scene.createPickingRay(x, y, world, camera)` — the third argument is a **world Matrix**, not the camera.
Passing the camera there throws `world.multiplyToRef is not a function`. Use
`src/game/input/raycast.ts` (`pickHexAtScreen`) which passes `null` for the world matrix, intersects the
globe sphere, and picks the angularly nearest hex centre.

#### Network Messages
**Client → Server:**
- `select_start_hex` { hexId }
- `select_hex` { hexId, shiftKey }
- `attack_hex` { hexId, fromHexIds }
- `radial_menu_action` { action, hexId, params }
- `move_soldiers` { fromHex, toHex, amount }

**Server → Client:**
- `game_state_sync` { state: GameState }
- `economy_update` { economy: PlayerEconomy }
- `start_hex_countdown` { secondsRemaining }
- `start_hex_confirmed` { hexId }
- `hex_selected` { hexId, playerId, isMultiSelect }
- `hex_deselected` { hexId, playerId }
- `attack_result` { success, hexId, attackerId, defenderId, casualties }
- `territory_updated` { territory }
- `hex_captured` { hexId, newOwner, soldiers } (future)

#### Tuning Generation Speed
Edit `SOLDIERS_PER_SECOND_PER_HEX` in `shared/protocol.ts`, then copy the file to
`client/src/shared/protocol.ts` and `server/src/shared/protocol.ts` (the single source of truth).
The economy modules simply re-export it.

#### Regression Notes
- `StartingHexSelector.cleanup()` must never set `camera.autoRotate = true` — that runs when a game
  starts and caused the globe to keep spinning during play.
- `GameModule` must not switch to the live UI on the initial `game_state_sync` (sent before the player
  has claimed a hex). It waits until the local player owns at least one hex.

---

## Troubleshooting

### "Insufficient buffer size" WebGL Error
- Checked per-frame in render loop (line 182-189)
- Usually indicates vertex buffer / index buffer mismatch
- Verify `vertexCount` / `indexCount` calculations in renderer

### Globe Not Rendering
- Check `world-map.json` loads (Network tab)
- Verify `createGlobeResolver` resolves (await)
- Check WebGL context: `engine.getCaps()`

### Connection Issues
- Dev: Ensure local server running on `:3000`
- Check browser console for `[ConnectionManager]` logs
- Settings panel allows manual URL override
- CORS: Server allows `*` origin (see SERVER.md)

### WebGPU Not Working
- Falls back to WebGL2 automatically (line 106-109)
- Check `isWebGPU` log line 111
- Requires HTTPS or localhost, supported browser

---

## Performance Notes

- **Single merged mesh** for all hexes (one draw call)
- **Vertex attributes** for biome/edge/coastal → no texture lookups
- **Shader-based waves** → no CPU-side animation
- **Starfield** as point cloud (additive, depth write off)
- **Render loop** checks WebGL errors only in dev (could be removed for prod)