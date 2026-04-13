// ═══════════════════════════════════════════════════════
// render.js — UI 렌더링
// ═══════════════════════════════════════════════════════

// ── 메인 렌더 ──
function render() {
  if (!G) return;
  renderTopbar();
  renderTurnOrder();
  renderPlayerList();
  renderFeed();
  renderMain();
  renderCharPanel();
  renderCityPanel();
  renderActionBar();
}

// ── 상단 바 ──
function renderTopbar() {
  const mi = myIdx(), me = G.players[mi];
  document.getElementById("tbRound").textContent = G.round;
  document.getElementById("tbDeck").textContent = G.deck.length;
  document.getElementById("tbGold").textContent = me.gold;
  document.getElementById("tbHand").textContent = me.hand.length;
  document.getElementById("tbCity").textContent = me.city.length;
  document.getElementById("tbScore").textContent = calcScore(me);
  const ph = document.getElementById("tbPhase");
  if (G.phase === "select_character") {
    ph.textContent = "🎭 캐릭터 선택"; ph.className = "tb-phase phase-sel";
  } else {
    const ch = CHARS.find(c => c.id === G.curCharIdx);
    ph.textContent = `${ch?.icon || "⚔️"} ${ch?.name || "?"} 행동 중`;
    ph.className = "tb-phase phase-act";
  }
}

// ── 진행 순서 표시 (1→8번 캐릭터 순서) ──
function renderTurnOrder() {
  const el = document.getElementById("turnOrder");
  if (!el) return;
  el.innerHTML = "";

  if (G.phase === "select_character") {
    // 캐릭터 선택 순서 표시
    const label = document.createElement("div");
    label.className = "to-label";
    label.textContent = "선택 순서";
    el.appendChild(label);

    G.selOrder.forEach((pi, i) => {
      const p = G.players[pi];
      const done = i < G.selIdx;
      const cur = i === G.selIdx;
      const d = document.createElement("div");
      d.className = "to-item" + (done ? " done" : "") + (cur ? " current" : "");
      d.title = p.name;
      d.innerHTML = `
        <div class="to-avatar" style="border-color:${p.color};background:${p.color}22">${p.avatar}</div>
        <div class="to-name">${p.name.slice(0, 4)}</div>
        ${done ? '<div class="to-check">✓</div>' : ""}
        ${cur ? '<div class="to-cur">▶</div>' : ""}
      `;
      el.appendChild(d);
      if (i < G.selOrder.length - 1) {
        const arr = document.createElement("div");
        arr.className = "to-arrow"; arr.textContent = "→";
        el.appendChild(arr);
      }
    });
  } else {
    // 행동 단계: 1~8번 순서 표시
    const label = document.createElement("div");
    label.className = "to-label";
    label.textContent = "행동 순서";
    el.appendChild(label);

    for (let cid = 1; cid <= 8; cid++) {
      const pi = G.selectedChars[cid];
      if (pi === undefined) continue;
      const p = G.players[pi];
      const ch = CHARS.find(c => c.id === cid);
      const done = G.curCharIdx > cid;
      const cur = G.curCharIdx === cid;
      const killed = G.assassinTarget === cid;

      const d = document.createElement("div");
      d.className = "to-item" + (done ? " done" : "") + (cur ? " current" : "") + (killed ? " killed" : "");
      d.title = `${ch?.name} — ${p.name}`;
      d.innerHTML = `
        <div class="to-char-icon">${killed ? "💀" : ch?.icon}</div>
        <div class="to-char-name" style="color:${ch?.tc}">${cid}.${ch?.name?.slice(0,3)}</div>
        <div class="to-avatar-sm" style="border-color:${p.color};background:${p.color}22">${p.avatar}</div>
        ${cur ? '<div class="to-cur">▶</div>' : ""}
        ${done && !cur ? '<div class="to-check">✓</div>' : ""}
      `;
      el.appendChild(d);

      // 화살표 (다음 활성 캐릭터 있을 때만)
      const nextExists = Object.keys(G.selectedChars).some(k => +k > cid);
      if (nextExists) {
        const arr = document.createElement("div");
        arr.className = "to-arrow"; arr.textContent = "→";
        el.appendChild(arr);
      }
    }
  }
}

