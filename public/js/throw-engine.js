// '휴대폰 던지기' 모드: 위에서 내려오는 로봇에게 토큰을 쳐서 휴대폰(아이템 사용 시 노트북)을 던진다.
// 좌표 x는 0(내 책상)~1(화면 오른쪽 끝). 공통 규칙(조준·입력·콤보·생명)은 TargetGameEngine에 있다.
import { SCORING, MAX_MULTIPLIER } from './engine.js';
import { rollRarity, tierValue, isRarity } from './item-rarity.js';
import { TargetGameEngine, ARCADE_RULES, filterArcadeTokens, randomBetween } from './target-game.js';

export const ROBOT_TYPES = Object.freeze({
  basic: Object.freeze({ label: '기본 로봇', hp: 1, speed: 0.075, bounty: 50, unlockAt: 0, weight: 1 }),
  fast: Object.freeze({ label: '빠른 로봇', hp: 1, speed: 0.15, bounty: 80, unlockAt: 15, weight: 0.45 }),
  tank: Object.freeze({ label: '탱크 로봇', hp: 2, speed: 0.042, bounty: 150, unlockAt: 35, weight: 0.3 }),
  // 느린 로봇: 휴대폰은 낱말 두 개(두 방), 노트북(두 개씩 던짐)은 한 번에
  slow: Object.freeze({ label: '달팽봇', hp: 2, speed: 0.036, bounty: 100, unlockAt: 8, weight: 0.4 }),
  // ---------- 특수 로봇(편대로만 나온다, weight 0) ----------
  // 방패봇: 같은 줄 뒤따르는 로봇을 막는다(방패봇이 쓰러져야 뒤 로봇을 조준할 수 있다)
  shield: Object.freeze({ label: '방패봇', hp: 2, speed: 0.05, bounty: 120, unlockAt: Infinity, weight: 0, special: true }),
  // 쌍둥이봇: 두 줄에 같은 낱말로 나란히. 한 번 치면 둘 다 맞는다
  twin: Object.freeze({ label: '쌍둥이봇', hp: 1, speed: 0.065, bounty: 70, unlockAt: Infinity, weight: 0, special: true }),
  // 카멜레온봇: 몇 초마다 낱말이 바뀐다(치는 중에는 안 바뀜)
  chameleon: Object.freeze({ label: '카멜레온봇', hp: 1, speed: 0.06, bounty: 110, unlockAt: Infinity, weight: 0, special: true }),
  // 분열봇: 쓰러지면 작은 로봇 둘로 나뉜다
  splitter: Object.freeze({ label: '분열봇', hp: 2, speed: 0.045, bounty: 100, unlockAt: Infinity, weight: 0, special: true }),
  mini: Object.freeze({ label: '꼬마봇', hp: 1, speed: 0.1, bounty: 40, unlockAt: Infinity, weight: 0, special: true }),
  // 거울봇: 낱말이 거꾸로 보인다(치는 건 원래 순서)
  mirror: Object.freeze({ label: '거울봇', hp: 1, speed: 0.07, bounty: 90, unlockAt: Infinity, weight: 0, special: true }),
  // 마지막 웨이브 보스 3종: 무작위로는 안 나오고(weight 0) 목표 처치 수를 채우면 셋 중 하나가 한 번 등장. 속도는 시간 가속을 받지 않는다
  boss: Object.freeze({ label: '보스 서버봇', hp: 10, speed: 0.017, bounty: 1000, unlockAt: Infinity, weight: 0, boss: true }),
  printer: Object.freeze({ label: '보스 프린터봇', hp: 11, speed: 0.015, bounty: 1000, unlockAt: Infinity, weight: 0, boss: true }),
  hacker: Object.freeze({ label: '보스 해커봇', hp: 9, speed: 0.019, bounty: 1000, unlockAt: Infinity, weight: 0, boss: true })
});

// 보스별 기술 목록: 충전(예고) 뒤 하나를 쓰고, 다음 기술은 목록에서 무작위(같은 기술 연속 금지)
export const BOSS_KINDS = Object.freeze({
  boss: Object.freeze({ skills: Object.freeze(['cannon', 'burst', 'dash']) }),
  printer: Object.freeze({ skills: Object.freeze(['spray', 'scroll', 'cannon']) }),
  hacker: Object.freeze({ skills: Object.freeze(['mask', 'decoy', 'cannon']) })
});
export const BOSS_SKILLS = Object.freeze({
  cannon: Object.freeze({ label: '패드 대포', icon: '⚡' }),
  burst: Object.freeze({ label: '2연발', icon: '⚡⚡' }),
  dash: Object.freeze({ label: '돌진', icon: '💨' }),
  spray: Object.freeze({ label: '종이 난사', icon: '📄' }),
  scroll: Object.freeze({ label: '두루마리', icon: '📜' }),
  mask: Object.freeze({ label: '화면 가리기', icon: '🕶' }),
  decoy: Object.freeze({ label: '봇 소환', icon: '🤖' })
});
export const SKILL_RULES = Object.freeze({
  dashDistance: 0.08,
  paperSpeed: 0.13,
  scrollSpeed: 0.085,
  scrollMaxLength: 10,
  maskSeconds: 4,
  decoyCount: 2
});

// 편대: unlockAt초부터 나오고, 나올 차례에 formationChance 확률로 무작위 로봇 대신 편대 하나
export const FORMATIONS = Object.freeze({
  mirror: Object.freeze({ label: '거울봇', unlockAt: 10, weight: 1 }),
  twins: Object.freeze({ label: '쌍둥이 편대', unlockAt: 20, weight: 1 }),
  shieldWall: Object.freeze({ label: '방패 편대', unlockAt: 30, weight: 0.9 }),
  chameleon: Object.freeze({ label: '카멜레온봇', unlockAt: 40, weight: 0.8 }),
  splitter: Object.freeze({ label: '분열봇', unlockAt: 55, weight: 0.8 })
});
export const FORMATION_RULES = Object.freeze({ chance: 0.38, followerGap: 0.13, followers: 2, morphSeconds: 3 });

