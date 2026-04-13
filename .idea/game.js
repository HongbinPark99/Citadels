// ═══════════════════════════════════════════════════════
// game.js — 시타델 게임 로직 & 상태 관리
// ═══════════════════════════════════════════════════════

// ── 전역 상태 ──
let G = null;           // 게임 상태
let MY_ID = null;       // 내 플레이어 ID
let IS_HOST = false;
let ROOM_CODE = null;
let AI_COUNT_SOLO = 3;
let WAIT_AI_COUNT = 0;

let selectedCard = null;          // 선택된 손패 카드 uid
let aiQueue = [];
let aiRunning = false;
let notifTimer = null;
let pollTimer = null;

const STORE_KEY = "citadels_v4_room";

// ── ID 생성 ──
function uuid() { return Math.random().toString(36).slice(2, 10).toUpperCase(); }
function shortCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

// ── 내 플레이어 인덱스 ──
function myIdx() {
  return G?.players.findIndex(p => p.id === MY_ID) ?? 0;
}

function isMyTurn() {
  return G && G.phase === "player_turn" && G.curPi === myIdx() && !aiRunning;
}

function isMyCharSel() {
  return G && G.phase === "select_character" && G.selOrder[G.selIdx] === myIdx();
}

// ── 덱 드로우 ──
function deckPop() {
  if (!G.deck.length) { G.deck = shuffle([...G.discard]); G.discard = []; }
  return G.deck.length ? G.deck.pop() : null;
}

// ── 피드 로그 ──
function feed(icon, html, type = "system") {
  if (!G) return;
  G.log.unshift({ icon, html, type, ts: Date.now() });
  if (G.log.length > 100) G.log.pop();
}

// ════════════════════════════════════════════
// 멀티플레이어 (localStorage + BroadcastChannel)
// ════════════════════════════════════════════
function readRoom() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { return null; }
}
function writeRoom(r) { localStorage.setItem(STORE_KEY, JSON.stringify(r)); }
function broadcastState() {
  if (window._bc) window._bc.postMessage({ type: "state", room: readRoom() });
}
function initBC() {
  if (typeof BroadcastChannel !== "undefined") {
    window._bc = new BroadcastChannel("citadels_v4");
    window._bc.onmessage = e => {
      if (e.data.type === "state" && ROOM_CODE) {
        const r = e.data.room;
        if (r && r.code === ROOM_CODE) {
          localStorage.setItem(STORE_KEY, JSON.stringify(r));
          onRoomUpdate(r);
        }
      }
    };
  }
}
window.addEventListener("storage", e => {
  if (e.key === STORE_KEY && ROOM_CODE) {
    const r = readRoom();
    if (r && r.code === ROOM_CODE) onRoomUpdate(r);
  }
});

function onRoomUpdate(room) {
  if (room.phase === "waiting") {
    renderWaitingRoom(room);
  } else if (room.phase === "game" || room.phase === "gameover") {
    if (document.getElementById("screen-game").classList.contains("hidden")) {
      enterGameScreen();
    }
    G = room.G;
    render();
    if (room.phase === "gameover") showGameOverModal();
  }
}

function saveG() {
  if (ROOM_CODE && ROOM_CODE !== "LOCAL") {
    const r = readRoom();
    if (r) { r.G = G; writeRoom(r); broadcastState(); }
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    const r = readRoom();
    if (!r || r.code !== ROOM_CODE) return;
    onRoomUpdate(r);
  }, 600);
}

// ════════════════════════════════════════════
// 캐릭터 선택
// ════════════════════════════════════════════
function aiAutoSelect() {
  while (
    G.phase === "select_character" &&
    G.selIdx < G.players.length &&
    G.selOrder[G.selIdx] !== myIdx()
  ) {
    const pi = G.selOrder[G.selIdx];
    if (G.availChars.length) {
      const pick = G.availChars.splice(Math.floor(Math.random() * G.availChars.length), 1)[0];
      G.selectedChars[pick.id] = pi;
      G.players[pi].selectedCharacter = pick;
    }
    G.selIdx++;
  }
}