// ── 플레이어 목록 (왼쪽 패널) ──
function renderPlayerList() {
  const el = document.getElementById("playerList"); el.innerHTML = "";
  const mi = myIdx();
  G.players.forEach((p, i) => {
    const isTurn = G.phase === "player_turn" && G.curPi === i;
    const isMe = i === mi;
    const isDead = G.assassinTarget !== null && p.selectedCharacter?.id === G.assassinTarget && G.phase === "player_turn" && G.curCharIdx <= G.assassinTarget;
    const isWarlordTarget = G._abilityPending === "warlord" && !isMe && p.city.length > 0;
    const isWizardSwapTarget = G._abilityPending === "wizard" && G.wizardMode === "swap" && !isMe;

    let cls = "pcard" + (isMe ? " me" : "") + (isTurn ? " active" : "") + (isDead ? " dead" : "");
    if (isWarlordTarget || isWizardSwapTarget) cls += " target-sel";

    const d = document.createElement("div");
    d.className = cls;
    if (isWarlordTarget) d.onclick = () => { G.warlordMode = i; renderWarlordOverlay(i); };
    if (isWizardSwapTarget) d.onclick = () => wizardSwap(i);

    const charIcon = G.phase === "player_turn" && p.selectedCharacter
      ? p.selectedCharacter.icon
      : G.phase === "select_character" && isMe && p.selectedCharacter
        ? p.selectedCharacter.icon : "❓";

    const pipHTML = p.city.map(c =>
      `<div class="cpip" style="background:${COLOR_CSS[c.color]};border-color:${COLOR_CSS[c.color]}55" title="${c.name}"></div>`
    ).join("");
    const sc = calcScore(p);

    d.innerHTML = `
      <div class="pc-top">
        <div class="pc-avatar" style="background:${p.color}22;border-color:${p.color}">${p.avatar}</div>
        <div style="flex:1;min-width:0">
          <div class="pc-name" style="color:${isMe ? "#c39bd3" : p.color}">${p.name}${isMe ? " (나)" : ""}</div>
          <div class="pc-tags">
            ${p.isAI ? '<span class="tag tag-ai">AI</span>' : ""}
            ${isTurn ? '<span class="tag tag-turn">▶ 턴</span>' : ""}
            ${p.crown ? '<span class="tag tag-crown">👑</span>' : ""}
            ${p.complete ? '<span class="tag tag-done">완성!</span>' : ""}
            ${isDead ? '<span class="tag tag-dead">💀 암살</span>' : ""}
          </div>
        </div>
        <div class="pc-char">${charIcon}</div>
      </div>
      <div class="pc-stats">
        <span class="pc-stat">💰<strong>${p.gold}</strong></span>
        <span class="pc-stat">🃏<strong>${p.hand.length}</strong></span>
        <span class="pc-stat">🏛️<strong>${p.city.length}/7</strong></span>
        <span class="pc-stat">⭐<strong>${sc}</strong></span>
      </div>
      ${p.city.length ? `<div class="pc-city">${pipHTML}</div>` : ""}
    `;
    el.appendChild(d);
  });
}

// ── 이벤트 피드 ──
function renderFeed() {
  const el = document.getElementById("feedList"); el.innerHTML = "";
  G.log.slice(0, 40).forEach(e => {
    const d = document.createElement("div");
    d.className = `feed-entry event-${e.type || "system"}`;
    d.innerHTML = `<span class="feed-icon">${e.icon}</span><span class="feed-text">${e.html}</span>`;
    el.appendChild(d);
  });
  document.getElementById("feedCount").textContent = `${G.log.length}건`;
}

