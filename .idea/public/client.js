// client.js v5 — WS 안정성 강화판
'use strict';

// ── 전역 ──
let ws        = null;
let wsReady   = false;  // onopen 이후 true
let G         = null;
let MY_ID     = null;
let MY_ROOM   = null;
let IS_HOST   = false;
let AI_SOLO   = 3;
let AI_WAIT   = 0;

let selCard     = null;
let pendAbility = null;
let wizMode     = null;
let wizDiscSel  = [];
let warlordTpi  = null;
let abilityDone = false;
let aiQueue     = [];
let aiRunning   = false;
let ntimer      = null;
let pingTimer   = null;

const CCSS   = {yellow:'#d4a017',blue:'#5b9bd5',green:'#4caf7d',red:'#e05252',purple:'#9b59b6'};
const CLABEL = {yellow:'귀족',blue:'종교',green:'상업',red:'군사',purple:'특수'};

// ── 유틸 ──
const $    = id => document.getElementById(id);
const el   = (t,c) => { const e=document.createElement(t); if(c)e.className=c; return e; };
const uid  = ()  => Math.random().toString(36).slice(2,10).toUpperCase();
const esc  = s   => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const myIdx     = () => G?.players.findIndex(p=>p.id===MY_ID) ?? 0;
const isMyTurn  = () => G && G.phase==='player_turn' && G.curPi===myIdx() && !aiRunning;
const isMyCS    = () => G && G.phase==='select_character' && G.selOrder[G.selIdx]===myIdx();

function notify(msg, type='info') {
  const e=$('notif'); if(!e)return;
  if(type==='bad') sfxPlay('error');
  e.textContent=msg; e.className=`show n-${type}`;
  if(ntimer)clearTimeout(ntimer);
  ntimer=setTimeout(()=>e.className='',3000);
}

function calcScore(p){
  let s=0; const c=new Set();
  p.city.forEach(d=>{ s+=d.cost; if(['university','dragondoor','school'].includes(d.id))s+=3; c.add(d.color); });
  if(c.size>=5)s+=3;
  if(p.firstComplete)s+=4; else if(p.complete)s+=2;
  return s;
}
function deckPop(){
  if(!G.deck.length){G.deck=shuffle([...G.discard]);G.discard=[];}
  return G.deck.length?G.deck.pop():null;
}
function feed(icon,html,type='system'){
  if(!G)return;
  G.log.unshift({icon,html,type});
  if(G.log.length>100)G.log.pop();
}

// ══════════════════════════════════════
// WebSocket — 페이지 로드 즉시 연결
// ══════════════════════════════════════
function initWS() {
  // 이미 열려있으면 재사용
  if(ws && ws.readyState === WebSocket.OPEN) return;
  if(ws && ws.readyState === WebSocket.CONNECTING) return;

  if(ws){ try{ws.close();}catch(_){} }

  const proto = location.protocol==='https:' ? 'wss' : 'ws';
  const url   = proto + '://' + location.host;
  console.log('[WS] 연결:', url);

  ws = new WebSocket(url);
  wsReady = false;

  ws.onopen = () => {
    wsReady = true;
    console.log('[WS] 연결됨');
    setBanner('ok','🟢 서버 연결됨');
    setLobbyBtns(true);
    // 로비에 있으면 방 목록 요청
    if(!$('screen-lobby').classList.contains('hidden')) {
      ws.send(JSON.stringify({type:'get_room_list'}));
    }
    // 핑 타이머
    if(pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(()=>{
      if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({type:'ping'}));
      else clearInterval(pingTimer);
    }, 20000);
  };

  ws.onclose = (e) => {
    wsReady = false;
    console.log('[WS] 끊김', e.code);
    setBanner('err','🔴 서버 연결 끊김 — 재연결 중...');
    setLobbyBtns(false);
    // 3초 후 재연결
    setTimeout(initWS, 3000);
  };

  ws.onerror = (e) => {
    console.error('[WS] 오류', e);
    setBanner('err','🔴 연결 오류');
    // onclose가 이어서 호출되므로 재연결은 onclose에서 처리
  };

  ws.onmessage = (ev) => {
    let m; try{ m=JSON.parse(ev.data); }catch{ return; }
    handleMsg(m);
  };
}

function wsSend(obj) {
  if(!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[WS] 전송불가 (연결안됨):', obj.type);
    notify('서버에 연결 중입니다. 잠시 후 다시 시도하세요.','warn');
    return false;
  }
  ws.send(JSON.stringify(obj));
  return true;
}

function setBanner(type, text) {
  // 대기실 상태
  const e=$('connSt'); if(e){ e.className='conn-'+type; e.textContent=text; }
  // 로비 상태
  const lb=$('lobbyConnSt');
  if(lb){
    if(type==='ok'){
      lb.style.cssText='width:100%;max-width:420px;padding:8px 14px;border-radius:8px;font-size:12px;text-align:center;background:rgba(76,175,125,.15);border:1px solid rgba(76,175,125,.25);color:#7ecca1';
      lb.textContent='🟢 서버 연결됨 — 방을 만들거나 참가하세요';
    } else if(type==='err'){
      lb.style.cssText='width:100%;max-width:420px;padding:8px 14px;border-radius:8px;font-size:12px;text-align:center;background:rgba(224,82,82,.15);border:1px solid rgba(224,82,82,.25);color:#f08080';
      lb.textContent='🔴 서버 연결 실패 — 재연결 중...';
    } else {
      lb.style.cssText='width:100%;max-width:420px;padding:8px 14px;border-radius:8px;font-size:12px;text-align:center;background:rgba(212,168,67,.1);border:1px solid rgba(212,168,67,.2);color:var(--gold)';
      lb.textContent='🔄 서버 연결 중...';
    }
  }
}

function setLobbyBtns(connected) {
  ['btnCreateRoom','btnJoinCode'].forEach(id=>{
    const b=$(id); if(!b)return;
    b.disabled=!connected;
    b.style.opacity=connected?'1':'0.4';
  });
  if(!connected){
    const rl=$('roomList');
    if(rl)rl.innerHTML='<div class="rl-empty">🔄 서버 연결 중... 잠시만 기다려주세요.</div>';
  }
}

// ══════════════════════════════════════
// 서버 메시지 처리
// ══════════════════════════════════════
function handleMsg(m) {
  console.log('[WS recv]', m.type);
  switch(m.type) {
    case 'room_list':
      renderRoomList(m.rooms);
      break;
    case 'room_created':
      MY_ROOM = m.room.code;
      renderWaitRoom(m.room);
      setBanner('ok','🟢 서버 연결됨');
      break;
    case 'room_joined':
      MY_ROOM = m.room.code;
      renderWaitRoom(m.room);
      setBanner('ok','🟢 서버 연결됨');
      break;
    case 'room_update':
      if(!$('screen-waiting').classList.contains('hidden'))
        renderWaitRoom(m.room);
      break;
    case 'game_start':
      onGameStart(m.room);
      break;
    case 'state_update':
      G = m.G;
      aiRunning=false; aiQueue=[];
      if(G.actionPhase==='choose'){
        pendAbility=null;wizMode=null;wizDiscSel=[];warlordTpi=null;selCard=null;abilityDone=false;
      }
      render();
      if(m.gameOver) showGameOver();
      break;
    case 'player_action':
      if(IS_HOST) applyRemote(m.playerId, m.action);
      break;
    case 'player_left':
      notify('플레이어가 나갔습니다.','warn');
      if(m.room && !$('screen-waiting').classList.contains('hidden'))
        renderWaitRoom(m.room);
      break;
    case 'chat':
      feed('💬',`<b>${esc(m.name)}:</b> ${esc(m.text)}`,'system');
      if(!$('screen-game').classList.contains('hidden')) renderFeed();
      break;
    case 'error':
      notify(m.msg,'bad');
      break;
    case 'pong':
      break;
  }
}

function syncState() {
  if(MY_ROOM==='LOCAL'||!IS_HOST||!G) return;
  wsSend({type:'sync_state', G, gameOver:!!G.gameOver});
}
function sendAction(action) {
  if(MY_ROOM==='LOCAL'||IS_HOST) return;
  wsSend({type:'player_action', action});
}

// ══════════════════════════════════════
// 로비 이벤트
// ══════════════════════════════════════
$('tabs').addEventListener('click', e=>{
  const t=e.target.closest('.tab'); if(!t)return;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
  t.classList.add('on');
  ['solo','host','join'].forEach(id=>$('t-'+id).classList.add('hidden'));
  $('t-'+t.dataset.t).classList.remove('hidden');
  if(t.dataset.t==='join') refreshRooms();
});

$('aiRow').addEventListener('click',e=>{
  const b=e.target.closest('.cnt-btn');if(!b)return;
  AI_SOLO=+b.dataset.n;
  document.querySelectorAll('#aiRow .cnt-btn').forEach(x=>x.classList.toggle('on',x===b));
});
$('wAiRow').addEventListener('click',e=>{
  const b=e.target.closest('.cnt-btn');if(!b)return;
  AI_WAIT=+b.dataset.n;
  document.querySelectorAll('#wAiRow .cnt-btn').forEach(x=>x.classList.toggle('on',x===b));
});

// ══════════════════════════════════════
// 방 목록
// ══════════════════════════════════════
function renderRoomList(rooms) {
  const list=$('roomList'); if(!list)return;
  if(!rooms||rooms.length===0){
    list.innerHTML='<div class="rl-empty">현재 열린 방이 없습니다.<br>방 만들기 탭에서 새 방을 만들어보세요!</div>';
    return;
  }
  list.innerHTML='';
  rooms.forEach(r=>{
    const full=r.playerCount>=r.maxPlayers;
    const avs=(r.players||[]).map(p=>`<span title="${esc(p.name)}">${p.avatar}</span>`).join('');
    const d=el('div','rl-item');
    d.innerHTML=`
      <div class="rl-info">
        <div class="rl-name">🏠 ${esc(r.title)}</div>
        <div class="rl-meta">
          <span class="dot"></span> 방장: <b>${esc(r.hostName)}</b>
          &nbsp;<span class="rl-avs">${avs}</span>
          <span class="rl-cnt">${r.playerCount}/${r.maxPlayers}명</span>
        </div>
      </div>
      ${full
        ? '<div class="rl-full">가득 참</div>'
        : `<button class="rl-join" onclick="tryQuickJoin('${r.code}')">입장 →</button>`}
    `;
    list.appendChild(d);
  });
}

function refreshRooms() {
  const ok = wsSend({type:'get_room_list'});
  if(ok) notify('방 목록 갱신','info');
}

