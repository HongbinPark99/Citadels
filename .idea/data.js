// ═══════════════════════════════════════════════════════
// data.js — 시타델 게임 데이터 & 룰
// ═══════════════════════════════════════════════════════

const CHARS = [
  {
    id: 1, name: "암살자", icon: "🗡️",
    tc: "#e05252", bg: "rgba(139,20,20,.3)", bc: "rgba(224,82,82,.4)",
    color: "red",
    ability: "다른 캐릭터 하나를 지목합니다. 그 캐릭터를 가진 플레이어는 이번 라운드에 행동할 수 없습니다.",
    abilityShort: "캐릭터 지목 → 해당 플레이어 턴 스킵"
  },
  {
    id: 2, name: "도둑", icon: "🦹",
    tc: "#f5a623", bg: "rgba(120,80,0,.3)", bc: "rgba(245,166,35,.4)",
    color: "red",
    ability: "암살자가 지목하지 않은 캐릭터 하나를 지목합니다. 그 캐릭터가 등장하면 금화를 모두 빼앗습니다.",
    abilityShort: "캐릭터 지목 → 등장 시 금화 전부 탈취"
  },
  {
    id: 3, name: "마술사", icon: "🔮",
    tc: "#c39bd3", bg: "rgba(90,40,120,.3)", bc: "rgba(155,89,182,.4)",
    color: "purple",
    ability: "① 다른 플레이어와 손패 전체를 교환하거나, ② 손패 일부를 버리고 같은 수만큼 새로 뽑습니다.",
    abilityShort: "손패 교환 또는 손패 일부 버리고 새로 뽑기"
  },
  {
    id: 4, name: "왕", icon: "👑",
    tc: "#f5d06a", bg: "rgba(120,90,0,.3)", bc: "rgba(212,168,67,.5)",
    color: "yellow",
    ability: "왕관 마커를 가져와 다음 라운드 첫 번째로 캐릭터를 선택합니다. 도시의 귀족(노란색) 건물 1개당 금화 1개를 받습니다.",
    abilityShort: "왕관 획득(다음 라운드 선택 우선권) + 노란 건물당 💰+1"
  },
  {
    id: 5, name: "주교", icon: "⛪",
    tc: "#7ecca1", bg: "rgba(20,80,50,.3)", bc: "rgba(76,175,125,.4)",
    color: "blue",
    ability: "도시의 종교(파란색) 건물 1개당 금화 1개를 받습니다. 장군은 주교의 건물을 파괴할 수 없습니다.",
    abilityShort: "파란 건물당 💰+1 + 장군으로부터 건물 보호"
  },
  {
    id: 6, name: "상인", icon: "💰",
    tc: "#fb923c", bg: "rgba(120,50,0,.3)", bc: "rgba(251,146,60,.4)",
    color: "green",
    ability: "이번 턴 시작 시 금화 1개를 추가로 받습니다. 도시의 상업(초록색) 건물 1개당 금화 1개를 받습니다.",
    abilityShort: "💰+1 추가 + 초록 건물당 💰+1"
  },
  {
    id: 7, name: "건축가", icon: "🏗️",
    tc: "#89c4f4", bg: "rgba(20,60,120,.3)", bc: "rgba(91,155,213,.4)",
    color: "blue",
    ability: "수입을 받은 후 카드를 2장 추가로 뽑습니다. 이번 턴에 건물을 최대 3개까지 건설할 수 있습니다.",
    abilityShort: "카드 2장 추가 + 이번 턴 최대 3채 건설 가능"
  },
  {
    id: 8, name: "장군", icon: "⚔️",
    tc: "#f08080", bg: "rgba(100,20,20,.3)", bc: "rgba(224,82,82,.4)",
    color: "red",
    ability: "도시의 군사(빨간색) 건물 1개당 금화 1개를 받습니다. (건물 비용 - 1)의 금화를 내고 다른 플레이어의 건물 1채를 파괴합니다. 주교의 건물은 파괴할 수 없습니다.",
    abilityShort: "빨간 건물당 💰+1 + 상대 건물 파괴 (비용-1 지불)"
  },
];