// ── 메인 영역 ──
function renderMain() {
  const main = document.getElementById("mainArea"); main.innerHTML = "";
  if (G.phase === "select_character") renderCharSelect(main);
  else renderTurnPhase(main);
}

function renderCharSelect(main) {
  const mi = myIdx(), myTurn = G.selOrder[G.selIdx] === mi, me = G.players[mi];

  const banner = mkEl("div", "phase-banner sel");
  banner.innerHTML = `
    <div class="pb-icon">🎭</div>
    <div>
      <div class="pb-title" style="color:#c39bd3">
        ${myTurn ? "⚡ 캐릭터를 선택하세요!" : "⏳ 다른 플레이어 선택 대기 중..."}
      </div>
      <div class="pb-desc">
        ${myTurn
          ? `<b>${G.availChars.length}개</b>의 캐릭터 중 하나를 선택합니다. 캐릭터는 라운드 종료 후 공개됩니다.`
          : me.selectedCharacter
            ? `<b>${me.selectedCharacter.icon}${me.selectedCharacter.name}</b>을(를) 선택했습니다.`
            : "다른 플레이어가 선택 중입니다."}
      </div>
    </div>
  `;
  main.appendChild(banner);

  if (!myTurn && me.selectedCharacter) {
    const strip = mkEl("div", "my-char-strip");
    const ch = me.selectedCharacter;
    strip.style.cssText = `background:${ch.bg};border:1px solid ${ch.bc};border-radius:10px;margin-top:0`;
    strip.innerHTML = `
      <div style="font-size:40px">${ch.icon}</div>
      <div>
        <div style="font-size:9px;font-family:Cinzel,serif;color:var(--dim);letter-spacing:2px;margin-bottom:3px">선택한 캐릭터</div>
        <div style="font-size:16px;font-weight:800;color:${ch.tc}">${ch.id}. ${ch.name}</div>
        <div style="font-size:10px;color:var(--dim2);margin-top:4px;line-height:1.6">${ch.ability}</div>
      </div>
    `;
    main.appendChild(strip);
    return;
  }
  if (!myTurn) return;

  const t = mkEl("div", "sec-title"); t.textContent = "선택 가능한 캐릭터"; main.appendChild(t);
  const grid = mkEl("div", "");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;";
  G.availChars.forEach(ch => {
    const c = mkEl("div", "char-sel-card");
    c.style.cssText = `background:${ch.bg};border:1px solid ${ch.bc};`;
    c.innerHTML = `
      <div class="csc-icon">${ch.icon}</div>
      <div class="csc-num" style="color:${ch.tc}">${ch.id}번</div>
      <div class="csc-name" style="color:${ch.tc}">${ch.name}</div>
      <div class="csc-ability">${ch.ability}</div>
    `;
    c.onmouseover = () => { c.style.transform = "translateY(-4px)"; c.style.boxShadow = `0 8px 24px rgba(0,0,0,.4),0 0 20px ${ch.tc}35`; };
    c.onmouseout = () => { c.style.transform = ""; c.style.boxShadow = ""; };
    c.onclick = () => selectCharacter(ch.id);
    grid.appendChild(c);
  });
  main.appendChild(grid);
}