function selectCharacter(charId) {
  if (!isMyCharSel()) return;
  const ch = G.availChars.find(c => c.id === charId);
  if (!ch) return;
  const mi = myIdx();
  G.selectedChars[ch.id] = mi;
  G.players[mi].selectedCharacter = ch;
  G.availChars = G.availChars.filter(c => c.id !== charId);
  G.selIdx++;
  feed("🎭", `<b>${G.players[mi].name}</b>이(가) 캐릭터를 선택했습니다.`, "system");
  aiAutoSelect();
  if (G.selIdx >= G.players.length) beginTurns();
  saveG(); render();
}

// ════════════════════════════════════════════
// 행동 단계 시작 & 캐릭터 순서 진행
// ════════════════════════════════════════════
function beginTurns() {
  G.phase = "player_turn";
  G.curCharIdx = 1;
  feed("⚔️", "<b>행동 단계 시작!</b> 캐릭터 1번부터 8번 순서로 행동합니다.", "system");
  advanceChar(1);
}

function advanceChar(idx) {
  if (idx > 8) {
    // 라운드 종료 후 게임 종료 여부 확인
    if (G.players.some(p => p.complete)) {
      resolveGameOver();
    } else {
      nextRound();
      render();
    }
    return;
  }
  G.curCharIdx = idx;

  // ① 암살 처리
  if (G.assassinTarget === idx) {
    const ki = Object.entries(G.selectedChars).find(([k]) => +k === idx)?.[1];
    if (ki !== undefined) {
      const charName = CHARS.find(c => c.id === idx)?.name;
      feed("💀", `<b>${G.players[ki].name}</b>이(가) 암살당해 <b>${charName}</b>으로 행동할 수 없습니다!`, "combat");
      advanceChar(idx + 1);
      return;
    }
  }

  // ② 해당 캐릭터 보유 플레이어 찾기
  const entry = Object.entries(G.selectedChars).find(([k]) => +k === idx);
  if (!entry) { advanceChar(idx + 1); return; }
  const pi = +entry[1];

  // ③ 도둑 도착 시 금화 탈취
  if (G.thiefTarget === idx && G.thiefPi !== null && G.thiefPi !== pi) {
    const stolen = G.players[pi].gold;
    G.players[G.thiefPi].gold += stolen;
    G.players[pi].gold = 0;
    const charName = CHARS.find(c => c.id === idx)?.name;
    feed("🦹", `<b>${G.players[G.thiefPi].name}(도둑)</b>이(가) <b>${G.players[pi].name}(${charName})</b>의 💰${stolen}을 빼앗았습니다!`, "combat");
  }

  G.curPi = pi;
  G.actionPhase = "choose";
  G.players[pi].abilityUsed = false;
  G.players[pi].buildsLeft = G.players[pi].selectedCharacter?.id === 7 ? 3 : 1;

  const mi = myIdx();
  if (pi === mi) {
    feed("✨", `<b>내 턴!</b> (${G.players[mi].selectedCharacter?.icon}${G.players[mi].selectedCharacter?.name}) 수입을 선택하세요.`, "system");
  } else if (G.players[pi].isAI) {
    enqueueAI(pi);
  } else {
    feed("⏳", `<b>${G.players[pi].name}</b>(${G.players[pi].selectedCharacter?.icon}${G.players[pi].selectedCharacter?.name})의 턴입니다.`, "system");
  }
}

// ════════════════════════════════════════════
// 플레이어 행동
// ════════════════════════════════════════════
function takeGold() {
  if (!isMyTurn() || G.actionPhase !== "choose") return;
  const p = G.players[myIdx()];
  p.gold += 2;
  feed("💰", `<b>${p.name}</b>이(가) 금화 2개를 받았습니다. (보유: ${p.gold}💰)`, "gold");
  applyCharIncome(myIdx());
  // 건축가: 카드 2장 추가
  if (p.selectedCharacter?.id === 7) {
    const c1 = deckPop(), c2 = deckPop();
    if (c1) p.hand.push(c1);
    if (c2) p.hand.push(c2);
    feed("🏗️", `<b>${p.name}(건축가)</b>이(가) 카드 2장을 추가로 뽑았습니다. (손패: ${p.hand.length}장)`, "ability");
  }
  G.actionPhase = "build";
  saveG(); render();
  notify("💰 금화 2개 획득!", "ok");
}

