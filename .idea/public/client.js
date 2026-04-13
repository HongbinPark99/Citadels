// client.js — 시타델 멀티플레이어 클라이언트 (완전 재작성)
'use strict';

// ══════════════════════════════════════════════════
// 전역 상태
// ══════════════════════════════════════════════════
let ws          = null;
let G           = null;
let MY_ID       = null;
let MY_ROOM     = null;   // 'LOCAL' 또는 방코드
let IS_HOST     = false;
let AI_SOLO     = 3;
let AI_WAIT     = 0;

// UI 상태
let selCard         = null;
let pendingAbility  = null;  // 'assassin'|'thief'|'warlord'|'wizard'
let wizardMode      = null;  // null|'swap'|'discard'
let wizDiscardSel   = [];
let warlordTgtPi    = null;
let abilityUsed     = false;
let aiQueue         = [];
let aiRunning       = false;
let ntTimer         = null;

const CCSS   = {yellow:'#d4a017',blue:'#5b9bd5',green:'#4caf7d',red:'#e05252',purple:'#9b59b6'};
const CLABEL = {yellow:'귀족',blue:'종교',green:'상업',red:'군사',purple:'특수'};

// ══════════════════════════════════════════════════
// 유틸
// ══════════════════════════════════════════════════
function uid() { return Math.random().toString(36).slice(2,10).toUpperCase(); }
function el(tag,cls){ const e=document.createElement(tag); if(cls)e.className=cls; return e; }
function $(id){ return document.getElementById(id); }

function notify(msg, type='info'){
  const e=$('notif'); e.textContent=msg; e.className=`show n-${type}`;
  if(ntTimer)clearTimeout(ntTimer);
  ntTimer=setTimeout(()=>e.className='',2800);
}

function myIdx(){ return G?.players.findIndex(p=>p.id===MY_ID)??0; }
function isMyTurn(){ return G&&G.phase==='player_turn'&&G.curPi===myIdx()&&!aiRunning; }
function isMyCharSel(){ return G&&G.phase==='select_character'&&G.selOrder[G.selIdx]===myIdx(); }

function calcScore(p){
  let s=0; const cols=new Set();
  p.city.forEach(d=>{ s+=d.cost; if(['university','dragondoor','school'].includes(d.id))s+=3; cols.add(d.color); });
  if(cols.size>=5)s+=3;
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
  if(G.log.length>80)G.log.pop();
}

// ══════════════════════════════════════════════════
// WebSocket
// ══════════════════════════════════════════════════
function connectWS(onOpen){
  const proto = location.protocol==='https:'?'wss':'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen  = ()=>{ setConnSt('ok','✅ 서버 연결됨'); if(onOpen)onOpen(); };
  ws.onclose = ()=>setConnSt('err','❌ 연결 끊김 — 새로고침하세요');
  ws.onerror = ()=>setConnSt('err','❌ 연결 오류');
  ws.onmessage = e=>handleServerMsg(JSON.parse(e.data));
  setInterval(()=>{ if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'ping'})); },20000);
}

function wsSend(obj){
  if(ws&&ws.readyState===1)ws.send(JSON.stringify(obj));
}

function setConnSt(type,text){
  const e=$('connStatus'); if(!e)return;
  e.className=`conn-status conn-${type}`; e.textContent=text;
}

// ── 서버 메시지 수신 ──
function handleServerMsg(msg){
  console.log('[WS recv]',msg.type, msg);
  switch(msg.type){
    case 'room_created':
      MY_ROOM=msg.code;
      onWaitingRoom(msg.room);
      break;
    case 'room_joined':
      MY_ROOM=msg.code;
      onWaitingRoom(msg.room);
      break;
    case 'room_update':
      onWaitingRoom(msg.room);
      break;
    case 'game_start':
      // 호스트: G 빌드 후 sync; 비호스트: 대기
      if(IS_HOST){
        G = buildInitialG(msg.room.players);
        enterGameScreen();
        aiAutoSelectHost();
        syncState();
        render();
      } else {
        enterGameScreen();
        // G는 state_update로 받음
        showWaitingForState();
      }
      break;
    case 'state_update':
      // 비호스트가 받는 전체 상태
      G = msg.G;
      aiRunning = false; aiQueue = [];
      render();
      if(msg.gameOver)showGameOver();
      break;
    case 'player_action':
      // 호스트만 받음: 원격 플레이어의 행동 처리
      if(IS_HOST) applyRemoteAction(msg.playerId, msg.action);
      break;
    case 'player_left':
      notify('플레이어 연결 끊김','warn');
      if(msg.room&&G===null) onWaitingRoom(msg.room);
      break;
    case 'chat':
      feed('💬',`<b>${msg.name}:</b> ${escHtml(msg.text)}`,'system');
      renderFeed();
      break;
    case 'error':
      notify(msg.msg,'bad');
      break;
  }
}

function escHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ══════════════════════════════════════════════════
// 로비 이벤트
// ══════════════════════════════════════════════════
$('tabs').addEventListener('click',e=>{
  const t=e.target.closest('.tab'); if(!t)return;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
  t.classList.add('on');
  ['solo','host','join'].forEach(id=>$('t-'+id).classList.add('hidden'));
  $('t-'+t.dataset.t).classList.remove('hidden');
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

// ── 솔로 ──
function startSolo(){
  const name=$('soloName').value.trim()||'영주';
  MY_ID=uid(); IS_HOST=true; MY_ROOM='LOCAL';
  const total=1+AI_SOLO;
  const players=Array.from({length:total},(_,i)=>({
    id:i===0?MY_ID:uid(), name:i===0?name:`AI ${i}`,
    isAI:i!==0, avatar:AVATARS[i], color:P_COLORS[i],
  }));
  G=buildInitialG(players);
  enterGameScreen();
  aiAutoSelectHost();
  render();
}

// ── 방 만들기 ──
function doCreateRoom(){
  const name=$('hostName').value.trim()||'호스트';
  MY_ID=uid(); IS_HOST=true;
  goWaitScreen(true);
  connectWS(()=>{
    wsSend({type:'create_room',playerId:MY_ID,name});
  });
}

// ── 방 참가 ──
function doJoinRoom(){
  const name=$('joinName').value.trim()||'플레이어';
  const code=$('joinCode').value.trim().toUpperCase();
  if(code.length<4){notify('방 코드를 입력하세요!','warn');return;}
  MY_ID=uid(); IS_HOST=false;
  goWaitScreen(false);
  connectWS(()=>{
    wsSend({type:'join_room',playerId:MY_ID,name,code});
  });
}

function goWaitScreen(isHost){
  $('screen-lobby').classList.add('hidden');
  $('screen-waiting').classList.remove('hidden');
  $('aiWaitWrap').classList.toggle('hidden',!isHost);
  $('hostStartWrap').classList.toggle('hidden',!isHost);
  $('waitMsg').classList.toggle('hidden',isHost);
}

function onWaitingRoom(room){
  $('wCode').textContent=room.code;
  const list=$('wList'); list.innerHTML='';
  room.players.forEach((p,i)=>{
    const d=el('div','w-player'+(i===0?' host':''));
    const isMe=p.id===MY_ID;
    d.innerHTML=`<span class="w-dot"></span><span style="font-size:17px">${p.avatar}</span><span style="font-size:13px;font-weight:700;color:${isMe?'#c39bd3':'var(--text)'}">${p.name}${isMe?' (나)':''}</span>${i===0?'<span style="margin-left:auto;font-size:9px;color:var(--gold)">HOST</span>':''}`;
    list.appendChild(d);
  });
}

function hostStart(){
  if(!IS_HOST)return;
  wsSend({type:'start_game',aiCount:AI_WAIT});
}

function copyCode(){
  navigator.clipboard?.writeText(MY_ROOM).then(()=>notify('코드 복사됨!','ok'));
}

// ══════════════════════════════════════════════════
// 게임 화면 전환
// ══════════════════════════════════════════════════
function enterGameScreen(){
  $('screen-lobby').classList.add('hidden');
  $('screen-waiting').classList.add('hidden');
  $('screen-game').classList.remove('hidden');
  if(MY_ROOM!=='LOCAL') $('chatBar').classList.remove('hidden');
}

function showWaitingForState(){
  // 비호스트용: G 수신 전 로딩 표시
  const main=$('mainArea'); main.innerHTML='';
  const d=el('div','banner bn-wait');
  d.innerHTML='<div class="bn-icon">⏳</div><div><div class="bn-title">게임 데이터 수신 중...</div><div class="bn-desc">호스트에서 게임 상태를 받고 있습니다.</div></div>';
  main.appendChild(d);
}

function goLobby(){
  $('goModal').classList.add('hidden');
  $('screen-game').classList.add('hidden');
  $('chatBar').classList.add('hidden');
  $('screen-lobby').classList.remove('hidden');
  G=null; selCard=null; aiQueue=[]; aiRunning=false;
  pendingAbility=null; wizardMode=null; wizDiscardSel=[]; warlordTgtPi=null;
}

// ══════════════════════════════════════════════════
// 상태 동기화
// ══════════════════════════════════════════════════
function syncState(){
  if(MY_ROOM==='LOCAL'||!IS_HOST)return;
  wsSend({type:'sync_state', G, gameOver:!!G?.gameOver});
}

// 비호스트 → 호스트로 행동 전송
function sendAction(action){
  if(MY_ROOM==='LOCAL'||IS_HOST)return;
  wsSend({type:'player_action', action});
}

// 호스트: 원격 행동 적용
function applyRemoteAction(playerId, action){
  const pi=G.players.findIndex(p=>p.id===playerId);
  if(pi<0){console.warn('플레이어 없음:',playerId);return;}
  switch(action.type){
    case 'select_char':  execSelectChar(pi,action.charId); break;
    case 'take_gold':    execTakeGold(pi); break;
    case 'draw_card':    execDrawCard(pi); break;
    case 'choose_draw':  execChooseDraw(pi,action.uid); break;
    case 'build':        execBuild(pi,action.uid); break;
    case 'use_ability':  execAbility(pi,action); break;
    case 'end_turn':     execEndTurn(pi); break;
  }
}

// ══════════════════════════════════════════════════
// 캐릭터 선택
// ══════════════════════════════════════════════════

// 호스트: AI들이 선택해야 할 자리를 미리 채움 (내 차례 직전까지)
function aiAutoSelectHost(){
  while(
    G.phase==='select_character' &&
    G.selIdx < G.players.length &&
    G.selOrder[G.selIdx] !== myIdx()
  ){
    const pi = G.selOrder[G.selIdx];
    const p  = G.players[pi];

    // AI가 아닌 실제 플레이어면 멈춤 (그 플레이어의 선택을 기다려야 함)
    if(!p.isAI){
      // 비호스트 실제 플레이어: 클라이언트에서 player_action으로 select_char가 올 때까지 대기
      break;
    }

    // AI 자동 선택
    if(G.availChars.length){
      const pick = G.availChars.splice(Math.floor(Math.random()*G.availChars.length),1)[0];
      G.selectedChars[pick.id] = pi;
      G.players[pi].selectedCharacter = pick;
    }
    G.selIdx++;
  }

  // 모두 선택 완료 시 자동 진행
  if(G.selIdx >= G.players.length) beginTurns();
}

function selectCharacter(charId){
  if(!isMyCharSel())return;

  if(MY_ROOM!=='LOCAL'&&!IS_HOST){
    // 비호스트: 서버 통해 호스트에게 전달
    sendAction({type:'select_char',charId});
    return;
  }
  execSelectChar(myIdx(), charId);
}

function execSelectChar(pi, charId){
  if(G.phase!=='select_character')return;
  if(G.selOrder[G.selIdx]!==pi){
    console.warn(`캐릭터 선택 순서 아님: 예상=${G.selOrder[G.selIdx]}, 실제=${pi}`);
    return;
  }
  const ch=G.availChars.find(c=>c.id===charId);
  if(!ch){console.warn('캐릭터 없음:',charId);return;}

  G.selectedChars[ch.id]=pi;
  G.players[pi].selectedCharacter=ch;
  G.availChars=G.availChars.filter(c=>c.id!==charId);
  G.selIdx++;
  feed('🎭',`<b>${G.players[pi].name}</b>이(가) 캐릭터를 선택했습니다.`,'system');

  // 다음 AI들 자동 선택 (실제 플레이어 만나면 멈춤)
  aiAutoSelectHost();

  syncState(); render();
}

// ══════════════════════════════════════════════════
// 행동 단계
// ══════════════════════════════════════════════════
function beginTurns(){
  G.phase='player_turn'; G.curCharIdx=1;
  feed('⚔️','<b>행동 단계!</b> 1번→8번 순서로 행동합니다.','system');
  advanceChar(1);
}

function advanceChar(idx){
  if(idx>8){
    if(G.players.some(p=>p.complete)){resolveGameOver();return;}
    nextRound(); return;
  }
  G.curCharIdx=idx;

  // 암살 처리
  if(G.assassinTarget===idx){
    const ki=Object.entries(G.selectedChars).find(([k])=>+k===idx)?.[1];
    if(ki!==undefined){
      feed('💀',`<b>${G.players[ki].name}(${CHARS.find(c=>c.id===idx)?.name})</b>이(가) 암살당해 턴 스킵!`,'combat');
      advanceChar(idx+1); return;
    }
  }

  const entry=Object.entries(G.selectedChars).find(([k])=>+k===idx);
  if(!entry){advanceChar(idx+1);return;}
  const pi=+entry[1];

  // 도둑 탈취
  if(G.thiefTarget===idx&&G.thiefPi!==null&&G.thiefPi!==pi){
    const stolen=G.players[pi].gold;
    G.players[G.thiefPi].gold+=stolen; G.players[pi].gold=0;
    feed('🦹',`<b>${G.players[G.thiefPi].name}(도둑)</b>이(가) <b>${G.players[pi].name}</b>의 💰${stolen}을 빼앗았습니다!`,'combat');
  }

  G.curPi=pi; G.actionPhase='choose';
  G.players[pi].abilityUsed=false;
  G.players[pi].buildsLeft=G.players[pi].selectedCharacter?.id===7?3:1;

  const mi=myIdx();
  if(pi===mi){
    abilityUsed=false;
    feed('✨','<b>내 턴!</b> 수입을 선택하세요.','system');
  } else if(G.players[pi].isAI){
    enqueueAI(pi);
  } else {
    feed('⏳',`<b>${G.players[pi].name}</b>(${G.players[pi].selectedCharacter?.name})의 턴입니다.`,'system');
  }
}

// ── 수입 ──
function takeGold(){
  if(!isMyTurn()||G.actionPhase!=='choose')return;
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction({type:'take_gold'});return;}
  execTakeGold(myIdx());
}
function execTakeGold(pi){
  if(G.phase!=='player_turn'||G.curPi!==pi||G.actionPhase!=='choose')return;
  const p=G.players[pi];
  p.gold+=2;
  feed('💰',`<b>${p.name}</b>이(가) 금화 2개를 받았습니다. (보유: ${p.gold}💰)`,'gold');
  applyIncome(pi);
  if(p.selectedCharacter?.id===7){
    const c1=deckPop(),c2=deckPop();
    if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);
    feed('🏗️',`<b>${p.name}(건축가)</b>가 카드 2장 추가.`,'ability');
  }
  G.actionPhase='build';
  if(pi===myIdx())notify('💰 금화 2개!','ok');
  syncState(); render();
}

