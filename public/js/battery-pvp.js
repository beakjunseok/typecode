// 배터리 구조 PvP(1:1). 두 기기는 WebRTC로 직접 연결되고, 방장(host)이 판정을 맡는다.
//  · 방장: BatteryPvpHostEngine — 방전봇 AI 대신 원격 플레이어(손님)의 진행·완료 요청을 받아 판정한다.
//  · 손님: BatteryPvpGuestEngine — 타자 입력·조준·점수는 자기 기기에서 바로 처리하고, 탑·아이템·낱말은
//    방장 스냅샷(초당 20회)을 좌우 반전해 받는다(각자 자기 탑이 왼쪽). 낱말을 다 치면 방장에게 '가져가기' 요청.
// 같은 아이템을 둘이 거의 동시에 치면 방장 기기에 먼저 도착한 쪽이 가져간다.
// 경기: 3판 2선승. 한 판 = 먼저 8칸(100%) 충전하거나 상대를 0%로 만든 쪽 승리. 판마다 조금씩 빨라진다.
import { BatteryEngine, BATTERY_ITEMS, BATTERY_RULES } from './battery-engine.js';
import { TargetGameEngine } from './target-game.js';

export const PVP_PROTOCOL_VERSION = 1;
export const PVP_RULES = Object.freeze({
  roundsToWin: 2,
  countdownSeconds: 3,
  stateIntervalMs: 50,
  disconnectSeconds: 6,
  blackoutSeconds: BATTERY_RULES.blackoutSeconds
});
const MESSAGE_TYPES = new Set(['hello', 'countdown', 'state', 'claim', 'claim-result', 'progress', 'rematch', 'bye']);
const MAX_MESSAGE_LENGTH = 64_000;

// 받은 메시지 검사: JSON·크기·종류만 확인(나머지 값은 각 처리기가 다시 검사). 잘못되면 null
export function parsePvpMessage(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_LENGTH) return null;
  try {
    const message = JSON.parse(raw);
    return message && typeof message === 'object' && MESSAGE_TYPES.has(message.t) ? message : null;
  } catch {
    return null;
  }
}

const mirrorSide = side => (side === 'me' ? 'rival' : side === 'rival' ? 'me' : side);
const copySide = side => ({ cells: side.cells, ecoUntil: side.ecoUntil, heatUntil: side.heatUntil });
const tokenOf = token => ({ text: String(token?.text ?? ''), kind: String(token?.kind ?? 'identifier') });

// ======================= 방장 =======================
export class BatteryPvpHostEngine extends BatteryEngine {
  constructor({ opponentName = '상대', ...options }) {
    super(options);
    this.mode = 'battery-pvp';
    this.role = 'host';
    this.opponentName = opponentName;
    this.wins = { host: 0, guest: 0 };
    this.round = 1;
    this.blockedUntil = 0;              // 손님이 '화면 꺼짐'을 가져가면 방장 입력이 잠깐 막힌다
    this.ai = { targetId: null, progress: 0, thinkUntil: Infinity, pausedUntil: 0 }; // 렌더러 호환: 손님 진행 상황
    this.outbox = [];                    // 다음 스냅샷에 실어 보낼 손님용 사건들
    this.remoteStats = { takes: 0, drains: 0 };
  }

  get rivalName() {
    return this.opponentName;
  }

  // 방전봇 AI 없음: 상대 진행은 원격 메시지로만 바뀐다
  stepAi() {}

  input(character, nowMs) {
    if (this.status === 'running' && this.gameTime < this.blockedUntil) return { accepted: false, reason: 'blocked' };
    return super.input(character, nowMs);
  }

  aiProgressFor(entityId) {
    return this.ai.targetId === entityId ? this.ai.progress : 0;
  }