function drawCard() {
  if (!isMyTurn() || G.actionPhase !== "choose") return;
  const p = G.players[myIdx()];

  // 도서관: 2장 모두 획득
  const hasLibrary = p.city.some(d => d.id === "library");
  // 천문대: 3장 중 1장 선택
  const hasObservatory = p.city.some(d => d.id === "observatory");

  if (hasObservatory) {
    // 3장 보여주고 선택 (UI 처리 → observatoryDraw)
    const drawn = [deckPop(), deckPop(), deckPop()].filter(Boolean);
    G._observatoryCards = drawn;
    G.actionPhase = "observatory";
    saveG(); render();
    return;
  }

  if (hasLibrary) {
    // 2장 모두 획득
    const c1 = deckPop(), c2 = deckPop();
    if (c1) p.hand.push(c1);
    if (c2) p.hand.push(c2);
    feed("📚", `<b>${p.name}(도서관)</b>이(가) 카드 2장을 모두 손에 넣었습니다. (손패: ${p.hand.length}장)`, "ability");
  } else {
    // 일반: 2장 중 1장 선택
    const c1 = deckPop(), c2 = deckPop();
    const drawn = [c1, c2].filter(Boolean);
    G._drawOptions = drawn;
    G.actionPhase = "draw_choice";
    saveG(); render();
    return;
  }

  applyCharIncome(myIdx());
  if (p.selectedCharacter?.id === 7) {
    const c1 = deckPop(), c2 = deckPop();
    if (c1) p.hand.push(c1); if (c2) p.hand.push(c2);
    feed("🏗️", `<b>${p.name}(건축가)</b>이(가) 카드 2장을 추가로 뽑았습니다.`, "ability");
  }
  G.actionPhase = "build";
  saveG(); render();
}

function chooseDrawCard(uid) {
  if (!isMyTurn() || G.actionPhase !== "draw_choice") return;
  const p = G.players[myIdx()];
  const drawn = G._drawOptions || [];
  const chosen = drawn.find(c => c.uid === uid);
  if (!chosen) return;
  p.hand.push(chosen);
  const discarded = drawn.filter(c => c.uid !== uid);
  G.discard.push(...discarded);
  feed("🃏", `<b>${p.name}</b>이(가) 카드를 선택했습니다. (손패: ${p.hand.length}장)`, "card");
  G._drawOptions = null;
  applyCharIncome(myIdx());
  if (p.selectedCharacter?.id === 7) {
    const c1 = deckPop(), c2 = deckPop();
    if (c1) p.hand.push(c1); if (c2) p.hand.push(c2);
    feed("🏗️", `<b>${p.name}(건축가)</b>이(가) 카드 2장을 추가로 뽑았습니다.`, "ability");
  }
  G.actionPhase = "build";
  saveG(); render();
  notify("🃏 카드 선택 완료!", "ok");
}

function chooseObservatoryCard(uid) {
  if (!isMyTurn() || G.actionPhase !== "observatory") return;
  const p = G.players[myIdx()];
  const drawn = G._observatoryCards || [];
  const chosen = drawn.find(c => c.uid === uid);
  if (!chosen) return;
  p.hand.push(chosen);
  const discarded = drawn.filter(c => c.uid !== uid);
  G.discard.push(...discarded);
  feed("🔭", `<b>${p.name}(천문대)</b>이(가) 3장 중 1장을 선택했습니다. (손패: ${p.hand.length}장)`, "ability");
  G._observatoryCards = null;
  applyCharIncome(myIdx());
  if (p.selectedCharacter?.id === 7) {
    const c1 = deckPop(), c2 = deckPop();
    if (c1) p.hand.push(c1); if (c2) p.hand.push(c2);
    feed("🏗️", `<b>${p.name}(건축가)</b>이(가) 카드 2장을 추가로 뽑았습니다.`, "ability");
  }
  G.actionPhase = "build";
  saveG(); render();
}

