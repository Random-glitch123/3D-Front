# 3D-Front Code Structure Documentation

## Project Layout

```
3D-front/
├── client/                    # Frontend (Vite + Babylon.js + TypeScript)
│   ├── public/                # Static assets
│   │   ├── favicon.svg
│   │   └── icons.svg
│   ├── src/
│   │   ├── globe/             # Globe rendering system
│   │   │   ├── icosahedron.ts     # Icosahedron geometry generation
│   │   │   ├── hex-group.ts       # Hex instance data preparation
│   │   │   └── renderer.ts        # Babylon.js renderer (ThinInstance + WGSL)
│   │   ├── shaders/           # WGSL shaders (imported as raw strings)
│   │   │   ├── ocean.wgsl         # Ocean: Gerstner waves, foam, depth coloring
│   │   │   └── atmosphere.wgsl    # Atmosphere: Rayleigh/Mie scattering
│   │   ├── menu/              # Main menu UI
│   │   │   └── menu.ts            # HTML/CSS overlay, renderer-agnostic
│   │   ├── net/               # Network client
│   │   │   └── relay-client.ts    # WebSocket manager, event callbacks
│   │   ├── shared/            # Shared types (copied from root shared/)
│   │   │   └── protocol.ts        # Message types, data structures
│   │   ├── main.ts            # Entry point: Engine, Scene, Camera, Globe, Menu, Network
│   │   ├── style.css          # Global styles
│   │   └── counter.ts         # Demo counter (unused)
│   ├── index.html             # HTML entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── server/                    # Backend (Node.js + Express + ws)
│   ├── src/
│   │   ├── index.ts           # Express + WebSocket server entry
│   │   ├── lobby.ts           # LobbyManager: 4-letter codes, players, host election
│   │   ├── broadcast.ts       # Broadcaster: message relay to lobby clients
│   │   └── protocol.ts        # Shared message types (copied from root shared/)
│   ├── package.json
│   └── tsconfig.json
├── shared/                    # Single source of truth for protocol
│   └── protocol.ts            # Types: ClientMessage, ServerMessage, LobbyState, etc.
├── PLAN.md                    # Project plan & status
└── code-structure.md          # This file
```

---

## Module Dependency Graph

```
                    ┌─────────────────┐
                    │   shared/       │
                    │  protocol.ts    │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   client/       │ │   server/       │ │   (future)      │
│   src/shared/   │ │   src/          │ │   sim/          │
│   protocol.ts   │ │   protocol.ts   │ │   protocol.ts   │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────┐
│                    Renderer-Agnostic                    │
│  menu.ts, relay-client.ts, counter.ts, protocol types  │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                    Babylon.js Renderer                  │
│  main.ts → Engine → Scene → GlobeRenderer               │
│                    │                                    │
│         ┌──────────┼──────────┐                         │
│         ▼          ▼          ▼                         │
│    icosahedron  hex-group  shaders/*.glsl               │
└─────────────────────────────────────────────────────────┘
```

---

## Core Modules Detail

### `client/src/globe/icosahedron.ts`

**Purpose**: Pure geometry generator — subdivided icosahedron + dual mesh (hexagons/pentagons)

**Exports**:
- `IcosphereData` — Complete typed geometry data
- `generateIcosphere(level: number)` — Main generator function
- `hexToUV(center)` — Spherical UV helper
- `raycastHex(origin, dir, hexCenters, radius)` — CPU raycast for picking

**Algorithm**:
1. Base icosahedron (12 vertices, 20 faces)
2. Recursive subdivision (each triangle → 4)
3. Face centers/normals + adjacency
4. Dual mesh: each vertex → hex center (12 pentagons at original vertices)
5. Hex neighbors via shared faces

**Complexity**: Level 6 = ~20,480 vertices, ~40,960 faces, ~8,192 hexes

**Dependencies**: None (pure TypeScript, no renderer)

---

### `client/src/globe/hex-group.ts`

**Purpose**: Convert icosphere dual mesh → instance data for ThinInstance rendering

**Exports**:
- `HexInstanceData` — Per-hex: `matrix: Float32Array[16]`, `hexId`, `faceIndices[6]`, `faceCount`, `neighbors[6]`
- `HexGeometryData` — Base hexagon geometry: `positions`, `uvs`, `indices`
- `buildHexInstances(icosphere, radius)` — Main function
- `createHexGeometry(radius)` — Flat hexagon (7 vertices: center + 6 corners)