function renderTurnPhase(main) {
  const mi = myIdx(), me = G.players[mi], myTurn = isMyTurn(), myChar = me.selectedCharacter;
  const curP = G.players[G.curPi];

  // ① 배너
  const banner = mkEl("div", `phase-banner ${myTurn ? "act" : "wait"}`);
  const isDrawChoice = myTurn && G.actionPhase === "draw_choice";
  const isObservatory = myTurn && G.actionPhase === "observatory";
  banner.innerHTML = `
    <div class="pb-icon">${myTurn ? "⚡" : curP?.selectedCharacter?.icon || "⏳"}</div>
    <div>
      <div class="pb-title" style="color:${myTurn ? "var(--gold2)" : "var(--text)"}">
        ${myTurn ? "⚡ 내 턴!" : aiRunning ? `${curP?.name} 행동 중...` : `${curP?.name}의 턴`}
      </div>
      <div class="pb-desc">
        ${myTurn
          ? G.actionPhase === "choose" ? "💰 금화 받기 또는 🃏 카드 뽑기를 선택하세요"
            : isDrawChoice ? "뽑은 카드 중 <b>1장을 선택</b>하세요 (나머지는 버림)"
            : isObservatory ? "3장 중 <b>1장을 선택</b>하세요 (천문대)"
            : G._abilityPending ? "능력 사용 중 — 타깃을 선택하거나 취소하세요"
            : "🏛️ 건물을 건설하거나 능력을 사용하고 턴을 종료하세요"
          : aiRunning ? "게임 기록을 확인하세요." : "행동을 기다리는 중..."}
      </div>
    </div>
  `;
  main.appendChild(banner);

  // ② 내 캐릭터 스트립
  if (myChar) {
    const strip = mkEl("div", "my-char-strip");
    strip.style.cssText = `background:${myChar.bg};border:1px solid ${myChar.bc};border-radius:10px;`;
    strip.innerHTML = `
      <div style="font-size:34px">${myChar.icon}</div>
      <div style="flex:1">
        <div style="font-size:9px;font-family:Cinzel,serif;color:var(--dim);letter-spacing:2px;margin-bottom:2px">내 캐릭터</div>
        <div style="font-size:15px;font-weight:800;color:${myChar.tc}">${myChar.id}. ${myChar.name}</div>
        <div style="font-size:10px;color:var(--dim2);margin-top:3px;line-height:1.5">${myChar.abilityShort}</div>
      </div>
      <div style="text-align:right;font-size:12px;color:var(--dim2);flex-shrink:0;line-height:1.9">
        💰 ${me.gold}<br>🃏 ${me.hand.length}장<br>⭐ ${calcScore(me)}점
        ${myChar.id === 7 ? `<br><span style="color:#89c4f4;font-size:10px">건설 ${me.buildsLeft}회 남음</span>` : ""}
      </div>
    `;
    main.appendChild(strip);
  }

  // ③ 능력 안내 힌트
  if (G._abilityPending) {
    const msgs = {
      assassin: "🗡️ <b>우측 캐릭터 목록</b>에서 암살할 캐릭터를 클릭하세요",
      thief: "🦹 <b>우측 캐릭터 목록</b>에서 훔칠 캐릭터를 클릭하세요 (암살자·도둑 선택 불가)",
      warlord: "⚔️ <b>좌측 플레이어</b>를 클릭해 파괴할 건물을 선택하세요",
      wizard: "🔮 <b>아래에서</b> 마술사 능력을 선택하세요",
    };
    const hint = mkEl("div", "ability-hint");
    hint.innerHTML = msgs[G._abilityPending] || "";
    main.appendChild(hint);
  }

  // ④ 마술사 능력 선택 UI
  if (G._abilityPending === "wizard" && G.wizardMode === null) {
    const wiz = mkEl("div", "wizard-panel");
    wiz.innerHTML = `<div class="wiz-title">🔮 마술사 능력 선택</div>`;
    const btn1 = mkEl("button", "wiz-btn");
    btn1.innerHTML = "① 다른 플레이어와 손패 전체 교환<br><small>좌측에서 플레이어를 선택하세요</small>";
    btn1.onclick = () => { G.wizardMode = "swap"; render(); };
    const btn2 = mkEl("button", "wiz-btn");
    btn2.innerHTML = "② 손패 일부 버리고 새로 뽑기<br><small>아래 손패에서 버릴 카드를 선택하세요</small>";
    btn2.onclick = () => { G.wizardMode = "discard"; G.wizardDiscardSelected = []; render(); };
    wiz.appendChild(btn1); wiz.appendChild(btn2);
    main.appendChild(wiz);
  }

  // ⑤ 카드 뽑기 선택 UI (draw_choice)
  if (isDrawChoice && G._drawOptions) {
    const t = mkEl("div", "sec-title"); t.textContent = "🃏 카드 선택 (1장 고르기)"; main.appendChild(t);
    const grid = mkEl("div", "hand-grid");
    G._drawOptions.forEach(card => {
      const el = mkCard(card);
      el.classList.add("draw-choice");
      el.onclick = () => chooseDrawCard(card.uid);
      grid.appendChild(el);
    });
    main.appendChild(grid);
    return; // 선택 전까지 손패/도시 숨김
  }

  // ⑥ 천문대 선택 UI
  if (isObservatory && G._observatoryCards) {
    const t = mkEl("div", "sec-title"); t.textContent = "🔭 천문대: 3장 중 1장 선택"; main.appendChild(t);
    const grid = mkEl("div", "hand-grid");
    G._observatoryCards.forEach(card => {
      const el = mkCard(card);
      el.classList.add("draw-choice");
      el.onclick = () => chooseObservatoryCard(card.uid);
      grid.appendChild(el);
    });
    main.appendChild(grid);
    return;
  }

  // ⑦ 수입 선택 버튼 (choose 단계)
  if (myTurn && G.actionPhase === "choose") {
    const t = mkEl("div", "sec-title"); t.textContent = "수입 선택"; main.appendChild(t);
    const row = mkEl("div", "income-row");
    const g = mkEl("div", "income-btn gold-btn");
    g.innerHTML = `<div class="ib-icon">💰</div><div class="ib-label">금화 2개 받기</div><div class="ib-sub">안정적인 수입</div>`;
    g.onclick = takeGold;
    const cb = mkEl("div", "income-btn card-btn");
    cb.innerHTML = `<div class="ib-icon">🃏</div><div class="ib-label">카드 뽑기</div><div class="ib-sub">2장 중 1장 선택 (덱: ${G.deck.length}장)</div>`;
    cb.onclick = drawCard;
    row.appendChild(g); row.appendChild(cb); main.appendChild(row);
  }

  // ⑧ 손패
  const handT = mkEl("div", "sec-title");
  handT.innerHTML = `🃏 내 손패 (${me.hand.length}장) <span style="font-size:9px;color:var(--dim);margin-left:8px;font-family:'Noto Sans KR',sans-serif;letter-spacing:0;font-weight:400">클릭=선택 | 우클릭=카드 정보</span>`;
  main.appendChild(handT);

  if (!me.hand.length) {
    const e = mkEl("div", "empty-msg"); e.textContent = "손패가 없습니다."; main.appendChild(e);
  } else {
    const grid = mkEl("div", "hand-grid");
    const isWizardDiscard = myTurn && G._abilityPending === "wizard" && G.wizardMode === "discard";
    me.hand.forEach(card => {
      const el = mkCard(card);
      const isDiscardSel = G.wizardDiscardSelected?.includes(card.uid);
      if (selectedCard === card.uid) el.classList.add("sel");
      if (isDiscardSel) el.classList.add("discard-sel");

      if (isWizardDiscard) {
        el.onclick = () => {
          if (!G.wizardDiscardSelected) G.wizardDiscardSelected = [];
          if (isDiscardSel) G.wizardDiscardSelected = G.wizardDiscardSelected.filter(u => u !== card.uid);
          else G.wizardDiscardSelected.push(card.uid);
          render();
        };
      } else if (myTurn && G.actionPhase === "build") {
        if (me.gold < card.cost || me.buildsLeft <= 0) {
          el.classList.add("disabled");
        } else {
          el.onclick = () => { selectedCard = selectedCard === card.uid ? null : card.uid; render(); };
        }
      } else {
        el.style.cursor = "default";
      }
      el.addEventListener("contextmenu", e2 => { e2.preventDefault(); openTooltip(card); });
      grid.appendChild(el);
    });
    main.appendChild(grid);

    // 마술사 버리기 확인 버튼
    if (isWizardDiscard && G.wizardDiscardSelected?.length > 0) {
      const cfm = mkEl("button", "abt abt-purple");
      cfm.style.marginTop = "8px";
      cfm.textContent = `🔮 선택한 ${G.wizardDiscardSelected.length}장 버리고 새로 뽑기`;
      cfm.onclick = () => wizardDiscard(G.wizardDiscardSelected);
      main.appendChild(cfm);
    }
  }

  // ⑨ 내 도시
  const cityT = mkEl("div", "sec-title");
  cityT.textContent = `🏛️ 내 도시 (${me.city.length}/7) — ⭐ ${calcScore(me)}점`;
  main.appendChild(cityT);

  if (!me.city.length) {
    const e = mkEl("div", "empty-msg"); e.textContent = "아직 건설된 건물이 없습니다."; main.appendChild(e);
  } else {
    const grid = mkEl("div", "hand-grid");
    me.city.forEach(card => {
      const el = mkCard(card);
      el.classList.add("city-card");
      el.onclick = () => openTooltip(card);
      el.addEventListener("contextmenu", e2 => { e2.preventDefault(); openTooltip(card); });
      grid.appendChild(el);
    });
    main.appendChild(grid);
  }

  // ⑩ 장군 파괴 오버레이
  if (G._abilityPending === "warlord" && G.warlordMode !== false && G.warlordMode !== undefined) {
    renderWarlordOverlay(G.warlordMode);
  }
}