// 캐릭터 수입
function applyCharIncome(pi) {
  const p = G.players[pi], ch = p.selectedCharacter;
  if (!ch) return;
  const colorMap = { 4: "yellow", 5: "blue", 6: "green", 8: "red" };
  let bonus = 0;
  if (colorMap[ch.id]) {
    bonus = p.city.filter(d => d.color === colorMap[ch.id]).length;
    if (ch.id === 6) bonus += 1; // 상인 기본 +1
  }
  if (bonus > 0) {
    p.gold += bonus;
    feed("✨", `<b>${ch.icon}${ch.name}</b> 수입: 💰+${bonus} (총 ${p.gold}💰)`, "gold");
  }
}

// 건물 건설
function buildDistrict(uid) {
  if (!isMyTurn() || G.actionPhase !== "build") return;
  const p = G.players[myIdx()];
  if (p.buildsLeft <= 0) { notify("이번 턴 건설 횟수를 모두 사용했습니다!", "warn"); return; }
  const card = p.hand.find(c => c.uid === uid);
  if (!card) return;
  if (p.gold < card.cost) { notify("금화가 부족합니다!", "warn"); return; }
  if (p.city.find(c => c.id === card.id)) { notify("이미 건설된 건물입니다!", "warn"); return; }

  p.gold -= card.cost;
  p.hand = p.hand.filter(c => c.uid !== uid);
  p.city.push(card);
  p.buildsLeft--;
  selectedCard = null;
  feed("🏛️", `<b>${p.name}</b>이(가) ${card.icon}<b>${card.name}</b>을(를) 건설했습니다! (남은 💰: ${p.gold})`, "build");

  // 왕: 왕관 획득
  if (p.selectedCharacter?.id === 4) {
    G.players.forEach(x => x.crown = false);
    p.crown = true;
    feed("👑", `<b>${p.name}(왕)</b>이(가) 왕관을 가져갔습니다.`, "system");
  }

  // 7채 완성 체크 (신판 기준 7채)
  if (p.city.length >= 7) {
    if (!G.players.some(x => x.complete)) {
      p.firstComplete = true; p.complete = true;
      feed("🎉", `<b>${p.name}</b>이(가) 7번째 건물로 도시를 완성했습니다! 이번 라운드가 마지막 라운드입니다.`, "win");
    } else {
      p.complete = true;
    }
  }
  saveG(); render();
  notify(`🏛️ ${card.name} 건설!`, "ok");
}

// ── 능력 사용 ──
function useAbility() {
  if (!isMyTurn()) return;
  const p = G.players[myIdx()];
  if (p.abilityUsed) { notify("이미 능력을 사용했습니다!", "warn"); return; }
  const ch = p.selectedCharacter;
  if (!ch) return;

  switch (ch.id) {
    case 1: // 암살자
      G.wizardMode = null;
      renderMain(); // 우측 캐릭터 목록에서 선택
      notify("🗡️ 우측에서 암살할 캐릭터를 선택하세요", "warn");
      G._abilityPending = "assassin";
      render();
      break;
    case 2: // 도둑
      G._abilityPending = "thief";
      notify("🦹 우측에서 훔칠 캐릭터를 선택하세요 (암살자·도둑 제외)", "warn");
      render();
      break;
    case 3: // 마술사
      G._abilityPending = "wizard";
      notify("🔮 능력을 선택하세요: ① 플레이어와 손패 교환  ② 카드 버리고 새로 뽑기", "warn");
      render();
      break;
    case 7: // 건축가 - 카드 뽑기는 이미 수입 단계에서 처리됨
      notify("건축가의 추가 카드는 수입 단계에서 자동 처리됩니다.", "warn");
      break;
    case 8: // 장군
      G._abilityPending = "warlord";
      notify("⚔️ 좌측에서 파괴할 건물을 가진 플레이어를 선택하세요", "warn");
      render();
      break;
  }
}

