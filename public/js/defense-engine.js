// 컴퓨터 디펜스: 해킹 공격(패킷·스팸 메일·악성 파일·랜섬웨어)이 지그재그 길을 따라 아래 컴퓨터로 온다.
// 공격 위 낱말을 치면 패치가 날아가 맞힌다. 낱말로 번 코인으로 상점 낱말을 치면:
//   firewall · antivirus → 설치 모드: 길이 아닌 곳이면 어디든(누르거나 탭) 타워를 세운다. 추천 자리·같은 타워 위에는
//   짧은 낱말이 떠서 키보드만으로도 고를 수 있다(같은 타워를 고르면 업그레이드)
//   patch → 컴퓨터 체력 회복
// 웨이브 1~5, 웨이브마다 배경음악 BPM이 오르고(110→130), 컴퓨터 체력이 30% 아래면 음악이 먹먹해진다(로우패스).
// 수치 근거(조사 보고서): 단어 코인 (2+글자 수)×웨이브 배율×콤보 배율, 웨이브 보너스 50+25×웨이브(무피해 +30%),
// 난이도별 상점가 ×0.85/1/1.08/1.2(Bloons TD 6), 체력 150/100/80/60%.
import { TargetGameEngine, ARCADE_RULES, randomBetween } from './target-game.js';
import { SCORING, MAX_MULTIPLIER } from './engine.js';

export const DEFENSE_RULES = Object.freeze({
  waves: 5,
  introSeconds: 2.4,
  breakSeconds: 4,
  winPauseSeconds: 1.4,
  // 웨이브 n의 버그 수 = base + step × (n - 1). 마지막 웨이브는 끝에 보스(랜섬웨어)
  bugsPerWave: Object.freeze({ base: 6, step: 3 }),
  // 등장 간격(초) = max(min, start - step × (n - 1)) × 난이도 등장 배율
  spawnInterval: Object.freeze({ start: 3, step: 0.3, min: 1 }),
  // 레벨(1~4)별: 시작 BPM, 컴퓨터 최대 체력, 상점가 배율
  bpmBase: Object.freeze({ 1: 100, 2: 110, 3: 120, 4: 130 }),
  bpmStep: 5,
  maxHealth: Object.freeze({ 1: 150, 2: 100, 3: 80, 4: 60 }),
  priceFactor: Object.freeze({ 1: 0.85, 2: 1, 3: 1.08, 4: 1.2 }),
  dangerRatio: 0.3,
  startCoins: 60,
  // 단어 코인 = round((wordBase + 글자 수) × (1 + waveStep × (웨이브 - 1)) × 콤보 배율)
  wordCoins: Object.freeze({ wordBase: 2, waveStep: 0.25 }),
  comboCoinSteps: Object.freeze([[30, 2], [20, 1.5], [10, 1.2]]),
  waveBonus: Object.freeze({ base: 50, perWave: 25, noDamageFactor: 1.3 }),
  waveScore: 200,
  repairAmount: 25,
  maxTowers: 12,
  maxTowerLevel: 3,
  // 키보드용 추천 자리 수
  suggestions: 5,
  // 설치 모드: 이 시간 안에 자리를 고르지 않으면 취소. 자리 낱말은 이 길이 이하
  buildModeSeconds: 10,
  spotTokenMaxLength: 4
});

// 길(화면 들판을 0~1로 본 좌표): 왼쪽 위에서 들어와 지그재그로 내려가, 컴퓨터 바로 위(방패 돔 꼭대기)에서 끝난다.
// 길이 컴퓨터를 덮지 않도록 컴퓨터는 길 끝보다 아래(DEFENSE_COMPUTER)에 따로 둔다
export const DEFENSE_PATH = Object.freeze([
  [0.08, 0], [0.08, 0.16], [0.92, 0.16], [0.92, 0.38], [0.08, 0.38], [0.08, 0.58], [0.5, 0.58]
].map(([x, y]) => Object.freeze({ x, y })));
export const DEFENSE_COMPUTER = Object.freeze({ x: 0.5, y: 0.84 });

