// server.js — 시타델 WebSocket 서버
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () =>
  console.log(`🏰 시타델 서버: http://localhost:${PORT}`)
);

const wss = new WebSocketServer({ server });

// rooms: Map<code, Room>
// Room.clients: Map<playerId, ws>  ← 반드시 Map
const rooms    = new Map();
const wsToInfo = new Map();   // Map<ws, {playerId, roomCode}>

const AVATARS = ['🧙','🦸','🧝','🧛','🧟','🧞'];
const PCOLORS = ['#e05252','#d4a017','#4caf7d','#5b9bd5','#c39bd3','#fb923c'];

function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(obj));
}

function broadcastRoom(code, obj, excludeId) {
  const room = rooms.get(code);
  if (!room) return;
  const data = JSON.stringify(obj);
  for (const [pid, ws] of room.clients)
    if (pid !== excludeId && ws.readyState === WebSocket.OPEN)
      ws.send(data);
}

function broadcastAll(code, obj) { broadcastRoom(code, obj, null); }

function roomPublic(room) {
  return {
    code:        room.code,
    title:       room.title,
    phase:       room.phase,
    hostId:      room.hostId,
    players:     room.players,
    playerCount: room.players.length,
    G:           room.G,
  };
}

function publicRoomList() {
  const list = [];
  for (const room of rooms.values()) {
    if (room.phase === 'waiting' && room.players.length < 6) {
      list.push({
        code:        room.code,
        title:       room.title,
        hostName:    room.players[0] ? room.players[0].name : '?',
        playerCount: room.players.length,
        maxPlayers:  6,
        players:     room.players.map(function(p) { return { name: p.name, avatar: p.avatar, isAI: p.isAI }; }),
      });
    }
  }
  return list;
}

// 로비(방에 없는) ws에게만 방 목록 전송
function pushRoomList() {
  const data = JSON.stringify({ type: 'room_list', rooms: publicRoomList() });
  for (const ws of wss.clients) {
    if (ws.readyState === WebSocket.OPEN && !wsToInfo.has(ws))
      ws.send(data);
  }
}

function genCode() {
  let c;
  do { c = Math.random().toString(36).slice(2, 8).toUpperCase(); } while (rooms.has(c));
  return c;
}

