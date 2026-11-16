// '휴대폰 던지기' 모드: 위에서 내려오는 로봇에게 토큰을 쳐서 휴대폰(아이템 사용 시 노트북)을 던진다.
// 좌표 x는 0(내 책상)~1(화면 오른쪽 끝). 공통 규칙(조준·입력·콤보·생명)은 TargetGameEngine에 있다.
import { SCORING, MAX_MULTIPLIER } from './engine.js';
import { TargetGameEngine, ARCADE_RULES, filterArcadeTokens, randomBetween } from './target-game.js';

export const ROBOT_TYPES = Object.freeze({
  basic: Object.freeze({ label: '기본 로봇', hp: 1, speed: 0.075, bounty: 50, unlockAt: 0, weight: 1 }),
  fast: Object.freeze({ label: '빠른 로봇', hp: 1, speed: 0.15, bounty: 80, unlockAt: 15, weight: 0.45 }),
  tank: Object.freeze({ label: '탱크 로봇', hp: 2, speed: 0.042, bounty: 150, unlockAt: 35, weight: 0.3 }),
  // 느린 로봇: 휴대폰은 낱말 두 개(두 방), 노트북(두 개씩 던짐)은 한 번에
  slow: Object.freeze({ label: '달팽봇', hp: 2, speed: 0.036, bounty: 100, unlockAt: 8, weight: 0.4 }),
  // 마지막 웨이브 보스: 무작위로는 안 나오고(weight 0) 목표 처치 수를 채우면 한 번 등장. 속도는 시간 가속을 받지 않는다
  boss: Object.freeze({ label: '보스 서버봇', hp: 10, speed: 0.017, bounty: 1000, unlockAt: Infinity, weight: 0, boss: true })
});

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
  laptop: Object.freeze({ label: '노트북', effect: '8초간 노트북 두 개씩 투척' }),
  battery: Object.freeze({ label: '건전지', effect: '생명(건전지) 1칸 회복' })
});

// 시간이 지나면 로봇이 빨라진다: seconds초에 걸쳐 최대 (1 + max)배
const SPEED_RAMP = Object.freeze({ seconds: 240, max: 0.5 });

// 로봇 나오는 간격(초): start에서 시작해 1초에 perSecond씩 줄어 floor까지. 레벨 배율·±20% 흔들림을 곱한다
const SPAWN_PACE = Object.freeze({ start: 3.4, perSecond: 0.012, floor: 1.5 });

// shots: 낱말 하나에 던지는 개수. 노트북은 두 개 — 목표가 한 방이면 두 번째는 옆 로봇에게 간다(없으면 하나만)
export const WEAPONS = Object.freeze({
  phone: Object.freeze({ label: '휴대폰', damage: 1, shots: 1 }),
  laptop: Object.freeze({ label: '노트북', damage: 1, shots: 2 })
});
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
  + (WEAPONS.laptop.shots * Math.max(...Object.values(ROBOT_TYPES).filter(type => !type.boss).map(type => type.bounty))) / ARCADE_RULES.minTokenLength
  + ROBOT_TYPES.boss.bounty / (THROW_RULES.goalKills * ARCADE_RULES.minTokenLength);

export const filterThrowTokens = filterArcadeTokens;

export class ThrowEngine extends TargetGameEngine {
  constructor(options) {
    super({ ...options, mode: 'throw' });
    this.lanes = Number.isInteger(options.lanes) && options.lanes >= 2 && options.lanes <= 6 ? options.lanes : THROW_RULES.lanes;
    this.robots = [];
    this.items = [];
    this.laptopUntil = 0;
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
  }

  targetables() {
    return [
      ...this.robots.filter(robot => robot.state === 'walking' && !robot.doomed),
      ...this.items.filter(item => !item.consumed),
      ...this.pads.filter(pad => !pad.consumed)
    ];
  }

