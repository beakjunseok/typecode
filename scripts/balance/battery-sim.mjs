// 배터리 구조 아이템 가치 측정: 같은 시드로 두 판을 돌려, 한쪽에만 6초에 아이템(등급별)을 준 뒤
// 40초 후 판세(내 칸 − 방전봇 칸) 차이를 평균한다. 플레이어는 초당 cps글자로 치는 단순 봇.
// 사용: node scripts/balance/battery-sim.mjs [반복 수=300] [cps=1.45 — 방전봇과 비슷한 실력이라 판세가 한쪽으로 쏠리지 않음]
import { BatteryEngine, BATTERY_ITEMS } from '../../public/js/battery-engine.js';
import { getTokenPool } from '../../public/js/tokens.js';
import { RARITY_ORDER } from '../../public/js/item-rarity.js';

const runs = Number(process.argv[2] ?? 300);
const playerCps = Number(process.argv[3] ?? 1.45);
const STEP_MS = 50, GIVE_AT = 6, HORIZON = 40;
const tokenPool = getTokenPool('python');

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}

// 플레이어 봇: 닿을 만한 아이템이 있으면 짧은 것부터(30%는 그냥 공격), 없으면 방전봇 탑 낱말
function createBot(engine, random) {
  const bot = { targetId: null, text: '', index: 0, nextAt: 0.4 };
  const choose = () => {
    const speed = engine.itemSpeed();
    const items = engine.items.filter(item => !item.consumed && item.trapOwner !== 'me' && !(item.trapOwner === 'rival' && random() < 0.5)).filter(item => {
      const remaining = item.direction > 0 ? 1.1 - item.x : item.x + 0.1;
      return remaining / speed > item.token.text.length / playerCps + 0.3;
    });
    const attack = !items.length || random() < 0.3;
    const target = attack ? (engine.gameTime >= engine.hiddenUntil ? engine.rivalWord : null) : items.sort((a, b) => a.token.text.length - b.token.text.length)[0];
    if (!target) return;
    bot.targetId = target.id;
    bot.text = target.token.text;
    bot.index = 0;
  };
  return (now) => {
    if (engine.status !== 'running' || now < bot.nextAt) return;
    const target = bot.targetId == null ? null : engine.findEntity(bot.targetId);
    if (bot.targetId != null && (!target || target.consumed || target.token?.text !== bot.text)) {
      engine.clearInput(now * 1000);
      bot.targetId = null;
    }
    if (bot.targetId == null) {
      choose();
      bot.nextAt = now + 0.35;
      return;
    }
    engine.input(bot.text[bot.index], now * 1000);
    bot.index++;
    bot.nextAt = now + 1 / playerCps;
    if (bot.index >= bot.text.length) {
      bot.targetId = null;
      bot.nextAt = now + 0.35;
    }
  };
}

function play(seed, give) {
  const engine = new BatteryEngine({ tokenPool, level: 2, random: seeded(seed) });
  engine.itemPool = ['cell'];
  engine.checkOutcome = () => null;
  const bot = createBot(engine, seeded(seed * 7 + 3));
  engine.start(0);
  let given = false;
  for (let ms = 0; ms <= (GIVE_AT + HORIZON) * 1000; ms += STEP_MS) {
    engine.update(ms);
    const now = engine.gameTime;
    if (!given && now >= GIVE_AT) {
      given = true;
      if (give) {
        const fake = { id: -1, kind: 'item', item: give.item, rarity: give.rarity, token: { text: 'x' } };
        engine.applyItem(engine.me, engine.rival, fake);
      }
    }
    bot(now);
    // 8칸 상한·0칸에 안 걸리게 두 탑을 같은 만큼 옮겨 평균을 4칸에 둔다(차이는 그대로)
    const shift = (engine.me.cells + engine.rival.cells) / 2 - 4;
    engine.me.cells -= shift;
    engine.rival.cells -= shift;
  }
  if (process.env.DEBUG) console.log(seed, engine.me.cells.toFixed(2), engine.rival.cells.toFixed(2), engine.drains, engine.itemsCollected);
  return engine.me.cells - engine.rival.cells;
}

const items = Object.keys(BATTERY_ITEMS).filter(key => key !== 'cell');
const control = Array.from({ length: runs }, (_, seed) => play(seed + 1, null));
const rows = [];
for (const item of ['cell', ...items]) {
  const row = { item };
  for (const rarity of item === 'cell' ? ['common'] : RARITY_ORDER) {
    let total = 0;
    for (let seed = 0; seed < runs; seed++) total += play(seed + 1, { item, rarity }) - control[seed];
    row[rarity] = +(total / runs).toFixed(2);
  }
  rows.push(row);
}
console.table(rows);