// 보스전: 경고 뒤 화면 가운데(줄 4칸 너비)로 내려온다. 맞으면 조금 밀려나고 내 건전지가 1칸 찬다.
// 보스가 나온 뒤로는 다른 로봇이 나오지 않고, 보스는 주기적으로 가슴 대포로 패드를 쏜다(패드 낱말을 쳐서 맞히면 막고, 못 막으면 건전지 1칸). 책상에 닿으면 즉시 패배
export const BOSS_RULES = Object.freeze({
  warningSeconds: 2.5,
  // 몸집이 커서 문 앞이 아니라 조금 앞(아래)에서 나타난다. 밀려나도 이 지점보다 뒤로는 안 간다
  spawnX: 0.5,
  knockback: 0.03,
  healPerHit: 1,
  padFirstDelay: 3,
  padInterval: [5.5, 7.5],
  cannonChargeSeconds: 1.1,
  padSpeed: 0.2,
  padMaxLength: 6,
  padBlockBonus: 30,
  // 내 앞(playerX + reachGap)에 닿으면 멈춰 서서 주먹을 날린다(이 동안 대포는 쏘지 않는다).
  // 도착 후 punchFirstDelay 뒤 첫 펀치, 이후 punchDelay마다. 펀치는 punchWindupSeconds 동안 팔을 젖혔다가 명중 → 건전지 1칸.
  // 그 사이 보스를 맞혀 밀어내면 펀치가 취소된다
  reachGap: 0.13,
  punchFirstDelay: 1,
  punchDelay: 2.4,
  punchWindupSeconds: 0.75
});

export const ITEM_TYPES = Object.freeze({
  laptop: Object.freeze({ label: '노트북', effect: '잠깐 노트북 여러 개씩 투척' }),
  battery: Object.freeze({ label: '건전지', effect: '생명 회복(넘치면 보호막)' })
});
// 등급별 효과 [일반, 희귀, 영웅, 전설]. 가치(추가 처치 ≈ 초 × (개수 − 1), 회복 칸)가 대략 1 : 1.6 : 2.5 : 4가 되게:
//  노트북 6초×2개(6) · 10초×2개(10) · 8초×3개(16) · 12초×3개(24),  건전지 회복 1 · 2 · 3 · 4칸(가득 찬 뒤 남는 만큼 보호막)
export const ITEM_TIERS = Object.freeze({
  laptop: Object.freeze({ seconds: [6, 10, 8, 12], shots: [2, 2, 3, 3] }),
  battery: Object.freeze({ heal: [1, 2, 3, 4] })
});
// 보호막: 로봇·종이·보스 주먹에 한 번 맞는 걸 대신 막는다. 최대 개수
export const MAX_SHIELDS = 3;

// 시간이 지나면 로봇이 빨라진다: seconds초에 걸쳐 최대 (1 + max)배
const SPEED_RAMP = Object.freeze({ seconds: 240, max: 0.5 });

// 로봇 나오는 간격(초): start에서 시작해 1초에 perSecond씩 줄어 floor까지. 레벨 배율·±20% 흔들림을 곱한다
const SPAWN_PACE = Object.freeze({ start: 3.4, perSecond: 0.012, floor: 1.5 });

// shots: 낱말 하나에 던지는 개수. 노트북은 두 개 — 목표가 한 방이면 두 번째는 옆 로봇에게 간다(없으면 하나만)
export const WEAPONS = Object.freeze({
  phone: Object.freeze({ label: '휴대폰', damage: 1, shots: 1 }),
  laptop: Object.freeze({ label: '노트북', damage: 1, shots: 2 })
});
const MAX_LAPTOP_SHOTS = Math.max(...ITEM_TIERS.laptop.shots);
// 두 번째 노트북이 첫 번째보다 늦게 손을 떠나는 시간(초)
const SECOND_SHOT_DELAY = 0.1;

export const THROW_RULES = Object.freeze({
  lanes: 4,
  playerX: 0.09,
  spawnX: 1.04,
  maxRobots: 6,
  dyingSeconds: 0.5,
  laptopSeconds: 8,
  // 건전지(회복)는 노트북과 따로, 생명이 깎여 있을 때만 가끔 나온다
  batteryFirstDelay: [6, 10],
  batteryInterval: [14, 22],
  itemSpeed: 0.06,
  // 같은 줄 두 목표 사이에 늘 남겨 둘 거리(로봇 몸 + 낱말 발판 높이). 자리가 없으면 spawnRetrySeconds 뒤 다시 시도
  laneGap: 0.15,
  spawnRetrySeconds: 0.25,
  firstItemAt: [18, 26],
  // 로봇을 이만큼 처치하면 승리로 판이 끝난다. 마지막 처치 연출을 winPauseSeconds만큼 보여 준 뒤 finish
  goalKills: 50,
  winPauseSeconds: 1.2,
  itemInterval: [22, 32],
  maxFrameSeconds: ARCADE_RULES.maxFrameSeconds
});

// 서버 점수 검증용 상한: 글자당 (최대 배율 타격 점수) + (낱말 하나로 얻을 수 있는 처치 보너스 / 최소 토큰 길이).
// 노트북은 낱말 하나에 최대 shots대를 처치할 수 있다(목표 + 옆 로봇). 보스 보너스는 한 판에 한 번이고
// 보스까지 가려면 최소 goalKills × 최소 토큰 길이만큼 쳐야 하므로 그만큼 나눠 더한다
export const MAX_POINTS_PER_CHARACTER = SCORING.basePoints * MAX_MULTIPLIER
  + (MAX_LAPTOP_SHOTS * 2 * Math.max(...Object.values(ROBOT_TYPES).filter(type => !type.boss).map(type => type.bounty))) / ARCADE_RULES.minTokenLength
  + Math.max(...Object.values(ROBOT_TYPES).filter(type => type.boss).map(type => type.bounty)) / (THROW_RULES.goalKills * ARCADE_RULES.minTokenLength);

