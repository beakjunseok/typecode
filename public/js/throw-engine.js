// '휴대폰 던지기' 모드: 오른쪽에서 다가오는 로봇에게 토큰을 쳐서 휴대폰(아이템 사용 시 노트북)을 던진다.
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
  charger: Object.freeze({ label: '충전기', effect: '생명 1 회복' })
});

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
  chargerChance: 0.45,
  itemSpeed: 0.06,
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
    return (1 + Math.min(this.gameTime / 180, 0.8)) * this.difficulty.speed;
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

  // 오른쪽 끝 근처가 비어 있는 줄에 우선 배치해 로봇이 겹쳐 나오지 않게 한다.
  chooseLane() {
    const lanes = [...Array(this.lanes).keys()];
    const free = lanes.filter(lane => !this.robots.some(robot => robot.lane === lane && robot.x > 0.82));
    const candidates = free.length ? free : lanes;
    return candidates[Math.floor(this.random() * candidates.length)];
  }

  spawnIfDue() {
    if (this.gameTime >= this.nextSpawnAt) {
      if (this.robots.filter(robot => robot.state === 'walking').length < THROW_RULES.maxRobots) this.spawnRobot();
      this.nextSpawnAt = this.gameTime + this.spawnInterval();
    }
    if (this.gameTime >= this.nextItemAt && !this.items.some(item => !item.consumed)) {
      this.spawnItem();
      this.nextItemAt = this.gameTime + randomBetween(this.random, THROW_RULES.itemInterval);
    }
  }

  spawnRobot(typeKey = this.chooseRobotType(), lane = this.chooseLane()) {
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

  // 생명이 깎였으면 일정 확률로 충전기(에너지 충전), 아니면 노트북(강력한 무기) — 원작의 하트·일반 케이크
  chooseItemType() {
    return this.lives < ARCADE_RULES.startLives && this.random() < THROW_RULES.chargerChance ? 'charger' : 'laptop';
  }

  spawnItem(lane = this.chooseLane(), itemType = this.chooseItemType()) {
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
    if (item.item === 'charger') {
      this.lives = Math.min(ARCADE_RULES.startLives, this.lives + 1);
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
