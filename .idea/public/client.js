// client.js — 시타델 클라이언트 (WebSocket 멀티플레이어)
'use strict';

// ═══════════════════════════════════════════════
// 상태
// ═══════════════════════════════════════════════
let ws = null;
let G = null;
let MY_ID = null;
let MY_ROOM = null;
let IS_HOST = false;
let AI_SOLO = 3;
let AI_WAIT = 0;
let selCard = null;
let abilityUsed = false;
let aiQueue = [];
let aiRunning = false;
let ntTimer = null;
let pendingAbility = null;   // 'assassin'|'thief'|'warlord'|'wizard'
let wizardMode = null;       // null|'swap'|'discard'
let wizDiscardSel = [];
let warlordTargetPi = null;

const CCSS   = { yellow:"#d4a017", blue:"#5b9bd5", green:"#4caf7d", red:"#e05252", purple:"#9b59b6" };
const CLABEL = { yellow:"귀족", blue:"종교", green:"상업", red:"군사", purple:"특수" };

// ═══════════════════════════════════════════════
// WebSocket 연결
// ═══════════════════════════════════════════════
function connectWS(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}`;
  ws = new WebSocket(url);
  ws.onopen = () => { setSt('ok','✅ 서버 연결됨'); if(onOpen) onOpen(); };
  ws.onclose = () => setSt('err','❌ 연결 끊김 — 새로고침하세요');
  ws.onerror = () => setSt('err','❌ 연결 오류');
  ws.onmessage = e => handleMsg(JSON.parse(e.data));
  // 핑
  setInterval(()=>{ if(ws&&ws.readyState===1) ws.send(JSON.stringify({type:'ping'})); }, 20000);
}

function send(msg) { if(ws&&ws.readyState===1) ws.send(JSON.stringify(msg)); }

function handleMsg(msg) {
  switch(msg.type) {
    case 'room_created':
    case 'room_joined':
      MY_ROOM = msg.code;
      showWaiting(msg.roomInfo);
      break;
    case 'room_update':
      showWaiting(msg.roomInfo);
      break;
    case 'game_start':
      onGameStart(msg.roomInfo);
      break;
    case 'state_update':
      // 비호스트: 서버에서 G 수신
      G = msg.G;
      render();
      if(msg.gameOver) showGameOver();
      break;
    case 'player_action':
      // 호스트: 비호스트 플레이어의 행동 수신
      if(IS_HOST) handleRemoteAction(msg.playerId, msg.action);
      break;
    case 'player_left':
      notify('플레이어가 연결을 끊었습니다.','warn');
      if(msg.roomInfo) showWaiting(msg.roomInfo);
      break;
    case 'chat':
      addChat(msg.name, msg.text);
      break;
    case 'error':
      notify(msg.msg,'bad');
      break;
  }
}

function setSt(type, text) {
  const el = document.getElementById('connStatus');
  if(!el) return;
  el.className = `conn-status conn-${type}`;
  el.textContent = text;
}

// ═══════════════════════════════════════════════
// 로비 탭
// ═══════════════════════════════════════════════
document.getElementById('tabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if(!t) return;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
  t.classList.add('on');
  ['solo','host','join'].forEach(id=>document.getElementById('t-'+id).classList.add('hidden'));
  document.getElementById('t-'+t.dataset.t).classList.remove('hidden');
});
document.getElementById('aiRow').addEventListener('click', e=>{
  const b=e.target.closest('.cnt-btn');if(!b)return;
  AI_SOLO=+b.dataset.n;
  document.querySelectorAll('#aiRow .cnt-btn').forEach(x=>x.classList.toggle('on',x===b));
});
document.getElementById('wAiRow').addEventListener('click', e=>{
  const b=e.target.closest('.cnt-btn');if(!b)return;
  AI_WAIT=+b.dataset.n;
  document.querySelectorAll('#wAiRow .cnt-btn').forEach(x=>x.classList.toggle('on',x===b));
});

// ═══════════════════════════════════════════════
// 솔로 (AI만)
// ═══════════════════════════════════════════════
function startSolo() {
  const name = document.getElementById('soloName').value.trim() || '영주';
  MY_ID = uid(); IS_HOST = true; MY_ROOM = 'LOCAL';
  const total = 1 + AI_SOLO;
  const players = Array.from({length:total},(_,i)=>({
    id: i===0?MY_ID:uid(), name:i===0?name:`AI ${i}`,
    isAI:i!==0, avatar:AVATARS[i], color:P_COLORS[i],
  }));
  G = buildInitialG(players);
  enterGame(); aiAutoSelect(); render();
}

// ═══════════════════════════════════════════════
// 멀티플레이어
// ═══════════════════════════════════════════════
function doCreateRoom() {
  const name = document.getElementById('hostName').value.trim() || '호스트';
  MY_ID = uid(); IS_HOST = true;
  document.getElementById('screen-lobby').classList.add('hidden');
  document.getElementById('screen-waiting').classList.remove('hidden');
  document.getElementById('aiWaitWrap').classList.remove('hidden');
  document.getElementById('hostStartWrap').classList.remove('hidden');
  document.getElementById('waitMsg').classList.add('hidden');
  connectWS(()=>{
    send({ type:'create_room', playerId:MY_ID, name, avatar:AVATARS[0], color:P_COLORS[0] });
  });
}

function doJoinRoom() {
  const name = document.getElementById('joinName').value.trim() || '플레이어';
  const code = document.getElementById('joinCode').value.trim().toUpperCase();
  if(code.length < 4){ notify('방 코드를 입력하세요!','warn'); return; }
  MY_ID = uid(); IS_HOST = false;
  document.getElementById('screen-lobby').classList.add('hidden');
  document.getElementById('screen-waiting').classList.remove('hidden');
  document.getElementById('waitMsg').classList.remove('hidden');
  connectWS(()=>{
    send({ type:'join_room', playerId:MY_ID, code, name, avatar:AVATARS[1], color:P_COLORS[1] });
  });
}

function showWaiting(info) {
  MY_ROOM = info.code;
  document.getElementById('wCode').textContent = info.code;
  const list = document.getElementById('wList'); list.innerHTML='';
  info.players.forEach((p,i)=>{
    const d=document.createElement('div');
    d.className='w-player'+(i===0?' host':'');
    const isMe = p.id===MY_ID;
    d.innerHTML=`<span class="w-dot"></span><span style="font-size:17px">${p.avatar}</span><span style="font-size:13px;font-weight:700;color:${isMe?'#c39bd3':'var(--text)'}">${p.name}${isMe?' (나)':''}</span>${i===0?'<span style="margin-left:auto;font-size:9px;color:var(--gold);font-family:Georgia,serif">HOST</span>':''}`;
    list.appendChild(d);
  });
}

function hostStart() {
  if(!IS_HOST) return;
  send({ type:'start_game', aiCount: AI_WAIT });
}

function onGameStart(info) {
  // 호스트가 G 빌드 후 전체에 동기화
  if(IS_HOST) {
    G = buildInitialG(info.players);
    enterGame(); aiAutoSelect();
    syncState();
    render();
  } else {
    enterGame();
    // 비호스트는 state_update 대기
  }
}

function syncState() {
  if(MY_ROOM === 'LOCAL') return;
  send({ type:'sync_state', G, gameOver: G.gameOver||false });
}

// 비호스트가 행동 전송
function sendAction(action) {
  if(MY_ROOM === 'LOCAL' || IS_HOST) return;
  send({ type:'player_action', action });
}

// 호스트가 원격 행동 수신 후 처리
function handleRemoteAction(playerId, action) {
  const pi = G.players.findIndex(p=>p.id===playerId);
  if(pi<0) return;
  switch(action.type) {
    case 'select_char':   doSelectChar(pi, action.charId); break;
    case 'take_gold':     doTakeGold(pi); break;
    case 'draw_card':     doDrawCard(pi); break;
    case 'choose_draw':   doChooseDraw(pi, action.uid); break;
    case 'build':         doBuild(pi, action.uid); break;
    case 'use_ability':   doUseAbility(pi, action); break;
    case 'end_turn':      doEndTurn(pi); break;
  }
}

// ═══════════════════════════════════════════════
// 게임 화면 전환
// ═══════════════════════════════════════════════
function enterGame() {
  ['screen-lobby','screen-waiting'].forEach(id=>document.getElementById(id).classList.add('hidden'));
  document.getElementById('screen-game').classList.remove('hidden');
  if(MY_ROOM!=='LOCAL') document.getElementById('chatBar').classList.remove('hidden');
}
function goLobby() {
  document.getElementById('goModal').classList.add('hidden');
  document.getElementById('screen-game').classList.add('hidden');
  document.getElementById('chatBar').classList.add('hidden');
  document.getElementById('screen-lobby').classList.remove('hidden');
  G=null; selCard=null; aiQueue=[]; aiRunning=false; pendingAbility=null; wizardMode=null;
}

// ═══════════════════════════════════════════════
// 게임 로직 헬퍼
// ═══════════════════════════════════════════════
function myIdx() { return G?.players.findIndex(p=>p.id===MY_ID)??0; }
function isMyTurn() { return G&&G.phase==='player_turn'&&G.curPi===myIdx()&&!aiRunning; }
function isMyCharSel() { return G&&G.phase==='select_character'&&G.selOrder[G.selIdx]===myIdx(); }
function uid() { return Math.random().toString(36).slice(2,10).toUpperCase(); }

function deckPop() {
  if(!G.deck.length){G.deck=shuffle([...G.discard]);G.discard=[];}
  return G.deck.length?G.deck.pop():null;
}
function calcScore(p) {
  let s=0; const cols=new Set();
  p.city.forEach(d=>{
    s+=d.cost;
    if(['university','dragondoor','school'].includes(d.id))s+=3;
    cols.add(d.color);
  });
  if(cols.size>=5)s+=3;
  if(p.firstComplete)s+=4; else if(p.complete)s+=2;
  return s;
}
function feed(icon,html,type='system'){
  if(!G)return;
  G.log.unshift({icon,html,type,ts:Date.now()});
  if(G.log.length>100)G.log.pop();
}
function notify(msg,type='info'){
  const el=document.getElementById('notif');
  el.textContent=msg; el.className=`show n-${type}`;
  if(ntTimer)clearTimeout(ntTimer);
  ntTimer=setTimeout(()=>el.className='',2800);
}
function copyCode(){ navigator.clipboard?.writeText(MY_ROOM).then(()=>notify('코드 복사됨!','ok')); }

// ═══════════════════════════════════════════════
// 캐릭터 선택
// ═══════════════════════════════════════════════
function aiAutoSelect(){
  while(G.phase==='select_character'&&G.selIdx<G.players.length&&G.selOrder[G.selIdx]!==myIdx()){
    const pi=G.selOrder[G.selIdx];
    if(!G.players[pi].isAI&&MY_ROOM!=='LOCAL') { G.selIdx++; continue; } // 실제 플레이어는 스킵
    if(G.availChars.length){
      const pick=G.availChars.splice(Math.floor(Math.random()*G.availChars.length),1)[0];
      G.selectedChars[pick.id]=pi; G.players[pi].selectedCharacter=pick;
    }
    G.selIdx++;
  }
}

function selectCharacter(charId){
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){
    sendAction({type:'select_char',charId}); return;
  }
  doSelectChar(myIdx(), charId);
}

function doSelectChar(pi, charId){
  if(G.phase!=='select_character') return;
  if(G.selOrder[G.selIdx]!==pi) return;
  const ch=G.availChars.find(c=>c.id===charId); if(!ch)return;
  G.selectedChars[ch.id]=pi; G.players[pi].selectedCharacter=ch;
  G.availChars=G.availChars.filter(c=>c.id!==charId); G.selIdx++;
  feed('🎭',`<b>${G.players[pi].name}</b>이(가) 캐릭터를 선택했습니다.`,'system');
  aiAutoSelect();
  if(G.selIdx>=G.players.length) beginTurns();
  if(IS_HOST||MY_ROOM==='LOCAL'){syncState();render();}
}

function beginTurns(){
  G.phase='player_turn'; G.curCharIdx=1;
  feed('⚔️','<b>행동 단계 시작!</b> 1번→8번 순서로 행동합니다.','system');
  advanceChar(1);
}

function advanceChar(idx){
  if(idx>8){
    if(G.players.some(p=>p.complete)){resolveGameOver();return;}
    nextRound(); return;
  }
  G.curCharIdx=idx;
  if(G.assassinTarget===idx){
    const ki=Object.entries(G.selectedChars).find(([k])=>+k===idx)?.[1];
    if(ki!==undefined){
      feed('💀',`<b>${G.players[ki].name}</b>이(가) 암살당해 이번 턴 행동 불가!`,'combat');
      advanceChar(idx+1); return;
    }
  }
  const entry=Object.entries(G.selectedChars).find(([k])=>+k===idx);
  if(!entry){advanceChar(idx+1);return;}
  const pi=+entry[1];
  if(G.thiefTarget===idx&&G.thiefPi!==null&&G.thiefPi!==pi){
    const stolen=G.players[pi].gold;
    G.players[G.thiefPi].gold+=stolen; G.players[pi].gold=0;
    feed('🦹',`<b>${G.players[G.thiefPi].name}(도둑)</b>이(가) <b>${G.players[pi].name}</b>의 💰${stolen}을 빼앗았습니다!`,'combat');
  }
  G.curPi=pi; G.actionPhase='choose';
  G.players[pi].abilityUsed=false;
  G.players[pi].buildsLeft=G.players[pi].selectedCharacter?.id===7?3:1;
  const mi=myIdx();
  if(pi===mi){ abilityUsed=false; feed('✨',`<b>내 턴!</b> 수입을 선택하세요.`,'system'); }
  else if(G.players[pi].isAI){ enqueueAI(pi); }
  else { feed('⏳',`<b>${G.players[pi].name}</b>의 턴입니다.`,'system'); }
}

// ═══════════════════════════════════════════════
// 수입
// ═══════════════════════════════════════════════
function takeGold(){
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){ sendAction({type:'take_gold'}); return; }
  doTakeGold(myIdx());
}
function doTakeGold(pi){
  if(G.phase!=='player_turn'||G.curPi!==pi||G.actionPhase!=='choose')return;
  const p=G.players[pi]; p.gold+=2;
  feed('💰',`<b>${p.name}</b>이(가) 금화 2개를 받았습니다. (보유: ${p.gold}💰)`,'gold');
  applyIncome(pi);
  if(p.selectedCharacter?.id===7){const c1=deckPop(),c2=deckPop();if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);feed('🏗️',`<b>${p.name}(건축가)</b>가 카드 2장을 추가로 뽑았습니다.`,'ability');}
  G.actionPhase='build';
  if(IS_HOST||MY_ROOM==='LOCAL'){syncState();render();}
  if(pi===myIdx())notify('💰 금화 2개!','ok');
}

function drawCard(){
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){ sendAction({type:'draw_card'}); return; }
  doDrawCard(myIdx());
}
function doDrawCard(pi){
  if(G.phase!=='player_turn'||G.curPi!==pi||G.actionPhase!=='choose')return;
  const p=G.players[pi];
  const hasLib=p.city.some(d=>d.id==='library');
  const hasObs=p.city.some(d=>d.id==='observatory');
  if(hasObs){
    const drawn=[deckPop(),deckPop(),deckPop()].filter(Boolean);
    G._obsCards=drawn; G.actionPhase='observatory';
    if(IS_HOST||MY_ROOM==='LOCAL'){syncState();render();} return;
  }
  if(hasLib){
    const c1=deckPop(),c2=deckPop();
    if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);
    feed('📚',`<b>${p.name}(도서관)</b>이(가) 카드 2장을 모두 획득했습니다.`,'ability');
  } else {
    const drawn=[deckPop(),deckPop()].filter(Boolean);
    G._drawOpts=drawn; G.actionPhase='draw_choice';
    if(IS_HOST||MY_ROOM==='LOCAL'){syncState();render();} return;
  }
  applyIncome(pi);
  if(p.selectedCharacter?.id===7){const c1=deckPop(),c2=deckPop();if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);}
  G.actionPhase='build';
  if(IS_HOST||MY_ROOM==='LOCAL'){syncState();render();}
}

function chooseDraw(uid){
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){ sendAction({type:'choose_draw',uid}); return; }
  doChooseDraw(myIdx(),uid);
}
function doChooseDraw(pi,uid){
  const p=G.players[pi];
  const opts=G._drawOpts||G._obsCards||[];
  const chosen=opts.find(c=>c.uid===uid); if(!chosen)return;
  p.hand.push(chosen);
  G.discard.push(...opts.filter(c=>c.uid!==uid));
  feed('🃏',`<b>${p.name}</b>이(가) 카드를 선택했습니다. (손패: ${p.hand.length}장)`,'card');
  G._drawOpts=null; G._obsCards=null;
  applyIncome(pi);
  if(p.selectedCharacter?.id===7){const c1=deckPop(),c2=deckPop();if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);}
  G.actionPhase='build';
  if(IS_HOST||MY_ROOM==='LOCAL'){syncState();render();}
  if(pi===myIdx())notify('🃏 카드 선택!','ok');
}

function applyIncome(pi){
  const p=G.players[pi],ch=p.selectedCharacter; if(!ch)return;
  const cm={4:'yellow',5:'blue',6:'green',8:'red'};
  let b=0;
  if(cm[ch.id]){b=p.city.filter(d=>d.color===cm[ch.id]).length;if(ch.id===6)b+=1;}
  if(b>0){p.gold+=b;feed('✨',`<b>${ch.icon}${ch.name}</b> 수입: 💰+${b} (총 ${p.gold}💰)`,'gold');}
}

// ═══════════════════════════════════════════════
// 건설
// ═══════════════════════════════════════════════
function buildDistrict(uid){
  if(!uid&&selCard) uid=selCard;
  if(!uid){notify('건설할 건물을 선택하세요!','warn');return;}
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){ sendAction({type:'build',uid}); return; }
  doBuild(myIdx(),uid);
}
function doBuild(pi,uid){
  if(G.phase!=='player_turn'||G.curPi!==pi||G.actionPhase!=='build')return;
  const p=G.players[pi];
  if(p.buildsLeft<=0){if(pi===myIdx())notify('건설 횟수 초과!','warn');return;}
  const card=p.hand.find(c=>c.uid===uid); if(!card)return;
  if(p.gold<card.cost){if(pi===myIdx())notify('금화 부족!','warn');return;}
  if(p.city.find(c=>c.id===card.id)){if(pi===myIdx())notify('이미 건설됨!','warn');return;}
  p.gold-=card.cost; p.hand=p.hand.filter(c=>c.uid!==uid); p.city.push(card); p.buildsLeft--;
  selCard=null;
  feed('🏛️',`<b>${p.name}</b>이(가) ${card.icon}<b>${card.name}</b>을(를) 건설했습니다! (남은 💰: ${p.gold})`,'build');
  if(p.selectedCharacter?.id===4){G.players.forEach(x=>x.crown=false);p.crown=true;feed('👑',`<b>${p.name}(왕)</b>이(가) 왕관을 가져갔습니다.`,'system');}
  if(p.city.length>=7){
    if(!G.players.some(x=>x.complete)){p.firstComplete=true;p.complete=true;feed('🎉',`<b>${p.name}</b>이(가) 7번째 건물로 도시를 완성했습니다!`,'win');}
    else p.complete=true;
  }
  if(IS_HOST||MY_ROOM==='LOCAL'){syncState();render();}
  if(pi===myIdx())notify(`🏛️ ${card.name} 건설!`,'ok');
}

// ═══════════════════════════════════════════════
// 능력
// ═══════════════════════════════════════════════
function useAbility(){
  if(!isMyTurn())return;
  if(abilityUsed){notify('이미 사용했습니다!','warn');return;}
  const ch=G.players[myIdx()].selectedCharacter; if(!ch)return;
  if(ch.id===1){pendingAbility='assassin';notify('🗡️ 우측에서 암살할 캐릭터 선택','warn');render();return;}
  if(ch.id===2){pendingAbility='thief';notify('🦹 우측에서 훔칠 캐릭터 선택','warn');render();return;}
  if(ch.id===3){pendingAbility='wizard';wizardMode=null;wizDiscardSel=[];render();return;}
  if(ch.id===8){pendingAbility='warlord';warlordTargetPi=null;notify('⚔️ 좌측에서 파괴할 플레이어 선택','warn');render();return;}
  notify(`${ch.icon} 능력 사용!`,'ok');
}

function selectAbilityTarget(charId){
  const mi=myIdx(),p=G.players[mi];
  const ch=p.selectedCharacter;
  const action={type:'use_ability',abilityType:pendingAbility,charId};
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){ sendAction(action); pendingAbility=null; render(); return; }
  doUseAbility(mi,action);
}

function doUseAbility(pi,action){
  const p=G.players[pi]; const ch=p.selectedCharacter; if(!ch)return;
  const at=action.abilityType;
  if(at==='assassin'){
    if(action.charId===ch.id){if(pi===myIdx())notify('자신은 암살 불가!','warn');return;}
    G.assassinTarget=action.charId; p.abilityUsed=true; pendingAbility=null;
    feed('🗡️',`<b>${p.name}(암살자)</b>이(가) <b>${CHARS.find(c=>c.id===action.charId)?.name}</b>을(를) 암살!`,'combat');
    if(pi===myIdx()){abilityUsed=true;notify('🗡️ 암살 완료!','ok');}
  } else if(at==='thief'){
    if(action.charId<=2){if(pi===myIdx())notify('암살자/도둑은 불가!','warn');return;}
    G.thiefTarget=action.charId; G.thiefPi=pi; p.abilityUsed=true; pendingAbility=null;
    feed('🦹',`<b>${p.name}(도둑)</b>이(가) <b>${CHARS.find(c=>c.id===action.charId)?.name}</b>을(를) 타깃 지정!`,'ability');
    if(pi===myIdx()){abilityUsed=true;notify('🦹 타깃 지정!','ok');}
  } else if(at==='wizard_swap'){
    const tpi=action.targetPi; const tp=G.players[tpi];
    if(tp){const tmp=p.hand;p.hand=tp.hand;tp.hand=tmp;feed('🔮',`<b>${p.name}(마술사)</b>이(가) <b>${tp.name}</b>과 손패 교환!`,'ability');}
    p.abilityUsed=true; pendingAbility=null; wizardMode=null;
    if(pi===myIdx()){abilityUsed=true;notify('🔮 손패 교환!','ok');}
  } else if(at==='wizard_discard'){
    const uids=action.uids||[];
    const disc=p.hand.filter(c=>uids.includes(c.uid));
    p.hand=p.hand.filter(c=>!uids.includes(c.uid)); G.discard.push(...disc);
    for(let i=0;i<disc.length;i++){const d=deckPop();if(d)p.hand.push(d);}
    feed('🔮',`<b>${p.name}(마술사)</b>이(가) 카드 ${disc.length}장 교체!`,'ability');
    p.abilityUsed=true; pendingAbility=null; wizardMode=null; wizDiscardSel=[];
    if(pi===myIdx()){abilityUsed=true;notify('🔮 카드 교체!','ok');}
  } else if(at==='warlord'){
    const tpi=action.targetPi; const duid=action.distUid;
    const tp=G.players[tpi]; const dist=tp?.city.find(c=>c.uid===duid);
    if(dist&&tp){
      if(tp.selectedCharacter?.id===5&&G.assassinTarget!==5){if(pi===myIdx())notify('주교 건물은 파괴 불가!','warn');return;}
      if(tp.city.length>=7){if(pi===myIdx())notify('완성 플레이어 건물은 파괴 불가!','warn');return;}
      const cost=Math.max(0,dist.cost-1);
      if(p.gold<cost){if(pi===myIdx())notify(`💰${cost} 필요!`,'warn');return;}
      p.gold-=cost; tp.city=tp.city.filter(c=>c.uid!==duid); G.discard.push(dist);
      feed('⚔️',`<b>${p.name}(장군)</b>이(가) <b>${tp.name}</b>의 ${dist.icon}<b>${dist.name}</b>을 파괴! (💰-${cost})`,'combat');
      p.abilityUsed=true; pendingAbility=null; warlordTargetPi=null;
      if(pi===myIdx()){abilityUsed=true;notify(`⚔️ ${dist.name} 파괴!`,'ok');}
    }
  }
  if(IS_HOST||MY_ROOM==='LOCAL'){syncState();render();}
}

function cancelAbility(){ pendingAbility=null;wizardMode=null;wizDiscardSel=[];warlordTargetPi=null;selCard=null;render(); }

function endTurn(){
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){ sendAction({type:'end_turn'}); return; }
  doEndTurn(myIdx());
}
function doEndTurn(pi){
  if(G.phase!=='player_turn'||G.curPi!==pi)return;
  pendingAbility=null;wizardMode=null;wizDiscardSel=[];warlordTargetPi=null;selCard=null;
  feed('✅',`<b>${G.players[pi].name}</b>이(가) 턴을 종료했습니다.`,'system');
  advanceChar(G.curCharIdx+1);
  if(IS_HOST||MY_ROOM==='LOCAL'){syncState();render();}
}

// ═══════════════════════════════════════════════
// AI 큐
// ═══════════════════════════════════════════════
function enqueueAI(pi){ aiQueue.push(...buildSteps(pi)); if(!aiRunning)runQueue(); }
function buildSteps(pi){
  const p=G.players[pi],ch=p.selectedCharacter,s=[];
  s.push({t:'ann',pi});
  if(ch?.id===1&&G.assassinTarget===null){
    const oth=Object.entries(G.selectedChars).filter(([k,v])=>+k!==1&&+v!==pi);
    if(oth.length){const t=oth[Math.floor(Math.random()*oth.length)];s.push({t:'assassin',pi,cid:+t[0]});}
  }
  if(ch?.id===2&&G.thiefTarget===null){
    const oth=Object.entries(G.selectedChars).filter(([k,v])=>+k>2&&+v!==pi&&G.assassinTarget!==+k);
    if(oth.length){const t=oth[Math.floor(Math.random()*oth.length)];s.push({t:'thief',pi,cid:+t[0]});}
  }
  if(p.gold<4||Math.random()>.4)s.push({t:'gold',pi});
  else s.push({t:'draw',pi});
  if(ch?.id===7)s.push({t:'arch',pi});
  if(ch?.id===3){const oth=G.players.filter((_,i)=>i!==pi&&G.players[i].hand.length>p.hand.length);if(oth.length){const ti=G.players.indexOf(oth[0]);s.push({t:'wiz_swap',pi,ti});}}
  s.push({t:'income',pi});
  if(ch?.id===8&&Math.random()>.5){
    const en=G.players.filter((ep,ei)=>ei!==pi&&ep.city.length>0&&ep.city.length<7&&ep.selectedCharacter?.id!==5);
    if(en.length){const enemy=en[Math.floor(Math.random()*en.length)];const ei=G.players.indexOf(enemy);const c=enemy.city.reduce((a,b)=>a.cost<b.cost?a:b);const cost=Math.max(0,c.cost-1);if(p.gold>=cost+2)s.push({t:'warlord',pi,ei,uid:c.uid});}
  }
  const maxB=ch?.id===7?3:1; let tg=p.gold; let nb=0;
  [...p.hand].filter(c=>!p.city.find(b=>b.id===c.id)).sort((a,b)=>b.cost-a.cost).forEach(d=>{
    if(nb>=maxB||tg<d.cost)return; tg-=d.cost; s.push({t:'build',pi,uid:d.uid}); nb++;
  });
  if(ch?.id===4)s.push({t:'crown',pi});
  s.push({t:'next',pi});
  return s;
}
function runQueue(){
  if(!G||aiQueue.length===0){aiRunning=false;render();syncState();return;}
  aiRunning=true;
  const s=aiQueue.shift();
  applyStep(s);
  const d=s.t==='ann'?900:s.t==='next'?80:s.t==='income'?180:650;
  render();
  setTimeout(runQueue,d);
}
function applyStep(s){
  if(!G)return;
  const p=G.players[s.pi],ch=p?.selectedCharacter;
  switch(s.t){
    case 'ann': feed(ch?.icon||'⏳',`<b>${p.name}</b>(${ch?.name||'?'})의 턴 시작.`,'system'); break;
    case 'assassin': G.assassinTarget=s.cid; feed('🗡️',`<b>${p.name}(암살자)</b>이(가) <b>${CHARS.find(c=>c.id===s.cid)?.name}</b>을(를) 암살!`,'combat'); break;
    case 'thief': G.thiefTarget=s.cid;G.thiefPi=s.pi; feed('🦹',`<b>${p.name}(도둑)</b>이(가) 타깃 지정!`,'ability'); break;
    case 'gold': p.gold+=2; feed('💰',`<b>${p.name}</b>이(가) 💰+2 (보유: ${p.gold})`,'gold'); break;
    case 'draw': {const c=deckPop();if(c){p.hand.push(c);feed('🃏',`<b>${p.name}</b>이(가) 카드 뽑기. (손패: ${p.hand.length}장)`,'card');}break;}
    case 'arch': {const c1=deckPop(),c2=deckPop();if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);feed('🏗️',`<b>${p.name}(건축가)</b>이(가) 카드 2장 추가.`,'ability');break;}
    case 'wiz_swap': {const tp=G.players[s.ti];if(tp){const tmp=p.hand;p.hand=tp.hand;tp.hand=tmp;feed('🔮',`<b>${p.name}(마술사)</b>이(가) <b>${tp.name}</b>과 손패 교환!`,'ability');}break;}
    case 'income': applyIncome(s.pi); break;
    case 'warlord': {const tp=G.players[s.ei],d=tp?.city.find(c=>c.uid===s.uid);if(d&&tp){const cost=Math.max(0,d.cost-1);if(p.gold>=cost){p.gold-=cost;tp.city=tp.city.filter(c=>c.uid!==s.uid);G.discard.push(d);feed('⚔️',`<b>${p.name}(장군)</b>이(가) <b>${tp.name}</b>의 ${d.icon}<b>${d.name}</b> 파괴! (💰-${cost})`,'combat');}}break;}
    case 'build': {const d=p.hand.find(c=>c.uid===s.uid);if(d&&p.gold>=d.cost&&!p.city.find(b=>b.id===d.id)){p.gold-=d.cost;p.hand=p.hand.filter(c=>c.uid!==s.uid);p.city.push(d);feed('🏛️',`<b>${p.name}</b>이(가) ${d.icon}<b>${d.name}</b> 건설! (남은 💰: ${p.gold})`,'build');if(p.city.length>=7){if(!G.players.some(x=>x.complete)){p.firstComplete=true;p.complete=true;feed('🎉',`<b>${p.name}</b>이(가) 도시 완성!`,'win');}else p.complete=true;}}break;}
    case 'crown': G.players.forEach(x=>x.crown=false);p.crown=true;feed('👑',`<b>${p.name}(왕)</b>이(가) 왕관!`,'system');break;
    case 'next': if(G.players.some(x=>x.complete)){aiQueue=[];resolveGameOver();render();syncState();return;} advanceChar(G.curCharIdx+1); break;
  }
}

function nextRound(){
  G.round++; G.phase='select_character';
  const ci=Math.max(0,G.players.findIndex(p=>p.crown));
  G.selOrder=Array.from({length:G.players.length},(_,i)=>(ci+i)%G.players.length);
  G.selIdx=0;G.selectedChars={};G.assassinTarget=null;G.thiefTarget=null;G.thiefPi=null;
  G.players.forEach(p=>{p.selectedCharacter=null;p.abilityUsed=false;p.buildsLeft=1;});
  G.availChars=shuffle([...CHARS]);G.availChars.pop();
  G._drawOpts=null;G._obsCards=null;pendingAbility=null;wizardMode=null;selCard=null;
  aiQueue=[];aiRunning=false;abilityUsed=false;
  feed('🔄',`<b>라운드 ${G.round}</b> 시작! 캐릭터를 선택하세요.`,'system');
  aiAutoSelect(); syncState();
}

function resolveGameOver(){
  G.gameOver=true;
  const sorted=G.players.map(p=>({...p,score:calcScore(p)})).sort((a,b)=>b.score-a.score);
  feed('🏆',`게임 종료! <b>${sorted[0].name}</b> 승리! (${sorted[0].score}점)`,'win');
  syncState(); render(); setTimeout(showGameOver,800);
}

function showGameOver(){
  const sorted=G.players.map(p=>({...p,score:calcScore(p)})).sort((a,b)=>b.score-a.score);
  document.getElementById('goWinner').textContent=`🎉 ${sorted[0].name} 승리!`;
  const list=document.getElementById('goScores');list.innerHTML='';
  ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣'].forEach((m,i)=>{
    const p=sorted[i];if(!p)return;
    const li=document.createElement('li');li.className='go-sc';
    li.innerHTML=`<span>${m} ${p.avatar} ${p.name}</span><span class="go-pts">${p.score}점</span>`;
    list.appendChild(li);
  });
  document.getElementById('goModal').classList.remove('hidden');
}

// 채팅
function sendChat(){
  const inp=document.getElementById('chatInp');
  const text=inp.value.trim(); if(!text)return;
  const name=G?.players.find(p=>p.id===MY_ID)?.name||'나';
  send({type:'chat',name,text}); inp.value='';
  addChat(name,text);
}
function addChat(name,text){
  feed('💬',`<b>${name}:</b> ${text}`,'system');
  renderFeed();
}

// ═══════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════
function render(){
  if(!G)return;
  rTopbar(); rTurnBar(); rPlayerList(); renderFeed(); rMain(); rCharPanel(); rCityPanel(); rActionBar();
}

function el(tag,cls){const e=document.createElement(tag);if(cls)e.className=cls;return e;}

function rTopbar(){
  const mi=myIdx(),me=G.players[mi];
  document.getElementById('tbRound').textContent=G.round;
  document.getElementById('tbDeck').textContent=G.deck.length;
  document.getElementById('tbGold').textContent=me.gold;
  document.getElementById('tbHand').textContent=me.hand.length;
  document.getElementById('tbCity').textContent=me.city.length;
  document.getElementById('tbScore').textContent=calcScore(me);
  const ph=document.getElementById('tbPhase');
  if(G.phase==='select_character'){ph.textContent='🎭 캐릭터 선택';ph.className='tb-phase ph-sel';}
  else{const ch=CHARS.find(c=>c.id===G.curCharIdx);ph.textContent=`${ch?.icon||'⚔️'} ${ch?.name||'?'} 행동`;ph.className='tb-phase ph-act';}
}

function rTurnBar(){
  const bar=document.getElementById('turnBar');bar.innerHTML='';
  const lbl=el('div','to-lbl');lbl.textContent=G.phase==='select_character'?'선택 순서':'행동 순서';bar.appendChild(lbl);
  if(G.phase==='select_character'){
    G.selOrder.forEach((pi,i)=>{
      const p=G.players[pi],done=i<G.selIdx,cur=i===G.selIdx;
      const d=el('div','to-item'+(done?' done':'')+(cur?' cur':''));
      d.innerHTML=`<div class="to-av" style="border-color:${p.color};background:${p.color}22">${p.avatar}</div><span style="font-size:10px">${p.name.slice(0,4)}${cur?' ▶':done?' ✓':''}</span>`;
      bar.appendChild(d);
      if(i<G.selOrder.length-1){const a=el('div','to-arrow');a.textContent='→';bar.appendChild(a);}
    });
  } else {
    let hasNext=false;
    for(let cid=1;cid<=8;cid++){
      const pi=G.selectedChars[cid]; if(pi===undefined)continue;
      const p=G.players[pi],ch=CHARS.find(c=>c.id===cid);
      const done=G.curCharIdx>cid,cur=G.curCharIdx===cid,dead=G.assassinTarget===cid;
      const d=el('div','to-item'+(done?' done':'')+(cur?' cur':'')+(dead?' dead':''));
      d.title=`${ch?.name} — ${p.name}`;
      d.innerHTML=`<span style="font-size:12px">${dead?'💀':ch?.icon}</span><span style="font-size:9px;color:${ch?.tc};font-family:Georgia,serif">${cid}.${ch?.name?.slice(0,2)}</span><div class="to-av" style="border-color:${p.color};background:${p.color}22">${p.avatar}</div>${cur?'<span style="font-size:8px;color:var(--gold2)">▶</span>':done?'<span style="font-size:9px;color:#4caf7d">✓</span>':''}`;
      bar.appendChild(d);
      if(Object.keys(G.selectedChars).some(k=>+k>cid)){const a=el('div','to-arrow');a.textContent='→';bar.appendChild(a);}
    }
  }
}

function rPlayerList(){
  const container=document.getElementById('pList');container.innerHTML='';
  const mi=myIdx();
  G.players.forEach((p,i)=>{
    const isTurn=G.phase==='player_turn'&&G.curPi===i,isMe=i===mi;
    const isDead=G.assassinTarget!==null&&p.selectedCharacter?.id===G.assassinTarget&&G.phase==='player_turn';
    const isWarlord=pendingAbility==='warlord'&&!isMe&&p.city.length>0&&p.city.length<7;
    let cls='pcard'+(isMe?' me':'')+(isTurn?' active':'')+(isDead?' dead':'')+(isWarlord?' tsel':'');
    const d=el('div',cls);
    if(isWarlord)d.onclick=()=>{warlordTargetPi=i;renderWarlordOverlay(i);};
    const charIcon=G.phase==='player_turn'&&p.selectedCharacter?p.selectedCharacter.icon:G.phase==='select_character'&&isMe&&p.selectedCharacter?p.selectedCharacter.icon:'❓';
    const pips=p.city.map(c=>`<div class="cpip" style="background:${CCSS[c.color]};border-color:${CCSS[c.color]}55" title="${c.name}"></div>`).join('');
    const isHuman=!p.isAI;
    d.innerHTML=`
      <div class="pc-top">
        <div class="pc-av" style="background:${p.color}22;border-color:${p.color}">${p.avatar}</div>
        <div style="flex:1;min-width:0">
          <div class="pc-name" style="color:${isMe?'#c39bd3':p.color}">${p.name}${isMe?' (나)':''}</div>
          <div class="pc-tags">
            ${isHuman&&!p.isAI?'<span class="tag t-human">👤</span>':''}
            ${p.isAI?'<span class="tag t-ai">AI</span>':''}
            ${isTurn?'<span class="tag t-turn">▶</span>':''}
            ${p.crown?'<span class="tag t-crown">👑</span>':''}
            ${p.complete?'<span class="tag t-done">완성</span>':''}
            ${isDead?'<span class="tag t-dead">💀</span>':''}
          </div>
        </div>
        <div class="pc-char">${charIcon}</div>
      </div>
      <div class="pc-stats">
        <span class="pc-stat">💰<strong>${p.gold}</strong></span>
        <span class="pc-stat">🃏<strong>${p.hand.length}</strong></span>
        <span class="pc-stat">🏛️<strong>${p.city.length}/7</strong></span>
        <span class="pc-stat">⭐<strong>${calcScore(p)}</strong></span>
      </div>
      ${p.city.length?`<div class="pc-city">${pips}</div>`:''}
    `;
    container.appendChild(d);
  });
}

function renderFeed(){
  const list=document.getElementById('feedList');list.innerHTML='';
  if(!G)return;
  G.log.slice(0,35).forEach(e=>{
    const d=el('div',`fe ev-${e.type||'system'}`);
    d.innerHTML=`<span class="fe-icon">${e.icon}</span><span class="fe-text">${e.html}</span>`;
    list.appendChild(d);
  });
  document.getElementById('feedCnt').textContent=`${G.log.length}건`;
}

function rMain(){
  const main=document.getElementById('mainArea');main.innerHTML='';
  if(!G)return;
  if(G.phase==='select_character')rCharSelect(main);
  else rTurnPhase(main);
}

function rCharSelect(main){
  const mi=myIdx(),myTurn=G.selOrder[G.selIdx]===mi,me=G.players[mi];
  const ban=el('div','banner bn-sel');
  ban.innerHTML=`<div class="bn-icon">🎭</div><div><div class="bn-title" style="color:#c39bd3">${myTurn?'⚡ 캐릭터를 선택하세요!':'⏳ 선택 대기 중...'}</div><div class="bn-desc">${myTurn?`<b>${G.availChars.length}개</b> 중 하나를 선택. 비밀리에 선택됩니다.`:me.selectedCharacter?`<b>${me.selectedCharacter.icon}${me.selectedCharacter.name}</b> 선택 완료. 다른 플레이어 대기 중...`:'다른 플레이어가 선택 중...'}
  </div></div>`;
  main.appendChild(ban);
  if(!myTurn&&me.selectedCharacter){
    const strip=el('div','my-strip');const ch=me.selectedCharacter;
    strip.style.cssText=`background:${ch.bg};border-color:${ch.bc};`;
    strip.innerHTML=`<div style="font-size:38px">${ch.icon}</div><div><div style="font-size:9px;color:var(--dim);letter-spacing:2px;font-family:Georgia,serif;margin-bottom:2px">내 캐릭터</div><div style="font-size:15px;font-weight:800;color:${ch.tc}">${ch.id}. ${ch.name}</div><div style="font-size:10px;color:var(--dim2);margin-top:3px;line-height:1.5">${ch.abilityShort}</div></div>`;
    main.appendChild(strip); return;
  }
  if(!myTurn)return;
  const t=el('div','sect');t.textContent='선택 가능한 캐릭터';main.appendChild(t);
  const grid=el('div','csel-grid');
  G.availChars.forEach(ch=>{
    const c=el('div','csel-card');
    c.style.cssText=`background:${ch.bg};border-color:${ch.bc};`;
    c.innerHTML=`<span class="csel-icon">${ch.icon}</span><div class="csel-num" style="color:${ch.tc}">${ch.id}번</div><div class="csel-name" style="color:${ch.tc}">${ch.name}</div><div class="csel-ab">${ch.ability}</div>`;
    c.onmouseover=()=>{c.style.transform='translateY(-4px)';c.style.boxShadow=`0 8px 20px rgba(0,0,0,.4),0 0 18px ${ch.tc}35`;};
    c.onmouseout=()=>{c.style.transform='';c.style.boxShadow='';};
    c.onclick=()=>selectCharacter(ch.id);
    grid.appendChild(c);
  });
  main.appendChild(grid);
}

function rTurnPhase(main){
  const mi=myIdx(),me=G.players[mi],myTurn=isMyTurn(),ch=me.selectedCharacter;
  const curP=G.players[G.curPi];
  const isDC=myTurn&&G.actionPhase==='draw_choice';
  const isObs=myTurn&&G.actionPhase==='observatory';

  // 배너
  const ban=el('div',`banner ${myTurn?'bn-act':aiRunning?'bn-wait':'bn-wait'}`);
  ban.innerHTML=`<div class="bn-icon">${myTurn?'⚡':curP?.selectedCharacter?.icon||'⏳'}</div><div><div class="bn-title" style="color:${myTurn?'var(--gold2)':'var(--text)'}">${myTurn?'⚡ 내 턴!':aiRunning?`${curP?.name} 행동 중...`:`${curP?.name}의 턴`}</div><div class="bn-desc">${myTurn?G.actionPhase==='choose'?'💰 금화 받기 또는 🃏 카드 뽑기를 선택하세요':isDC?'뽑은 카드 중 <b>1장을 선택</b>하세요 (나머지 버림)':isObs?'3장 중 <b>1장 선택</b> (천문대)':pendingAbility?'능력 사용 중 — 타깃 선택 또는 취소':'🏛️ 건설하거나 능력 사용 후 턴 종료':aiRunning?'진행 기록을 확인하세요.':'기다리는 중...'}</div></div>`;
  main.appendChild(ban);

  // 내 캐릭터
  if(ch){
    const s=el('div','my-strip');s.style.cssText=`background:${ch.bg};border-color:${ch.bc};border-radius:9px;`;
    s.innerHTML=`<div style="font-size:32px">${ch.icon}</div><div style="flex:1"><div style="font-size:9px;color:var(--dim);letter-spacing:2px;font-family:Georgia,serif;margin-bottom:1px">내 캐릭터</div><div style="font-size:14px;font-weight:800;color:${ch.tc}">${ch.id}. ${ch.name}</div><div style="font-size:10px;color:var(--dim2);margin-top:2px;line-height:1.5">${ch.abilityShort}</div></div><div style="text-align:right;font-size:11px;color:var(--dim2);flex-shrink:0;line-height:2">💰${me.gold}<br>🃏${me.hand.length}<br>⭐${calcScore(me)}${ch.id===7?`<br><span style="color:#89c4f4;font-size:9px">건설${me.buildsLeft}회</span>`:''}</div>`;
    main.appendChild(s);
  }

  // 능력 힌트
  if(pendingAbility){
    const msgs={assassin:'🗡️ 우측 캐릭터 목록에서 암살할 캐릭터 클릭',thief:'🦹 우측 캐릭터 목록에서 훔칠 캐릭터 클릭 (암살자·도둑 제외)',warlord:'⚔️ 좌측 플레이어를 클릭해 파괴할 건물 선택',wizard:'🔮 아래에서 마술사 능력을 선택하세요'};
    const h=el('div','hint');h.innerHTML=msgs[pendingAbility]||'';main.appendChild(h);
  }

  // 마술사 UI
  if(pendingAbility==='wizard'&&wizardMode===null){
    const wp=el('div','wiz-panel');
    wp.innerHTML=`<div class="wiz-title">🔮 마술사 능력 선택</div>`;
    const b1=el('button','wiz-btn');b1.innerHTML='① 다른 플레이어와 손패 전체 교환<br><small>좌측에서 플레이어를 클릭</small>';
    b1.onclick=()=>{wizardMode='swap';rPlayerList();};
    const b2=el('button','wiz-btn');b2.innerHTML='② 손패 일부 버리고 새로 뽑기<br><small>아래 손패에서 버릴 카드 선택</small>';
    b2.onclick=()=>{wizardMode='discard';wizDiscardSel=[];render();};
    wp.appendChild(b1);wp.appendChild(b2);main.appendChild(wp);
  }

  // 마술사 swap: 플레이어 목록에서 선택 (좌측 패널에서 처리됨)
  if(pendingAbility==='wizard'&&wizardMode==='swap'){
    const h=el('div','hint');h.textContent='👈 좌측에서 교환할 플레이어를 클릭하세요';main.appendChild(h);
    // 플레이어 목록에 클릭 이벤트 추가
    document.querySelectorAll('.pcard').forEach((card,i)=>{
      if(i!==mi){card.classList.add('tsel');card.onclick=()=>wizardSwapTarget(i);}
    });
  }

  // 카드 뽑기 선택
  if(isDC&&G._drawOpts){
    const t=el('div','sect');t.textContent='🃏 카드 선택 (1장 고르기)';main.appendChild(t);
    const grid=el('div','hand-grid');
    G._drawOpts.forEach(card=>{
      const e=mkCard(card);e.classList.add('draw-pick');
      e.onclick=()=>chooseDraw(card.uid);grid.appendChild(e);
    });
    main.appendChild(grid);return;
  }
  if(isObs&&G._obsCards){
    const t=el('div','sect');t.textContent='🔭 천문대: 3장 중 1장 선택';main.appendChild(t);
    const grid=el('div','hand-grid');
    G._obsCards.forEach(card=>{
      const e=mkCard(card);e.classList.add('draw-pick');
      e.onclick=()=>chooseDraw(card.uid);grid.appendChild(e);
    });
    main.appendChild(grid);return;
  }

  // 수입 선택 버튼
  if(myTurn&&G.actionPhase==='choose'){
    const t=el('div','sect');t.textContent='수입 선택';main.appendChild(t);
    const row=el('div','income-row');
    const g=el('div','inc-btn inc-gold');
    g.innerHTML=`<div class="inc-icon">💰</div><div class="inc-lbl">금화 2개 받기</div><div class="inc-sub">안정적 수입</div>`;
    g.onclick=takeGold;
    const cb=el('div','inc-btn inc-card');
    cb.innerHTML=`<div class="inc-icon">🃏</div><div class="inc-lbl">카드 뽑기</div><div class="inc-sub">2장 보고 1장 선택 (덱: ${G.deck.length}장)</div>`;
    cb.onclick=drawCard;
    row.appendChild(g);row.appendChild(cb);main.appendChild(row);
  }

  // 손패
  const ht=el('div','sect');
  ht.innerHTML=`🃏 내 손패 (${me.hand.length}장) <span style="font-size:9px;color:var(--dim);margin-left:6px;font-family:system-ui;letter-spacing:0;font-weight:400">클릭=선택 | 우클릭=정보</span>`;
  main.appendChild(ht);
  const isWD=myTurn&&pendingAbility==='wizard'&&wizardMode==='discard';
  if(!me.hand.length){const e=el('div','empty');e.textContent='손패 없음';main.appendChild(e);}
  else{
    const grid=el('div','hand-grid');
    me.hand.forEach(card=>{
      const c=mkCard(card);
      const isSel=selCard===card.uid, isDS=wizDiscardSel.includes(card.uid);
      if(isSel)c.classList.add('sel');
      if(isDS)c.classList.add('dscard');
      if(isWD){c.onclick=()=>{if(isDS)wizDiscardSel=wizDiscardSel.filter(u=>u!==card.uid);else wizDiscardSel.push(card.uid);render();};}
      else if(myTurn&&G.actionPhase==='build'){
        if(me.gold<card.cost||me.buildsLeft<=0)c.classList.add('disabled');
        else c.onclick=()=>{selCard=selCard===card.uid?null:card.uid;render();};
      } else c.style.cursor='default';
      c.addEventListener('contextmenu',e2=>{e2.preventDefault();openTT(card);});
      grid.appendChild(c);
    });
    main.appendChild(grid);
    if(isWD&&wizDiscardSel.length>0){
      const b=el('button','ab ab-purple');b.style.marginTop='7px';
      b.textContent=`🔮 ${wizDiscardSel.length}장 버리고 새로 뽑기`;
      b.onclick=()=>{
        const action={type:'use_ability',abilityType:'wizard_discard',uids:wizDiscardSel};
        if(MY_ROOM!=='LOCAL'&&!IS_HOST)sendAction(action);
        else doUseAbility(mi,action);
      };
      main.appendChild(b);
    }
  }

  // 내 도시
  const ct=el('div','sect');ct.textContent=`🏛️ 내 도시 (${me.city.length}/7) — ⭐ ${calcScore(me)}점`;main.appendChild(ct);
  if(!me.city.length){const e=el('div','empty');e.textContent='건설된 건물 없음';main.appendChild(e);}
  else{
    const grid=el('div','hand-grid');
    me.city.forEach(card=>{
      const c=mkCard(card);c.classList.add('city-card');
      c.onclick=()=>openTT(card);
      c.addEventListener('contextmenu',e2=>{e2.preventDefault();openTT(card);});
      grid.appendChild(c);
    });
    main.appendChild(grid);
  }

  // 장군 파괴 UI
  if(pendingAbility==='warlord'&&warlordTargetPi!==null){
    renderWarlordOverlay(warlordTargetPi);
  }
}

function wizardSwapTarget(targetPi){
  const action={type:'use_ability',abilityType:'wizard_swap',targetPi};
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction(action);pendingAbility=null;wizardMode=null;render();return;}
  doUseAbility(myIdx(),action);
}

function renderWarlordOverlay(tpi){
  const main=document.getElementById('mainArea');
  const old=document.getElementById('woOverlay');if(old)old.remove();
  const tp=G.players[tpi];if(!tp)return;
  const wrap=el('div','wo-wrap');wrap.id='woOverlay';
  wrap.innerHTML=`<div class="wo-title">⚔️ ${tp.name}의 건물 — 파괴할 건물을 선택하세요</div>`;
  const grid=el('div','wo-grid');
  const p=G.players[myIdx()];
  tp.city.forEach(dist=>{
    const cost=Math.max(0,dist.cost-1);const canAfford=p.gold>=cost;
    const c=mkCard(dist);
    if(!canAfford){c.classList.add('disabled');c.title=`💰${cost} 필요`;}
    else{
      c.onclick=()=>{
        const action={type:'use_ability',abilityType:'warlord',targetPi:tpi,distUid:dist.uid};
        if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction(action);pendingAbility=null;warlordTargetPi=null;render();return;}
        doUseAbility(myIdx(),action);
      };
      const badge=el('div','wo-cost');badge.textContent=cost===0?'무료':`💰${cost}`;c.appendChild(badge);
    }
    grid.appendChild(c);
  });
  wrap.appendChild(grid);
  const cancel=el('button','ab ab-dim');cancel.style.marginTop='7px';cancel.textContent='✖️ 취소';
  cancel.onclick=cancelAbility;wrap.appendChild(cancel);
  main.appendChild(wrap);
}

function rCharPanel(){
  const list=document.getElementById('charList');list.innerHTML='';
  const mi=myIdx(),myCh=G.players[mi].selectedCharacter;
  const isAT=pendingAbility==='assassin',isTT=pendingAbility==='thief';
  CHARS.forEach(ch=>{
    const pi=G.selectedChars[ch.id],picked=pi!==undefined,isMine=pi===mi;
    const isRm=!picked&&!G.availChars.find(c=>c.id===ch.id);
    const isDead=G.assassinTarget===ch.id,isThf=G.thiefTarget===ch.id;
    const canT=(isAT||isTT)&&ch.id!==myCh?.id&&!(isTT&&ch.id<=2)&&!(isTT&&G.assassinTarget===ch.id);
    const d=el('div','ci'+(isRm?' removed':'')+(isMine?' mine':'')+(canT?' tmode':''));
    d.style.cssText=`background:${isRm?'rgba(255,255,255,.02)':ch.bg};border-color:${isMine?ch.bc:'rgba(255,255,255,.05)'};`;
    d.innerHTML=`<div class="ci-head"><span class="ci-num">${ch.id}</span><span class="ci-icon">${ch.icon}</span><span class="ci-name" style="color:${ch.tc}">${ch.name}</span></div><div class="ci-ab">${ch.abilityShort}</div><div class="ci-badges">${isMine?'<span class="cbadge cb-mine">◀ 나</span>':''}${isDead?'<span class="cbadge cb-dead">💀 암살됨</span>':''}${isThf?'<span class="cbadge cb-thf">🦹 타깃</span>':''}${isRm&&G.phase==='select_character'?'<span class="cbadge cb-rm">제거됨</span>':''}</div>`;
    if(canT)d.onclick=()=>selectAbilityTarget(ch.id);
    list.appendChild(d);
  });
}

function rCityPanel(){
  const panel=document.getElementById('cityPanel');
  panel.innerHTML=`<div style="font-size:9px;letter-spacing:2px;color:var(--dim);font-family:Georgia,serif;margin-bottom:6px">다른 플레이어 도시</div>`;
  const mi=myIdx();
  G.players.filter((_,i)=>i!==mi).forEach(p=>{
    if(!p.city.length)return;
    const row=el('div','cpr');
    row.innerHTML=`<div class="cpr-name">${p.avatar} ${p.name} <span style="color:var(--dim)">(${p.city.length}/7) ⭐${calcScore(p)}</span></div>`;
    const pips=el('div','cpips');
    p.city.forEach(c=>{
      const pip=el('div','cpi');
      pip.style.cssText=`background:${CCSS[c.color]}22;border-color:${CCSS[c.color]}66;color:${CCSS[c.color]};`;
      pip.innerHTML=`${c.icon}<span>${c.name}</span>`;
      pip.onclick=()=>openTT(c);
      pips.appendChild(pip);
    });
    row.appendChild(pips);panel.appendChild(row);
  });
}

function rActionBar(){
  const bar=document.getElementById('abar-btns');bar.innerHTML='';
  if(!G)return;
  if(G.phase==='select_character'){
    if(!isMyCharSel()){const w=el('div','ab-wait');w.innerHTML=`<span class="ab-dot"></span> 캐릭터 선택 대기 중...`;bar.appendChild(w);}
    return;
  }
  if(!isMyTurn()){
    const w=el('div','ab-wait');
    w.innerHTML=`<span class="ab-dot"></span> ${G.players[G.curPi]?.name}의 턴${aiRunning?' — 행동 중...':''}`;
    bar.appendChild(w);return;
  }
  const me=G.players[myIdx()],ch=me.selectedCharacter;
  if(G.actionPhase==='choose'){btn(bar,'💰 금화 2개','ab ab-gold',takeGold);btn(bar,'🃏 카드 뽑기','ab ab-blue',drawCard);return;}
  if(G.actionPhase==='draw_choice'||G.actionPhase==='observatory')return;
  if(G.actionPhase==='build'){
    const bl=selCard?`🏛️ 건설 (💰${me.hand.find(c=>c.uid===selCard)?.cost??'?'})`:'🏛️ 건물 선택 후 건설';
    const bb=btn(bar,bl,'ab ab-green',()=>{if(selCard)buildDistrict(selCard);});
    if(!selCard)bb.disabled=true;
    if(ch&&[1,2,3,8].includes(ch.id)){
      if(!abilityUsed)btn(bar,`${ch.icon} ${ch.name} 능력`,'ab ab-purple',useAbility);
      else{const ab=btn(bar,`${ch.icon} 능력 (사용됨)`,'ab ab-dim',null);ab.disabled=true;}
    }
    if(pendingAbility)btn(bar,'✖️ 취소','ab ab-dim',cancelAbility);
    btn(bar,'✅ 턴 종료','ab ab-end',endTurn);
  }
}

function btn(container,label,cls,fn){
  const b=document.createElement('button');b.className=cls;b.innerHTML=label;
  if(fn)b.onclick=fn;else b.disabled=true;
  container.appendChild(b);return b;
}

function mkCard(d){
  const c=el('div',`dcard c-${d.color}`);
  c.innerHTML=`<div class="dc-icon">${d.icon}</div><div class="dc-name">${d.name}</div><div class="dc-cost">${d.cost}</div>${d.special?'<div class="dc-sp" title="특수 능력">✨</div>':''}`;
  return c;
}

function openTT(d){
  document.getElementById('ttIcon').textContent=d.icon;
  document.getElementById('ttName').textContent=d.name;document.getElementById('ttName').style.color=CCSS[d.color];
  document.getElementById('ttType').textContent=CLABEL[d.color]+' 지구';
  const cb=document.getElementById('ttCB');cb.textContent=d.cost;cb.style.background=CCSS[d.color];cb.style.color=d.color==='purple'?'#fff':'#07090f';
  const sb=document.getElementById('ttSpBox');
  if(d.special){document.getElementById('ttSpText').textContent=d.special;sb.classList.remove('hidden');}else sb.classList.add('hidden');
  document.getElementById('ttModal').classList.remove('hidden');
}
function closeTT(){document.getElementById('ttModal').classList.add('hidden');}
