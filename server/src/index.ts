// Relay Server Entry Point
// Express + WebSocket server for multiplayer lobby and game relay

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { LobbyManager, ConnectedClient } from './lobby';
import { Broadcaster, handleClientMessage } from './broadcast';
import { ClientMessage, ServerMessage } from './shared/protocol';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

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
      handleClientMessage(clientId, msg, lobbyManager, broadcaster);
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
    }
    lobbyManager.removeClient(clientId);
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[Server] WS error for', clientId, err);
  });
});

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
  lobbyManager.destroy();
  wss.close(() => {
    server.close(() => {
      console.log('[Server] Closed');
      process.exit(0);
    });
  });
});