export const filterThrowTokens = filterArcadeTokens;

export class ThrowEngine extends TargetGameEngine {
  constructor(options) {
    super({ ...options, mode: 'throw' });
    this.lanes = Number.isInteger(options.lanes) && options.lanes >= 2 && options.lanes <= 6 ? options.lanes : THROW_RULES.lanes;
    this.robots = [];
    this.items = [];
    this.laptopUntil = 0;
    this.laptopShots = WEAPONS.laptop.shots;
    this.laptopSpan = THROW_RULES.laptopSeconds;
    this.shields = 0;
    // 밸런스 통계용: '아이템:등급' → 먹은 수
    this.itemLog = {};
    this.nextSpawnAt = 0.4;
    this.nextItemAt = randomBetween(this.random, THROW_RULES.firstItemAt);
    this.nextBatteryAt = Infinity;
    this.kills = Object.fromEntries(Object.keys(ROBOT_TYPES).map(type => [type, 0]));
    this.outcome = null;
    this.winAt = null;
    // 보스전 상태(패드·스킬 포함): null → 'warning'(경고 중) → 'fight'(보스 등장) → 'defeated'
    this.bossPhase = null;
    this.bossAt = Infinity;
    this.bossId = null;
    this.pads = [];
    this.nextPadAt = Infinity;
    // specials: 특수 로봇 편대·보스 3종·보스 기술 무작위(게임에서 켬). 끄면 예전처럼 무작위 로봇과 서버봇(대포만)
    this.specials = Boolean(options.specials);
    this.bossKind = this.specials ? null : 'boss';
    this.maskUntil = 0;
  }

  targetables() {
    return [
      ...this.robots.filter(robot => robot.state === 'walking' && !robot.doomed && !this.isGuarded(robot)),
      ...this.items.filter(item => !item.consumed),
      ...this.pads.filter(pad => !pad.consumed)
    ];
  }

  findEntity(id) {
    return this.robots.find(robot => robot.id === id) ?? this.items.find(item => item.id === id)
      ?? this.pads.find(pad => pad.id === id) ?? null;
  }

  // 방패봇 뒤 로봇: 같은 줄에서 자기보다 앞(책상 쪽)에 살아 있는 방패봇이 있으면 조준할 수 없다
  isGuarded(robot) {
    if (robot.guardedBy == null) return false;
    const shield = this.robots.find(other => other.id === robot.guardedBy);
    return Boolean(shield && shield.state === 'walking' && shield.x < robot.x);
  }

  robotSpeed(robot) {
    return robot.speed ?? ROBOT_TYPES[robot.type].speed;
  }

  // 책상에 가까운(x가 작은) 목표부터 조준
  targetPriority(entity) {
    return entity.x;
  }

  currentWeapon() {
    return this.laptopRemaining() > 0 ? 'laptop' : 'phone';
  }

  laptopRemaining() {
    return Math.max(0, this.laptopUntil - this.gameTime);
  }

  boss() {
    return this.bossId == null ? null : this.robots.find(robot => robot.id === this.bossId) ?? null;
  }

  speedMultiplier() {
    return (1 + Math.min(this.gameTime / SPEED_RAMP.seconds, SPEED_RAMP.max)) * this.difficulty.speed;
  }

  spawnInterval() {
    const base = Math.max(SPAWN_PACE.floor, SPAWN_PACE.start - this.gameTime * SPAWN_PACE.perSecond);
    return base * this.difficulty.spawn * (0.8 + this.random() * 0.4);
  }

  step(frameSeconds) {
    if (this.winAt != null && this.gameTime >= this.winAt) {
      this.finish();
      return;
    }
    this.moveEntities(frameSeconds);
    this.removeFinished();
    if (this.status !== 'running' || this.winAt != null) return;
    this.morphChameleons();
    if (this.bossPhase) this.stepBossWave();
    else this.spawnIfDue();
  }

  // 보스전 동안에는 로봇이 더 나오지 않는다: 경고가 끝나면 보스 등장, 이후 대포 스킬과 아이템만
  stepBossWave() {
    if (this.bossPhase === 'warning' && this.gameTime >= this.bossAt) this.spawnBoss();
    if (this.bossPhase !== 'fight') return;
    const boss = this.boss();
    if (!boss || boss.state !== 'walking') return;
    if (boss.x <= this.bossReachX() + 1e-9) this.stepBossMelee(boss);
    else {
      // 맞고 밀려나면 펀치는 취소되고 다시 걸어오며 대포를 쓴다
      if (boss.inMelee) this.emit('boss-pushed', { boss });
      boss.inMelee = false;
      boss.punchStartAt = null;
      this.stepSkill(boss);
    }
    this.spawnItemsIfDue();
  }

  bossReachX() {
    return THROW_RULES.playerX + BOSS_RULES.reachGap;
  }

  // 근접: 대포 충전은 취소하고, 딜레이 → 팔 젖히기(windup) → 명중(건전지 1칸)을 되풀이한다
  stepBossMelee(boss) {
    if (!boss.inMelee) {
      boss.inMelee = true;
      boss.chargeUntil = null;
      boss.punchStartAt = null;
      boss.nextPunchAt = this.gameTime + BOSS_RULES.punchFirstDelay;
      this.emit('boss-reached', { boss });
      return;
    }
    if (boss.punchStartAt == null) {
      if (this.gameTime < boss.nextPunchAt) return;
      boss.punchStartAt = this.gameTime;
      boss.punchCount = (boss.punchCount ?? 0) + 1;
      this.emit('boss-windup', { boss });
      return;
    }
    if (this.gameTime < boss.punchStartAt + BOSS_RULES.punchWindupSeconds) return;
    boss.punchStartAt = null;
    boss.punchedAt = this.gameTime;
    boss.nextPunchAt = this.gameTime + BOSS_RULES.punchDelay;
    this.emit('boss-punch', { boss });
    this.loseLife({ robot: boss, punch: true });
    if (this.status === 'running' && this.nextBatteryAt === Infinity) this.scheduleBattery(THROW_RULES.batteryFirstDelay);
  }

