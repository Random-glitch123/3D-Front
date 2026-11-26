// 3D-Front Main Entry Point
// Initializes Babylon.js globe, menu, and network

import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3
} from '@babylonjs/core';
import { createGlobeRenderer, type GlobeRenderer } from './globe/renderer';
import { createMenu, type MenuCallbacks, type LobbySettings } from './menu/menu';
import { RelayClient, type ConnectionState } from './net/relay-client';
import type { Player } from './shared/protocol';

// Configuration
// Default to localhost for dev, allow override via localStorage or env
const getServerUrl = (): string => {
  // Check localStorage for manual override
  const override = localStorage.getItem('3d-front-server-url');
  if (override) return override;

  // In production build, try render.com first but allow fallback
  if (import.meta.env.PROD) {
    return 'https://3d-front-server.onrender.com';
  }

  // Dev mode: default to localhost
  return 'ws://localhost:3000';
};

const SERVER_URL = getServerUrl();

const GLOBE_RADIUS = 100;

// Global state
let engine: Engine | null = null;
let scene: Scene | null = null;
let camera: ArcRotateCamera | null = null;
let globe: GlobeRenderer | null = null;
let menu: HTMLElement | null = null;
let relayClient: RelayClient | null = null;
let preCreatedLobby = false;

// Cleanup function
function cleanup() {
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
  if (relayClient) {
    relayClient.disconnect();
    relayClient = null;
  }
  window.removeEventListener('resize', onResize);
  const oldCanvas = document.querySelector('canvas');
  if (oldCanvas) oldCanvas.remove();
}

async function init() {
  cleanup();

  // Pre-warm server (non-blocking)
  fetch(`${SERVER_URL.replace('ws:', 'http:').replace('wss:', 'https:')}/health`).catch(() => {});

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
  // Single config - let Babylon.js handle fallback internally
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
    onHostGame: (settings) => startGame(settings),
    onJoinGame: (code) => joinGame(code),
    onPlayerNameChange: (name) => relayClient?.setPlayerName(name),
    onServerUrlChange: (url) => {
      console.log('[Main] Server URL changed to:', url);
      if (relayClient) {
        relayClient.disconnect();
      }
      relayClient = new RelayClient(url, initialPlayerName);
      setupRelayEvents();
    },
    onSettings: () => {}
  };
  menu = createMenu(menuCallbacks);
  document.body.appendChild(menu);

  // Network
  relayClient = new RelayClient(SERVER_URL, initialPlayerName);
  setupRelayEvents();

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

function setupRelayEvents() {
  if (!relayClient) return;
  relayClient.on('onStateChange', (state: ConnectionState) => console.log('[Relay] State:', state));
  relayClient.on('onLobbyCreated', (code: string, _playerId: string, player: Player) => {
    preCreatedLobby = true;
    menu && (menu as any).setHostCode(code);
    menu && (menu as any).setHostPlayerList([player]);
  });
  relayClient.on('onLobbyUpdated', (settings: LobbySettings) => {
    console.log('[Relay] Lobby settings updated:', settings);
  });
  relayClient.on('onLobbyPlayersUpdated', (players: Player[]) => {
    console.log('[Relay] Lobby players updated:', players.map(p => p.name));
    menu && (menu as any).setHostPlayerList(players);
    menu && (menu as any).setJoinPlayerList(players);
  });
  relayClient.on('onLobbyJoined', (state: any, _playerId: string, _player: any) => {
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
        relayClient?.leaveLobby();
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
  });
  relayClient.on('onLobbyError', (msg: string) => {
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
  relayClient.on('onPlayerJoined', (player: Player) => {
    console.log('[Relay] Player joined:', player.name);
    // Update player list in host panel
    if (menu) {
      // We need to get the full player list from lobby state
      // For now, just log - the host will get lobby_joined with full state
    }
  });
  relayClient.on('onPlayerLeft', (playerId: string) => {
    console.log('[Relay] Player left:', playerId);
  });
  relayClient.on('onHostChanged', (newHostId: string) => {
    console.log('[Relay] Host changed to:', newHostId);
    // If we became the new host, enable start game button
    if (relayClient?.getPlayerId() === newHostId && menu) {
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
  relayClient.on('onKicked', (reason: string) => {
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
  relayClient.on('onGameStart', (snap: any, id: string) => enterGameScene(snap, id));
  relayClient.on('onSnapshot', () => {});
  relayClient.on('onError', (msg: string) => console.error('[Relay] Error:', msg));
  relayClient.connect().catch(err => console.warn('[Relay] Connect failed:', err));
}

// Stop the menu's idle globe rotation once a game is running
function stopGlobeRotation() {
  if (camera) (camera as any).autoRotate = false;
}

function startSingleplayer() {
  stopGlobeRotation();
  if (menu) menu.classList.add('hidden');
}

// Create lobby with default settings when host panel opens
function createLobbyIfNeeded() {
  if (preCreatedLobby) return; // Already created
  const defaultSettings: LobbySettings = {
    maxPlayers: 12,
    public: true,
    map: 'earth'
  };
  relayClient?.createLobby(defaultSettings);
}

// Update lobby settings when host changes them in the panel
function updateLobbySettings(settings: Partial<LobbySettings>) {
  if (!preCreatedLobby) return;
  relayClient?.updateLobby(settings);
}

// Start the game (send start_game, not create_lobby)
function startGame(settings: LobbySettings) {
  // If settings changed, update lobby first
  if (preCreatedLobby) {
    relayClient?.updateLobby(settings);
  } else {
    relayClient?.createLobby(settings);
  }
  // Small delay to ensure settings are applied, then start
  setTimeout(() => {
    relayClient?.startGame();
  }, 100);
}

function joinGame(code: string) { relayClient?.joinLobby(code); }
function enterGameScene(_snap: any, id: string) {
  stopGlobeRotation();
  if (menu) menu.classList.add('hidden');
  console.log('Game start', id);
}

function onResize() {
  if (!engine) return;
  engine.resize();
}

window.addEventListener('beforeunload', cleanup);
if (import.meta.hot) import.meta.hot.dispose(cleanup);

init();