function renderWarlordOverlay(targetPi) {
  // 장군 파괴: 타겟 플레이어의 건물 목록 오버레이
  const main = document.getElementById("mainArea");
  const tp = G.players[targetPi];
  if (!tp) return;

  // 기존 오버레이 제거
  const existing = document.getElementById("warlordOverlay");
  if (existing) existing.remove();

  const overlay = mkEl("div", "warlord-overlay");
  overlay.id = "warlordOverlay";
  overlay.innerHTML = `
    <div class="wo-title">⚔️ ${tp.name}의 건물 — 파괴할 건물을 선택하세요</div>
    <div class="wo-grid" id="woGrid"></div>
    <button class="abt abt-dim" onclick="cancelAbility()" style="margin-top:8px">취소</button>
  `;
  main.appendChild(overlay);

  const grid = document.getElementById("woGrid");
  const p = G.players[myIdx()];
  tp.city.forEach(dist => {
    const cost = Math.max(0, dist.cost - 1);
    const canAfford = p.gold >= cost;
    const el = mkCard(dist);
    if (!canAfford) { el.classList.add("disabled"); el.title = `금화 ${cost}개 필요 (현재 ${p.gold}개)`; }
    else {
      el.onclick = () => warlordDestroy(targetPi, dist.uid);
      const costBadge = mkEl("div", "wo-cost");
      costBadge.textContent = cost === 0 ? "무료" : `💰${cost}`;
      el.appendChild(costBadge);
    }
    grid.appendChild(el);
  });
}