  // 보스 기술: 충전(예고, cannonChargeSeconds) 동안 어떤 기술인지 알리고, 다 모이면 쓴다. 날아오는 패드가 남아 있으면 기다린다.
  // 다음 기술은 이 보스의 목록에서 무작위(방금 쓴 기술은 빼고) — 판마다 순서가 다르다
  stepSkill(boss) {
    if (boss.chargeUntil != null) {
      if (this.gameTime >= boss.chargeUntil) this.useSkill(boss, boss.skill);
      return;
    }
    if (this.gameTime < this.nextPadAt || this.pads.some(pad => !pad.consumed)) return;
    const skills = this.specials ? (BOSS_KINDS[boss.type] ?? BOSS_KINDS.boss).skills : ['cannon'];
    const choices = skills.length > 1 ? skills.filter(skill => skill !== boss.lastSkill) : skills;
    boss.skill = choices[Math.floor(this.random() * choices.length)];
    boss.chargeUntil = this.gameTime + BOSS_RULES.cannonChargeSeconds;
    this.emit('boss-charge', { boss, skill: boss.skill });
  }

  useSkill(boss, skill) {
    boss.chargeUntil = null;
    boss.firedAt = this.gameTime;
    boss.lastSkill = skill;
    this.nextPadAt = this.gameTime + randomBetween(this.random, BOSS_RULES.padInterval);
    const lanes = this.bossLanes(boss);
    if (skill === 'burst') {
      lanes.slice(0, 2).forEach((lane, index) => this.firePad(boss, { lane, delay: index * 0.25 }));
    } else if (skill === 'dash') {
      boss.x = Math.max(this.bossReachX(), boss.x - SKILL_RULES.dashDistance);
      this.emit('boss-dash', { boss });
    } else if (skill === 'spray') {
      [...Array(this.lanes).keys()].sort(() => this.random() - 0.5).slice(0, 3)
        .forEach(lane => this.firePad(boss, { lane, speed: SKILL_RULES.paperSpeed, paper: true }));
    } else if (skill === 'scroll') {
      this.firePad(boss, { lane: lanes[0], speed: SKILL_RULES.scrollSpeed, paper: true, scroll: true, maxLength: SKILL_RULES.scrollMaxLength, minLength: 7 });
    } else if (skill === 'mask') {
      this.maskUntil = this.gameTime + SKILL_RULES.maskSeconds;
      this.emit('boss-mask', { boss, seconds: SKILL_RULES.maskSeconds });
    } else if (skill === 'decoy') {
      const minions = [];
      for (let index = 0; index < SKILL_RULES.decoyCount; index++) {
        const lane = this.chooseLane(ROBOT_TYPES.basic.speed);
        if (lane !== null) minions.push(this.spawnRobot('basic', lane));
      }
      this.emit('boss-decoy', { boss, minions });
    } else {
      this.firePad(boss);
    }
    this.emit('boss-skill', { boss, skill });
  }

  // 보스 앞 줄들(가운데 두 줄부터). 보스 lane은 화면 가운데(소수)라 가까운 정수 줄을 고른다
  bossLanes(boss) {
    return [...Array(this.lanes).keys()].sort((a, b) => Math.abs(a - boss.lane) - Math.abs(b - boss.lane) || a - b);
  }

  // 화면 가리기(해커봇): 이 시간 동안 낱말 글자 일부가 가려 보인다(화면에서 처리)
  isMasked() {
    return this.gameTime < this.maskUntil;
  }

  firePad(boss, { lane = boss.lane, speed = BOSS_RULES.padSpeed, paper = false, scroll = false, maxLength = BOSS_RULES.padMaxLength, minLength = 0, delay = 0 } = {}) {
    const pad = { id: this.nextId++, kind: 'pad', lane, x: boss.x - 0.03 + delay * speed, speed, paper, scroll, consumed: false, firedAt: this.gameTime, token: null };
    pad.token = this.pickShortToken(pad.id, maxLength, minLength);
    this.pads.push(pad);
    this.emit('boss-fire', { boss, pad });
    return pad;
  }

  // 패드는 빨리 날아오므로 짧은 낱말(첫 글자가 다른 목표와 겹치지 않게). 못 찾으면 보통 낱말
  pickShortToken(excludeId, maxLength = BOSS_RULES.padMaxLength, minLength = 0) {
    const used = new Set(this.targetables().filter(entity => entity.id !== excludeId).map(entity => entity.token.text[0]));
    for (let attempt = 0; attempt < 60; attempt++) {
      const token = this.drawWeightedToken();
      if (token.text.length <= maxLength && token.text.length >= minLength && !used.has(token.text[0])) return token;
    }
    return this.pickToken(excludeId);
  }

  // 보스는 가운데 쪽 줄에서 나온다(줄이 짝수면 가운데 둘 중 하나)
  spawnBoss() {
    // lane은 줄 번호가 아니라 화면 가운데((줄 수 - 1) / 2, 4줄이면 1.5) — 어느 줄에도 속하지 않아 일반 줄 계산에서 빠진다
    const boss = this.spawnRobot(this.bossKind ?? 'boss', (this.lanes - 1) / 2);
    boss.x = BOSS_RULES.spawnX;
    boss.chargeUntil = null;
    boss.firedAt = -Infinity;
    this.nextPadAt = this.gameTime + BOSS_RULES.padFirstDelay;
    this.bossId = boss.id;
    this.bossPhase = 'fight';
    this.emit('boss-appear', { boss });
  }

