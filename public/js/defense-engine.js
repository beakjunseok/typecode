// 컴퓨터 디펜스: 해킹 공격(패킷·스팸 메일·악성 파일·랜섬웨어)이 지그재그 길을 따라 아래 컴퓨터로 온다.
// 막는 건 타워뿐이다. 오른쪽(휴대폰은 아래)에 연습 모드처럼 낱말이 차례로 올라오고, 낱말 하나를 칠 때마다 코인을 번다.
// 그 코인으로 상점에서 타워를 골라(누르거나 숫자 1~3, 수리는 4) 길이 아닌 곳 어디든(크기가 들어가면) 세운다. 같은 타워를 누르면 업그레이드.
// 웨이브 1~10. 4웨이브부터 길을 무시하고 날아오는 공중 공격(드론)이 섞이는데, 이건 요격포만 맞힌다.
// 5웨이브 끝에 랜섬웨어, 10웨이브 끝에 루트킷 보스. 둘 다 체력 절반에서 2페이즈로 변한다.
// 웨이브마다 배경음악 BPM이 오르고(110→137), 컴퓨터 체력이 30% 아래면 음악이 먹먹해진다(로우패스).
// 수치 근거(조사 보고서): 단어 코인 (2+글자 수)×웨이브 배율×콤보 배율, 웨이브 보너스 50+25×웨이브(무피해 +30%),
// 난이도별 상점가 ×0.85/1/1.08/1.2(Bloons TD 6), 체력 150/100/80/60%.
import { TargetGameEngine, ARCADE_RULES, randomBetween } from './target-game.js';
import { SCORING, MAX_MULTIPLIER } from './engine.js';

export const DEFENSE_RULES = Object.freeze({
  waves: 25,
  // 보스가 나오는 웨이브(그 웨이브 졸개를 다 내보낸 뒤). 다시 나올 때마다 체력이 커진다(bossHpGrowth: 처음 나온 웨이브부터 웨이브당 +8%)
  bossWaves: Object.freeze({ 5: 'ransomware', 10: 'rootkit', 15: 'ransomware', 20: 'rootkit', 25: 'rootkit' }),
  bossHpGrowth: 0.08,
  // 보스 2페이즈로 바뀔 때 잠깐 무적(초)
  phaseShieldSeconds: 1.5,
  introSeconds: 2.4,
  breakSeconds: 4,
  winPauseSeconds: 1.4,
  // 웨이브 n의 공격 수 = base + step × (n - 1) (+ 보스 웨이브면 보스 1)
  bugsPerWave: Object.freeze({ base: 6, step: 1.5 }),
  // 등장 간격(초) = max(min, start - step × (n - 1)) × 난이도 등장 배율
  spawnInterval: Object.freeze({ start: 3, step: 0.2, min: 0.9 }),
  // 레벨(1~4)별: 시작 BPM, 컴퓨터 최대 체력, 상점가 배율
  bpmBase: Object.freeze({ 1: 100, 2: 110, 3: 120, 4: 130 }),
  bpmStep: 2,
  maxHealth: Object.freeze({ 1: 150, 2: 100, 3: 80, 4: 60 }),
  priceFactor: Object.freeze({ 1: 0.85, 2: 1, 3: 1.08, 4: 1.2 }),
  dangerRatio: 0.3,
  startCoins: 150,
  // 화면에 미리 보여 줄 낱말 수(지금 칠 낱말 포함)
  streamLength: 6,
  // 공격 체력은 웨이브가 hpEveryWaves개 오를 때마다 +1(타워만으로 막으므로 웨이브가 갈수록 단단해진다)
  hpEveryWaves: 3,
  // 단어 코인 = round((wordBase + 글자 수) × (1 + waveStep × (웨이브 - 1)) × 콤보 배율)
  wordCoins: Object.freeze({ wordBase: 2, waveStep: 0.25 }),
  comboCoinSteps: Object.freeze([[30, 2], [20, 1.5], [10, 1.2]]),
  waveBonus: Object.freeze({ base: 50, perWave: 25, noDamageFactor: 1.3 }),
  waveScore: 200,
  repairAmount: 25,
  maxTowers: 20,
  maxTowerLevel: 3,
  // 키보드용 추천 자리 수
  suggestions: 5,
  // 설치 모드: 이 시간 안에 자리를 고르지 않으면 취소
  buildModeSeconds: 15
});

// 길(화면 들판을 0~1로 본 좌표): 왼쪽 위에서 들어와 지그재그로 내려가, 컴퓨터 바로 위(방패 돔 꼭대기)에서 끝난다.
// 길이 컴퓨터를 덮지 않도록 컴퓨터는 길 끝보다 아래(DEFENSE_COMPUTER)에 따로 둔다
export const DEFENSE_PATH = Object.freeze([
  [0.08, 0], [0.08, 0.16], [0.92, 0.16], [0.92, 0.38], [0.08, 0.38], [0.08, 0.58], [0.5, 0.58]
].map(([x, y]) => Object.freeze({ x, y })));
export const DEFENSE_COMPUTER = Object.freeze({ x: 0.5, y: 0.84 });
// 컴퓨터 대공 포탑(돔 꼭대기): 가까이 온 공중 적에게 코드 조각(방금 친 낱말)을 던진다. 날아가 닿는 순간 피해. 최후 방어선
export const COMPUTER_GUARD = Object.freeze({ x: 0.5, y: 0.7, range: 0.24, cooldown: 1.6, damage: 1, flightSeconds: 0.32, snippets: Object.freeze(['patch()', '{ }', 'fix;', '0x1F', 'kill -9', '</>']) });
// 가디언 봇(컴퓨터 Lv.3에서 출동): 컴퓨터 둘레 leash 안의 가장 가까운 적에게 달려가 reach 안에서 cooldown마다 피해.
// 적이 없으면 컴퓨터 앞(home)으로 돌아온다. 무적. 가로 거리는 0.6으로 나눠 잰다(들판이 가로로 넓어서)
// 붙잡은 지상 졸개(보스 제외)는 걸음을 멈추고 봇과 싸운다. 붙어 있는 지상 적은 biteEvery초마다 봇을 때린다(enemyHit: 종류별 세기).
// 체력이 0이면 쓰러졌다가 respawnSeconds 뒤 다시 출동, 집에서 쉬면 초당 regen 회복
export const GUARDIAN = Object.freeze({
  home: Object.freeze({ x: 0.5, y: 0.66 }), leash: 0.4, speed: 0.22, reach: 0.045, airReach: 0.07, cooldown: 0.7, damage: 1,
  maxHp: 40, regen: 3, respawnSeconds: 8, biteEvery: 1, biteWindup: 0.5, biteReach: 0.06,
  enemyHit: Object.freeze({ packet: 2, spam: 2, malware: 3, drone: 0, ransomware: 8, rootkit: 8 })
});
// 컴퓨터 강화(Lv.1~3): 대공 사거리·간격·동시 표적, 최대 체력 보너스, 초당 자동 복구. price = 그 레벨로 올리는 값(난이도 배율 적용)
export const COMPUTER_LEVELS = Object.freeze([
  null,
  Object.freeze({ range: 0.24, cooldown: 1.6, shots: 1, bonusHealth: 0, regen: 0, price: 0 }),
  Object.freeze({ range: 0.3, cooldown: 1.2, shots: 1, bonusHealth: 25, regen: 0, price: 250 }),
  Object.freeze({ range: 0.36, cooldown: 0.9, shots: 2, bonusHealth: 50, regen: 0.5, price: 450, perk: '2발 동시 + 자동 복구' })
]);

// 설치 규칙(들판 좌표, 가로·세로 반지름이 다른 타원으로 잰다): 길과 띄울 거리, 타워끼리 띄울 거리, 컴퓨터 둘레
// 자유 배치(BTD6식): 판정은 그림보다 작게. 길은 (길 반폭 + 타워 판정 0.7배)까지만 막아 가장자리에 붙여 놓을 수 있고,
// 타워끼리는 15% 겹쳐도 되며, 컴퓨터는 책상·모니터 자체만 막는다(주변 여백 없음). 못 놓는 곳은 가장 가까운 빈자리로 밀어 준다
export const PLACEMENT = Object.freeze({
  pathClear: Object.freeze({ x: 0.035, y: 0.055 }),
  towerGap: Object.freeze({ x: 0.04, y: 0.065 }),
  tapRadius: Object.freeze({ x: 0.045, y: 0.08 }),
  computerZone: Object.freeze({ x: 0.5, y: 0.87, rx: 0.08, ry: 0.1 }),
  margin: 0.015,
  nudgeRadius: 0.12,
  sellRefund: 0.7
});

