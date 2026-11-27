// Main Menu UI — HTML overlay on Three.js canvas
// Handles: Singleplayer, Multiplayer (Host/Join), Settings

import type { Player } from '../shared/protocol';
import { PLAYER_COLORS } from '../shared/protocol';

export interface MenuCallbacks {
  onSingleplayer: () => void;
  onHostGame: (settings: LobbySettings, colorIndex: number) => void;
  onHostPanelShow: () => void;
  onHostSettingsChange: (settings: Partial<LobbySettings>) => void;
  onJoinGame: (code: string, colorIndex: number) => void;
  onPlayerNameChange: (name: string) => void;
  onServerUrlChange: (url: string) => void;
  onSettings: () => void;
}

export interface LobbySettings {
  maxPlayers: number;
  public: boolean;
  map: string;
}

function getDefaultServerUrl(): string {
  if (import.meta.env.PROD) {
    return 'https://threed-front-server.onrender.com';
  }
  return 'ws://localhost:3000';
}

export function createMenu(callbacks: MenuCallbacks): HTMLElement {
  const container = document.createElement('div');
  container.id = 'main-menu';
  container.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: 'Segoe UI', system-ui, sans-serif;
    color: #e0e0e0;
    background: transparent;
    z-index: 100;
    pointer-events: auto;
  `;

  // Title row (title + name input)
  const titleRow = document.createElement('div');
  titleRow.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    max-width: 600px;
    margin: 0 0 1rem;
  `;

  const title = document.createElement('h1');
  title.textContent = '3D-FRONT';
  title.style.cssText = `
    font-size: 4rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    margin: 0;
    text-shadow: 0 0 30px rgba(100, 180, 255, 0.8),
                 0 0 60px rgba(50, 120, 255, 0.4);
    background: linear-gradient(135deg, #ffffff, #88ccff, #4488ff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: pulse 3s ease-in-out infinite;
  `;

  // Player name input (top-right)
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 8;
  nameInput.placeholder = 'Player';
  nameInput.style.cssText = `
    width: 140px;
    padding: 0.5rem 0.75rem;
    font-size: 1rem;
    font-family: 'Segoe UI', system-ui, sans-serif;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    background: rgba(10, 10, 25, 0.9);
    border: 1px solid #446;
    border-radius: 6px;
    color: #fff;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
    outline: none;
  `;

  // Load persisted name
  const savedName = localStorage.getItem('3d-front-player-name');
  if (savedName) {
    nameInput.value = savedName;
  }

  nameInput.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    const value = target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    target.value = value;
    localStorage.setItem('3d-front-player-name', value);
    callbacks.onPlayerNameChange?.(value);
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });

  titleRow.appendChild(title);
  titleRow.appendChild(nameInput);
  container.appendChild(titleRow);

  // Add keyframes
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0%, 100% { filter: brightness(1); }
      50% { filter: brightness(1.3); }
    }
    .menu-btn {
      padding: 1rem 3rem;
      font-size: 1.25rem;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      min-width: 280px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }
    .menu-btn:focus { outline: 2px solid #66aaff; outline-offset: 3px; }
    .menu-btn-primary {
      background: linear-gradient(135deg, #2a6fd4, #1a4a8c);
      color: white;
      box-shadow: 0 4px 20px rgba(42, 111, 212, 0.4);
    }
    .menu-btn-primary:hover {
      background: linear-gradient(135deg, #3a7fd4, #2a5a9c);
      transform: translateY(-2px);
      box-shadow: 0 6px 30px rgba(42, 111, 212, 0.6);
    }
    .menu-btn-secondary {
      background: rgba(30, 30, 50, 0.8);
      color: #ccc;
      border: 1px solid #446;
      backdrop-filter: blur(10px);
    }
    .menu-btn-secondary:hover {
      background: rgba(40, 40, 70, 0.9);
      border-color: #668;
    }
    .menu-btn-danger {
      background: linear-gradient(135deg, #cc3333, #992222);
      color: white;
    }
    .menu-btn-danger:hover {
      background: linear-gradient(135deg, #dd4444, #aa3333);
    }
    .menu-panel {
      background: rgba(10, 10, 25, 0.95);
      border: 1px solid #334;
      border-radius: 16px;
      padding: 2.5rem;
      min-width: 360px;
      backdrop-filter: blur(20px);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5),
                  inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }
    .input-field {
      width: 100%;
      padding: 0.875rem 1rem;
      font-size: 1.1rem;
      font-family: monospace;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.3em;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid #445;
      border-radius: 8px;
      color: #fff;
      margin-bottom: 1rem;
      box-sizing: border-box;
    }
    .input-field:focus { outline: none; border-color: #66aaff; box-shadow: 0 0 0 2px rgba(100, 170, 255, 0.2); }
    .input-field::placeholder { color: #667; }
    .setting-row { display: flex; justify-content: space-between; align-items: center; margin: 1rem 0; }
    .setting-label { font-size: 1rem; color: #bbb; }
    .setting-select, .setting-input {
      padding: 0.5rem 1rem;
      background: rgba(0,0,0,0.4);
      border: 1px solid #445;
      border-radius: 6px;
      color: #fff;
      font-size: 1rem;
    }
    .hidden { display: none !important; }
    .status-text {
      text-align: center;
      margin: 1rem 0;
      font-size: 0.95rem;
      min-height: 1.5em;
    }
    .status-connecting { color: #ffaa00; }
    .status-connected { color: #44ff44; }
    .status-error { color: #ff4444; }
  `;
  document.head.appendChild(style);

  // Main button panel
  const mainPanel = createMainPanel();
  container.appendChild(mainPanel);

  // Host game panel
  const hostPanel = createHostPanel();
  container.appendChild(hostPanel);

  // Join game panel
  const joinPanel = createJoinPanel();
  container.appendChild(joinPanel);

  // Settings panel
  const settingsPanel = createSettingsPanel();
  container.appendChild(settingsPanel);

  // Navigation functions
  function showPanel(panel: HTMLElement) {
    [mainPanel, hostPanel, joinPanel, settingsPanel].forEach(p => p.classList.add('hidden'));
    panel.classList.remove('hidden');
  }

  // Main panel buttons
  mainPanel.querySelector('#btn-singleplayer')!.addEventListener('click', () => {
    callbacks.onSingleplayer();
    container.classList.add('hidden');
  });

  mainPanel.querySelector('#btn-host')!.addEventListener('click', () => {
    showPanel(hostPanel);
    callbacks.onHostPanelShow?.();
  });
  mainPanel.querySelector('#btn-join')!.addEventListener('click', () => showPanel(joinPanel));
  mainPanel.querySelector('#btn-settings')!.addEventListener('click', () => showPanel(settingsPanel));

  // Host panel
  const hostCodeEl = hostPanel.querySelector('#host-code') as HTMLInputElement;
  const hostStatusEl = hostPanel.querySelector('#host-status') as HTMLElement;
  const hostPlayerListEl = hostPanel.querySelector('#host-player-list') as HTMLElement;
  const hostMaxPlayersEl = hostPanel.querySelector('#host-maxplayers') as HTMLSelectElement;
  const hostPublicEl = hostPanel.querySelector('#host-public') as HTMLInputElement;
  const hostMapEl = hostPanel.querySelector('#host-map') as HTMLSelectElement;

  // Settings change handlers
  const emitSettingsChange = () => {
    const settings: Partial<LobbySettings> = {
      maxPlayers: parseInt(hostMaxPlayersEl.value),
      public: hostPublicEl.checked,
      map: hostMapEl.value
    };
    callbacks.onHostSettingsChange?.(settings);
  };
  hostMaxPlayersEl.addEventListener('change', emitSettingsChange);
  hostPublicEl.addEventListener('change', emitSettingsChange);
  hostMapEl.addEventListener('change', emitSettingsChange);

  hostPanel.querySelector('#btn-start-host')!.addEventListener('click', () => {
    const settings: LobbySettings = {
      maxPlayers: parseInt(hostMaxPlayersEl.value),
      public: hostPublicEl.checked,
      map: hostMapEl.value
    };
    const colorIndex = (hostPanel as any).selectedColorIndex ?? 0;
    hostStatusEl.textContent = 'Starting game...';
    hostStatusEl.className = 'status-text status-connecting';
    callbacks.onHostGame(settings, colorIndex);
  });
  hostPanel.querySelector('#btn-back-from-host')!.addEventListener('click', () => showPanel(mainPanel));

  // Expose method to update player list (handles duplicate names with [2], [3], etc.)
  const renderPlayerList = (playerListEl: HTMLElement, players: Player[]) => {
    if (players.length === 0) {
      playerListEl.innerHTML = '<div style="color: #666;">Waiting for players...</div>';
    } else {
      const seenNames = new Map<string, number>();
      
      playerListEl.innerHTML = players.map(p => {
        const count = (seenNames.get(p.name) || 0) + 1;
        seenNames.set(p.name, count);
        const displayName = count > 1 ? `${p.name} [${count}]` : p.name;
        
        return `<div style="display: flex; align-items: center; gap: 0.5rem; margin: 0.25rem 0; color: ${p.isHost ? '#4f4' : '#fff'};">
          <span style="width: 12px; height: 12px; border-radius: 50%; background: #${p.color.toString(16).padStart(6, '0')}"></span>
          ${displayName}${p.isHost ? ' (Host)' : ''}${p.ready ? ' ✓' : ''}
        </div>`;
      }).join('');
    }
  };

  (container as any).setHostPlayerList = (players: Player[]) => {
    renderPlayerList(hostPlayerListEl, players);
  };

  (container as any).setJoinPlayerList = (players: Player[]) => {
    renderPlayerList(joinPlayerListEl, players);
  };

  // Join panel
  const joinCodeEl = joinPanel.querySelector('#join-code') as HTMLInputElement;
  const joinStatusEl = joinPanel.querySelector('#join-status') as HTMLElement;
  const joinPlayerListEl = joinPanel.querySelector('#join-player-list') as HTMLElement;
  joinPanel.querySelector('#btn-join-game')!.addEventListener('click', () => {
    const code = joinCodeEl.value.trim().toUpperCase();
    if (code.length !== 4) {
      joinStatusEl.textContent = 'Enter a 4-letter code';
      joinStatusEl.className = 'status-text status-error';
      return;
    }
    const colorIndex = (joinPanel as any).selectedColorIndex ?? 0;
    joinStatusEl.textContent = 'Joining...';
    joinStatusEl.className = 'status-text status-connecting';
    callbacks.onJoinGame(code, colorIndex);
  });
  joinPanel.querySelector('#btn-back-from-join')!.addEventListener('click', () => showPanel(mainPanel));

  // Auto-format join code input
  joinCodeEl.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    target.value = target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });

  // Settings panel
  settingsPanel.querySelector('#btn-back-from-settings')!.addEventListener('click', () => showPanel(mainPanel));

  // Server URL input
  const serverUrlEl = settingsPanel.querySelector('#settings-server-url') as HTMLInputElement;
  const savedUrl = localStorage.getItem('3d-front-server-url');
  if (savedUrl) serverUrlEl.value = savedUrl;
  serverUrlEl.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    const value = target.value.trim();
    if (value) {
      localStorage.setItem('3d-front-server-url', value);
    } else {
      localStorage.removeItem('3d-front-server-url');
    }
    callbacks.onServerUrlChange?.(value || getDefaultServerUrl());
  });

  // Expose methods for external updates
  (container as any).setHostCode = (code: string) => {
    hostCodeEl.value = code;
    hostStatusEl.textContent = `Lobby created: ${code}`;
    hostStatusEl.className = 'status-text status-connected';
  };

  (container as any).setJoinStatus = (status: string, type: 'connecting' | 'connected' | 'error') => {
    joinStatusEl.textContent = status;
    joinStatusEl.className = `status-text status-${type}`;
  };

  (container as any).show = () => container.classList.remove('hidden');
  (container as any).hide = () => container.classList.add('hidden');

  return container;
}

function createPanel(id: string): HTMLElement {
  const panel = document.createElement('div');
  panel.id = `menu-${id}`;
  panel.className = 'menu-panel';
  return panel;
}

function createMainPanel(): HTMLElement {
  const panel = createPanel('main');
  panel.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <button id="btn-singleplayer" class="menu-btn menu-btn-primary">Singleplayer</button>
      <button id="btn-host" class="menu-btn menu-btn-primary">Host Game</button>
      <button id="btn-join" class="menu-btn menu-btn-secondary">Join Game</button>
      <button id="btn-settings" class="menu-btn menu-btn-secondary">Settings</button>
    </div>
  `;
  return panel;
}

function createHostPanel(): HTMLElement {
  const panel = createPanel('host');
  panel.classList.add('hidden');
  
  // Build color picker HTML
  const colorPickerHtml = PLAYER_COLORS.map((color, index) => {
    const hex = '#' + color.toString(16).padStart(6, '0');
    return `<button type="button" class="color-swatch${index === 0 ? ' selected' : ''}" data-index="${index}" style="background: ${hex};" title="Color ${index + 1}"></button>`;
  }).join('');

  panel.innerHTML = `
    <h2 style="margin: 0 0 1.5rem; font-size: 1.5rem;">Host Game</h2>
    <div class="setting-row">
      <span class="setting-label">Lobby Code</span>
      <input id="host-code" class="input-field" value="----" readonly style="font-size: 1.5rem; letter-spacing: 0.5em;">
    </div>
    <div class="setting-row">
      <span class="setting-label">Max Players</span>
      <select id="host-maxplayers" class="setting-select">
        <option value="2">2</option>
        <option value="4">4</option>
        <option value="6">6</option>
        <option value="8">8</option>
        <option value="10">10</option>
        <option value="12" selected>12</option>
      </select>
    </div>
    <div class="setting-row">
      <span class="setting-label">Public Lobby</span>
      <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
        <input id="host-public" type="checkbox" checked>
        <span style="font-size: 0.9rem;">List in lobby browser (future)</span>
      </label>
    </div>
    <div class="setting-row">
      <span class="setting-label">Map</span>
      <select id="host-map" class="setting-select">
        <option value="earth">Earth</option>
        <option value="mars">Mars</option>
        <option value="custom">Custom</option>
      </select>
    </div>
    <div class="setting-row">
      <span class="setting-label">Your Color</span>
      <div class="color-picker-grid" id="host-color-picker">${colorPickerHtml}</div>
    </div>
    <div style="margin: 1rem 0;">
      <div style="font-size: 0.9rem; color: #888; margin-bottom: 0.5rem;">Players in Lobby</div>
      <div id="host-player-list" style="min-height: 60px; background: rgba(0,0,0,0.3); border: 1px solid #334; border-radius: 8px; padding: 0.75rem; font-family: monospace; font-size: 0.9rem;">
        <div style="color: #666;">Waiting for players...</div>
      </div>
    </div>
    <div id="host-status" class="status-text"></div>
    <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
      <button id="btn-start-host" class="menu-btn menu-btn-primary" style="flex: 1;">Start Game</button>
      <button id="btn-back-from-host" class="menu-btn menu-btn-secondary" style="flex: 1;">Back</button>
    </div>
  `;

  // Add color picker styles
  const style = document.createElement('style');
  style.textContent = `
    .color-picker-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .color-swatch {
      aspect-ratio: 1;
      border-radius: 8px;
      border: 2px solid transparent;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .color-swatch:hover {
      transform: scale(1.1);
      border-color: rgba(255, 255, 255, 0.5);
    }
    .color-swatch.selected {
      border-color: #00ffff;
      box-shadow: 0 0 12px rgba(0, 255, 255, 0.6);
    }
  `;
  document.head.appendChild(style);

  // Color picker event listeners
  const colorPicker = panel.querySelector('#host-color-picker')!;
  colorPicker.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('color-swatch')) {
      const index = parseInt(target.dataset.index || '0', 10);
      colorPicker.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
      target.classList.add('selected');
      // Store selected color index
      (panel as any).selectedColorIndex = index;
    }
  });

  // Default selected color index
  (panel as any).selectedColorIndex = 0;

  return panel;
}

function createJoinPanel(): HTMLElement {
  const panel = createPanel('join');
  panel.classList.add('hidden');
  
  // Build color picker HTML
  const colorPickerHtml = PLAYER_COLORS.map((color, index) => {
    const hex = '#' + color.toString(16).padStart(6, '0');
    return `<button type="button" class="color-swatch${index === 0 ? ' selected' : ''}" data-index="${index}" style="background: ${hex};" title="Color ${index + 1}"></button>`;
  }).join('');

  panel.innerHTML = `
    <h2 style="margin: 0 0 1.5rem; font-size: 1.5rem;">Join Game</h2>
    <input id="join-code" class="input-field" placeholder="A5J2" maxlength="4" style="font-size: 2rem; letter-spacing: 0.8em;">
    <div class="setting-row">
      <span class="setting-label">Your Color</span>
      <div class="color-picker-grid" id="join-color-picker">${colorPickerHtml}</div>
    </div>
    <div style="margin: 1rem 0;">
      <div style="font-size: 0.9rem; color: #888; margin-bottom: 0.5rem;">Players in Lobby</div>
      <div id="join-player-list" style="min-height: 60px; background: rgba(0,0,0,0.3); border: 1px solid #334; border-radius: 8px; padding: 0.75rem; font-family: monospace; font-size: 0.9rem;">
        <div style="color: #666;">Waiting for players...</div>
      </div>
    </div>
    <div id="join-status" class="status-text"></div>
    <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
      <button id="btn-join-game" class="menu-btn menu-btn-primary" style="flex: 1;">Join</button>
      <button id="btn-back-from-join" class="menu-btn menu-btn-secondary" style="flex: 1;">Back</button>
    </div>
  `;

  // Color picker event listeners
  const colorPicker = panel.querySelector('#join-color-picker')!;
  colorPicker.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('color-swatch')) {
      const index = parseInt(target.dataset.index || '0', 10);
      colorPicker.querySelectorAll('.color-swatch').forEach(el => el.classList.remove('selected'));
      target.classList.add('selected');
      (panel as any).selectedColorIndex = index;
    }
  });

  (panel as any).selectedColorIndex = 0;

  return panel;
}

function createSettingsPanel(): HTMLElement {
  const panel = createPanel('settings');
  panel.classList.add('hidden');
  panel.innerHTML = `
    <h2 style="margin: 0 0 1.5rem; font-size: 1.5rem;">Settings</h2>

    <div class="setting-row">
      <span class="setting-label">Server URL</span>
      <input id="settings-server-url" class="setting-input" placeholder="ws://localhost:3000" style="font-family: monospace; font-size: 0.85rem; letter-spacing: 0;">
    </div>
    <div style="color: #666; font-size: 0.8rem; margin-bottom: 1rem;">
      Leave empty for default (localhost in dev, render.com in prod)
    </div>

    <button id="btn-back-from-settings" class="menu-btn menu-btn-secondary">Back</button>
  `;
  return panel;
}