function drawCard(){
  if(!isMyTurn()||G.actionPhase!=='choose')return;
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction({type:'draw_card'});return;}
  execDrawCard(myIdx());
}
function execDrawCard(pi){
  if(G.phase!=='player_turn'||G.curPi!==pi||G.actionPhase!=='choose')return;
  const p=G.players[pi];
  const hasLib=p.city.some(d=>d.id==='library');
  const hasObs=p.city.some(d=>d.id==='observatory');
  if(hasObs){
    const drawn=[deckPop(),deckPop(),deckPop()].filter(Boolean);
    G._obsCards=drawn; G.actionPhase='observatory';
  } else if(hasLib){
    const c1=deckPop(),c2=deckPop();
    if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);
    feed('📚',`<b>${p.name}(도서관)</b>이(가) 카드 2장 획득.`,'ability');
    applyIncome(pi);
    if(p.selectedCharacter?.id===7){const a=deckPop(),b=deckPop();if(a)p.hand.push(a);if(b)p.hand.push(b);}
    G.actionPhase='build';
  } else {
    const drawn=[deckPop(),deckPop()].filter(Boolean);
    G._drawOpts=drawn; G.actionPhase='draw_choice';
  }
  syncState(); render();
}

function chooseDraw(uid){
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction({type:'choose_draw',uid});return;}
  execChooseDraw(myIdx(),uid);
}
function execChooseDraw(pi,uid){
  const p=G.players[pi];
  const opts=G._drawOpts||G._obsCards||[];
  const chosen=opts.find(c=>c.uid===uid);if(!chosen)return;
  p.hand.push(chosen);
  G.discard.push(...opts.filter(c=>c.uid!==uid));
  feed('🃏',`<b>${p.name}</b>이(가) 카드를 선택했습니다. (손패: ${p.hand.length}장)`,'card');
  G._drawOpts=null;G._obsCards=null;
  applyIncome(pi);
  if(p.selectedCharacter?.id===7){const a=deckPop(),b=deckPop();if(a)p.hand.push(a);if(b)p.hand.push(b);}
  G.actionPhase='build';
  if(pi===myIdx())notify('🃏 카드 선택!','ok');
  syncState(); render();
}

function applyIncome(pi){
  const p=G.players[pi],ch=p.selectedCharacter;if(!ch)return;
  const cm={4:'yellow',5:'blue',6:'green',8:'red'};
  let b=0;
  if(cm[ch.id]){b=p.city.filter(d=>d.color===cm[ch.id]).length;if(ch.id===6)b+=1;}
  if(b>0){p.gold+=b;feed('✨',`<b>${ch.icon}${ch.name}</b> 수입: 💰+${b} (총 ${p.gold}💰)`,'gold');}
}

// ── 건설 ──
function buildDistrict(uid){
  if(!uid&&selCard)uid=selCard;
  if(!uid){notify('건물을 선택하세요!','warn');return;}
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction({type:'build',uid});selCard=null;render();return;}
  execBuild(myIdx(),uid);
}
function execBuild(pi,uid){
  if(G.phase!=='player_turn'||G.curPi!==pi||G.actionPhase!=='build')return;
  const p=G.players[pi];
  if(p.buildsLeft<=0){if(pi===myIdx())notify('건설 횟수 초과!','warn');return;}
  const card=p.hand.find(c=>c.uid===uid);if(!card)return;
  if(p.gold<card.cost){if(pi===myIdx())notify('금화 부족!','warn');return;}
  if(p.city.find(c=>c.id===card.id)){if(pi===myIdx())notify('이미 건설됨!','warn');return;}
  p.gold-=card.cost; p.hand=p.hand.filter(c=>c.uid!==uid); p.city.push(card); p.buildsLeft--;
  selCard=null;
  feed('🏛️',`<b>${p.name}</b>이(가) ${card.icon}<b>${card.name}</b> 건설! (남은 💰: ${p.gold})`,'build');
  if(p.selectedCharacter?.id===4){G.players.forEach(x=>x.crown=false);p.crown=true;feed('👑',`<b>${p.name}(왕)</b>이(가) 왕관 획득!`,'system');}
  if(p.city.length>=7){
    if(!G.players.some(x=>x.complete)){p.firstComplete=true;p.complete=true;feed('🎉',`<b>${p.name}</b>이(가) 7번째 건물로 도시 완성!`,'win');}
    else p.complete=true;
  }
  if(pi===myIdx())notify(`🏛️ ${card.name} 건설!`,'ok');
  syncState(); render();
}

// ── 능력 ──
function useAbility(){
  if(!isMyTurn())return;
  if(abilityUsed){notify('이미 능력을 사용했습니다!','warn');return;}
  const ch=G.players[myIdx()].selectedCharacter;if(!ch)return;
  if(ch.id===1){pendingAbility='assassin';notify('🗡️ 우측에서 암살할 캐릭터 선택','warn');render();return;}
  if(ch.id===2){pendingAbility='thief';notify('🦹 우측에서 훔칠 캐릭터 선택','warn');render();return;}
  if(ch.id===3){pendingAbility='wizard';wizardMode=null;wizDiscardSel=[];render();return;}
  if(ch.id===8){pendingAbility='warlord';warlordTgtPi=null;notify('⚔️ 좌측에서 파괴할 플레이어 선택','warn');render();return;}
}