// 길 위 비율 s(0~1) → 좌표. 구간 길이를 미리 재 두고 선형 보간. O(구간 수)
const PATH_SEGMENTS = DEFENSE_PATH.slice(1).map((point, index) => {
  const from = DEFENSE_PATH[index];
  return { from, to: point, length: Math.hypot(point.x - from.x, point.y - from.y) };
});
export const PATH_LENGTH = PATH_SEGMENTS.reduce((sum, segment) => sum + segment.length, 0);
export function pointOnPath(progress) {
  let remaining = Math.max(0, Math.min(1, progress)) * PATH_LENGTH;
  for (const segment of PATH_SEGMENTS) {
    if (remaining <= segment.length) {
      const ratio = segment.length ? remaining / segment.length : 0;
      return { x: segment.from.x + (segment.to.x - segment.from.x) * ratio, y: segment.from.y + (segment.to.y - segment.from.y) * ratio };
    }
    remaining -= segment.length;
  }
  return { ...DEFENSE_PATH.at(-1) };
}

// 공격 종류: hp = 맞혀야 하는 횟수(타워 한 방 = 1), speed = 초당 가는 비율(0→1),
// damage = 컴퓨터에 닿으면 깎이는 체력, bounty = 처치 점수, towerCoins = 잡았을 때 코인.
// air: 길을 무시하고 위에서 컴퓨터로 곧장 날아온다(요격포만 맞힌다).
// phaseTwo(보스): 체력이 at 비율 이하가 되면 2페이즈 — 속도 ×speedFactor, every초마다 summon 소환, lockEvery초마다 가장 가까운 타워를 lockSeconds초 잠금
export const ATTACK_TYPES = Object.freeze({
  packet: Object.freeze({ label: '해킹 패킷', hp: 1, speed: 0.04, damage: 10, bounty: 50, towerCoins: 1, fromWave: 1, weight: 1 }),
  spam: Object.freeze({ label: '스팸 메일', hp: 1, speed: 0.07, damage: 8, bounty: 70, towerCoins: 1, fromWave: 2, weight: 0.5 }),
  malware: Object.freeze({ label: '악성 파일', hp: 2, speed: 0.03, damage: 15, bounty: 120, towerCoins: 2, fromWave: 3, weight: 0.35 }),
  drone: Object.freeze({ label: '스파이웨어 드론', hp: 2, speed: 0.055, damage: 12, bounty: 90, towerCoins: 2, fromWave: 4, weight: 0.4, air: true }),
  ransomware: Object.freeze({
    label: '랜섬웨어', hp: 40, speed: 0.016, damage: 40, bounty: 800, towerCoins: 60, fromWave: Infinity, weight: 0, boss: true,
    phaseTwo: Object.freeze({ at: 0.5, label: '암호화 폭주', speedFactor: 1.7, summon: 'packet', summonCount: 2, every: 5, lockEvery: 6, lockSeconds: 3 })
  }),
  rootkit: Object.freeze({
    label: '루트킷', hp: 90, speed: 0.014, damage: 60, bounty: 2000, towerCoins: 120, fromWave: Infinity, weight: 0, boss: true,
    phaseTwo: Object.freeze({ at: 0.5, label: '권한 탈취', speedFactor: 1.5, summon: 'drone', summonCount: 3, every: 6, lockEvery: 5, lockSeconds: 3 })
  })
});
export const BUG_TYPES = ATTACK_TYPES;

// 타워: 쏘는 간격(초), 사거리(화면 비율), 감속(사거리 안 공격 속도 배율), 맞히는 대상(ground: 지상 / all: 공중+지상), 한 발 피해.
// 방화벽 = 약한 한 발 + 화상(burn: 초당 피해 × 초) + 사거리 감속, 허니팟 = 길에 끈끈이 웅덩이(puddle: 감속 + 광역 초당 피해),
// 백신 = 지상 가성비(코인당 화력 최고), 요격포 = 사거리·화력·공중 모두 위지만 가장 비쌈. 강화는 TOWER_LEVELS
export const TOWER_TYPES = Object.freeze({
  firewall: Object.freeze({ label: '방화벽', word: 'firewall', price: 120, cooldown: 3, range: 0.26, slow: 0.65, targets: 'ground', damage: 0.6, burn: Object.freeze({ seconds: 2.5, dps: 0.4 }) }),
  honeypot: Object.freeze({ label: '허니팟', word: 'honeypot', price: 150, cooldown: 3.5, range: 0.3, slow: 1, targets: 'ground', damage: 0, puddle: Object.freeze({ radius: 0.07, seconds: 4, slow: 0.35, dps: 0.5, stepDamage: 0.5 }) }),
  antivirus: Object.freeze({ label: '백신', word: 'antivirus', price: 200, cooldown: 1.5, range: 0.32, slow: 1, targets: 'ground', damage: 1 }),
  emp: Object.freeze({ label: 'EMP포', word: 'emp', price: 250, cooldown: 2.4, range: 0.34, slow: 1, targets: 'ground', damage: 1, splash: 0.085, airJam: Object.freeze({ seconds: 2.5, slow: 0.5, damageFactor: 0.5 }) }),
  interceptor: Object.freeze({ label: '요격포', word: 'interceptor', price: 300, cooldown: 1.1, range: 0.44, slow: 1, targets: 'all', damage: 1 })
});
// 강화 단계(Lv.1~3): 사거리 더하기, 쏘는 간격 배율. Lv.3은 타워별 특수 능력(TOWER_MAX_PERKS)
export const TOWER_LEVELS = Object.freeze([
  null,
  Object.freeze({ range: 0, cooldown: 1 }),
  Object.freeze({ range: 0.04, cooldown: 0.78 }),
  Object.freeze({ range: 0.08, cooldown: 0.6 })
]);
// Lv.3 특수 능력: 방화벽 = 감속 0.45 · 허니팟 = 웅덩이 감속 0.3 · 백신 = 한 발에 2 피해 · 요격포 = 두 표적 동시 발사
export const TOWER_MAX_PERKS = Object.freeze({
  firewall: Object.freeze({ slow: 0.45, label: '강한 감속' }),
  honeypot: Object.freeze({ puddleSlow: 0.2, label: '초강력 끈끈이' }),
  antivirus: Object.freeze({ damage: 2, label: '2배 피해' }),
  emp: Object.freeze({ splashFactor: 1.5, label: '광역 EMP' }),
  interceptor: Object.freeze({ shots: 2, label: '2발 동시 발사' })
});

// 이 레벨 타워의 능력치(사거리·간격·감속·피해·발사 수). O(1)
export function towerStats(type, level) {
  const config = TOWER_TYPES[type];
  const step = TOWER_LEVELS[Math.max(1, Math.min(DEFENSE_RULES.maxTowerLevel, level))];
  const perk = level >= DEFENSE_RULES.maxTowerLevel ? TOWER_MAX_PERKS[type] ?? {} : {};
  const slow = config.slow < 1 ? (perk.slow ?? config.slow - 0.05 * (level - 1)) : 1;
  const grow = 1 + 0.3 * (level - 1);
  const burn = config.burn ? { seconds: config.burn.seconds, dps: config.burn.dps * grow } : null;
  const puddle = config.puddle
    ? { radius: config.puddle.radius * (1 + 0.15 * (level - 1)), seconds: config.puddle.seconds + (level - 1), slow: perk.puddleSlow ?? config.puddle.slow, dps: config.puddle.dps * grow, stepDamage: config.puddle.stepDamage * grow }
    : null;
  const splash = config.splash ? config.splash * (1 + 0.1 * (level - 1)) * (perk.splashFactor ?? 1) : 0;
  return { range: config.range + step.range, cooldown: config.cooldown * step.cooldown, slow, damage: perk.damage ?? config.damage ?? 1, shots: perk.shots ?? 1, burn, puddle, splash };
}

export const SHOP_ITEMS = Object.freeze({
  firewall: Object.freeze({ kind: 'tower', tower: 'firewall', word: 'firewall' }),
  honeypot: Object.freeze({ kind: 'tower', tower: 'honeypot', word: 'honeypot' }),
  antivirus: Object.freeze({ kind: 'tower', tower: 'antivirus', word: 'antivirus' }),
  emp: Object.freeze({ kind: 'tower', tower: 'emp', word: 'emp' }),
  interceptor: Object.freeze({ kind: 'tower', tower: 'interceptor', word: 'interceptor' }),
  patch: Object.freeze({ kind: 'repair', word: 'patch', price: 80 })
});

