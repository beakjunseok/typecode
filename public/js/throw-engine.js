// '휴대폰 던지기' 모드: 위에서 내려오는 로봇에게 토큰을 쳐서 휴대폰(아이템 사용 시 노트북)을 던진다.
// 좌표 x는 0(내 책상)~1(화면 오른쪽 끝). 공통 규칙(조준·입력·콤보·생명)은 TargetGameEngine에 있다.
import { SCORING, MAX_MULTIPLIER } from './engine.js';
import { TargetGameEngine, ARCADE_RULES, filterArcadeTokens, randomBetween } from './target-game.js';

export const ROBOT_TYPES = Object.freeze({
  basic: Object.freeze({ label: '기본 로봇', hp: 1, speed: 0.075, bounty: 50, unlockAt: 0, weight: 1 }),
  fast: Object.freeze({ label: '빠른 로봇', hp: 1, speed: 0.15, bounty: 80, unlockAt: 15, weight: 0.45 }),
  tank: Object.freeze({ label: '탱크 로봇', hp: 3, speed: 0.042, bounty: 150, unlockAt: 35, weight: 0.3 })
});

export const ITEM_TYPES = Object.freeze({
  laptop: Object.freeze({ label: '노트북', effect: '8초간 노트북 투척(피해 3)' }),
  battery: Object.freeze({ label: '건전지', effect: '생명(건전지) 1칸 회복' })
});

// 시간이 지나면 로봇이 빨라진다: seconds초에 걸쳐 최대 (1 + max)배
const SPEED_RAMP = Object.freeze({ seconds: 180, max: 0.8 });

export const WEAPONS = Object.freeze({
  phone: Object.freeze({ label: '휴대폰', damage: 1 }),
  laptop: Object.freeze({ label: '노트북', damage: 3 })
});

export const THROW_RULES = Object.freeze({
  lanes: 4,
  playerX: 0.09,
  spawnX: 1.04,
  maxRobots: 9,
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
  itemInterval: [22, 32],
  maxFrameSeconds: ARCADE_RULES.maxFrameSeconds
});

// 서버 점수 검증용 상한: 글자당 (최대 배율 타격 점수) + (한 방에 줄 수 있는 처치 보너스 / 최소 토큰 길이).
export const MAX_POINTS_PER_CHARACTER = SCORING.basePoints * MAX_MULTIPLIER + Math.max(
  ...Object.values(ROBOT_TYPES).map(type => type.bounty / (ARCADE_RULES.minTokenLength * Math.ceil(type.hp / WEAPONS.laptop.damage)))
);

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
    this.kills = { basic: 0, fast: 0, tank: 0 };
  }

  targetables() {
    return [
      ...this.robots.filter(robot => robot.state === 'walking' && !robot.doomed),
      ...this.items.filter(item => !item.consumed)
    ];
  }

  findEntity(id) {
    return this.robots.find(robot => robot.id === id) ?? this.items.find(item => item.id === id) ?? null;
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

  speedMultiplier() {
    return (1 + Math.min(this.gameTime / SPEED_RAMP.seconds, SPEED_RAMP.max)) * this.difficulty.speed;
  }

  spawnInterval() {
    return Math.max(0.85, 2.6 - this.gameTime * 0.025) * this.difficulty.spawn * (0.8 + this.random() * 0.4);
  }

  step(frameSeconds) {
    this.moveEntities(frameSeconds);
    this.removeFinished();
    if (this.status === 'running') this.spawnIfDue();
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
      robot.x -= ROBOT_TYPES[robot.type].speed * multiplier * frameSeconds;
      if (robot.x <= THROW_RULES.playerX) this.robotReachedPlayer(robot);
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

  removeFinished() {
    this.robots = this.robots.filter(robot =>
      robot.state === 'walking' || this.gameTime - robot.stateAt < THROW_RULES.dyingSeconds);
    this.items = this.items.filter(item => !item.consumed || this.projectiles.some(projectile => projectile.targetId === item.id));
  }

  // ---------- 발사·명중 ----------
  onFire(target, projectile) {
    projectile.damage = WEAPONS[projectile.weapon].damage;
    projectile.lane = target.lane;
    if (target.kind === 'item') {
      target.consumed = true;
      return;
    }
    target.incomingDamage += projectile.damage;
    if (target.hp - target.incomingDamage > 0) target.token = this.pickToken(target.id);
    else target.doomed = true;
  }

  onProjectileLanded(entity, projectile) {
    if (entity.kind === 'item') this.activateItem(entity);
    else this.damageRobot(entity, projectile);
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
    if (robot.hp > 0) return;
    robot.state = 'dying';
    robot.stateAt = this.gameTime;
    const bounty = ROBOT_TYPES[robot.type].bounty;
    this.kills[robot.type]++;
    this.score += bounty;
    this.releaseTargetIf(robot.id, 'robot-destroyed');
    this.emit('kill', { robot, bounty });
  }

  snapshotExtras() {
    return { laptopRemaining: this.laptopRemaining(), powerRemaining: this.laptopRemaining(), powerSeconds: THROW_RULES.laptopSeconds };
  }

  summaryExtras() {
    return { kills: { ...this.kills }, totalKills: this.kills.basic + this.kills.fast + this.kills.tank };
  }
}