// 방 목록 클릭 입장 (이름 확인 포함)
function tryQuickJoin(code){
  const nameInp=$('joinName');
  const name=(nameInp?.value||'').trim();
  if(!name){
    // 이름 입력창 강조 후 포커스
    if(nameInp){
      nameInp.style.borderColor='#e05252';
      nameInp.style.boxShadow='0 0 0 3px rgba(224,82,82,.2)';
      nameInp.focus();
      nameInp.placeholder='닉네임을 먼저 입력하세요! ←';
      setTimeout(()=>{
        nameInp.style.borderColor='';
        nameInp.style.boxShadow='';
        nameInp.placeholder='닉네임을 입력하세요...';
      },2500);
    }
    notify('닉네임을 먼저 입력해주세요!','warn');
    return;
  }
  quickJoin(code);
}

function quickJoin(code) {
  const name=($('joinName').value||'').trim()||'플레이어';
  MY_ID=uid(); IS_HOST=false;
  if(!wsSend({type:'join_room',playerId:MY_ID,name,code})) return;
  goWaitScreen(false);
}

// ══════════════════════════════════════
// 로비 액션
// ══════════════════════════════════════
function startSolo(){
  const name=($('soloName').value||'').trim()||'영주';
  MY_ID=uid();IS_HOST=true;MY_ROOM='LOCAL';
  const players=Array.from({length:1+AI_SOLO},(_,i)=>({
    id:i===0?MY_ID:uid(), name:i===0?name:`AI ${i}`,
    isAI:i!==0, avatar:AVATARS[i], color:P_COLORS[i],
  }));
  G=buildInitialG(players);
  enterGame();aiAutoAll();render();
}

function doCreateRoom(){
  sfxPlay('click');
  const name=($('hostName').value||'').trim()||'호스트';
  MY_ID=uid();IS_HOST=true;
  // WS 전송 먼저
  const ok=wsSend({type:'create_room',playerId:MY_ID,name,title:name+'의 방'});
  if(!ok) return;
  goWaitScreen(true);
}

function doJoinByCode(){
  const nameInp=$('joinName');
  const name=(nameInp?.value||'').trim();
  if(!name){
    if(nameInp){nameInp.style.borderColor='#e05252';nameInp.focus();setTimeout(()=>nameInp.style.borderColor='',2000);}
    notify('닉네임을 먼저 입력해주세요!','warn');return;
  }
  const code=($('joinCode').value||'').trim().toUpperCase();
  if(code.length<4){notify('방 코드를 입력하세요!','warn');return;}
  MY_ID=uid();IS_HOST=false;
  const ok=wsSend({type:'join_room',playerId:MY_ID,name,code});
  if(!ok) return;
  goWaitScreen(false);
}

function goWaitScreen(isHost){
  $('screen-lobby').classList.add('hidden');
  $('screen-waiting').classList.remove('hidden');
  $('aiWaitWrap').classList.toggle('hidden',!isHost);
  $('hostStartWrap').classList.toggle('hidden',!isHost);
  $('waitMsg').classList.toggle('hidden',isHost);
}

function goBackToLobby(){
  sfxPlay('click');
  // WS 연결 유지하되 방에서 나가기
  if(ws && ws.readyState===1 && MY_ROOM && MY_ROOM!=='LOCAL'){
    ws.close(); // 연결 끊으면 서버가 자동으로 방에서 제거
  }
  MY_ROOM=null; MY_ID=null; IS_HOST=false;
  $('screen-waiting').classList.add('hidden');
  $('screen-lobby').classList.remove('hidden');
  // 재연결
  setTimeout(initWS, 300);
}

function renderWaitRoom(room){
  const ce=$('wCode');if(ce)ce.textContent=room.code;
  const cnt=$('wCount');if(cnt)cnt.textContent=`${room.playerCount}명 대기 중`;
  const list=$('wList');if(!list)return;
  list.innerHTML='';
  (room.players||[]).forEach((p,i)=>{
    const isMe=p.id===MY_ID;
    const d=el('div','w-player'+(i===0?' host':''));
    d.innerHTML=`
      <span class="dot"></span>
      <span style="font-size:16px">${p.avatar||'🧙'}</span>
      <span style="font-size:13px;font-weight:700;color:${isMe?'#c39bd3':'var(--text)'}">
        ${esc(p.name)}${isMe?' <span class="tag tag-you">나</span>':''}
        ${p.isAI?'<span class="tag tag-ai">AI</span>':''}
      </span>
      ${i===0?'<span style="margin-left:auto;font-size:9px;color:var(--gold)">HOST</span>':''}
    `;
    list.appendChild(d);
  });
}

function hostStart(){if(!IS_HOST)return;sfxPlay('build');wsSend({type:'start_game',aiCount:AI_WAIT});}
function copyCode(){navigator.clipboard?.writeText(MY_ROOM||'').then(()=>notify('코드 복사됨!','ok'));}

// ══════════════════════════════════════
// 게임 시작
// ══════════════════════════════════════
function onGameStart(room){
  if(IS_HOST){
    G=buildInitialG(room.players);
    enterGame();aiAutoAll();syncState();render();
  } else {
    enterGame();
    const m=$('mainArea');
    if(m)m.innerHTML='<div class="banner bn-wait"><div class="bn-ico">⏳</div><div><div class="bn-title">게임 시작 중...</div><div class="bn-desc">호스트에서 데이터를 받는 중입니다.</div></div></div>';
  }
}

function enterGame(){
  $('screen-lobby').classList.add('hidden');
  $('screen-waiting').classList.add('hidden');
  $('screen-game').classList.remove('hidden');
  if(MY_ROOM!=='LOCAL')$('chatBar').classList.remove('hidden');
}

function goLobby(){
  $('goModal').classList.add('hidden');
  $('screen-game').classList.add('hidden');
  $('chatBar').classList.add('hidden');
  $('screen-lobby').classList.remove('hidden');
  G=null;MY_ROOM=null;IS_HOST=false;
  selCard=null;aiQueue=[];aiRunning=false;
  pendAbility=null;wizMode=null;wizDiscSel=[];warlordTpi=null;
  wsSend({type:'get_room_list'});
}

function sendChat(){
  const inp=$('chatInp');
  const t=(inp?.value||'').trim();if(!t)return;
  const n=G?.players.find(p=>p.id===MY_ID)?.name||'나';
  wsSend({type:'chat',name:n,text:t});
  inp.value='';
  feed('💬',`<b>${esc(n)}:</b> ${esc(t)}`,'system');
  renderFeed();
}

// ══════════════════════════════════════
// 원격 행동 (호스트)
// ══════════════════════════════════════
function applyRemote(pid,action){
  const pi=G.players.findIndex(p=>p.id===pid);
  if(pi<0)return;
  switch(action.type){
    case 'select_char': execSelectChar(pi,action.charId); break;
    case 'take_gold':   execTakeGold(pi); break;
    case 'draw_card':   execDrawCard(pi); break;
    case 'choose_draw': execChooseDraw(pi,action.uid); break;
    case 'build':       execBuild(pi,action.uid); break;
    case 'ability':     execAbility(pi,action); break;
    case 'end_turn':    execEndTurn(pi); break;
  }
}

// ══════════════════════════════════════
// 캐릭터 선택
// ══════════════════════════════════════
function aiAutoAll(){
  while(G.phase==='select_character'&&G.selIdx<G.players.length){
    const pi=G.selOrder[G.selIdx];
    if(pi===myIdx())break;
    if(!G.players[pi].isAI&&MY_ROOM!=='LOCAL')break;
    if(G.availChars.length){
      const pick=G.availChars.splice(Math.floor(Math.random()*G.availChars.length),1)[0];
      G.selectedChars[pick.id]=pi;G.players[pi].selectedCharacter=pick;
    }
    G.selIdx++;
  }
}

function selectCharacter(charId){
  if(!isMyCS())return;
  sfxPlay('ability');
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction({type:'select_char',charId});return;}
  execSelectChar(myIdx(),charId);
}
function execSelectChar(pi,charId){
  if(G.phase!=='select_character'||G.selOrder[G.selIdx]!==pi)return;
  const ch=G.availChars.find(c=>c.id===charId);if(!ch)return;
  G.selectedChars[ch.id]=pi;G.players[pi].selectedCharacter=ch;
  G.availChars=G.availChars.filter(c=>c.id!==charId);G.selIdx++;
  feed('🎭',`<b>${G.players[pi].name}</b>이(가) 캐릭터를 선택했습니다.`,'system');
  aiAutoAll();
  if(G.selIdx>=G.players.length)beginTurns();
  syncState();render();
}

function beginTurns(){
  G.phase='player_turn';G.curCharIdx=1;
  feed('⚔️','<b>행동 단계 시작!</b> 1→8번 순서.','system');
  advChar(1);
}
function advChar(idx){
  if(idx>8){if(G.players.some(p=>p.complete)){resolveGameOver();return;}nextRound();return;}
  G.curCharIdx=idx;
  if(G.assassinTarget===idx){
    const ki=Object.entries(G.selectedChars).find(([k])=>+k===idx)?.[1];
    if(ki!==undefined){feed('💀',`<b>${G.players[ki].name}</b>이(가) 암살당해 스킵!`,'combat');advChar(idx+1);return;}
  }
  const entry=Object.entries(G.selectedChars).find(([k])=>+k===idx);
  if(!entry){advChar(idx+1);return;}
  const pi=+entry[1];
  if(G.thiefTarget===idx&&G.thiefPi!==null&&G.thiefPi!==pi){
    const st=G.players[pi].gold;
    G.players[G.thiefPi].gold+=st;G.players[pi].gold=0;
    feed('🦹',`<b>${G.players[G.thiefPi].name}(도둑)</b>이(가) 💰${st} 탈취!`,'combat');
  }
  G.curPi=pi;G.actionPhase='choose';
  G.players[pi].abilityUsed=false;
  G.players[pi].buildsLeft=G.players[pi].selectedCharacter?.id===7?3:1;
  if(pi===myIdx()){abilityDone=false;sfxPlay('turn');feed('✨',`<b>내 턴!</b> 수입을 선택하세요.`,'system');}
  else if(G.players[pi].isAI){enqueueAI(pi);}
  else{feed('⏳',`<b>${G.players[pi].name}</b>의 턴입니다.`,'system');}
}

// ══════════════════════════════════════
// 수입
// ══════════════════════════════════════
function takeGold(){
  if(!isMyTurn()||G.actionPhase!=='choose')return;
  sfxPlay('gold');
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction({type:'take_gold'});return;}
  execTakeGold(myIdx());
}
function execTakeGold(pi){
  const p=G.players[pi];p.gold+=2;
  feed('💰',`<b>${p.name}</b> 💰+2 (보유: ${p.gold}💰)`,'gold');
  applyIncome(pi);
  if(p.selectedCharacter?.id===7){const c1=deckPop(),c2=deckPop();if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);feed('🏗️',`<b>${p.name}(건축가)</b> 카드+2`,'ability');}
  G.actionPhase='build';syncState();render();
  if(pi===myIdx())notify('💰 금화 2개!','ok');
}