// 공중 공격이 출발하는 위(들판 y = 0)의 x 후보: 길 입구와 겹치지 않게 가운데·오른쪽 위주
const AIR_LANES = Object.freeze([0.3, 0.5, 0.7, 0.88]);

// 점과 선분 사이 거리(타원 단위: x는 rx, y는 ry로 나눠 잰다). O(1)
function ellipseDistanceToSegment(point, from, to, radii) {
  const px = point.x / radii.x, py = point.y / radii.y;
  const ax = from.x / radii.x, ay = from.y / radii.y, bx = to.x / radii.x, by = to.y / radii.y;
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// 길 위(또는 길에 너무 가까운) 점인가. O(구간 수)
export function isOnPath(point) {
  return PATH_SEGMENTS.some(segment => ellipseDistanceToSegment(point, segment.from, segment.to, PLACEMENT.pathClear) < 1);
}

// 키보드 추천 자리 후보: 0.07 간격 격자 중 길·컴퓨터를 피한 곳, 길을 많이 덮는(사거리 안 길 표본이 많은) 순.
// 처음 한 번만 계산한다. O(격자 수 × 길 표본 수)
const PATH_SAMPLES = Array.from({ length: 80 }, (_, index) => pointOnPath(index / 79));
const CANDIDATE_SPOTS = (() => {
  const candidates = [];
  for (let y = 0.06; y <= 0.95; y += 0.07) {
    for (let x = 0.06; x <= 0.95; x += 0.07) {
      const point = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
      if (isOnPath(point) || inComputerZone(point)) continue;
      const coverage = PATH_SAMPLES.filter(sample => Math.hypot(sample.x - point.x, sample.y - point.y) <= 0.26).length;
      candidates.push({ ...point, coverage });
    }
  }
  return Object.freeze(candidates.sort((first, second) => second.coverage - first.coverage));
})();

function inComputerZone(point) {
  const zone = PLACEMENT.computerZone;
  return ((point.x - zone.x) / zone.rx) ** 2 + ((point.y - zone.y) / zone.ry) ** 2 < 1;
}

// 웨이브 BPM: 레벨 시작 BPM + 5 × (웨이브 - 1). O(1)
// 보스 체력: 기본 × (1 + bossHpGrowth × (이 웨이브 - 그 보스가 처음 나오는 웨이브)). 정수. O(보스 웨이브 수)
export function bossHp(typeKey, wave) {
  const firstWave = Math.min(...Object.entries(DEFENSE_RULES.bossWaves).filter(([, key]) => key === typeKey).map(([number]) => Number(number)));
  const extra = Number.isFinite(firstWave) ? Math.max(0, wave - firstWave) : 0;
  return Math.round(ATTACK_TYPES[typeKey].hp * (1 + DEFENSE_RULES.bossHpGrowth * extra));
}

export function bpmForWave(level, wave) {
  const base = DEFENSE_RULES.bpmBase[level] ?? DEFENSE_RULES.bpmBase[2];
  const safeWave = Math.min(DEFENSE_RULES.waves, Math.max(1, Math.floor(wave) || 1));
  return base + DEFENSE_RULES.bpmStep * (safeWave - 1);
}

// 콤보에 따른 코인 배율(10·20·30연속에서 ×1.2·×1.5·×2, 오타면 콤보가 0이라 ×1). O(1)
export function comboCoinFactor(combo) {
  return DEFENSE_RULES.comboCoinSteps.find(([minimum]) => combo >= minimum)?.[1] ?? 1;
}

// 버그 낱말 하나를 맞혔을 때 코인. O(1)
export function wordCoins(length, wave, combo) {
  const { wordBase, waveStep } = DEFENSE_RULES.wordCoins;
  return Math.round((wordBase + Math.max(0, length)) * (1 + waveStep * (Math.max(1, wave) - 1)) * comboCoinFactor(combo));
}

// 웨이브 클리어 코인: 50 + 25 × 웨이브, 그 웨이브에 피해가 없었으면 ×1.3. O(1)
export function waveBonusCoins(wave, tookDamage) {
  const { base, perWave, noDamageFactor } = DEFENSE_RULES.waveBonus;
  return Math.round((base + perWave * wave) * (tookDamage ? 1 : noDamageFactor));
}

// 서버 점수 검증용 상한: 글자당 최대 타격 점수 + 버그 처치 점수 / 최소 낱말 길이 + 웨이브 보너스(낱말 수로 나눔)
export const MAX_POINTS_PER_CHARACTER = SCORING.basePoints * MAX_MULTIPLIER
  + Math.max(...Object.values(BUG_TYPES).map(type => type.bounty)) / ARCADE_RULES.minTokenLength
  + DEFENSE_RULES.waveScore * DEFENSE_RULES.waves / DEFENSE_RULES.bugsPerWave.base;

export class DefenseEngine extends TargetGameEngine {
  constructor(options) {
    super({ ...options, mode: 'defense' });
    this.lives = 1;
    this.maxHealth = DEFENSE_RULES.maxHealth[this.level];
    this.health = this.maxHealth;
    this.computerLevel = 1;
    this.coins = DEFENSE_RULES.startCoins;
    this.coinsEarned = 0;
    this.bugs = [];
    this.towers = [];
    this.towerShots = [];
    this.guardShots = [];
    this.guardReadyAt = 0;
    this.puddles = [];
    this.wave = 1;
    this.wavesCleared = 0;
    this.phase = 'intro';
    this.phaseUntil = DEFENSE_RULES.introSeconds;
    this.waveSpawned = 0;
    this.waveTotal = this.bugsInWave(1);
    this.waveKilled = 0;
    this.waveTookDamage = false;
    this.noDamageWaves = 0;
    this.summoned = 0;
    this.bossSpawned = false;
    this.airWarned = false;
    this.nextSpawnAt = Infinity;
    this.kills = Object.fromEntries(Object.keys(BUG_TYPES).map(type => [type, 0]));
    this.towersBuilt = 0;
    this.outcome = null;
    this.winAt = null;
    this.buildMode = null;
    this.spots = [];
    this.shop = Object.entries(SHOP_ITEMS).map(([key, item], index) => ({ id: this.nextId++, kind: 'shop', item: key, hotkey: String(index + 1) }));
    this.wordsTyped = 0;
    this.stream = [];
    this.refillStream();
  }

  // ---------- 목표 ----------
  targetables() {
    return this.stream.length ? [this.stream[0]] : [];
  }

  findEntity(id) {
    return this.stream.find(word => word.id === id) ?? this.bugs.find(bug => bug.id === id) ?? this.shop.find(item => item.id === id) ?? this.spots.find(spot => spot.id === id) ?? null;
  }

  // 컴퓨터에 가까운(길을 많이 간) 공격부터, 설치 자리, 상점 낱말 순
  targetPriority(entity) {
    if (entity.kind === 'shop') return 10;
    if (entity.kind === 'spot') return 5;
    return 1 - entity.progress;
  }

  currentWeapon() {
    return 'patch';
  }

  // ---------- 값 ----------
  bpm() {
    return bpmForWave(this.level, this.wave);
  }

  priceOf(itemKey) {
    const item = SHOP_ITEMS[itemKey];
    if (!item) return Infinity;
    const factor = DEFENSE_RULES.priceFactor[this.level] ?? 1;
    if (item.kind === 'repair') return Math.round(item.price * factor);
    if (this.canBuildNew()) return this.priceAt(item.tower, null);
    const upgradable = this.upgradableTowers(item.tower);
    return upgradable.length ? Math.min(...upgradable.map(tower => this.priceAt(item.tower, tower))) : Infinity;
  }

  isDanger() {
    return this.health / this.maxHealth < DEFENSE_RULES.dangerRatio;
  }

  bugsInWave(wave) {
    return Math.round(DEFENSE_RULES.bugsPerWave.base + DEFENSE_RULES.bugsPerWave.step * (wave - 1)) + (DEFENSE_RULES.bossWaves[wave] ? 1 : 0);
  }

  // ---------- 진행 ----------
  step(frameSeconds) {
    if (this.winAt != null) {
      if (this.gameTime >= this.winAt) this.finish();
      return;
    }
    this.towerShots = this.towerShots.filter(shot => this.gameTime - shot.at < 0.3);
    this.guardShots = this.guardShots.filter(shot => this.gameTime - shot.at < COMPUTER_GUARD.flightSeconds + 0.35);
    if (this.buildMode && this.gameTime >= this.buildMode.until && this.targetId == null) this.cancelBuild('timeout');
    this.advancePhase();
    this.spawnIfDue();
    this.moveBugs(frameSeconds);
    if (this.status !== 'running') return;
    this.applyLingeringDamage(frameSeconds);
    if (this.status !== 'running') return;
    this.runBossSkills();
    this.fireTowers();
    if (this.status !== 'running') return;
    this.fireGuard();
    this.landGuardShots();
    if (this.status !== 'running') return;
    this.updateGuardian(frameSeconds);
    this.bugs = this.bugs.filter(bug => bug.state === 'alive' || this.gameTime - bug.resolvedAt < 0.8);
    this.checkWaveClear();
  }

  advancePhase() {
    if (this.gameTime < this.phaseUntil) return;
    if (this.phase === 'intro') {
      this.phase = 'spawning';
      this.phaseUntil = Infinity;
      this.nextSpawnAt = this.gameTime;
      this.emit('wave-start', { wave: this.wave, bpm: this.bpm() });
    } else if (this.phase === 'break') {
      this.startWave(this.wave + 1);
    }
  }

  startWave(wave) {
    this.wave = wave;
    this.waveSpawned = 0;
    this.waveKilled = 0;
    this.waveTotal = this.bugsInWave(wave);
    this.waveTookDamage = false;
    this.summoned = 0;
    this.bossSpawned = false;
    this.phase = 'intro';
    this.phaseUntil = this.gameTime + DEFENSE_RULES.introSeconds;
    this.emit('wave-intro', { wave, bpm: this.bpm(), boss: DEFENSE_RULES.bossWaves[wave] ?? null });
  }

  spawnInterval() {
    const { start, step, min } = DEFENSE_RULES.spawnInterval;
    return Math.max(min, start - step * (this.wave - 1)) * this.difficulty.spawn;
  }

  spawnIfDue() {
    if (this.phase !== 'spawning' || this.gameTime < this.nextSpawnAt) return;
    const boss = DEFENSE_RULES.bossWaves[this.wave];
    const regular = this.waveTotal - (boss ? 1 : 0) - this.summoned;
    if (this.waveSpawned - this.summoned < regular) {
      const type = this.chooseBugType();
      const bug = this.spawnBug(type);
      if (ATTACK_TYPES[type].air && !this.airWarned) {
        this.airWarned = true;
        this.emit('air-warning', { bug });
      }
      this.nextSpawnAt = this.gameTime + this.spawnInterval() * randomBetween(this.random, [0.8, 1.2]);
    } else if (boss && !this.bossSpawned) {
      // 보스 웨이브: 졸개를 다 내보낸 뒤 보스. 경고를 먼저 띄운다
      this.bossSpawned = true;
      const bug = this.spawnBug(boss);
      this.emit('boss-appear', { bug, boss });
    }
  }

  chooseBugType() {
    const unlocked = Object.entries(BUG_TYPES).filter(([, type]) => this.wave >= type.fromWave);
    const total = unlocked.reduce((sum, [, type]) => sum + type.weight, 0);
    let roll = this.random() * total;
    for (const [key, type] of unlocked) {
      roll -= type.weight;
      if (roll <= 0) return key;
    }
    return unlocked[unlocked.length - 1][0];
  }

  // 지상 공격은 길 입구(또는 from의 길 위치)에서, 공중 공격은 위쪽(또는 from 자리)에서 컴퓨터로 곧장
  spawnBug(typeKey, from = null) {
    const type = BUG_TYPES[typeKey];
    const air = Boolean(type.air);
    const origin = air ? (from ? { x: from.x, y: from.y } : { x: AIR_LANES[Math.floor(this.random() * AIR_LANES.length)], y: 0 }) : null;
    const progress = !air && from ? Math.max(0, Math.min(0.98, from.progress ?? 0)) : 0;
    const start = air ? origin : pointOnPath(progress);
    const bug = {
      id: this.nextId++, kind: 'bug', type: typeKey, air, origin, progress, x: start.x, y: start.y,
      hp: 0, maxHp: 0, state: 'alive', spawnedAt: this.gameTime, resolvedAt: null, wave: this.wave,
      phase: 1, shieldUntil: 0, nextSummonAt: Infinity, nextLockAt: Infinity
    };
    bug.hp = bug.maxHp = type.boss ? bossHp(typeKey, this.wave) : type.hp + Math.floor((this.wave - 1) / DEFENSE_RULES.hpEveryWaves);
    this.bugs.push(bug);
    this.waveSpawned++;
    this.emit('spawn', { bug });
    return bug;
  }

  // 방화벽 사거리 안이면 느려진다(가장 강한 감속 하나만)
  // 컴퓨터 대공 포탑: 쿨다운이 끝나면 사거리 안 공중 적 중 컴퓨터에 가장 가까운 것을 쏜다. O(적 수)
  fireGuard() {
    if (this.gameTime < this.guardReadyAt) return;
    const guard = COMPUTER_GUARD;
    const stats = this.computerStats();
    const targets = this.bugs
      .filter(bug => bug.state === 'alive' && bug.air && bug.hp > 0 && Math.hypot(bug.x - guard.x, bug.y - guard.y) <= stats.range)
      .sort((first, second) => second.progress - first.progress)
      .slice(0, stats.shots);
    if (!targets.length) return;
    this.guardReadyAt = this.gameTime + stats.cooldown;
    targets.forEach((target, index) => {
      const text = (index === 0 ? this.lastWord : null) ?? guard.snippets[Math.floor(this.random() * guard.snippets.length)];
      const shot = { id: this.nextId++, bugId: target.id, x: target.x, y: target.y, at: this.gameTime, hitAt: this.gameTime + guard.flightSeconds, text, landed: false, level: this.computerLevel };
      this.guardShots.push(shot);
      this.emit('guard-shot', { bug: target, shot });
    });
  }

  // 가디언 봇 출동: 모니터 앞에서 나타난다(0.6초 등장 연출 동안은 가만히)
  spawnGuardian() {
    const home = GUARDIAN.home;
    const respawn = Boolean(this.guardian);
    this.guardian = { x: home.x, y: home.y + 0.08, state: 'spawning', targetId: null, holdingId: null, readyAt: this.gameTime + 0.6, spawnedAt: this.gameTime, facing: 1, lastHitAt: -Infinity, lastHurtAt: -Infinity, moving: false, hp: GUARDIAN.maxHp, maxHp: GUARDIAN.maxHp, respawnAt: null };
    this.emit('guardian-spawn', { guardian: this.guardian, respawn });
  }

  // 들판 거리(가로는 0.6으로 나눔)
  fieldDistance(first, second) {
    return Math.hypot((first.x - second.x) / 0.6, first.y - second.y);
  }

  // 가디언 봇: 표적 고르기 → 다가가기 → 닿으면 때리기, 없으면 집으로. O(적 수)
  updateGuardian(frameSeconds) {
    const bot = this.guardian;
    if (!bot) return;
    if (bot.state === 'down') {
      if (this.gameTime >= bot.respawnAt) this.spawnGuardian();
      return;
    }
    if (bot.state === 'spawning') {
      if (this.gameTime < bot.readyAt) return;
      bot.state = 'idle';
    }
    if (this.guardianTakesHits()) return;
    const home = GUARDIAN.home;
    let target = this.bugs.find(bug => bug.id === bot.targetId && bug.state === 'alive');
    if (!target || this.fieldDistance(target, home) > GUARDIAN.leash) {
      target = this.bugs
        .filter(bug => bug.state === 'alive' && bug.hp > 0 && this.fieldDistance(bug, home) <= GUARDIAN.leash)
        .sort((first, second) => this.fieldDistance(first, bot) - this.fieldDistance(second, bot))[0] ?? null;
      bot.targetId = target?.id ?? null;
    }
    const goal = target ?? home;
    const distance = this.fieldDistance(goal, bot);
    const reach = target ? (target.air ? GUARDIAN.airReach : GUARDIAN.reach) : 0.005;
    bot.moving = distance > reach;
    if (bot.moving) {
      const step = Math.min(distance - reach * 0.8, GUARDIAN.speed * frameSeconds);
      const dx = (goal.x - bot.x) / 0.6, dy = goal.y - bot.y;
      const length = Math.hypot(dx, dy) || 1;
      bot.x += dx / length * step * 0.6;
      bot.y += dy / length * step;
      if (Math.abs(dx) > 1e-4) bot.facing = dx > 0 ? 1 : -1;
    }
    bot.state = target ? (bot.moving ? 'chase' : 'fight') : (bot.moving ? 'return' : 'idle');
    bot.holdingId = target && !bot.moving && !target.air && !ATTACK_TYPES[target.type].boss ? target.id : null;
    if (bot.state === 'idle') bot.hp = Math.min(bot.maxHp, bot.hp + GUARDIAN.regen * frameSeconds);
    if (target && !bot.moving && this.gameTime >= bot.readyAt) {
      bot.readyAt = this.gameTime + GUARDIAN.cooldown;
      bot.lastHitAt = this.gameTime;
      bot.lastHitAir = Boolean(target.air);
      this.emit('guardian-hit', { guardian: bot, bug: target });
      this.damageBug(target, 'guardian', GUARDIAN.damage);
    }
  }

  // 봇 옆에 붙은 지상 적이 봇을 때린다(처음 붙으면 biteWindup만큼 숨 고른 뒤, 그다음 biteEvery마다). 쓰러지면 true
  guardianTakesHits() {
    const bot = this.guardian;
    for (const bug of this.bugs) {
      if (bug.state !== 'alive' || bug.air || this.fieldDistance(bug, bot) > GUARDIAN.biteReach) {
        if (bug.nextBiteAt != null && bug.state === 'alive' && this.fieldDistance(bug, bot) > GUARDIAN.biteReach * 1.5) bug.nextBiteAt = null;
        continue;
      }
      if (bug.nextBiteAt == null) {
        bug.nextBiteAt = this.gameTime + GUARDIAN.biteWindup;
        continue;
      }
      if (this.gameTime < bug.nextBiteAt) continue;
      const damage = GUARDIAN.enemyHit[bug.type] ?? 2;
      bug.nextBiteAt = this.gameTime + GUARDIAN.biteEvery;
      bug.lastBiteAt = this.gameTime;
      bot.hp = Math.max(0, bot.hp - damage);
      bot.lastHurtAt = this.gameTime;
      this.emit('guardian-hurt', { guardian: bot, bug, damage });
      if (bot.hp <= 0) {
        bot.state = 'down';
        bot.holdingId = null;
        bot.targetId = null;
        bot.downAt = this.gameTime;
        bot.respawnAt = this.gameTime + GUARDIAN.respawnSeconds;
        this.emit('guardian-down', { guardian: bot });
        return true;
      }
    }
    return false;
  }

  // 지금 봇이 붙잡고 있어 걸음을 멈춘 지상 적인가
  isHeldByGuardian(bug) {
    const bot = this.guardian;
    return Boolean(bot && bot.state === 'fight' && bot.holdingId === bug.id);
  }

  // 지금 컴퓨터 레벨의 능력치
  computerStats(level = this.computerLevel) {
    return COMPUTER_LEVELS[Math.max(1, Math.min(COMPUTER_LEVELS.length - 1, level))];
  }

  // 컴퓨터 강화 카드 정보: 다음 레벨 능력치·가격·살 수 있는지(최고 레벨이면 next = null)
  computerUpgradeInfo() {
    const maxed = this.computerLevel >= COMPUTER_LEVELS.length - 1;
    const next = maxed ? null : this.computerStats(this.computerLevel + 1);
    const price = maxed ? null : Math.round(next.price * (DEFENSE_RULES.priceFactor[this.level] ?? 1));
    return { level: this.computerLevel, maxed, price, affordable: !maxed && this.coins >= price, current: this.computerStats(), next };
  }

  // 컴퓨터 강화: 코인을 내고 레벨 +1, 늘어난 최대 체력만큼 지금 체력도 채운다
  upgradeComputer() {
    const info = this.computerUpgradeInfo();
    if (info.maxed) {
      this.emit('place-denied', { reason: 'max-level', x: DEFENSE_COMPUTER.x, y: DEFENSE_COMPUTER.y, price: null, coins: this.coins });
      return { bought: false, reason: 'max-level' };
    }
    if (this.coins < info.price) {
      this.emit('place-denied', { reason: 'coins', x: DEFENSE_COMPUTER.x, y: DEFENSE_COMPUTER.y, price: info.price, coins: this.coins });
      return { bought: false, reason: 'coins' };
    }
    this.coins -= info.price;
    const gained = info.next.bonusHealth - info.current.bonusHealth;
    this.computerLevel += 1;
    this.maxHealth += gained;
    this.health = Math.min(this.maxHealth, this.health + gained);
    this.computerUpgradedAt = this.gameTime;
    if (this.computerLevel >= COMPUTER_LEVELS.length - 1 && !this.guardian) this.spawnGuardian();
    this.emit('computer-upgraded', { level: this.computerLevel, price: info.price, stats: info.next, maxed: this.computerLevel >= COMPUTER_LEVELS.length - 1 });
    return { bought: true, level: this.computerLevel };
  }

  // 날아간 코드 조각이 닿을 시각이 되면 피해(표적이 이미 사라졌으면 허공에서 흩어진다). 닿는 자리는 표적을 따라간다
  landGuardShots() {
    for (const shot of this.guardShots) {
      if (shot.landed) continue;
      const target = this.bugs.find(bug => bug.id === shot.bugId);
      if (target?.state === 'alive') {
        shot.x = target.x;
        shot.y = target.y;
      }
      if (this.gameTime < shot.hitAt) continue;
      shot.landed = true;
      this.emit('guard-hit', { shot, bug: target?.state === 'alive' ? target : null });
      if (target?.state === 'alive') this.damageBug(target, 'guard', COMPUTER_GUARD.damage);
      if (this.status !== 'running') return;
    }
  }

  // 지속 피해: 화상(방화벽에 맞은 뒤 몇 초) + 끈끈이 웅덩이(위에 있는 지상 적 모두).
  // 웅덩이에 처음 발을 디디면 밟음 피해를 한 번 바로 준다(맞음 알림 → 번쩍). 웅덩이는 시간이 지나면 마른다. O(적 × 웅덩이)
  applyLingeringDamage(frameSeconds) {
    this.puddles = this.puddles.filter(puddle => this.gameTime < puddle.until);
    // 컴퓨터 자동 복구(Lv.3)
    const regen = this.computerStats().regen;
    if (regen > 0 && this.health > 0) this.health = Math.min(this.maxHealth, this.health + regen * frameSeconds);
    for (const bug of this.bugs) {
      if (bug.state !== 'alive') continue;
      let damage = 0;
      if (this.gameTime < (bug.burnUntil ?? 0)) damage += (bug.burnDps ?? 0) * frameSeconds;
      const under = this.activePuddlesUnder(bug);
      bug.steppedPuddles ??= new Set();
      for (const puddle of under) {
        damage += puddle.dps * frameSeconds;
        if (!bug.steppedPuddles.has(puddle.id)) {
          bug.steppedPuddles.add(puddle.id);
          this.emit('honey-step', { bug, puddle });
          this.damageBug(bug, 'honey', puddle.stepDamage ?? 0);
          if (bug.state !== 'alive' || this.status !== 'running') break;
        }
      }
      if (bug.state === 'alive' && damage > 0) this.damageBug(bug, 'dot', damage);
    }
  }

  // 이 적이 밟고 있는(이미 떨어진) 웅덩이들. 공중 적은 안 밟는다
  activePuddlesUnder(bug) {
    if (bug.air || !this.puddles?.length) return [];
    return this.puddles.filter(puddle => this.gameTime >= puddle.activeAt && Math.hypot((bug.x - puddle.x) / 0.6, bug.y - puddle.y) <= puddle.radius);
  }

  slowFactor(bug) {
    let factor = 1;
    if (this.gameTime < (bug.jamUntil ?? 0)) factor = Math.min(factor, bug.jamSlow ?? 1);
    for (const puddle of this.activePuddlesUnder(bug)) factor = Math.min(factor, puddle.slow);
    for (const tower of this.towers) {
      const config = TOWER_TYPES[tower.type];
      if (config.slow < 1 && !bug.air && this.gameTime >= (tower.lockedUntil ?? 0) && this.inRange(tower, bug)) factor = Math.min(factor, towerStats(tower.type, tower.level).slow);
    }
    return factor;
  }

  // 타워가 이 공격을 맞힐 수 있나: 지상 타워는 지상만, 요격포는 공중만. 잠긴 타워는 못 쏜다
  // 노리는 대상: 'ground'(땅만) · 'air'(공중만) · 'all'(둘 다)
  canTarget(tower, bug) {
    const targets = TOWER_TYPES[tower.type].targets;
    if (targets === 'all') return true;
    return (targets === 'air') === Boolean(bug.air);
  }

  // 표적 우선순위: 컴퓨터에 가까울수록 높고, 요격포(공중·지상 모두)는 공중 적을 먼저 노린다
  targetPriority(tower, bug) {
    const airFirst = TOWER_TYPES[tower.type].targets === 'all' && bug.air ? 1 : 0;
    return airFirst + bug.progress;
  }

  inRange(tower, bug) {
    const range = towerStats(tower.type, tower.level).range;
    return Math.hypot(tower.x - bug.x, tower.y - bug.y) <= range;
  }

  moveBugs(frameSeconds) {
    for (const bug of this.bugs) {
      if (bug.state !== 'alive') continue;
      if (this.isHeldByGuardian(bug)) continue;
      const type = BUG_TYPES[bug.type];
      const rage = bug.phase === 2 ? type.phaseTwo.speedFactor : 1;
      const stunned = this.gameTime < bug.shieldUntil ? 0 : 1;
      const distance = bug.air ? Math.max(0.2, Math.hypot(DEFENSE_COMPUTER.x - bug.origin.x, DEFENSE_COMPUTER.y - bug.origin.y)) : 1;
      bug.progress += type.speed * this.difficulty.speed * this.slowFactor(bug) * rage * stunned * frameSeconds / distance * (bug.air ? 0.9 : 1);
      const point = bug.air
        ? { x: bug.origin.x + (DEFENSE_COMPUTER.x - bug.origin.x) * Math.min(1, bug.progress), y: bug.origin.y + (DEFENSE_COMPUTER.y - 0.1 - bug.origin.y) * Math.min(1, bug.progress) }
        : pointOnPath(bug.progress);
      bug.x = point.x;
      bug.y = point.y;
      if (bug.progress >= 1) this.breach(bug);
      if (this.status !== 'running') return;
    }
  }

  // 버그가 컴퓨터에 닿음: 체력이 깎이고 그 버그는 사라진다(처치는 아님, 웨이브 진행에는 센다)
  breach(bug) {
    const damage = BUG_TYPES[bug.type].damage;
    bug.state = 'breached';
    bug.resolvedAt = this.gameTime;
    this.waveKilled++;
    this.waveTookDamage = true;
    const wasDanger = this.isDanger();
    this.health = Math.max(0, this.health - damage);
    if (this.combo >= 5) this.emit('combo-lost', { combo: this.combo });
    this.combo = 0;
    this.emit('damage', { bug, damage, health: this.health, lives: this.health > 0 ? 1 : 0 });
    if (!wasDanger && this.isDanger()) this.emit('danger', { health: this.health });
    if (this.health <= 0) {
      this.outcome = 'breached';
      this.finish();
    }
  }

  // 타워: 쿨다운이 끝나면 사거리 안에서 컴퓨터에 가장 가까운 버그를 1 피해
  fireTowers() {
    for (const tower of this.towers) {
      if (this.gameTime < tower.readyAt || this.gameTime < (tower.lockedUntil ?? 0)) continue;
      const stats = towerStats(tower.type, tower.level);
      const targets = this.bugs
        .filter(bug => bug.state === 'alive' && bug.hp > 0 && this.canTarget(tower, bug) && this.inRange(tower, bug))
        .sort((first, second) => this.targetPriority(tower, second) - this.targetPriority(tower, first))
        .slice(0, stats.shots);
      if (!targets.length) continue;
      tower.readyAt = this.gameTime + stats.cooldown;
      for (const [index, target] of targets.entries()) {
        this.towerShots.push({ towerId: tower.id, fromX: tower.x, fromY: tower.y, bugId: target.id, x: target.x, y: target.y, at: this.gameTime, type: tower.type, level: tower.level, barrel: index });
        this.emit('tower-shot', { tower, bug: target });
        if (stats.puddle) {
          // 허니팟: 표적 발밑(길 위)에 끈끈이를 던진다. 0.35초 날아가 떨어진 뒤부터 효과
          const puddle = { id: this.nextId++, towerId: tower.id, x: target.x, y: target.y, radius: stats.puddle.radius, slow: stats.puddle.slow, dps: stats.puddle.dps, stepDamage: stats.puddle.stepDamage, activeAt: this.gameTime + 0.35, until: this.gameTime + 0.35 + stats.puddle.seconds, level: tower.level };
          this.puddles.push(puddle);
          this.emit('puddle', { tower, puddle });
          continue;
        }
        if (stats.burn) {
          const stillBurning = this.gameTime < (target.burnUntil ?? 0);
          target.burnDps = Math.max(stillBurning ? target.burnDps ?? 0 : 0, stats.burn.dps);
          target.burnUntil = this.gameTime + stats.burn.seconds;
        }
        if (stats.splash > 0) {
          // EMP: 떨어진 곳 반경 안의 (이 타워가 맞힐 수 있는) 적 모두에게 같은 피해
          const center = { x: target.x, y: target.y };
          const hits = this.bugs.filter(bug => bug.state === 'alive' && this.canTarget(tower, bug) && Math.hypot((bug.x - center.x) / 0.6, bug.y - center.y) <= stats.splash);
          // 반경 안의 공중 드론: 전자기 교란으로 몇 초 동안 느려지고, 피해는 지상의 절반
          const airJam = TOWER_TYPES[tower.type].airJam;
          const jammed = airJam ? this.bugs.filter(bug => bug.state === 'alive' && bug.air && Math.hypot((bug.x - center.x) / 0.6, bug.y - center.y) <= stats.splash) : [];
          for (const bug of jammed) {
            bug.jamUntil = this.gameTime + airJam.seconds;
            bug.jamSlow = airJam.slow;
            this.emit('air-jammed', { bug, seconds: airJam.seconds });
          }
          this.emit('splash', { tower, x: center.x, y: center.y, radius: stats.splash, hits: hits.length, jammed: jammed.length });
          for (const bug of hits) {
            this.damageBug(bug, 'tower', stats.damage);
            if (this.status !== 'running') return;
          }
          for (const bug of jammed) {
            this.damageBug(bug, 'tower', stats.damage * airJam.damageFactor);
            if (this.status !== 'running') return;
          }
          continue;
        }
        if (stats.damage > 0) this.damageBug(target, 'tower', stats.damage);
        if (this.status !== 'running') return;
      }
    }
  }

  // 피해 1. 0이 되면 처치(코인·점수). 보스는 체력이 기준 아래로 내려가면 2페이즈(잠깐 무적)
  // amount: 기본 1. 지속 피해(source 'dot')는 매 프레임 소수로 들어오므로 맞음·막힘 알림을 내지 않는다
  damageBug(bug, source, amount = 1) {
    if (bug.state !== 'alive') return;
    if (this.gameTime < bug.shieldUntil) {
      if (source !== 'dot') this.emit('bug-blocked', { bug });
      return;
    }
    bug.hp -= amount;
    if (bug.hp < 1e-6) bug.hp = 0;
    const phaseTwo = BUG_TYPES[bug.type].phaseTwo;
    if (phaseTwo && bug.phase === 1 && bug.hp > 0 && bug.hp <= bug.maxHp * phaseTwo.at) {
      bug.phase = 2;
      bug.shieldUntil = this.gameTime + DEFENSE_RULES.phaseShieldSeconds;
      bug.nextSummonAt = this.gameTime + DEFENSE_RULES.phaseShieldSeconds;
      bug.nextLockAt = this.gameTime + DEFENSE_RULES.phaseShieldSeconds + 1;
      this.emit('boss-phase', { bug, label: phaseTwo.label });
      return;
    }
    if (bug.hp > 0) {
      if (source !== 'dot') this.emit('bug-hit', { bug, source, amount });
      return;
    }
    const type = BUG_TYPES[bug.type];
    bug.state = 'dead';
    bug.resolvedAt = this.gameTime;
    this.kills[bug.type]++;
    this.waveKilled++;
    this.score += type.bounty;
    this.gainCoins(type.towerCoins, 'tower');
    this.emit('bug-kill', { bug, source, combo: this.combo });
  }

  // 2페이즈 보스 기술: 졸개 소환(웨이브 수에 더한다), 가장 가까운 타워를 잠깐 잠금(암호화)
  runBossSkills() {
    for (const bug of this.bugs) {
      if (bug.state !== 'alive' || bug.phase !== 2) continue;
      const skill = BUG_TYPES[bug.type].phaseTwo;
      if (this.gameTime >= bug.nextSummonAt) {
        bug.nextSummonAt = this.gameTime + skill.every;
        const minions = [];
        for (let index = 0; index < skill.summonCount; index++) {
          const offset = (index - (skill.summonCount - 1) / 2) * 0.06;
          const minion = this.spawnBug(skill.summon, BUG_TYPES[skill.summon].air
            ? { x: Math.max(0.05, Math.min(0.95, bug.x + offset)), y: Math.max(0, bug.y - 0.05) }
            : { progress: bug.progress - 0.02 * (index + 1) });
          minions.push(minion);
        }
        this.summoned += minions.length;
        this.waveTotal += minions.length;
        this.emit('boss-summon', { bug, minions });
      }
      if (this.gameTime >= bug.nextLockAt && this.towers.length) {
        bug.nextLockAt = this.gameTime + skill.lockEvery;
        const tower = this.towers
          .filter(entry => this.gameTime >= (entry.lockedUntil ?? 0))
          .sort((first, second) => Math.hypot(first.x - bug.x, first.y - bug.y) - Math.hypot(second.x - bug.x, second.y - bug.y))[0];
        if (tower) {
          tower.lockedUntil = this.gameTime + skill.lockSeconds;
          this.emit('tower-locked', { tower, bug, seconds: skill.lockSeconds });
        }
      }
    }
  }

  gainCoins(amount, reason) {
    const coins = Math.max(0, Math.round(amount));
    if (!coins) return 0;
    this.coins += coins;
    this.coinsEarned += coins;
    this.emit('coins', { amount: coins, reason, total: this.coins });
    return coins;
  }

  // 웨이브 끝: 다 내보냈고 살아 있는 버그가 없으면 보너스 코인·점수, 마지막 웨이브면 승리
  checkWaveClear() {
    if (this.phase !== 'spawning' || this.waveSpawned < this.waveTotal) return;
    if (this.bugs.some(bug => bug.state === 'alive')) return;
    this.wavesCleared = this.wave;
    if (!this.waveTookDamage) this.noDamageWaves++;
    const bonus = this.gainCoins(waveBonusCoins(this.wave, this.waveTookDamage), 'wave');
    this.score += DEFENSE_RULES.waveScore * this.wave;
    this.emit('wave-clear', { wave: this.wave, bonus, perfect: !this.waveTookDamage });
    if (this.wave >= DEFENSE_RULES.waves) {
      this.outcome = 'cleared';
      this.phase = 'won';
      this.winAt = this.gameTime + DEFENSE_RULES.winPauseSeconds;
      this.clearBuffer();
      this.emit('goal', { waves: this.wavesCleared });
      return;
    }
    this.phase = 'break';
    this.phaseUntil = this.gameTime + DEFENSE_RULES.breakSeconds;
  }

  // ---------- 낱말 줄(수입) ----------
  // 미리 보여 줄 낱말을 채운다. 바로 앞 낱말과 같은 낱말은 피한다
  refillStream() {
    while (this.stream.length < DEFENSE_RULES.streamLength) {
      const previous = this.stream.at(-1)?.token.text;
      let token = this.drawWeightedToken();
      for (let attempt = 0; attempt < 5 && token.text === previous; attempt++) token = this.drawWeightedToken();
      this.stream.push({ id: this.nextId++, kind: 'word', token });
    }
  }

  // 낱말 하나를 다 치면: 투사체 없이 코인(콤보·웨이브 배율), 다음 낱말이 올라온다
  onFire(target, projectile) {
    this.projectiles = this.projectiles.filter(entry => entry !== projectile);
    const coins = this.gainCoins(wordCoins(target.token.text.length, this.wave, this.combo), 'word');
    this.wordsTyped++;
    this.stream = this.stream.filter(word => word.id !== target.id);
    this.refillStream();
    this.lastWord = target.token.text;
    this.emit('word-done', { word: target, coins, combo: this.combo });
  }

  // 상점 단축키(1~4)와 설치 모드 숫자(1~5 추천 자리), Esc 취소. 처리했으면 true
  hotkey(key) {
    if (this.status !== 'running') return false;
    if (key === 'Escape' && this.buildMode) {
      this.cancelBuild('escape');
      return true;
    }
    if (!/^[1-9]$/.test(key)) return false;
    if (this.buildMode) {
      const spot = this.spots[Number(key) - 1];
      if (spot) this.placeAtSpot(spot);
      return Boolean(spot);
    }
    const item = this.shop.find(entry => entry.hotkey === key);
    if (!item) return false;
    this.selectShopItem(item.item);
    return true;
  }

  // ---------- 설치 ----------
  // 이 점에 새 타워를 세울 수 있나: 들판 안, 길·컴퓨터 둘레가 아니고 다른 타워와 겹치지 않음. 이유를 돌려준다. O(타워 + 구간)
  placementProblem(point) {
    const { margin, towerGap } = PLACEMENT;
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return 'outside';
    if (point.x < margin || point.x > 1 - margin || point.y < margin || point.y > 1 - margin) return 'outside';
    if (isOnPath(point)) return 'path';
    if (inComputerZone(point)) return 'computer';
    if (this.towers.some(tower => Math.hypot((tower.x - point.x) / towerGap.x, (tower.y - point.y) / towerGap.y) < 1)) return 'blocked';
    return null;
  }

  // 누른 점에 지을 수 있으면 그 점, 못 지으면 가장 가까운(누른 점에서 nudgeRadius 안) 빈자리. 없으면 point = null.
  // 동심원 6겹 × 16방향을 가까운 순서로 본다. O(96 × 타워 수)
  resolvePlacement(point) {
    const problem = this.placementProblem(point);
    if (!problem) return { point, problem: null, nudged: false };
    if (problem === 'outside' && !Number.isFinite(point?.x)) return { point: null, problem, nudged: false };
    const rings = 6, directions = 16;
    for (let ring = 1; ring <= rings; ring++) {
      const radius = PLACEMENT.nudgeRadius * ring / rings;
      let best = null;
      for (let index = 0; index < directions; index++) {
        const angle = index / directions * Math.PI * 2;
        const candidate = { x: point.x + Math.cos(angle) * radius * 0.6, y: point.y + Math.sin(angle) * radius };
        if (this.placementProblem(candidate)) continue;
        const distance = Math.hypot((candidate.x - point.x) / 0.6, candidate.y - point.y);
        if (!best || distance < best.distance) best = { candidate, distance };
      }
      if (best) return { point: best.candidate, problem, nudged: true };
    }
    return { point: null, problem, nudged: false };
  }

  canBuildNew() {
    return this.towers.length < DEFENSE_RULES.maxTowers && CANDIDATE_SPOTS.some(point => !this.placementProblem(point));
  }

  upgradableTowers(towerKey) {
    return this.towers.filter(tower => tower.type === towerKey && tower.level < DEFENSE_RULES.maxTowerLevel);
  }

  // 키보드 추천 자리: 길을 많이 덮는 후보부터, 서로 떨어지게 최대 suggestions개. O(후보 × 추천 수)
  suggestedSpots() {
    if (this.towers.length >= DEFENSE_RULES.maxTowers) return [];
    const chosen = [];
    for (const point of CANDIDATE_SPOTS) {
      if (chosen.length >= DEFENSE_RULES.suggestions) break;
      if (this.placementProblem(point)) continue;
      if (chosen.some(other => Math.hypot((other.x - point.x) / 0.16, (other.y - point.y) / 0.16) < 1)) continue;
      chosen.push(point);
    }
    return chosen;
  }

  // 새 타워면 기본가, 업그레이드면 기본가 × 1.5^레벨, 난이도 배율. tower가 null이면 새 타워
  priceAt(towerKey, tower) {
    const factor = DEFENSE_RULES.priceFactor[this.level] ?? 1;
    return Math.round(TOWER_TYPES[towerKey].price * factor * 1.5 ** (tower ? tower.level : 0));
  }

  // 상점 낱말: 패치는 바로 수리, 타워는 설치 모드(추천 자리·같은 타워 위에 짧은 낱말, 화면을 눌러도 됨). 같은 타워를 다시 치면 취소
  selectShopItem(itemKey) {
    const item = SHOP_ITEMS[itemKey];
    if (!item) return { bought: false, reason: 'unknown' };
    const deny = (reason, price) => {
      this.emit('shop-denied', { item: itemKey, price, coins: this.coins, reason });
      return { bought: false, reason };
    };
    if (item.kind === 'repair') {
      const price = this.priceOf(itemKey);
      if (this.health >= this.maxHealth) return deny('full', price);
      if (this.coins < price) return deny('coins', price);
      this.coins -= price;
      this.health = Math.min(this.maxHealth, this.health + DEFENSE_RULES.repairAmount);
      this.emit('repair', { health: this.health, price });
      return { bought: true };
    }
    if (this.buildMode?.tower === item.tower) return this.cancelBuild('toggle');
    const canBuild = this.canBuildNew();
    const upgradable = this.upgradableTowers(item.tower);
    if (!canBuild && !upgradable.length) return deny('no-slot', Infinity);
    const cheapest = Math.min(canBuild ? this.priceAt(item.tower, null) : Infinity, ...upgradable.map(tower => this.priceAt(item.tower, tower)));
    if (this.coins < cheapest) return deny('coins', cheapest);
    this.cancelBuild('switch', { silent: true });
    this.buildMode = { tower: item.tower, upgrade: !canBuild, until: this.gameTime + DEFENSE_RULES.buildModeSeconds };
    const spots = [
      ...(canBuild ? this.suggestedSpots().map(point => ({ x: point.x, y: point.y, towerId: null })) : []),
      ...upgradable.map(tower => ({ x: tower.x, y: tower.y, towerId: tower.id }))
    ];
    this.spots = spots.map((spot, index) => ({ id: this.nextId++, kind: 'spot', ...spot, hotkey: String(index + 1) })).slice(0, 9);
    this.emit('build-mode', { tower: item.tower, upgrade: !canBuild, spots: this.spots.length });
    return { bought: false, buildMode: true };
  }

  cancelBuild(reason, { silent = false } = {}) {
    if (!this.buildMode) return { bought: false, reason: 'none' };
    this.buildMode = null;
    this.spots = [];
    if (!silent) this.emit('build-cancel', { reason });
    return { bought: false, reason };
  }

  // 자리 낱말을 쳤을 때
  placeAtSpot(spot) {
    if (spot.towerId != null) return this.upgradeTower(this.towers.find(tower => tower.id === spot.towerId));
    return this.placeAtPoint({ x: spot.x, y: spot.y });
  }

  // 화면을 누른 점(들판 좌표)에: 같은 종류 타워를 누르면 업그레이드, 빈 땅이면 새 타워, 길·컴퓨터·겹침이면 거절
  placeAtPoint(point) {
    const mode = this.buildMode;
    if (!mode) return { bought: false, reason: 'no-mode' };
    const touched = this.towers.find(tower => Math.hypot((tower.x - point.x) / PLACEMENT.towerGap.x, (tower.y - point.y) / PLACEMENT.towerGap.y) < 0.6) ?? null;
    // 같은 종류 타워를 누르면 강화, 다른 종류면 그 옆 빈자리로 밀어서 새로 짓는다
    if (touched?.type === mode.tower) return this.upgradeTower(touched);
    if (this.towers.length >= DEFENSE_RULES.maxTowers) return this.denyPlace('max-towers', point);
    const placement = this.resolvePlacement(point);
    if (!placement.point) return this.denyPlace(placement.problem, point);
    const price = this.priceAt(mode.tower, null);
    if (this.coins < price) return this.denyPlace('coins', point, price);
    this.coins -= price;
    this.cancelBuild('placed', { silent: true });
    const spot = placement.point;
    const tower = { id: this.nextId++, type: mode.tower, x: spot.x, y: spot.y, level: 1, readyAt: this.gameTime + 0.5, builtAt: this.gameTime, builtWave: this.wave, spent: price };
    this.towers.push(tower);
    this.towersBuilt++;
    this.emit('tower-built', { tower, price, nudged: placement.nudged });
    return { bought: true, tower, nudged: placement.nudged };
  }

  // 강화: 설치 모드(같은 타워 다시 누르기·번호 키)든, 그냥 타워를 눌러 고른 강화 카드든 같은 길로 온다. Lv.3이 끝
  upgradeTower(tower) {
    if (!tower || !this.towers.includes(tower)) return { bought: false, reason: 'no-tower' };
    if (tower.level >= DEFENSE_RULES.maxTowerLevel) return this.denyPlace('max-level', tower);
    const price = this.priceAt(tower.type, tower);
    if (this.coins < price) return this.denyPlace('coins', tower, price);
    this.coins -= price;
    this.cancelBuild('placed', { silent: true });
    tower.spent = (tower.spent ?? 0) + price;
    tower.level += 1;
    tower.upgradedAt = this.gameTime;
    this.emit('tower-upgraded', { tower, price, stats: towerStats(tower.type, tower.level), perk: tower.level >= DEFENSE_RULES.maxTowerLevel ? TOWER_MAX_PERKS[tower.type] : null });
    return { bought: true, tower };
  }

  // 누른 점에서 가장 가까운 타워(누름 반경 안). 없으면 null. O(타워 수)
  towerAt(point) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return null;
    const { tapRadius } = PLACEMENT;
    let best = null;
    for (const tower of this.towers) {
      const distance = Math.hypot((tower.x - point.x) / tapRadius.x, (tower.y - point.y) / tapRadius.y);
      if (distance < 1 && (!best || distance < best.distance)) best = { tower, distance };
    }
    return best?.tower ?? null;
  }

  // 판매 환급액: 쓴 코인(설치 + 강화)의 70%, 이번 웨이브에 지은 타워는 100%(실수 되돌리기)
  sellValue(tower) {
    if (!tower) return 0;
    const ratio = tower.builtWave === this.wave ? 1 : PLACEMENT.sellRefund;
    return Math.floor((tower.spent ?? 0) * ratio);
  }

  // 타워 판매: 코인을 돌려받고 그 자리가 빈다
  sellTower(tower) {
    if (!tower || !this.towers.includes(tower)) return { sold: false, reason: 'no-tower' };
    const refund = this.sellValue(tower);
    this.towers = this.towers.filter(entry => entry !== tower);
    this.towerShots = this.towerShots.filter(shot => shot.towerId !== tower.id);
    this.coins += refund;
    this.emit('tower-sold', { tower, refund });
    return { sold: true, refund };
  }

  // 강화 카드에 보일 정보: 다음 레벨 능력치·가격·살 수 있는지. 최고 레벨이면 next = null
  upgradeInfo(tower) {
    if (!tower) return null;
    const maxed = tower.level >= DEFENSE_RULES.maxTowerLevel;
    const price = maxed ? null : this.priceAt(tower.type, tower);
    return {
      level: tower.level, maxed, price, affordable: !maxed && this.coins >= price,
      current: towerStats(tower.type, tower.level),
      next: maxed ? null : towerStats(tower.type, tower.level + 1),
      perk: !maxed && tower.level + 1 >= DEFENSE_RULES.maxTowerLevel ? TOWER_MAX_PERKS[tower.type] : null
    };
  }

  // 놓을 수 없는 자리: 설치 모드는 그대로 두고(다시 고르면 됨) 이유만 알린다. 코인 부족이면 모드를 끝낸다
  denyPlace(reason, point, price = null) {
    if (reason === 'coins') this.cancelBuild('coins', { silent: true });
    this.emit('place-denied', { reason, x: point.x, y: point.y, price, coins: this.coins });
    return { bought: false, reason };
  }

  // 테스트·도구용: 상점 낱말을 고르고 첫 추천 자리(없으면 업그레이드 자리)에 바로 짓는다
  buy(itemKey, spotIndex = 0) {
    const result = this.selectShopItem(itemKey);
    if (!result.buildMode) return result;
    return this.placeAtSpot(this.spots[spotIndex] ?? this.spots[0]);
  }

  // 승리 연출 중에는 입력을 받지 않는다
  input(character, nowMs) {
    if (this.winAt != null) return { accepted: false, reason: 'finished' };
    return super.input(character, nowMs);
  }

  // ---------- 화면·요약 ----------
  snapshotExtras() {
    return {
      wave: this.wave,
      waves: DEFENSE_RULES.waves,
      phase: this.phase,
      bpm: this.bpm(),
      coins: this.coins,
      health: this.health,
      maxHealth: this.maxHealth,
      danger: this.isDanger(),
      lives: this.health > 0 ? 1 : 0,
      prices: Object.fromEntries(Object.keys(SHOP_ITEMS).map(key => [key, this.priceOf(key)])),
      waveKilled: this.waveKilled,
      waveTotal: this.waveTotal,
      boss: this.bugs.find(bug => bug.state === 'alive' && BUG_TYPES[bug.type].boss) ?? null,
      buildMode: this.buildMode ? { ...this.buildMode } : null
    };
  }

  summaryExtras() {
    return {
      wave: this.wave,
      wavesCleared: this.wavesCleared,
      waves: DEFENSE_RULES.waves,
      waveProgress: this.waveTotal ? Math.round(this.waveKilled / this.waveTotal * 1000) / 1000 : 0,
      outcome: this.outcome ?? 'breached',
      coinsEarned: this.coinsEarned,
      towersBuilt: this.towersBuilt,
      healthLeft: this.health,
      noDamageWaves: this.noDamageWaves,
      kills: { ...this.kills }
    };
  }
}
