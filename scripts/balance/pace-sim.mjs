// 모드별 '평균적인 사람'의 판 길이·게임 속 타수·포인트를 잰다(포인트 보상 조정용).
// 사용: node scripts/balance/pace-sim.mjs [반복 수=12]
import { DefenseEngine } from '../../public/js/defense-engine.js';
import { ThrowEngine } from '../../public/js/throw-engine.js';
import { BatteryEngine } from '../../public/js/battery-engine.js';
import { getTokenPool } from '../../public/js/tokens.js';
import { rewardBreakdown } from '../../public/js/rewards.js';
import { createHumanPlayer, samplePerson, pickByPriority } from './human-player.mjs';

const runs = Number(process.argv[2] ?? 12);
const tokenPool = getTokenPool('javascript');
const seeded = seed => { let state = seed >>> 0; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; }; };
const ENGINES = {
  defense: (level, random) => new DefenseEngine({ tokenPool, level, random, randomMap: true, cards: true, maxTokenLength: 16 }),
  throw: (level, random) => new ThrowEngine({ tokenPool, level, random, specials: true }),
  battery: (level, random) => new BatteryEngine({ tokenPool, level, random, persona: 'rusher', deck: ['powerbank', 'eco', 'heat', 'blackout'], weather: 'calm' })
};

function play(mode, level, seed) {
  const engine = ENGINES[mode](level, seeded(seed));
  const person = samplePerson(seeded(seed * 31 + 7));
  const player = createHumanPlayer(engine, person, seeded(seed * 17 + 1), mode === 'defense' ? {} : { pickTarget: pickByPriority, shop: false });
  engine.start(0);
  for (let ms = 0; ms < 40 * 60 * 1000 && engine.status === 'running'; ms += 50) {
    engine.update(ms);
    if (engine.phase === 'draft') { engine.chooseCard(player.chooseCard(engine.draft.hand)); continue; }
    player.tick(engine.gameTime);
  }
  const summary = engine.summary();
  const reward = rewardBreakdown(summary);
  // 반복 플레이 기준(첫 클리어 보너스 제외)
  return { minutes: engine.gameTime / 60, cpm: summary.charactersPerMinute, points: reward.total - reward.firstClearBonus, cleared: reward.cleared };
}

const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const rows = [];
for (const mode of Object.keys(ENGINES)) {
  for (const level of [1, 2, 3, 4]) {
    const results = Array.from({ length: runs }, (_, seed) => play(mode, level, seed + 1));
    const minutes = average(results.map(result => result.minutes));
    const points = average(results.map(result => result.points));
    rows.push({ mode, level, 분: +minutes.toFixed(1), 타수: Math.round(average(results.map(result => result.cpm))), 클리어: `${Math.round(average(results.map(result => (result.cleared ? 1 : 0))) * 100)}%`, 포인트: Math.round(points), 분당: Math.round(points / Math.max(0.1, minutes)) });
  }
}
console.table(rows);