function triggerAbility(action){
  // 모든 능력 행동 진입점 (내 차례에서 UI로 호출)
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){
    sendAction({type:'use_ability',...action});
    abilityUsed=true; pendingAbility=null; wizardMode=null; wizDiscardSel=[]; warlordTgtPi=null;
    render(); return;
  }
  execAbility(myIdx(), {type:'use_ability',...action});
}

function execAbility(pi, action){
  const p=G.players[pi],ch=p.selectedCharacter;if(!ch)return;
  const at=action.abilityType;

  if(at==='assassin'){
    if(action.charId===ch.id){if(pi===myIdx())notify('자신은 암살 불가!','warn');return;}
    G.assassinTarget=action.charId; p.abilityUsed=true;
    feed('🗡️',`<b>${p.name}(암살자)</b>이(가) <b>${CHARS.find(c=>c.id===action.charId)?.name}</b>을(를) 암살!`,'combat');
    if(pi===myIdx()){abilityUsed=true;pendingAbility=null;}
  }
  else if(at==='thief'){
    if(action.charId<=2){if(pi===myIdx())notify('암살자/도둑은 불가!','warn');return;}
    if(G.assassinTarget===action.charId){if(pi===myIdx())notify('암살된 캐릭터는 불가!','warn');return;}
    G.thiefTarget=action.charId; G.thiefPi=pi; p.abilityUsed=true;
    feed('🦹',`<b>${p.name}(도둑)</b>이(가) <b>${CHARS.find(c=>c.id===action.charId)?.name}</b> 타깃 지정!`,'ability');
    if(pi===myIdx()){abilityUsed=true;pendingAbility=null;}
  }
  else if(at==='wizard_swap'){
    const tpi=action.targetPi,tp=G.players[tpi];
    if(tp){const tmp=p.hand;p.hand=tp.hand;tp.hand=tmp;feed('🔮',`<b>${p.name}(마술사)</b>이(가) <b>${tp.name}</b>과 손패 교환!`,'ability');}
    p.abilityUsed=true;
    if(pi===myIdx()){abilityUsed=true;pendingAbility=null;wizardMode=null;}
  }
  else if(at==='wizard_discard'){
    const uids=action.uids||[];
    const disc=p.hand.filter(c=>uids.includes(c.uid));
    p.hand=p.hand.filter(c=>!uids.includes(c.uid)); G.discard.push(...disc);
    for(let i=0;i<disc.length;i++){const d=deckPop();if(d)p.hand.push(d);}
    feed('🔮',`<b>${p.name}(마술사)</b>이(가) 카드 ${disc.length}장 버리고 새로 뽑기!`,'ability');
    p.abilityUsed=true;
    if(pi===myIdx()){abilityUsed=true;pendingAbility=null;wizardMode=null;wizDiscardSel=[];}
  }
  else if(at==='warlord'){
    const tpi=action.targetPi,duid=action.distUid;
    const tp=G.players[tpi],dist=tp?.city.find(c=>c.uid===duid);
    if(dist&&tp){
      if(tp.selectedCharacter?.id===5&&G.assassinTarget!==5){if(pi===myIdx())notify('주교 건물 파괴 불가!','warn');return;}
      if(tp.city.length>=7){if(pi===myIdx())notify('완성 플레이어 건물 파괴 불가!','warn');return;}
      const cost=Math.max(0,dist.cost-1);
      if(p.gold<cost){if(pi===myIdx())notify(`💰${cost} 필요!`,'warn');return;}
      p.gold-=cost; tp.city=tp.city.filter(c=>c.uid!==duid); G.discard.push(dist);
      feed('⚔️',`<b>${p.name}(장군)</b>이(가) <b>${tp.name}</b>의 ${dist.icon}<b>${dist.name}</b> 파괴! (💰-${cost})`,'combat');
    }
    p.abilityUsed=true;
    if(pi===myIdx()){abilityUsed=true;pendingAbility=null;warlordTgtPi=null;}
  }

  syncState(); render();
}

function cancelAbility(){pendingAbility=null;wizardMode=null;wizDiscardSel=[];warlordTgtPi=null;selCard=null;render();}

function endTurn(){
  if(!isMyTurn())return;
  if(MY_ROOM!=='LOCAL'&&!IS_HOST){sendAction({type:'end_turn'});return;}
  execEndTurn(myIdx());
}
function execEndTurn(pi){
  if(G.phase!=='player_turn'||G.curPi!==pi)return;
  pendingAbility=null;wizardMode=null;wizDiscardSel=[];warlordTgtPi=null;selCard=null;
  feed('✅',`<b>${G.players[pi].name}</b>이(가) 턴을 종료했습니다.`,'system');
  advanceChar(G.curCharIdx+1);
  syncState(); render();
}

// ── 라운드 / 게임 종료 ──
function nextRound(){
  G.round++; G.phase='select_character';
  const ci=Math.max(0,G.players.findIndex(p=>p.crown));
  G.selOrder=Array.from({length:G.players.length},(_,i)=>(ci+i)%G.players.length);
  G.selIdx=0; G.selectedChars={}; G.assassinTarget=null; G.thiefTarget=null; G.thiefPi=null;
  G.players.forEach(p=>{p.selectedCharacter=null;p.abilityUsed=false;p.buildsLeft=1;});
  G.availChars=shuffle([...CHARS]);G.availChars.pop();
  G._drawOpts=null;G._obsCards=null;
  aiQueue=[];aiRunning=false;abilityUsed=false;pendingAbility=null;wizardMode=null;
  feed('🔄',`<b>라운드 ${G.round}</b> 시작! 캐릭터를 선택하세요.`,'system');
  aiAutoSelectHost();
  syncState();
}

function resolveGameOver(){
  G.gameOver=true;
  const sorted=G.players.map(p=>({...p,score:calcScore(p)})).sort((a,b)=>b.score-a.score);
  feed('🏆',`게임 종료! <b>${sorted[0].name}</b> 승리! (${sorted[0].score}점)`,'win');
  syncState(); render(); setTimeout(showGameOver,800);
}

function showGameOver(){
  const sorted=G.players.map(p=>({...p,score:calcScore(p)})).sort((a,b)=>b.score-a.score);
  $('goWinner').textContent=`🎉 ${sorted[0].name} 승리!`;
  const list=$('goScores');list.innerHTML='';
  ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣'].forEach((m,i)=>{
    const p=sorted[i];if(!p)return;
    const li=el('li','go-sc');li.innerHTML=`<span>${m} ${p.avatar} ${p.name}</span><span class="go-pts">${p.score}점</span>`;
    list.appendChild(li);
  });
  $('goModal').classList.remove('hidden');
}