// ── 오른쪽 캐릭터 패널 ──
function renderCharPanel() {
  const el = document.getElementById("charList"); el.innerHTML = "";
  const mi = myIdx(), myChar = G.players[mi].selectedCharacter;
  const isATarget = G._abilityPending === "assassin";
  const isTTarget = G._abilityPending === "thief";

  CHARS.forEach(ch => {
    const pi = G.selectedChars[ch.id];
    const picked = pi !== undefined, isMine = pi === mi;
    const isRemoved = !picked && !G.availChars.find(c => c.id === ch.id);
    const isDead = G.assassinTarget === ch.id;
    const isThiefMark = G.thiefTarget === ch.id;
    const canTarget = (isATarget || isTTarget) && ch.id !== myChar?.id && !(isTTarget && ch.id <= 2) && !(isTTarget && G.assassinTarget === ch.id);
    const isTargeted = false;

    const d = mkEl("div", "cl-item" + (isRemoved ? " removed" : "") + (isMine ? " mine" : "") + (canTarget ? " target-mode" : ""));
    d.style.cssText = `background:${isRemoved ? "rgba(255,255,255,.02)" : ch.bg};border-color:${isMine ? ch.bc : "rgba(255,255,255,.05)"};`;
    d.innerHTML = `
      <div class="cl-head">
        <span class="cl-num">${ch.id}</span>
        <span class="cl-icon">${ch.icon}</span>
        <span class="cl-name" style="color:${ch.tc}">${ch.name}</span>
      </div>
      <div class="cl-ability">${ch.abilityShort}</div>
      <div class="cl-badges">
        ${isMine ? '<span class="cl-badge cl-badge-mine">◀ 내 캐릭터</span>' : ""}
        ${isDead ? '<span class="cl-badge cl-badge-dead">💀 암살됨</span>' : ""}
        ${isThiefMark ? '<span class="cl-badge cl-badge-thief">🦹 도둑 타깃</span>' : ""}
        ${isRemoved && G.phase === "select_character" ? '<span class="cl-badge cl-badge-rm">제거됨</span>' : ""}
      </div>
    `;
    if (canTarget) d.onclick = () => selectAbilityTarget(ch.id);
    el.appendChild(d);
  });
}

