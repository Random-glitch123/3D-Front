// Relay Server Entry Point
// Express + WebSocket server for multiplayer lobby and game relay

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LobbyManager, ConnectedClient } from './lobby';
import { Broadcaster } from './broadcast';
import { ClientMessage, ServerMessage, WorldMapData, LobbyState, GameState, isHexOwnable } from './shared/protocol';
import { createGameStateManager } from './game/game-state';
import { createTickLoop } from './game/tick-loop';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Load world map data for server-side calculations
let worldMapData: WorldMapData | null = null;
try {
  const mapPath = join(__dirname, '../../client/public/world-map.json');
  const mapJson = readFileSync(mapPath, 'utf-8');
  worldMapData = JSON.parse(mapJson) as WorldMapData;
  console.log('[Server] World map loaded:', worldMapData.meta.hexCount, 'hexes');
} catch (e) {
  console.warn('[Server] Failed to load world-map.json:', e);
}

// CORS for local dev (Vite dev server)
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Health check endpoint (for pre-warm)
app.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send('ok');
});

// Stats endpoint
app.get('/stats', (_req, res) => {
  res.json(lobbyManager.getStats());
});

// Warm endpoint (for keep-alive ping)
app.get('/warm', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    uptime: process.uptime(),
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
  });
});

// Parse JSON bodies
app.use(express.json());

// Lobby & broadcast managers
const lobbyManager = new LobbyManager();
const broadcaster = new Broadcaster(lobbyManager);

// Game state manager (shared across all lobbies)
const gameStateManager = createGameStateManager();

// Active tick loops per lobby
const activeTickLoops = new Map<string, ReturnType<typeof createTickLoop>>();

// Client connection tracking
const clients = new Map<WebSocket, string>(); // ws -> clientId

// Generate unique client ID
function generateClientId(): string {
  return 'client_' + Math.random().toString(36).substring(2, 12);
}