wss.on('connection', function(ws) {
  console.log('연결 (총 ' + wss.clients.size + ')');
  safeSend(ws, { type: 'room_list', rooms: publicRoomList() });

  ws.on('message', function(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }
    var info = wsToInfo.get(ws);

    if (msg.type === 'get_room_list') {
      safeSend(ws, { type: 'room_list', rooms: publicRoomList() });
      return;
    }

    if (msg.type === 'create_room') {
      if (info) { safeSend(ws, { type: 'error', msg: '이미 방에 있습니다.' }); return; }
      var code = genCode();
      var player = { id: msg.playerId, name: msg.name, avatar: AVATARS[0], color: PCOLORS[0], isAI: false };
      var room = {
        code:    code,
        title:   msg.title || (msg.name + '의 방'),
        hostId:  msg.playerId,
        phase:   'waiting',
        players: [player],
        clients: new Map([[msg.playerId, ws]]),
        G:       null,
      };
      rooms.set(code, room);
      wsToInfo.set(ws, { playerId: msg.playerId, roomCode: code });
      safeSend(ws, { type: 'room_created', room: roomPublic(room) });
      pushRoomList();
      console.log('[' + code + '] 생성: ' + msg.name);
      return;
    }

    if (msg.type === 'join_room') {
      var code = (msg.code || '').toUpperCase().trim();
      var room = rooms.get(code);
      if (!room) { safeSend(ws, { type: 'error', msg: '방 코드 "' + code + '" 를 찾을 수 없습니다.' }); return; }
      if (room.phase !== 'waiting') { safeSend(ws, { type: 'error', msg: '이미 시작된 게임입니다.' }); return; }
      if (room.players.length >= 6) { safeSend(ws, { type: 'error', msg: '방이 가득 찼습니다.' }); return; }
      if (room.clients.has(msg.playerId)) {
        room.clients.set(msg.playerId, ws);
        wsToInfo.set(ws, { playerId: msg.playerId, roomCode: code });
        safeSend(ws, { type: 'room_joined', room: roomPublic(room) });
        return;
      }
      var idx = room.players.length;
      var player = { id: msg.playerId, name: msg.name, avatar: AVATARS[idx] || AVATARS[0], color: PCOLORS[idx] || PCOLORS[0], isAI: false };
      room.players.push(player);
      room.clients.set(msg.playerId, ws);
      wsToInfo.set(ws, { playerId: msg.playerId, roomCode: code });
      safeSend(ws, { type: 'room_joined', room: roomPublic(room) });
      broadcastRoom(code, { type: 'room_update', room: roomPublic(room) }, msg.playerId);
      pushRoomList();
      console.log('[' + code + '] 참가: ' + msg.name + ' (' + room.players.length + '명)');
      return;
    }

    if (msg.type === 'get_room') {
      if (!info) return;
      var room = rooms.get(info.roomCode);
      if (room) safeSend(ws, { type: 'room_update', room: roomPublic(room) });
      return;
    }

    if (msg.type === 'start_game') {
      if (!info) return;
      var room = rooms.get(info.roomCode);
      if (!room || room.hostId !== info.playerId || room.phase !== 'waiting') return;
      var aiCount = Math.max(0, Math.min(msg.aiCount || 0, 6 - room.players.length));
      for (var i = 0; i < aiCount; i++) {
        var idx = room.players.length;
        if (idx >= 6) break;
        room.players.push({ id: 'AI_' + Date.now() + '_' + i, name: 'AI ' + (i+1), avatar: AVATARS[idx] || '🤖', color: PCOLORS[idx] || '#888', isAI: true });
      }
      if (room.players.length < 2) { safeSend(ws, { type: 'error', msg: '최소 2명이 필요합니다.' }); return; }
      room.phase = 'game';
      broadcastAll(info.roomCode, { type: 'game_start', room: roomPublic(room) });
      pushRoomList();
      console.log('[' + info.roomCode + '] 게임 시작: ' + room.players.length + '명');
      return;
    }

    if (msg.type === 'sync_state') {
      if (!info) return;
      var room = rooms.get(info.roomCode);
      if (!room || room.hostId !== info.playerId) return;
      room.G = msg.G;
      if (msg.gameOver) room.phase = 'gameover';
      broadcastRoom(info.roomCode, { type: 'state_update', G: msg.G, gameOver: !!msg.gameOver }, info.playerId);
      return;
    }

    if (msg.type === 'player_action') {
      if (!info) return;
      var room = rooms.get(info.roomCode);
      if (!room) return;
      var hostWs = room.clients.get(room.hostId);
      safeSend(hostWs, { type: 'player_action', playerId: info.playerId, action: msg.action });
      return;
    }

    if (msg.type === 'chat') {
      if (!info) return;
      var room = rooms.get(info.roomCode);
      if (room) broadcastAll(info.roomCode, { type: 'chat', name: msg.name, text: msg.text });
      return;
    }

    if (msg.type === 'ping') { safeSend(ws, { type: 'pong' }); return; }
  });

  ws.on('close', function() {
    var info = wsToInfo.get(ws);
    wsToInfo.delete(ws);
    if (!info) return;
    var room = rooms.get(info.roomCode);
    if (!room) return;
    room.clients.delete(info.playerId);
    console.log('[' + info.roomCode + '] 나감: ' + info.playerId + ' (남은: ' + room.clients.size + ')');
    if (room.clients.size === 0) {
      rooms.delete(info.roomCode);
      console.log('[' + info.roomCode + '] 방 삭제');
    } else {
      if (room.hostId === info.playerId) {
        room.hostId = room.clients.keys().next().value;
        console.log('[' + info.roomCode + '] 새 호스트: ' + room.hostId);
      }
      room.players = room.players.filter(function(p) { return p.isAI || p.id !== info.playerId; });
      broadcastAll(info.roomCode, { type: 'player_left', playerId: info.playerId, room: roomPublic(room) });
    }
    pushRoomList();
  });

  ws.on('error', function(err) { console.error('[WS]', err.message); });
});

app.get('/status', function(_, res) {
  res.json({
    connections: wss.clients.size,
    rooms: rooms.size,
    detail: Array.from(rooms.values()).map(function(r) {
      return { code: r.code, phase: r.phase, players: r.players.length, clients: r.clients.size };
    }),
  });
});

setInterval(function() {
  for (const [code, room] of rooms)
    if (room.clients.size === 0) { rooms.delete(code); console.log('[' + code + '] 정리'); }
}, 1800000);