function drawCard(){
  if(!isMyTurn()||G.actionPhase!=='choose')return;
  sfxPlay('ability');
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction({type:'draw_card'});return;}
  execDrawCard(myIdx());
}
function execDrawCard(pi){
  const p=G.players[pi];
  const hasLib=p.city.some(d=>d.id==='library');
  const hasObs=p.city.some(d=>d.id==='observatory');
  if(hasObs){G._obsCards=[deckPop(),deckPop(),deckPop()].filter(Boolean);G.actionPhase='observatory';syncState();render();return;}
  if(hasLib){const c1=deckPop(),c2=deckPop();if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);feed('📚',`<b>${p.name}(도서관)</b> 카드 2장`,'ability');}
  else{G._drawOpts=[deckPop(),deckPop()].filter(Boolean);G.actionPhase='draw_choice';syncState();render();return;}
  applyIncome(pi);
  if(p.selectedCharacter?.id===7){const c1=deckPop(),c2=deckPop();if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);}
  G.actionPhase='build';syncState();render();
}

function chooseDraw(u){
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction({type:'choose_draw',uid:u});return;}
  execChooseDraw(myIdx(),u);
}
function execChooseDraw(pi,u){
  const opts=G._drawOpts||G._obsCards||[];
  const ch=opts.find(c=>c.uid===u);if(!ch)return;
  G.players[pi].hand.push(ch);G.discard.push(...opts.filter(c=>c.uid!==u));
  feed('🃏',`<b>${G.players[pi].name}</b> 카드 선택`,'card');
  G._drawOpts=null;G._obsCards=null;
  applyIncome(pi);
  if(G.players[pi].selectedCharacter?.id===7){const c1=deckPop(),c2=deckPop();if(c1)G.players[pi].hand.push(c1);if(c2)G.players[pi].hand.push(c2);}
  G.actionPhase='build';syncState();render();
  if(pi===myIdx())notify('🃏 카드 선택!','ok');
}

function applyIncome(pi){
  const p=G.players[pi],ch=p.selectedCharacter;if(!ch)return;
  const cm={4:'yellow',5:'blue',6:'green',8:'red'};
  let b=0;if(cm[ch.id]){b=p.city.filter(d=>d.color===cm[ch.id]).length;if(ch.id===6)b+=1;}
  if(b>0){p.gold+=b;feed('✨',`<b>${ch.icon}${ch.name}</b> 수입 💰+${b} (총 ${p.gold})`,'gold');}
}

// ══════════════════════════════════════
// 건설
// ══════════════════════════════════════
function buildDistrict(){
  if(!selCard){sfxPlay('error');notify('건물을 선택하세요!','warn');return;}
  sfxPlay('build');
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction({type:'build',uid:selCard});return;}
  execBuild(myIdx(),selCard);
}
function execBuild(pi,u){
  const p=G.players[pi];
  if(p.buildsLeft<=0){if(pi===myIdx())notify('건설 횟수 초과!','warn');return;}
  const card=p.hand.find(c=>c.uid===u);if(!card)return;
  if(p.gold<card.cost){if(pi===myIdx())notify('금화 부족!','warn');return;}
  if(p.city.find(c=>c.id===card.id)){if(pi===myIdx())notify('이미 건설됨!','warn');return;}
  p.gold-=card.cost;p.hand=p.hand.filter(c=>c.uid!==u);p.city.push(card);p.buildsLeft--;
  if(pi===myIdx())selCard=null;
  feed('🏛️',`<b>${p.name}</b> ${card.icon}<b>${card.name}</b> 건설! (💰${p.gold})`,'build');
  if(p.selectedCharacter?.id===4){G.players.forEach(x=>x.crown=false);p.crown=true;feed('👑',`<b>${p.name}(왕)</b> 왕관!`,'system');}
  if(p.city.length>=7){
    if(!G.players.some(x=>x.complete)){p.firstComplete=true;p.complete=true;feed('🎉',`<b>${p.name}</b> 도시 완성!`,'win');}
    else p.complete=true;
  }
  syncState();render();if(pi===myIdx())notify(`🏛️ ${card.name} 건설!`,'ok');
}

// ══════════════════════════════════════
// 능력
// ══════════════════════════════════════
function useAbility(){
  if(!isMyTurn())return;if(abilityDone){sfxPlay('error');notify('이미 사용했습니다!','warn');return;}
  sfxPlay('ability');
  const ch=G.players[myIdx()].selectedCharacter;if(!ch)return;
  if(ch.id===1){pendAbility='assassin';render();notify('🗡️ 우측에서 암살할 캐릭터 선택','warn');return;}
  if(ch.id===2){pendAbility='thief';render();notify('🦹 우측에서 훔칠 캐릭터 선택 (1·2번 제외)','warn');return;}
  if(ch.id===3){pendAbility='wizard';wizMode=null;wizDiscSel=[];render();return;}
  if(ch.id===8){pendAbility='warlord';warlordTpi=null;render();notify('⚔️ 좌측에서 파괴할 플레이어 선택','warn');return;}
}
function selectAbilityTarget(charId){
  const action={type:'ability',abilityType:pendAbility,charId};
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction(action);pendAbility=null;render();return;}
  execAbility(myIdx(),action);
}
function execAbility(pi,action){
  const p=G.players[pi],ch=p.selectedCharacter;if(!ch)return;
  const at=action.abilityType;
  if(at==='assassin'){
    if(action.charId===ch.id){if(pi===myIdx())notify('자신은 불가!','warn');return;}
    G.assassinTarget=action.charId;p.abilityUsed=true;
    if(pi===myIdx()){pendAbility=null;abilityDone=true;}
    feed('🗡️',`<b>${p.name}(암살자)</b> <b>${CHARS.find(c=>c.id===action.charId)?.name}</b> 암살!`,'combat');
    if(pi===myIdx()){sfxPlay('assassin');notify('🗡️ 암살!','ok');}
  } else if(at==='thief'){
    if(action.charId<=2){if(pi===myIdx())notify('암살자/도둑 불가!','warn');return;}
    if(G.assassinTarget===action.charId){if(pi===myIdx())notify('암살된 캐릭터 불가!','warn');return;}
    G.thiefTarget=action.charId;G.thiefPi=pi;p.abilityUsed=true;
    if(pi===myIdx()){pendAbility=null;abilityDone=true;}
    feed('🦹',`<b>${p.name}(도둑)</b> 타깃: <b>${CHARS.find(c=>c.id===action.charId)?.name}</b>`,'ability');
    if(pi===myIdx())notify('🦹 타깃!','ok');
  } else if(at==='wizard_swap'){
    const tp=G.players[action.targetPi];
    if(tp){const tmp=p.hand;p.hand=tp.hand;tp.hand=tmp;feed('🔮',`<b>${p.name}(마술사)</b> <b>${tp.name}</b>과 손패 교환!`,'ability');}
    p.abilityUsed=true;
    if(pi===myIdx()){pendAbility=null;wizMode=null;abilityDone=true;notify('🔮 교환!','ok');}
  } else if(at==='wizard_discard'){
    const uids=action.uids||[];
    const disc=p.hand.filter(c=>uids.includes(c.uid));
    p.hand=p.hand.filter(c=>!uids.includes(c.uid));G.discard.push(...disc);
    for(let i=0;i<disc.length;i++){const d=deckPop();if(d)p.hand.push(d);}
    feed('🔮',`<b>${p.name}(마술사)</b> 카드 ${disc.length}장 교체!`,'ability');
    p.abilityUsed=true;
    if(pi===myIdx()){pendAbility=null;wizMode=null;wizDiscSel=[];abilityDone=true;notify('🔮 교체!','ok');}
  } else if(at==='warlord'){
    const tp=G.players[action.targetPi];
    const dist=tp?.city.find(c=>c.uid===action.distUid);
    if(dist&&tp){
      if(tp.selectedCharacter?.id===5&&G.assassinTarget!==5){if(pi===myIdx())notify('주교 건물은 파괴 불가!','warn');return;}
      if(tp.city.length>=7){if(pi===myIdx())notify('완성 플레이어 불가!','warn');return;}
      const cost=Math.max(0,dist.cost-1);
      if(p.gold<cost){if(pi===myIdx())notify(`💰${cost} 필요!`,'warn');return;}
      p.gold-=cost;tp.city=tp.city.filter(c=>c.uid!==action.distUid);G.discard.push(dist);
      feed('⚔️',`<b>${p.name}(장군)</b> <b>${tp.name}</b>의 ${dist.icon}<b>${dist.name}</b> 파괴! (💰-${cost})`,'combat');
      p.abilityUsed=true;
      if(pi===myIdx()){sfxPlay('assassin');pendAbility=null;warlordTpi=null;abilityDone=true;notify(`⚔️ 파괴!`,'ok');}
    }
  }
  syncState();render();
}
function cancelAbility(){pendAbility=null;wizMode=null;wizDiscSel=[];warlordTpi=null;selCard=null;render();}
function endTurn(){
  if(!isMyTurn())return;
  sfxPlay('click');
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction({type:'end_turn'});return;}
  execEndTurn(myIdx());
}
function execEndTurn(pi){
  if(G.curPi!==pi)return;
  pendAbility=null;wizMode=null;wizDiscSel=[];warlordTpi=null;selCard=null;
  feed('✅',`<b>${G.players[pi].name}</b> 턴 종료.`,'system');
  advChar(G.curCharIdx+1);syncState();render();
}