**Matrix Construction** (column-major, Babylon.js compatible):
```
1. Position = hexCenter * radius
2. Forward = normalize(hexCenter) (outward normal)
3. Up = (0,1,0) or (1,0,0) at poles
3. Right = normalize(cross(Up, Forward))
4. Up = cross(Forward, Right) (orthonormal basis)
5. Quaternion from basis matrix
6. Compose: Matrix = Translation * Rotation * Scale
```

**Dependencies**: `icosahedron.ts` types only

---

### `client/src/globe/renderer.ts`

**Purpose**: Babylon.js scene setup, ThinInstance meshes, WGSL materials

**Exports**:
- `GlobeRenderer` interface
- `createGlobeRenderer(radius, subdivisionLevel, engine)` — Factory

**Scene Composition**:
```
Scene
├── hexMesh (Mesh + ThinInstance)
│   ├── geometry: flat hexagon (7 verts, 18 indices)
│   ├── material: ShaderMaterial (ocean.wgsl)
│   └── thinInstanceSetMatrixAt(i, Matrix) × 8K
├── atmosphereMesh (Mesh)
│   ├── geometry: Sphere (diameter = radius * 2.1, 64 segments)
│   ├── material: ShaderMaterial (atmosphere.wgsl, additive blending)
│   └── back-face rendering via shader
├── starsMesh (Mesh)
│   ├── geometry: Points (3000 vertices, colors, sizes)
│   └── material: Simple ShaderMaterial (vertex color pass-through)
├── sunLight (DirectionalLight)
└── ambientLight (HemisphericLight)
```

**ShaderMaterial Config**:
```typescript
new ShaderMaterial(name, scene, {
  vertexSource: oceanShader,    // imported via ?raw
  fragmentSource: oceanShader,
}, {
  attributes: ["position", "uv"],
  uniforms: ["viewProjection", "view", "projection", "cameraPosition", 
             "uTime", "uRadius", "uWaveSpeed", "uWaveScale", "uSunDir",
             "uWaterColor", "uDeepColor", "uShallowColor", "uFoamColor"],
  uniformBuffers: ["SceneUniforms"],
  needAlphaBlending: true,
  needAlphaTesting: false,
})
```

**ThinInstance Data Flow**:
```
hexMesh.thinInstanceSetMatrixAt(i, Matrix.FromArray(instance.matrix))
    ↓
Babylon auto-creates vertex attributes: world0, world1, world2, world3 (mat4 columns)
    ↓
WGSL vertex shader reads via @builtin(instance_index) → instanceMatrices[instanceIndex]
```

**Uniform Updates** (per frame):
```typescript
updateUniforms(time: number, cameraPos: Vector3) {
  oceanMaterial.setFloat("uTime", time);
  atmoMaterial.setVector3("uCameraPos", cameraPos);
}
```

---

### `client/src/shaders/ocean.glsl` + `ocean.fragment.glsl`

**Purpose**: Ocean rendering with Gerstner waves, depth coloring, foam, Fresnel

**Structure** (GLSL 300 ES):
```glsl
// Vertex shader (ocean.glsl)
uniform float uTime, uRadius, uWaveSpeed, uWaveScale;
uniform vec3 uSunDir, uWaterColor, uDeepColor, uShallowColor, uFoamColor;
// Scene uniforms (Babylon.js built-in)
uniform mat4 viewProjection, view, projection;
uniform vec3 cameraPosition;
// ThinInstance matrices (auto-bound by Babylon.js)
in mat4 world0, world1, world2, world3;
in vec3 position; in vec2 uv;
out vec3 vWorldPos, vNormal, vViewDir; out float vDepth; out vec2 vUv;

mat4 getWorldMatrix() { return mat4(world0, world1, world2, world3); }
// Gerstner wave functions (7 octaves)
// Normal computation via derivative sum
// Tangent space displacement
void main() { ... }

// Fragment shader (ocean.fragment.glsl)
uniform float uTime, uRadius, uWaveSpeed, uWaveScale;
uniform vec3 uSunDir, uWaterColor, uDeepColor, uShallowColor, uFoamColor;
in vec3 vWorldPos, vNormal, vViewDir; in float vDepth; in vec2 vUv;
out vec4 fragColor;
// Noise functions (hash, noise, fbm)
// Fresnel, specular helpers
void main() { ... }
```

**Visual Features**:
- 7-octave Gerstner waves (swells → ripples)
- Depth-based color: shallow → deep → water tint
- Lighting: diffuse + specular (32 shininess) + Fresnel rim
- Foam: normal.y threshold + FBM noise + light-facing
- Subsurface scattering approximation
- Atmospheric fog fade