// ── 오른쪽 하단: 다른 플레이어 도시 ──
function renderCityPanel() {
  const panel = document.getElementById("cityPanel");
  panel.innerHTML = `<div style="font-family:Cinzel,serif;font-size:9px;letter-spacing:3px;color:var(--dim);padding:0 0 8px">다른 플레이어 도시</div>`;
  const mi = myIdx();
  G.players.filter((_, i) => i !== mi).forEach(p => {
    if (!p.city.length) return;
    const row = mkEl("div", "city-row");
    row.innerHTML = `<div class="city-row-name">${p.avatar} ${p.name} <span style="color:var(--dim)">(${p.city.length}/7) ⭐${calcScore(p)}</span></div>`;
    const pips = mkEl("div", "city-pips");
    p.city.forEach(c => {
      const pip = mkEl("div", "city-pip-big");
      pip.style.cssText = `background:${COLOR_CSS[c.color]}22;border-color:${COLOR_CSS[c.color]}66;color:${COLOR_CSS[c.color]};`;
      pip.innerHTML = `${c.icon}<span>${c.name}</span>`;
      pip.onclick = () => openTooltip(c);
      pips.appendChild(pip);
    });
    row.appendChild(pips); panel.appendChild(row);
  });
}

// ── 하단 액션 바 ──
function renderActionBar() {
  const bar = document.getElementById("actionBar"); bar.innerHTML = "";

  if (G.phase === "select_character") {
    if (!isMyCharSel()) {
      const w = mkEl("div", "ab-wait");
      w.innerHTML = `<span class="ab-wait-dot"></span> 캐릭터 선택 대기 중...`;
      bar.appendChild(w);
    }
    return;
  }

  if (!isMyTurn()) {
    const w = mkEl("div", "ab-wait");
    w.innerHTML = `<span class="ab-wait-dot"></span> ${G.players[G.curPi]?.name}의 턴${aiRunning ? " — 행동 진행 중..." : ""}`;
    bar.appendChild(w); return;
  }

  const me = G.players[myIdx()], myChar = me.selectedCharacter;

  if (G.actionPhase === "choose") {
    abt(bar, "💰 금화 2개", "abt-gold", takeGold);
    abt(bar, "🃏 카드 뽑기", "abt-blue", drawCard);
    return;
  }

  if (G.actionPhase === "draw_choice" || G.actionPhase === "observatory") return; // 메인에서 처리

  if (G.actionPhase === "build") {
    // 건설 버튼
    const bLabel = selectedCard
      ? `🏛️ 건설 (💰${me.hand.find(c => c.uid === selectedCard)?.cost ?? "?"})` : "🏛️ 건물 선택 후 건설";
    const bb = abt(bar, bLabel, "abt-green", () => { if (selectedCard) buildDistrict(selectedCard); });
    if (!selectedCard) bb.disabled = true;

    // 능력 버튼
    if (myChar && [1, 2, 3, 8].includes(myChar.id) && !me.abilityUsed) {
      abt(bar, `${myChar.icon} ${myChar.name} 능력`, "abt-purple", useAbility);
    } else if (myChar && [1, 2, 3, 8].includes(myChar.id) && me.abilityUsed) {
      const ab = abt(bar, `${myChar.icon} 능력 (사용됨)`, "abt-dim", null);
      ab.disabled = true;
    }

    // 취소
    if (G._abilityPending) abt(bar, "✖️ 취소", "abt-dim", cancelAbility);

    // 턴 종료
    abt(bar, "✅ 턴 종료", "abt-end", endTurn);
  }
}

