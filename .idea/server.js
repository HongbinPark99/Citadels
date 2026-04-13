// server.js — 시타델 WebSocket 서버
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🏰 시타델 서버 실행 중: http://localhost:${PORT}`));

const wss = new WebSocketServer({ server });

// rooms: { code -> { code, hostId, players:[{id,name,avatar,color,isAI}], phase:'waiting'|'game'|'gameover', G, clients:{id->ws} } }
const rooms = new Map();

function broadcast(room, msg, excludeId = null) {
  const data = JSON.stringify(msg);
  Object.entries(room.clients).forEach(([id, ws]) => {
    if (id !== excludeId && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function broadcastAll(room, msg) {
  broadcast(room, msg, null);
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function roomInfo(room) {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    players: room.players,
    G: room.G,
  };
}

wss.on('connection', (ws) => {
  let myId = null;
  let myRoomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── 방 만들기 ──
      case 'create_room': {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        myId = msg.playerId;
        myRoomCode = code;
        const player = { id: myId, name: msg.name, avatar: msg.avatar, color: msg.color, isAI: false };
        const room = {
          code, phase: 'waiting', hostId: myId,
          players: [player],
          G: null,
          clients: { [myId]: ws },
        };
        rooms.set(code, room);
        send(ws, { type: 'room_created', code, roomInfo: roomInfo(room) });
        console.log(`방 생성: ${code} (${msg.name})`);
        break;
      }

      // ── 방 참가 ──
      case 'join_room': {
        const code = msg.code.toUpperCase();
        const room = rooms.get(code);
        if (!room) { send(ws, { type: 'error', msg: '방을 찾을 수 없습니다.' }); return; }
        if (room.phase !== 'waiting') { send(ws, { type: 'error', msg: '이미 게임이 시작된 방입니다.' }); return; }
        if (room.players.length >= 6) { send(ws, { type: 'error', msg: '방이 가득 찼습니다.' }); return; }
        myId = msg.playerId;
        myRoomCode = code;
        const idx = room.players.length;
        const player = { id: myId, name: msg.name, avatar: msg.avatar, color: msg.color, isAI: false };
        room.players.push(player);
        room.clients[myId] = ws;
        send(ws, { type: 'room_joined', code, roomInfo: roomInfo(room) });
        broadcastAll(room, { type: 'room_update', roomInfo: roomInfo(room) });
        console.log(`참가: ${code} ← ${msg.name} (총 ${room.players.length}명)`);
        break;
      }

      // ── 대기실 상태 요청 ──
      case 'get_room': {
        const room = rooms.get(myRoomCode);
        if (room) send(ws, { type: 'room_update', roomInfo: roomInfo(room) });
        break;
      }

      // ── 게임 시작 (호스트) ──
      case 'start_game': {
        const room = rooms.get(myRoomCode);
        if (!room || room.hostId !== myId) return;
        // AI 추가
        const aiCount = msg.aiCount || 0;
        const AVATARS = ["🧙","🦸","🧝","🧛","🧟","🧞"];
        const PCOLORS = ["#e05252","#d4a017","#4caf7d","#5b9bd5","#c39bd3","#fb923c"];
        for (let i = 0; i < aiCount; i++) {
          const idx = room.players.length;
          if (idx >= 6) break;
          room.players.push({ id: `AI_${i}`, name: `AI ${i+1}`, avatar: AVATARS[idx], color: PCOLORS[idx], isAI: true });
        }
        if (room.players.length < 2) { send(ws, { type: 'error', msg: '최소 2명이 필요합니다.' }); return; }
        room.phase = 'game';
        room.G = null; // 클라이언트가 빌드
        broadcastAll(room, { type: 'game_start', roomInfo: roomInfo(room) });
        console.log(`게임 시작: ${myRoomCode} (${room.players.length}명)`);
        break;
      }

      // ── 게임 상태 동기화 (호스트가 G 전송) ──
      case 'sync_state': {
        const room = rooms.get(myRoomCode);
        if (!room) return;
        room.G = msg.G;
        if (msg.gameOver) room.phase = 'gameover';
        // 보내는 사람 제외하고 다른 클라이언트에게 전송
        broadcast(room, { type: 'state_update', G: msg.G, gameOver: msg.gameOver || false }, myId);
        break;
      }

      // ── 플레이어 행동 (비호스트 → 호스트에게 전달) ──
      case 'player_action': {
        const room = rooms.get(myRoomCode);
        if (!room) return;
        // 호스트에게 전달
        const hostWs = room.clients[room.hostId];
        if (hostWs && hostWs.readyState === WebSocket.OPEN) {
          hostWs.send(JSON.stringify({ type: 'player_action', playerId: myId, action: msg.action }));
        }
        break;
      }

      // ── 채팅/이모지 ──
      case 'chat': {
        const room = rooms.get(myRoomCode);
        if (!room) return;
        broadcastAll(room, { type: 'chat', name: msg.name, text: msg.text });
        break;
      }

      // ── 핑 ──
      case 'ping':
        send(ws, { type: 'pong' });
        break;
    }
  });

  ws.on('close', () => {
    if (!myRoomCode || !myId) return;
    const room = rooms.get(myRoomCode);
    if (!room) return;
    delete room.clients[myId];
    // 남은 클라이언트에게 알림
    broadcast(room, { type: 'player_left', playerId: myId, roomInfo: roomInfo(room) });
    // 방이 완전히 비면 삭제
    if (Object.keys(room.clients).length === 0) {
      rooms.delete(myRoomCode);
      console.log(`방 삭제: ${myRoomCode}`);
    }
    console.log(`연결 해제: ${myRoomCode} ← ${myId}`);
  });

  ws.on('error', (err) => console.error('WS 에러:', err.message));
});

// 빈 방 정리 (1시간마다)
setInterval(() => {
  rooms.forEach((room, code) => {
    if (Object.keys(room.clients).length === 0) rooms.delete(code);
  });
}, 3600000);
