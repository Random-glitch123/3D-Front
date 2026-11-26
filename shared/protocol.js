"use strict";
// Shared protocol types for client-server communication
// Used by both client (browser) and server (Node.js)
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateLobbyCode = generateLobbyCode;
exports.generatePlayerId = generatePlayerId;
exports.generateEntityId = generateEntityId;
// ===== Utility =====
function generateLobbyCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}
function generatePlayerId() {
    return 'player_' + Math.random().toString(36).substring(2, 10);
}
function generateEntityId() {
    return 'entity_' + Math.random().toString(36).substring(2, 12);
}
//# sourceMappingURL=protocol.js.map