// 설치 규칙(들판 좌표, 가로·세로 반지름이 다른 타원으로 잰다): 길과 띄울 거리, 타워끼리 띄울 거리, 컴퓨터 둘레
export const PLACEMENT = Object.freeze({
  pathClear: Object.freeze({ x: 0.075, y: 0.085 }),
  towerGap: Object.freeze({ x: 0.075, y: 0.095 }),
  computerZone: Object.freeze({ x: 0.5, y: 0.84, rx: 0.2, ry: 0.27 }),
  margin: 0.035
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

// 공격 종류: hp = 맞혀야 하는 횟수(낱말·타워 한 방 = 1), speed = 초당 길을 가는 비율(0→1),
// damage = 컴퓨터에 닿으면 깎이는 체력, bounty = 처치 점수, towerCoins = 타워가 잡았을 때 코인
export const ATTACK_TYPES = Object.freeze({
  packet: Object.freeze({ label: '해킹 패킷', hp: 1, speed: 0.04, damage: 10, bounty: 50, towerCoins: 1, fromWave: 1, weight: 1 }),
  spam: Object.freeze({ label: '스팸 메일', hp: 1, speed: 0.07, damage: 8, bounty: 70, towerCoins: 1, fromWave: 2, weight: 0.5 }),
  malware: Object.freeze({ label: '악성 파일', hp: 2, speed: 0.03, damage: 15, bounty: 120, towerCoins: 2, fromWave: 3, weight: 0.35 }),
  ransomware: Object.freeze({ label: '랜섬웨어', hp: 6, speed: 0.016, damage: 40, bounty: 800, towerCoins: 20, fromWave: Infinity, weight: 0, boss: true })
});
export const BUG_TYPES = ATTACK_TYPES;

// 타워: 쏘는 간격(초), 사거리(화면 비율), 감속(사거리 안 버그 속도 배율). 레벨이 오르면 간격 ×0.75
export const TOWER_TYPES = Object.freeze({
  firewall: Object.freeze({ label: '방화벽', word: 'firewall', price: 120, cooldown: 3, range: 0.26, slow: 0.65 }),
  antivirus: Object.freeze({ label: '백신', word: 'antivirus', price: 200, cooldown: 1.8, range: 0.32, slow: 1 })
});
export const SHOP_ITEMS = Object.freeze({
  firewall: Object.freeze({ kind: 'tower', tower: 'firewall', word: 'firewall' }),
  antivirus: Object.freeze({ kind: 'tower', tower: 'antivirus', word: 'antivirus' }),
  patch: Object.freeze({ kind: 'repair', word: 'patch', price: 80 })
});

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
    this.coins = DEFENSE_RULES.startCoins;
    this.coinsEarned = 0;
    this.bugs = [];
    this.towers = [];
    this.towerShots = [];
    this.wave = 1;
    this.wavesCleared = 0;
    this.phase = 'intro';
    this.phaseUntil = DEFENSE_RULES.introSeconds;
    this.waveSpawned = 0;
    this.waveTotal = this.bugsInWave(1);
    this.waveKilled = 0;
    this.waveTookDamage = false;
    this.noDamageWaves = 0;
    this.nextSpawnAt = Infinity;
    this.kills = Object.fromEntries(Object.keys(BUG_TYPES).map(type => [type, 0]));
    this.towersBuilt = 0;
    this.outcome = null;
    this.winAt = null;
    this.buildMode = null;
    this.spots = [];
    this.shop = Object.entries(SHOP_ITEMS).map(([key, item]) => ({ id: this.nextId++, kind: 'shop', item: key, token: { text: item.word, kind: 'keyword', weight: 1 } }));
  }

  // ---------- 목표 ----------
  targetables() {
    return [...this.bugs.filter(bug => bug.state === 'alive' && !bug.doomed), ...this.shop, ...this.spots.filter(spot => spot.token)];
  }

  findEntity(id) {
    return this.bugs.find(bug => bug.id === id) ?? this.shop.find(item => item.id === id) ?? this.spots.find(spot => spot.id === id) ?? null;
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
    return DEFENSE_RULES.bugsPerWave.base + DEFENSE_RULES.bugsPerWave.step * (wave - 1) + (wave === DEFENSE_RULES.waves ? 1 : 0);
  }

  // ---------- 진행 ----------
  step(frameSeconds) {
    if (this.winAt != null) {
      if (this.gameTime >= this.winAt) this.finish();
      return;
    }
    this.towerShots = this.towerShots.filter(shot => this.gameTime - shot.at < 0.3);
    if (this.buildMode && this.gameTime >= this.buildMode.until && this.targetId == null) this.cancelBuild('timeout');
    this.advancePhase();
    this.spawnIfDue();
    this.moveBugs(frameSeconds);
    if (this.status !== 'running') return;
    this.fireTowers();
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
    this.phase = 'intro';
    this.phaseUntil = this.gameTime + DEFENSE_RULES.introSeconds;
    this.emit('wave-intro', { wave, bpm: this.bpm() });
  }

  spawnInterval() {
    const { start, step, min } = DEFENSE_RULES.spawnInterval;
    return Math.max(min, start - step * (this.wave - 1)) * this.difficulty.spawn;
  }

  spawnIfDue() {
    if (this.phase !== 'spawning' || this.gameTime < this.nextSpawnAt) return;
    const regular = this.waveTotal - (this.wave === DEFENSE_RULES.waves ? 1 : 0);
    if (this.waveSpawned < regular) {
      this.spawnBug(this.chooseBugType());
      this.nextSpawnAt = this.gameTime + this.spawnInterval() * randomBetween(this.random, [0.8, 1.2]);
    } else if (this.waveSpawned < this.waveTotal) {
      // 마지막 웨이브: 졸개를 다 내보낸 뒤 보스. 경고를 먼저 띄운다
      this.spawnBug('ransomware');
      this.emit('boss-appear', {});
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

  // 길 입구에서 출발한다
  spawnBug(typeKey) {
    const type = BUG_TYPES[typeKey];
    const start = pointOnPath(0);
    const bug = {
      id: this.nextId++, kind: 'bug', type: typeKey, progress: 0, x: start.x, y: start.y,
      hp: type.hp, maxHp: type.hp, incomingDamage: 0, doomed: false, state: 'alive', spawnedAt: this.gameTime,
      resolvedAt: null, token: null, wave: this.wave
    };
    bug.token = this.pickToken(bug.id);
    this.bugs.push(bug);
    this.waveSpawned++;
    this.emit('spawn', { bug });
    return bug;
  }

  // 방화벽 사거리 안이면 느려진다(가장 강한 감속 하나만)
  slowFactor(bug) {
    let factor = 1;
    for (const tower of this.towers) {
      const config = TOWER_TYPES[tower.type];
      if (config.slow < 1 && this.inRange(tower, bug)) factor = Math.min(factor, config.slow - 0.05 * (tower.level - 1));
    }
    return factor;
  }

  inRange(tower, bug) {
    const range = TOWER_TYPES[tower.type].range + 0.04 * (tower.level - 1);
    return Math.hypot(tower.x - bug.x, tower.y - bug.y) <= range;
  }

  moveBugs(frameSeconds) {
    for (const bug of this.bugs) {
      if (bug.state !== 'alive') continue;
      bug.progress += BUG_TYPES[bug.type].speed * this.difficulty.speed * this.slowFactor(bug) * frameSeconds;
      const point = pointOnPath(bug.progress);
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
    this.releaseTargetIf(bug.id, 'breached');
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
      if (this.gameTime < tower.readyAt) continue;
      const target = this.bugs
        .filter(bug => bug.state === 'alive' && bug.hp - bug.incomingDamage > 0 && this.inRange(tower, bug))
        .sort((first, second) => second.progress - first.progress)[0];
      if (!target) continue;
      tower.readyAt = this.gameTime + TOWER_TYPES[tower.type].cooldown * 0.75 ** (tower.level - 1);
      this.towerShots.push({ towerId: tower.id, fromX: tower.x, fromY: tower.y, bugId: target.id, x: target.x, y: target.y, at: this.gameTime, type: tower.type });
      this.emit('tower-shot', { tower, bug: target });
      this.damageBug(target, 'tower');
      if (this.status !== 'running') return;
    }
  }

  // 피해 1. 0이 되면 처치(코인·점수), 아니면 낱말을 바꾼다(여러 번 맞혀야 하는 버그)
  damageBug(bug, source) {
    if (bug.state !== 'alive') return;
    bug.hp -= 1;
    if (bug.hp > 0) {
      bug.token = this.pickToken(bug.id);
      this.releaseTargetIf(bug.id, 'retoken');
      this.emit('bug-hit', { bug, source });
      return;
    }
    const type = BUG_TYPES[bug.type];
    bug.state = 'dead';
    bug.resolvedAt = this.gameTime;
    this.kills[bug.type]++;
    this.waveKilled++;
    this.score += type.bounty;
    this.releaseTargetIf(bug.id, 'killed');
    if (source === 'tower') this.gainCoins(type.towerCoins, 'tower');
    this.emit('bug-kill', { bug, source, combo: this.combo });
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

  // ---------- 발사 ----------
  // 상점·설치 자리 낱말은 즉시 처리(투사체 없음). 공격 낱말은 코인을 받고 투사체가 닿을 때 피해
  onFire(target, projectile) {
    if (target.kind === 'shop' || target.kind === 'spot') {
      this.projectiles = this.projectiles.filter(entry => entry !== projectile);
      if (target.kind === 'shop') this.selectShopItem(target.item);
      else this.placeAtSpot(target);
      return;
    }
    target.incomingDamage++;
    if (target.hp - target.incomingDamage <= 0) target.doomed = true;
    this.gainCoins(wordCoins(target.token.text.length, this.wave, this.combo), 'word');
  }

  onProjectileLanded(bug) {
    bug.incomingDamage = Math.max(0, bug.incomingDamage - 1);
    bug.doomed = false;
    this.damageBug(bug, 'typing');
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
    this.spots = spots.map(spot => ({ id: this.nextId++, kind: 'spot', ...spot, token: null }));
    for (const spot of this.spots) spot.token = this.pickSpotToken(spot.id);
    this.emit('build-mode', { tower: item.tower, upgrade: !canBuild, spots: this.spots.length });
    return { bought: false, buildMode: true };
  }

  // 자리 낱말은 짧게(빨리 고를 수 있게), 다른 목표와 첫 글자가 겹치지 않게
  pickSpotToken(excludeId) {
    const used = new Set(this.targetables().filter(entity => entity.id !== excludeId && entity.token).map(entity => entity.token.text[0]));
    for (let attempt = 0; attempt < 60; attempt++) {
      const token = this.drawWeightedToken();
      if (token.text.length <= DEFENSE_RULES.spotTokenMaxLength && !used.has(token.text[0])) return token;
    }
    return this.pickToken(excludeId);
  }

  cancelBuild(reason, { silent = false } = {}) {
    if (!this.buildMode) return { bought: false, reason: 'none' };
    this.buildMode = null;
    if (this.spots.some(spot => spot.id === this.targetId)) this.clearBuffer();
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
    const { towerGap } = PLACEMENT;
    const touched = this.towers.find(tower => Math.hypot((tower.x - point.x) / towerGap.x, (tower.y - point.y) / towerGap.y) < 0.6);
    if (touched) {
      if (touched.type === mode.tower && touched.level < DEFENSE_RULES.maxTowerLevel) return this.upgradeTower(touched);
      return this.denyPlace(touched.type === mode.tower ? 'max-level' : 'blocked', point);
    }
    if (this.towers.length >= DEFENSE_RULES.maxTowers) return this.denyPlace('max-towers', point);
    const problem = this.placementProblem(point);
    if (problem) return this.denyPlace(problem, point);
    const price = this.priceAt(mode.tower, null);
    if (this.coins < price) return this.denyPlace('coins', point, price);
    this.coins -= price;
    this.cancelBuild('placed', { silent: true });
    const tower = { id: this.nextId++, type: mode.tower, x: point.x, y: point.y, level: 1, readyAt: this.gameTime + 0.5, builtAt: this.gameTime };
    this.towers.push(tower);
    this.towersBuilt++;
    this.emit('tower-built', { tower, price });
    return { bought: true, tower };
  }

  upgradeTower(tower) {
    const mode = this.buildMode;
    if (!mode || !tower) return { bought: false, reason: 'no-mode' };
    const price = this.priceAt(mode.tower, tower);
    if (this.coins < price) return this.denyPlace('coins', tower, price);
    this.coins -= price;
    this.cancelBuild('placed', { silent: true });
    tower.level = Math.min(DEFENSE_RULES.maxTowerLevel, tower.level + 1);
    tower.upgradedAt = this.gameTime;
    this.emit('tower-upgraded', { tower, price });
    return { bought: true, tower };
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