function selectAbilityTarget(charId) {
  const p = G.players[myIdx()];
  const myCharId = p.selectedCharacter?.id;
  if (G._abilityPending === "assassin") {
    if (charId === myCharId) { notify("자신을 암살할 수 없습니다!", "warn"); return; }
    G.assassinTarget = charId;
    p.abilityUsed = true;
    G._abilityPending = null;
    feed("🗡️", `<b>${p.name}(암살자)</b>이(가) <b>${CHARS.find(c => c.id === charId)?.name}</b>을(를) 암살했습니다!`, "combat");
    notify("🗡️ 암살 완료!", "ok");
  } else if (G._abilityPending === "thief") {
    if (charId <= 2) { notify("암살자와 도둑은 훔칠 수 없습니다!", "warn"); return; }
    if (G.assassinTarget === charId) { notify("암살된 캐릭터에게는 도둑질할 수 없습니다!", "warn"); return; }
    G.thiefTarget = charId;
    G.thiefPi = myIdx();
    p.abilityUsed = true;
    G._abilityPending = null;
    feed("🦹", `<b>${p.name}(도둑)</b>이(가) <b>${CHARS.find(c => c.id === charId)?.name}</b>을(를) 타깃으로 지정했습니다!`, "ability");
    notify("🦹 도둑 타깃 지정!", "ok");
  }
  saveG(); render();
}

function wizardSwap(targetPi) {
  const p = G.players[myIdx()];
  if (targetPi === myIdx()) { notify("자신과는 교환할 수 없습니다!", "warn"); return; }
  const tp = G.players[targetPi];
  const tmp = p.hand;
  p.hand = tp.hand;
  tp.hand = tmp;
  p.abilityUsed = true;
  G._abilityPending = null;
  feed("🔮", `<b>${p.name}(마술사)</b>이(가) <b>${tp.name}</b>과 손패를 교환했습니다!`, "ability");
  notify("🔮 손패 교환 완료!", "ok");
  saveG(); render();
}

function wizardDiscard(uids) {
  // 선택한 카드 버리고 같은 수만큼 뽑기
  const p = G.players[myIdx()];
  if (!uids.length) { notify("버릴 카드를 선택하세요!", "warn"); return; }
  const discarded = p.hand.filter(c => uids.includes(c.uid));
  p.hand = p.hand.filter(c => !uids.includes(c.uid));
  G.discard.push(...discarded);
  for (let i = 0; i < discarded.length; i++) {
    const drawn = deckPop();
    if (drawn) p.hand.push(drawn);
  }
  p.abilityUsed = true;
  G._abilityPending = null;
  feed("🔮", `<b>${p.name}(마술사)</b>이(가) 카드 ${discarded.length}장을 버리고 새로 뽑았습니다.`, "ability");
  notify(`🔮 카드 ${discarded.length}장 교체!`, "ok");
  saveG(); render();
}

function warlordDestroy(targetPi, distUid) {
  const p = G.players[myIdx()];
  const tp = G.players[targetPi];
  if (!tp) return;
  // 주교는 보호
  if (tp.selectedCharacter?.id === 5 && G.assassinTarget !== 5) {
    notify("주교의 건물은 파괴할 수 없습니다!", "warn"); return;
  }
  // 7채 완성한 플레이어 건물은 파괴 불가
  if (tp.city.length >= 7) {
    notify("7채를 완성한 플레이어의 건물은 파괴할 수 없습니다!", "warn"); return;
  }
  const dist = tp.city.find(c => c.uid === distUid);
  if (!dist) return;
  const cost = Math.max(0, dist.cost - 1);
  if (p.gold < cost) { notify(`금화 ${cost}개가 필요합니다!`, "warn"); return; }
  p.gold -= cost;

  // 묘지 체크: 피해자가 묘지 보유 시 금화 1개로 회수 가능 (AI는 자동 회수 안 함)
  const hasGraveyard = tp.city.some(d => d.id === "graveyard" && d.uid !== distUid);
  tp.city = tp.city.filter(c => c.uid !== distUid);
  G.discard.push(dist);
  p.abilityUsed = true;
  G._abilityPending = null;
  G.warlordMode = false;
  feed("⚔️", `<b>${p.name}(장군)</b>이(가) <b>${tp.name}</b>의 ${dist.icon}<b>${dist.name}</b>을 파괴했습니다! (💰-${cost})`, "combat");
  if (hasGraveyard) {
    feed("⚰️", `<b>${tp.name}</b>이(가) 묘지를 보유 중입니다. (실제 게임에서는 💰1로 회수 가능)`, "system");
  }
  notify(`⚔️ ${dist.name} 파괴!`, "ok");
  saveG(); render();
}