// WebSocket connection handler
wss.on('connection', (ws: WebSocket, req) => {
  const clientId = generateClientId();
  const ip = req.socket.remoteAddress || 'unknown';
  console.log(`[Server] New connection: ${clientId} from ${ip}`);

  // Default name, can be updated on join
  const client = lobbyManager.addClient(clientId, ws, `Player_${clientId.slice(-4)}`);
  clients.set(ws, clientId);

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString()) as ClientMessage;
      handleClientMessageWithGameState(clientId, msg, lobbyManager, broadcaster, gameStateManager, worldMapData);
    } catch (err) {
      console.error('[Server] Invalid message from', clientId, err);
      broadcaster.sendError(client, 'Invalid message format');
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[Server] Disconnected: ${clientId} (${code})`);
    const lobby = lobbyManager.leaveLobby(clientId);
    if (lobby) {
      broadcaster.notifyPlayerLeft(lobby, clientId);
      if (lobby.hostId !== clientId && lobby.players.length > 0) {
        broadcaster.notifyHostChanged(lobby);
      }
      // Stop tick loop if lobby becomes empty
      if (lobby.players.length === 0) {
        stopTickLoop(lobby.code);
      }
    }
    lobbyManager.removeClient(clientId);
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[Server] WS error for', clientId, err);
  });
});

// Handle select_start_hex message (needs access to gameStateManager and worldMapData)
function handleSelectStartHex(
  clientId: string,
  msg: ClientMessage,
  lobbyManager: LobbyManager,
  broadcaster: Broadcaster,
  gameStateManager: ReturnType<typeof createGameStateManager>,
  worldMapData: WorldMapData | null
): void {
  if (msg.type !== 'select_start_hex' || !worldMapData) return;

  const lobby = lobbyManager.getClientLobby(clientId);
  if (!lobby || lobby.state !== 'playing') {
    const client = lobbyManager.getClient(clientId);
    if (client) broadcaster.sendError(client, 'Game not in playing state');
    return;
  }

  const result = gameStateManager.selectStartHex(clientId, msg.hexId);
  
  const client = lobbyManager.getClient(clientId);
  if (!client) return;

  if (result.success) {
    // Send confirmation to player
    broadcaster.send(client, { type: 'start_hex_confirmed', hexId: msg.hexId });
    
    // Broadcast updated game state to all players
    if (lobby.gameState) {
      broadcaster.broadcastGameState(lobby);
    }
    
    // Start tick loop if not already running
    startTickLoop(lobby);
  } else {
    broadcaster.sendError(client, result.error || 'Failed to select starting hex');
  }
}

// Start game tick loop for a lobby
function startTickLoop(lobby: LobbyState): void {
  if (activeTickLoops.has(lobby.code)) return;
  
  const tickLoop = createTickLoop({
    lobby,
    gameStateManager,
    broadcaster,
    tickIntervalMs: 1000 // 1 second
  });
  
  tickLoop.start();
  activeTickLoops.set(lobby.code, tickLoop);
  console.log('[Server] Started tick loop for lobby:', lobby.code);
}

// Stop game tick loop for a lobby
function stopTickLoop(lobbyCode: string): void {
  const tickLoop = activeTickLoops.get(lobbyCode);
  if (tickLoop) {
    tickLoop.stop();
    activeTickLoops.delete(lobbyCode);
    console.log('[Server] Stopped tick loop for lobby:', lobbyCode);
  }
}

// Broadcast start hex countdown
function broadcastStartHexCountdown(lobby: LobbyState, initialSeconds: number): void {
  let secondsRemaining = initialSeconds;

  // Emit the starting value immediately so the client bar begins at 0%.
  broadcaster.broadcast(lobby, {
    type: 'start_hex_countdown',
    secondsRemaining
  });

  const countdownInterval = setInterval(() => {
    const lobbyNow = lobbyManager.getLobby(lobby.code);
    if (!lobbyNow || lobbyNow.state !== 'playing') {
      clearInterval(countdownInterval);
      return;
    }

    secondsRemaining--;

    if (secondsRemaining <= 0) {
      clearInterval(countdownInterval);
      broadcaster.broadcast(lobbyNow, {
        type: 'start_hex_countdown',
        secondsRemaining: 0
      });

      // Auto-assign random hexes for players who haven't selected. Route this
      // through the game-state manager so economy/territory are recalculated.
      const gameState = lobbyNow.gameState;
      if (gameState && worldMapData) {
        for (const player of lobbyNow.players) {
          const ownsHex = gameState.hexOwnership.some(h => h.ownerId === player.id);
          if (ownsHex) continue;

          const candidates: number[] = [];
          for (let i = 0; i < gameState.hexOwnership.length; i++) {
            if (gameState.hexOwnership[i]!.ownerId) continue;
            const worldHex = worldMapData.hexes[i];
            if (worldHex && isHexOwnable(worldHex.biome)) candidates.push(i);
          }
          if (candidates.length === 0) break;

          const pick = candidates[Math.floor(Math.random() * candidates.length)]!;
          gameStateManager.selectStartHex(player.id, pick);
        }

        gameStateManager.recalculateAllEconomies();
        broadcaster.broadcastGameState(lobbyNow);
      }

      startTickLoop(lobbyNow);
      return;
    }

    broadcaster.broadcast(lobbyNow, {
      type: 'start_hex_countdown',
      secondsRemaining
    });
  }, 1000);
}

// Broadcast hex selection
function broadcastHexSelection(lobby: LobbyState, playerId: string, hexId: number, isMultiSelect: boolean): void {
  broadcaster.broadcast(lobby, {
    type: 'hex_selected',
    hexId,
    playerId,
    isMultiSelect
  });
}

// Broadcast hex deselection
function broadcastHexDeselection(lobby: LobbyState, playerId: string, hexId: number): void {
  broadcaster.broadcast(lobby, {
    type: 'hex_deselected',
    hexId,
    playerId
  });
}

// Broadcast attack result
function broadcastAttackResult(lobby: LobbyState, result: {
  attackerId: string;
  hexId: number;
  fromHexIds: number[];
  success: boolean;
  casualties: number;
  defenderId?: string;
}): void {
  broadcaster.broadcast(lobby, {
    type: 'attack_result',
    hexId: result.hexId,
    attackerId: result.attackerId,
    defenderId: result.defenderId,
    success: result.success,
    casualties: result.casualties
  });
}

// Broadcast territory update
function broadcastTerritoryUpdate(lobby: LobbyState, territory: any): void {
  broadcaster.broadcast(lobby, {
    type: 'territory_updated',
    territory
  });
}

// Extended message handler with game state
function handleClientMessageWithGameState(
  clientId: string,
  msg: ClientMessage,
  lobbyManager: LobbyManager,
  broadcaster: Broadcaster,
  gameStateManager: ReturnType<typeof createGameStateManager>,
  worldMapData: WorldMapData | null
): void {
  const client = lobbyManager.getClient(clientId);
  if (!client) return;

  const lobby = lobbyManager.getClientLobby(clientId);

  switch (msg.type) {
    case 'create_lobby': {
      try {
        lobbyManager.setClientName(clientId, msg.name);
        const lobby = lobbyManager.createLobby(clientId, msg.settings, msg.colorIndex ?? 0);
        const player = lobby.players[0];
        broadcaster.notifyLobbyCreated(client, lobby, player);
      } catch (err: any) {
        broadcaster.sendError(client, err.message);
      }
      break;
    }

    case 'update_lobby': {
      const lobby = lobbyManager.updateLobby(clientId, msg.settings);
      if (lobby) {
        broadcaster.broadcast(lobby, {
          type: 'lobby_updated',
          settings: lobby.settings
        });
      } else {
        broadcaster.sendError(client, 'Cannot update lobby: not host, lobby not found, or game started');
      }
      break;
    }

    case 'join_lobby': {
      lobbyManager.setClientName(clientId, msg.name);
      const lobby = lobbyManager.joinLobby(clientId, msg.code, msg.colorIndex ?? 0);
      if (lobby) {
        const player = lobby.players.find((p: any) => p.id === clientId)!;
        broadcaster.notifyLobbyJoined(client, lobby, player);
        broadcaster.notifyPlayerJoined(lobby, player, clientId);
      } else {
        broadcaster.sendError(client, 'Lobby not found, full, or already started');
      }
      break;
    }

    case 'leave_lobby': {
      const lobby = lobbyManager.leaveLobby(clientId);
      if (lobby) {
        broadcaster.notifyPlayerLeft(lobby, clientId);
        if (lobby.hostId !== clientId && lobby.players.length > 0) {
          broadcaster.notifyHostChanged(lobby);
        }
        if (lobby.players.length === 0) {
          stopTickLoop(lobby.code);
        }
      }
      break;
    }

    case 'player_ready': {
      const lobby = lobbyManager.setReady(clientId, msg.ready);
      if (lobby) {
        broadcaster.notifyPlayerReady(lobby, clientId, msg.ready);
      }
      break;
    }

    case 'start_game': {
      if (!lobbyManager.isHost(clientId)) {
        broadcaster.sendError(client, 'Only host can start game');
        return;
      }
      const lobby = lobbyManager.startGame(clientId);
      if (lobby && worldMapData) {
        // Initialize game state
        gameStateManager.initializeGameState(lobby, worldMapData);

        // Tell clients to enter the game scene FIRST, so they have registered
        // their game-state listeners before the initial sync arrives.
        broadcaster.notifyGameStart(lobby, { tick: 0, entities: [], timestamp: Date.now() });

        // Then send the initial state and begin the selection countdown.
        broadcaster.broadcastGameState(lobby);
        broadcastStartHexCountdown(lobby, 5);

        // Start ticking now; players with no hexes simply gain nothing.
        startTickLoop(lobby);

        console.log('[Server] Game started in lobby:', lobby.code);
      }
      break;
    }

    case 'command': {
      // Host simulates locally, sends snapshots directly
      break;
    }

    case 'chat': {
      const lobby = lobbyManager.getClientLobby(clientId);
      if (lobby) {
        broadcaster.broadcast(lobby, {
          type: 'chat',
          playerId: clientId,
          playerName: client.name,
          message: msg.message
        });
      }
      break;
    }

    case 'ping': {
      broadcaster.send(client, { type: 'pong', time: msg.time });
      break;
    }

    case 'select_start_hex': {
      handleSelectStartHex(clientId, msg, lobbyManager, broadcaster, gameStateManager, worldMapData);
      break;
    }

    case 'select_hex': {
      if (!lobby || !lobby.gameState) {
        broadcaster.sendError(client, 'Game not in playing state');
        return;
      }
      const result = gameStateManager.selectHex(clientId, msg.hexId, msg.shiftKey);
      if (result.success) {
        // Broadcast selection to all players
        broadcaster.broadcastHexSelection(lobby, clientId, msg.hexId, msg.shiftKey);
      } else {
        broadcaster.sendError(client, result.error || 'Failed to select hex');
      }
      break;
    }

    case 'deselect_hex': {
      if (!lobby || !lobby.gameState) {
        broadcaster.sendError(client, 'Game not in playing state');
        return;
      }
      const result = gameStateManager.deselectHex(clientId, msg.hexId);
      if (result.success) {
        broadcaster.broadcastHexDeselection(lobby, clientId, msg.hexId);
      }
      break;
    }

    case 'attack_hex': {
      if (!lobby || !lobby.gameState) {
        broadcaster.sendError(client, 'Game not in playing state');
        return;
      }
      const result = gameStateManager.attackHex(clientId, msg.fromHexIds, msg.hexId);
      if (result.success) {
        // Broadcast attack result (drives the red flash on the target).
        broadcaster.broadcastAttackResult(lobby, {
          attackerId: clientId,
          hexId: msg.hexId,
          fromHexIds: msg.fromHexIds,
          success: true,
          casualties: result.casualties || 0,
          defenderId: result.defenderId
        });

        // If capital was destroyed, broadcast it to all players
        if (result.capitalDestroyed) {
          broadcaster.broadcast(lobby, {
            type: 'capital_destroyed',
            hexId: msg.hexId,
            formerOwnerId: result.defenderId || '',
            capturedBy: clientId
          });
        }

        // Push the authoritative post-combat state (soldiers, ownership,
        // territories) to everyone in one message.
        broadcaster.broadcastGameState(lobby);
      } else {
        broadcaster.sendError(client, result.error || 'Attack failed');
      }
      break;
    }

    case 'build_structure': {
      if (!lobby || !lobby.gameState) {
        broadcaster.sendError(client, 'Game not in playing state');
        return;
      }
      const result = gameStateManager.buildStructure(clientId, msg.hexId, msg.buildingType);
      if (result.success) {
        broadcaster.broadcast(lobby, {
          type: 'building_started',
          hexId: msg.hexId,
          buildingType: msg.buildingType,
          playerId: clientId
        });
        broadcaster.broadcastGameState(lobby);
      } else {
        broadcaster.sendError(client, result.error || 'Build failed');
      }
      break;
    }

    case 'demolish_building': {
      if (!lobby || !lobby.gameState) {
        broadcaster.sendError(client, 'Game not in playing state');
        return;
      }
      const result = gameStateManager.demolishBuilding(clientId, msg.hexId);
      if (result.success) {
        broadcaster.broadcast(lobby, {
          type: 'building_demolished',
          hexId: msg.hexId,
          playerId: clientId
        });
        broadcaster.broadcastGameState(lobby);
      } else {
        broadcaster.sendError(client, result.error || 'Demolish failed');
      }
      break;
    }

    case 'set_soldier_allocation': {
      if (!lobby || !lobby.gameState) {
        broadcaster.sendError(client, 'Game not in playing state');
        return;
      }
      const result = gameStateManager.setSoldierAllocation(clientId, msg.ratio);
      if (result.success) {
        broadcaster.broadcastGameState(lobby);
      } else {
        broadcaster.sendError(client, result.error || 'Set allocation failed');
      }
      break;
    }

    case 'set_attack_allocation': {
      if (!lobby || !lobby.gameState) {
        broadcaster.sendError(client, 'Game not in playing state');
        return;
      }
      const result = gameStateManager.setAttackAllocation(clientId, msg.ratio);
      if (result.success) {
        broadcaster.broadcastGameState(lobby);
      } else {
        broadcaster.sendError(client, result.error || 'Set attack allocation failed');
      }
      break;
    }

    case 'radial_menu_action': {
      if (!lobby || !lobby.gameState) {
        broadcaster.sendError(client, 'Game not in playing state');
        return;
      }
      // Route radial menu actions to appropriate handlers
      if (msg.action === 'build') {
        // Client should send build_structure directly; this is for future use
        console.log('[Server] Radial menu build action on hex', msg.hexId);
      } else {
        console.log('[Server] Radial menu action:', msg.action, 'on hex', msg.hexId);
      }
      break;
    }
  }
}

// Periodic cleanup of dead connections
setInterval(() => {
  for (const [ws, clientId] of clients) {
    if (ws.readyState !== WebSocket.OPEN) {
      console.log(`[Server] Cleaning up dead connection: ${clientId}`);
      const lobby = lobbyManager.leaveLobby(clientId);
      if (lobby) {
        broadcaster.notifyPlayerLeft(lobby, clientId);
        if (lobby.hostId !== clientId && lobby.players.length > 0) {
          broadcaster.notifyHostChanged(lobby);
        }
        if (lobby.players.length === 0) {
          stopTickLoop(lobby.code);
        }
      }
      lobbyManager.removeClient(clientId);
      clients.delete(ws);
    }
  }
}, 30000);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Relay server running on port ${PORT}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
  console.log(`[Server] Stats: http://localhost:${PORT}/stats`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down...');
  for (const tickLoop of activeTickLoops.values()) {
    tickLoop.stop();
  }
  lobbyManager.destroy();
  wss.close(() => {
    server.close(() => {
      console.log('[Server] Closed');
      process.exit(0);
    });
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down...');
  for (const tickLoop of activeTickLoops.values()) {
    tickLoop.stop();
  }
  lobbyManager.destroy();
  wss.close(() => {
    server.close(() => {
      console.log('[Server] Closed');
      process.exit(0);
    });
  });
});