  // 손님이 지금 치는 목표와 친 글자 수(밑줄 표시용). 없는 목표면 무시
  applyRemoteProgress({ targetId, typed }) {
    const target = targetId == null ? null : this.findEntity(targetId);
    const valid = target && target.id !== this.rivalWord.id && Number.isInteger(typed) && typed >= 0;
    const previousTarget = this.ai.targetId;
    this.ai.targetId = valid ? target.id : null;
    this.ai.progress = valid ? Math.min(typed, target.token.text.length) : 0;
    if (valid && target.id !== previousTarget) this.emit('rival-lock', { targetId: target.id });
  }

  // 손님의 '가져가기' 판정. 아이템은 아직 남아 있고 낱말이 같아야, 탑 공격은 내 탑 낱말이 그대로여야 성공. O(아이템 수)
  applyRemoteClaim({ claimId, targetId, text }) {
    const reject = reason => ({ t: 'claim-result', claimId, ok: false, reason });
    if (this.status !== 'running') return reject('not_running');
    if (this.gameTime < this.pauseUntil) return reject('paused');
    if (this.gameTime < this.ai.pausedUntil) return reject('blocked');
    const target = this.findEntity(targetId);
    if (!target || typeof text !== 'string' || target.token?.text !== text) return reject('gone');
    this.ai.targetId = null;
    this.ai.progress = 0;
    if (target.kind === 'item') {
      if (target.consumed) return reject('taken');
      target.consumed = true;
      target.takenBy = 'rival';
      target.takenAt = this.gameTime;
      this.applyItem(this.rival, this.me, target);
      if (target.item === 'blackout') this.blockedUntil = this.gameTime + PVP_RULES.blackoutSeconds;
      if (this.targetId === target.id) {
        this.stolen++;
        this.releaseTargetIf(target.id, 'stolen');
      }
      this.remoteStats.takes++;
      this.emit('rival-take', { item: target });
      const result = { t: 'claim-result', claimId, ok: true, kind: 'item', item: target.item, bounty: BATTERY_ITEMS[target.item].bounty };
      this.checkOutcome();
      return result;
    }
    if (target.id !== this.myWord.id) return reject('gone');
    const stolen = Math.min(BATTERY_RULES.stealCells, Math.max(0, this.me.cells));
    this.me.cells -= BATTERY_RULES.stealCells;
    this.rival.cells = Math.min(BATTERY_RULES.goalCells, this.rival.cells + stolen);
    this.myWord.token = this.drawWeightedToken();
    if (this.targetId === this.myWord.id) this.releaseTargetIf(this.myWord.id, 'stolen');
    this.remoteStats.drains++;
    this.emit('rival-attack', { cells: this.me.cells, stolen });
    this.outbox.push({ type: 'guest-drain', stolen });
    this.checkOutcome();
    return { t: 'claim-result', claimId, ok: true, kind: 'drain', bounty: BATTERY_RULES.drainBounty };
  }

  // 방장이 아이템·공격에 성공하면 손님 화면 연출용 사건을 남긴다
  onProjectileLanded(entity) {
    if (this.status !== 'running') return;
    if (entity.kind === 'item' && entity.item === 'blackout') {
      super.onProjectileLanded(entity);
      this.ai.pausedUntil = this.gameTime + PVP_RULES.blackoutSeconds;
      this.outbox.push({ type: 'host-take', itemId: entity.id, item: entity.item });
      return;
    }
    if (entity.kind === 'item') this.outbox.push({ type: 'host-take', itemId: entity.id, item: entity.item });
    else if (entity.kind === 'rival-cell') this.outbox.push({ type: 'host-drain' });
    super.onProjectileLanded(entity);
  }

  // 판 승패: 먼저 8칸 충전 또는 상대 0칸. 동시에 일어나면 방장 쪽 조건을 먼저 본다
  checkOutcome() {
    if (this.status !== 'running' || this.gameTime < this.pauseUntil) return null;
    const goal = BATTERY_RULES.goalCells;
    if (this.me.cells >= goal) return this.endRound('host', 'charged');
    if (this.rival.cells <= 0) return this.endRound('host', 'sunk');
    if (this.rival.cells >= goal) return this.endRound('guest', 'charged');
    if (this.me.cells <= 0) return this.endRound('guest', 'sunk');
    return null;
  }