function cancelAbility() {
  G._abilityPending = null;
  G.warlordMode = false;
  G.wizardMode = null;
  G.wizardDiscardSelected = [];
  render();
}

function endTurn() {
  if (!isMyTurn()) return;
  const p = G.players[myIdx()];
  if (G._abilityPending) {
    G._abilityPending = null;
  }
  G.wizardMode = null;
  G.wizardDiscardSelected = [];
  G.warlordMode = false;
  selectedCard = null;
  feed("✅", `<b>${p.name}</b>이(가) 턴을 종료했습니다.`, "system");
  advanceChar(G.curCharIdx + 1);
  saveG(); render();
}

// ════════════════════════════════════════════
// AI 턴 (큐 기반 단계별 표시)
// ════════════════════════════════════════════
function enqueueAI(pi) {
  const steps = buildAISteps(pi);
  aiQueue.push(...steps);
  if (!aiRunning) processAIQueue();
}

function buildAISteps(pi) {
  const p = G.players[pi], ch = p.selectedCharacter, steps = [];
  steps.push({ t: "announce", pi });

  // 암살자
  if (ch?.id === 1 && G.assassinTarget === null) {
    const others = Object.entries(G.selectedChars).filter(([k, v]) => +k !== 1 && +v !== pi);
    if (others.length) {
      const t = others[Math.floor(Math.random() * others.length)];
      steps.push({ t: "assassin", pi, cid: +t[0] });
    }
  }
  // 도둑
  if (ch?.id === 2 && G.thiefTarget === null) {
    const others = Object.entries(G.selectedChars).filter(([k, v]) => +k > 2 && +v !== pi && G.assassinTarget !== +k);
    if (others.length) {
      const t = others[Math.floor(Math.random() * others.length)];
      steps.push({ t: "thief", pi, cid: +t[0] });
    }
  }

  // 수입 선택 (금화 또는 카드)
  const needGold = p.gold < 4;
  if (needGold || Math.random() > 0.35) {
    steps.push({ t: "gold", pi });
  } else {
    steps.push({ t: "draw", pi });
  }

  // 건축가: 추가 카드
  if (ch?.id === 7) steps.push({ t: "arch_draw", pi });

  // 마술사: 손패가 적으면 교환
  if (ch?.id === 3 && p.hand.length < 2) {
    const others = G.players.filter((_, i) => i !== pi && G.players[i].hand.length > p.hand.length);
    if (others.length) {
      const ti = G.players.indexOf(others[0]);
      steps.push({ t: "wizard_swap", pi, ti });
    }
  }

  // 캐릭터 수입
  steps.push({ t: "income", pi });

  // 장군: 건물 파괴 (낮은 확률)
  if (ch?.id === 8 && Math.random() > 0.5) {
    const enemies = G.players.filter((ep, ei) => {
      if (ei === pi) return false;
      if (ep.city.length >= 7) return false;
      if (ep.selectedCharacter?.id === 5 && G.assassinTarget !== 5) return false;
      return ep.city.length > 0;
    });
    if (enemies.length) {
      const enemy = enemies[Math.floor(Math.random() * enemies.length)];
      const ei = G.players.indexOf(enemy);
      const cheapest = enemy.city.reduce((a, b) => a.cost < b.cost ? a : b);
      const cost = Math.max(0, cheapest.cost - 1);
      if (p.gold >= cost + 2) { // 파괴 후에도 건설 가능한 경우만
        steps.push({ t: "warlord", pi, ei, uid: cheapest.uid });
      }
    }
  }

  // 건설 (1장~최대 buildsLeft장)
  const maxBuilds = ch?.id === 7 ? 3 : 1;
  let simGold = p.gold;
  let nb = 0;
  const buildable = [...p.hand]
    .filter(c => !p.city.find(b => b.id === c.id))
    .sort((a, b) => b.cost - a.cost);
  for (const d of buildable) {
    if (nb >= maxBuilds || simGold < d.cost) continue;
    simGold -= d.cost;
    steps.push({ t: "build", pi, uid: d.uid });
    nb++;
  }

  // 왕: 왕관
  if (ch?.id === 4) steps.push({ t: "crown", pi });

  steps.push({ t: "next", pi });
  return steps;
}