// 채팅
function sendChat(){
  const inp=$('chatInp'),text=inp.value.trim();if(!text)return;
  const name=G?.players.find(p=>p.id===MY_ID)?.name||'나';
  wsSend({type:'chat',name,text}); inp.value='';
}

// ══════════════════════════════════════════════════
// AI 큐
// ══════════════════════════════════════════════════
function enqueueAI(pi){ aiQueue.push(...buildAISteps(pi)); if(!aiRunning)runAIQueue(); }

function buildAISteps(pi){
  const p=G.players[pi],ch=p.selectedCharacter,s=[];
  s.push({t:'ann',pi});
  if(ch?.id===1&&G.assassinTarget===null){
    const oth=Object.entries(G.selectedChars).filter(([k,v])=>+k!==1&&+v!==pi);
    if(oth.length){const t=oth[0|Math.random()*oth.length];s.push({t:'assassin',pi,cid:+t[0]});}
  }
  if(ch?.id===2&&G.thiefTarget===null){
    const oth=Object.entries(G.selectedChars).filter(([k,v])=>+k>2&&+v!==pi&&G.assassinTarget!==+k);
    if(oth.length){const t=oth[0|Math.random()*oth.length];s.push({t:'thief',pi,cid:+t[0]});}
  }
  if(p.gold<4||Math.random()>.4)s.push({t:'gold',pi});else s.push({t:'draw',pi});
  if(ch?.id===7)s.push({t:'arch',pi});
  if(ch?.id===3){
    const oth=G.players.filter((_,i)=>i!==pi&&G.players[i].hand.length>p.hand.length);
    if(oth.length){s.push({t:'wiz_swap',pi,ti:G.players.indexOf(oth[0])});}
  }
  s.push({t:'income',pi});
  if(ch?.id===8&&Math.random()>.5){
    const en=G.players.filter((ep,ei)=>ei!==pi&&ep.city.length>0&&ep.city.length<7&&ep.selectedCharacter?.id!==5);
    if(en.length){const enemy=en[0|Math.random()*en.length];const ei=G.players.indexOf(enemy);const c=enemy.city.reduce((a,b)=>a.cost<b.cost?a:b);const cost=Math.max(0,c.cost-1);if(p.gold>=cost+2)s.push({t:'warlord',pi,ei,uid:c.uid});}
  }
  const maxB=ch?.id===7?3:1;let tg=p.gold,nb=0;
  [...p.hand].filter(c=>!p.city.find(b=>b.id===c.id)).sort((a,b)=>b.cost-a.cost).forEach(d=>{
    if(nb>=maxB||tg<d.cost)return;tg-=d.cost;s.push({t:'build',pi,uid:d.uid});nb++;
  });
  if(ch?.id===4)s.push({t:'crown',pi});
  s.push({t:'next',pi});
  return s;
}

function runAIQueue(){
  if(!G||aiQueue.length===0){aiRunning=false;syncState();render();return;}
  aiRunning=true;
  const s=aiQueue.shift();
  applyAIStep(s);
  const d=s.t==='ann'?900:s.t==='next'?80:s.t==='income'?180:650;
  render();
  setTimeout(runAIQueue,d);
}

function applyAIStep(s){
  if(!G)return;
  const p=G.players[s.pi],ch=p?.selectedCharacter;
  switch(s.t){
    case 'ann': feed(ch?.icon||'⏳',`<b>${p.name}</b>(${ch?.name||'?'})의 턴.`,'system');break;
    case 'assassin': G.assassinTarget=s.cid;feed('🗡️',`<b>${p.name}(암살자)</b>이(가) <b>${CHARS.find(c=>c.id===s.cid)?.name}</b> 암살!`,'combat');break;
    case 'thief': G.thiefTarget=s.cid;G.thiefPi=s.pi;feed('🦹',`<b>${p.name}(도둑)</b> 타깃 지정!`,'ability');break;
    case 'gold': p.gold+=2;feed('💰',`<b>${p.name}</b> 💰+2 (보유: ${p.gold})`,'gold');break;
    case 'draw':{const c=deckPop();if(c){p.hand.push(c);feed('🃏',`<b>${p.name}</b> 카드 뽑기. (${p.hand.length}장)`,'card');}break;}
    case 'arch':{const c1=deckPop(),c2=deckPop();if(c1)p.hand.push(c1);if(c2)p.hand.push(c2);feed('🏗️',`<b>${p.name}(건축가)</b> 카드 2장 추가.`,'ability');break;}
    case 'wiz_swap':{const tp=G.players[s.ti];if(tp){const tmp=p.hand;p.hand=tp.hand;tp.hand=tmp;feed('🔮',`<b>${p.name}(마술사)</b>이(가) <b>${tp.name}</b>과 손패 교환!`,'ability');}break;}
    case 'income': applyIncome(s.pi);break;
    case 'warlord':{const tp=G.players[s.ei],d=tp?.city.find(c=>c.uid===s.uid);if(d&&tp){const cost=Math.max(0,d.cost-1);if(p.gold>=cost){p.gold-=cost;tp.city=tp.city.filter(c=>c.uid!==s.uid);G.discard.push(d);feed('⚔️',`<b>${p.name}(장군)</b>이(가) ${d.icon}<b>${d.name}</b> 파괴!`,'combat');}}break;}
    case 'build':{const d=p.hand.find(c=>c.uid===s.uid);if(d&&p.gold>=d.cost&&!p.city.find(b=>b.id===d.id)){p.gold-=d.cost;p.hand=p.hand.filter(c=>c.uid!==s.uid);p.city.push(d);feed('🏛️',`<b>${p.name}</b> ${d.icon}<b>${d.name}</b> 건설! (남은 💰: ${p.gold})`,'build');if(p.city.length>=7){if(!G.players.some(x=>x.complete)){p.firstComplete=true;p.complete=true;feed('🎉',`<b>${p.name}</b> 도시 완성!`,'win');}else p.complete=true;}}break;}
    case 'crown': G.players.forEach(x=>x.crown=false);p.crown=true;feed('👑',`<b>${p.name}(왕)</b> 왕관!`,'system');break;
    case 'next':
      if(G.players.some(x=>x.complete)){aiQueue=[];resolveGameOver();render();return;}
      advanceChar(G.curCharIdx+1);
      break;
  }
}

// ══════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════
function render(){
  if(!G)return;
  rTopbar(); rTurnBar(); rPlayerList(); renderFeed(); rMain(); rCharPanel(); rCityPanel(); rActionBar();
}

function mkCard(d){
  const c=el('div',`dcard c-${d.color}`);
  c.innerHTML=`<div class="dc-icon">${d.icon}</div><div class="dc-name">${d.name}</div><div class="dc-cost">${d.cost}</div>${d.special?'<div class="dc-sp" title="특수">✨</div>':''}`;
  return c;
}
function openTT(d){
  $('ttIcon').textContent=d.icon;
  $('ttName').textContent=d.name;$('ttName').style.color=CCSS[d.color];
  $('ttType').textContent=CLABEL[d.color]+' 지구';
  const cb=$('ttCB');cb.textContent=d.cost;cb.style.background=CCSS[d.color];cb.style.color=d.color==='purple'?'#fff':'#07090f';
  const sb=$('ttSpBox');
  if(d.special){$('ttSpText').textContent=d.special;sb.classList.remove('hidden');}else sb.classList.add('hidden');
  $('ttModal').classList.remove('hidden');
}
function closeTT(){$('ttModal').classList.add('hidden');}