// ══════════════════════════════════════
// AI
// ══════════════════════════════════════
function enqueueAI(pi){aiQueue.push(...buildSteps(pi));if(!aiRunning)runQueue();}
function buildSteps(pi){
  const p=G.players[pi],ch=p.selectedCharacter,s=[];
  s.push({t:'ann',pi});
  if(ch?.id===1&&G.assassinTarget===null){const o=Object.entries(G.selectedChars).filter(([k,v])=>+k!==1&&+v!==pi);if(o.length){const t=o[Math.floor(Math.random()*o.length)];s.push({t:'assassin',pi,cid:+t[0]});}}
  if(ch?.id===2&&G.thiefTarget===null){const o=Object.entries(G.selectedChars).filter(([k,v])=>+k>2&&+v!==pi&&G.assassinTarget!==+k);if(o.length){const t=o[Math.floor(Math.random()*o.length)];s.push({t:'thief',pi,cid:+t[0]});}}
  if(p.gold<4||Math.random()>.4)s.push({t:'gold',pi});else s.push({t:'draw',pi});
  if(ch?.id===7)s.push({t:'arch',pi});
  if(ch?.id===3){const o=G.players.filter((_,i)=>i!==pi&&G.players[i].hand.length>p.hand.length);if(o.length){s.push({t:'wiz_swap',pi,ti:G.players.indexOf(o[0])});}}
  s.push({t:'income',pi});
  if(ch?.id===8&&Math.random()>.5){const en=G.players.filter((ep,ei)=>ei!==pi&&ep.city.length>0&&ep.city.length<7&&!(ep.selectedCharacter?.id===5&&G.assassinTarget!==5));if(en.length){const enemy=en[Math.floor(Math.random()*en.length)];const ei=G.players.indexOf(enemy);const cv=enemy.city.reduce((a,b)=>a.cost<b.cost?a:b);if(p.gold>=Math.max(0,cv.cost-1)+2)s.push({t:'warlord',pi,ei,uid:cv.uid});}}
  const maxB=ch?.id===7?3:1;let tg=p.gold;let nb=0;
  [...p.hand].filter(c=>!p.city.find(b=>b.id===c.id)).sort((a,b)=>b.cost-a.cost).forEach(d=>{if(nb>=maxB||tg<d.cost)return;tg-=d.cost;s.push({t:'build',pi,uid:d.uid});nb++;});
  if(ch?.id===4)s.push({t:'crown',pi});
  s.push({t:'next',pi});
  return s;
}
function runQueue(){
  if(!G||aiQueue.length===0){aiRunning=false;render();syncState();return;}
  aiRunning=true;const s=aiQueue.shift();applyStep(s);
  const d=s.t==='ann'?900:s.t==='next'?80:s.t==='income'?180:650;
  render();setTimeout(runQueue,d);
}
function applyStep(s){
  if(!G)return;const p=G.players[s.pi],ch=p?.selectedCharacter;
  switch(s.t){
    case 'ann': feed(ch?.icon||'⏳',`<b>${p.name}</b>(${ch?.name||'?'}) 턴.`,'system');break;
    case 'assassin': G.assassinTarget=s.cid;feed('🗡️',`<b>${p.name}(암살자)</b> ${CHARS.find(c=>c.id===s.cid)?.name} 암살!`,'combat');break;
    case 'thief': G.thiefTarget=s.cid;G.thiefPi=s.pi;feed('🦹',`<b>${p.name}(도둑)</b> 타깃!`,'ability');break;
    case 'gold': p.gold+=2;feed('💰',`<b>${p.name}</b> 💰+2 (${p.gold})`,'gold');break;
    case 'draw': {const c=deckPop();if(c){p.hand.push(c);feed('🃏',`<b>${p.name}</b> 뽑기`,'card');}break;}
    case 'arch': {const c1=deckPop(),c2=deckPop();if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);feed('🏗️',`<b>${p.name}(건축가)</b> 카드+2`,'ability');break;}
    case 'wiz_swap': {const tp=G.players[s.ti];if(tp){const tmp=p.hand;p.hand=tp.hand;tp.hand=tmp;feed('🔮',`<b>${p.name}(마술사)</b> 손패 교환!`,'ability');}break;}
    case 'income': applyIncome(s.pi);break;
    case 'warlord': {const tp=G.players[s.ei],d=tp?.city.find(c=>c.uid===s.uid);if(d&&tp){const cost=Math.max(0,d.cost-1);if(p.gold>=cost){p.gold-=cost;tp.city=tp.city.filter(c=>c.uid!==s.uid);G.discard.push(d);feed('⚔️',`<b>${p.name}(장군)</b> ${d.icon}<b>${d.name}</b> 파괴!`,'combat');}}break;}
    case 'build': {const d=p.hand.find(c=>c.uid===s.uid);if(d&&p.gold>=d.cost&&!p.city.find(b=>b.id===d.id)){p.gold-=d.cost;p.hand=p.hand.filter(c=>c.uid!==s.uid);p.city.push(d);feed('🏛️',`<b>${p.name}</b> ${d.icon}<b>${d.name}</b> 건설!`,'build');if(p.city.length>=7){if(!G.players.some(x=>x.complete)){p.firstComplete=true;p.complete=true;feed('🎉',`<b>${p.name}</b> 도시 완성!`,'win');}else p.complete=true;}}break;}
    case 'crown': G.players.forEach(x=>x.crown=false);p.crown=true;feed('👑',`<b>${p.name}(왕)</b> 왕관!`,'system');break;
    case 'next': if(G.players.some(x=>x.complete)){aiQueue=[];resolveGameOver();render();syncState();return;}advChar(G.curCharIdx+1);break;
  }
}
function nextRound(){
  G.round++;G.phase='select_character';
  const ci=Math.max(0,G.players.findIndex(p=>p.crown));
  G.selOrder=Array.from({length:G.players.length},(_,i)=>(ci+i)%G.players.length);
  G.selIdx=0;G.selectedChars={};G.assassinTarget=null;G.thiefTarget=null;G.thiefPi=null;
  G.players.forEach(p=>{p.selectedCharacter=null;p.abilityUsed=false;p.buildsLeft=1;});
  G.availChars=shuffle([...CHARS]);G.availChars.pop();
  G._drawOpts=null;G._obsCards=null;
  pendAbility=null;wizMode=null;selCard=null;aiQueue=[];aiRunning=false;abilityDone=false;
  feed('🔄',`<b>라운드 ${G.round}</b> 시작!`,'system');
  aiAutoAll();syncState();
}
function resolveGameOver(){
  G.gameOver=true;
  const s=G.players.map(p=>({...p,score:calcScore(p)})).sort((a,b)=>b.score-a.score);
  feed('🏆',`게임 종료! <b>${s[0].name}</b> 승리! (${s[0].score}점)`,'win');
  syncState();render();setTimeout(showGameOver,800);
}
function showGameOver(){
  sfxPlay('win');
  const s=G.players.map(p=>({...p,score:calcScore(p)})).sort((a,b)=>b.score-a.score);
  $('goWinner').textContent=`🎉 ${s[0].name} 승리!`;
  const list=$('goScores');list.innerHTML='';
  ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣'].forEach((m,i)=>{
    const p=s[i];if(!p)return;
    const li=el('li','go-sc');li.innerHTML=`<span>${m} ${p.avatar} ${esc(p.name)}</span><span class="go-pts">${p.score}점</span>`;
    list.appendChild(li);
  });
  $('goModal').classList.remove('hidden');
}

// ══════════════════════════════════════
// RENDER
// ══════════════════════════════════════
function render(){
  if(!G)return;
  rTopbar();rTurnBar();rPlayerList();renderFeed();rMain();rCharPanel();rCityPanel();rActionBar();
}
function rTopbar(){
  const mi=myIdx(),me=G.players[mi];
  $('tbRound').textContent=G.round;$('tbDeck').textContent=G.deck.length;
  $('tbGold').textContent=me.gold;$('tbHand').textContent=me.hand.length;
  $('tbCity').textContent=me.city.length;$('tbScore').textContent=calcScore(me);
  const ph=$('tbPhase');
  if(G.phase==='select_character'){ph.textContent='🎭 캐릭터 선택';ph.className='tb-phase ph-sel';}
  else{const ch=CHARS.find(c=>c.id===G.curCharIdx);ph.textContent=`${ch?.icon||'⚔️'} ${ch?.name||'?'} 행동`;ph.className='tb-phase ph-act';}
}
function rTurnBar(){
  const bar=$('turnBar');bar.innerHTML='';
  const lbl=el('div','to-lbl');lbl.textContent=G.phase==='select_character'?'선택 순서':'행동 순서';bar.appendChild(lbl);
  if(G.phase==='select_character'){
    G.selOrder.forEach((pi,i)=>{
      const p=G.players[pi],done=i<G.selIdx,cur=i===G.selIdx;
      const d=el('div','to-item'+(done?' done':'')+(cur?' cur':''));
      d.innerHTML=`<div class="to-av" style="border-color:${p.color};background:${p.color}22">${p.avatar}</div><span style="font-size:10px">${p.name.slice(0,4)}${cur?' ▶':done?' ✓':''}</span>`;
      bar.appendChild(d);
      if(i<G.selOrder.length-1){const a=el('div','to-arr');a.textContent='→';bar.appendChild(a);}
    });
  }else{
    for(let cid=1;cid<=8;cid++){
      const pi=G.selectedChars[cid];if(pi===undefined)continue;
      const p=G.players[pi],ch=CHARS.find(c=>c.id===cid);
      const done=G.curCharIdx>cid,cur=G.curCharIdx===cid,dead=G.assassinTarget===cid;
      const d=el('div','to-item'+(done?' done':'')+(cur?' cur':'')+(dead?' dead':''));
      d.title=`${ch?.name}—${p.name}`;
      d.innerHTML=`<span style="font-size:12px">${dead?'💀':ch?.icon}</span><span style="font-size:9px;color:${ch?.tc}">${cid}.${ch?.name?.slice(0,2)}</span><div class="to-av" style="border-color:${p.color};background:${p.color}22">${p.avatar}</div>${cur?'<span style="font-size:8px;color:var(--gold2)">▶</span>':done?'<span style="font-size:9px;color:#4caf7d">✓</span>':''}`;
      bar.appendChild(d);
      if(Object.keys(G.selectedChars).some(k=>+k>cid)){const a=el('div','to-arr');a.textContent='→';bar.appendChild(a);}
    }
  }
}
function rPlayerList(){
  const cont=$('pList');cont.innerHTML='';const mi=myIdx();
  G.players.forEach((p,i)=>{
    const isTurn=G.phase==='player_turn'&&G.curPi===i,isMe=i===mi;
    const isDead=G.assassinTarget!==null&&p.selectedCharacter?.id===G.assassinTarget&&G.phase==='player_turn';
    const isWarlord=pendAbility==='warlord'&&!isMe&&p.city.length>0&&p.city.length<7&&!(p.selectedCharacter?.id===5&&G.assassinTarget!==5);
    const isWizSwap=pendAbility==='wizard'&&wizMode==='swap'&&!isMe;
    const d=el('div','pcard'+(isMe?' me':'')+(isTurn?' active':'')+(isDead?' dead':'')+(isWarlord||isWizSwap?' tsel':(!isMe?' clickable':'')));
    if(isWarlord)d.onclick=()=>{warlordTpi=i;renderWarlordOverlay(i);};
    else if(isWizSwap)d.onclick=()=>doWizSwap(i);
    else if(!isMe)d.onclick=()=>openEnemyCity(i);
    // 직업(캐릭터) 아이콘 표시 규칙:
    // - 나(isMe): 내 캐릭터는 항상 표시
    // - 다른 사람: 해당 플레이어의 턴이 실제로 됐을 때만(isTurn) 표시
    // - 그 외(대기 중, 선택 단계 등): ❓ 으로 숨김
    const ci = isMe && p.selectedCharacter ? p.selectedCharacter.icon
             : isTurn && p.selectedCharacter ? p.selectedCharacter.icon
             : '❓';
    const pips=p.city.map(c=>`<div class="pip" style="background:${CCSS[c.color]};border-color:${CCSS[c.color]}55" title="${c.name}"></div>`).join('');
    d.innerHTML=`
      <div class="pc-top">
        <div class="pc-av" style="background:${p.color}22;border-color:${p.color}">${p.avatar}</div>
        <div style="flex:1;min-width:0">
          <div class="pc-name" style="color:${isMe?'#c39bd3':p.color}">${esc(p.name)}${isMe?' (나)':''}</div>
          <div class="pc-tags">
            ${!p.isAI?'<span class="tag" style="background:rgba(91,155,213,.12);color:#89c4f4;border-color:rgba(91,155,213,.2);font-size:8px">👤</span>':''}
            ${p.isAI?'<span class="tag tag-ai">AI</span>':''}
            ${isTurn?'<span class="tag tag-turn">▶</span>':''}
            ${p.crown?'<span class="tag tag-crown">👑</span>':''}
            ${p.complete?'<span class="tag tag-done">완성</span>':''}
            ${isDead?'<span class="tag tag-dead">💀</span>':''}
          </div>
        </div>
        <div class="pc-char">${ci}</div>
      </div>
      <div class="pc-stats">
        <span class="pc-stat">💰<strong>${p.gold}</strong></span>
        <span class="pc-stat">🃏<strong>${p.hand.length}</strong></span>
        <span class="pc-stat">🏛️<strong>${p.city.length}/7</strong></span>
        <span class="pc-stat">⭐<strong>${calcScore(p)}</strong></span>
      </div>
      ${p.city.length?`<div class="pc-pips">${pips}</div>`:''}
    `;
    cont.appendChild(d);
  });
}
function renderFeed(){
  if(!G)return;
  renderLogBar();
}

