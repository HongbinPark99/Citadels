// server.js
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
const rooms = new Map();
const wsToInfo = new Map();

function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcastRoom(roomCode, obj, excludeId) {
  const room = rooms.get(roomCode); if (!room) return;
  const data = JSON.stringify(obj);
  for (const [pid, ws] of Object.entries(room.clients))
    if (pid !== excludeId && ws.readyState === WebSocket.OPEN) ws.send(data);
}
function publicRoom(room) {
  return { code: room.code, phase: room.phase, hostId: room.hostId, players: room.players, G: room.G };
}

const AVATARS = ['🧙','🦸','🧝','🧛','🧟','🧞'];
const PCOLORS = ['#e05252','#d4a017','#4caf7d','#5b9bd5','#c39bd3','#fb923c'];

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const info = wsToInfo.get(ws);

    if (msg.type === 'create_room') {
      let code; do { code = Math.random().toString(36).slice(2,8).toUpperCase(); } while (rooms.has(code));
      const room = { code, phase:'waiting', hostId:msg.playerId,
        players:[{id:msg.playerId,name:msg.name,avatar:AVATARS[0],color:PCOLORS[0],isAI:false}],
        G:null, clients:{[msg.playerId]:ws} };
      rooms.set(code, room);
      wsToInfo.set(ws, { playerId:msg.playerId, roomCode:code });
      safeSend(ws, { type:'room_created', code, room:publicRoom(room) });
      console.log(`[${code}] 생성: ${msg.name}`);
      return;
    }

    if (msg.type === 'join_room') {
      const code = (msg.code||'').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { safeSend(ws, { type:'error', msg:`방 코드 "${code}" 없음` }); return; }
      if (room.phase !== 'waiting') { safeSend(ws, { type:'error', msg:'이미 시작된 게임' }); return; }
      if (room.players.length >= 6) { safeSend(ws, { type:'error', msg:'방 가득 참' }); return; }
      const idx = room.players.length;
      room.players.push({id:msg.playerId,name:msg.name,avatar:AVATARS[idx],color:PCOLORS[idx],isAI:false});
      room.clients[msg.playerId] = ws;
      wsToInfo.set(ws, { playerId:msg.playerId, roomCode:code });
      safeSend(ws, { type:'room_joined', code, room:publicRoom(room) });
      broadcastRoom(code, { type:'room_update', room:publicRoom(room) }, msg.playerId);
      console.log(`[${code}] 참가: ${msg.name} (${room.players.length}명)`);
      return;
    }

    if (msg.type === 'get_room') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (room) safeSend(ws, { type:'room_update', room:publicRoom(room) });
      return;
    }

    if (msg.type === 'start_game') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (!room || room.hostId !== info.playerId || room.phase !== 'waiting') return;
      const aiCount = Math.max(0, Math.min(msg.aiCount||0, 6-room.players.length));
      for (let i=0;i<aiCount;i++) {
        const idx=room.players.length; if(idx>=6)break;
        room.players.push({id:`AI_${i}`,name:`AI ${i+1}`,avatar:AVATARS[idx],color:PCOLORS[idx],isAI:true});
      }
      if (room.players.length < 2) { safeSend(ws, { type:'error', msg:'최소 2명 필요' }); return; }
      room.phase = 'game';
      broadcastRoom(info.roomCode, { type:'game_start', room:publicRoom(room) }, null);
      console.log(`[${info.roomCode}] 게임 시작: ${room.players.length}명`);
      return;
    }

    if (msg.type === 'sync_state') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (!room || room.hostId !== info.playerId) return;
      room.G = msg.G;
      if (msg.gameOver) room.phase = 'gameover';
      broadcastRoom(info.roomCode, { type:'state_update', G:msg.G, gameOver:!!msg.gameOver }, info.playerId);
      return;
    }

    if (msg.type === 'player_action') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (!room) return;
      safeSend(room.clients[room.hostId], { type:'player_action', playerId:info.playerId, action:msg.action });
      return;
    }

    if (msg.type === 'chat') {
      if (!info) return;
      const room = rooms.get(info.roomCode);
      if (room) broadcastRoom(info.roomCode, { type:'chat', name:msg.name, text:msg.text }, null);
      return;
    }

    if (msg.type === 'ping') { safeSend(ws, { type:'pong' }); return; }
  });

  ws.on('close', () => {
    const info = wsToInfo.get(ws); wsToInfo.delete(ws); if (!info) return;
    const room = rooms.get(info.roomCode); if (!room) return;
    delete room.clients[info.playerId];
    if (Object.keys(room.clients).length === 0) { rooms.delete(info.roomCode); console.log(`[${info.roomCode}] 방 삭제`); }
    else broadcastRoom(info.roomCode, { type:'player_left', playerId:info.playerId, room:publicRoom(room) }, null);
  });

  ws.on('error', err => console.error('WS:', err.message));
});

app.get('/status', (_, res) => res.json({ rooms:rooms.size, connections:wss.clients.size }));
setInterval(() => { rooms.forEach((r,c)=>{ if(!Object.keys(r.clients).length) rooms.delete(c); }); }, 3600000);