**Note**: Babylon.js auto-transpiles GLSL → WGSL when WebGPU is available.

---

### `client/src/shaders/atmosphere.glsl` + `atmosphere.fragment.glsl`

**Purpose**: Atmospheric scattering glow on sphere shell (back-face rendering)

**Structure** (GLSL 300 ES):
```glsl
// Vertex shader (atmosphere.glsl)
uniform float uRadius, uAtmosphereRadius, uDensity;
uniform vec3 uCameraPos, uSunDir, uColor;
// Scene uniforms
uniform mat4 viewProjection, view, projection;
uniform vec3 cameraPosition;
in vec3 position; in vec2 uv;
out vec3 vWorldPos, vNormal, vViewDir, vSunDir;
void main() { ... }

// Fragment shader (atmosphere.fragment.glsl)
uniform float uRadius, uAtmosphereRadius, uDensity;
uniform vec3 uCameraPos, uSunDir, uColor;
in vec3 vWorldPos, vNormal, vViewDir, vSunDir;
out vec4 fragColor;
// Ray-sphere intersection, optical depth, scattering
void main() { ... }
```

**Algorithm** (Sean O'Neil approximation):
1. Ray-sphere intersection: camera → atmosphere entry → surface exit
2. 16-sample ray march through atmosphere shell
3. Optical depth: `exp(-altitude / scaleHeight)`
4. Rayleigh phase: `0.75 * (1 + cos²θ)`
5. Mie phase: Henyey-Greenstein (g=0.8)
6. Combine: scatter + extinction + Mie
7. Fresnel limb brightening: `pow(1 - dot(view, normal), 2)`
8. Alpha: density-based + Fresnel + camera fade

**Note**: Babylon.js auto-transpiles GLSL → WGSL when WebGPU is available.

---

### `client/src/main.ts`

**Purpose**: Application entry point — Engine, Scene, Camera, Globe, Menu, Network

**Initialization Order**:
```typescript
1. cleanup() — dispose previous engine/scene/menu/network
2. fetch('/health') — pre-warm server
3. create canvas → append to DOM
4. await requestAnimationFrame — DOM layout
5. new Engine(canvas, true, { useWebGPU: true, powerPreference: "high-performance" })
6. await engine.initWebGPUAsync?.() — try WebGPU, fallback to WebGL2
7. new Scene(engine)
8. GlobeRenderer = createGlobeRenderer(radius, level, engine)
9. Scene = GlobeRenderer.scene (already has engine)
10. ArcRotateCamera on Globe.scene
11. Menu = createMenu(callbacks) → append to DOM
12. RelayClient = new RelayClient(url, name) → connect()
13. engine.runRenderLoop(() => { camera.autoRotate, globe.updateUniforms(), scene.render() })
```

**Camera**: `ArcRotateCamera` (orbital) with limits:
- `lowerRadiusLimit = radius * 1.2`
- `upperRadiusLimit = radius * 10`
- `upperBetaLimit = PI * 0.95` (prevent polar flip)
- `autoRotate = true` for menu background

---

### `client/src/menu/menu.ts`

**Purpose**: HTML/CSS overlay UI — completely renderer-agnostic

**Structure**:
```typescript
interface MenuCallbacks {
  onSingleplayer: () => void
  onHostGame: (settings: LobbySettings) => void
  onJoinGame: (code: string) => void
  onSettings: () => void
}

interface LobbySettings { maxPlayers, public, map }

createMenu(callbacks): HTMLElement
  → Returns container with methods: .setHostCode(code), .setJoinStatus(msg, type), .show(), .hide()
```

**Panels** (CSS `hidden` class toggling):
- Main: Singleplayer, Host Game, Join Game, Settings
- Host: Settings (max players, public, map) + generated code display
- Join: 4-char code input + status
- Settings: Graphics, VSync, volumes (placeholders)

**Styling**: Injected `<style>` with CSS variables, animations, responsive design

---

### `client/src/net/relay-client.ts`

**Purpose**: WebSocket client with auto-reconnect, event callbacks

**Class**: `RelayClient`
```typescript
constructor(url: string, playerName: string)
connect(): Promise<void>
send(message: ClientMessage): void
on<K>(event: K, handler: RelayClientEvents[K]): void

// Convenience methods
createLobby(settings)
joinLobby(code)
leaveLobby()
setReady(ready)
startGame()
sendCommands(tick, commands[])
sendChat(message)
ping()
disconnect()
getState(): ConnectionState
getPlayerId(): string
```

**Events** (via `RelayClientEvents`):
- `onStateChange(state)` — disconnected/connecting/connected/reconnecting/error
- `onLobbyCreated(code)` / `onLobbyJoined(state)` / `onLobbyError(msg)`
- `onPlayerJoined(player)` / `onPlayerLeft(playerId)` / `onPlayerReady(id, ready)`
- `onHostChanged(newHostId)` / `onGameStart(snapshot, yourPlayerId)`
- `onSnapshot(tick, entities[])` / `onChat(playerId, name, msg)`
- `onError(msg)` / `onKicked(reason)`

**Reconnection**: Exponential backoff (1s × 1.5^attempt, max 10 attempts)

**Message Encoding**: Currently JSON (msgpackr ready in deps)

---

### `shared/protocol.ts`

**Purpose**: Single source of truth for all network types

**Key Types**:
```typescript
// Lobby
LobbySettings { maxPlayers, public, map }
Player { id, name, ready, color, isHost }
LobbyState { code, hostId, players[], settings, state, createdAt }

// Commands
Command { type: 'move'|'attack'|'build'|'patrol'|'stop', unitIds[], target?, targetId?, buildType?, queue? }

// World
Entity { id, type, owner, position, velocity?, rotation?, health, maxHealth, unitType?, targetId?, buildProgress?, projectileType?, damage?, expireAt? }
Snapshot { tick, timestamp, entities[] }

// Network Messages (Discriminated Unions)
ClientMessage: create_lobby | join_lobby | leave_lobby | player_ready | start_game | command | ping | chat
ServerMessage: lobby_created | lobby_joined | lobby_error | player_joined | player_left | player_ready | host_changed | game_start | snapshot | pong | chat | error | kicked

// Utilities
generateLobbyCode() → "A5J2" (alphanumeric, no I/O/0/1)
generatePlayerId() → "player_xxx"
generateEntityId() → "entity_xxx"
```

---

### `server/src/index.ts`

**Purpose**: Express + WebSocket server entry point

**Endpoints**:
- `GET /health` — Returns "ok" (pre-warm target)
- `GET /stats` — `{ lobbies, players, clients }`

**WebSocket Handler**:
```typescript
wss.on('connection', (ws, req) => {
  clientId = generateClientId()
  client = lobbyManager.addClient(clientId, ws, name)
  ws.on('message', data => handleClientMessage(clientId, JSON.parse(data), lobbyManager, broadcaster))
  ws.on('close', () => { lobbyManager.leaveLobby(clientId); notifyPlayerLeft; notifyHostChanged })
})
```

**Cleanup**: 30s interval checks for dead WS connections

---

### `server/src/lobby.ts`

**Class**: `LobbyManager`

**Core Methods**:
```typescript
createLobby(clientId, settings): LobbyState
joinLobby(clientId, code): LobbyState | null
leaveLobby(clientId): LobbyState | null
setReady(clientId, ready): LobbyState | null
startGame(clientId): LobbyState | null  // host only
getLobby(code): LobbyState | undefined
getClientLobby(clientId): LobbyState | undefined
addClient(clientId, ws, name): ConnectedClient
removeClient(clientId)
isHost(clientId): boolean
getLobbyClients(lobbyCode): ConnectedClient[]
getStats(): { lobbies, players, clients }
destroy() // cleanup interval
```

**Host Election**: On host leave, first remaining player becomes host

**Cleanup**: 5min interval removes empty lobbies or >1hr old

---

### `server/src/broadcast.ts`

**Class**: `Broadcaster`

**Methods**:
```typescript
send(client, msg): boolean
broadcast(lobby, msg, excludeClientId?): number
broadcastToClients(lobby, msg): number  // exclude host
sendToHost(lobby, msg): boolean

// Notifications
notifyLobbyCreated(client, lobby, player)
notifyLobbyJoined(client, lobby, player)
notifyPlayerJoined(lobby, newPlayer, exclude?)
notifyPlayerLeft(lobby, playerId)
notifyPlayerReady(lobby, playerId, ready)
notifyHostChanged(lobby)
notifyGameStart(lobby, initialSnapshot)
broadcastSnapshot(lobby, tick, entities[])
sendError(client, message)
kickPlayer(lobby, playerId, reason)
```

**Message Handler**: `handleClientMessage(clientId, msg, lobbyManager, broadcaster)`
- Routes each `ClientMessage` type to lobbyManager + broadcaster notifications

---

## Data Flow: Rendering

```
main.ts
  │
  ├─► Engine(canvas) ──► initWebGPUAsync() ──► WebGPU or WebGL2
  │
  ├─► Scene(engine)
  │
  ├─► createGlobeRenderer(radius, level, engine)
  │      │
  │      ├─► generateIcosphere(level) ──► IcosphereData
  │      │
  │      ├─► buildHexInstances(icosphere, radius) ──► HexInstanceData[]
  │      │
  │      ├─► Scene + Mesh + VertexData (hexagon geometry)
  │      │
  │      ├─► ShaderMaterial(ocean.glsl + ocean.fragment.glsl) ──► hexMesh.material
  │      │      └─► thinInstanceSetMatrixAt(i, Matrix) × 8K
  │      │
  │      ├─► ShaderMaterial(atmosphere.glsl + atmosphere.fragment.glsl) ──► atmosphereMesh.material
  │      │
  │      └─► Stars Mesh + Lights
  │
  ├─► ArcRotateCamera(Scene)
  │
  ├─► engine.runRenderLoop()
  │      │
  │      ├─► camera.alpha += autoRotateSpeed
  │      ├─► globe.updateUniforms(time, camera.position)
  │      └─► scene.render()
  │
  └─► Menu + RelayClient (independent)
```

---

## Data Flow: Multiplayer

```
┌─────────────┐     WebSocket      ┌─────────────┐
│   Client    │ ◄─────────────────► │   Server    │
│  (Host)     │                     │  (Relay)    │
└──────┬──────┘                     └──────┬──────┘
       │                                    │
       │ create_lobby                       │
       ├───────────────────────────────────►│
       │                                    │ LobbyManager.createLobby()
       │                                    │ Broadcaster.notifyLobbyCreated()
       │◄───────────────────────────────────┤ lobby_created { code }
       │                                    │
       │                                    │ (other clients join)
       │                                    │ join_lobby
       │                                    │ LobbyManager.joinLobby()
       │                                    │ Broadcaster.notifyLobbyJoined()
       │                                    │ Broadcaster.notifyPlayerJoined()
       │◄───────────────────────────────────┤ lobby_joined { state }
       │                                    │
       │ start_game (host only)             │
       ├───────────────────────────────────►│
       │                                    │ LobbyManager.startGame()
       │                                    │ Broadcaster.notifyGameStart()
       │◄───────────────────────────────────┤ game_start { initialSnapshot }
       │                                    │
       ▼                                    ▼
  ┌─────────────┐                    ┌─────────────┐
  │  Host Sim   │                    │   Clients   │
  │  (20Hz)     │                    │  (interp)   │
  └──────┬──────┘                    └──────┬──────┘
         │                                    │
         │ command { tick, commands[] }       │
         ├───────────────────────────────────►│
         │                                    │ (server validates host)
         │                                    │ (relays snapshot from host)
         │                                    │
         │◄───────────────────────────────────┤ snapshot { tick, entities[] }
         ▼                                    ▼
  step(commands) → Snapshot           interpolate(entities)
  broadcast(snapshot)                       render
```

---

## Build & Deploy

### Client
```bash
cd client
npm install           # @babylonjs/core, @babylonjs/loaders, msgpackr
npm run dev           # Vite dev server (localhost:5173)
npm run build         # tsc + vite build → dist/
npm run preview       # Preview production build
```

### Server
```bash
cd server
npm install           # express, ws, msgpackr, tsx, typescript
npm run dev           # tsx watch src/index.ts (localhost:3000)
npm run build         # tsc → dist/
npm start             # node dist/index.js
```

### Shared Types Sync
```bash
# Manual copy (or use npm workspace)
cp shared/protocol.ts client/src/shared/protocol.ts
cp shared/protocol.ts server/src/protocol.ts
```

---

## TypeScript Config Notes

**Client** (`tsconfig.json`):
- `target: ES2023`, `module: ESNext`, `moduleResolution: bundler`
- `noEmit: true` (Vite handles emit)
- `verbatimModuleSyntax: true`

**Server** (`tsconfig.json`):
- `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`
- `outDir: dist`, `rootDir: src`

---

## Known Limitations / TODOs

1. **Hex Picking**: No raycast → hexId implementation yet (needed for commands)
2. **Host Simulation**: Not implemented — host just receives snapshots currently
3. **Client Interpolation**: Not implemented
4. **msgpackr**: Installed but encoding still uses JSON
5. **Asset Pipeline**: No texture/model loading yet
6. **LOD**: Fixed subdivision level 6; could reduce at distance
7. **Post-Process**: No bloom/FXAA/TAA configured
8. **Mobile**: Touch controls not implemented for camera

---

*Generated: 2026-11-23. Reflects current codebase after Babylon.js migration.*