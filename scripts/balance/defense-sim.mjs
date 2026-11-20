// 컴퓨터 디펜스 카드 가치 측정: 같은 시드로 여러 판을 돌려, 첫 카드(3웨이브 뒤)만 바꿔 끼우고
// 끝까지 버틴 정도(막은 웨이브 + 남은 체력 비율)를 '첫 카드 없음(효과 없는 카드)'과 비교한다.
// 플레이어는 human-player.mjs의 '평균적인 사람' 봇(연구 자료 기반 타자 속도·오타·마우스 시간·운영 습관).
// 두 번째 고르기부터는 봇이 사람처럼(등급·화려함에 끌리게) 고른다.
// 사용: node scripts/balance/defense-sim.mjs [반복 수=80] [카드 id들(쉼표)]
//   환경 변수: LEVEL(기본 2, 측정엔 3 권장 — 평균인 사람이 절반쯤 다 막는 난이도) PROFILE(population=사람마다 실력 뽑기 | average | casual) WORKERS
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DefenseEngine } from '../../public/js/defense-engine.js';
import { DEFENSE_CARDS, cardById } from '../../public/js/defense-cards.js';
import { createHumanPlayer, samplePerson, PROFILES } from './human-player.mjs';
import { getTokenPool } from '../../public/js/tokens.js';

const NEUTRAL = 'leaderboard';

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
}

function play(seed, firstCard, { level, profile, tokenPool }) {
  const engine = new DefenseEngine({ tokenPool, level, random: seeded(seed), randomMap: true, cards: true, maxTokenLength: 16 });
  // 사람은 시드마다 한 명(두 비교 판에서 같은 사람), 엔진과 다른 난수를 쓴다
  const personRandom = seeded(seed * 7919 + 17);
  const person = profile === 'population' ? samplePerson(personRandom) : PROFILES[profile];
  const player = createHumanPlayer(engine, person, seeded(seed * 104729 + 3));
  engine.start(0);
  let drafts = 0;
  for (let ms = 0; ms < 30 * 60 * 1000 && engine.status === 'running'; ms += 50) {
    engine.update(ms);
    if (engine.phase === 'draft') {
      drafts++;
      if (drafts === 1) engine.draft.hand = [firstCard];
      engine.chooseCard(drafts === 1 ? 0 : player.chooseCard(engine.draft.hand));
      continue;
    }
    player.tick(engine.gameTime);
  }
  return { score: engine.wavesCleared + Math.max(0, engine.health) / engine.maxHealth, wpm: person.wpm, cpm: engine.summary().charactersPerMinute };
}

// 일꾼: 받은 (카드, 시드) 묶음을 돌려 결과 배열을 돌려준다
if (!isMainThread) {
  const options = { ...workerData.options, tokenPool: getTokenPool('python') };
  parentPort.postMessage(workerData.jobs.map(([card, seed]) => play(seed, card, options)));
} else {
  const runs = Number(process.argv[2] ?? 80);
  const only = process.argv[3] ? process.argv[3].split(',') : null;
  const options = { level: Number(process.env.LEVEL ?? 2), profile: process.env.PROFILE ?? 'population' };
  const cards = [NEUTRAL, ...DEFENSE_CARDS.map(card => card.id).filter(id => id !== NEUTRAL && (!only || only.includes(id)))];
  const jobs = cards.flatMap(card => Array.from({ length: runs }, (_, seed) => [card, seed + 1]));
  const workers = Math.max(1, Number(process.env.WORKERS ?? cpus().length));
  const chunk = Math.ceil(jobs.length / workers);
  const parts = await Promise.all(Array.from({ length: workers }, (_, part) => new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: jobs.slice(part * chunk, (part + 1) * chunk), options } });
    worker.once('message', resolve);
    worker.once('error', reject);
  })));
  const results = parts.flat();
  const outcome = new Map(cards.map(card => [card, []]));
  jobs.forEach(([card], position) => outcome.get(card).push(results[position]));
  const neutral = outcome.get(NEUTRAL).map(result => result.score);
  const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const people = outcome.get(NEUTRAL);
  console.log(`Lv.${options.level} · 사람: ${options.profile} (평균 ${average(people.map(p => p.wpm)).toFixed(0)} WPM, 게임 속 실제 ${average(people.map(p => p.cpm)).toFixed(0)}타) · ${runs}판씩 · 첫 카드 없음 평균 ${average(neutral).toFixed(2)}웨이브, 다 막은 판 ${(people.filter(p => p.score >= 25).length / runs * 100).toFixed(0)}%`);
  if (process.env.DEBUG) console.log(neutral.map(value => value.toFixed(1)).join(' '));
  const rows = cards.filter(card => card !== NEUTRAL).map(card => {
    const deltas = outcome.get(card).map((result, seed) => result.score - neutral[seed]);
    const mean = average(deltas);
    const spread = Math.sqrt(average(deltas.map(delta => (delta - mean) ** 2)) / deltas.length);
    return { id: card, rarity: cardById(card).rarity, gain: +mean.toFixed(2), error: +spread.toFixed(2) };
  });
  console.table(rows);
  const byRarity = {};
  for (const row of rows) (byRarity[row.rarity] ??= []).push(row.gain);
  console.table(Object.fromEntries(Object.entries(byRarity).map(([rarity, gains]) => [rarity, { cards: gains.length, mean: +average(gains).toFixed(2) }])));
}
