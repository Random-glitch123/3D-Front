// Message broadcasting for the relay server
// Handles sending messages to clients in a lobby

import { LobbyManager, ConnectedClient } from './lobby';
import { ServerMessage, ClientMessage, LobbyState, Player } from './shared/protocol';

export class Broadcaster {
  constructor(private lobbyManager: LobbyManager) {}

  // Send to single client
  send(client: ConnectedClient, msg: ServerMessage): boolean {
    if (client.ws?.readyState === 1) { // WebSocket.OPEN
      try {
        client.ws.send(JSON.stringify(msg));
        return true;
      } catch (err) {
        console.error('[Broadcast] Failed to send to client:', err);
        return false;
      }
    }
    return false;
  }

  // Send to all clients in lobby
  broadcast(lobby: LobbyState, msg: ServerMessage, excludeClientId?: string): number {
    let sent = 0;
    for (const player of lobby.players) {
      if (player.id === excludeClientId) continue;
      const client = this.lobbyManager.getClient(player.id);
      if (client && this.send(client, msg)) sent++;
    }
    return sent;
  }

  // Broadcast to all except host
  broadcastToClients(lobby: LobbyState, msg: ServerMessage): number {
    return this.broadcast(lobby, msg, lobby.hostId);
  }

  // Send to host only
  sendToHost(lobby: LobbyState, msg: ServerMessage): boolean {
    const host = this.lobbyManager.getClient(lobby.hostId);
    return host ? this.send(host, msg) : false;
  }

  // Notify lobby created
  notifyLobbyCreated(client: ConnectedClient, lobby: LobbyState, player: any): void {
    this.send(client, {
      type: 'lobby_created',
      code: lobby.code,
      playerId: client.id,
      player
    });
  }

  // Notify lobby joined
  notifyLobbyJoined(client: ConnectedClient, lobby: LobbyState, player: any): void {
    this.send(client, {
      type: 'lobby_joined',
      state: this.sanitizeLobbyState(lobby),
      playerId: client.id,
      player
    });
  }

  // Notify player joined (to others)
  notifyPlayerJoined(lobby: LobbyState, newPlayer: any, excludeClientId?: string): void {
    this.broadcast(lobby, {
      type: 'player_joined',
      player: newPlayer
    }, excludeClientId);
    // Also send full player list to all
    this.broadcast(lobby, {
      type: 'lobby_players_updated',
      players: lobby.players
    });
  }

  // Notify player left
  notifyPlayerLeft(lobby: LobbyState, playerId: string): void {
    this.broadcast(lobby, {
      type: 'player_left',
      playerId
    });
    // Also send full player list to all
    this.broadcast(lobby, {
      type: 'lobby_players_updated',
      players: lobby.players
    });
  }

  // Notify ready state change
  notifyPlayerReady(lobby: LobbyState, playerId: string, ready: boolean): void {
    this.broadcast(lobby, {
      type: 'player_ready',
      playerId,
      ready
    });
  }

  // Notify host changed
  notifyHostChanged(lobby: LobbyState): void {
    this.broadcast(lobby, {
      type: 'host_changed',
      newHostId: lobby.hostId
    });
  }

  // Notify game start
  notifyGameStart(lobby: LobbyState, initialSnapshot: any): void {
    for (const player of lobby.players) {
      const client = this.lobbyManager.getClient(player.id);
      if (client) {
        this.send(client, {
          type: 'game_start',
          initialSnapshot,
          yourPlayerId: player.id
        });
      }
    }
  }

  // Broadcast snapshot (from host to all)
  broadcastSnapshot(lobby: LobbyState, tick: number, entities: any[]): void {
    this.broadcast(lobby, {
      type: 'snapshot',
      tick,
      entities
    });
  }

  // Forward command from host to all clients
  // Note: In this architecture, host simulates and sends snapshots directly
  // This is kept for potential future use
  broadcastCommand(_lobby: LobbyState, _tick: number, _commands: any[]): void {
    // Server doesn't forward commands — host sends snapshots directly
  }

  // Error message
  sendError(client: ConnectedClient, message: string): void {
    this.send(client, { type: 'error', message });
  }

  // Kick player
  kickPlayer(lobby: LobbyState, playerId: string, reason: string): void {
    const client = this.lobbyManager.getClient(playerId);
    if (client) {
      this.send(client, { type: 'kicked', reason });
    }
  }

  // Sanitize lobby state for client (remove sensitive info)
  private sanitizeLobbyState(lobby: LobbyState): LobbyState {
    return {
      ...lobby,
      players: lobby.players.map((p: Player) => ({
        ...p,
        // Don't send connection info
      }))
    };
  }
}

// Handle incoming client messages
export function handleClientMessage(
  clientId: string,
  msg: ClientMessage,
  lobbyManager: LobbyManager,
  broadcaster: Broadcaster
): void {
  const client = lobbyManager.getClient(clientId);
  if (!client) return;

  switch (msg.type) {
    case 'create_lobby': {
      try {
        // Update client's name from the create_lobby message before creating lobby
        lobbyManager.setClientName(clientId, msg.name);
        const lobby = lobbyManager.createLobby(clientId, msg.settings);
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
        // Notify all players in lobby of updated settings
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
      // Update client's name from the join message before joining
      lobbyManager.setClientName(clientId, msg.name);
      const lobby = lobbyManager.joinLobby(clientId, msg.code);
      if (lobby) {
        const player = lobby.players.find((p: Player) => p.id === clientId)!;
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
        // If host left and new host elected
        if (lobby.hostId !== clientId && lobby.players.length > 0) {
          broadcaster.notifyHostChanged(lobby);
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
      if (lobby) {
        // Host will send initial snapshot via separate channel
        // For now, broadcast empty snapshot
        broadcaster.notifyGameStart(lobby, { tick: 0, entities: [], timestamp: Date.now() });
      }
      break;
    }

    case 'command': {
      // Host sends commands to server? Actually host simulates locally
      // Server just relays snapshots from host to clients
      // This is handled in the main server loop
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
      // Respond with pong
      broadcaster.send(client, { type: 'pong', time: msg.time });
      break;
    }
  }
}