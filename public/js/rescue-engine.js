// '에러 구조 SOS' 모드: 버그 바다에 빠져 가라앉는 프로세스를, 토큰을 쳐서 패치 튜브로 건진다.
// depth: 0(수면) → 1(완전히 가라앉음). 완전히 가라앉으면 SLA(생명) 1 감소.
import { SCORING, MAX_MULTIPLIER } from './engine.js';
import { TargetGameEngine, ARCADE_RULES, randomBetween } from './target-game.js';

export const VICTIM_TYPES = Object.freeze({
  process: Object.freeze({ label: '크래시 프로세스', hp: 1, sinkSeconds: 13, bonus: 40, unlockAt: 0, weight: 1 }),
  coredump: Object.freeze({ label: '코어 덤프', hp: 1, sinkSeconds: 8, bonus: 70, unlockAt: 15, weight: 0.45 }),
  cluster: Object.freeze({ label: '서버 클러스터', hp: 2, sinkSeconds: 18, bonus: 120, unlockAt: 30, weight: 0.3 })
});

export const RESCUE_RULES = Object.freeze({
  minX: 0.08,
  maxX: 0.92,
  minGap: 0.13,
  maxVictims: 7,
  partialLift: 0.35,
  rescuedSeconds: 0.8,
  sunkSeconds: 0.6,
  minBonusRatio: 0.3,
  rollbackLift: 0.6,
  rollbackFreezeSeconds: 5,
  crateSpeed: 0.07,
  firstCrateAt: [16, 24],
  crateInterval: [24, 34]
});

// 서버 점수 검증용 상한: 글자당 최대 배율 타격 점수 + 구조 보너스 / (최소 토큰 길이 × 필요한 패치 수).
export const RESCUE_MAX_POINTS_PER_CHARACTER = SCORING.basePoints * MAX_MULTIPLIER + Math.max(
  ...Object.values(VICTIM_TYPES).map(type => type.bonus / (ARCADE_RULES.minTokenLength * type.hp))
);

export class RescueEngine extends TargetGameEngine {
  constructor(options) {
    super({ ...options, mode: 'rescue' });
    this.victims = [];
    this.crates = [];
    this.freezeUntil = 0;
    this.nextSpawnAt = 0.4;
    this.nextCrateAt = randomBetween(this.random, RESCUE_RULES.firstCrateAt);
    this.rescued = { process: 0, coredump: 0, cluster: 0 };
    this.lost = 0;
  }

  targetables() {
    return [
      ...this.victims.filter(victim => victim.state === 'sinking' && !victim.secured),
      ...this.crates.filter(crate => !crate.consumed)
    ];
  }

  findEntity(id) {
    return this.victims.find(victim => victim.id === id) ?? this.crates.find(crate => crate.id === id) ?? null;
  }

  // 가장 많이 가라앉은(위급한) 프로세스부터 조준. 롤백 상자는 가장 나중.
  targetPriority(entity) {
    return entity.kind === 'crate' ? 2 : -entity.depth;
  }

  currentWeapon() {
    return 'patch';
  }

  freezeRemaining() {
    return Math.max(0, this.freezeUntil - this.gameTime);
  }

  sinkMultiplier() {
    return (1 + Math.min(this.gameTime / 150, 0.9)) * this.difficulty.speed;
  }

  spawnInterval() {
    return Math.max(1.1, 3.2 - this.gameTime * 0.03) * this.difficulty.spawn * (0.8 + this.random() * 0.4);
  }

  step(frameSeconds) {
    this.sinkVictims(frameSeconds);
    this.moveCrates(frameSeconds);
    this.removeFinished();
    if (this.status === 'running') this.spawnIfDue();
  }

  // ---------- 스폰 ----------
  chooseVictimType() {
    const unlocked = Object.entries(VICTIM_TYPES).filter(([, type]) => this.gameTime >= type.unlockAt);
    const totalWeight = unlocked.reduce((sum, [, type]) => sum + type.weight, 0);
    let roll = this.random() * totalWeight;
    for (const [key, type] of unlocked) {
      roll -= type.weight;
      if (roll <= 0) return key;
    }
    return unlocked[unlocked.length - 1][0];
  }