  endRound(winner, how) {
    this.wins[winner]++;
    const event = { round: this.round, winner, how, wins: { ...this.wins } };
    this.outbox.push({ type: 'round-end', ...event });
    this.emit('round-end', { ...event, mine: winner === 'host' });
    if (this.wins[winner] >= PVP_RULES.roundsToWin) {
      this.outcome = winner === 'host' ? 'win' : 'lose';
      this.me.cells = Math.max(0, this.me.cells);
      this.rival.cells = Math.max(0, this.rival.cells);
      this.finish();
      return how;
    }
    this.round++;
    if (winner === 'host') this.score += Math.round(BATTERY_RULES.winBonus[how] * 0.5);
    // 다음 판: 탑·아이템 초기화, 잠깐 멈췄다 조금 더 빠르게
    this.stage++;
    this.me = { cells: BATTERY_RULES.startCells, ecoUntil: 0, heatUntil: 0 };
    this.rival = { cells: BATTERY_RULES.startCells, ecoUntil: 0, heatUntil: 0 };
    this.items = [];
    this.projectiles = [];
    this.clearBuffer();
    this.ai = { targetId: null, progress: 0, thinkUntil: Infinity, pausedUntil: 0 };
    this.blockedUntil = 0;
    this.pauseUntil = this.gameTime + BATTERY_RULES.stageClearPause;
    this.nextItemAt = this.pauseUntil + 0.4;
    this.rivalWord.token = this.pickToken(this.rivalWord.id);
    this.myWord.token = this.drawWeightedToken();
    return how;
  }

  // 손님에게 보낼 상태(방장 기준 좌표·편). 손님이 좌우를 뒤집어 쓴다. O(아이템 수)
  stateMessage() {
    const events = this.outbox;
    this.outbox = [];
    return {
      t: 'state',
      status: this.status,
      time: this.gameTime,
      round: this.round,
      stage: this.stage,
      wins: { ...this.wins },
      pauseUntil: this.pauseUntil,
      outcome: this.outcome,
      host: copySide(this.me),
      guest: copySide(this.rival),
      hostWord: { id: this.myWord.id, token: tokenOf(this.myWord.token) },
      guestWord: { id: this.rivalWord.id, token: tokenOf(this.rivalWord.token) },
      hostTarget: { id: this.targetId, typed: this.typed.length },
      hostBlockedUntil: this.blockedUntil,
      guestBlockedUntil: this.ai.pausedUntil,
      items: this.items.map(item => ({
        id: item.id, item: item.item, x: item.x, y: item.y, direction: item.direction,
        consumed: item.consumed, takenBy: item.takenBy, takenAt: item.takenAt, token: tokenOf(item.token)
      })),
      events
    };
  }

  summaryExtras() {
    return { ...super.summaryExtras(), pvp: { role: 'host', wins: { mine: this.wins.host, theirs: this.wins.guest }, opponentName: this.opponentName } };
  }
}

// ======================= 손님 =======================
export class BatteryPvpGuestEngine extends BatteryEngine {
  constructor({ opponentName = '상대', send = () => {}, ...options }) {
    super(options);
    this.mode = 'battery-pvp';
    this.role = 'guest';
    this.opponentName = opponentName;
    this.send = send;
    this.items = [];
    this.nextItemAt = Infinity;
    this.wins = { mine: 0, theirs: 0 };
    this.round = 1;
    this.blockedUntil = 0;
    this.ai = { targetId: null, progress: 0, thinkUntil: Infinity, pausedUntil: 0 };
    this.pendingClaims = new Map(); // targetId → { claimId, text }
    this.claimSequence = 0;
    this.lastSent = { targetId: null, typed: 0 };
    this.lastStateAt = null;
  }

  get rivalName() {
    return this.opponentName;
  }