function renderLogBar(){
  if(!G)return;
  const bar=$('logBarInner'); if(!bar)return;
  bar.innerHTML='';
  // 위에서 아래로: 최신 항목이 맨 위 (최대 3줄 표시)
  const visible=G.log.slice(0,3);
  visible.forEach((e,i)=>{
    const d=el('div',`log-entry ev-${e.type||'system'}${i===0?' ev-latest':''}`);
    d.innerHTML=`<span class="log-ico">${e.icon}</span><span class="log-txt">${e.html}</span>`;
    bar.appendChild(d);
  });
  const cnt=$('logBarCnt');
  if(cnt)cnt.textContent=`총 ${G.log.length}건`;
}
function rMain(){const main=$('mainArea');main.innerHTML='';if(!G)return;if(G.phase==='select_character')rCharSel(main);else rTurnPhase(main);}
function rCharSel(main){
  const mi=myIdx(),myT=G.selOrder[G.selIdx]===mi,me=G.players[mi];
  const ban=el('div','banner bn-sel');
  ban.innerHTML=`<div class="bn-ico">🎭</div><div><div class="bn-title" style="color:#c39bd3">${myT?'⚡ 캐릭터를 선택하세요!':'⏳ 선택 대기 중...'}</div><div class="bn-desc">${myT?`<b>${G.availChars.length}개</b> 중 하나를 선택`:me.selectedCharacter?`<b>${me.selectedCharacter.icon}${me.selectedCharacter.name}</b> 선택 완료`:'다른 플레이어 선택 중...'}</div></div>`;
  main.appendChild(ban);
  if(!myT&&me.selectedCharacter){
    const s=el('div','my-strip');const ch=me.selectedCharacter;
    s.style.cssText=`background:${ch.bg};border-color:${ch.bc};border-radius:9px;`;
    s.innerHTML=`<div style="font-size:36px">${ch.icon}</div><div><div style="font-size:9px;color:var(--dim);letter-spacing:2px;margin-bottom:2px">선택한 캐릭터</div><div style="font-size:14px;font-weight:800;color:${ch.tc}">${ch.id}. ${ch.name}</div><div style="font-size:10px;color:var(--dim2);margin-top:2px;line-height:1.5">${ch.abilityShort}</div></div>`;
    main.appendChild(s);return;
  }
  if(!myT)return;
  const t=el('div','sect');t.textContent='선택 가능한 캐릭터';main.appendChild(t);
  const grid=el('div','csel-grid');
  G.availChars.forEach(ch=>{
    const c=el('div','csel-card');c.style.cssText=`background:${ch.bg};border-color:${ch.bc};`;
    c.innerHTML=`<span class="csel-ico">${ch.icon}</span><div class="csel-num" style="color:${ch.tc}">${ch.id}번</div><div class="csel-name" style="color:${ch.tc}">${ch.name}</div><div class="csel-ab">${ch.ability}</div>`;
    c.onmouseover=()=>{c.style.transform='translateY(-3px)';c.style.boxShadow=`0 7px 18px rgba(0,0,0,.4),0 0 16px ${ch.tc}35`;};
    c.onmouseout=()=>{c.style.transform='';c.style.boxShadow='';};
    c.onclick=()=>selectCharacter(ch.id);grid.appendChild(c);
  });
  main.appendChild(grid);
}
function rTurnPhase(main){
  const mi=myIdx(),me=G.players[mi],myT=isMyTurn(),ch=me.selectedCharacter,curP=G.players[G.curPi];
  const isDC=myT&&G.actionPhase==='draw_choice',isObs=myT&&G.actionPhase==='observatory';
  const ban=el('div',`banner ${myT?'bn-act':'bn-wait'}`);
  ban.innerHTML=`<div class="bn-ico">${myT?'⚡':curP?.selectedCharacter?.icon||'⏳'}</div><div><div class="bn-title" style="color:${myT?'var(--gold2)':'var(--text)'}">${myT?'⚡ 내 턴!':aiRunning?`${curP?.name} 행동 중...`:`${curP?.name}의 턴`}</div><div class="bn-desc">${myT?G.actionPhase==='choose'?'💰 금화 받기 또는 🃏 카드 뽑기 선택':isDC?'카드 1장을 선택하세요':isObs?'3장 중 1장 선택 (천문대)':pendAbility?'타깃 선택 또는 취소':'🏛️ 건설하거나 턴 종료':'기다리는 중...'}</div></div>`;
  main.appendChild(ban);
  if(ch){
    const s=el('div','my-strip');s.style.cssText=`background:${ch.bg};border-color:${ch.bc};border-radius:9px;`;
    s.innerHTML=`<div style="font-size:30px">${ch.icon}</div><div style="flex:1"><div style="font-size:9px;color:var(--dim);letter-spacing:2px;margin-bottom:1px">내 캐릭터</div><div style="font-size:13px;font-weight:800;color:${ch.tc}">${ch.id}. ${ch.name}</div><div style="font-size:10px;color:var(--dim2);margin-top:2px;line-height:1.5">${ch.abilityShort}</div></div><div style="text-align:right;font-size:11px;color:var(--dim2);flex-shrink:0;line-height:2">💰${me.gold}<br>🃏${me.hand.length}<br>⭐${calcScore(me)}${ch.id===7?`<br><span style="color:#89c4f4;font-size:9px">건설${me.buildsLeft}회</span>`:''}</div>`;
    main.appendChild(s);
  }
  if(pendAbility){
    const msgs={assassin:'🗡️ 우측 캐릭터에서 암살할 캐릭터 클릭',thief:'🦹 우측 캐릭터에서 훔칠 캐릭터 클릭 (1·2번 제외)',warlord:'⚔️ 좌측 플레이어 클릭 → 건물 선택',wizard:'🔮 아래에서 능력 선택'};
    const h=el('div','hint');h.innerHTML=msgs[pendAbility]||'';main.appendChild(h);
  }
  if(pendAbility==='wizard'&&wizMode===null){
    const wp=el('div','wiz-panel');
    wp.innerHTML=`<div class="wiz-title">🔮 마술사 능력 선택</div>`;
    const b1=el('button','wiz-btn');b1.innerHTML='① 다른 플레이어와 손패 전체 교환<br><small style="color:var(--dim)">👈 좌측에서 플레이어 클릭</small>';b1.onclick=()=>{wizMode='swap';rPlayerList();render();};
    const b2=el('button','wiz-btn');b2.innerHTML='② 손패 일부 버리고 새로 뽑기<br><small style="color:var(--dim)">아래 손패에서 버릴 카드 선택</small>';b2.onclick=()=>{wizMode='discard';wizDiscSel=[];render();};
    wp.appendChild(b1);wp.appendChild(b2);main.appendChild(wp);
  }
  if((isDC&&G._drawOpts)||(isObs&&G._obsCards)){
    const cards=G._drawOpts||G._obsCards;
    const t=el('div','sect');t.textContent=isObs?'🔭 천문대: 3장 중 1장 선택':'🃏 카드 선택 (1장 고르기)';main.appendChild(t);
    const grid=el('div','hand-grid');
    cards.forEach(card=>{const c=mkCard(card);c.classList.add('pick');c.onclick=()=>chooseDraw(card.uid);grid.appendChild(c);});
    main.appendChild(grid);return;
  }
  if(myT&&G.actionPhase==='choose'){
    const t=el('div','sect');t.textContent='수입 선택';main.appendChild(t);
    const row=el('div','inc-row');
    const g=el('div','inc-btn inc-g');g.innerHTML=`<div class="inc-ico">💰</div><div class="inc-lbl">금화 2개 받기</div><div class="inc-sub">안정적 수입</div>`;g.onclick=takeGold;
    const c=el('div','inc-btn inc-c');c.innerHTML=`<div class="inc-ico">🃏</div><div class="inc-lbl">카드 뽑기</div><div class="inc-sub">2장 보고 1장 선택 (덱: ${G.deck.length}장)</div>`;c.onclick=drawCard;
    row.appendChild(g);row.appendChild(c);main.appendChild(row);
  }
  const ht=el('div','sect');ht.textContent=`🃏 내 손패 (${me.hand.length}장)`;main.appendChild(ht);
  const isWD=myT&&pendAbility==='wizard'&&wizMode==='discard';
  if(!me.hand.length){const e=el('div','empty');e.textContent='손패 없음';main.appendChild(e);}
  else{
    const grid=el('div','hand-grid');
    me.hand.forEach(card=>{
      const c=mkCard(card);
      if(selCard===card.uid)c.classList.add('sel');
      if(wizDiscSel.includes(card.uid))c.classList.add('dsel');
      if(isWD){c.onclick=()=>{if(wizDiscSel.includes(card.uid))wizDiscSel=wizDiscSel.filter(u=>u!==card.uid);else wizDiscSel.push(card.uid);render();};}
      else if(myT&&G.actionPhase==='build'){
        if(me.gold<card.cost||me.buildsLeft<=0)c.classList.add('disabled');
        else c.onclick=()=>{selCard=selCard===card.uid?null:card.uid;render();};
      }else c.style.cursor='default';
      c.addEventListener('contextmenu',e2=>{e2.preventDefault();openTT(card);});
      grid.appendChild(c);
    });
    main.appendChild(grid);
    if(isWD&&wizDiscSel.length>0){
      const b=el('button','ab ab-purple');b.style.marginTop='7px';
      b.textContent=`🔮 ${wizDiscSel.length}장 버리고 새로 뽑기`;
      b.onclick=()=>{const a={type:'ability',abilityType:'wizard_discard',uids:wizDiscSel};if(MY_ROOM!=='LOCAL'&&!IS_HOST)sendAction(a);else execAbility(mi,a);};
      main.appendChild(b);
    }
  }
  const ct=el('div','sect');ct.textContent=`🏛️ 내 도시 (${me.city.length}/7) — ⭐${calcScore(me)}점`;main.appendChild(ct);
  if(!me.city.length){const e=el('div','empty');e.textContent='건물 없음';main.appendChild(e);}
  else{const grid=el('div','hand-grid');me.city.forEach(card=>{const c=mkCard(card);c.classList.add('disabled');c.style.pointerEvents='auto';c.style.cursor='pointer';c.onclick=()=>openTT(card);grid.appendChild(c);});main.appendChild(grid);}
  if(pendAbility==='warlord'&&warlordTpi!==null)renderWarlordOverlay(warlordTpi);
}
function doWizSwap(tpi){
  const a={type:'ability',abilityType:'wizard_swap',targetPi:tpi};
  if(MY_ROOM!=='LOCAL'&&!IS_HOST)sendAction(a);else execAbility(myIdx(),a);
}
function renderWarlordOverlay(tpi){
  const main=$('mainArea');const old=document.getElementById('woOv');if(old)old.remove();
  const tp=G.players[tpi];if(!tp)return;
  const wrap=el('div','wo-wrap');wrap.id='woOv';
  wrap.innerHTML=`<div class="wo-title">⚔️ ${esc(tp.name)}의 건물 — 파괴할 건물 선택</div>`;
  const grid=el('div','wo-grid');const p=G.players[myIdx()];
  tp.city.forEach(dist=>{
    const cost=Math.max(0,dist.cost-1),canAfford=p.gold>=cost;
    const c=mkCard(dist);
    if(!canAfford){c.classList.add('disabled');c.title=`💰${cost} 필요`;}
    else{
      c.onclick=()=>{const a={type:'ability',abilityType:'warlord',targetPi:tpi,distUid:dist.uid};if(MY_ROOM!=='LOCAL'&&!IS_HOST)sendAction(a);else execAbility(myIdx(),a);};
      const badge=el('div','wo-cost');badge.textContent=cost===0?'무료':`💰${cost}`;c.appendChild(badge);
    }
    grid.appendChild(c);
  });
  wrap.appendChild(grid);
  const cancel=el('button','ab ab-dim');cancel.style.marginTop='7px';cancel.textContent='✖️ 취소';cancel.onclick=cancelAbility;wrap.appendChild(cancel);
  main.appendChild(wrap);
}
function rCharPanel(){
  const list=$('charList');list.innerHTML='';const mi=myIdx(),myCh=G.players[mi].selectedCharacter;
  const isAT=pendAbility==='assassin',isTT=pendAbility==='thief';
  CHARS.forEach(ch=>{
    const pi=G.selectedChars[ch.id],isMine=pi===mi;
    const isRm=pi===undefined&&!G.availChars.find(c=>c.id===ch.id);
    const isDead=G.assassinTarget===ch.id,isThf=G.thiefTarget===ch.id;
    const canT=(isAT||isTT)&&ch.id!==myCh?.id&&!(isTT&&ch.id<=2)&&!(isTT&&G.assassinTarget===ch.id);
    const d=el('div','ci'+(isRm?' removed':'')+(isMine?' mine':'')+(canT?' tmode':''));
    d.style.cssText=`background:${isRm?'rgba(255,255,255,.02)':ch.bg};border-color:${isMine?ch.bc:'rgba(255,255,255,.05)'};`;
    d.innerHTML=`<div class="ci-head"><span class="ci-num">${ch.id}</span><span class="ci-ico">${ch.icon}</span><span class="ci-name" style="color:${ch.tc}">${ch.name}</span></div><div class="ci-ab">${ch.abilityShort}</div><div class="ci-badges">${isMine?'<span class="cbadge cb-mine">◀ 나</span>':''}${isDead?'<span class="cbadge cb-dead">💀</span>':''}${isThf?'<span class="cbadge cb-thf">🦹</span>':''}</div>`;
    if(canT)d.onclick=()=>selectAbilityTarget(ch.id);
    list.appendChild(d);
  });
}
function rCityPanel(){
  const panel=$('cityPanel');
  panel.innerHTML=`<div style="font-size:9px;letter-spacing:2px;color:var(--dim);margin-bottom:6px">다른 플레이어 도시</div>`;
  const mi=myIdx();
  G.players.filter((_,i)=>i!==mi).forEach((p,_,arr)=>{
    const pi=G.players.indexOf(p);
    const score=calcScore(p);
    const row=el('div','cpr');
    // 이름 클릭 → 건물 팝업
    const nameBtn=el('div','cpr-name');
    nameBtn.style.cssText='cursor:pointer;display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:6px;transition:.15s;margin:-3px -6px 4px';
    nameBtn.onmouseover=()=>nameBtn.style.background='rgba(212,168,67,.08)';
    nameBtn.onmouseout=()=>nameBtn.style.background='';
    nameBtn.innerHTML=`${p.avatar} <span style="font-weight:700">${esc(p.name)}</span> <span style="color:var(--dim)">(${p.city.length}/7)</span> <span style="color:var(--gold2);font-weight:700">⭐${score}</span> <span style="color:var(--dim);font-size:8px;margin-left:auto">🔍 보기</span>`;
    nameBtn.onclick=()=>openEnemyCity(pi);
    row.appendChild(nameBtn);

    if(p.city.length){
      const pips=el('div','cpips');
      p.city.slice(0,6).forEach(c=>{
        const pip=el('div','cpi');pip.style.cssText=`background:${CCSS[c.color]}22;border-color:${CCSS[c.color]}66;color:${CCSS[c.color]};`;
        pip.innerHTML=`${c.icon}<span>${c.name}</span>`;pip.onclick=()=>openTT(c);pips.appendChild(pip);
      });
      if(p.city.length>6){const more=el('div','cpi');more.style.cssText='background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.1);color:var(--dim);cursor:pointer;';more.textContent=`+${p.city.length-6}`;more.onclick=()=>openEnemyCity(pi);pips.appendChild(more);}
      row.appendChild(pips);
    } else {
      const empty=el('div','');empty.style.cssText='font-size:10px;color:var(--dim);padding:2px 0';empty.textContent='건물 없음';row.appendChild(empty);
    }
    panel.appendChild(row);
  });
}