// ── 카드 엘리먼트 생성 ──
function mkCard(d) {
  const el = mkEl("div", `dcard c-${d.color}`);
  el.innerHTML = `
    <div class="dc-icon">${d.icon}</div>
    <div class="dc-name">${d.name}</div>
    <div class="dc-cost">${d.cost}</div>
    ${d.special ? '<div class="dc-special" title="특수 능력 있음">✨</div>' : ""}
  `;
  return el;
}

// ── 카드 툴팁 ──
function openTooltip(d) {
  document.getElementById("ttIcon").textContent = d.icon;
  document.getElementById("ttName").textContent = d.name;
  document.getElementById("ttName").style.color = COLOR_CSS[d.color];
  document.getElementById("ttType").textContent = COLOR_LABEL[d.color] + " 지구";
  const badge = document.getElementById("ttCostBadge");
  badge.textContent = d.cost; badge.style.background = COLOR_CSS[d.color];
  badge.style.color = d.color === "purple" ? "#fff" : "#07090f";
  const sb = document.getElementById("ttSpecialBox");
  if (d.special) { document.getElementById("ttSpecialText").textContent = d.special; sb.classList.remove("hidden"); }
  else sb.classList.add("hidden");
  document.getElementById("tooltipModal").classList.remove("hidden");
}
function closeTooltip() { document.getElementById("tooltipModal").classList.add("hidden"); }

// ── 게임 종료 모달 ──
function showGameOverModal() {
  const sorted = G.players.map(p => ({ ...p, score: calcScore(p) })).sort((a, b) => b.score - a.score);
  document.getElementById("goWinner").textContent = `🎉 ${sorted[0].name} 승리!`;
  const list = document.getElementById("goScores"); list.innerHTML = "";
  ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣"].forEach((m, i) => {
    const p = sorted[i]; if (!p) return;
    const li = mkEl("li", "go-score");
    li.innerHTML = `<span>${m} ${p.avatar} ${p.name}</span><span class="go-pts">${p.score}점</span>`;
    list.appendChild(li);
  });
  document.getElementById("gameOverModal").classList.remove("hidden");
}

// ── 유틸 ──
function mkEl(tag, cls) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  return el;
}
function abt(container, label, cls, fn) {
  const b = mkEl("button", `abt ${cls}`);
  b.innerHTML = label;
  if (fn) b.onclick = fn; else b.disabled = true;
  container.appendChild(b);
  return b;
}

// ── 대기실 렌더 ──
function renderWaitingRoom(room) {
  const list = document.getElementById("waitingList"); list.innerHTML = "";
  room.players.forEach((p, i) => {
    const d = mkEl("div", "waiting-player" + (i === 0 ? " host" : ""));
    d.innerHTML = `<span class="w-dot"></span><span style="font-size:18px">${p.avatar}</span><span style="font-size:13px;font-weight:700">${p.name}</span>${i === 0 ? '<span style="margin-left:auto;font-size:10px;color:var(--gold);font-family:Cinzel,serif">HOST</span>' : ""}`;
    list.appendChild(d);
  });
}