  // 손님 기기는 판정·스폰·AI를 하지 않는다. 스냅샷 사이에는 보기용으로만 방전·이동을 이어 그린다
  stepAi() {}
  spawnIfDue() {}
  checkOutcome() {
    return null;
  }

  aiProgressFor(entityId) {
    return this.ai.targetId === entityId ? this.ai.progress : 0;
  }

  // 막 쏜(판정 대기 중인) 목표는 다시 조준하지 않는다
  targetables() {
    const list = this.items.filter(item => !item.consumed && !this.pendingClaims.has(item.id));
    if (this.rivalWord.token && !this.pendingClaims.has(this.rivalWord.id)) list.push(this.rivalWord);
    return list;
  }

  // 방장이 시작해야 시작된다(첫 스냅샷). 화면 꺼짐 중에는 입력 막힘
  input(character, nowMs) {
    if (this.status === 'ready') return { accepted: false, reason: 'waiting_host' };
    if (this.status === 'running' && this.gameTime < this.blockedUntil) return { accepted: false, reason: 'blocked' };
    const result = super.input(character, nowMs);
    this.reportProgress();
    return result;
  }

  backspace(nowMs, options) {
    const result = super.backspace(nowMs, options);
    this.reportProgress();
    return result;
  }

  // 지금 조준·진행을 방장에게 알린다(바뀌었을 때만)
  reportProgress() {
    const targetId = this.targetId;
    const typed = this.typed.length;
    if (targetId === this.lastSent.targetId && typed === this.lastSent.typed) return;
    this.lastSent = { targetId, typed };
    this.send({ t: 'progress', targetId, typed });
  }

  // 낱말 완성: 점수·콤보는 바로, 실제 효과는 방장 판정 뒤. 탑 낱말은 방장이 새로 정한다(여기서 바꾸지 않음)
  fire(target) {
    const result = TargetGameEngine.prototype.fire.call(this, target);
    const claimId = ++this.claimSequence;
    this.pendingClaims.set(target.id, { claimId, text: result.token.text, kind: target.kind, item: target.item });
    this.send({ t: 'claim', claimId, targetId: target.id, text: result.token.text });
    this.reportProgress();
    return result;
  }

  onFire(target) {
    if (target.kind === 'item') {
      target.consumed = true;
      target.takenBy = 'me';
    }
  }

  // 투사체가 닿아도 효과는 방장 판정(claim-result)과 스냅샷으로만 반영
  onProjectileLanded() {}

  applyClaimResult(message) {
    const entry = [...this.pendingClaims.entries()].find(([, pending]) => pending.claimId === message.claimId);
    if (!entry) return;
    const [targetId, pending] = entry;
    this.pendingClaims.delete(targetId);
    if (message.ok) {
      this.score += Number(message.bounty) || 0;
      if (message.kind === 'item') {
        this.itemsCollected++;
        if (message.item in this.collected) this.collected[message.item]++;
        const item = this.items.find(candidate => candidate.id === targetId) ?? { id: targetId, item: message.item, x: 0.5, y: 0.4 };
        item.takenAt = this.gameTime;
        this.emit('item', { item });
      } else {
        this.drains++;
        this.emit('drain', { cells: this.rival.cells, stolen: BATTERY_RULES.stealCells });
      }
    } else {
      if (pending.kind === 'item') this.stolen++;
      this.emit('claim-rejected', { reason: message.reason, text: pending.text });
    }
  }

