// 키보드 뽑기(하루 한 번, 무료)와 스킨 보관함의 규칙. 화면·저장소와 분리된 순수 로직이라 테스트하기 쉽다.
import { SKINS, SKIN_BY_ID, DEFAULT_SKIN_ID, RARITIES, RARITY_ORDER } from './keyboard-skins.js';

// 천장: 이 횟수째에는 반드시 그 등급 이상이 나온다. 전설은 softStart회째부터 매회 softStep씩 확률이 오른다
export const PITY = Object.freeze({ rare: 10, epic: 30, legendary: 60, softStart: 45, softStep: 0.05 });
// 게임 포인트로 하는 뽑기: 1회 100P, 10회 900P(10회는 희귀 이상 1개 이상 보장)
export const COSTS = Object.freeze({ single: 100, multi: 900, multiCount: 10 });
// 한 판에서 받는 포인트: 맞게 친 글자 10개당 1P × 정확도² + 최대 콤보 10마다 2P, 한 판 최대 300P.
// 맞게 친 글자가 20개 미만이면(바로 끝낸 판) 0P
export const EARNING = Object.freeze({ charactersPerPoint: 10, comboStep: 10, comboPoints: 2, maxPerGame: 300, minimumCharacters: 20 });

export function pointsForGame(summary) {
  const correct = Number(summary?.correctKeystrokes) || 0;
  if (correct < EARNING.minimumCharacters) return 0;
  const accuracy = Math.max(0, Math.min(100, Number(summary.accuracy) || 0)) / 100;
  const typing = Math.floor(correct / EARNING.charactersPerPoint * accuracy * accuracy);
  const combo = Math.floor((Number(summary.maxCombo) || 0) / EARNING.comboStep) * EARNING.comboPoints;
  return Math.min(EARNING.maxPerGame, typing + combo);
}
const FIRST_DRAW_MINIMUM = 'rare';

export function createGachaState() {
  return { owned: [DEFAULT_SKIN_ID], equipped: DEFAULT_SKIN_ID, fragments: 0, points: 0, lastDrawDay: null, draws: 0, pity: { rare: 0, epic: 0, legendary: 0 } };
}

// 저장된 값을 믿지 않고 모양을 바로잡는다(없는 스킨·음수·깨진 값 제거)
export function normalizeGachaState(saved) {
  const fresh = createGachaState();
  if (!saved || typeof saved !== 'object') return fresh;
  const owned = Array.isArray(saved.owned) ? saved.owned.filter(id => SKIN_BY_ID.has(id)) : [];
  const count = value => Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const state = {
    owned: [...new Set([DEFAULT_SKIN_ID, ...owned])],
    equipped: DEFAULT_SKIN_ID,
    fragments: count(saved.fragments),
    points: count(saved.points),
    lastDrawDay: typeof saved.lastDrawDay === 'string' ? saved.lastDrawDay : null,
    draws: count(saved.draws),
    pity: { rare: count(saved.pity?.rare), epic: count(saved.pity?.epic), legendary: count(saved.pity?.legendary) }
  };
  if (state.owned.includes(saved.equipped)) state.equipped = saved.equipped;
  return state;
}