// 상대 도시 — 가운데 모달로 표시
let _ecPi = null;

function openEnemyCity(pi){
  if(!G) return;
  _ecPi = pi;
  sfxPlay('click');
  const p = G.players[pi]; if(!p) return;
  const score = calcScore(p);
  const colors = new Set(p.city.map(c=>c.color));

  $('ecmTitle').innerHTML=`${p.avatar} <span style="color:${p.color}">${esc(p.name)}</span>의 도시`;
  $('ecmStats').innerHTML=`
    <span class="ecm-stat">🏛️ <strong>${p.city.length}/7채</strong></span>
    <span class="ecm-stat">💰 <strong>${p.gold}개</strong></span>
    <span class="ecm-stat">🃏 <strong>${p.hand.length}장</strong></span>
    <span class="ecm-stat">⭐ <strong>${score}점</strong></span>
    ${p.complete?'<span class="ecm-stat" style="color:#7ecca1;font-weight:700">🎉 도시 완성!</span>':''}
    ${colors.size>=5?'<span class="ecm-stat" style="color:var(--gold2);font-weight:700">🌈 5색 보너스!</span>':''}
  `;

  const grid=$('ecmGrid'); grid.innerHTML='';
  if(!p.city.length){
    grid.innerHTML='<div style="color:var(--dim);font-size:13px;padding:16px;text-align:center;width:100%">아직 건설된 건물이 없습니다.</div>';
  } else {
    const colorOrder=['yellow','blue','green','red','purple'];
    colorOrder.forEach(color=>{
      p.city.filter(c=>c.color===color).forEach(c=>{
        const card=el('div',`dcard c-${color}`);
        card.style.width='90px';
        card.innerHTML=`<div class="dc-ico" style="font-size:26px">${c.icon}</div><div class="dc-nm">${c.name}</div><div class="dc-cost">${c.cost}</div>${c.special?'<div class="dc-sp">✨</div>':''}`;
        card.onclick=()=>openTT(c);
        card.style.cursor='pointer';
        grid.appendChild(card);
      });
    });
  }
  $('enemyCityModal').classList.remove('hidden');
  rPlayerList(); // 선택 강조
}

function closeEnemyCity(){
  _ecPi=null;
  $('enemyCityModal').classList.add('hidden');
  rPlayerList();
}

// 인라인 패널 렌더 (우측 하단용 — 더 이상 사용 안 함, 호환 유지)
function renderEnemyCityInPanel(pi){ openEnemyCity(pi); }

// 전체 로그 모달
function openLogModal(){
  if(!G)return;
  const body=$('logModalBody'); body.innerHTML='';
  G.log.forEach(e=>{
    const d=el('div',`log-modal-item ev-${e.type||'system'}`);
    d.innerHTML=`<span class="lmi-ico">${e.icon}</span><span class="lmi-txt">${e.html}</span>`;
    body.appendChild(d);
  });
  $('logModal').classList.remove('hidden');
}
function closeLogModal(){ $('logModal').classList.add('hidden'); }
function rActionBar(){
  const bar=$('abtns');bar.innerHTML='';if(!G)return;
  if(G.phase==='select_character'){if(!isMyCS()){const w=el('div','ab-wait');w.innerHTML=`<span class="ab-dot"></span> 캐릭터 선택 대기 중...`;bar.appendChild(w);}return;}
  if(!isMyTurn()){const w=el('div','ab-wait');w.innerHTML=`<span class="ab-dot"></span> ${G.players[G.curPi]?.name}의 턴${aiRunning?' — 행동 중...':''}`;bar.appendChild(w);return;}
  const me=G.players[myIdx()],ch=me.selectedCharacter;
  if(G.actionPhase==='choose'){abt(bar,'💰 금화 2개','ab ab-gold',takeGold);abt(bar,'🃏 카드 뽑기','ab ab-blue',drawCard);return;}
  if(G.actionPhase==='draw_choice'||G.actionPhase==='observatory')return;
  if(G.actionPhase==='build'){
    const bl=selCard?`🏛️ 건설 (💰${me.hand.find(c=>c.uid===selCard)?.cost??'?'})`:'🏛️ 건물 선택 후 건설';
    const bb=abt(bar,bl,'ab ab-green',buildDistrict);if(!selCard)bb.disabled=true;
    if(ch&&[1,2,3,8].includes(ch.id)){
      if(!abilityDone)abt(bar,`${ch.icon} ${ch.name} 능력`,'ab ab-purple',useAbility);
      else{const ab=abt(bar,`${ch.icon} 능력 사용됨`,'ab ab-dim',null);ab.disabled=true;}
    }
    if(pendAbility)abt(bar,'✖️ 취소','ab ab-dim',cancelAbility);
    abt(bar,'✅ 턴 종료','ab ab-end',endTurn);
  }
}
function abt(c,l,cls,fn){const b=el('button',cls);b.innerHTML=l;if(fn)b.onclick=fn;else b.disabled=true;c.appendChild(b);return b;}
function mkCard(d){
  const c=el('div',`dcard c-${d.color}`);
  c.innerHTML=`<div class="dc-ico">${d.icon}</div><div class="dc-nm">${d.name}</div><div class="dc-cost">${d.cost}</div>${d.special?'<div class="dc-sp">✨</div>':''}`;
  return c;
}
function openTT(d){
  $('ttIcon').textContent=d.icon;$('ttName').textContent=d.name;$('ttName').style.color=CCSS[d.color];
  $('ttType').textContent=CLABEL[d.color]+' 지구';
  const cb=$('ttCB');cb.textContent=d.cost;cb.style.background=CCSS[d.color];cb.style.color=d.color==='purple'?'#fff':'#07090f';
  const sb=$('ttSpBox');
  if(d.special){$('ttSpText').textContent=d.special;sb.classList.remove('hidden');}else sb.classList.add('hidden');
  $('ttModal').classList.remove('hidden');
}
function closeTT(){$('ttModal').classList.add('hidden');}