  findEntity(id) {
    return this.robots.find(robot => robot.id === id) ?? this.items.find(item => item.id === id)
      ?? this.pads.find(pad => pad.id === id) ?? null;
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
      this.stepCannon(boss);
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

  // 패드 대포 스킬: 가슴 대포에 에너지를 모으는(charge) 동안 예고하고, 다 모이면 패드를 쏜다. 한 번에 패드 하나만
  stepCannon(boss) {
    if (boss.chargeUntil != null) {
      if (this.gameTime >= boss.chargeUntil) this.firePad(boss);
      return;
    }
    if (this.gameTime < this.nextPadAt || this.pads.some(pad => !pad.consumed)) return;
    boss.chargeUntil = this.gameTime + BOSS_RULES.cannonChargeSeconds;
    this.emit('boss-charge', { boss });
  }

  firePad(boss) {
    boss.chargeUntil = null;
    boss.firedAt = this.gameTime;
    const pad = { id: this.nextId++, kind: 'pad', lane: boss.lane, x: boss.x - 0.03, consumed: false, firedAt: this.gameTime, token: null };
    pad.token = this.pickShortToken(pad.id);
    this.pads.push(pad);
    this.nextPadAt = this.gameTime + randomBetween(this.random, BOSS_RULES.padInterval);
    this.emit('boss-fire', { boss, pad });
  }

  // 패드는 빨리 날아오므로 짧은 낱말(첫 글자가 다른 목표와 겹치지 않게). 못 찾으면 보통 낱말
  pickShortToken(excludeId) {
    const used = new Set(this.targetables().filter(entity => entity.id !== excludeId).map(entity => entity.token.text[0]));
    for (let attempt = 0; attempt < 40; attempt++) {
      const token = this.drawWeightedToken();
      if (token.text.length <= BOSS_RULES.padMaxLength && !used.has(token.text[0])) return token;
    }
    return this.pickToken(excludeId);
  }

  // 보스는 가운데 쪽 줄에서 나온다(줄이 짝수면 가운데 둘 중 하나)
  spawnBoss() {
    // lane은 줄 번호가 아니라 화면 가운데((줄 수 - 1) / 2, 4줄이면 1.5) — 어느 줄에도 속하지 않아 일반 줄 계산에서 빠진다
    const boss = this.spawnRobot('boss', (this.lanes - 1) / 2);
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
    this.bossPhase = 'warning';
    this.bossAt = this.gameTime + BOSS_RULES.warningSeconds;
    this.emit('boss-warning', { kills: this.totalKills(), seconds: BOSS_RULES.warningSeconds });
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
      .map(robot => ({ x: robot.x, speed: ROBOT_TYPES[robot.type].speed, robot: true }));
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
      const spawn = crowded ? null : this.chooseSpawn();
      if (spawn) this.spawnRobot(spawn.typeKey, spawn.lane);
      this.nextSpawnAt = this.gameTime + (spawn || crowded ? this.spawnInterval() : THROW_RULES.spawnRetrySeconds);
    }
    this.spawnItemsIfDue();
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

  spawnRobot(typeKey = this.chooseRobotType(), lane = this.chooseLane(ROBOT_TYPES[typeKey].speed) ?? 0) {
    const type = ROBOT_TYPES[typeKey];
    const robot = {
      id: this.nextId++, kind: 'robot', type: typeKey, lane, x: THROW_RULES.spawnX,
      hp: type.hp, maxHp: type.hp, incomingDamage: 0, doomed: false,
      state: 'walking', stateAt: this.gameTime, hitAt: -1, spawnedAt: this.gameTime, token: null
    };
    robot.token = this.pickToken(robot.id);
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
    const item = { id: this.nextId++, kind: 'item', item: itemType, lane, x: THROW_RULES.spawnX, consumed: false, token: null };
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
      robot.x -= type.speed * (type.boss ? this.difficulty.speed : multiplier) * frameSeconds;
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
      pad.x -= BOSS_RULES.padSpeed * this.difficulty.speed * frameSeconds;
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
    const weapon = WEAPONS[projectile.weapon];
    projectile.damage = weapon.damage;
    projectile.lane = target.lane;
    if (target.kind === 'item' || target.kind === 'pad') {
      target.consumed = true;
      return;
    }
    this.applyIncoming(target, projectile);
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

  activateItem(item) {
    this.itemsCollected++;
    if (item.item === 'battery') {
      this.lives = Math.min(ARCADE_RULES.startLives, this.lives + 1);
      if (!this.isDamaged()) this.nextBatteryAt = Infinity;
      this.emit('item', { item, lives: this.lives });
      return;
    }
    this.laptopUntil = Math.max(this.laptopUntil, this.gameTime) + THROW_RULES.laptopSeconds;
    this.emit('item', { item, laptopSeconds: this.laptopRemaining() });
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
    if (robot.id === this.bossId) this.winBossFight();
    else this.checkGoal();
  }

  snapshotExtras() {
    return { laptopRemaining: this.laptopRemaining(), powerRemaining: this.laptopRemaining(), powerSeconds: THROW_RULES.laptopSeconds, bossPhase: this.bossPhase };
  }

  summaryExtras() {
    // bossDamage: 보스에게 입힌 피해 비율(0~1) — 보스전에서 져도 진행 보상에 반영
    const boss = this.boss();
    const bossDefeated = this.bossPhase === 'defeated';
    const bossDamage = bossDefeated ? 1 : boss && boss.maxHp > 0 ? Math.max(0, Math.min(1, 1 - boss.hp / boss.maxHp)) : 0;
    return { kills: { ...this.kills }, totalKills: this.totalKills(), goalKills: THROW_RULES.goalKills, bossDefeated, bossDamage, outcome: this.outcome ?? 'overrun' };
  }
}