  // 다른 프로세스와 최소 간격을 두는 x 위치. 12번 시도 후 실패하면 가장 덜 붙는 위치.
  chooseX() {
    const occupied = this.victims.filter(victim => victim.state === 'sinking').map(victim => victim.x);
    let best = RESCUE_RULES.minX;
    let bestGap = -1;
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = RESCUE_RULES.minX + this.random() * (RESCUE_RULES.maxX - RESCUE_RULES.minX);
      const gap = occupied.length ? Math.min(...occupied.map(other => Math.abs(other - x))) : Infinity;
      if (gap >= RESCUE_RULES.minGap) return x;
      if (gap > bestGap) [best, bestGap] = [x, gap];
    }
    return best;
  }

  spawnIfDue() {
    if (this.gameTime >= this.nextSpawnAt) {
      if (this.victims.filter(victim => victim.state === 'sinking').length < RESCUE_RULES.maxVictims) this.spawnVictim();
      this.nextSpawnAt = this.gameTime + this.spawnInterval();
    }
    if (this.gameTime >= this.nextCrateAt && !this.crates.some(crate => !crate.consumed)) {
      this.spawnCrate();
      this.nextCrateAt = this.gameTime + randomBetween(this.random, RESCUE_RULES.crateInterval);
    }
  }

  spawnVictim(typeKey = this.chooseVictimType(), x = this.chooseX()) {
    const type = VICTIM_TYPES[typeKey];
    const victim = {
      id: this.nextId++, kind: 'victim', type: typeKey, x, depth: 0, hp: type.hp, maxHp: type.hp,
      incoming: 0, secured: false, state: 'sinking', stateAt: this.gameTime, spawnedAt: this.gameTime,
      pid: 1000 + Math.floor(this.random() * 9000), token: null
    };
    victim.token = this.pickToken(victim.id);
    this.victims.push(victim);
    this.emit('spawn', { victim });
    return victim;
  }

  spawnCrate() {
    const crate = { id: this.nextId++, kind: 'crate', item: 'rollback', x: 1.04, consumed: false, token: null };
    crate.token = this.pickToken(crate.id);
    this.crates.push(crate);
    this.emit('item-spawn', { item: crate });
    return crate;
  }

  // ---------- 가라앉기 ----------
  sinkVictims(frameSeconds) {
    if (this.freezeRemaining() > 0) return;
    const multiplier = this.sinkMultiplier();
    for (const victim of this.victims) {
      if (victim.state !== 'sinking') continue;
      victim.depth += (frameSeconds / VICTIM_TYPES[victim.type].sinkSeconds) * multiplier;
      if (victim.depth >= 1) {
        victim.depth = 1;
        this.victimSank(victim);
        if (this.status !== 'running') return;
      }
    }
  }

  victimSank(victim) {
    victim.state = 'sunk';
    victim.stateAt = this.gameTime;
    this.lost++;
    this.releaseTargetIf(victim.id, 'victim-sunk');
    this.loseLife({ victim });
  }

  moveCrates(frameSeconds) {
    for (const crate of this.crates) {
      if (crate.consumed) continue;
      crate.x -= RESCUE_RULES.crateSpeed * frameSeconds;
      if (crate.x <= -0.04) {
        crate.consumed = true;
        crate.missed = true;
        this.releaseTargetIf(crate.id, 'item-missed');
      }
    }
  }

  removeFinished() {
    this.victims = this.victims.filter(victim => {
      if (victim.state === 'sinking') return true;
      const linger = victim.state === 'rescued' ? RESCUE_RULES.rescuedSeconds : RESCUE_RULES.sunkSeconds;
      return this.gameTime - victim.stateAt < linger;
    });
    this.crates = this.crates.filter(crate => !crate.consumed || this.projectiles.some(projectile => projectile.targetId === crate.id));
  }

  // ---------- 발사·구조 ----------
  onFire(target) {
    if (target.kind === 'crate') {
      target.consumed = true;
      return;
    }
    target.incoming++;
    if (target.hp - target.incoming > 0) target.token = this.pickToken(target.id);
    else target.secured = true;
  }

  onProjectileLanded(entity) {
    if (entity.kind === 'crate') this.activateRollback(entity);
    else this.patchVictim(entity);
  }

  // 롤백: 모든 프로세스를 끌어올리고 잠시 가라앉지 않게 한다.
  activateRollback(crate) {
    this.itemsCollected++;
    for (const victim of this.victims) {
      if (victim.state === 'sinking') victim.depth *= 1 - RESCUE_RULES.rollbackLift;
    }
    this.freezeUntil = Math.max(this.freezeUntil, this.gameTime) + RESCUE_RULES.rollbackFreezeSeconds;
    this.emit('item', { item: crate, freezeSeconds: this.freezeRemaining() });
  }

  patchVictim(victim) {
    if (victim.state !== 'sinking') return;
    victim.hp = Math.max(0, victim.hp - 1);
    victim.incoming = Math.max(0, victim.incoming - 1);
    victim.hitAt = this.gameTime;
    if (victim.hp > 0) {
      victim.depth = Math.max(0, victim.depth - RESCUE_RULES.partialLift);
      this.emit('hit', { victim });
      return;
    }
    // 빨리 건질수록(얕을수록) 보너스가 크다. 최소 30%.
    const ratio = Math.max(RESCUE_RULES.minBonusRatio, 1 - victim.depth);
    const bonus = Math.round(VICTIM_TYPES[victim.type].bonus * ratio);
    victim.state = 'rescued';
    victim.stateAt = this.gameTime;
    this.rescued[victim.type]++;
    this.score += bonus;
    this.releaseTargetIf(victim.id, 'victim-rescued');
    this.emit('kill', { victim, bounty: bonus });
  }

  snapshotExtras() {
    return { powerRemaining: this.freezeRemaining(), powerSeconds: RESCUE_RULES.rollbackFreezeSeconds };
  }

  summaryExtras() {
    const totalRescued = this.rescued.process + this.rescued.coredump + this.rescued.cluster;
    return { rescued: { ...this.rescued }, totalRescued, lost: this.lost };
  }
}