function rTopbar(){
  const mi=myIdx(),me=G.players[mi];
  $('tbRound').textContent=G.round;$('tbDeck').textContent=G.deck.length;
  $('tbGold').textContent=me.gold;$('tbHand').textContent=me.hand.length;
  $('tbCity').textContent=me.city.length;$('tbScore').textContent=calcScore(me);
  const ph=$('tbPhase');
  if(G.phase==='select_character'){ph.textContent='🎭 캐릭터 선택';ph.className='tb-phase ph-sel';}
  else{const ch=CHARS.find(c=>c.id===G.curCharIdx);ph.textContent=`${ch?.icon||'⚔️'} ${ch?.name} 행동`;ph.className='tb-phase ph-act';}
}

function rTurnBar(){
  const bar=$('turnBar');bar.innerHTML='';
  const lbl=el('div','to-lbl');lbl.textContent=G.phase==='select_character'?'선택 순서 ▶':'행동 순서 ▶';bar.appendChild(lbl);
  if(G.phase==='select_character'){
    G.selOrder.forEach((pi,i)=>{
      const p=G.players[pi],done=i<G.selIdx,cur=i===G.selIdx;
      const d=el('div','to-item'+(done?' done':'')+(cur?' cur':''));
      d.innerHTML=`<div class="to-av" style="border-color:${p.color};background:${p.color}22">${p.avatar}</div><span style="font-size:10px">${p.name.slice(0,4)}${cur?' ▶':done?' ✓':''}</span>`;
      bar.appendChild(d);
      if(i<G.selOrder.length-1){const a=el('div','to-arrow');a.textContent='→';bar.appendChild(a);}
    });
  } else {
    for(let cid=1;cid<=8;cid++){
      const pi=G.selectedChars[cid];if(pi===undefined)continue;
      const p=G.players[pi],ch=CHARS.find(c=>c.id===cid);
      const done=G.curCharIdx>cid,cur=G.curCharIdx===cid,dead=G.assassinTarget===cid;
      const d=el('div','to-item'+(done?' done':'')+(cur?' cur':'')+(dead?' dead':''));
      d.title=`${ch?.name} — ${p.name}`;
      d.innerHTML=`<span style="font-size:12px">${dead?'💀':ch?.icon}</span><span style="font-size:9px;color:${ch?.tc}">${cid}.${ch?.name?.slice(0,2)}</span><div class="to-av" style="border-color:${p.color};background:${p.color}22">${p.avatar}</div>${cur?'<span style="font-size:8px;color:var(--gold2)">▶</span>':done?'<span style="font-size:9px;color:#4caf7d">✓</span>':''}`;
      bar.appendChild(d);
      if(Object.keys(G.selectedChars).some(k=>+k>cid)){const a=el('div','to-arrow');a.textContent='→';bar.appendChild(a);}
    }
  }
}