  totalKills() {
    return Object.values(this.kills).reduce((sum, count) => sum + count, 0);
  }

  // 목표 처치 수를 채우면 마지막 웨이브(보스전)가 시작된다. 일반 로봇은 더 나오지 않는다
  checkGoal() {
    if (this.bossPhase || this.totalKills() < THROW_RULES.goalKills) return;
    // 보스는 셋 중 무작위(bossKind를 미리 정해 두면 그 보스)
    const kinds = Object.keys(BOSS_KINDS);
    this.bossKind ??= kinds[Math.floor(this.random() * kinds.length)];
    this.bossPhase = 'warning';
    this.bossAt = this.gameTime + BOSS_RULES.warningSeconds;
    this.emit('boss-warning', { kills: this.totalKills(), seconds: BOSS_RULES.warningSeconds, kind: this.bossKind });
  }

  // 보스를 쓰러뜨리면 남은 졸개는 그대로 두고 잠시 뒤 승리로 끝낸다
  winBossFight() {
    this.bossPhase = 'defeated';
    this.outcome = 'cleared';
    this.winAt = this.gameTime + THROW_RULES.winPauseSeconds;
    this.clearBuffer();
    this.emit('goal', { kills: this.totalKills(), boss: true });
  }

  // 승리 연출 중에는 입력도, 로봇이 선을 넘어 생명이 깎이는 것도 막는다
  input(character, nowMs) {
    if (this.winAt != null) return { accepted: false, reason: 'finished' };
    return super.input(character, nowMs);
  }

  loseLife(cause) {
    if (this.winAt != null) return;
    // 보호막이 있으면 생명 대신 보호막 하나가 깨진다(콤보도 유지)
    if (this.shields > 0) {
      this.shields--;
      this.emit('shield-block', { cause, shields: this.shields });
      return;
    }
    super.loseLife(cause);
    if (this.status === 'finished') this.outcome = 'overrun';
  }

  // ---------- 스폰 ----------
  chooseRobotType() {
    const unlocked = Object.entries(ROBOT_TYPES).filter(([, type]) => this.gameTime >= type.unlockAt);
    const totalWeight = unlocked.reduce((sum, [, type]) => sum + type.weight, 0);
    let roll = this.random() * totalWeight;
    for (const [key, type] of unlocked) {
      roll -= type.weight;
      if (roll <= 0) return key;
    }
    return unlocked[unlocked.length - 1][0];
  }

  // 줄 위의 움직이는 목표(걷는 로봇·안 먹은 아이템): 위치, 기본 속도, 로봇인지
  laneOccupants(lane) {
    const robots = this.robots
      .filter(robot => robot.lane === lane && robot.state === 'walking')
      .map(robot => ({ x: robot.x, speed: this.robotSpeed(robot), robot: true }));
    const items = this.items
      .filter(item => item.lane === lane && !item.consumed)
      .map(item => ({ x: item.x, speed: THROW_RULES.itemSpeed, robot: false }));
    return [...robots, ...items];
  }

  // 새 목표를 이 줄 끝에 내보내도 겹치지 않는가: 출현 지점이 laneGap만큼 비어 있고, 더 빠르면 앞 목표가
  // 내 책상에 닿기 전에 laneGap 안으로 따라잡지 않아야 한다. 로봇끼리는 속도 배율이 같아 기본 속도 비율만 보면 되고,
  // 아이템은 배율을 안 받으므로 로봇 속도를 안전한 쪽(뒤 로봇은 최대 배율, 앞 로봇은 지금 배율)으로 잡는다. O(줄 위 목표 수)
  laneFits(lane, speed, isRobot = true) {
    const now = this.speedMultiplier();
    const max = (1 + SPEED_RAMP.max) * this.difficulty.speed;
    return this.laneOccupants(lane).every(ahead => {
      const distance = THROW_RULES.spawnX - ahead.x;
      if (distance < THROW_RULES.laneGap) return false;
      const sameScale = isRobot && ahead.robot;
      const mine = sameScale || !isRobot ? speed : speed * max;
      const theirs = sameScale || !ahead.robot ? ahead.speed : ahead.speed * now;
      if (mine <= theirs) return true;
      const catchUpTime = (distance - THROW_RULES.laneGap) / (mine - theirs);
      const arrivalTime = (ahead.x - THROW_RULES.playerX) / theirs;
      return catchUpTime >= arrivalTime;
    });
  }

  // 겹치지 않는 줄 가운데 무작위. 그런 줄이 없으면 null(조금 뒤 다시 시도)
  chooseLane(speed = ROBOT_TYPES.basic.speed, isRobot = true) {
    const lanes = [...Array(this.lanes).keys()].filter(lane => this.laneFits(lane, speed, isRobot));
    if (!lanes.length) return null;
    return lanes[Math.floor(this.random() * lanes.length)];
  }

  // 뽑힌 종류가 들어갈 줄이 없으면 느린 종류부터 대신 넣어 본다(빠른 로봇이 앞 로봇을 따라잡아 겹치지 않게)
  chooseSpawn() {
    const chosen = this.chooseRobotType();
    const fallbacks = Object.entries(ROBOT_TYPES)
      .filter(([key, type]) => key !== chosen && this.gameTime >= type.unlockAt)
      .sort(([, first], [, second]) => first.speed - second.speed)
      .map(([key]) => key);
    for (const typeKey of [chosen, ...fallbacks]) {
      const lane = this.chooseLane(ROBOT_TYPES[typeKey].speed);
      if (lane !== null) return { typeKey, lane };
    }
    return null;
  }

  spawnIfDue() {
    if (this.gameTime >= this.nextSpawnAt) {
      const crowded = this.robots.filter(robot => robot.state === 'walking').length >= THROW_RULES.maxRobots;
      const formation = crowded ? null : this.trySpawnFormation();
      const spawn = crowded || formation ? null : this.chooseSpawn();
      if (spawn) this.spawnRobot(spawn.typeKey, spawn.lane);
      this.nextSpawnAt = this.gameTime + (spawn || formation || crowded ? this.spawnInterval() * (formation ? 1.4 : 1) : THROW_RULES.spawnRetrySeconds);
    }
    this.spawnItemsIfDue();
  }

