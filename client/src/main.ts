// 3D-Front Main Entry Point
// Initializes Babylon.js globe, menu, network, and game module

import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3
} from '@babylonjs/core';
import { createGlobeRenderer, type GlobeRenderer } from './globe/renderer';
import { createMenu, type MenuCallbacks, type LobbySettings } from './menu/menu';
import { ConnectionManager, type ConnectionTarget } from './net/connection-manager';
import { createGameModule, type GameModule } from './game';
import { LocalGameClient } from './game/local-game';
import type { Player, WorldMapData } from './shared/protocol';
import { PLAYER_COLORS } from './shared/protocol';

const GLOBE_RADIUS = 100;

// Global state
let engine: Engine | null = null;
let scene: Scene | null = null;
let camera: ArcRotateCamera | null = null;
let globe: GlobeRenderer | null = null;
let menu: HTMLElement | null = null;
let connectionManager: ConnectionManager | null = null;
let gameModule: GameModule | null = null;
let preCreatedLobby = false;
let worldMapData: WorldMapData | null = null;

// Cleanup function
function cleanup() {
  if (gameModule) {
    gameModule.dispose();
    gameModule = null;
  }
  if (engine) {
    engine.dispose();
    engine = null;
  }
  if (scene) {
    scene.dispose();
    scene = null;
  }
  camera = null;
  if (globe) {
    globe.dispose();
    globe = null;
  }
  if (menu) {
    menu.remove();
    menu = null;
  }
  if (connectionManager) {
    connectionManager.disconnect();
    connectionManager = null;
  }
  window.removeEventListener('resize', onResize);
  const oldCanvas = document.querySelector('canvas');
  if (oldCanvas) oldCanvas.remove();
}