// ══════════════════════════════════════
// 페이지 로드 시 즉시 WS 연결
// ══════════════════════════════════════
initWS();

// ══════════════════════════════════════
// 게임 규칙 모달
// ══════════════════════════════════════
function openRules() {
  $('rulesModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeRules() {
  $('rulesModal').classList.add('hidden');
  document.body.style.overflow = '';
}
function switchRuleTab(tab) {
  document.querySelectorAll('#ruleTabs .gm-tab').forEach(t => t.classList.toggle('on', t.dataset.rt === tab));
  ['overview','flow','score','tips'].forEach(id => {
    const el = $('rt-' + id);
    if (el) el.classList.toggle('hidden', id !== tab);
  });
}

// ══════════════════════════════════════
// 카드 도감 모달
// ══════════════════════════════════════
const COLOR_CSS2 = {yellow:'#d4a017',blue:'#5b9bd5',green:'#4caf7d',red:'#e05252',purple:'#9b59b6'};
const COLOR_LBL  = {yellow:'귀족 지구',blue:'종교 지구',green:'상업 지구',red:'군사 지구',purple:'특수 지구'};

const CHAR_TIPS = {
  1: '상대가 상인·건축가를 선택할 것 같을 때 암살해 수입을 막으세요. 본인도 암살될 위험이 있으니 블러핑이 중요합니다.',
  2: '금화가 많은 상인을 주로 노리세요. 단, 암살자에게 자주 타깃이 되니 주의하세요.',
  3: '손패가 빈약할 때 사용하면 강력합니다. 상대의 좋은 패를 가져오거나, 버리고 새로 뽑아 원하는 카드를 찾으세요.',
  4: '노란 건물을 많이 지을수록 매 라운드 수입이 늘어납니다. 다음 라운드 선택 우선권도 큰 이점입니다.',
  5: '건물이 많아져 장군의 파괴가 걱정될 때 선택하세요. 단, 암살당하면 보호가 사라집니다.',
  6: '초록 건물과 조합하면 한 턴에 큰 수입을 얻을 수 있습니다. 초반부터 초록 건물을 쌓아두세요.',
  7: '카드 2장 추가 + 3채 건설로 빠른 완성이 가능합니다. 금화가 많을 때 가장 효과적입니다.',
  8: '주교 건물은 파괴할 수 없으니 주의하세요. 상대가 완성에 가까울 때 핵심 건물을 파괴하세요.',
};

const DIST_TIPS = {
  library: '카드 뽑기를 선택하면 2장 모두 획득합니다. 천문대와 함께 있으면 3장 중 2장을 가져갑니다.',
  observatory: '3장을 보고 1장을 선택합니다. 원하는 카드를 찾을 확률이 높아집니다.',
  graveyard: '장군이 건물을 파괴할 때 💰1을 내면 그 건물을 손패로 회수할 수 있습니다.',
  smithy: '💰2를 내고 카드 3장을 추가로 뽑을 수 있습니다. 건축가와 조합하면 엄청난 카드 수급이 가능합니다.',
  university: '비용 6코인이지만 점수는 9점. 게임 후반에 짓기 좋습니다.',
  dragondoor: '비용 6코인이지만 점수는 9점. 5색 보너스 달성에도 도움됩니다.',
  school: '비용 6코인이지만 점수는 9점. 보라색이라 캐릭터 수입과 무관합니다.',
  haunted: '게임 종료 시 원하는 색 1개로 간주됩니다. 5색 보너스 달성에 유용합니다.',
};

let currentDistFilter = 'all';
let selectedCharCard = null;
let selectedDistCard = null;

function openCards() {
  $('cardsModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  buildCharDex();
  buildDistDex();
}
function closeCards() {
  $('cardsModal').classList.add('hidden');
  document.body.style.overflow = '';
  selectedCharCard = null;
  selectedDistCard = null;
}
function switchCardTab(tab) {
  document.querySelectorAll('#cardTabs .gm-tab').forEach(t => t.classList.toggle('on', t.dataset.ct === tab));
  $('ct-chars').classList.toggle('hidden', tab !== 'chars');
  $('ct-districts').classList.toggle('hidden', tab !== 'districts');
}

function buildCharDex() {
  const grid = $('charDexGrid');
  if (grid.innerHTML) return; // 이미 빌드됨
  grid.innerHTML = '';
  CHARS.forEach(ch => {
    const card = document.createElement('div');
    card.className = 'cdex-card c-char';
    card.style.cssText = `background:${ch.bg};border-color:${ch.bc};`;
    card.innerHTML = `
      <div class="cdex-ico">${ch.icon}</div>
      <div class="cdex-name" style="color:${ch.tc}">${ch.id}. ${ch.name}</div>
      <div class="cdex-sub" style="color:${ch.tc}88">캐릭터 카드</div>
      <div class="cdex-desc">${ch.abilityShort}</div>
    `;
    card.onclick = () => showCharDetail(ch, card);
    grid.appendChild(card);
  });
}

function showCharDetail(ch, cardEl) {
  // 선택 표시
  document.querySelectorAll('#charDexGrid .cdex-card').forEach(c => c.style.outline = '');
  cardEl.style.outline = `2px solid ${ch.tc}`;
  selectedCharCard = ch;

  const detail = $('charDetail');
  detail.innerHTML = `
    <div class="cdd-head">
      <div class="cdd-ico">${ch.icon}</div>
      <div>
        <div class="cdd-name" style="color:${ch.tc}">${ch.id}번 · ${ch.name}</div>
        <div class="cdd-type">캐릭터 카드</div>
      </div>
    </div>
    <div class="cdd-body">${ch.ability}</div>
    <div class="cdd-tip">${CHAR_TIPS[ch.id] || '전략적으로 활용하세요.'}</div>
  `;
  detail.classList.add('show');
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function buildDistDex() {
  const grid = $('distDexGrid');
  if (grid.innerHTML) return;
  renderDistCards();
}

function renderDistCards() {
  const grid = $('distDexGrid');
  grid.innerHTML = '';
  const filtered = currentDistFilter === 'all'
    ? DISTRICTS
    : DISTRICTS.filter(d => d.color === currentDistFilter);

  filtered.forEach(d => {
    const card = document.createElement('div');
    const cc = COLOR_CSS2[d.color];
    card.className = `cdex-card c-${d.color}`;
    card.style.background = `${cc}11`;
    card.innerHTML = `
      <div class="cdex-cost" style="background:${cc};color:${d.color==='purple'?'#fff':'#07090f'}">${d.cost}</div>
      <div class="cdex-ico">${d.icon}</div>
      <div class="cdex-name" style="color:${cc}">${d.name}</div>
      <div class="cdex-sub">${COLOR_LBL[d.color]}</div>
      ${d.special ? '<div class="cdex-badge" style="color:#c39bd3;border-color:rgba(155,89,182,.3);background:rgba(155,89,182,.1)">✨ 특수</div>' : ''}
    `;
    card.onclick = () => showDistDetail(d, card);
    grid.appendChild(card);
  });
}

function filterDist(filter) {
  currentDistFilter = filter;
  // 필터 버튼 스타일
  document.querySelectorAll('#distFilter .cdex-tag').forEach(t => {
    const isOn = t.dataset.f === filter;
    t.classList.toggle('on', isOn);
    if (isOn) {
      const colorMap = {all:'rgba(212,168,67,.15)',yellow:'rgba(212,160,23,.2)',blue:'rgba(91,155,213,.2)',green:'rgba(76,175,125,.2)',red:'rgba(224,82,82,.2)',purple:'rgba(155,89,182,.2)'};
      const borderMap = {all:'rgba(212,168,67,.3)',yellow:'rgba(212,160,23,.4)',blue:'rgba(91,155,213,.4)',green:'rgba(76,175,125,.4)',red:'rgba(224,82,82,.4)',purple:'rgba(155,89,182,.4)'};
      const textMap = {all:'var(--gold2)',yellow:'#d4a017',blue:'#5b9bd5',green:'#4caf7d',red:'#e05252',purple:'#9b59b6'};
      t.style.background = colorMap[filter] || '';
      t.style.borderColor = borderMap[filter] || '';
      t.style.color = textMap[filter] || '';
    } else {
      t.style.background = '';
      t.style.borderColor = '';
      t.style.color = '';
    }
  });
  // 상세 패널 닫기
  const detail = $('distDetail');
  detail.classList.remove('show');
  selectedDistCard = null;
  document.querySelectorAll('#distDexGrid .cdex-card').forEach(c => c.style.outline = '');
  renderDistCards();
}

function showDistDetail(d, cardEl) {
  const cc = COLOR_CSS2[d.color];
  document.querySelectorAll('#distDexGrid .cdex-card').forEach(c => c.style.outline = '');
  cardEl.style.outline = `2px solid ${cc}`;
  selectedDistCard = d;

  const copies = d.color === 'purple' ? 1 : 3;
  const detail = $('distDetail');
  detail.innerHTML = `
    <div class="cdd-head">
      <div class="cdd-ico">${d.icon}</div>
      <div>
        <div class="cdd-name" style="color:${cc}">${d.name}</div>
        <div class="cdd-type">${COLOR_LBL[d.color]} · 건설 비용 ${d.cost}💰 · ${copies}장</div>
      </div>
    </div>
    ${d.special ? `<div class="cdd-body"><b>✨ 특수 능력:</b> ${d.special}</div>` : `<div class="cdd-body">건설 비용만큼 점수를 얻습니다. <b>${d.cost}점</b>으로 계산됩니다.</div>`}
    ${(DIST_TIPS[d.id] ? `<div class="cdd-tip">${DIST_TIPS[d.id]}</div>` : '')}
  `;
  detail.classList.add('show');
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ESC키로 모달 닫기
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeRules();
    closeCards();
    closeTT();
  }
});

// ══════════════════════════════════════════════════
// 🎵 배경음악 (Web Audio API — 서버 파일 불필요)
// 중세 느낌의 아르페지오 + 드론 음
// ══════════════════════════════════════════════════
let _bgmCtx  = null;
let _bgmOn   = false;
let _bgmNodes = [];   // 정리용
let _bgmVol  = 0.18; // 기본 볼륨

function bgmInit(){
  if(_bgmCtx) return;
  try {
    _bgmCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch(e){ console.warn('Web Audio 미지원'); }
}

function bgmStart(){
  bgmInit();
  if(!_bgmCtx || _bgmOn) return;
  _bgmOn = true;
  _bgmNodes = [];

  const ctx = _bgmCtx;
  if(ctx.state === 'suspended') ctx.resume();

  const master = ctx.createGain();
  master.gain.value = _bgmVol;
  master.connect(ctx.destination);
  _bgmNodes.push(master);

  // ── 리버브 컨볼버 (간단한 임펄스) ──
  const rev = ctx.createConvolver();
  const rLen = ctx.sampleRate * 2;
  const rBuf = ctx.createBuffer(2, rLen, ctx.sampleRate);
  for(let ch=0;ch<2;ch++){
    const d=rBuf.getChannelData(ch);
    for(let i=0;i<rLen;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/rLen,2.5);
  }
  rev.buffer=rBuf;
  rev.connect(master);

  const dry = ctx.createGain(); dry.gain.value=0.7; dry.connect(master);
  const wet = ctx.createGain(); wet.gain.value=0.3; wet.connect(rev);

  // ── 드론 베이스 (D2 = 73.4Hz) ──
  function makeDrone(freq, vol){
    const osc=ctx.createOscillator();
    const g=ctx.createGain();
    osc.type='triangle';
    osc.frequency.value=freq;
    g.gain.value=vol;
    osc.connect(g); g.connect(dry); g.connect(wet);
    osc.start();
    _bgmNodes.push(osc,g);
    return osc;
  }
  makeDrone(73.4, 0.04);   // D2
  makeDrone(110,  0.025);  // A2
  makeDrone(146.8,0.015);  // D3

  // ── 중세 아르페지오 ──
  // D 단음계: D E F G A Bb C D
  const scale = [293.7, 329.6, 349.2, 392.0, 440.0, 466.2, 523.3, 587.3];
  // 아르페지오 패턴 (인덱스)
  const patterns = [
    [0,2,4,2, 1,3,5,3, 0,2,4,6, 2,4,2,0],
    [4,2,0,2, 5,3,1,3, 4,6,4,2, 0,2,4,2],
    [0,4,2,5, 1,3,6,4, 2,0,4,2, 3,5,3,1],
  ];

  let patIdx=0, noteIdx=0;
  const tempo = 0.38; // 음표 간격(초)

  function scheduleNote(time){
    const pat = patterns[patIdx % patterns.length];
    const scaleIdx = pat[noteIdx % pat.length];
    const freq = scale[scaleIdx % scale.length];

    const osc=ctx.createOscillator();
    const env=ctx.createGain();
    osc.type='sine';
    osc.frequency.value=freq;
    // 공격-감쇠 엔벨로프
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.12, time+0.04);
    env.gain.exponentialRampToValueAtTime(0.001, time+tempo*0.9);
    osc.connect(env); env.connect(dry); env.connect(wet);
    osc.start(time); osc.stop(time+tempo*0.95);
    _bgmNodes.push(osc, env);

    noteIdx++;
    if(noteIdx % pat.length === 0){
      patIdx++;
      noteIdx=0;
    }
  }

  // 스케줄러
  let nextTime = ctx.currentTime + 0.1;
  function tick(){
    if(!_bgmOn) return;
    while(nextTime < ctx.currentTime + 0.5){
      scheduleNote(nextTime);
      nextTime += tempo;
    }
    // 완성됐을 때 축제음 추가
    if(G && G.players && G.players.some(p=>p.complete) && !_bgmFanfare){
      _bgmFanfare=true;
      playFanfare();
    }
    setTimeout(tick, 100);
  }
  tick();

  updateBgmBtn();
}

let _bgmFanfare = false;

function playFanfare(){
  if(!_bgmCtx) return;
  const ctx = _bgmCtx;
  const g = ctx.createGain();
  g.gain.value = _bgmVol * 1.5;
  g.connect(ctx.destination);
  // 간단한 팡파르: C E G C
  [523.3, 659.3, 784.0, 1046.5].forEach((f,i)=>{
    const o=ctx.createOscillator();
    o.type='square';
    o.frequency.value=f;
    const env=ctx.createGain();
    const t=ctx.currentTime+i*0.22;
    env.gain.setValueAtTime(0,t);
    env.gain.linearRampToValueAtTime(0.08,t+0.05);
    env.gain.exponentialRampToValueAtTime(0.001,t+0.4);
    o.connect(env); env.connect(g);
    o.start(t); o.stop(t+0.45);
  });
}

function bgmStop(){
  _bgmOn = false;
  _bgmFanfare = false;
  // 오실레이터만 정지 (gain 노드는 GC에 맡김)
  _bgmNodes.forEach(n=>{ try{ if(n.stop) n.stop(); n.disconnect(); }catch(_){} });
  _bgmNodes = [];
  updateBgmBtn();
}

function bgmToggle(){
  bgmInit();
  if(!_bgmCtx){ notify('이 브라우저는 오디오를 지원하지 않습니다.','warn'); return; }
  if(_bgmOn) bgmStop(); else bgmStart();
}

function updateBgmBtn(){
  const on = _bgmOn;
  ['bgmBtn','bgmBtnLobby'].forEach(id=>{
    const btn=$('bgmBtn');
    if(!btn) return;
    btn.textContent = on ? '🔇 음악 끄기' : '🎵 음악 켜기';
    btn.style.color = on ? 'var(--gold2)' : 'var(--dim2)';
    btn.style.borderColor = on ? 'rgba(212,168,67,.4)' : 'rgba(255,255,255,.1)';
    btn.style.background = on ? 'rgba(212,168,67,.12)' : 'rgba(255,255,255,.04)';
  });
  // 로비 버튼
  const lb=$('bgmBtnLobby');
  if(lb) lb.textContent = on ? '🔇 음악 끄기' : '🎵 음악 켜기';
}

function bgmSetVol(v){
  _bgmVol = Math.max(0, Math.min(1, v));
}

// ══════════════════════════════════════════════════
// 🔔 효과음 시스템 (Web Audio API)
// ══════════════════════════════════════════════════
let _sfxOn  = true;
let _sfxCtx = null;

function sfxInit(){
  if(_sfxCtx) return;
  try { _sfxCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch(e){ console.warn('SFX 미지원'); }
}

function sfxToggle(){
  _sfxOn = !_sfxOn;
  updateSfxBtn();
  if(_sfxOn) sfxPlay('click');
}

function updateSfxBtn(){
  const on = _sfxOn;
  const label = on ? '🔔 효과음 켜짐' : '🔕 효과음 꺼짐';
  ['sfxBtn','sfxBtnLobby'].forEach(id=>{
    const b = $(id); if(!b) return;
    b.textContent = label;
    b.style.color = on ? '#89c4f4' : 'var(--dim2)';
    b.style.borderColor = on ? 'rgba(91,155,213,.4)' : 'rgba(255,255,255,.1)';
    b.style.background = on ? 'rgba(91,155,213,.1)' : 'rgba(255,255,255,.04)';
  });
}

// 효과음 정의
function sfxPlay(type){
  if(!_sfxOn) return;
  sfxInit();
  if(!_sfxCtx) return;
  const ctx = _sfxCtx;
  if(ctx.state==='suspended') ctx.resume();

  const g = ctx.createGain();
  g.connect(ctx.destination);

  switch(type){
    case 'click': {
      // 짧고 경쾌한 클릭음
      const o=ctx.createOscillator();
      o.type='sine'; o.frequency.value=880;
      g.gain.setValueAtTime(0.12,ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.08);
      o.connect(g); o.start(); o.stop(ctx.currentTime+0.08);
      break;
    }
    case 'build': {
      // 건물 건설: 낮은음→높은음 스윕
      const o=ctx.createOscillator();
      o.type='triangle';
      o.frequency.setValueAtTime(220,ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(660,ctx.currentTime+0.18);
      g.gain.setValueAtTime(0.15,ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.25);
      o.connect(g); o.start(); o.stop(ctx.currentTime+0.25);
      break;
    }
    case 'gold': {
      // 금화: 동전 소리
      [0,0.06,0.12].forEach((t,i)=>{
        const o=ctx.createOscillator();
        const env=ctx.createGain();
        o.type='sine'; o.frequency.value=1200-i*100;
        env.gain.setValueAtTime(0.1,ctx.currentTime+t);
        env.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.1);
        o.connect(env); env.connect(ctx.destination);
        o.start(ctx.currentTime+t); o.stop(ctx.currentTime+t+0.12);
      });
      break;
    }
    case 'assassin': {
      // 암살: 낮고 섬뜩한 음
      const o=ctx.createOscillator();
      o.type='sawtooth'; o.frequency.value=110;
      g.gain.setValueAtTime(0.12,ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.4);
      o.connect(g); o.start(); o.stop(ctx.currentTime+0.4);
      break;
    }
    case 'ability': {
      // 능력 사용: 마법 같은 상승음
      const o=ctx.createOscillator();
      o.type='sine';
      o.frequency.setValueAtTime(440,ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(1760,ctx.currentTime+0.3);
      g.gain.setValueAtTime(0.1,ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.35);
      o.connect(g); o.start(); o.stop(ctx.currentTime+0.35);
      break;
    }
    case 'turn': {
      // 내 턴 알림: 두 음이 겹치는 알림
      [0,0.12].forEach((t,i)=>{
        const o=ctx.createOscillator();
        const env=ctx.createGain();
        o.type='sine'; o.frequency.value=i===0?523:784;
        env.gain.setValueAtTime(0.1,ctx.currentTime+t);
        env.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.2);
        o.connect(env); env.connect(ctx.destination);
        o.start(ctx.currentTime+t); o.stop(ctx.currentTime+t+0.22);
      });
      break;
    }
    case 'error': {
      // 오류: 낮은 버즈음
      const o=ctx.createOscillator();
      o.type='square'; o.frequency.value=120;
      g.gain.setValueAtTime(0.08,ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.18);
      o.connect(g); o.start(); o.stop(ctx.currentTime+0.18);
      break;
    }
    case 'win': {
      // 승리: 팡파르 (BGM과 다른 짧은 버전)
      [523,659,784,1047].forEach((f,i)=>{
        const o=ctx.createOscillator();
        const env=ctx.createGain();
        o.type='square'; o.frequency.value=f;
        const t=ctx.currentTime+i*0.15;
        env.gain.setValueAtTime(0.07,t);
        env.gain.exponentialRampToValueAtTime(0.001,t+0.3);
        o.connect(env); env.connect(ctx.destination);
        o.start(t); o.stop(t+0.32);
      });
      break;
    }
  }
}