  // ---------- 편대 ----------
  // 열린 편대 중 가중치로 하나를 골라(chance 확률) 내보낸다. 들어갈 줄이 없으면 null(평소 로봇으로)
  trySpawnFormation() {
    if (!this.specials) return null;
    const open = Object.entries(FORMATIONS).filter(([, formation]) => this.gameTime >= formation.unlockAt);
    if (!open.length || this.random() >= FORMATION_RULES.chance) return null;
    let roll = this.random() * open.reduce((sum, [, formation]) => sum + formation.weight, 0);
    let key = open.at(-1)[0];
    for (const [name, formation] of open) {
      roll -= formation.weight;
      if (roll <= 0) { key = name; break; }
    }
    const robots = this.spawnFormation(key);
    if (robots.length) this.emit('formation', { formation: key, robots });
    return robots.length ? key : null;
  }

  spawnFormation(key) {
    if (key === 'shieldWall') {
      const speed = ROBOT_TYPES.shield.speed;
      const lane = this.chooseLane(speed);
      if (lane === null) return [];
      const shield = this.spawnRobot('shield', lane);
      const robots = [shield];
      for (let index = 1; index <= FORMATION_RULES.followers; index++) {
        const follower = this.spawnRobot(index === 1 ? 'basic' : 'fast', lane, { x: THROW_RULES.spawnX + FORMATION_RULES.followerGap * index, speed, guardedBy: shield.id });
        robots.push(follower);
      }
      return robots;
    }
    if (key === 'twins') {
      const speed = ROBOT_TYPES.twin.speed;
      const lanes = [...Array(this.lanes).keys()].filter(lane => this.laneFits(lane, speed));
      if (lanes.length < 2) return [];
      const [first, second] = lanes.sort(() => this.random() - 0.5);
      const left = this.spawnRobot('twin', first);
      const right = this.spawnRobot('twin', second, { token: left.token });
      left.twinId = right.id;
      right.twinId = left.id;
      return [left, right];
    }
    const type = key === 'chameleon' ? 'chameleon' : key === 'splitter' ? 'splitter' : 'mirror';
    const lane = this.chooseLane(ROBOT_TYPES[type].speed);
    if (lane === null) return [];
    const robot = this.spawnRobot(type, lane);
    if (type === 'chameleon') robot.nextMorphAt = this.gameTime + FORMATION_RULES.morphSeconds;
    if (type === 'mirror') robot.mirror = true;
    return [robot];
  }

  // 카멜레온봇: 때가 되면 낱말을 바꾼다. 내가 그 로봇을 치고 있으면 다 칠 때까지 기다린다
  morphChameleons() {
    for (const robot of this.robots) {
      if (robot.type !== 'chameleon' || robot.state !== 'walking' || robot.doomed) continue;
      if (this.gameTime < robot.nextMorphAt || this.targetId === robot.id) continue;
      robot.token = this.pickToken(robot.id);
      robot.nextMorphAt = this.gameTime + FORMATION_RULES.morphSeconds;
      robot.morphedAt = this.gameTime;
      this.emit('morph', { robot });
    }
  }

  // 분열봇이 쓰러지면 그 자리에서 꼬마봇 둘(같은 줄과 옆 줄)
  splitRobot(robot) {
    const neighbor = robot.lane + (robot.lane + 1 < this.lanes ? 1 : -1);
    const minis = [robot.lane, neighbor].map((lane, index) => this.spawnRobot('mini', lane, { x: robot.x + 0.02 + index * 0.03, short: true }));
    this.emit('split', { robot, minis });
    return minis;
  }

  spawnItemsIfDue() {
    if (this.gameTime >= this.nextBatteryAt && !this.items.some(item => !item.consumed && item.item === 'battery')) {
      const lane = this.chooseLane(THROW_RULES.itemSpeed, false);
      if (lane === null) this.nextBatteryAt = this.gameTime + THROW_RULES.spawnRetrySeconds;
      else {
        this.spawnItem(lane, 'battery');
        this.scheduleBattery(THROW_RULES.batteryInterval);
      }
    }
    if (this.gameTime >= this.nextItemAt && !this.items.some(item => !item.consumed && item.item === 'laptop')) {
      const lane = this.chooseLane(THROW_RULES.itemSpeed, false);
      if (lane === null) this.nextItemAt = this.gameTime + THROW_RULES.spawnRetrySeconds;
      else {
        this.spawnItem(lane);
        this.nextItemAt = this.gameTime + randomBetween(this.random, THROW_RULES.itemInterval);
      }
    }
  }

  // options: x(출현 위치), speed(속도 덮어쓰기 — 편대가 같은 속도로 걷게), guardedBy(방패봇 id), token(쌍둥이), short(짧은 낱말)
  spawnRobot(typeKey = this.chooseRobotType(), lane = this.chooseLane(ROBOT_TYPES[typeKey].speed) ?? 0, options = {}) {
    const type = ROBOT_TYPES[typeKey];
    const robot = {
      id: this.nextId++, kind: 'robot', type: typeKey, lane, x: options.x ?? THROW_RULES.spawnX,
      hp: type.hp, maxHp: type.hp, incomingDamage: 0, doomed: false,
      state: 'walking', stateAt: this.gameTime, hitAt: -1, spawnedAt: this.gameTime, token: null
    };
    if (options.speed != null) robot.speed = options.speed;
    if (options.guardedBy != null) robot.guardedBy = options.guardedBy;
    robot.token = options.token ?? (options.short ? this.pickShortToken(robot.id) : this.pickToken(robot.id));
    this.robots.push(robot);
    this.emit('spawn', { robot });
    return robot;
  }