async function init() {
  cleanup();

  // Create main canvas (attached to DOM)
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 1;';
  document.body.appendChild(canvas);

  // Set explicit dimensions (required by some drivers)
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Wait one frame for canvas to be properly laid out in DOM
  await new Promise(resolve => requestAnimationFrame(resolve));

  // Babylon.js Engine: WebGPU first, auto-fallback to WebGL2
  engine = new Engine(canvas, true, {
    antialias: true,
    adaptToDeviceRatio: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
    stencil: false,
    disableWebGL2Support: false,
    audioEngine: false,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });

  // Try to initialize WebGPU (non-blocking)
  try {
    await (engine as any).initWebGPUAsync?.();
  } catch {
    console.log('[Babylon] WebGPU not available, using WebGL2');
  }
  const isWebGPU = (engine.getCaps() as any).isWebGPU;
  console.log(`[Babylon] ✓ Engine created: ${isWebGPU ? 'WebGPU' : 'WebGL2'}`);

  // Create globe renderer with engine (creates its own scene) — async for baked data
  globe = await createGlobeRenderer(GLOBE_RADIUS, engine!);

  // Use globe's scene as main scene (already has engine attached)
  scene = globe.scene;

  // Load world map data for game module
  try {
    const response = await fetch('/world-map.json');
    if (response.ok) {
      worldMapData = await response.json() as WorldMapData;
      console.log('[Main] World map data loaded:', worldMapData.meta.hexCount, 'hexes');
    }
  } catch (e) {
    console.warn('[Main] Failed to load world-map.json:', e);
  }

  // Camera: ArcRotateCamera for globe viewing
  camera = new ArcRotateCamera("camera", 0, Math.PI / 2, GLOBE_RADIUS * 3, Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = GLOBE_RADIUS * 1.2;
  camera.upperRadiusLimit = GLOBE_RADIUS * 10;
  camera.upperBetaLimit = Math.PI * 0.95;
  camera.lowerBetaLimit = Math.PI * 0.05;
  camera.wheelPrecision = 50;
  camera.pinchPrecision = 50;
  camera.maxZ = GLOBE_RADIUS * 200;

  // Enable auto-rotation for menu background
  (camera as any).autoRotate = true;

  // Menu
  // Load saved player name or generate random
  const savedName = localStorage.getItem('3d-front-player-name');
  const initialPlayerName = savedName || `Player_${Math.random().toString(36).slice(2, 6)}`;

  const menuCallbacks: MenuCallbacks = {
    onSingleplayer: () => startSingleplayer(),
    onHostPanelShow: () => createLobbyIfNeeded(),
    onHostSettingsChange: (settings) => updateLobbySettings(settings),
    onHostGame: (settings, colorIndex) => startGame(settings, colorIndex),
    onJoinGame: (code, colorIndex) => joinGame(code, colorIndex),
    onPlayerNameChange: (name) => connectionManager?.setPlayerName(name),
    onServerUrlChange: (url) => {
      console.log('[Main] Server URL changed to:', url);
      connectionManager?.reconnect(url);
    },
    onSettings: () => {}
  };
  menu = createMenu(menuCallbacks);
  document.body.appendChild(menu);

  // Network - use ConnectionManager for local-first with fallback
  connectionManager = new ConnectionManager(initialPlayerName);
  setupConnectionEvents();

  window.addEventListener('resize', onResize);

  let renderTime = 0;

  // Render loop
  engine.runRenderLoop(() => {
    if (!scene || !globe || !camera || !engine) return;

    renderTime += engine.getDeltaTime() / 1000;

    // Auto-rotate camera (simulate OrbitControls.autoRotate)
    if ((camera as any).autoRotate) {
      camera.alpha += 0.0002 * (engine.getDeltaTime() / 16.666); // 0.2 speed scaled by frame time
    }

    // Update shader uniforms
    globe.updateUniforms(camera.position, renderTime);

    // Update globe ownership visuals
    gameModule?.updateGlobeOwnership();

    scene.render();

    // Check for WebGL errors (helps diagnose "Insufficient buffer size" issues)
    const gl = engine._gl;
    if (gl) {
      let err;
      while ((err = gl.getError()) !== gl.NO_ERROR) {
        console.error('[WebGL Error]', err, getGLErrorString(err));
      }
    }
  });

  // Pre-warm server (non-blocking) - use connection manager's current URL
  connectionManager.on('onTargetChange', (_target: ConnectionTarget, url: string) => {
    const httpUrl = url.replace('ws:', 'http:').replace('wss:', 'https:');
    fetch(`${httpUrl}/health`).catch(() => {});
  });

  // Initial pre-warm attempt
  const initialUrl = connectionManager.getCurrentUrl();
  if (initialUrl) {
    const httpUrl = initialUrl.replace('ws:', 'http:').replace('wss:', 'https:');
    fetch(`${httpUrl}/health`).catch(() => {});
  }

  // Connect with fallback logic
  await connectionManager.connect().catch(err => console.warn('[ConnectionManager] Connect failed:', err));

  function getGLErrorString(err: number): string {
    switch (err) {
      case 0x0500: return 'INVALID_ENUM';
      case 0x0501: return 'INVALID_VALUE';
      case 0x0502: return 'INVALID_OPERATION';
      case 0x0503: return 'STACK_OVERFLOW';
      case 0x0504: return 'STACK_UNDERFLOW';
      case 0x0505: return 'OUT_OF_MEMORY';
      case 0x0506: return 'INVALID_FRAMEBUFFER_OPERATION';
      case 0x0507: return 'CONTEXT_LOST_WEBGL';
      default: return `UNKNOWN (0x${err.toString(16)})`;
    }
  }

  console.log('3D-Front initialized (Babylon.js)');

  // Dev-only debug hook for automated visual checks.
  if (import.meta.env.DEV) {
    (window as any).__globe = {
      get camera() { return camera; },
      get globe() { return globe; },
      setView(alpha: number, beta: number) {
        if (!camera) return;
        (camera as any).autoRotate = false;
        camera.alpha = alpha;
        camera.beta = beta;
      },
    };
  }
}

function setupConnectionEvents() {
  if (!connectionManager) return;

  // Connection target changes (local -> remote fallback)
  connectionManager.on('onTargetChange', (target: ConnectionTarget, url: string) => {
    console.log('[ConnectionManager] Active target:', target, url);
    const statusMap: Record<ConnectionTarget, string> = {
      local: 'Connecting to local server...',
      remote: 'Local unavailable, connecting to remote...',
      manual: 'Connecting to custom server...'
    };
    if (menu) {
      (menu as any).setJoinStatus(statusMap[target] || 'Connecting...', 'connecting');
    }
  });

  connectionManager.on('onFallbackAttempt', (from: ConnectionTarget, to: ConnectionTarget) => {
    console.log('[ConnectionManager] Fallback:', from, '->', to);
    if (menu) {
      const msg = to === 'remote' ? 'Local server not found, trying remote...' : 'Trying next server...';
      (menu as any).setJoinStatus(msg, 'connecting');
    }
  });

  connectionManager.on('onFallbackFailed', (_target: ConnectionTarget) => {
    console.log('[ConnectionManager] All fallbacks failed');
    if (menu) {
      (menu as any).setJoinStatus('Connection failed. Open Settings to configure server URL.', 'error');
    }
  });

  // Forward all relay events
  connectionManager.on('onStateChange', (state: string) => console.log('[Relay] State:', state));
  connectionManager.on('onLobbyCreated', (code: string, _playerId: string, player: Player) => {
    preCreatedLobby = true;
    menu && (menu as any).setHostCode(code);
    menu && (menu as any).setHostPlayerList([player]);
    if (menu) (menu as any).setJoinStatus(`Lobby created: ${code}`, 'connected');
  });
  connectionManager.on('onLobbyUpdated', (settings: LobbySettings) => {
    console.log('[Relay] Lobby settings updated:', settings);
  });
  connectionManager.on('onLobbyPlayersUpdated', (players: Player[]) => {
    console.log('[Relay] Lobby players updated:', players.map(p => p.name));
    menu && (menu as any).setHostPlayerList(players);
    menu && (menu as any).setJoinPlayerList(players);
  });
  connectionManager.on('onLobbyJoined', (state: any, _playerId: string, _player: any) => {
    if (!menu) return;
    const menuEl = menu;
    // Switch to host panel (read-only view for joined player) showing lobby info
    (menuEl as any).setHostCode(state.code);
    (menuEl as any).setHostPlayerList(state.players);
    // Update host panel settings to reflect lobby settings (read-only)
    const hostPanelEl = menuEl.querySelector('#menu-host') as HTMLElement;
    if (hostPanelEl) {
      const maxPlayersEl = hostPanelEl.querySelector('#host-maxplayers') as HTMLSelectElement;
      const publicEl = hostPanelEl.querySelector('#host-public') as HTMLInputElement;
      const mapEl = hostPanelEl.querySelector('#host-map') as HTMLSelectElement;
      if (maxPlayersEl) maxPlayersEl.value = String(state.settings.maxPlayers);
      if (publicEl) publicEl.checked = state.settings.public;
      if (mapEl) mapEl.value = state.settings.map;
      // Disable settings for non-host
      maxPlayersEl?.setAttribute('disabled', 'true');
      publicEl?.setAttribute('disabled', 'true');
      mapEl?.setAttribute('disabled', 'true');
    }
    // Hide start game button for non-host, show leave button instead
    const startBtn = menuEl.querySelector('#btn-start-host') as HTMLButtonElement;
    const backBtn = menuEl.querySelector('#btn-back-from-host') as HTMLButtonElement;
    if (startBtn) {
      startBtn.textContent = 'Leave Lobby';
      startBtn.className = 'menu-btn menu-btn-danger';
      startBtn.style.flex = '1';
      startBtn.onclick = () => {
        connectionManager?.leaveLobby();
        (menuEl as any).setJoinStatus('', 'connecting');
        // Show join panel again
        const joinPanel = menuEl.querySelector('#menu-join') as HTMLElement;
        const hostPanel = menuEl.querySelector('#menu-host') as HTMLElement;
        if (joinPanel && hostPanel) {
          hostPanel.classList.add('hidden');
          joinPanel.classList.remove('hidden');
        }
        // Re-enable join button
        const joinGameBtn = menuEl.querySelector('#btn-join-game') as HTMLButtonElement;
        if (joinGameBtn) {
          joinGameBtn.disabled = false;
          joinGameBtn.textContent = 'Join';
        }
      };
    }
    if (backBtn) backBtn.style.display = 'none';
    // Show host panel (which now acts as lobby view)
    const joinPanelEl = menuEl.querySelector('#menu-join') as HTMLElement;
    if (joinPanelEl) joinPanelEl.classList.add('hidden');
    if (hostPanelEl) hostPanelEl.classList.remove('hidden');
    if (menu) (menu as any).setJoinStatus(`Joined lobby: ${state.code}`, 'connected');
  });
  connectionManager.on('onLobbyError', (msg: string) => {
    if (!menu) return;
    const menuEl = menu;
    (menuEl as any).setJoinStatus(msg, 'error');
    // Ensure join panel is visible on error
    const joinPanel = menuEl.querySelector('#menu-join') as HTMLElement;
    const hostPanel = menuEl.querySelector('#menu-host') as HTMLElement;
    if (joinPanel) joinPanel.classList.remove('hidden');
    if (hostPanel) hostPanel.classList.add('hidden');
    // Re-enable join button
    const joinGameBtn = menuEl.querySelector('#btn-join-game') as HTMLButtonElement;
    if (joinGameBtn) {
      joinGameBtn.disabled = false;
      joinGameBtn.textContent = 'Join';
    }
  });
  connectionManager.on('onPlayerJoined', (player: Player) => {
    console.log('[Relay] Player joined:', player.name);
  });
  connectionManager.on('onPlayerLeft', (playerId: string) => {
    console.log('[Relay] Player left:', playerId);
  });
  connectionManager.on('onHostChanged', (newHostId: string) => {
    console.log('[Relay] Host changed to:', newHostId);
    // If we became the new host, enable start game button
    if (connectionManager?.getPlayerId() === newHostId && menu) {
      const menuEl = menu;
      const startBtn = menuEl.querySelector('#btn-start-host') as HTMLButtonElement;
      const backBtn = menuEl.querySelector('#btn-back-from-host') as HTMLButtonElement;
      const hostPanel = menuEl.querySelector('#menu-host') as HTMLElement;
      if (startBtn) {
        startBtn.textContent = 'Start Game';
        startBtn.className = 'menu-btn menu-btn-primary';
        startBtn.onclick = null; // Will use the menu's built-in handler
      }
      if (backBtn) backBtn.style.display = '';
      // Re-enable settings for new host
      if (hostPanel) {
        const maxPlayersEl = hostPanel.querySelector('#host-maxplayers') as HTMLSelectElement;
        const publicEl = hostPanel.querySelector('#host-public') as HTMLInputElement;
        const mapEl = hostPanel.querySelector('#host-map') as HTMLSelectElement;
        maxPlayersEl?.removeAttribute('disabled');
        publicEl?.removeAttribute('disabled');
        mapEl?.removeAttribute('disabled');
      }
    }
  });
  connectionManager.on('onKicked', (reason: string) => {
    console.log('[Relay] Kicked:', reason);
    if (!menu) return;
    const menuEl = menu;
    (menuEl as any).setJoinStatus(`Kicked: ${reason}`, 'error');
    // Show join panel again
    const joinPanel = menuEl.querySelector('#menu-join') as HTMLElement;
    const hostPanel = menuEl.querySelector('#menu-host') as HTMLElement;
    if (joinPanel) joinPanel.classList.remove('hidden');
    if (hostPanel) hostPanel.classList.add('hidden');
    const joinGameBtn = menuEl.querySelector('#btn-join-game') as HTMLButtonElement;
    if (joinGameBtn) {
      joinGameBtn.disabled = false;
      joinGameBtn.textContent = 'Join';
    }
  });
  connectionManager.on('onGameStart', (snap: any, id: string) => enterGameScene(snap, id));
  connectionManager.on('onSnapshot', () => {});
  connectionManager.on('onError', (msg: string) => console.error('[Relay] Error:', msg));
}

// Stop the menu's idle globe rotation once a game is running
function stopGlobeRotation() {
  if (camera) (camera as any).autoRotate = false;
}

function startSingleplayer() {
  stopGlobeRotation();
  if (menu) menu.classList.add('hidden');

  if (!worldMapData || !globe || !camera || !engine) {
    console.error('[Main] Cannot start singleplayer: globe not ready');
    return;
  }

  const colorIndex = Math.floor(Math.random() * PLAYER_COLORS.length);
  const local = new LocalGameClient(worldMapData, colorIndex);

  void createGameModule({
    session: local,
    globeRenderer: globe,
    worldMap: worldMapData,
    camera,
    canvas: engine.getRenderingCanvas()!,
    localPlayerId: local.getPlayerId(),
    playerName: 'Commander',
  }).then((module) => {
    gameModule = module;
    // Start the 5s countdown only after GameModule has registered its listeners.
    local.begin();
    console.log('[Main] Singleplayer started');
  }).catch((err) => {
    console.error('[Main] Failed to start singleplayer:', err);
  });
}

// Create lobby with default settings when host panel opens
function createLobbyIfNeeded() {
  if (preCreatedLobby) return; // Already created
  const defaultSettings: LobbySettings = {
    maxPlayers: 12,
    public: true,
    map: 'earth'
  };
  // Get selected color index from host panel
  const hostPanel = menu?.querySelector('#menu-host') as HTMLElement;
  const colorIndex = (hostPanel as any)?.selectedColorIndex ?? 0;
  connectionManager?.createLobby(defaultSettings, colorIndex);
}

// Update lobby settings when host changes them in the panel
function updateLobbySettings(settings: Partial<LobbySettings>) {
  if (!preCreatedLobby) return;
  connectionManager?.updateLobby(settings);
}

// Start the game (send start_game, not create_lobby)
function startGame(settings: LobbySettings, colorIndex: number) {
  // If settings changed, update lobby first
  if (preCreatedLobby) {
    connectionManager?.updateLobby(settings);
  } else {
    connectionManager?.createLobby(settings, colorIndex);
  }
  // Small delay to ensure settings are applied, then start
  setTimeout(() => {
    connectionManager?.startGame();
  }, 100);
}

function joinGame(code: string, colorIndex: number) { connectionManager?.joinLobby(code, colorIndex); }

async function enterGameScene(_snap: any, playerId: string) {
  stopGlobeRotation();
  if (menu) menu.classList.add('hidden');
  console.log('[Main] Game started for player:', playerId);

  // Initialize game module
  if (!worldMapData || !globe || !camera || !connectionManager) {
    console.error('[Main] Missing dependencies for game module');
    return;
  }

  gameModule = await createGameModule({
    session: connectionManager.getRelayClient()!,
    globeRenderer: globe,
    worldMap: worldMapData,
    camera: camera,
    canvas: engine!.getRenderingCanvas()!,
    localPlayerId: playerId,
    playerName: localStorage.getItem('3d-front-player-name') || 'Player'
  });
}

function onResize() {
  if (!engine) return;
  engine.resize();
}

window.addEventListener('beforeunload', cleanup);
if (import.meta.hot) import.meta.hot.dispose(cleanup);

init();