function processAIQueue() {
  if (!G || aiQueue.length === 0) { aiRunning = false; render(); return; }
  aiRunning = true;
  const step = aiQueue.shift();
  applyAIStep(step);
  const delay = step.t === "announce" ? 950 : step.t === "next" ? 100 : step.t === "income" ? 200 : 700;
  render();
  setTimeout(processAIQueue, delay);
}

function applyAIStep(s) {
  if (!G) return;
  const p = G.players[s.pi], ch = p?.selectedCharacter;
  switch (s.t) {
    case "announce":
      feed(ch?.icon || "⏳", `<b>${p.name}</b>(${ch?.name || "?"})의 턴이 시작됩니다.`, "system"); break;
    case "assassin":
      G.assassinTarget = s.cid;
      feed("🗡️", `<b>${p.name}(암살자)</b>이(가) <b>${CHARS.find(c => c.id === s.cid)?.name}</b>을(를) 암살했습니다!`, "combat"); break;
    case "thief":
      G.thiefTarget = s.cid; G.thiefPi = s.pi;
      feed("🦹", `<b>${p.name}(도둑)</b>이(가) <b>${CHARS.find(c => c.id === s.cid)?.name}</b>을(를) 타깃으로 지정!`, "ability"); break;
    case "gold":
      p.gold += 2;
      feed("💰", `<b>${p.name}</b>이(가) 금화 2개를 받았습니다. (보유: ${p.gold}💰)`, "gold"); break;
    case "draw": {
      const c = deckPop();
      if (c) { p.hand.push(c); feed("🃏", `<b>${p.name}</b>이(가) 카드를 뽑았습니다. (손패: ${p.hand.length}장)`, "card"); } break;
    }
    case "arch_draw": {
      const c1 = deckPop(), c2 = deckPop();
      if (c1) p.hand.push(c1); if (c2) p.hand.push(c2);
      feed("🏗️", `<b>${p.name}(건축가)</b>이(가) 카드 2장을 추가로 뽑았습니다.`, "ability"); break;
    }
    case "wizard_swap": {
      const tp = G.players[s.ti];
      if (tp) { const tmp = p.hand; p.hand = tp.hand; tp.hand = tmp; feed("🔮", `<b>${p.name}(마술사)</b>이(가) <b>${tp.name}</b>과 손패를 교환했습니다.`, "ability"); } break;
    }
    case "income": applyCharIncome(s.pi); break;
    case "warlord": {
      const tp = G.players[s.ei], dist = tp?.city.find(c => c.uid === s.uid);
      if (dist && tp) {
        const cost = Math.max(0, dist.cost - 1);
        if (p.gold >= cost) {
          p.gold -= cost; tp.city = tp.city.filter(c => c.uid !== s.uid); G.discard.push(dist);
          feed("⚔️", `<b>${p.name}(장군)</b>이(가) <b>${tp.name}</b>의 ${dist.icon}<b>${dist.name}</b>을 파괴! (💰-${cost})`, "combat");
        }
      } break;
    }
    case "build": {
      const d = p.hand.find(c => c.uid === s.uid);
      if (d && p.gold >= d.cost && !p.city.find(b => b.id === d.id)) {
        p.gold -= d.cost; p.hand = p.hand.filter(c => c.uid !== s.uid); p.city.push(d);
        feed("🏛️", `<b>${p.name}</b>이(가) ${d.icon}<b>${d.name}</b>을(를) 건설했습니다! (남은 💰: ${p.gold})`, "build");
        if (p.city.length >= 7) {
          if (!G.players.some(x => x.complete)) { p.firstComplete = true; p.complete = true; feed("🎉", `<b>${p.name}</b>이(가) 7번째 건물로 도시를 완성했습니다!`, "win"); }
          else { p.complete = true; }
        }
      } break;
    }
    case "crown":
      G.players.forEach(x => x.crown = false); p.crown = true;
      feed("👑", `<b>${p.name}(왕)</b>이(가) 왕관을 가져갔습니다.`, "system"); break;
    case "next":
      if (G.players.some(x => x.complete)) { aiQueue = []; resolveGameOver(); render(); return; }
      advanceChar(G.curCharIdx + 1);
      break;
  }
}