  // 정기 아이템은 노트북(강력한 무기). 회복용 건전지는 scheduleBattery가 따로 관리한다 — 원작의 하트 케이크
  chooseItemType() {
    return 'laptop';
  }

  isDamaged() {
    return this.lives < ARCADE_RULES.startLives;
  }

  // 생명이 깎이면 몇 초 뒤 첫 건전지, 이후에도 깎여 있는 동안 간격을 두고 계속. 가득 차면 멈춘다
  scheduleBattery(delayRange) {
    this.nextBatteryAt = this.isDamaged() ? this.gameTime + randomBetween(this.random, delayRange) : Infinity;
  }

  spawnItem(lane = this.chooseLane(THROW_RULES.itemSpeed, false) ?? 0, itemType = this.chooseItemType()) {
    const item = { id: this.nextId++, kind: 'item', item: itemType, rarity: rollRarity(this.random), lane, x: THROW_RULES.spawnX, consumed: false, token: null };
    item.token = this.pickToken(item.id);
    this.items.push(item);
    this.emit('item-spawn', { item });
    return item;
  }

  // ---------- 이동·충돌 ----------
  moveEntities(frameSeconds) {
    const multiplier = this.speedMultiplier();
    for (const robot of this.robots) {
      if (robot.state !== 'walking') continue;
      const type = ROBOT_TYPES[robot.type];
      robot.x -= this.robotSpeed(robot) * (type.boss ? this.difficulty.speed : multiplier) * frameSeconds;
      // 보스는 내 앞에서 멈춰 선다(펀치는 stepBossMelee)
      if (type.boss) {
        robot.x = Math.max(this.bossReachX(), robot.x);
        continue;
      }
      if (robot.x <= THROW_RULES.playerX) this.robotReachedPlayer(robot);
      if (this.status !== 'running') return;
    }
    for (const pad of this.pads) {
      if (pad.consumed) continue;
      pad.x -= (pad.speed ?? BOSS_RULES.padSpeed) * this.difficulty.speed * frameSeconds;
      if (pad.x <= THROW_RULES.playerX) this.padReachedPlayer(pad);
      if (this.status !== 'running') return;
    }
    for (const item of this.items) {
      if (item.consumed) continue;
      item.x -= THROW_RULES.itemSpeed * frameSeconds;
      if (item.x <= THROW_RULES.playerX) {
        item.consumed = true;
        item.missed = true;
        this.releaseTargetIf(item.id, 'item-missed');
      }
    }
  }

  robotReachedPlayer(robot) {
    robot.state = 'crashed';
    robot.stateAt = this.gameTime;
    this.releaseTargetIf(robot.id, 'robot-crashed');
    this.loseLife({ robot });
    if (this.status === 'running' && this.nextBatteryAt === Infinity) this.scheduleBattery(THROW_RULES.batteryFirstDelay);
  }

  // 막지 못한 패드는 건전지 1칸을 깎는다
  padReachedPlayer(pad) {
    pad.consumed = true;
    pad.hitPlayer = true;
    this.releaseTargetIf(pad.id, 'pad-hit');
    this.emit('pad-hit', { pad });
    this.loseLife({ pad });
    if (this.status === 'running' && this.nextBatteryAt === Infinity) this.scheduleBattery(THROW_RULES.batteryFirstDelay);
  }

  removeFinished() {
    this.robots = this.robots.filter(robot =>
      robot.state === 'walking' || this.gameTime - robot.stateAt < THROW_RULES.dyingSeconds);
    const inFlight = entity => this.projectiles.some(projectile => projectile.targetId === entity.id);
    this.items = this.items.filter(item => !item.consumed || inFlight(item));
    this.pads = this.pads.filter(pad => !pad.consumed || inFlight(pad));
  }

  // ---------- 발사·명중 ----------
  // 아이템·패드는 한 개로 끝. 로봇에게는 무기의 shots만큼 던진다: 목표가 아직 안 죽으면 같은 목표에,
  // 이미 죽을 만큼 맞았으면 옆 로봇에게. 옆 로봇도 없으면 남은 것은 던지지 않는다
  onFire(target, projectile) {
    const weapon = projectile.weapon === 'laptop' ? { ...WEAPONS.laptop, shots: this.laptopShots } : WEAPONS[projectile.weapon];
    projectile.damage = weapon.damage;
    projectile.lane = target.lane;
    if (target.kind === 'item' || target.kind === 'pad') {
      target.consumed = true;
      return;
    }
    this.applyIncoming(target, projectile);
    // 쌍둥이: 같은 낱말이라 짝에게도 같은 무기로 한 발
    const twin = target.twinId != null ? this.robots.find(robot => robot.id === target.twinId && robot.state === 'walking' && !robot.doomed) : null;
    if (twin) {
      const echo = { id: this.nextId++, targetId: twin.id, weapon: projectile.weapon, damage: weapon.damage, lane: twin.lane, launchedAt: this.gameTime + SECOND_SHOT_DELAY, extra: true };
      this.projectiles.push(echo);
      this.applyIncoming(twin, echo);
      this.emit('twin-hit', { robot: target, twin });
    }
    for (let shot = 1; shot < weapon.shots; shot++) {
      const next = target.hp - target.incomingDamage > 0 ? target : this.neighborRobot(target);
      if (!next) break;
      const extra = { id: this.nextId++, targetId: next.id, weapon: projectile.weapon, damage: weapon.damage,
        lane: next.lane, launchedAt: this.gameTime + SECOND_SHOT_DELAY * shot, extra: true };
      this.projectiles.push(extra);
      this.applyIncoming(next, extra);
    }
  }

  // 날아가는 중인 피해를 미리 셈해 두고, 다 죽을 만큼이면 조준에서 빼고(doomed), 아니면 새 낱말을 준다
  applyIncoming(robot, projectile) {
    robot.incomingDamage += projectile.damage;
    if (robot.hp - robot.incomingDamage > 0) robot.token = this.pickToken(robot.id);
    else robot.doomed = true;
  }