  // 방장 상태를 좌우 반전해 적용. 아이템 객체는 id로 재사용(렌더러 연출 상태 유지). O(아이템 수)
  applyState(state, nowMs) {
    if (!state || state.t !== 'state') return;
    this.lastStateAt = nowMs;
    if (this.status === 'ready' && state.status === 'running') {
      this.start(nowMs);
    }
    this.gameTime = Number(state.time) || 0;
    this.round = state.round;
    this.stage = state.stage;
    this.pauseUntil = state.pauseUntil;
    this.wins = { mine: state.wins.guest, theirs: state.wins.host };
    this.me = copySide(state.guest);
    this.rival = copySide(state.host);
    this.blockedUntil = state.guestBlockedUntil;
    this.ai.pausedUntil = state.hostBlockedUntil;

    const previous = new Map(this.items.map(item => [item.id, item]));
    this.items = state.items.map(raw => {
      const item = previous.get(raw.id) ?? { id: raw.id, kind: 'item' };
      const pending = this.pendingClaims.has(raw.id);
      // 내가 치던 아이템을 방장이 먼저 가져갔다 → 바로 조준 해제
      if (raw.consumed && !pending && this.targetId === raw.id) {
        this.stolen++;
        this.releaseTargetIf(raw.id, 'stolen');
      }
      Object.assign(item, {
        item: raw.item, x: 1 - raw.x, y: raw.y, direction: -raw.direction, token: tokenOf(raw.token),
        consumed: raw.consumed || pending, takenBy: raw.consumed ? mirrorSide(raw.takenBy) : pending ? 'me' : null,
        takenAt: raw.takenAt ?? item.takenAt
      });
      return item;
    });
    if (this.targetId !== null && this.items.every(item => item.id !== this.targetId) && this.targetId !== this.rivalWord.id) {
      this.releaseTargetIf(this.targetId, 'gone');
    }

    // 낱말: 내가 칠 낱말 = 방장 탑 낱말, 내 탑 낱말 = 방장이 노리는 낱말
    this.updateWord(this.rivalWord, state.hostWord);
    this.updateWord(this.myWord, state.guestWord);

    const hostTarget = state.hostTarget?.id ?? null;
    this.ai.targetId = hostTarget;
    this.ai.progress = hostTarget === null ? 0 : state.hostTarget.typed;

    for (const event of state.events ?? []) this.applyRemoteEvent(event);

    if (state.status === 'finished' && this.status !== 'finished') {
      this.outcome = state.outcome === 'win' ? 'lose' : state.outcome === 'lose' ? 'win' : state.outcome;
      this.finish();
    }
  }

  updateWord(word, raw) {
    const text = String(raw?.token?.text ?? '');
    const changed = word.id !== raw.id || word.token?.text !== text;
    if (!changed) return;
    if (this.targetId === word.id) this.releaseTargetIf(word.id, 'word-changed');
    this.pendingClaims.delete(word.id);
    word.id = raw.id;
    word.token = tokenOf(raw.token);
  }

  // 방장 쪽에서 일어난 일(방장이 아이템·공격 성공, 판 종료)을 내 화면 사건으로 바꾼다
  applyRemoteEvent(event) {
    if (event.type === 'host-take') {
      const item = this.items.find(candidate => candidate.id === event.itemId);
      if (this.targetId === event.itemId) {
        this.stolen++;
        this.releaseTargetIf(event.itemId, 'stolen');
      }
      if (item) this.emit('rival-take', { item });
    } else if (event.type === 'host-drain') {
      this.emit('rival-attack', { cells: this.me.cells, stolen: BATTERY_RULES.stealCells });
    } else if (event.type === 'round-end') {
      const mine = event.winner === 'guest';
      this.clearBuffer();
      this.pendingClaims.clear();
      this.emit('round-end', {
        round: event.round, winner: event.winner, how: event.how, mine,
        wins: { mine: event.wins.guest, theirs: event.wins.host }
      });
    }
  }

  // 마지막 스냅샷 이후 너무 오래 조용하면 연결이 끊긴 것으로 본다
  isStale(nowMs) {
    return this.status === 'running' && this.lastStateAt !== null && nowMs - this.lastStateAt > PVP_RULES.disconnectSeconds * 1000;
  }

  summaryExtras() {
    return { ...super.summaryExtras(), pvp: { role: 'guest', wins: { ...this.wins }, opponentName: this.opponentName } };
  }
}
