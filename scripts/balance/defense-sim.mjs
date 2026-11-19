// 컴퓨터 디펜스 카드 가치 측정: 같은 시드로 여러 판을 돌려, 첫 카드(3웨이브 뒤)만 바꿔 끼우고
// 끝까지 버틴 정도(막은 웨이브 + 남은 체력 비율)를 기준 카드(과부하 클럭)와 비교한다. 이후 카드는 고르지 않는다.
// 봇: 초당 cps글자로 낱말을 치고, 코인이 모이면 정해진 순서로 타워를 짓고, 자리가 없으면 강화, 체력이 낮으면 수리.
// 사용: node scripts/balance/defense-sim.mjs [반복 수=60] [cps=3.2] [카드 id들(쉼표)]
import { DefenseEngine } from '../../public/js/defense-engine.js';
import { DEFENSE_CARDS } from '../../public/js/defense-cards.js';
import { getTokenPool } from '../../public/js/tokens.js';

const runs = Number(process.argv[2] ?? 60);
const cps = Number(process.argv[3] ?? 3.2);
const only = process.argv[4] ? process.argv[4].split(',') : null;
const REFERENCE = 'overclock';
const LEVEL = Number(process.env.LEVEL ?? 4);
const MAX_BUILT = Number(process.env.MAX_TOWERS ?? 6);
const tokenPool = getTokenPool('python');
const BUILD_ORDER = ['firewall', 'antivirus', 'antivirus', 'emp', 'interceptor', 'honeypot', 'antivirus', 'interceptor', 'emp'];

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}

function play(seed, firstCard, { sources } = {}) {
  const engine = new DefenseEngine({ tokenPool, level: LEVEL, random: seeded(seed), randomMap: true, cards: true, maxTokenLength: 16 });
  let freezes = 0;
  engine.onEvent = (type, payload) => { if (type === 'breakpoint') freezes++; if (sources && type === 'coins') sources[payload.reason] = (sources[payload.reason] ?? 0) + payload.amount; };
  engine.start(0);
  let nextKeyAt = 0.5, nextShopAt = 1, built = 0, text = null, index = 0, drafts = 0;
  for (let ms = 0; ms < 20 * 60 * 1000 && engine.status === 'running'; ms += 50) {
    engine.update(ms);
    const now = engine.gameTime;
    if (engine.phase === 'draft') {
      drafts++;
      if (drafts === 1) engine.draft.hand = [firstCard];
      engine.draft.hand = engine.draft.hand.slice(0, 1);
      // 첫 카드 뒤로는 효과 없는 점수 카드로 고정(비교를 흐리지 않게)
      if (drafts > 1) engine.draft.hand = ['leaderboard'];
      engine.chooseCard(0);
      continue;
    }
    if (now >= nextShopAt) {
      nextShopAt = now + 0.6;
      if (engine.health < engine.maxHealth * 0.35 && engine.coins >= engine.priceOf('patch')) engine.buy('patch');
      const next = BUILD_ORDER[built % BUILD_ORDER.length];
      if (engine.coins >= engine.priceOf(next)) {
        const spots = engine.suggestedSpots();
        if (built < MAX_BUILT && spots.length && engine.selectShopItem(next).buildMode) {
          const result = engine.placeAtPoint(spots[0]);
          if (result?.bought !== false) built++;
          else engine.cancelBuild('sim', { silent: true });
        } else if (engine.towers.length) {
          const cheapest = [...engine.towers].filter(tower => engine.upgradeInfo(tower)?.price != null && !engine.upgradeInfo(tower).maxed).sort((a, b) => engine.upgradeInfo(a).price - engine.upgradeInfo(b).price)[0];
          if (cheapest && engine.coins >= engine.upgradeInfo(cheapest).price) engine.upgradeTower(cheapest);
        }
      }
    }
    if (now >= nextKeyAt && engine.phase !== 'draft') {
      const word = engine.stream[0];
      if (word) {
        if (text !== word.token.text) { text = word.token.text; index = 0; }
        engine.input(text[index], ms);
        index++;
        if (index >= text.length) { text = null; nextKeyAt = now + 0.25; } else nextKeyAt = now + 1 / cps;
      }
    }
  }
  if (process.env.DEBUG2) console.log(firstCard, engine.cards.slice(0, 3).join(','), engine.wavesCleared, engine.phase, 'freezes', freezes);
  return engine.wavesCleared + Math.max(0, engine.health) / engine.maxHealth;
}

const reference = Array.from({ length: runs }, (_, seed) => play(seed + 1, REFERENCE));
const sources = {};
play(1, REFERENCE, { sources });
if (process.env.DEBUG) console.log(reference.map(v => v.toFixed(1)).join(' '));
console.log('기준(과부하 클럭) 평균 막은 웨이브:', (reference.reduce((a, b) => a + b, 0) / runs).toFixed(2), ' 코인 출처(1판):', sources);
const rows = [];
for (const card of DEFENSE_CARDS) {
  if (only && !only.includes(card.id)) continue;
  let total = 0;
  for (let seed = 0; seed < runs; seed++) total += play(seed + 1, card.id) - reference[seed];
  rows.push({ id: card.id, rarity: card.rarity, delta: +(total / runs).toFixed(2) });
}
console.table(rows);