  // 목표 옆 로봇: 아직 걷고 있고 죽을 만큼 맞지 않은 다른 로봇 가운데 목표와 화면에서 가장 가까운 것.
  // 거리 = 줄 차이 × 0.25 + 앞뒤 거리. O(로봇 수)
  neighborRobot(target) {
    let best = null;
    let bestDistance = Infinity;
    for (const robot of this.robots) {
      if (robot === target || robot.state !== 'walking' || robot.hp - robot.incomingDamage <= 0) continue;
      const distance = Math.abs(robot.lane - target.lane) * 0.25 + Math.abs(robot.x - target.x);
      if (distance < bestDistance) {
        best = robot;
        bestDistance = distance;
      }
    }
    return best;
  }

  onProjectileLanded(entity, projectile) {
    if (entity.kind === 'item') this.activateItem(entity);
    else if (entity.kind === 'pad') this.blockPad(entity);
    else this.damageRobot(entity, projectile);
  }

  // 보스를 때릴 때마다 건전지(생명) 1칸 회복(가득이면 그대로)
  healFromBossHit() {
    if (this.lives >= ARCADE_RULES.startLives) return;
    this.lives = Math.min(ARCADE_RULES.startLives, this.lives + BOSS_RULES.healPerHit);
    if (!this.isDamaged()) this.nextBatteryAt = Infinity;
    this.emit('heal', { lives: this.lives });
  }

  blockPad(pad) {
    pad.blocked = true;
    this.score += BOSS_RULES.padBlockBonus;
    this.emit('pad-blocked', { pad, bonus: BOSS_RULES.padBlockBonus });
  }

  // 아이템 효과(등급별): 건전지 = heal칸 회복, 가득 차고 남는 만큼 보호막. 노트북 = seconds초 동안 shots개씩.
  // 노트북을 이어 먹으면 시간은 더하고 개수는 둘 중 큰 쪽
  activateItem(item) {
    this.itemsCollected++;
    const rarity = isRarity(item.rarity) ? item.rarity : 'common';
    this.itemLog[`${item.item}:${rarity}`] = (this.itemLog[`${item.item}:${rarity}`] ?? 0) + 1;
    if (item.item === 'battery') {
      const heal = tierValue(ITEM_TIERS.battery.heal, rarity);
      const missing = ARCADE_RULES.startLives - this.lives;
      const restored = Math.min(heal, missing);
      const shieldsGained = Math.min(MAX_SHIELDS - this.shields, heal - restored);
      this.lives += restored;
      this.shields += Math.max(0, shieldsGained);
      if (!this.isDamaged()) this.nextBatteryAt = Infinity;
      this.emit('item', { item, lives: this.lives, restored, shields: this.shields, shieldsGained: Math.max(0, shieldsGained) });
      return;
    }
    const seconds = tierValue(ITEM_TIERS.laptop.seconds, rarity);
    const shots = tierValue(ITEM_TIERS.laptop.shots, rarity);
    this.laptopShots = this.laptopRemaining() > 0 ? Math.max(this.laptopShots, shots) : shots;
    this.laptopUntil = Math.max(this.laptopUntil, this.gameTime) + seconds;
    this.laptopSpan = this.laptopRemaining();
    this.emit('item', { item, laptopSeconds: this.laptopRemaining(), shots: this.laptopShots });
  }

  damageRobot(robot, projectile) {
    if (robot.state !== 'walking') return;
    robot.hp = Math.max(0, robot.hp - projectile.damage);
    robot.incomingDamage = Math.max(0, robot.incomingDamage - projectile.damage);
    robot.hitAt = this.gameTime;
    this.emit('hit', { robot, weapon: projectile.weapon, damage: projectile.damage });
    if (ROBOT_TYPES[robot.type].boss) this.healFromBossHit();
    if (robot.hp > 0) {
      // 보스는 맞을 때마다 뒤로 조금 밀려난다(출현 지점은 넘지 않게)
      if (ROBOT_TYPES[robot.type].boss) robot.x = Math.min(BOSS_RULES.spawnX, robot.x + BOSS_RULES.knockback * projectile.damage);
      return;
    }
    robot.state = 'dying';
    robot.stateAt = this.gameTime;
    const bounty = ROBOT_TYPES[robot.type].bounty;
    this.kills[robot.type]++;
    this.score += bounty;
    this.releaseTargetIf(robot.id, 'robot-destroyed');
    this.emit('kill', { robot, bounty, weapon: projectile.weapon });
    if (robot.type === 'splitter' && this.winAt == null) this.splitRobot(robot);
    if (robot.id === this.bossId) this.winBossFight();
    else this.checkGoal();
  }

  snapshotExtras() {
    return { laptopRemaining: this.laptopRemaining(), powerRemaining: this.laptopRemaining(), powerSeconds: Math.max(this.laptopRemaining(), this.laptopSpan), laptopShots: this.laptopShots, shields: this.shields, bossPhase: this.bossPhase, bossKind: this.bossKind, masked: this.isMasked() };
  }

  summaryExtras() {
    // bossDamage: 보스에게 입힌 피해 비율(0~1) — 보스전에서 져도 진행 보상에 반영
    const boss = this.boss();
    const bossDefeated = this.bossPhase === 'defeated';
    const bossDamage = bossDefeated ? 1 : boss && boss.maxHp > 0 ? Math.max(0, Math.min(1, 1 - boss.hp / boss.maxHp)) : 0;
    return { kills: { ...this.kills }, totalKills: this.totalKills(), goalKills: THROW_RULES.goalKills, bossDefeated, bossDamage, outcome: this.outcome ?? 'overrun', bossKind: this.bossKind ?? null, itemLog: { ...this.itemLog } };
  }
}