function rPlayerList(){
  const c=$('pList');c.innerHTML='';
  const mi=myIdx();
  G.players.forEach((p,i)=>{
    const isTurn=G.phase==='player_turn'&&G.curPi===i,isMe=i===mi;
    const isDead=G.assassinTarget!==null&&p.selectedCharacter?.id===G.assassinTarget&&G.phase==='player_turn';
    const isWL=pendingAbility==='warlord'&&!isMe&&p.city.length>0&&p.city.length<7;
    const isWizSwap=pendingAbility==='wizard'&&wizardMode==='swap'&&!isMe;
    let cls='pcard'+(isMe?' me':'')+(isTurn?' active':'')+(isDead?' dead':'')+(isWL||isWizSwap?' tsel':'');
    const d=el('div',cls);
    if(isWL) d.onclick=()=>{warlordTgtPi=i;renderWarlordUI(i);};
    if(isWizSwap) d.onclick=()=>triggerAbility({abilityType:'wizard_swap',targetPi:i});
    const charIcon=G.phase==='player_turn'&&p.selectedCharacter?p.selectedCharacter.icon:isMe&&p.selectedCharacter?p.selectedCharacter.icon:'❓';
    const pips=p.city.map(c=>`<div class="cpip" style="background:${CCSS[c.color]};border-color:${CCSS[c.color]}55" title="${c.name}"></div>`).join('');
    d.innerHTML=`
      <div class="pc-top">
        <div class="pc-av" style="background:${p.color}22;border-color:${p.color}">${p.avatar}</div>
        <div style="flex:1;min-width:0">
          <div class="pc-name" style="color:${isMe?'#c39bd3':p.color}">${p.name}${isMe?' (나)':''}</div>
          <div class="pc-tags">
            ${!p.isAI?'<span class="tag t-human">👤</span>':'<span class="tag t-ai">AI</span>'}
            ${isTurn?'<span class="tag t-turn">▶ 행동</span>':''}
            ${p.crown?'<span class="tag t-crown">👑</span>':''}
            ${p.complete?'<span class="tag t-done">완성</span>':''}
            ${isDead?'<span class="tag t-dead">💀암살</span>':''}
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
    c.appendChild(d);
  });
}

function renderFeed(){
  const list=$('feedList');list.innerHTML='';
  if(!G)return;
  G.log.slice(0,35).forEach(e=>{
    const d=el('div',`fe ev-${e.type||'system'}`);
    d.innerHTML=`<span class="fe-icon">${e.icon}</span><span class="fe-text">${e.html}</span>`;
    list.appendChild(d);
  });
  $('feedCnt').textContent=`${G.log.length}건`;
}

function rMain(){
  const main=$('mainArea');main.innerHTML='';
  if(!G){showWaitingForState();return;}
  if(G.phase==='select_character')rCharSelect(main);
  else rTurnPhase(main);
}

function rCharSelect(main){
  const mi=myIdx(),myTurn=G.selOrder[G.selIdx]===mi,me=G.players[mi];
  // 배너
  const ban=el('div','banner bn-sel');
  ban.innerHTML=`<div class="bn-icon">🎭</div><div><div class="bn-title" style="color:#c39bd3">${myTurn?'⚡ 캐릭터를 선택하세요!':'⏳ 선택 대기 중...'}</div><div class="bn-desc">${myTurn?`<b>${G.availChars.length}개</b> 중 1개를 선택하세요. 선택은 비밀입니다.`:me.selectedCharacter?`<b>${me.selectedCharacter.icon}${me.selectedCharacter.name}</b> 선택 완료.`:'다른 플레이어 선택 중...'}</div></div>`;
  main.appendChild(ban);
  if(!myTurn&&me.selectedCharacter){
    const s=el('div','my-strip');const ch=me.selectedCharacter;
    s.style.cssText=`background:${ch.bg};border-color:${ch.bc};border-radius:9px;`;
    s.innerHTML=`<div style="font-size:38px">${ch.icon}</div><div><div style="font-size:9px;color:var(--dim);letter-spacing:2px;margin-bottom:2px">내 캐릭터</div><div style="font-size:15px;font-weight:800;color:${ch.tc}">${ch.id}. ${ch.name}</div><div style="font-size:10px;color:var(--dim2);margin-top:3px;line-height:1.5">${ch.abilityShort}</div></div>`;
    main.appendChild(s);return;
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
  const ban=el('div',`banner ${myTurn?'bn-act':'bn-wait'}`);
  ban.innerHTML=`<div class="bn-icon">${myTurn?'⚡':curP?.selectedCharacter?.icon||'⏳'}</div><div><div class="bn-title" style="color:${myTurn?'var(--gold2)':'var(--text)'}">${myTurn?'⚡ 내 턴!':aiRunning?`${curP?.name} 행동 중...`:`${curP?.name}의 턴`}</div><div class="bn-desc">${myTurn?G.actionPhase==='choose'?'💰 금화 받기 또는 🃏 카드 뽑기를 선택하세요':isDC||isObs?'카드를 선택하세요':pendingAbility?'능력 사용 중 — 타깃 선택 또는 취소':'🏛️ 건설하거나 능력 사용 후 턴 종료':aiRunning?'진행 기록을 확인하세요.':'기다리는 중...'}</div></div>`;
  main.appendChild(ban);

  // 내 캐릭터 스트립
  if(ch){
    const s=el('div','my-strip');s.style.cssText=`background:${ch.bg};border-color:${ch.bc};border-radius:9px;`;
    s.innerHTML=`<div style="font-size:32px">${ch.icon}</div><div style="flex:1"><div style="font-size:9px;color:var(--dim);letter-spacing:2px;margin-bottom:1px">내 캐릭터</div><div style="font-size:14px;font-weight:800;color:${ch.tc}">${ch.id}. ${ch.name}</div><div style="font-size:10px;color:var(--dim2);margin-top:2px;line-height:1.5">${ch.abilityShort}</div></div><div style="text-align:right;font-size:11px;color:var(--dim2);flex-shrink:0;line-height:2">💰${me.gold}<br>🃏${me.hand.length}<br>⭐${calcScore(me)}${ch.id===7?`<br><span style="color:#89c4f4;font-size:9px">건설${me.buildsLeft}회</span>`:''}</div>`;
    main.appendChild(s);
  }

  // 능력 힌트
  if(pendingAbility&&myTurn){
    const msgs={assassin:'🗡️ 우측 캐릭터 목록에서 암살할 캐릭터 클릭',thief:'🦹 우측 캐릭터 목록에서 훔칠 캐릭터 클릭 (암살자·도둑 제외)',warlord:'⚔️ 좌측 플레이어를 클릭해 파괴할 건물 선택',wizard:'🔮 아래에서 마술사 능력을 선택하세요'};
    const h=el('div','hint');h.innerHTML=msgs[pendingAbility]||'';main.appendChild(h);
  }

  // 마술사 UI
  if(myTurn&&pendingAbility==='wizard'&&wizardMode===null){
    const wp=el('div','wiz-panel');
    wp.innerHTML=`<div class="wiz-title">🔮 마술사 능력 선택</div>`;
    const b1=el('button','wiz-btn');b1.innerHTML='① 다른 플레이어와 손패 전체 교환<br><small>좌측에서 플레이어를 클릭하세요</small>';
    b1.onclick=()=>{wizardMode='swap';rPlayerList();render();};
    const b2=el('button','wiz-btn');b2.innerHTML='② 손패 일부 버리고 새로 뽑기<br><small>아래 손패에서 버릴 카드를 클릭하세요</small>';
    b2.onclick=()=>{wizardMode='discard';wizDiscardSel=[];render();};
    wp.appendChild(b1);wp.appendChild(b2);main.appendChild(wp);
  }

  // 카드 뽑기 선택 UI
  if(isDC&&G._drawOpts){
    const t=el('div','sect');t.textContent='🃏 2장 중 1장 선택';main.appendChild(t);
    const grid=el('div','hand-grid');
    G._drawOpts.forEach(card=>{
      const e=mkCard(card);e.classList.add('draw-pick');e.onclick=()=>chooseDraw(card.uid);
      e.addEventListener('contextmenu',ev=>{ev.preventDefault();openTT(card);});
      grid.appendChild(e);
    });
    main.appendChild(grid);return;
  }
  if(isObs&&G._obsCards){
    const t=el('div','sect');t.textContent='🔭 천문대: 3장 중 1장 선택';main.appendChild(t);
    const grid=el('div','hand-grid');
    G._obsCards.forEach(card=>{
      const e=mkCard(card);e.classList.add('draw-pick');e.onclick=()=>chooseDraw(card.uid);
      e.addEventListener('contextmenu',ev=>{ev.preventDefault();openTT(card);});
      grid.appendChild(e);
    });
    main.appendChild(grid);return;
  }

  // 수입 버튼
  if(myTurn&&G.actionPhase==='choose'){
    const t=el('div','sect');t.textContent='수입 선택';main.appendChild(t);
    const row=el('div','income-row');
    const g=el('div','inc-btn inc-gold');g.innerHTML=`<div class="inc-icon">💰</div><div class="inc-lbl">금화 2개 받기</div><div class="inc-sub">안정적 수입</div>`;g.onclick=takeGold;
    const cb=el('div','inc-btn inc-card');cb.innerHTML=`<div class="inc-icon">🃏</div><div class="inc-lbl">카드 뽑기</div><div class="inc-sub">2장 중 1장 선택 (덱: ${G.deck.length}장)</div>`;cb.onclick=drawCard;
    row.appendChild(g);row.appendChild(cb);main.appendChild(row);
  }

  // 손패
  const ht=el('div','sect');
  ht.innerHTML=`🃏 내 손패 (${me.hand.length}장) <span style="font-size:9px;color:var(--dim);margin-left:6px;font-weight:400">클릭=선택 | 우클릭=정보</span>`;
  main.appendChild(ht);
  const isWD=myTurn&&pendingAbility==='wizard'&&wizardMode==='discard';
  if(!me.hand.length){const e=el('div','empty');e.textContent='손패 없음';main.appendChild(e);}
  else{
    const grid=el('div','hand-grid');
    me.hand.forEach(card=>{
      const c=mkCard(card);
      const isSel=selCard===card.uid,isDS=wizDiscardSel.includes(card.uid);
      if(isSel)c.classList.add('sel');if(isDS)c.classList.add('dscard');
      if(isWD){c.onclick=()=>{if(isDS)wizDiscardSel=wizDiscardSel.filter(u=>u!==card.uid);else wizDiscardSel.push(card.uid);render();};}
      else if(myTurn&&G.actionPhase==='build'){
        if(me.gold<card.cost||me.buildsLeft<=0)c.classList.add('disabled');
        else c.onclick=()=>{selCard=selCard===card.uid?null:card.uid;render();};
      } else c.style.cursor='default';
      c.addEventListener('contextmenu',e=>{e.preventDefault();openTT(card);});
      grid.appendChild(c);
    });
    main.appendChild(grid);
    if(isWD&&wizDiscardSel.length>0){
      const b=el('button','ab ab-purple');b.style.marginTop='7px';
      b.textContent=`🔮 ${wizDiscardSel.length}장 버리고 새로 뽑기`;
      b.onclick=()=>triggerAbility({abilityType:'wizard_discard',uids:wizDiscardSel});
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
      c.onclick=()=>openTT(card);c.addEventListener('contextmenu',e=>{e.preventDefault();openTT(card);});
      grid.appendChild(c);
    });
    main.appendChild(grid);
  }

  // 장군 파괴 UI
  if(myTurn&&pendingAbility==='warlord'&&warlordTgtPi!==null) renderWarlordUI(warlordTgtPi);
}

function renderWarlordUI(tpi){
  const main=$('mainArea');
  const old=document.getElementById('woOverlay');if(old)old.remove();
  const tp=G.players[tpi];if(!tp)return;
  const wrap=el('div','wo-wrap');wrap.id='woOverlay';
  wrap.innerHTML=`<div class="wo-title">⚔️ ${tp.name}의 건물 — 파괴할 건물을 선택하세요</div>`;
  const grid=el('div','wo-grid');
  const p=G.players[myIdx()];
  tp.city.forEach(dist=>{
    const cost=Math.max(0,dist.cost-1),canAfford=p.gold>=cost;
    const c=mkCard(dist);
    if(!canAfford){c.classList.add('disabled');c.title=`💰${cost} 필요`;}
    else{
      c.onclick=()=>triggerAbility({abilityType:'warlord',targetPi:tpi,distUid:dist.uid});
      const b=el('div','wo-cost');b.textContent=cost===0?'무료':`💰${cost}`;c.appendChild(b);
    }
    grid.appendChild(c);
  });
  wrap.appendChild(grid);
  const cancel=el('button','ab ab-dim');cancel.style.marginTop='7px';cancel.textContent='✖️ 취소';cancel.onclick=cancelAbility;
  wrap.appendChild(cancel);
  main.appendChild(wrap);
}

function rCharPanel(){
  const list=$('charList');list.innerHTML='';
  const mi=myIdx(),myCh=G.players[mi].selectedCharacter;
  const isAT=pendingAbility==='assassin',isTT=pendingAbility==='thief';
  CHARS.forEach(ch=>{
    const pi=G.selectedChars[ch.id],isMine=pi===mi;
    const isRm=pi===undefined&&!G.availChars.find(c=>c.id===ch.id);
    const isDead=G.assassinTarget===ch.id,isThf=G.thiefTarget===ch.id;
    const canT=(isAT||isTT)&&ch.id!==myCh?.id&&!(isTT&&ch.id<=2)&&!(isTT&&G.assassinTarget===ch.id);
    const d=el('div','ci'+(isRm?' removed':'')+(isMine?' mine':'')+(canT?' tmode':''));
    d.style.cssText=`background:${isRm?'rgba(255,255,255,.02)':ch.bg};border-color:${isMine?ch.bc:'rgba(255,255,255,.05)'};`;
    d.innerHTML=`<div class="ci-head"><span class="ci-num">${ch.id}</span><span class="ci-icon">${ch.icon}</span><span class="ci-name" style="color:${ch.tc}">${ch.name}</span></div><div class="ci-ab">${ch.abilityShort}</div><div class="ci-badges">${isMine?'<span class="cbadge cb-mine">◀ 나</span>':''}${isDead?'<span class="cbadge cb-dead">💀 암살됨</span>':''}${isThf?'<span class="cbadge cb-thf">🦹 타깃</span>':''}${isRm&&G.phase==='select_character'?'<span class="cbadge cb-rm">제거됨</span>':''}</div>`;
    if(canT)d.onclick=()=>triggerAbility({abilityType:isAT?'assassin':'thief',charId:ch.id});
    list.appendChild(d);
  });
}

function rCityPanel(){
  const panel=$('cityPanel');
  panel.innerHTML=`<div style="font-size:9px;letter-spacing:2px;color:var(--dim);margin-bottom:6px">다른 플레이어 도시</div>`;
  const mi=myIdx();
  G.players.filter((_,i)=>i!==mi).forEach(p=>{
    if(!p.city.length)return;
    const row=el('div','cpr');
    row.innerHTML=`<div class="cpr-name">${p.avatar} ${p.name} <span style="color:var(--dim)">(${p.city.length}/7) ⭐${calcScore(p)}</span></div>`;
    const pips=el('div','cpips');
    p.city.forEach(c=>{
      const pip=el('div','cpi');pip.style.cssText=`background:${CCSS[c.color]}22;border-color:${CCSS[c.color]}66;color:${CCSS[c.color]};`;
      pip.innerHTML=`${c.icon}<span>${c.name}</span>`;pip.onclick=()=>openTT(c);pips.appendChild(pip);
    });
    row.appendChild(pips);panel.appendChild(row);
  });
}

function rActionBar(){
  const bar=$('abar-btns');bar.innerHTML='';
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
  if(G.actionPhase==='choose'){aBtn(bar,'💰 금화 2개','ab ab-gold',takeGold);aBtn(bar,'🃏 카드 뽑기','ab ab-blue',drawCard);return;}
  if(G.actionPhase==='draw_choice'||G.actionPhase==='observatory')return;
  if(G.actionPhase==='build'){
    const bl=selCard?`🏛️ 건설 (💰${me.hand.find(c=>c.uid===selCard)?.cost??'?'})`:'🏛️ 건물 선택 후 건설';
    const bb=aBtn(bar,bl,'ab ab-green',()=>buildDistrict(selCard));if(!selCard)bb.disabled=true;
    if(ch&&[1,2,3,8].includes(ch.id)){
      if(!abilityUsed)aBtn(bar,`${ch.icon} ${ch.name} 능력`,'ab ab-purple',useAbility);
      else{const ab=aBtn(bar,`${ch.icon} 능력 (사용됨)`,'ab ab-dim',null);ab.disabled=true;}
    }
    if(pendingAbility)aBtn(bar,'✖️ 취소','ab ab-dim',cancelAbility);
    aBtn(bar,'✅ 턴 종료','ab ab-end',endTurn);
  }
}
function aBtn(c,label,cls,fn){const b=el('button',cls);b.innerHTML=label;if(fn)b.onclick=fn;else b.disabled=true;c.appendChild(b);return b;}