// ════════════════════════════════════════════
// 라운드 / 게임 종료
// ════════════════════════════════════════════
function nextRound() {
  G.round++;
  G.phase = "select_character";
  const ci = Math.max(0, G.players.findIndex(p => p.crown));
  G.selOrder = Array.from({ length: G.players.length }, (_, i) => (ci + i) % G.players.length);
  G.selIdx = 0; G.selectedChars = {}; G.assassinTarget = null;
  G.thiefTarget = null; G.thiefPi = null;
  G.players.forEach(p => { p.selectedCharacter = null; p.abilityUsed = false; p.buildsLeft = 1; });
  G.availChars = shuffle([...CHARS]); G.availChars.pop();
  G._abilityPending = null; G.warlordMode = false; G.wizardMode = null;
  aiQueue = []; aiRunning = false;
  feed("🔄", `<b>라운드 ${G.round}</b>이 시작됩니다! 캐릭터를 선택하세요.`, "system");
  aiAutoSelect();
}

function resolveGameOver() {
  G.gameOver = true;
  const sorted = G.players.map(p => ({ ...p, score: calcScore(p) })).sort((a, b) => b.score - a.score);
  G.winner = sorted[0];
  feed("🏆", `게임 종료! <b>${G.winner.name}</b> 승리! (${calcScore(G.winner)}점)`, "win");
  saveG();
  if (ROOM_CODE && ROOM_CODE !== "LOCAL") {
    const r = readRoom(); if (r) { r.phase = "gameover"; r.G = G; writeRoom(r); broadcastState(); }
  }
  render();
  setTimeout(showGameOverModal, 800);
}

// ════════════════════════════════════════════
// 게임 시작 진입점
// ════════════════════════════════════════════
function launchGame(players) {
  G = buildInitialG(players);
  enterGameScreen();
  aiAutoSelect();
  render();
}

function enterGameScreen() {
  ["screen-lobby", "screen-waiting"].forEach(id => document.getElementById(id).classList.add("hidden"));
  document.getElementById("screen-game").classList.remove("hidden");
}

function backToLobby() {
  if (pollTimer) clearInterval(pollTimer);
  if (window._bc) window._bc.close();
  document.getElementById("gameOverModal").classList.add("hidden");
  ["screen-game", "screen-waiting"].forEach(id => document.getElementById(id).classList.add("hidden"));
  document.getElementById("screen-lobby").classList.remove("hidden");
  G = null; ROOM_CODE = null; selectedCard = null; aiQueue = []; aiRunning = false;
}

// 알림
function notify(msg, type = "info") {
  const el = document.getElementById("notif");
  el.textContent = msg;
  el.className = `show n-${type}`;
  if (notifTimer) clearTimeout(notifTimer);
  notifTimer = setTimeout(() => (el.className = ""), 2800);
}