// 기기 현지 날짜 'YYYY-MM-DD' — 자정이 지나면 다시 뽑을 수 있다
export function dayKey(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const canDraw = (state, today = dayKey()) => state.lastDrawDay !== today;

// 이번 뽑기의 전설 확률(소프트 천장 포함)
export function legendaryChance(state) {
  const attempt = state.pity.legendary + 1;
  if (attempt >= PITY.legendary) return 1;
  return Math.min(1, RARITIES.legendary.rate + Math.max(0, attempt - PITY.softStart + 1) * PITY.softStep);
}

// 이번 뽑기에서 보장되는 최소 등급(첫 뽑기·천장·10회 보장)
function guaranteedRarity(state, floor = 'common') {
  if (state.pity.epic + 1 >= PITY.epic) return 'epic';
  if (state.pity.rare + 1 >= PITY.rare) return 'rare';
  if (state.draws === 0) return FIRST_DRAW_MINIMUM;
  return floor;
}

function rollRarity(state, random, floor) {
  if (random() < legendaryChance(state)) return 'legendary';
  const others = RARITY_ORDER.filter(rarity => rarity !== 'legendary');
  const total = others.reduce((sum, rarity) => sum + RARITIES[rarity].rate, 0);
  let roll = random() * total;
  let rolled = others[0];
  for (const rarity of others) {
    rolled = rarity;
    roll -= RARITIES[rarity].rate;
    if (roll <= 0) break;
  }
  const minimum = guaranteedRarity(state, floor);
  return RARITY_ORDER.indexOf(rolled) < RARITY_ORDER.indexOf(minimum) ? minimum : rolled;
}

// 등급 안에서 스킨 고르기. 영웅·전설은 아직 없는 스킨부터 준다(막판에 중복만 나오지 않게)
function pickSkin(state, rarity, random) {
  const pool = SKINS.filter(skin => skin.rarity === rarity && skin.id !== DEFAULT_SKIN_ID);
  const fresh = pool.filter(skin => !state.owned.includes(skin.id));
  const candidates = fresh.length && RARITY_ORDER.indexOf(rarity) >= RARITY_ORDER.indexOf('epic') ? fresh : pool;
  return candidates[Math.floor(random() * candidates.length)];
}

// 한 번 뽑아 새 상태와 결과를 돌려준다(원본은 바꾸지 않는다). 날짜·비용은 부르는 쪽에서
function drawOnce(state, random, floor = 'common') {
  const rarity = rollRarity(state, random, floor);
  const skin = pickSkin(state, rarity, random);
  const duplicate = state.owned.includes(skin.id);
  const rank = RARITY_ORDER.indexOf(rarity);
  const next = {
    ...state,
    owned: duplicate ? state.owned : [...state.owned, skin.id],
    fragments: state.fragments + (duplicate ? RARITIES[rarity].refund : 0),
    draws: state.draws + 1,
    pity: {
      rare: rank >= RARITY_ORDER.indexOf('rare') ? 0 : state.pity.rare + 1,
      epic: rank >= RARITY_ORDER.indexOf('epic') ? 0 : state.pity.epic + 1,
      legendary: rarity === 'legendary' ? 0 : state.pity.legendary + 1
    }
  };
  return { state: next, result: { skin, rarity, duplicate, refund: duplicate ? RARITIES[rarity].refund : 0 } };
}

// 오늘의 무료 뽑기. 이미 뽑았으면 { ok: false }
export function draw(state, { random = Math.random, today = dayKey() } = {}) {
  if (!canDraw(state, today)) return { ok: false, reason: 'already_drawn', state };
  const { state: next, result } = drawOnce(state, random);
  return { ok: true, state: { ...next, lastDrawDay: today }, ...result };
}

// 포인트 뽑기: count 1 → 100P, 10 → 900P. 10회는 앞 9번에 희귀 이상이 없으면 마지막을 희귀 이상으로. O(count)
export function drawWithPoints(state, count = 1, { random = Math.random } = {}) {
  const multi = count === COSTS.multiCount;
  if (count !== 1 && !multi) return { ok: false, reason: 'bad_count', state };
  const cost = multi ? COSTS.multi : COSTS.single;
  if (state.points < cost) return { ok: false, reason: 'not_enough_points', state, cost };
  let next = { ...state, points: state.points - cost };
  const results = [];
  for (let index = 0; index < count; index++) {
    const needRare = multi && index === count - 1 && !results.some(entry => RARITY_ORDER.indexOf(entry.rarity) >= RARITY_ORDER.indexOf('rare'));
    const once = drawOnce(next, random, needRare ? 'rare' : 'common');
    next = once.state;
    results.push(once.result);
  }
  return { ok: true, state: next, results, cost };
}

// 판이 끝나면 포인트 적립
export function addPoints(state, amount) {
  const gained = Math.max(0, Math.floor(Number(amount) || 0));
  return gained ? { ...state, points: state.points + gained } : state;
}

// 조각으로 스킨 사기
export function buy(state, skinId) {
  const skin = SKIN_BY_ID.get(skinId);
  if (!skin || skin.id === DEFAULT_SKIN_ID) return { ok: false, reason: 'unknown_skin', state };
  if (state.owned.includes(skinId)) return { ok: false, reason: 'already_owned', state };
  const price = RARITIES[skin.rarity].price;
  if (state.fragments < price) return { ok: false, reason: 'not_enough_fragments', state };
  return { ok: true, state: { ...state, owned: [...state.owned, skinId], fragments: state.fragments - price } };
}

export function equip(state, skinId) {
  if (!state.owned.includes(skinId)) return { ok: false, reason: 'not_owned', state };
  return { ok: true, state: { ...state, equipped: skinId } };
}