// 건물 카드 (기본 66장: 각 색 일반 건물 × 3~5장씩)
const DISTRICTS = [
  // ── 노란색 (귀족) ── 5종 × 3장 = 15장
  { id: "manor",   name: "장원",   cost: 3, color: "yellow", icon: "🏡" },
  { id: "castle",  name: "성",     cost: 4, color: "yellow", icon: "🏯" },
  { id: "palace",  name: "궁전",   cost: 5, color: "yellow", icon: "🏛️" },
  { id: "manor2",  name: "저택",   cost: 3, color: "yellow", icon: "🏠" },
  { id: "castle2", name: "요새",   cost: 4, color: "yellow", icon: "🗼" },
  // ── 파란색 (종교) ── 5종 × 3장 = 15장
  { id: "temple",     name: "사원",   cost: 1, color: "blue", icon: "⛩️" },
  { id: "church",     name: "교회",   cost: 2, color: "blue", icon: "⛪" },
  { id: "monastery",  name: "수도원", cost: 3, color: "blue", icon: "🕌" },
  { id: "cathedral",  name: "대성당", cost: 5, color: "blue", icon: "🕍" },
  { id: "church2",    name: "성당",   cost: 2, color: "blue", icon: "🏟️" },
  // ── 초록색 (상업) ── 6종 × 3장 = 18장
  { id: "tavern",      name: "선술집", cost: 1, color: "green", icon: "🍺" },
  { id: "market",      name: "시장",   cost: 2, color: "green", icon: "🏪" },
  { id: "tradingpost", name: "무역소", cost: 2, color: "green", icon: "⚖️" },
  { id: "docks",       name: "부두",   cost: 3, color: "green", icon: "⚓" },
  { id: "harbor",      name: "항구",   cost: 4, color: "green", icon: "🚢" },
  { id: "townhall",    name: "시청",   cost: 5, color: "green", icon: "🏦" },
  // ── 빨간색 (군사) ── 5종 × 3장 = 15장
  { id: "watchtower",  name: "감시탑", cost: 1, color: "red", icon: "🗼" },
  { id: "prison",      name: "감옥",   cost: 2, color: "red", icon: "⛓️" },
  { id: "battlefield", name: "전쟁터", cost: 3, color: "red", icon: "⚔️" },
  { id: "fortress",    name: "요새",   cost: 5, color: "red", icon: "🛡️" },
  { id: "barracks",    name: "막사",   cost: 3, color: "red", icon: "🎯" },
  // ── 보라색 (특수) ── 각 1장
  { id: "haunted",     name: "유령 도시", cost: 2, color: "purple", icon: "👻",
    special: "게임 종료 시 원하는 색 지구 1개로 간주됩니다." },
  { id: "university",  name: "대학교",    cost: 6, color: "purple", icon: "🎓",
    special: "이 건물은 비용(6) + 추가 3점 = 총 9점으로 계산됩니다." },
  { id: "dragondoor",  name: "용의 관문", cost: 6, color: "purple", icon: "🐉",
    special: "이 건물은 비용(6) + 추가 3점 = 총 9점으로 계산됩니다." },
  { id: "school",      name: "마법 학교", cost: 6, color: "purple", icon: "🧙",
    special: "이 건물은 비용(6) + 추가 3점 = 총 9점으로 계산됩니다." },
  { id: "library",     name: "도서관",    cost: 6, color: "purple", icon: "📚",
    special: "카드 뽑기를 선택했을 때 2장을 뽑고 2장 모두 손에 넣습니다." },
  { id: "observatory", name: "천문대",    cost: 5, color: "purple", icon: "🔭",
    special: "카드 뽑기를 선택했을 때 3장을 보고 1장을 선택합니다." },
  { id: "graveyard",   name: "묘지",      cost: 5, color: "purple", icon: "⚰️",
    special: "장군이 건물을 파괴할 때 금화 1개를 내면 그 건물을 손패로 가져올 수 있습니다." },
  { id: "smithy",      name: "대장간",    cost: 5, color: "purple", icon: "⚒️",
    special: "한 턴에 금화 2개를 내고 카드 3장을 추가로 뽑을 수 있습니다." },
];

const COLOR_CSS   = { yellow: "#d4a017", blue: "#5b9bd5", green: "#4caf7d", red: "#e05252", purple: "#9b59b6" };
const COLOR_LABEL = { yellow: "귀족",    blue: "종교",    green: "상업",    red: "군사",    purple: "특수" };
const AVATARS     = ["🧙","🦸","🧝","🧛","🧟","🧞"];
const P_COLORS    = ["#e05252","#d4a017","#4caf7d","#5b9bd5","#c39bd3","#fb923c"];

// ── 유틸 ──
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeDeck() {
  const deck = [];
  DISTRICTS.forEach(d => {
    const copies = d.color === "purple" ? 1 : 3;
    for (let i = 0; i < copies; i++) {
      deck.push({ ...d, uid: `${d.id}_${i}` });
    }
  });
  return shuffle(deck);
}

// 점수 계산 (공식 룰)
function calcScore(p) {
  let s = 0;
  const colors = new Set();
  p.city.forEach(d => {
    s += d.cost;
    // 보라색 특수 건물 추가 점수
    if (["university", "dragondoor", "school"].includes(d.id)) s += 3;
    colors.add(d.color);
  });
  // 5색 보너스
  if (colors.size >= 5) s += 3;
  // 완성 보너스: 첫 7채 +4점, 이후 +2점
  if (p.firstComplete) s += 4;
  else if (p.complete)  s += 2;
  return s;
}

// 게임 초기 상태 생성
function buildInitialG(players) {
  const deck = makeDeck();
  // 초기 패 4장씩 배분
  const updatedPlayers = players.map((p, i) => ({
    ...p,
    gold: 2,
    hand: [deck.pop(), deck.pop(), deck.pop(), deck.pop()],
    city: [],
    crown: i === 0,
    selectedCharacter: null,
    complete: false,
    firstComplete: false,
    abilityUsed: false,
    buildsLeft: 1,    // 이번 턴 남은 건설 횟수
  }));

  // 캐릭터 셔플 후 1장 제거 (히든 밴)
  const chars = shuffle([...CHARS]);
  const removedChar = chars.pop();

  return {
    round: 1,
    deck,
    discard: [],
    phase: "select_character", // select_character | player_turn
    players: updatedPlayers,
    // 캐릭터 선택 관련
    selOrder: updatedPlayers.map((_, i) => i),  // 왕관 순서
    selIdx: 0,
    availChars: chars,
    removedChar,
    selectedChars: {},          // charId -> playerIdx
    // 행동 관련
    assassinTarget: null,       // 암살된 캐릭터 id
    thiefTarget: null,          // 도둑 타깃 캐릭터 id
    thiefPi: null,              // 도둑 플레이어 idx
    curCharIdx: 0,              // 현재 호명된 캐릭터 번호
    curPi: 0,                   // 현재 행동 중인 플레이어 idx
    actionPhase: "choose",      // choose | build
    // 마술사 관련
    wizardMode: null,           // null | "swap" | "discard"
    wizardDiscardSelected: [],  // 버릴 카드 uid 목록
    // 장군 파괴 관련
    warlordMode: false,
    // 로그
    log: [],
    gameOver: false,
    winner: null,
  };
}
