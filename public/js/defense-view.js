// 컴퓨터 디펜스 화면. 왼쪽 들판: 지그재그 길을 따라 해킹 공격이 아래 가운데 컴퓨터(방패 돔)로 오고, 드론은 위에서 곧장 날아온다.
// 오른쪽(휴대폰은 상점 위 띠): 연습 모드처럼 칠 낱말이 줄지어 올라오는 패널. 맨 아래: 누를 수 있는 상점(숫자 키 1~4).
// 배경 그림(public/art/defense-stage.webp)이 있으면 그림 속 돔이 컴퓨터 자리에 오도록 깔고, 없으면 격자·코드 비·컴퓨터를 직접 그린다.
import { ARCADE_RULES } from './target-game.js';
import { DEFENSE_RULES, TOWER_TYPES, SHOP_ITEMS, DEFENSE_PATH, DEFENSE_COMPUTER, ATTACK_TYPES, wordCoins, towerStats, TOWER_MAX_PERKS, pointOnPath } from './defense-engine.js';
import { setupCanvas, roundedRect, drawTokenLabel, ParticleSystem, easeOutBack, Spring, VisualStates, canvasFont, seededRandom, loadArt, isArtReady, Juice } from './game-view.js';

const HUD_HEIGHT = 34;
const SHOP_HEIGHT = 46;
// 낱말 패널: 넓은 화면은 오른쪽 세로 패널(너비 비율), 좁은 화면은 상점 위 가로 띠(높이)
const PANEL_RATIO = 0.25;
const STRIP_HEIGHT = 52;
const WIDE_LAYOUT = 640;
const STAGE_ART = loadArt('/art/defense-stage.webp');
// 그림 속 방패 돔(컴퓨터) 중심과 반지름(그림 크기 비율)
const ART_DOME = Object.freeze({ x: 0.502, y: 0.846, radius: 0.117 });
const wallSeconds = () => performance.now() / 1000;
// 타워 설치 연출(게임 초): 설계도 → 낙하 → 착지 흔들림
const BUILD_MOTION = Object.freeze({ blueprint: 0.2, drop: 0.25, settle: 0.55 });
const HIT_FLASH_SECONDS = 0.14;
const SPAWN_SECONDS = 0.35;
// 각도 a에서 b로 최단 방향으로 rate(0~1)만큼 다가간다
const approachAngle = (from, to, rate) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * Math.min(1, rate);
const SCENE = Object.freeze({
  bgTop: '#060916', bgBottom: '#0b1030', grid: 'rgba(54, 226, 255, 0.07)', rain: '#2fd27a', shield: '#36e2ff',
  ink: '#e9edf8', fog: '#8a93b8', coin: '#ffd166', danger: '#ff4d6d', amber: '#ffb547'
});
// 공격 모양: 패킷 = 빨간 마름모, 스팸 = 성난 봉투, 악성 파일 = 성난 문서, 랜섬웨어 = 큰 자물쇠 괴물
const BUG_STYLE = Object.freeze({
  packet: { body: '#ff5d73', dark: '#7a1530', size: 12 },
  spam: { body: '#ffd166', dark: '#8a6414', size: 13 },
  malware: { body: '#c792ea', dark: '#5a2f8a', size: 15 },
  drone: { body: '#7dffc4', dark: '#1d6b52', size: 16 },
  ransomware: { body: '#ff4d6d', dark: '#6a0f24', size: 28 },
  rootkit: { body: '#39ff88', dark: '#0b3d22', size: 34 }
});
const TOWER_STYLE = Object.freeze({ firewall: '#ff7a45', honeypot: '#f5b82e', antivirus: '#36e2ff', emp: '#b38cff', interceptor: '#c3ff4d' });
const SHOP_LABELS = Object.freeze({ firewall: '방화벽', honeypot: '허니팟', antivirus: '백신', emp: 'EMP포', interceptor: '요격포', patch: '수리' });
const SHOP_ICONS = Object.freeze({ firewall: '🧱', honeypot: '🍯', antivirus: '💊', emp: '⚡', interceptor: '🚀', patch: '🔧' });
const HONEY = Object.freeze({ light: '#ffe08a', body: '#f5b82e', dark: '#a8660c', glass: 'rgba(255, 210, 120, 0.35)' });

export class DefenseRenderer {
  constructor(canvas) {
    this.surface = setupCanvas(canvas);
    this.particles = new ParticleSystem();
    this.juice = new Juice();
    this.visuals = new VisualStates(() => ({ labelPop: new Spring(0, { stiffness: 420, damping: 18 }) }));
    this.banner = null;
    this.lastGameTime = 0;
    this.lastWallSeconds = null;
    this.accent = '#36e2ff';
    this.shieldHit = 0;
    this.displayHealth = null;
    this.wordFlights = [];
    this.streamShift = new Spring(0, { stiffness: 260, damping: 22 });
    this.motions = new Map();
    this.debris = [];
    this.frameSeconds = 1 / 60;
    this.selectedTowerId = null;
    this.cardButtons = [];
    this.cardRect = null;
    this.explosions = [];
    this.empBlasts = [];
  }

  // 강화 카드를 띄울 타워 고르기(null = 닫기)
  selectTower(towerId) {
    this.selectedTowerId = towerId ?? null;
    this.cardButtons = [];
  }

  // 누른 점이 강화 카드 버튼이면 'upgrade' · 'sell', 카드 몸통이면 'card', 아니면 null
  cardActionAt(screenX, screenY) {
    const inside = rect => rect && screenX >= rect.x && screenX <= rect.x + rect.width && screenY >= rect.y && screenY <= rect.y + rect.height;
    const button = this.cardButtons.find(entry => inside(entry.rect));
    if (button) return button.action;
    return inside(this.cardRect) ? 'card' : null;
  }

  // 엔티티 id별 화면 전용 움직임 상태(맞은 시각·조준 각·착지 여부). 없으면 만든다
  motion(id) {
    let state = this.motions.get(id);
    if (!state) {
      state = { hitAt: -Infinity, aim: null, landed: false, upgradeSeen: null };
      this.motions.set(id, state);
    }
    return state;
  }

  // 화면에서 사라진 타워·적의 움직임 상태 정리. O(n)
  pruneMotions(engine) {
    if (this.motions.size < 64) return;
    const alive = new Set([...engine.towers, ...engine.bugs].map(entity => entity.id));
    for (const id of this.motions.keys()) if (!alive.has(id)) this.motions.delete(id);
  }

  get context() {
    return this.surface.context;
  }

  // ---------- 좌표 ----------
  // 들판(0~1 정사각형 좌표)을 화면에 놓는 사각형: HUD 아래 ~ 상점 줄 위, 좌우 여백
  isWide() {
    return this.surface.width >= WIDE_LAYOUT;
  }

  // 낱말 패널 사각형
  panel() {
    const { width, height } = this.surface;
    if (this.isWide()) {
      const panelWidth = Math.round(width * PANEL_RATIO);
      return { left: width - panelWidth, top: HUD_HEIGHT, width: panelWidth, height: height - HUD_HEIGHT - SHOP_HEIGHT };
    }
    return { left: 0, top: height - SHOP_HEIGHT - STRIP_HEIGHT, width, height: STRIP_HEIGHT };
  }

  // 들판(0~1 좌표)을 놓는 사각형: HUD 아래 ~ (낱말 패널·상점) 위, 좌우 여백
  field() {
    const { width, height } = this.surface;
    const wide = this.isWide();
    const areaWidth = wide ? width - this.panel().width : width;
    const top = HUD_HEIGHT + 26;
    const bottom = height - SHOP_HEIGHT - (wide ? 0 : STRIP_HEIGHT) - 10;
    const side = Math.max(24, areaWidth * 0.05);
    return { left: side, top, width: areaWidth - side * 2, height: bottom - top };
  }

  // 상점 칸: [{ item, left, width }] — 그리기와 누르기가 같은 칸을 쓴다
  shopCells(engine) {
    const { width } = this.surface;
    const count = engine.shop.length;
    return engine.shop.map((entry, index) => ({ entry, left: width * index / count, width: width / count }));
  }

  // 누른 점이 상점 칸이면 그 품목 키, 아니면 null
  shopItemAt(engine, screenX, screenY) {
    if (screenY < this.surface.height - SHOP_HEIGHT) return null;
    return this.shopCells(engine).find(cell => screenX >= cell.left && screenX < cell.left + cell.width)?.entry.item ?? null;
  }

  toScreen(point) {
    const field = this.field();
    return { x: field.left + point.x * field.width, y: field.top + point.y * field.height };
  }

  bugPosition(bug) {
    return this.toScreen(bug);
  }

  towerPosition(tower) {
    return this.toScreen(tower);
  }

  computerPosition() {
    return this.toScreen(DEFENSE_COMPUTER);
  }

  // 화면 좌표(캔버스 CSS 픽셀) → 들판 좌표. 누른 자리에 타워를 세울 때 쓴다
  toField(screenX, screenY) {
    const field = this.field();
    return { x: (screenX - field.left) / field.width, y: (screenY - field.top) / field.height };
  }

  // 설치 모드에서 마우스가 가리키는 곳(유령 타워 미리보기). null이면 숨김
  setPointer(point) {
    this.pointer = point;
  }

  // 그림 크기 배율: 들판이 작은 휴대폰에서는 타워·공격을 줄여 길 사이에 들어가게(0.6~1)
  unit() {
    const field = this.field();
    return Math.max(0.6, Math.min(1, field.width / 700, field.height / 400));
  }

  pathWidth() {
    return Math.max(18, Math.min(30, this.field().height * 0.065));
  }

  // 사거리(들판 비율)를 화면 픽셀로: 가로·세로 중 짧은 쪽 기준(엔진도 정사각형으로 잰다)
  rangePixels(range) {
    const field = this.field();
    return range * Math.min(field.width, field.height);
  }

  // ---------- 이벤트 ----------
  onEvent(type, payload, engine) {
    if (type === 'lock') this.visuals.get(payload.target.id).labelPop.kick(14);
    else if (type === 'mistake' && payload.target) this.visuals.get(payload.target.id).labelPop.kick(-10);
    const now = wallSeconds();
    if (type === 'word-done') {
      this.wordFlights.push({ text: payload.word.token.text, coins: payload.coins, at: now });
      this.streamShift.value = 1;
    }
    if (type === 'start') {
      this.selectTower(null);
      this.motions.clear();
      this.debris = [];
    }
    if (type === 'wave-intro' || (type === 'start' && engine)) {
      const wave = payload.wave ?? 1;
      this.banner = { text: wave === DEFENSE_RULES.waves ? `FINAL WAVE ${wave}` : `WAVE ${wave}`, sub: `BPM ${payload.bpm ?? engine?.bpm?.() ?? ''} · 해킹을 막으세요`, at: now, color: wave === DEFENSE_RULES.waves ? SCENE.danger : SCENE.shield };
    } else if (type === 'wave-clear') {
      this.banner = { text: `WAVE ${payload.wave} CLEAR`, sub: `+${payload.bonus} 코인${payload.perfect ? ' · 무피해 보너스' : ''}`, at: now, color: '#4df0a6' };
    } else if (type === 'goal') {
      this.banner = { text: 'SYSTEM SECURE', sub: '모든 공격을 막았습니다!', at: now, color: '#4df0a6' };
    } else if (type === 'boss-phase') {
      this.banner = { text: `PHASE 2 · ${payload.label}`, sub: `${ATTACK_TYPES[payload.bug.type].label}이(가) 폭주합니다! 졸개를 부르고 타워를 잠가요`, at: now, color: '#ff4dd2' };
    } else if (type === 'air-warning') {
      this.banner = { text: 'AIR RAID!', sub: '드론은 길을 무시해요 · 요격포(5)만 떨어뜨릴 수 있어요(요격포는 땅도 쏴요)', at: now, color: TOWER_STYLE.interceptor };
    } else if (type === 'boss-appear') {
      this.banner = { text: 'RANSOMWARE!', sub: '여러 번 맞혀야 하는 랜섬웨어가 옵니다', at: now, color: SCENE.danger };
    }
    if (!this.context) return;
    const juice = this.juice;
    if (type === 'boss-phase') {
      const { x, y } = this.bugPosition(payload.bug);
      juice.shake(0.8);
      juice.flash('#ff4dd2', 0.45, 0.5);
      juice.ring(x, y, { color: '#ff4dd2', radius: 140, width: 6, life: 0.7 });
      this.particles.burst(x, y, { color: '#ff4dd2', count: 70, speed: 320, life: 0.9 });
    } else if (type === 'boss-summon') {
      for (const minion of payload.minions) {
        const { x, y } = this.bugPosition(minion);
        juice.ring(x, y, { color: BUG_STYLE[minion.type].body, radius: 30, width: 3 });
      }
    } else if (type === 'tower-locked') {
      const { x, y } = this.towerPosition(payload.tower);
      const from = this.bugPosition(payload.bug);
      this.lockBeams = [...(this.lockBeams ?? []), { from, to: { x, y }, at: now }];
      juice.popup(x, y - 30, '🔒 잠김', { color: '#ff4dd2', size: 14, life: 1 });
    } else if (type === 'bug-blocked') {
      this.motion(payload.bug.id).hitAt = engine?.gameTime ?? 0;
      const { x, y } = this.bugPosition(payload.bug);
      this.particles.burst(x, y, { color: '#ffffff', count: 4, speed: 90, life: 0.25 });
    } else if (type === 'bug-kill') {
      const { x, y } = this.bugPosition(payload.bug);
      const style = BUG_STYLE[payload.bug.type];
      const boss = Boolean(ATTACK_TYPES[payload.bug.type].boss);
      this.spawnDebris(payload.bug, x, y);
      this.particles.burst(x, y, { color: style.body, count: boss ? 60 : 10, speed: 200, life: 0.5 });
      juice.ring(x, y, { color: style.body, radius: style.size * 3 * this.unit(), width: 3 });
      if (boss) {
        juice.shake(0.6);
        juice.flash('#ffffff', 0.4, 0.4);
      }
    } else if (type === 'bug-hit') {
      this.motion(payload.bug.id).hitAt = engine?.gameTime ?? 0;
      const { x, y } = this.bugPosition(payload.bug);
      this.particles.burst(x, y, { color: '#ffffff', count: 8, speed: 140, life: 0.35 });
    } else if (type === 'tower-shot') {
      this.spawnShotEffect(payload.tower);
    } else if (type === 'damage') {
      const { x, y } = this.computerPosition();
      this.shieldHit = now;
      juice.shake(0.6);
      juice.flash('#ff2846', 0.35, 0.4);
      juice.popup(x, y - 60, `-${payload.damage}`, { color: SCENE.danger, size: 22 });
      this.particles.burst(x, y - 30, { color: SCENE.danger, count: 20, speed: 220, life: 0.6 });
    } else if (type === 'coins' && payload.reason !== 'tower') {
      const { x, y } = this.computerPosition();
      juice.popup(x + 70, y - 40, `+${payload.amount}🪙`, { color: SCENE.coin, size: payload.reason === 'wave' ? 22 : 15, life: 0.8 });
    } else if (type === 'tower-built') {
      // 착지 순간의 먼지·흔들림은 drawTower가 낙하가 끝날 때 낸다
      const { x, y } = this.towerPosition(payload.tower);
      juice.ring(x, y, { color: TOWER_STYLE[payload.tower.type], radius: 34 * this.unit(), width: 2, life: 0.3 });
    } else if (type === 'tower-upgraded') {
      // 충전 단계: 작은 빛 + 금가루가 타워로 빨려 든다(변신 터짐은 drawTower가 0.45초에 낸다)
      const { x, y } = this.towerPosition(payload.tower);
      this.spawnChargeMotes(x, y - 8 * this.unit(), TOWER_STYLE[payload.tower.type]);
    } else if (type === 'splash') {
      // 포탄이 날아가는 0.15초 뒤에 터진다
      const center = this.toScreen(payload);
      this.empBlasts.push({ x: center.x, y: center.y, radiusY: payload.radius * this.field().height, at: now + 0.15, level: payload.tower.level, seed: Math.random() * 10, burst: false });
      if (this.empBlasts.length > 16) this.empBlasts.shift();
    } else if (type === 'air-jammed') {
      const { x, y } = this.bugPosition(payload.bug);
      this.particles.burst(x, y, { color: '#d8c8ff', count: 10, speed: 140, life: 0.35, size: 1.8 });
      juice.popup(x, y - 22 * this.unit(), '⚡ 교란', { color: TOWER_STYLE.emp, size: 12, life: 0.7 });
    } else if (type === 'honey-step') {
      const { x, y } = this.bugPosition(payload.bug);
      this.particles.burst(x, y + 8 * this.unit(), { color: HONEY.body, count: 8, speed: 90, life: 0.35, gravity: 300, size: 2.5 });
    } else if (type === 'puddle') {
      const from = this.towerPosition(payload.tower);
      this.particles.burst(from.x, from.y - 14 * this.unit(), { color: HONEY.body, count: 5, speed: 70, life: 0.3, size: 2 });
    } else if (type === 'tower-sold') {
      const { x, y } = this.towerPosition(payload.tower);
      if (this.selectedTowerId === payload.tower.id) this.selectTower(null);
      juice.ring(x, y, { color: SCENE.coin, radius: 40 * this.unit(), width: 3, life: 0.4 });
      this.particles.burst(x, y, { color: '#8a93b8', count: 18, speed: 160, life: 0.5, gravity: 300 });
      juice.popup(x, y - 30 * this.unit(), `+${payload.refund}🪙`, { color: SCENE.coin, size: 16 });
    } else if (type === 'repair') {
      const { x, y } = this.computerPosition();
      juice.ring(x, y - 20, { color: '#4df0a6', radius: 90, width: 5 });
      juice.popup(x, y - 70, `+${DEFENSE_RULES.repairAmount}`, { color: '#4df0a6', size: 20 });
    } else if (type === 'place-denied') {
      const point = this.toScreen(payload);
      juice.ring(point.x, point.y, { color: SCENE.danger, radius: 26, width: 3, life: 0.3 });
      juice.popup(point.x, point.y - 18, { path: '길 위 ✕', computer: '컴퓨터 옆 ✕', blocked: '겹침 ✕', outside: '밖 ✕', 'max-level': 'MAX', 'max-towers': '가득', coins: '코인 부족' }[payload.reason] ?? '✕', { color: SCENE.danger, size: 13, life: 0.7 });
    } else if (type === 'shop-denied') {
      juice.shake(0.12);
      const reasons = { coins: `코인 부족 (${payload.price}🪙)`, 'no-slot': '설치·업그레이드할 자리가 없어요', full: '체력이 가득해요' };
      const { x, y } = this.computerPosition();
      juice.popup(x, y + 20, reasons[payload.reason] ?? '살 수 없어요', { color: SCENE.fog, size: 14, life: 1 });
    } else if (type === 'throw' && payload.combo > 0 && payload.combo % 10 === 0) {
      const { x, y } = this.computerPosition();
      juice.popup(x, y - 90, `${payload.combo} COMBO!`, { color: this.accent, size: 22, life: 1.1 });
    } else if (type === 'mistake') {
      juice.shake(0.1);
    }
  }

  // ---------- 그리기 ----------
  render(engine, { accent }) {
    const context = this.context;
    if (!context) return;
    this.surface.resize?.();
    this.accent = accent;
    const frameSeconds = Math.min(0.1, Math.max(0, engine.gameTime - this.lastGameTime)) || (engine.status === 'running' ? 0 : 1 / 60);
    this.lastGameTime = engine.gameTime;
    this.frameSeconds = frameSeconds;
    this.pruneMotions(engine);
    this.particles.update(frameSeconds);
    this.visuals.step(frameSeconds, new Set(engine.targetables().map(entity => entity.id)));
    const wallNow = wallSeconds();
    this.juice.step(this.lastWallSeconds == null ? 0 : wallNow - this.lastWallSeconds);
    this.lastWallSeconds = wallNow;
    this.juice.setDanger(engine.status === 'running' && engine.isDanger() ? 1 - engine.health / (engine.maxHealth * DEFENSE_RULES.dangerRatio) * 0.6 : 0);
    this.displayHealth ??= engine.health;
    this.displayHealth += (engine.health - this.displayHealth) * Math.min(1, frameSeconds * 8 || 0.2);

    const { width, height } = this.surface;
    context.clearRect(0, 0, width, height);
    this.juice.beginShake(context);
    this.drawBackground(context, width, height, engine);
    this.drawPath(context, engine);
    this.drawComputer(context, engine);
    this.drawPuddles(context, engine);
    for (const tower of engine.towers) this.drawTowerRange(context, tower, engine);
    for (const tower of engine.towers) this.drawTower(context, tower, engine);
    this.drawBuildPreview(context, engine);
    this.drawSpotLabels(context, engine);
    for (const shot of engine.towerShots) this.drawTowerShot(context, shot, engine);
    for (const bug of engine.bugs) if (!bug.air) this.drawBug(context, bug, engine);
    for (const bug of engine.bugs) if (bug.air) this.drawBug(context, bug, engine);
    this.drawDebris(context, frameSeconds);
    this.drawExplosions(context);
    this.drawEmpBlasts(context);
    this.drawLockBeams(context);
    this.particles.draw(context);
    this.juice.endShake(context);
    this.juice.drawOverlay(context, width, height);
    this.drawWordPanel(context, engine, frameSeconds);
    this.drawShop(context, width, height, engine);
    this.drawHud(context, width, engine);
    this.drawBossBar(context, engine);
    this.drawUpgradeCard(context, engine);
    this.drawBuildHint(context, width, engine);
    this.drawBanner(context, width);
  }

  // 그림 배치: 그림 속 방패 돔의 중심을 컴퓨터 자리에, 돔 꼭대기를 길 끝 근처에 맞춘다.
  // 돔이 너무 크면 길 끝이 모니터를 덮으므로 반지름은 (컴퓨터~길 끝 거리) / 0.62까지만. 그림이 모자란 가장자리는 배경색으로 채운다
  artLayout() {
    const image = STAGE_ART;
    const { width, height } = this.surface;
    const computer = this.computerPosition();
    const pathEnd = this.toScreen(DEFENSE_PATH.at(-1));
    const reach = Math.max(30, computer.y - pathEnd.y);
    const naturalRadius = ART_DOME.radius * image.naturalWidth;
    const coverScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const scale = Math.max(reach / naturalRadius, Math.min(coverScale, reach / 0.62 / naturalRadius));
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const left = computer.x - ART_DOME.x * drawWidth;
    const top = computer.y - ART_DOME.y * drawHeight;
    return { left, top, drawWidth, drawHeight, dome: { x: computer.x, y: computer.y, radius: ART_DOME.radius * drawWidth } };
  }

  // 길: 어두운 띠 + 하늘색 가장자리 + 컴퓨터 쪽으로 흐르는 점선
  drawPath(context, engine) {
    const points = DEFENSE_PATH.map(point => this.toScreen(point));
    const trace = () => {
      context.beginPath();
      points.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
    };
    const danger = engine.isDanger();
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.strokeStyle = danger ? 'rgba(255, 77, 109, 0.35)' : 'rgba(54, 226, 255, 0.28)';
    const pathWidth = this.pathWidth();
    context.lineWidth = pathWidth + 4;
    trace();
    context.stroke();
    context.strokeStyle = 'rgba(8, 11, 26, 0.9)';
    context.lineWidth = pathWidth;
    trace();
    context.stroke();
    context.strokeStyle = danger ? 'rgba(255, 77, 109, 0.45)' : 'rgba(54, 226, 255, 0.35)';
    context.lineWidth = 2;
    context.setLineDash([6, 10]);
    context.lineDashOffset = -wallSeconds() * 24;
    trace();
    context.stroke();
    context.setLineDash([]);
    context.lineDashOffset = 0;
    // 입구 표시
    const entry = points[0];
    context.fillStyle = SCENE.danger;
    context.font = canvasFont(10, 'ui', 700);
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    context.fillText('INBOUND', entry.x, entry.y - 2);
  }

  // 설치 모드 안내 줄(HUD 아래)
  drawBuildHint(context, width, engine) {
    const mode = engine.buildMode;
    if (!mode) return;
    const label = TOWER_TYPES[mode.tower].label;
    const left = Math.max(0, mode.until - engine.gameTime);
    const text = width < 560
      ? `${label} ${mode.upgrade ? '업그레이드' : '설치'}: 빈 곳 탭 · 번호 키 · ${Math.ceil(left)}s`
      : `${label} ${mode.upgrade ? '업그레이드할' : '설치할'} 곳을 누르거나 번호 키(자리 표시)를 누르세요 · Esc 취소 · ${Math.ceil(left)}s`;
    context.font = canvasFont(12, 'ui', 600);
    const textWidth = context.measureText(text).width + 24;
    const center = this.field().left + this.field().width / 2;
    context.fillStyle = 'rgba(14, 18, 34, 0.92)';
    roundedRect(context, center - textWidth / 2, HUD_HEIGHT + 4, textWidth, 20, 10);
    context.fill();
    context.strokeStyle = TOWER_STYLE[mode.tower];
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = TOWER_STYLE[mode.tower];
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, center, HUD_HEIGHT + 14);
  }

  // 설치 모드: 고를 수 있는 자리 위에 낱말
  drawSpotLabels(context, engine) {
    const narrow = this.surface.width < 520;
    for (const spot of engine.spots) {
      const { x, y } = this.toScreen(spot);
      // 추천 자리 표시: 타워 색으로 맥박치는 육각 테두리
      const pulse = 0.5 + 0.5 * Math.sin(wallSeconds() * 6 + spot.id);
      context.save();
      context.strokeStyle = TOWER_STYLE[engine.buildMode?.tower] ?? this.accent;
      context.globalAlpha = 0.5 + pulse * 0.4;
      context.lineWidth = 2;
      context.beginPath();
      for (let corner = 0; corner < 6; corner++) {
        const angle = Math.PI / 6 + corner * Math.PI / 3;
        const radius = 16 * this.unit();
        if (corner) context.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
        else context.moveTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
      }
      context.closePath();
      context.stroke();
      context.restore();
      // 번호 배지(그 숫자 키를 누르면 여기에 설치·업그레이드)
      const color = TOWER_STYLE[engine.buildMode?.tower] ?? this.accent;
      const badgeY = y - 26 * this.unit();
      context.fillStyle = 'rgba(14, 18, 34, 0.92)';
      context.beginPath();
      context.arc(x, badgeY, narrow ? 9 : 10, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = color;
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = color;
      context.font = canvasFont(narrow ? 11 : 12, 'code', 700);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(spot.towerId != null ? `${spot.hotkey}↑` : spot.hotkey, x, badgeY + 0.5);
    }
  }

  // 그림이 있으면 그림, 없으면 남색 그라데이션 + 격자 + 떨어지는 코드 비. 위험하면 붉게 물든다
  drawBackground(context, width, height, engine) {
    if (isArtReady(STAGE_ART)) {
      const layout = this.artLayout();
      context.fillStyle = SCENE.bgTop;
      context.fillRect(0, 0, width, height);
      context.drawImage(STAGE_ART, layout.left, layout.top, layout.drawWidth, layout.drawHeight);
      context.fillStyle = 'rgba(6, 9, 22, 0.25)';
      context.fillRect(0, 0, width, height);
    } else {
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, SCENE.bgTop);
      gradient.addColorStop(1, SCENE.bgBottom);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.strokeStyle = SCENE.grid;
      context.lineWidth = 1;
      for (let x = (width / 2) % 32; x < width; x += 32) {
        context.beginPath();
        context.moveTo(x + 0.5, HUD_HEIGHT);
        context.lineTo(x + 0.5, height);
        context.stroke();
      }
      for (let y = HUD_HEIGHT; y < height; y += 32) {
        context.beginPath();
        context.moveTo(0, y + 0.5);
        context.lineTo(width, y + 0.5);
        context.stroke();
      }
      this.drawCodeRain(context, width, height, engine);
    }
    if (engine.isDanger()) {
      context.fillStyle = `rgba(255, 40, 70, ${0.06 + 0.04 * Math.sin(wallSeconds() * 6)})`;
      context.fillRect(0, 0, width, height);
    }
  }

  // 0과 1이 줄마다 다른 속도로 흘러내린다. 위치는 시드 고정, 시간은 실제 시계. O(열 수 × 6)
  drawCodeRain(context, width, height, engine) {
    const random = seededRandom(11);
    const time = wallSeconds();
    context.font = canvasFont(11, 'code');
    context.textAlign = 'center';
    const columns = Math.floor(width / 26);
    for (let column = 0; column < columns; column++) {
      const speed = 30 + random() * 50;
      const offset = random() * height;
      const x = 13 + column * 26;
      for (let index = 0; index < 6; index++) {
        const y = HUD_HEIGHT + ((offset + time * speed + index * 15) % (height - HUD_HEIGHT));
        context.globalAlpha = 0.05 + index * 0.025;
        context.fillStyle = engine.isDanger() ? SCENE.danger : SCENE.rain;
        context.fillText(((column * 7 + index + Math.floor(time * 2)) % 2) ? '1' : '0', x, y);
      }
    }
    context.globalAlpha = 1;
  }

  // 사거리 원: 아주 옅게(설치 모드에서는 조금 진하게)
  drawTowerRange(context, tower, engine) {
    const { x, y } = this.towerPosition(tower);
    const color = TOWER_STYLE[tower.type];
    const range = this.rangePixels(towerStats(tower.type, tower.level).range);
    const selected = this.selectedTowerId === tower.id;
    context.save();
    if (selected && tower.level < DEFENSE_RULES.maxTowerLevel) {
      // 다음 레벨 사거리(흰 점선) 미리보기
      context.globalAlpha = 0.5;
      context.strokeStyle = '#ffffff';
      context.setLineDash([3, 5]);
      context.beginPath();
      context.arc(x, y, this.rangePixels(towerStats(tower.type, tower.level + 1).range), 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
    }
    context.globalAlpha = selected ? 0.2 : engine.buildMode ? 0.16 : 0.07;
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, range, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = selected ? 0.7 : engine.buildMode ? 0.4 : 0.15;
    context.strokeStyle = color;
    context.setLineDash([4, 6]);
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  // 타워 공통 받침(레벨별):
  // Lv.1 강철 육각판 · Lv.2 두꺼운 테두리 띠 + 양옆 신호등 기둥 · Lv.3 금 테두리 + 금 볼트 + 앞면에 빛나는 보석
  drawTowerBase(context, color, level, withShadow = true) {
    if (withShadow) {
      context.fillStyle = 'rgba(0, 0, 0, 0.45)';
      context.beginPath();
      context.ellipse(0, 15, 22, 7, 0, 0, Math.PI * 2);
      context.fill();
    }
    const time = wallSeconds();
    const hexagon = (radius, offsetY = 6) => {
      context.beginPath();
      for (let corner = 0; corner < 6; corner++) {
        const angle = Math.PI / 6 + corner * Math.PI / 3;
        const px = Math.cos(angle) * radius, py = Math.sin(angle) * radius * 0.62 + offsetY;
        if (corner) context.lineTo(px, py);
        else context.moveTo(px, py);
      }
      context.closePath();
    };
    // 옆면(두께): 레벨이 높을수록 두껍다
    const thickness = 2 + level * 1.5;
    context.fillStyle = level >= 3 ? '#6b5320' : '#0e1226';
    hexagon(level >= 2 ? 22 : 20, 6 + thickness);
    context.fill();
    const metal = context.createLinearGradient(0, -6, 0, 18);
    metal.addColorStop(0, level >= 3 ? '#4a4f7a' : level >= 2 ? '#40497f' : '#3a4378');
    metal.addColorStop(1, '#151a33');
    context.fillStyle = metal;
    hexagon(level >= 2 ? 22 : 20);
    context.fill();
    context.strokeStyle = level >= 3 ? '#ffd166' : color;
    context.globalAlpha = 0.9;
    context.lineWidth = level >= 3 ? 2.2 : 1.5;
    context.stroke();
    context.globalAlpha = 1;
    if (level >= 2) {
      // 안쪽 테두리 띠
      context.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      context.lineWidth = 1;
      hexagon(16);
      context.stroke();
      // 양옆 신호등 기둥(번갈아 깜빡)
      for (const side of [-1, 1]) {
        context.fillStyle = '#20264a';
        roundedRect(context, side * 22 - 3, -6, 6, 16, 2);
        context.fill();
        context.strokeStyle = level >= 3 ? '#ffd166' : 'rgba(255, 255, 255, 0.25)';
        context.lineWidth = 1;
        context.stroke();
        const blink = Math.sin(time * 5 + side * 1.6) > 0 ? 1 : 0.25;
        context.fillStyle = color;
        context.globalAlpha = blink;
        context.shadowColor = color;
        context.shadowBlur = 6 * blink;
        context.beginPath();
        context.arc(side * 22, -3, 2, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
        context.globalAlpha = 1;
      }
    }
    if (level >= 3) {
      // 금 볼트 넷 + 앞면 보석
      context.fillStyle = '#ffd166';
      for (const [bx, by] of [[-14, 2], [14, 2], [-14, 12], [14, 12]]) {
        context.beginPath();
        context.arc(bx, by, 1.6, 0, Math.PI * 2);
        context.fill();
      }
      const glow = 0.6 + 0.4 * Math.sin(time * 4);
      context.fillStyle = color;
      context.shadowColor = color;
      context.shadowBlur = 10 * glow;
      context.beginPath();
      context.moveTo(0, 9);
      context.lineTo(4, 13);
      context.lineTo(0, 17);
      context.lineTo(-4, 13);
      context.closePath();
      context.fill();
      context.shadowBlur = 0;
    }
    // 레벨 갈매기표(금색)
    for (let index = 0; index < level; index++) {
      const cx = -(level - 1) * 6 + index * 12;
      context.strokeStyle = '#ffd166';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(cx - 4, 24 + thickness - 3);
      context.lineTo(cx, 20 + thickness - 3);
      context.lineTo(cx + 4, 24 + thickness - 3);
      context.stroke();
    }
  }

  // Lv.3 왕관 고리: 타워 위에 기울어진 금 고리가 돌고, 빛 구슬 셋이 고리를 따라 돈다
  drawCrownHalo(context, color) {
    const time = wallSeconds();
    context.save();
    context.translate(0, -40);
    context.strokeStyle = 'rgba(255, 209, 102, 0.75)';
    context.lineWidth = 1.5;
    context.beginPath();
    context.ellipse(0, 0, 16, 5, 0, 0, Math.PI * 2);
    context.stroke();
    context.globalCompositeOperation = 'lighter';
    for (let orb = 0; orb < 3; orb++) {
      const angle = time * 2.4 + orb * Math.PI * 2 / 3;
      context.fillStyle = orb === 0 ? '#ffffff' : color;
      context.shadowColor = color;
      context.shadowBlur = 8;
      context.beginPath();
      context.arc(Math.cos(angle) * 16, Math.sin(angle) * 5, 2.2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  // 방화벽(레벨별):
  // Lv.1 벽돌 성벽 + 주황 불꽃 셋
  // Lv.2 더 넓고 높은 성벽 + 쇠 띠 + 양옆 화로 탑(각자 불꽃) + 불꽃 넷
  // Lv.3 강철 장갑 성벽에 주황 회로 무늬가 흐르고, 흰·하늘색 심지의 플라스마 불꽃 + 위에 떠 있는 방패 문장
  drawFirewall(context, tower, engine, fired) {
    const color = TOWER_STYLE.firewall;
    const time = wallSeconds();
    const level = tower.level ?? 1;
    const wallWidth = level >= 2 ? 34 : 28;
    const wallTop = level >= 2 ? -20 : -16;
    const half = wallWidth / 2;
    // 성벽 몸통
    const wall = context.createLinearGradient(0, wallTop - 2, 0, 6);
    if (level >= 3) {
      wall.addColorStop(0, '#5a6280');
      wall.addColorStop(1, '#1e2238');
    } else {
      wall.addColorStop(0, '#c2452a');
      wall.addColorStop(1, '#6e1f14');
    }
    context.fillStyle = wall;
    roundedRect(context, -half, wallTop, wallWidth, 6 - wallTop, 3);
    context.fill();
    if (level >= 3) {
      // 장갑판 이음새 + 흐르는 주황 회로
      context.strokeStyle = 'rgba(10, 12, 24, 0.9)';
      context.lineWidth = 1;
      for (const seam of [-half / 2, 0, half / 2]) {
        context.beginPath();
        context.moveTo(seam, wallTop);
        context.lineTo(seam, 6);
        context.stroke();
      }
      context.strokeStyle = color;
      context.shadowColor = color;
      context.shadowBlur = 6;
      context.lineWidth = 1.5;
      context.setLineDash([4, 4]);
      context.lineDashOffset = -time * 18;
      context.beginPath();
      context.moveTo(-half + 3, 0);
      context.lineTo(-half + 8, wallTop + 6);
      context.lineTo(half - 8, wallTop + 6);
      context.lineTo(half - 3, 0);
      context.stroke();
      context.setLineDash([]);
      context.shadowBlur = 0;
    } else {
      // 벽돌 줄눈
      context.strokeStyle = 'rgba(20, 8, 6, 0.8)';
      context.lineWidth = 1;
      const rowHeight = (6 - wallTop) / 3;
      for (let row = 0; row < 3; row++) {
        const y = wallTop + row * rowHeight;
        context.beginPath();
        context.moveTo(-half, y);
        context.lineTo(half, y);
        context.stroke();
        for (let column = -half + (row % 2 ? 7 : 0); column < half; column += 14) {
          context.beginPath();
          context.moveTo(column, y);
          context.lineTo(column, y + rowHeight);
          context.stroke();
        }
      }
      if (level >= 2) {
        // 쇠 띠 + 리벳
        context.fillStyle = '#4a4f6a';
        context.fillRect(-half, wallTop + 8, wallWidth, 3.5);
        context.fillStyle = '#c9d2f2';
        for (let rivet = -half + 4; rivet < half; rivet += 7) context.fillRect(rivet, wallTop + 9, 1.5, 1.5);
      }
    }
    // 성가퀴
    context.fillStyle = level >= 3 ? '#8a93b8' : '#d4583a';
    const notchWidth = wallWidth / 4;
    for (let notch = 0; notch < 3; notch++) context.fillRect(-half + notch * notchWidth * 1.5, wallTop - 5, notchWidth, 5);
    // 화로 탑(Lv.2+)
    const flames = [];
    if (level >= 2) {
      for (const side of [-1, 1]) {
        const towerX = side * (half + 4);
        context.fillStyle = level >= 3 ? '#3a4060' : '#8a2f1c';
        roundedRect(context, towerX - 4, wallTop - 6, 8, 12 - wallTop, 2);
        context.fill();
        context.fillStyle = level >= 3 ? '#ffd166' : '#4a4f6a';
        context.fillRect(towerX - 5, wallTop - 8, 10, 3);
        flames.push([towerX, wallTop - 8, 0.6, side * 2.3]);
      }
    }
    const mainFlames = level >= 2 ? [[-9, 0], [-3, 1.7], [3, 3.1], [9, 4.4]] : [[-7, 0], [0, 1.7], [7, 3.1]];
    for (const [offset, phase] of mainFlames) flames.push([offset, wallTop - 3, 1, phase]);
    // 불꽃(일렁임). Lv.3 = 흰·하늘 심지의 플라스마
    const height = 10 + level * 5 + fired * 14;
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (const [offset, base, scale, phase] of flames) {
      const flameHeight = height * scale;
      const flicker = Math.sin(time * 11 + phase + (tower.id ?? 0)) * 2.5;
      const flame = context.createLinearGradient(0, base - flameHeight, 0, base + 2);
      if (level >= 3) {
        flame.addColorStop(0, 'rgba(120, 220, 255, 0)');
        flame.addColorStop(0.35, 'rgba(160, 230, 255, 0.85)');
        flame.addColorStop(0.7, 'rgba(255, 255, 255, 0.95)');
        flame.addColorStop(1, color);
      } else {
        flame.addColorStop(0, 'rgba(255, 220, 120, 0)');
        flame.addColorStop(0.45, 'rgba(255, 170, 60, 0.85)');
        flame.addColorStop(1, color);
      }
      context.fillStyle = flame;
      context.beginPath();
      context.moveTo(offset - 5 * scale, base + 2);
      context.quadraticCurveTo(offset - 6 * scale, base - flameHeight * 0.5, offset + flicker * scale, base - flameHeight);
      context.quadraticCurveTo(offset + 6 * scale, base - flameHeight * 0.5, offset + 5 * scale, base + 2);
      context.closePath();
      context.fill();
    }
    // 불티(Lv.2+): 위로 날리는 작은 점
    if (level >= 2) {
      for (let spark = 0; spark < 3 + level; spark++) {
        const rise = (time * 0.9 + spark * 0.29 + (tower.id ?? 0) * 0.1) % 1;
        context.globalAlpha = 1 - rise;
        context.fillStyle = level >= 3 ? '#bfefff' : '#ffb547';
        context.fillRect((spark - 3) * 4 + Math.sin(time * 5 + spark) * 3, wallTop - 6 - rise * (height + 10), 1.8, 1.8);
      }
      context.globalAlpha = 1;
    }
    context.restore();
    // 방패 문장(Lv.3)
    if (level >= 3) {
      const float = Math.sin(time * 2.2) * 2;
      context.save();
      context.translate(0, wallTop - height - 8 + float);
      context.fillStyle = 'rgba(255, 122, 69, 0.25)';
      context.strokeStyle = '#ffd166';
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(0, -7);
      context.lineTo(6, -4);
      context.lineTo(5, 3);
      context.lineTo(0, 7);
      context.lineTo(-5, 3);
      context.lineTo(-6, -4);
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();
    }
  }

  // 백신(레벨별): 받침 위 돔 포탑이 표적을 향해 돈다
  // Lv.1 캡슐 포신 하나 · Lv.2 쌍포신 + 줄무늬 돔 + 안테나 · Lv.3 삼연장 포신 + 하얗게 빛나는 돔 + 위에 도는 십자 홀로그램
  // 쏠 때마다 포신이 번갈아 반동하고 포구가 번쩍
  drawAntivirus(context, tower, engine, fired) {
    const color = TOWER_STYLE.antivirus;
    const level = tower.level ?? 1;
    const angle = tower.viewAngle ?? -Math.PI / 2;
    const time = wallSeconds();
    // 돔
    const domeRadius = 13 + (level - 1) * 1.5;
    const dome = context.createRadialGradient(-4, -12, 2, 0, -8, domeRadius + 2);
    dome.addColorStop(0, '#ffffff');
    dome.addColorStop(0.5, level >= 3 ? '#8ae6ff' : '#4fbfdc');
    dome.addColorStop(1, level >= 3 ? '#2a6f94' : '#1b4a66');
    context.fillStyle = dome;
    if (level >= 3) {
      context.shadowColor = color;
      context.shadowBlur = 12 + Math.sin(time * 4) * 4;
    }
    context.beginPath();
    context.arc(0, -6, domeRadius, Math.PI, 0);
    context.lineTo(domeRadius, 2);
    context.lineTo(-domeRadius, 2);
    context.closePath();
    context.fill();
    context.shadowBlur = 0;
    if (level >= 2) {
      // 줄무늬 + 안테나
      context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(0, -6, domeRadius - 4, Math.PI * 1.1, Math.PI * 1.9);
      context.stroke();
      context.strokeStyle = '#c9d2f2';
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(-domeRadius + 3, -10);
      context.lineTo(-domeRadius - 1, -22);
      context.stroke();
      context.fillStyle = Math.sin(time * 6) > 0 ? color : '#ffffff';
      context.beginPath();
      context.arc(-domeRadius - 1, -22, 1.8, 0, Math.PI * 2);
      context.fill();
    }
    // 포신 묶음
    context.save();
    context.translate(0, -8);
    context.rotate(angle);
    const barrels = level;
    const spacing = 6;
    const firingBarrel = Math.floor(time * 1000 / 150) % barrels;
    for (let barrel = 0; barrel < barrels; barrel++) {
      const offset = (barrel - (barrels - 1) / 2) * spacing;
      const recoil = fired * 4 * (barrels === 1 || barrel === firingBarrel ? 1 : 0.3);
      const length = level >= 3 ? 1.1 : 1;
      context.fillStyle = '#f2f6ff';
      roundedRect(context, 4 - recoil, offset - 3.5, 11 * length, 7, 3.5);
      context.fill();
      context.fillStyle = color;
      roundedRect(context, 13 * length - recoil, offset - 3.5, 11 * length, 7, 3.5);
      context.fill();
      context.strokeStyle = '#0d2c3d';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(9 - recoil, offset - 3.5);
      context.lineTo(9 - recoil, offset + 3.5);
      context.stroke();
      if (fired > 0 && (barrels === 1 || barrel === firingBarrel)) {
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = `rgba(150, 240, 255, ${fired})`;
        context.beginPath();
        context.arc(25 * length, offset, 3 + fired * 6, 0, Math.PI * 2);
        context.fill();
        context.globalCompositeOperation = 'source-over';
      }
    }
    if (barrels > 1) {
      // 포신 묶는 고리
      context.fillStyle = level >= 3 ? '#ffd166' : '#8a93b8';
      context.fillRect(15 - fired * 2, -(barrels * spacing) / 2, 2.5, barrels * spacing);
    }
    context.restore();
    // 십자 마크
    context.fillStyle = '#ffffff';
    context.fillRect(-1.5, -12, 3, 8);
    context.fillRect(-4, -9.5, 8, 3);
    // Lv.3 십자 홀로그램(위에서 천천히 돔)
    if (level >= 3) {
      context.save();
      context.translate(0, -34 + Math.sin(time * 2) * 2);
      context.scale(Math.cos(time * 1.8), 1);
      context.globalCompositeOperation = 'lighter';
      context.fillStyle = 'rgba(54, 226, 255, 0.55)';
      context.shadowColor = color;
      context.shadowBlur = 10;
      context.fillRect(-2.5, -7, 5, 14);
      context.fillRect(-7, -2.5, 14, 5);
      context.restore();
    }
  }

  // 요격포(레벨별): 공중·지상 모두 노리는 미사일 발사대
  // Lv.1 미사일 둘 + 작은 레이더 · Lv.2 미사일 넷 포드 + 큰 레이더 · Lv.3 위아래 쌍포드(두 표적 동시) + 회전 레이더 빛줄기
  drawInterceptor(context, tower, engine, fired) {
    const color = TOWER_STYLE.interceptor;
    const level = tower.level ?? 1;
    const time = wallSeconds();
    const angle = tower.viewAngle ?? -Math.PI / 2;
    context.fillStyle = '#2a3a1a';
    roundedRect(context, -12, -6, 24, 10, 4);
    context.fill();
    context.strokeStyle = level >= 3 ? '#ffd166' : color;
    context.lineWidth = 1.2;
    context.stroke();
    // 레이더 접시
    const dish = 5 + level;
    context.save();
    context.translate(-9, -12 - level);
    context.strokeStyle = '#8a93b8';
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, 2);
    context.lineTo(0, 7 + level);
    context.stroke();
    context.scale(Math.cos(time * (2 + level) + (tower.id ?? 0)), 1);
    context.strokeStyle = '#e8ffd0';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, 0, dish, Math.PI * 0.15, Math.PI * 0.85);
    context.stroke();
    context.restore();
    if (level >= 3) {
      // 레이더 빛줄기(부채꼴 회전)
      context.save();
      context.translate(-9, -14);
      context.rotate(time * 2.5);
      context.globalCompositeOperation = 'lighter';
      const sweep = context.createRadialGradient(0, 0, 0, 0, 0, 34);
      sweep.addColorStop(0, 'rgba(195, 255, 77, 0.35)');
      sweep.addColorStop(1, 'rgba(195, 255, 77, 0)');
      context.fillStyle = sweep;
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, 34, -0.3, 0.3);
      context.closePath();
      context.fill();
      context.restore();
    }
    // 발사 포드
    const pods = level >= 3 ? [-6, 6] : [0];
    const rows = level >= 2 ? 4 : 2;
    context.save();
    context.translate(4, -8);
    context.rotate(angle);
    pods.forEach((podOffset, podIndex) => {
      const recoil = fired * 3 * (podIndex === 0 ? 1 : 0.7);
      const podHeight = rows * 3.6 + 2;
      context.fillStyle = level >= 3 ? '#5a6a2a' : '#4a5a2a';
      roundedRect(context, -4 - recoil, podOffset - podHeight / 2, 16, podHeight, 3);
      context.fill();
      if (level >= 2) {
        context.strokeStyle = level >= 3 ? '#ffd166' : 'rgba(255, 255, 255, 0.3)';
        context.lineWidth = 1;
        context.stroke();
      }
      for (let row = 0; row < rows; row++) {
        const offset = podOffset - podHeight / 2 + 1.5 + row * 3.6;
        context.fillStyle = '#f2ffe0';
        roundedRect(context, 2 - recoil, offset, 14, 2.6, 1.3);
        context.fill();
        context.fillStyle = '#ff5d73';
        context.beginPath();
        context.moveTo(16 - recoil, offset);
        context.lineTo(19 - recoil, offset + 1.3);
        context.lineTo(16 - recoil, offset + 2.6);
        context.fill();
      }
    });
    context.restore();
    if (fired > 0) {
      context.globalCompositeOperation = 'lighter';
      context.fillStyle = `rgba(255, 220, 120, ${fired * 0.8})`;
      context.beginPath();
      context.arc(4, -8, 10 * fired, 0, Math.PI * 2);
      context.fill();
      context.globalCompositeOperation = 'source-over';
    }
  }

  // 타워 한 대. 움직임:
  // - 설치: 설계도 고리 + 빛기둥(0.2s) → 하늘에서 낙하(0.25s, 세로로 늘어남) → 쿵 착지(먼지·흔들림) 후 찌그러졌다 탄성 복원
  // - 업그레이드: 금빛 기둥 속에서 껑충 뛰었다 내려앉음
  // - 조준: 마지막 표적 쪽으로 부드럽게 회전, 0.8초 넘게 쉬면 좌우로 둘러봄
  // - 발사: 몸통이 눌렸다 펴지는 반동(세부 연출은 각 타워 그리기 함수)
  drawTower(context, tower, engine) {
    const { x, y } = this.towerPosition(tower);
    const color = TOWER_STYLE[tower.type];
    const motion = this.motion(tower.id);
    const time = engine.gameTime;
    const shot = engine.towerShots.filter(entry => entry.towerId === tower.id).at(-1);
    const sinceShot = shot ? time - shot.at : Infinity;
    const scanAngle = -Math.PI / 2 + Math.sin(wallSeconds() * 0.9 + tower.id) * 0.9;
    const aimTarget = shot && sinceShot < 0.8 ? Math.atan2(this.toScreen(shot).y - (y - 8 * this.unit()), this.toScreen(shot).x - x) : scanAngle;
    motion.aim = motion.aim == null ? aimTarget : approachAngle(motion.aim, aimTarget, this.frameSeconds * (sinceShot < 0.8 ? 18 : 3));
    const view = { ...tower, viewAngle: motion.aim };
    const fired = Math.max(0, 1 - sinceShot / 0.25);
    const unit = this.unit();
    const build = this.buildMotion(tower, motion, time, x, y);
    const upgradeAge = tower.upgradedAt == null ? Infinity : time - tower.upgradedAt;
    const hop = upgradeAge < 0.6 ? Math.sin(Math.min(1, upgradeAge / 0.6) * Math.PI) * (12 + tower.level * 4) : 0;
    // 변신: 0.45초 동안 이전 레벨 모습과 새 모습이 깜빡이며 바뀌고, 0.45초에 한 번 터진다
    const transforming = upgradeAge < 0.45;
    const shownLevel = transforming && Math.floor(upgradeAge * 22) % 2 === 0 ? Math.max(1, tower.level - 1) : tower.level;
    if (tower.upgradedAt != null && upgradeAge >= 0.45 && motion.upgradeSeen !== tower.upgradedAt) {
      motion.upgradeSeen = tower.upgradedAt;
      if (upgradeAge < 0.8) this.upgradeBurst(tower, x, y);
    }
    view.level = shownLevel;

    context.save();
    context.translate(x, y);
    context.scale(unit, unit);
    if (build.blueprint != null) this.drawBlueprint(context, color, build.blueprint);
    if (upgradeAge < 1) this.drawLightColumn(context, '#ffd166', 1 - upgradeAge, 40 + tower.level * 10);
    if (transforming) this.drawConvergingRings(context, tower.level >= DEFENSE_RULES.maxTowerLevel ? '#ffd166' : color, upgradeAge / 0.45);
    if (this.selectedTowerId === tower.id) this.drawSelection(context, color);
    if (!build.hidden) {
      // 그림자는 낙하 높이에 따라 작아졌다 커진다
      const shadowScale = 1 - Math.min(0.7, -build.dropY / 160);
      context.fillStyle = 'rgba(0, 0, 0, 0.45)';
      context.beginPath();
      context.ellipse(0, 15, 22 * shadowScale, 7 * shadowScale, 0, 0, Math.PI * 2);
      context.fill();
      context.translate(0, build.dropY - hop);
      const recoilSquash = fired * 0.08;
      context.translate(0, 15);
      context.scale(build.scaleX * (1 + recoilSquash * 0.6), build.scaleY * (1 - recoilSquash));
      context.translate(0, -15);
      context.shadowColor = color;
      context.shadowBlur = 8 + fired * 12;
      this.drawTowerBase(context, color, shownLevel, false);
      context.shadowBlur = 0;
      this.drawEnergyRing(context, color, tower, time, engine);
      if (tower.type === 'firewall') this.drawFirewall(context, view, engine, fired);
      else if (tower.type === 'honeypot') this.drawHoneypot(context, view, engine, fired);
      else if (tower.type === 'emp') this.drawEmp(context, view, engine, fired);
      else if (tower.type === 'interceptor') this.drawInterceptor(context, view, engine, fired);
      else this.drawAntivirus(context, view, engine, fired);
      if (shownLevel >= DEFENSE_RULES.maxTowerLevel) this.drawCrownHalo(context, color);
      // 변신 중: 아래에서 위로 지나가는 흰 스캔 줄 + 몸 전체 금빛
      if (transforming) {
        const scan = 18 - (upgradeAge / 0.45) * 60;
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = 'rgba(255, 255, 255, 0.8)';
        context.fillRect(-26, scan, 52, 2.5);
        context.fillStyle = `rgba(255, 210, 120, ${0.35 * (1 - upgradeAge / 0.45)})`;
        context.beginPath();
        context.arc(0, -6, 28, 0, Math.PI * 2);
        context.fill();
        context.globalCompositeOperation = 'source-over';
      } else if (upgradeAge < 0.75) {
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = `rgba(255, 240, 200, ${0.8 * (1 - (upgradeAge - 0.45) / 0.3)})`;
        context.beginPath();
        context.arc(0, -6, 30, 0, Math.PI * 2);
        context.fill();
        context.globalCompositeOperation = 'source-over';
      }
    }
    // 보스가 잠근 타워: 보라 사슬 + 자물쇠
    if (engine.gameTime < (tower.lockedUntil ?? 0)) {
      context.fillStyle = 'rgba(40, 10, 50, 0.55)';
      context.beginPath();
      context.arc(0, -4, 22, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = '#ff4dd2';
      context.lineWidth = 2;
      context.setLineDash([3, 3]);
      context.lineDashOffset = -wallSeconds() * 20;
      context.stroke();
      context.setLineDash([]);
      context.font = canvasFont(16, 'ui', 700);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('🔒', 0, -6 + Math.sin(wallSeconds() * 8) * 1.5);
    }
    context.restore();
  }

  // 변신 터짐: 충격파 + 금빛 나선 불꽃 + 타워 색 파편, Lv.3이면 화면 금빛 섬광·흔들림·별 폭발 + MAX
  upgradeBurst(tower, x, y) {
    const unit = this.unit();
    const color = TOWER_STYLE[tower.type];
    const maxed = tower.level >= DEFENSE_RULES.maxTowerLevel;
    this.juice.ring(x, y - 6 * unit, { color: '#ffd166', radius: (maxed ? 110 : 75) * unit, width: maxed ? 6 : 4, life: 0.5 });
    this.juice.ring(x, y - 6 * unit, { color, radius: 45 * unit, width: 3, life: 0.35 });
    this.spawnSpiralSparks(x, y, maxed ? 30 : 18, maxed ? ['#ffd166', '#ffffff', color] : ['#ffd166', color]);
    this.particles.burst(x, y - 10 * unit, { color, count: maxed ? 28 : 14, speed: maxed ? 260 : 170, life: 0.6 });
    this.juice.shake(maxed ? 0.45 : 0.15);
    if (maxed) {
      this.juice.flash('#ffd166', 0.3, 0.45);
      this.particles.burst(x, y - 10 * unit, { color: '#ffffff', count: 20, speed: 340, life: 0.5, size: 2 });
      this.juice.popup(x, y - 56 * unit, `MAX ★ ${TOWER_MAX_PERKS[tower.type]?.label ?? ''}`, { color: '#ffd166', size: 18, life: 1.3 });
    } else {
      this.juice.popup(x, y - 50 * unit, `Lv.${tower.level} ▲`, { color: '#ffd166', size: 17 });
    }
  }

  // 충전 가루: 타워 둘레 원에서 안쪽으로 모여드는 금빛 점(파편 목록에 'charge' 모양으로 넣는다)
  spawnChargeMotes(x, y, color) {
    const unit = this.unit();
    for (let index = 0; index < 16; index++) {
      const angle = index / 16 * Math.PI * 2;
      this.debris.push({ shape: 'charge', cx: x, cy: y, angle, radius: 70 * unit, life: 0, maxLife: 0.45, color: index % 2 ? '#ffd166' : color, size: 2.5, unit, x, y, vx: 0, vy: 0, rotation: 0, spin: 0 });
    }
  }

  // 나선 불꽃: 타워 둘레를 돌며 위로 솟는 빛 점
  spawnSpiralSparks(x, y, count, colors) {
    const unit = this.unit();
    for (let index = 0; index < count; index++) {
      this.debris.push({
        shape: 'spiral', cx: x, cy: y, angle: index / count * Math.PI * 2, radius: 10 * unit, life: 0, maxLife: 0.8 + Math.random() * 0.4,
        color: colors[index % colors.length], size: 2 + Math.random() * 1.5, unit, rise: 70 + Math.random() * 60, x, y, vx: 0, vy: 0, rotation: 0, spin: 0
      });
    }
  }

  // 변신 중 모여드는 에너지 고리 셋(바깥 → 안쪽)
  drawConvergingRings(context, color, progress) {
    context.save();
    context.strokeStyle = color;
    for (let ring = 0; ring < 3; ring++) {
      const local = Math.min(1, Math.max(0, progress * 1.4 - ring * 0.2));
      if (local <= 0 || local >= 1) continue;
      context.globalAlpha = Math.sin(local * Math.PI) * 0.9;
      context.lineWidth = 2.5 - ring * 0.5;
      context.beginPath();
      context.ellipse(0, 4, 70 * (1 - local) + 14, (70 * (1 - local) + 14) * 0.45, 0, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  // 고른 타워 표시: 발밑 점선 고리 + 위에서 내려다보는 화살표
  drawSelection(context, color) {
    const time = wallSeconds();
    context.save();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.setLineDash([6, 4]);
    context.lineDashOffset = -time * 30;
    context.beginPath();
    context.ellipse(0, 8, 30, 15, 0, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.restore();
  }

  // 설치 연출 단계 계산. 착지하는 순간 한 번 먼지·흔들림을 낸다(새로고침 등으로 이미 오래된 타워는 조용히 착지 처리)
  buildMotion(tower, motion, time, screenX, screenY) {
    const age = time - (tower.builtAt ?? -Infinity);
    const { blueprint, drop, settle } = BUILD_MOTION;
    const result = { hidden: false, dropY: 0, scaleX: 1, scaleY: 1, blueprint: null };
    if (age < blueprint) {
      result.hidden = true;
      result.blueprint = age / blueprint;
      return result;
    }
    if (age < blueprint + drop) {
      const progress = (age - blueprint) / drop;
      result.dropY = -150 * (1 - progress * progress);
      result.scaleX = 0.86;
      result.scaleY = 1.18;
      result.blueprint = 1;
      return result;
    }
    if (!motion.landed) {
      motion.landed = true;
      if (age < blueprint + drop + 0.3) this.landingImpact(tower, screenX, screenY);
    }
    const settleAge = age - blueprint - drop;
    if (settleAge < settle) {
      const wobble = Math.exp(-settleAge * 9) * Math.cos(settleAge * 32);
      result.scaleY = 1 - 0.3 * wobble;
      result.scaleX = 1 + 0.24 * wobble;
    }
    return result;
  }

  // 쿵: 먼지 고리 + 흙먼지 + 살짝 흔들림 + "설치!"
  landingImpact(tower, x, y) {
    const unit = this.unit();
    const color = TOWER_STYLE[tower.type];
    this.juice.shake(0.18);
    this.juice.ring(x, y + 12 * unit, { color: '#c9d2f2', radius: 46 * unit, width: 3, life: 0.35 });
    this.particles.burst(x, y + 12 * unit, { color: '#8a93b8', count: 16, speed: 150, life: 0.45, gravity: 300 });
    this.particles.burst(x, y, { color, count: 10, speed: 120, life: 0.5 });
    this.juice.popup(x, y - 40 * unit, '설치!', { color, size: 16 });
  }

  // 설계도: 바닥에 타워 색 점선 육각 고리가 그려지고(진행도만큼), 위에서 빛기둥이 내려온다
  drawBlueprint(context, color, progress) {
    context.save();
    context.strokeStyle = color;
    context.globalAlpha = 0.9;
    context.lineWidth = 1.5;
    context.setLineDash([4, 3]);
    context.beginPath();
    const corners = Math.max(1, Math.ceil(progress * 6));
    for (let corner = 0; corner <= corners; corner++) {
      const angle = Math.PI / 6 + corner * Math.PI / 3;
      const px = Math.cos(angle) * 22, py = Math.sin(angle) * 22 * 0.62 + 6;
      if (corner) context.lineTo(px, py);
      else context.moveTo(px, py);
    }
    context.stroke();
    context.setLineDash([]);
    context.restore();
    this.drawLightColumn(context, color, Math.min(1, progress * 1.5), 30);
  }

  // 빛기둥(설치·업그레이드): 위로 갈수록 투명한 세로 빛
  drawLightColumn(context, color, strength, width) {
    if (strength <= 0) return;
    context.save();
    context.globalCompositeOperation = 'lighter';
    const beam = context.createLinearGradient(0, -170, 0, 12);
    beam.addColorStop(0, 'rgba(255, 255, 255, 0)');
    beam.addColorStop(1, color);
    context.globalAlpha = 0.45 * strength;
    context.fillStyle = beam;
    context.fillRect(-width / 2, -170, width, 182);
    context.globalAlpha = 0.8 * strength;
    context.fillStyle = '#ffffff';
    context.fillRect(-1.5, -170, 3, 182);
    context.restore();
  }

  // 받침 둘레를 도는 에너지 점선 고리(잠기면 멈추고 흐려짐). 장전이 끝나면 밝아진다
  drawEnergyRing(context, color, tower, time, engine) {
    const locked = time < (tower.lockedUntil ?? 0);
    const ready = time >= (tower.readyAt ?? 0);
    context.save();
    context.strokeStyle = color;
    context.globalAlpha = locked ? 0.15 : ready ? 0.75 : 0.3;
    context.lineWidth = 1.5;
    context.setLineDash([3, 6]);
    context.lineDashOffset = locked ? 0 : -wallSeconds() * 24;
    context.beginPath();
    context.ellipse(0, 7, 25, 14, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  // 발사 부가 연출: 백신 = 탄피(흰 캡슐 조각)가 튐, 요격포 = 뒤로 연기, 방화벽 = 열기 고리
  spawnShotEffect(tower) {
    if (!this.context || !tower) return;
    const { x, y } = this.towerPosition(tower);
    const unit = this.unit();
    if (tower.type === 'antivirus') {
      this.particles.burst(x, y - 8 * unit, { color: '#f2f6ff', count: 2, speed: 110, life: 0.5, gravity: 500, size: 2 });
    } else if (tower.type === 'interceptor') {
      this.particles.burst(x, y - 6 * unit, { color: 'rgba(200, 210, 230, 0.7)', count: 6, speed: 60, life: 0.7, gravity: -80, size: 4 });
    } else if (tower.type === 'firewall') {
      this.juice.ring(x, y - 10 * unit, { color: '#ff7a45', radius: 28 * unit, width: 2, life: 0.3 });
      this.particles.burst(x, y - 20 * unit, { color: '#ffb547', count: 6, speed: 80, life: 0.5, gravity: -200, size: 2 });
    }
  }

  // 설치 모드: 길 금지 띠를 붉게, 마우스 자리에 유령 타워(놓을 수 있으면 타워 색, 없으면 빨강 ×)
  drawBuildPreview(context, engine) {
    const mode = engine.buildMode;
    if (!mode) return;
    const points = DEFENSE_PATH.map(point => this.toScreen(point));
    context.save();
    context.strokeStyle = 'rgba(255, 77, 109, 0.14)';
    context.lineWidth = this.pathWidth() + 26;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();
    points.forEach((point, index) => (index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)));
    context.stroke();
    context.restore();
    if (!this.pointer) return;
    const field = this.toField(this.pointer.x, this.pointer.y);
    const sameTower = engine.towers.find(tower => tower.type === mode.tower && Math.hypot((tower.x - field.x) * this.field().width, (tower.y - field.y) * this.field().height) < 26);
    // 못 놓는 곳이면 실제로 지어질(가장 가까운 빈) 자리에 유령을 끌어다 보여 준다
    const placement = sameTower ? { point: field, nudged: false } : engine.resolvePlacement(field);
    const ok = Boolean(placement.point);
    const color = ok ? TOWER_STYLE[mode.tower] : SCENE.danger;
    const target = sameTower ? this.towerPosition(sameTower) : ok ? this.toScreen(placement.point) : this.pointer;
    if (placement.nudged) {
      context.save();
      context.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      context.setLineDash([2, 4]);
      context.beginPath();
      context.moveTo(this.pointer.x, this.pointer.y);
      context.lineTo(target.x, target.y);
      context.stroke();
      context.restore();
    }
    const { x, y } = target;
    context.save();
    context.globalAlpha = 0.85;
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.setLineDash([5, 5]);
    context.beginPath();
    context.arc(x, y, ok ? this.rangePixels(towerStats(mode.tower, sameTower ? Math.min(DEFENSE_RULES.maxTowerLevel, sameTower.level + 1) : 1).range) : 22, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    if (ok) {
      context.globalAlpha = 0.6;
      context.translate(x, y + Math.sin(wallSeconds() * 4) * 2);
      context.scale(this.unit(), this.unit());
      this.drawTowerBase(context, color, 1);
      if (mode.tower === 'firewall') this.drawFirewall(context, { level: 1, id: 0 }, engine, 0);
      else if (mode.tower === 'honeypot') this.drawHoneypot(context, { level: 1, id: 0 }, engine, 0);
      else if (mode.tower === 'emp') this.drawEmp(context, { level: 1, id: 0 }, engine, 0);
      else if (mode.tower === 'interceptor') this.drawInterceptor(context, { level: 1, viewAngle: -Math.PI / 2 }, engine, 0);
      else this.drawAntivirus(context, { level: 1, viewAngle: -Math.PI / 2 }, engine, 0);
    } else {
      context.beginPath();
      context.moveTo(x - 9, y - 9);
      context.lineTo(x + 9, y + 9);
      context.moveTo(x + 9, y - 9);
      context.lineTo(x - 9, y + 9);
      context.stroke();
    }
    context.restore();
  }

  // 컴퓨터: 모니터 + 본체, 화면 얼굴은 체력에 따라 표정이 바뀌고, 방패 돔은 체력만큼 밝다
  drawComputer(context, engine) {
    if (isArtReady(STAGE_ART)) return this.drawArtShield(context, engine);
    const { x, y } = this.computerPosition();
    const ratio = Math.max(0, this.displayHealth / engine.maxHealth);
    const hitAge = wallSeconds() - this.shieldHit;
    const shieldColor = engine.isDanger() ? SCENE.danger : SCENE.shield;
    context.save();
    context.globalAlpha = 0.12 + 0.3 * ratio + (hitAge < 0.3 ? 0.4 * (1 - hitAge / 0.3) : 0);
    context.strokeStyle = shieldColor;
    context.lineWidth = 3;
    context.shadowColor = shieldColor;
    context.shadowBlur = 18;
    context.beginPath();
    context.arc(x, y + 10, 78, Math.PI, 0);
    context.stroke();
    context.restore();
    // 모니터
    context.fillStyle = '#1a2048';
    roundedRect(context, x - 46, y - 46, 92, 62, 8);
    context.fill();
    context.strokeStyle = '#4a5590';
    context.lineWidth = 2;
    context.stroke();
    const screen = engine.isDanger() ? '#3a0d1c' : '#0b2a3a';
    context.fillStyle = screen;
    roundedRect(context, x - 38, y - 39, 76, 46, 4);
    context.fill();
    // 얼굴
    context.fillStyle = engine.isDanger() ? SCENE.danger : '#7dffc4';
    const blink = Math.sin(wallSeconds() * 1.3) > 0.97;
    for (const side of [-1, 1]) {
      if (blink) context.fillRect(x + side * 13 - 5, y - 20, 10, 2);
      else context.fillRect(x + side * 13 - 3, y - 25, 6, engine.isDanger() ? 4 : 8);
    }
    context.strokeStyle = context.fillStyle;
    context.lineWidth = 2;
    context.beginPath();
    if (engine.isDanger()) context.arc(x, y - 2, 8, Math.PI * 1.15, Math.PI * 1.85);
    else context.arc(x, y - 10, 8, Math.PI * 0.15, Math.PI * 0.85);
    context.stroke();
    // 받침 + 키보드
    context.fillStyle = '#2a3260';
    context.fillRect(x - 8, y + 16, 16, 10);
    roundedRect(context, x - 40, y + 26, 80, 10, 3);
    context.fill();
  }

  // 그림이 있을 때: 그림 속 돔 위에 체력만큼 빛나는 방패 테두리와 맞을 때 번쩍임만 덧그린다
  drawArtShield(context, engine) {
    const { dome } = this.artLayout();
    const ratio = Math.max(0, this.displayHealth / engine.maxHealth);
    const hitAge = wallSeconds() - this.shieldHit;
    const color = engine.isDanger() ? SCENE.danger : SCENE.shield;
    context.save();
    context.globalAlpha = 0.15 + 0.35 * ratio + (hitAge < 0.3 ? 0.5 * (1 - hitAge / 0.3) : 0);
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.shadowColor = color;
    context.shadowBlur = 16;
    context.beginPath();
    context.arc(dome.x, dome.y, dome.radius, Math.PI, 0);
    context.stroke();
    if (engine.isDanger()) {
      context.globalAlpha = 0.18 + 0.1 * Math.sin(wallSeconds() * 8);
      context.fillStyle = SCENE.danger;
      context.fill();
    }
    context.restore();
  }

  // 악성 파일 = 색이 갈라지는(글리치) 보라 문서, 랜섬웨어 = 쇠사슬이 도는 거대한 자물쇠 괴물(남은 체력 = 방패 조각)
  // 공격 한 개. 움직임:
  // - 출현: 0.35초 동안 디지털 생성(작은 크기에서 튀어나오며 가로 글리치 줄, 바닥 포털 고리)
  // - 이동: 종류별 걸음(패킷 통통 튀기, 스팸 날갯짓 비행, 악성 파일 뒤뚱, 드론 호버링, 보스 쿵쿵)
  // - 피격: 하얗게 번쩍 + 맞은 반대쪽으로 밀림 + 크기 펀치
  // - 처치: 몸은 바로 사라지고 종류별 파편(spawnDebris)이 흩어짐. 컴퓨터에 닿음: 돔 속으로 빨려 들어가며 작아짐
  drawBug(context, bug, engine) {
    const style = BUG_STYLE[bug.type];
    const time = engine.gameTime;
    const deadAge = bug.state === 'alive' ? 0 : time - bug.resolvedAt;
    if (bug.state === 'dead' && deadAge > 0.06) return;
    if (bug.state === 'breached' && deadAge > 0.3) return;
    let { x, y } = this.bugPosition(bug);
    const heading = this.bugHeading(bug, x, y);
    const motion = this.motion(bug.id);
    const hitAge = time - motion.hitAt;
    const hit = hitAge >= 0 && hitAge < HIT_FLASH_SECONDS ? 1 - hitAge / HIT_FLASH_SECONDS : 0;
    const spawnAge = time - (bug.spawnedAt ?? -Infinity);
    const spawn = spawnAge >= 0 && spawnAge < SPAWN_SECONDS ? spawnAge / SPAWN_SECONDS : 1;
    const gait = this.bugGait(bug, time);
    const unit = this.unit();
    if (bug.state === 'breached') {
      const target = this.computerPosition();
      const pull = Math.min(1, deadAge / 0.3);
      x += (target.x - x) * pull;
      y += (target.y - 30 * unit - y) * pull;
    }
    // 출현 포털(바닥 고리)
    if (spawn < 1 && !bug.air) {
      context.save();
      context.globalAlpha = 1 - spawn;
      context.strokeStyle = style.body;
      context.lineWidth = 2;
      context.beginPath();
      context.ellipse(x, y + style.size * unit, style.size * 2 * unit * (0.5 + spawn), style.size * 0.6 * unit * (0.5 + spawn), 0, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }
    context.save();
    context.translate(x - Math.cos(heading) * hit * 7 * unit, y - Math.sin(heading) * hit * 7 * unit);
    let scale = unit * (spawn < 1 ? easeOutBack(spawn) : 1) * (1 + hit * 0.22);
    if (bug.state === 'breached') scale *= 1 - Math.min(1, deadAge / 0.3);
    if (bug.state === 'dead') scale *= 1.3;
    context.scale(scale, scale);
    // 바닥 그림자(공중은 멀리, 걸음에 따라 크기 변화)
    context.fillStyle = bug.air ? 'rgba(0, 0, 0, 0.22)' : 'rgba(0, 0, 0, 0.35)';
    context.beginPath();
    context.ellipse(0, style.size + (bug.air ? 22 : 6), style.size * (bug.air ? 0.7 : 0.9) * gait.shadow, style.size * 0.25 * gait.shadow, 0, 0, Math.PI * 2);
    context.fill();
    context.translate(0, gait.lift);
    context.rotate(gait.tilt);
    context.translate(0, style.size);
    context.scale(gait.scaleX, gait.scaleY);
    context.translate(0, -style.size);
    if (hit > 0 || bug.state === 'dead') context.filter = `brightness(${1 + (bug.state === 'dead' ? 2 : hit * 1.8)}) saturate(${1 - hit * 0.6})`;
    if (bug.type === 'packet') this.drawPacket(context, style, heading, time, bug);
    else if (bug.type === 'spam') this.drawSpam(context, style, time, bug);
    else if (bug.type === 'malware') this.drawMalware(context, style, time, bug);
    else if (bug.type === 'drone') this.drawDrone(context, style, heading, time, bug);
    else if (bug.type === 'rootkit') this.drawRootkit(context, style, time, bug, engine);
    else this.drawRansomware(context, style, time, bug, engine);
    context.filter = 'none';
    // 출현 글리치: 가로 줄 몇 개가 몸을 가로지른다
    if (spawn < 1) {
      context.globalCompositeOperation = 'lighter';
      context.fillStyle = style.body;
      for (let line = 0; line < 4; line++) {
        const lineY = ((line * 37 + spawnAge * 400) % (style.size * 3)) - style.size * 1.5;
        context.globalAlpha = (1 - spawn) * 0.8;
        context.fillRect(-style.size * 1.6, lineY, style.size * 3.2, 2);
      }
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    }
    // 화상(방화벽에 맞은 뒤): 몸 위로 타오르는 불길, 끝나 갈수록 작아진다
    const burnLeft = (bug.burnUntil ?? 0) - time;
    if (bug.state === 'alive' && burnLeft > 0) this.drawBurning(context, style.size, time, bug.id, Math.min(1, burnLeft / 0.6));
    // EMP 교란(공중 드론): 몸을 감싸는 보라 전기 고리 + 튀는 번개
    if (bug.state === 'alive' && time < (bug.jamUntil ?? 0)) this.drawJammed(context, style.size, time, bug.id);
    // 끈끈이 웅덩이 위: 발에 꿀이 엉겨 붙어 늘어진다
    if (bug.state === 'alive' && engine.activePuddlesUnder?.(bug).length) this.drawStuckGoo(context, style.size, time, bug.id);
    // 2페이즈로 바뀌는 중(무적): 흰 육각 방패가 감싼다
    if (time < bug.shieldUntil) {
      context.strokeStyle = `rgba(255, 255, 255, ${0.5 + 0.4 * Math.sin(time * 30)})`;
      context.lineWidth = 3;
      context.beginPath();
      for (let corner = 0; corner < 6; corner++) {
        const angle = corner * Math.PI / 3 + time;
        const radius = style.size * 1.9;
        if (corner) context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
        else context.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      }
      context.closePath();
      context.stroke();
    }
    context.restore();
    if (bug.state === 'alive' && bug.maxHp > 1 && !ATTACK_TYPES[bug.type].boss) {
      const barWidth = style.size * 2 * unit;
      const barY = y + (style.size + 10) * unit;
      context.fillStyle = 'rgba(0, 0, 0, 0.6)';
      roundedRect(context, x - barWidth / 2, barY, barWidth, 4, 2);
      context.fill();
      context.fillStyle = hit > 0 ? '#ffffff' : style.body;
      roundedRect(context, x - barWidth / 2, barY, barWidth * bug.hp / bug.maxHp, 4, 2);
      context.fill();
    }
  }

  // 진행 방향(라디안): 땅 공격은 길 앞쪽, 공중은 컴퓨터 쪽
  bugHeading(bug, x, y) {
    const ahead = bug.air
      ? this.toScreen({ x: DEFENSE_COMPUTER.x, y: DEFENSE_COMPUTER.y - 0.1 })
      : this.toScreen(pointOnPath(Math.min(1, bug.progress + 0.01)));
    return Math.atan2(ahead.y - y, ahead.x - x) || 0;
  }

  // 종류별 걸음새: 들림(lift)·기울기(tilt)·찌그러짐(scaleX/Y, 발바닥 기준)·그림자 크기
  bugGait(bug, time) {
    const phase = time + bug.id * 0.37;
    const rage = bug.phase === 2 ? 1.6 : 1;
    if (bug.type === 'packet') {
      const hop = Math.abs(Math.sin(phase * 7));
      const ground = Math.max(0, 1 - hop * 4);
      return { lift: -hop * 7, tilt: 0, scaleX: 1 + ground * 0.18, scaleY: 1 - ground * 0.2 + (1 - ground) * hop * 0.08, shadow: 1 - hop * 0.35 };
    }
    if (bug.type === 'spam') return { lift: -6 + Math.sin(phase * 5) * 4, tilt: Math.sin(phase * 3) * 0.14, scaleX: 1, scaleY: 1, shadow: 0.7 - Math.sin(phase * 5) * 0.1 };
    if (bug.type === 'malware') {
      const step = Math.sin(phase * 8);
      return { lift: -Math.abs(step) * 3, tilt: step * 0.16, scaleX: 1, scaleY: 1 + Math.abs(step) * 0.04, shadow: 1 };
    }
    if (bug.type === 'drone') return { lift: Math.sin(phase * 4) * 3, tilt: 0, scaleX: 1, scaleY: 1, shadow: 1 - Math.sin(phase * 4) * 0.1 };
    const stomp = Math.abs(Math.sin(phase * 2.6 * rage));
    const ground = Math.max(0, 1 - stomp * 5);
    return { lift: -stomp * 6, tilt: Math.sin(phase * 1.3 * rage) * 0.05, scaleX: 1 + ground * 0.08, scaleY: 1 - ground * 0.08, shadow: 1 - stomp * 0.2 };
  }

  // 화상 불길: 몸 둘레에서 위로 일렁이는 불꽃 다섯 + 튀는 불씨. strength 0~1(꺼져 갈수록 작게)
  drawBurning(context, size, time, seed, strength) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (let tongue = 0; tongue < 5; tongue++) {
      const offset = (tongue - 2) * size * 0.38;
      const height = size * (0.9 + 0.5 * Math.abs(Math.sin(time * 9 + tongue * 1.7 + seed))) * strength;
      const flame = context.createLinearGradient(0, -size * 0.3 - height, 0, size * 0.4);
      flame.addColorStop(0, 'rgba(255, 220, 120, 0)');
      flame.addColorStop(0.5, 'rgba(255, 140, 50, 0.75)');
      flame.addColorStop(1, 'rgba(255, 70, 40, 0.5)');
      context.fillStyle = flame;
      context.beginPath();
      context.moveTo(offset - size * 0.25, size * 0.4);
      context.quadraticCurveTo(offset - size * 0.3, -size * 0.2, offset + Math.sin(time * 13 + tongue) * 2, -size * 0.3 - height);
      context.quadraticCurveTo(offset + size * 0.3, -size * 0.2, offset + size * 0.25, size * 0.4);
      context.closePath();
      context.fill();
    }
    context.restore();
    this.drawEmbers(context, size, time, seed);
  }

  // 전자기 교란: 기울어진 보라 고리가 깜빡이며 돌고, 짧은 번개 셋이 몸에서 튄다
  drawJammed(context, size, time, seed) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.strokeStyle = `rgba(179, 140, 255, ${0.5 + 0.4 * Math.sin(time * 30)})`;
    context.lineWidth = 2;
    context.beginPath();
    context.ellipse(0, 0, size * 1.4, size * 0.5, Math.sin(time * 3 + seed) * 0.4, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = 'rgba(235, 225, 255, 0.9)';
    context.lineWidth = 1.2;
    for (let bolt = 0; bolt < 3; bolt++) {
      if (Math.sin(time * 23 + bolt * 2 + seed) < 0) continue;
      const angle = time * 7 + bolt * 2.1 + seed;
      context.beginPath();
      context.moveTo(Math.cos(angle) * size * 0.4, Math.sin(angle) * size * 0.4);
      context.lineTo(Math.cos(angle + 0.4) * size * 0.9, Math.sin(angle + 0.4) * size * 0.9);
      context.lineTo(Math.cos(angle) * size * 1.3, Math.sin(angle) * size * 1.3);
      context.stroke();
    }
    context.restore();
  }

  // 끈끈이: 발밑에 꿀 덩어리 + 몸으로 늘어진 꿀 줄기 둘
  drawStuckGoo(context, size, time, seed) {
    context.save();
    context.fillStyle = 'rgba(245, 184, 46, 0.85)';
    context.beginPath();
    context.ellipse(0, size * 0.95, size * 1.05, size * 0.32, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgba(245, 184, 46, 0.7)';
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    for (const side of [-1, 1]) {
      const sag = Math.sin(time * 3 + seed + side) * 2;
      context.beginPath();
      context.moveTo(side * size * 0.5, size * 0.95);
      context.quadraticCurveTo(side * size * 0.65 + sag, size * 0.4, side * size * 0.45, size * 0.1);
      context.stroke();
    }
    context.fillStyle = 'rgba(255, 240, 200, 0.8)';
    context.beginPath();
    context.ellipse(-size * 0.4, size * 0.88, size * 0.2, size * 0.06, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  // 방화벽 화상: 머리 위로 피어오르는 주황 불씨 세 개
  drawEmbers(context, size, time, seed) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (let index = 0; index < 3; index++) {
      const rise = (time * 1.4 + index / 3 + seed * 0.13) % 1;
      context.globalAlpha = 1 - rise;
      context.fillStyle = index % 2 ? '#ffb547' : '#ff7a45';
      context.beginPath();
      context.arc((index - 1) * size * 0.5 + Math.sin(time * 9 + index) * 2, -size - rise * size * 1.2, 2.2 * (1 - rise) + 1, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  // 처치 파편(화면 좌표). 종류별 모양: 패킷 = 붉은 삼각 결정, 스팸 = 종이 조각, 악성 파일·루트킷 = 픽셀·0/1,
  // 드론 = 금속 조각 + 프로펠러, 랜섬웨어 = 쇠사슬 고리·자물쇠 조각. O(조각 수)
  spawnDebris(bug, x, y) {
    const style = BUG_STYLE[bug.type];
    const boss = Boolean(ATTACK_TYPES[bug.type].boss);
    const count = boss ? 26 : 9;
    const unit = this.unit();
    const shape = { packet: 'shard', spam: 'paper', malware: 'pixel', drone: 'metal', ransomware: 'link', rootkit: 'bit' }[bug.type] ?? 'shard';
    for (let index = 0; index < count; index++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (boss ? 160 : 110) + Math.random() * (boss ? 260 : 150);
      this.debris.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 120,
        rotation: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 18,
        size: (boss ? 6 : 3.5) + Math.random() * (boss ? 6 : 3), life: 0, maxLife: 0.6 + Math.random() * 0.4,
        color: index % 3 === 0 ? style.dark : style.body, shape, unit,
        text: Math.random() > 0.5 ? '1' : '0'
      });
    }
    if (this.debris.length > 240) this.debris.splice(0, this.debris.length - 240);
  }

  // 파편 움직이고 그리기(중력 + 회전, 수명 끝에 흐려짐)
  drawDebris(context, frameSeconds) {
    if (!this.debris.length) return;
    const step = frameSeconds || 0;
    context.save();
    for (const piece of this.debris) {
      if (piece.shape === 'charge' || piece.shape === 'spiral') {
        piece.life += step;
        const fade = 1 - piece.life / piece.maxLife;
        if (fade <= 0) continue;
        if (piece.shape === 'charge') {
          const pull = Math.min(1, piece.life / piece.maxLife);
          const radius = piece.radius * (1 - pull * pull);
          piece.angle += step * 3;
          piece.x = piece.cx + Math.cos(piece.angle) * radius;
          piece.y = piece.cy + Math.sin(piece.angle) * radius * 0.5;
        } else {
          piece.angle += step * 7;
          piece.radius += step * 22 * piece.unit;
          piece.cy -= step * piece.rise * piece.unit;
          piece.x = piece.cx + Math.cos(piece.angle) * piece.radius;
          piece.y = piece.cy + Math.sin(piece.angle) * piece.radius * 0.4;
        }
        context.globalCompositeOperation = 'lighter';
        context.globalAlpha = Math.min(1, fade * 1.6);
        context.fillStyle = piece.color;
        context.beginPath();
        context.arc(piece.x, piece.y, piece.size * piece.unit, 0, Math.PI * 2);
        context.fill();
        context.globalCompositeOperation = 'source-over';
        continue;
      }
      piece.life += step;
      piece.vy += 620 * step;
      piece.vx *= 1 - Math.min(1, step * 1.5);
      piece.x += piece.vx * step;
      piece.y += piece.vy * step;
      piece.rotation += piece.spin * step;
      const fade = 1 - piece.life / piece.maxLife;
      if (fade <= 0) continue;
      const size = piece.size * piece.unit;
      context.globalAlpha = Math.min(1, fade * 1.5);
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.rotation);
      context.fillStyle = piece.color;
      context.strokeStyle = piece.color;
      if (piece.shape === 'shard') {
        context.beginPath();
        context.moveTo(0, -size);
        context.lineTo(size * 0.7, size * 0.6);
        context.lineTo(-size * 0.5, size * 0.4);
        context.closePath();
        context.fill();
      } else if (piece.shape === 'paper') {
        context.fillStyle = '#fff1c2';
        context.fillRect(-size, -size * 0.6, size * 2, size * 1.2);
        context.fillStyle = piece.color;
        context.fillRect(-size, -size * 0.6, size * 2, 1.5);
      } else if (piece.shape === 'pixel') {
        context.fillRect(-size / 2, -size / 2, size, size);
      } else if (piece.shape === 'metal') {
        context.fillStyle = '#4a6a62';
        context.fillRect(-size, -size * 0.3, size * 2, size * 0.6);
      } else if (piece.shape === 'link') {
        context.lineWidth = 2;
        context.beginPath();
        context.ellipse(0, 0, size, size * 0.6, 0, 0, Math.PI * 2);
        context.stroke();
      } else {
        context.font = canvasFont(Math.round(size * 2), 'code', 700);
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(piece.text, 0, 0);
      }
      context.restore();
    }
    context.restore();
    this.debris = this.debris.filter(piece => piece.life < piece.maxLife);
  }

  drawPacket(context, style, heading, time, bug) {
    const size = style.size;
    // 잔상(진행 반대 방향으로 세 줄)
    context.save();
    context.rotate(heading);
    context.globalCompositeOperation = 'lighter';
    for (let index = 1; index <= 3; index++) {
      context.fillStyle = `rgba(255, 93, 115, ${0.22 - index * 0.05})`;
      context.beginPath();
      context.moveTo(-size * 0.4 - index * 7, -size * 0.5 + index);
      context.lineTo(-size * 0.4 - index * 7 - 10, 0);
      context.lineTo(-size * 0.4 - index * 7, size * 0.5 - index);
      context.closePath();
      context.fill();
    }
    context.restore();
    // 결정(위·아래 면 색을 달리해 입체감)
    const spin = Math.sin(time * 3 + bug.id) * 0.25;
    context.save();
    context.scale(1 + spin * 0.15, 1);
    context.shadowColor = style.body;
    context.shadowBlur = 14;
    context.fillStyle = '#ff8a9a';
    context.beginPath();
    context.moveTo(0, -size * 1.15);
    context.lineTo(size * 0.85, 0);
    context.lineTo(-size * 0.85, 0);
    context.closePath();
    context.fill();
    context.fillStyle = style.dark;
    context.beginPath();
    context.moveTo(-size * 0.85, 0);
    context.lineTo(size * 0.85, 0);
    context.lineTo(0, size * 1.15);
    context.closePath();
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = '#ffd0d8';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, -size * 1.15);
    context.lineTo(0, size * 1.15);
    context.stroke();
    context.restore();
    // 빛나는 데이터 코어 + 주위를 도는 0·1 비트 둘
    const core = 0.5 + 0.5 * Math.sin(time * 9 + bug.id);
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.fillStyle = `rgba(255, 220, 230, ${0.4 + core * 0.4})`;
    context.beginPath();
    context.arc(0, size * 0.35, size * 0.22, 0, Math.PI * 2);
    context.fill();
    context.font = canvasFont(8, 'code', 700);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    for (let bit = 0; bit < 2; bit++) {
      const angle = time * 4 + bit * Math.PI + bug.id;
      context.fillStyle = '#ffb3c0';
      context.fillText(bit ? '1' : '0', Math.cos(angle) * size * 1.45, Math.sin(angle) * size * 0.5);
    }
    context.restore();
    context.translate(0, -1);
    this.drawAngryFace(context, size / 13, '#ffffff', false);
  }

  drawSpam(context, style, time, bug) {
    const size = style.size;
    const flap = Math.sin(time * 18 + bug.id) * 0.6;
    // 뒤로 흩날리는 작은 @ 스팸 조각
    context.save();
    context.font = canvasFont(8, 'code', 700);
    context.textAlign = 'center';
    for (let trail = 0; trail < 3; trail++) {
      const drift = (time * 1.8 + trail / 3 + bug.id * 0.2) % 1;
      context.globalAlpha = (1 - drift) * 0.7;
      context.fillStyle = style.body;
      context.fillText('@', -size * 1.2 - drift * 18, size * 0.3 + Math.sin(time * 6 + trail) * 4 - trail * 4);
    }
    context.restore();
    // 날개(픽셀 깃털 셋)
    for (const side of [-1, 1]) {
      context.save();
      context.translate(side * size * 0.95, -size * 0.2);
      context.rotate(side * (0.3 + flap));
      context.fillStyle = '#fff4cc';
      for (let feather = 0; feather < 3; feather++) {
        roundedRect(context, side > 0 ? 0 : -10 + feather * 1.5, -6 + feather * 4, 10 - feather * 2, 3.5, 1.5);
        context.fill();
      }
      context.restore();
    }
    // 봉투
    context.shadowColor = style.body;
    context.shadowBlur = 12;
    context.fillStyle = '#fff1c2';
    roundedRect(context, -size, -size * 0.7, size * 2, size * 1.4, 3);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = style.dark;
    context.lineWidth = 1.5;
    context.stroke();
    context.beginPath();
    context.moveTo(-size, -size * 0.7);
    context.lineTo(0, size * 0.1);
    context.lineTo(size, -size * 0.7);
    context.stroke();
    // 빨간 봉인 + @ 표시
    context.fillStyle = '#ff4d6d';
    context.beginPath();
    context.arc(0, size * 0.15, size * 0.32, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ffffff';
    context.font = canvasFont(Math.round(size * 0.5), 'code', 700);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('@', 0, size * 0.17);
    context.translate(0, -size * 0.25);
    this.drawAngryFace(context, size / 16, '#ffffff', false);
  }

  drawMalware(context, style, time, bug) {
    const size = style.size;
    const glitch = Math.sin(time * 23 + bug.id * 3) > 0.7 ? 2.5 : 0;
    // 종종걸음 다리 넷(번갈아 들림)
    context.strokeStyle = style.dark;
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    for (let leg = 0; leg < 4; leg++) {
      const legX = -size * 0.55 + leg * size * 0.37;
      const lift = Math.max(0, Math.sin(time * 16 + bug.id + (leg % 2) * Math.PI)) * 4;
      context.beginPath();
      context.moveTo(legX, size * 0.85);
      context.lineTo(legX + (leg < 2 ? -2 : 2), size * 1.25 - lift);
      context.stroke();
    }
    context.lineCap = 'butt';
    const page = (offsetX, color) => {
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(-size * 0.75 + offsetX, -size);
      context.lineTo(size * 0.35 + offsetX, -size);
      context.lineTo(size * 0.75 + offsetX, -size * 0.6);
      context.lineTo(size * 0.75 + offsetX, size);
      context.lineTo(-size * 0.75 + offsetX, size);
      context.closePath();
      context.fill();
    };
    // 색 갈라짐(글리치): 빨강·하늘을 양옆으로 살짝
    context.save();
    context.globalCompositeOperation = 'lighter';
    page(-2 - glitch, 'rgba(255, 60, 100, 0.55)');
    page(2 + glitch, 'rgba(60, 220, 255, 0.55)');
    context.restore();
    context.shadowColor = style.body;
    context.shadowBlur = 12;
    page(0, '#3a1f5c');
    context.shadowBlur = 0;
    context.strokeStyle = style.body;
    context.lineWidth = 1.8;
    context.stroke();
    // 접힌 모서리
    context.fillStyle = style.body;
    context.beginPath();
    context.moveTo(size * 0.35, -size);
    context.lineTo(size * 0.35, -size * 0.6);
    context.lineTo(size * 0.75, -size * 0.6);
    context.closePath();
    context.fill();
    // 코드 줄
    context.fillStyle = 'rgba(199, 146, 234, 0.6)';
    for (let line = 0; line < 2; line++) context.fillRect(-size * 0.5, size * 0.45 + line * 4, size * (0.9 - line * 0.3), 2);
    context.translate(0, -size * 0.15);
    this.drawAngryFace(context, size / 15, '#f3e6ff', true);
  }

  drawRansomware(context, style, time, bug, engine) {
    const size = style.size;
    const rage = bug.phase === 2;
    const pulse = 0.5 + 0.5 * Math.sin(time * (rage ? 9 : 4));
    // 2페이즈(암호화 폭주): 몸이 떨리고 자홍색 코드 고리가 돈다
    if (rage) {
      context.translate(Math.sin(time * 47) * 1.5, Math.cos(time * 53) * 1.5);
      context.save();
      context.rotate(-time * 1.6);
      context.font = canvasFont(9, 'code', 700);
      context.fillStyle = 'rgba(255, 77, 210, 0.85)';
      context.textAlign = 'center';
      for (let index = 0; index < 12; index++) {
        context.rotate(Math.PI / 6);
        context.fillText(index % 2 ? '0x' : '#!', 0, -size * 2.1);
      }
      context.restore();
    }
    // 붉은 기운
    const aura = context.createRadialGradient(0, 0, size * 0.4, 0, 0, size * 1.9);
    aura.addColorStop(0, rage ? `rgba(255, 77, 210, ${0.35 + pulse * 0.2})` : `rgba(255, 40, 70, ${0.25 + pulse * 0.15})`);
    aura.addColorStop(1, 'rgba(255, 40, 70, 0)');
    context.fillStyle = aura;
    context.beginPath();
    context.arc(0, 0, size * 1.9, 0, Math.PI * 2);
    context.fill();
    // 남은 체력 = 도는 방패 조각
    context.save();
    context.rotate(time * 0.8);
    const pieces = Math.min(10, bug.maxHp);
    const alivePieces = Math.ceil(bug.hp / bug.maxHp * pieces);
    for (let index = 0; index < pieces; index++) {
      const angle = index / pieces * Math.PI * 2;
      context.strokeStyle = index < alivePieces ? '#ffb547' : 'rgba(255, 181, 71, 0.15)';
      context.lineWidth = 4;
      context.beginPath();
      context.arc(0, 0, size * 1.45, angle + 0.12, angle + Math.PI * 2 / pieces - 0.12);
      context.stroke();
    }
    context.restore();
    // 고리(쇠고리, 위아래로 들썩)
    const lift = pulse * 3;
    context.strokeStyle = '#9aa3c7';
    context.lineWidth = size * 0.22;
    context.lineCap = 'round';
    context.beginPath();
    context.arc(0, -size * 0.35 - lift, size * 0.55, Math.PI, 0);
    context.lineTo(size * 0.55, -size * 0.1 - lift);
    context.moveTo(-size * 0.55, -size * 0.35 - lift);
    context.lineTo(-size * 0.55, -size * 0.1 - lift);
    context.stroke();
    context.lineCap = 'butt';
    // 몸통(자물쇠)
    const body = context.createLinearGradient(0, -size * 0.3, 0, size);
    body.addColorStop(0, '#3a0d1c');
    body.addColorStop(1, '#16050c');
    context.fillStyle = body;
    context.shadowColor = style.body;
    context.shadowBlur = 20;
    roundedRect(context, -size * 0.85, -size * 0.3, size * 1.7, size * 1.3, size * 0.28);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = style.body;
    context.lineWidth = 2.5;
    context.stroke();
    // 리벳
    context.fillStyle = '#ff8a9a';
    for (const [rx, ry] of [[-0.68, -0.13], [0.68, -0.13], [-0.68, 0.82], [0.68, 0.82]]) {
      context.beginPath();
      context.arc(rx * size, ry * size, 2, 0, Math.PI * 2);
      context.fill();
    }
    // 눈(노랑, 깜빡임) + 열쇠 구멍 입(빛남)
    const blink = Math.sin(time * 1.7 + 1) > 0.95 ? 0.2 : 1;
    context.fillStyle = '#ffe08a';
    context.shadowColor = '#ffe08a';
    context.shadowBlur = 10;
    for (const side of [-1, 1]) {
      context.beginPath();
      context.moveTo(side * size * 0.15, size * 0.02);
      context.lineTo(side * size * 0.55, -size * 0.06);
      context.lineTo(side * size * 0.45, size * 0.12 * blink + size * 0.02);
      context.closePath();
      context.fill();
    }
    context.fillStyle = `rgba(255, 60, 90, ${0.7 + pulse * 0.3})`;
    context.shadowColor = '#ff3c5a';
    context.beginPath();
    context.arc(0, size * 0.42, size * 0.16, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(-size * 0.09, size * 0.48);
    context.lineTo(size * 0.09, size * 0.48);
    context.lineTo(size * 0.05, size * 0.82);
    context.lineTo(-size * 0.05, size * 0.82);
    context.closePath();
    context.fill();
    context.shadowBlur = 0;
    // 쇠사슬 두 줄(양옆에서 흔들)
    context.strokeStyle = '#6f7799';
    context.lineWidth = 2;
    for (const side of [-1, 1]) {
      for (let link = 0; link < 3; link++) {
        const swing = Math.sin(time * 3 + link + side) * 3;
        context.beginPath();
        context.ellipse(side * (size * 0.95 + link * 7), size * 0.35 + link * 5 + swing, 3.5, 2.2, side * 0.6, 0, Math.PI * 2);
        context.stroke();
      }
    }
  }

  // 화난 눈썹 + 눈(공통). scale = 크기 배율
  drawAngryFace(context, scale, color = '#ffffff', mouth = true) {
    context.fillStyle = color;
    context.strokeStyle = '#1a0610';
    context.lineWidth = 1.6 * scale;
    for (const side of [-1, 1]) {
      context.beginPath();
      context.ellipse(side * 4 * scale, 0, 2.3 * scale, 2.8 * scale, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#1a0610';
      context.beginPath();
      context.arc(side * 4 * scale + side * 0.5 * scale, 0.6 * scale, 1.2 * scale, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(side * 1.5 * scale, -3.2 * scale);
      context.lineTo(side * 7 * scale, -5.2 * scale);
      context.stroke();
    }
    if (mouth) {
      context.beginPath();
      context.moveTo(-2.5 * scale, 5 * scale);
      context.quadraticCurveTo(0, 3 * scale, 2.5 * scale, 5 * scale);
      context.stroke();
    }
  }

  // 스파이웨어 드론: 네 개의 프로펠러가 도는 작은 감시 드론, 가운데 붉은 카메라 눈이 깜빡이며 아래로 스캔 빛을 쏜다
  drawDrone(context, style, heading, time, bug) {
    const size = style.size;
    const tilt = Math.cos(heading) * 0.25;
    context.rotate(tilt);
    // 스캔 빛(아래로 퍼지는 삼각형)
    context.save();
    context.globalCompositeOperation = 'lighter';
    const scan = context.createLinearGradient(0, 0, 0, size * 2.4);
    scan.addColorStop(0, 'rgba(255, 77, 109, 0.35)');
    scan.addColorStop(1, 'rgba(255, 77, 109, 0)');
    context.fillStyle = scan;
    context.beginPath();
    context.moveTo(-3, size * 0.3);
    context.lineTo(3, size * 0.3);
    context.lineTo(size * 0.9, size * 2.4);
    context.lineTo(-size * 0.9, size * 2.4);
    context.closePath();
    context.fill();
    context.restore();
    // 팔 + 프로펠러
    context.strokeStyle = '#4a6a62';
    context.lineWidth = 2.5;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(dx * size, dy * size * 0.6);
      context.stroke();
      context.save();
      context.translate(dx * size, dy * size * 0.6 - 3);
      context.scale(1, 0.32);
      context.rotate((time < (bug.jamUntil ?? 0) ? time * 9 + Math.sin(time * 31) : time * 40) * dx);
      context.fillStyle = 'rgba(200, 255, 235, 0.5)';
      context.beginPath();
      context.ellipse(0, 0, size * 0.62, size * 0.14, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    // 몸통
    const body = context.createRadialGradient(-2, -3, 1, 0, 0, size * 0.7);
    body.addColorStop(0, '#eafff6');
    body.addColorStop(0.5, style.body);
    body.addColorStop(1, style.dark);
    context.fillStyle = body;
    context.shadowColor = style.body;
    context.shadowBlur = 10;
    context.beginPath();
    context.ellipse(0, 0, size * 0.62, size * 0.5, 0, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    // 카메라 눈
    const blink = Math.sin(time * 3 + bug.id) > 0.9 ? 0.3 : 1;
    context.fillStyle = '#16050c';
    context.beginPath();
    context.arc(0, size * 0.08, size * 0.26, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ff4d6d';
    context.shadowColor = '#ff4d6d';
    context.shadowBlur = 8;
    context.beginPath();
    context.ellipse(0, size * 0.08, size * 0.14, size * 0.14 * blink, 0, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
  }

  // 루트킷(10웨이브 최종 보스): 초록 코드가 흐르는 검은 오벨리스크에 왕관(root)을 쓴 거대한 터미널 군주.
  // 화면에 #_ 프롬프트 눈, 양옆으로 떠다니는 권한 열쇠들. 2페이즈(권한 탈취): 왕관이 붉게 타고 몸이 갈라져 드론을 뿜는다
  drawRootkit(context, style, time, bug) {
    const size = style.size;
    const rage = bug.phase === 2;
    const pulse = 0.5 + 0.5 * Math.sin(time * (rage ? 8 : 3));
    const glow = rage ? '#ff3c5a' : style.body;
    // 기운
    const aura = context.createRadialGradient(0, 0, size * 0.5, 0, 0, size * 2);
    aura.addColorStop(0, rage ? `rgba(255, 60, 90, ${0.3 + pulse * 0.2})` : `rgba(57, 255, 136, ${0.2 + pulse * 0.15})`);
    aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = aura;
    context.beginPath();
    context.arc(0, 0, size * 2, 0, Math.PI * 2);
    context.fill();
    // 남은 체력 = 도는 권한 열쇠(10개)
    context.save();
    context.rotate(time * (rage ? 1.6 : 0.7));
    const keys = 10;
    for (let index = 0; index < keys; index++) {
      const alive = index < Math.ceil(bug.hp / bug.maxHp * keys);
      context.save();
      context.rotate(index / keys * Math.PI * 2);
      context.translate(size * 1.6, 0);
      context.globalAlpha = alive ? 1 : 0.15;
      context.strokeStyle = '#ffd166';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(0, 0, 3, 0, Math.PI * 2);
      context.moveTo(3, 0);
      context.lineTo(9, 0);
      context.lineTo(9, 3);
      context.stroke();
      context.restore();
    }
    context.restore();
    // 몸통(오벨리스크)
    const shake = rage ? Math.sin(time * 41) * 1.5 : 0;
    context.translate(shake, 0);
    context.fillStyle = '#04120a';
    context.shadowColor = glow;
    context.shadowBlur = 22;
    context.beginPath();
    context.moveTo(-size * 0.7, size);
    context.lineTo(-size * 0.55, -size * 0.75);
    context.lineTo(size * 0.55, -size * 0.75);
    context.lineTo(size * 0.7, size);
    context.closePath();
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = glow;
    context.lineWidth = 2.5;
    context.stroke();
    // 흐르는 초록 코드
    context.save();
    context.clip();
    context.font = canvasFont(8, 'code', 700);
    context.textAlign = 'center';
    for (let column = -2; column <= 2; column++) {
      for (let row = 0; row < 6; row++) {
        const y = -size * 0.75 + ((row * 11 + time * 30 + column * 7) % (size * 1.8));
        context.fillStyle = `rgba(${rage ? '255, 90, 110' : '57, 255, 136'}, ${0.15 + (row / 6) * 0.35})`;
        context.fillText(((row + column + Math.floor(time * 3)) & 1) ? '1' : '0', column * size * 0.24, y);
      }
    }
    context.restore();
    // 갈라짐(2페이즈)
    if (rage) {
      context.strokeStyle = '#ff8a9a';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-size * 0.1, -size * 0.7);
      context.lineTo(size * 0.08, -size * 0.2);
      context.lineTo(-size * 0.12, size * 0.25);
      context.lineTo(size * 0.06, size * 0.9);
      context.stroke();
    }
    // 화면(눈): #_ 프롬프트
    context.fillStyle = '#0a2a18';
    roundedRect(context, -size * 0.45, -size * 0.5, size * 0.9, size * 0.5, 4);
    context.fill();
    context.fillStyle = glow;
    context.shadowColor = glow;
    context.shadowBlur = 10;
    context.font = canvasFont(Math.round(size * 0.36), 'code', 700);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(Math.sin(time * 4) > 0 ? '#_' : '# ', 0, -size * 0.25);
    context.shadowBlur = 0;
    // 왕관
    context.fillStyle = rage ? '#ff5d73' : '#ffd166';
    context.beginPath();
    context.moveTo(-size * 0.5, -size * 0.78);
    context.lineTo(-size * 0.5, -size * 1.18);
    context.lineTo(-size * 0.25, -size * 0.95);
    context.lineTo(0, -size * 1.3 - pulse * 3);
    context.lineTo(size * 0.25, -size * 0.95);
    context.lineTo(size * 0.5, -size * 1.18);
    context.lineTo(size * 0.5, -size * 0.78);
    context.closePath();
    context.fill();
  }

  // 보스가 타워를 잠글 때 잠깐 보이는 자홍색 사슬 빔
  drawLockBeams(context) {
    const now = wallSeconds();
    this.lockBeams = (this.lockBeams ?? []).filter(beam => now - beam.at < 0.6);
    for (const beam of this.lockBeams) {
      const age = (now - beam.at) / 0.6;
      context.save();
      context.globalAlpha = 1 - age;
      context.strokeStyle = '#ff4dd2';
      context.lineWidth = 3;
      context.setLineDash([6, 5]);
      context.lineDashOffset = -now * 60;
      context.beginPath();
      context.moveTo(beam.from.x, beam.from.y);
      context.lineTo(beam.to.x, beam.to.y);
      context.stroke();
      context.restore();
    }
  }

  // 낱말 패널: 연습 모드처럼 칠 낱말이 줄지어 있고, 다 치면 다음 낱말이 위로 올라온다. 친 낱말은 +코인을 남기고 위로 날아간다.
  // 넓은 화면: 오른쪽 세로 패널(맨 위가 지금 낱말), 좁은 화면: 상점 위 가로 띠(왼쪽이 지금 낱말)
  drawWordPanel(context, engine, frameSeconds) {
    const panel = this.panel();
    const wide = this.isWide();
    this.streamShift.step(frameSeconds || 1 / 60);
    const shift = Math.max(0, this.streamShift.value);
    context.save();
    context.fillStyle = 'rgba(9, 12, 24, 0.9)';
    context.fillRect(panel.left, panel.top, panel.width, panel.height);
    context.fillStyle = 'rgba(54, 226, 255, 0.25)';
    if (wide) context.fillRect(panel.left, panel.top, 1, panel.height);
    else context.fillRect(panel.left, panel.top, panel.width, 1);
    context.beginPath();
    context.rect(panel.left, panel.top, panel.width, panel.height);
    context.clip();
    const current = engine.stream[0];
    const states = current ? engine.getCharacterStates(current) : [];
    if (wide) {
      context.font = canvasFont(11, 'ui', 600);
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillStyle = SCENE.fog;
      context.fillText('⌨ 쳐서 코인 벌기', panel.left + 14, panel.top + 18);
      const rowHeight = Math.min(46, (panel.height - 60) / DEFENSE_RULES.streamLength);
      const firstY = panel.top + 58;
      engine.stream.forEach((word, index) => {
        const y = firstY + (index + shift) * rowHeight;
        const centerX = panel.left + panel.width / 2;
        if (index === 0) {
          context.fillStyle = 'rgba(54, 226, 255, 0.08)';
          roundedRect(context, panel.left + 8, y - rowHeight / 2 + 2, panel.width - 16, rowHeight - 4, 8);
          context.fill();
          context.strokeStyle = 'rgba(54, 226, 255, 0.45)';
          context.lineWidth = 1;
          context.stroke();
          this.drawTypedWord(context, word.token.text, states, centerX, y, Math.min(24, panel.width / Math.max(4, word.token.text.length) * 1.5));
          const coins = wordCoins(word.token.text.length, engine.wave, engine.combo + 1);
          context.font = canvasFont(10, 'ui', 600);
          context.fillStyle = SCENE.coin;
          context.textAlign = 'right';
          context.fillText(`+${coins}🪙`, panel.left + panel.width - 14, y - rowHeight / 2 + 12);
        } else {
          context.globalAlpha = Math.max(0.15, 0.75 - index * 0.12);
          context.font = canvasFont(Math.max(12, 17 - index), 'code', 600);
          context.fillStyle = SCENE.ink;
          context.textAlign = 'center';
          context.fillText(word.token.text, centerX, y);
          context.globalAlpha = 1;
        }
      });
    } else {
      const centerY = panel.top + panel.height / 2;
      const currentWidth = panel.width * 0.46;
      context.fillStyle = 'rgba(54, 226, 255, 0.08)';
      roundedRect(context, panel.left + 8, panel.top + 6, currentWidth, panel.height - 12, 8);
      context.fill();
      if (current) this.drawTypedWord(context, current.token.text, states, panel.left + 8 + currentWidth / 2 - shift * 30, centerY, Math.min(22, currentWidth / Math.max(4, current.token.text.length) * 1.4));
      let x = panel.left + currentWidth + 22;
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      engine.stream.slice(1).forEach((word, index) => {
        context.globalAlpha = Math.max(0.2, 0.7 - index * 0.15);
        context.font = canvasFont(13, 'code', 600);
        context.fillStyle = SCENE.ink;
        context.fillText(word.token.text, x + shift * 40, centerY);
        x += context.measureText(word.token.text).width + 14;
      });
      context.globalAlpha = 1;
    }
    // 방금 친 낱말: 위로 날아가며 +코인
    const now = wallSeconds();
    this.wordFlights = this.wordFlights.filter(flight => now - flight.at < 0.9);
    for (const flight of this.wordFlights) {
      const age = (now - flight.at) / 0.9;
      const x = wide ? panel.left + panel.width / 2 : panel.left + 8 + panel.width * 0.23;
      const y = (wide ? panel.top + 58 : panel.top + panel.height / 2) - age * 40;
      context.globalAlpha = 1 - age;
      context.font = canvasFont(14, 'ui', 700);
      context.textAlign = 'center';
      context.fillStyle = SCENE.coin;
      context.fillText(`+${flight.coins}🪙`, x, y);
    }
    context.restore();
  }

  // 낱말 한 개를 글자별 상태(맞음·틀림·아직)대로 그린다
  drawTypedWord(context, text, states, centerX, centerY, fontSize) {
    context.font = canvasFont(Math.round(fontSize), 'code', 700);
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    const widths = [...text].map(character => context.measureText(character).width);
    let x = centerX - widths.reduce((sum, value) => sum + value, 0) / 2;
    [...text].forEach((character, index) => {
      const state = states[index];
      context.fillStyle = state === 'correct' ? '#4df0a6' : state === 'wrong' ? SCENE.danger : SCENE.ink;
      if (state === 'current' || (index === 0 && states.every(entry => entry === 'pending'))) {
        context.fillStyle = this.accent;
        context.fillRect(x, centerY + fontSize * 0.6, widths[index], 2);
        context.fillStyle = SCENE.ink;
      }
      context.fillText(character, x, centerY);
      x += widths[index];
    });
  }

  // 보스 체력 막대(HUD 아래 가운데): 이름 · 페이즈 표시, 절반 자리에 금
  drawBossBar(context, engine) {
    const boss = engine.bugs.find(bug => bug.state === 'alive' && ATTACK_TYPES[bug.type].boss);
    if (!boss) return;
    const field = this.field();
    const barWidth = Math.min(320, field.width * 0.7);
    const left = field.left + field.width / 2 - barWidth / 2;
    const top = HUD_HEIGHT + (engine.buildMode ? 30 : 8);
    const type = ATTACK_TYPES[boss.type];
    const color = boss.phase === 2 ? '#ff4dd2' : BUG_STYLE[boss.type].body;
    context.fillStyle = 'rgba(14, 18, 34, 0.9)';
    roundedRect(context, left - 8, top - 4, barWidth + 16, 26, 8);
    context.fill();
    context.font = canvasFont(10, 'ui', 700);
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = color;
    context.fillText(`${type.label}${boss.phase === 2 ? ` · PHASE 2 ${type.phaseTwo.label}` : ''}`, left, top + 4);
    context.fillStyle = 'rgba(255, 255, 255, 0.1)';
    context.fillRect(left, top + 12, barWidth, 6);
    context.fillStyle = color;
    context.fillRect(left, top + 12, barWidth * boss.hp / boss.maxHp, 6);
    context.fillStyle = '#ffffff';
    context.fillRect(left + barWidth * type.phaseTwo.at - 1, top + 10, 2, 10);
  }

  drawTowerShot(context, shot, engine) {
    const age = (engine.gameTime - shot.at) / 0.3;
    if (age > 1) return;
    // 방화벽 = 넘실대는 불덩이가 날아감, 백신 = 하늘색 레이저 + 맞은 곳 불꽃
    const from = this.toScreen({ x: shot.fromX, y: shot.fromY });
    const to = this.bugPosition(shot);
    context.save();
    context.globalCompositeOperation = 'lighter';
    if (shot.type === 'interceptor') {
      // 미사일: 위로 솟았다 내리꽂는 곡선 + 연기 꼬리, 닿으면 폭발(drawExplosions가 0.55초 그린다)
      const unit = this.unit();
      const travel = Math.min(1, age / 0.6);
      const lift = 40 * unit;
      const curve = progress => ({
        x: from.x + (to.x - from.x) * progress + (shot.barrel ? 8 : -8) * unit * Math.sin(progress * Math.PI),
        y: from.y - 12 * unit + (to.y - from.y + 12 * unit) * progress - lift * Math.sin(progress * Math.PI)
      });
      const head = curve(travel);
      const tail = curve(Math.max(0, travel - 0.08));
      context.globalCompositeOperation = 'source-over';
      for (let puff = 1; puff <= 5; puff++) {
        const point = curve(Math.max(0, travel - puff * 0.07));
        context.fillStyle = `rgba(200, 210, 230, ${0.35 - puff * 0.06})`;
        context.beginPath();
        context.arc(point.x, point.y, (2 + puff) * unit, 0, Math.PI * 2);
        context.fill();
      }
      if (travel < 1) {
        const heading = Math.atan2(head.y - tail.y, head.x - tail.x);
        context.save();
        context.translate(head.x, head.y);
        context.rotate(heading);
        context.scale(unit, unit);
        context.fillStyle = '#f2ffe0';
        roundedRect(context, -7, -2, 10, 4, 2);
        context.fill();
        context.fillStyle = '#ff5d73';
        context.beginPath();
        context.moveTo(3, -2);
        context.lineTo(7, 0);
        context.lineTo(3, 2);
        context.fill();
        context.globalCompositeOperation = 'lighter';
        context.fillStyle = 'rgba(255, 200, 90, 0.9)';
        context.beginPath();
        context.moveTo(-7, -1.6);
        context.lineTo(-13 - Math.random() * 4, 0);
        context.lineTo(-7, 1.6);
        context.fill();
        context.restore();
      } else if (!shot.exploded) {
        shot.exploded = true;
        this.spawnExplosion(to.x, to.y, shot.level ?? 1);
      }
    } else if (shot.type === 'emp') {
      // EMP 포탄: 보라 전기 구체가 높은 포물선으로 날아간다(0.15초)
      const unit = this.unit();
      const travel = Math.min(1, age / 0.5);
      if (travel < 1) {
        const px = from.x + (to.x - from.x) * travel;
        const py = from.y - 20 * unit + (to.y - from.y + 20 * unit) * travel - 50 * unit * Math.sin(travel * Math.PI);
        const orb = context.createRadialGradient(px, py, 0, px, py, 9 * unit);
        orb.addColorStop(0, '#ffffff');
        orb.addColorStop(0.4, 'rgba(179, 140, 255, 0.95)');
        orb.addColorStop(1, 'rgba(120, 80, 255, 0)');
        context.fillStyle = orb;
        context.beginPath();
        context.arc(px, py, 9 * unit, 0, Math.PI * 2);
        context.fill();
      }
    } else if (shot.type === 'honeypot') {
      // 꿀 덩어리: 포물선으로 날아가 길에 철퍽
      const unit = this.unit();
      const travel = Math.min(1, age / 0.95);
      const px = from.x + (to.x - from.x) * travel;
      const py = from.y - 16 * unit + (to.y - from.y + 16 * unit) * travel - 46 * unit * Math.sin(travel * Math.PI);
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = HONEY.body;
      context.beginPath();
      context.ellipse(px, py, 6 * unit, 5 * unit * (1 + 0.2 * Math.sin(age * 40)), 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = HONEY.light;
      context.beginPath();
      context.arc(px - 2 * unit, py - 2 * unit, 1.8 * unit, 0, Math.PI * 2);
      context.fill();
      if (travel >= 1 && !shot.splashed) {
        shot.splashed = true;
        this.particles.burst(to.x, to.y, { color: HONEY.body, count: 12, speed: 130, life: 0.4, gravity: 400, size: 2.5 });
      }
    } else if (shot.type === 'firewall') {
      const travel = Math.min(1, age * 2.2);
      const px = from.x + (to.x - from.x) * travel, py = from.y - 18 + (to.y - from.y + 18) * travel;
      const glow = context.createRadialGradient(px, py, 0, px, py, 12);
      glow.addColorStop(0, 'rgba(255, 240, 180, 1)');
      glow.addColorStop(0.4, 'rgba(255, 140, 60, 0.9)');
      glow.addColorStop(1, 'rgba(255, 80, 40, 0)');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(px, py, 12, 0, Math.PI * 2);
      context.fill();
    } else {
      context.globalAlpha = 1 - age;
      context.strokeStyle = '#9af3ff';
      context.lineWidth = 4 - age * 3;
      context.shadowColor = TOWER_STYLE.antivirus;
      context.shadowBlur = 14;
      context.beginPath();
      context.moveTo(from.x, from.y - 8);
      context.lineTo(to.x, to.y);
      context.stroke();
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(to.x, to.y, 6 * (1 - age), 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  // EMP 폭발(스플래시 반경 그대로): 하얀 섬광 → 보라 충격파 고리 둘이 반경까지 퍼지고, 안쪽에 번개 줄기가 튄다. 반경 바닥에 원형 표시
  drawEmpBlasts(context) {
    if (!this.empBlasts.length) return;
    const now = wallSeconds();
    this.empBlasts = this.empBlasts.filter(blast => now - blast.at < 0.6);
    context.save();
    for (const blast of this.empBlasts) {
      const age = now - blast.at;
      if (age < 0) continue;
      const progress = age / 0.6;
      const radiusY = blast.radiusY;
      const radiusX = radiusY * 1.25;
      if (!blast.burst) {
        blast.burst = true;
        this.particles.burst(blast.x, blast.y, { color: '#b38cff', count: 14 + blast.level * 4, speed: 220, life: 0.4, size: 2 });
        this.particles.burst(blast.x, blast.y, { color: '#ffffff', count: 6, speed: 300, life: 0.25, size: 1.5 });
        this.juice.shake(0.08 + blast.level * 0.03);
      }
      // 바닥 범위 원
      context.globalCompositeOperation = 'lighter';
      context.fillStyle = `rgba(179, 140, 255, ${0.22 * (1 - progress)})`;
      context.beginPath();
      context.ellipse(blast.x, blast.y, radiusX, radiusY * 0.62, 0, 0, Math.PI * 2);
      context.fill();
      // 충격파 고리 둘
      for (const delay of [0, 0.12]) {
        const ringProgress = Math.min(1, Math.max(0, (age - delay) / 0.3));
        if (ringProgress <= 0) continue;
        context.strokeStyle = `rgba(210, 190, 255, ${0.9 * (1 - ringProgress)})`;
        context.lineWidth = 3 * (1 - ringProgress) + 1;
        context.beginPath();
        context.ellipse(blast.x, blast.y, radiusX * ringProgress, radiusY * 0.62 * ringProgress, 0, 0, Math.PI * 2);
        context.stroke();
      }
      // 섬광
      if (age < 0.12) {
        const flash = context.createRadialGradient(blast.x, blast.y, 0, blast.x, blast.y, radiusY * 0.6);
        flash.addColorStop(0, `rgba(255, 255, 255, ${1 - age / 0.12})`);
        flash.addColorStop(1, 'rgba(179, 140, 255, 0)');
        context.fillStyle = flash;
        context.beginPath();
        context.arc(blast.x, blast.y, radiusY * 0.6, 0, Math.PI * 2);
        context.fill();
      }
      // 번개 줄기(지그재그, 매 프레임 조금씩 달라짐)
      if (progress < 0.6) {
        context.strokeStyle = `rgba(230, 220, 255, ${0.9 * (1 - progress / 0.6)})`;
        context.lineWidth = 1.5;
        const bolts = 5 + blast.level;
        for (let bolt = 0; bolt < bolts; bolt++) {
          const angle = blast.seed + bolt / bolts * Math.PI * 2;
          context.beginPath();
          context.moveTo(blast.x, blast.y);
          for (let step = 1; step <= 4; step++) {
            const reach = step / 4;
            const jitter = (Math.sin(now * 60 + bolt * 7 + step * 3) * 0.35);
            context.lineTo(blast.x + Math.cos(angle + jitter) * radiusX * reach, blast.y + Math.sin(angle + jitter) * radiusY * 0.62 * reach);
          }
          context.stroke();
        }
      }
    }
    context.restore();
  }

  // EMP포(레벨별 테슬라 코일): Lv.1 코일 기둥 + 고리 하나 · Lv.2 고리 셋 + 양옆 축전기(충전 눈금)
  // Lv.3 꼭대기 위에 떠 있는 플라스마 구체 + 구체와 고리 사이를 잇는 번개. 쏠 때 고리가 하얗게 달아오른다
  drawEmp(context, tower, engine, fired) {
    const color = TOWER_STYLE.emp;
    const level = tower.level ?? 1;
    const time = wallSeconds();
    const charge = engine.gameTime >= (tower.readyAt ?? 0) ? 1 : 0.5 + 0.5 * Math.sin(time * 6);
    // 코일 기둥
    const pillar = context.createLinearGradient(-5, 0, 5, 0);
    pillar.addColorStop(0, '#3a2a6a');
    pillar.addColorStop(0.5, '#8a6ad8');
    pillar.addColorStop(1, '#3a2a6a');
    context.fillStyle = pillar;
    roundedRect(context, -5, -26, 10, 30, 3);
    context.fill();
    // 구리 감은 줄
    context.strokeStyle = 'rgba(255, 180, 120, 0.7)';
    context.lineWidth = 1;
    for (let wrap = -24; wrap < 2; wrap += 3) {
      context.beginPath();
      context.moveTo(-5, wrap);
      context.lineTo(5, wrap + 1.5);
      context.stroke();
    }
    // 축전기(Lv.2+)
    if (level >= 2) {
      for (const side of [-1, 1]) {
        context.fillStyle = '#251a46';
        roundedRect(context, side * 13 - 4, -12, 8, 16, 2);
        context.fill();
        context.strokeStyle = level >= 3 ? '#ffd166' : 'rgba(255, 255, 255, 0.3)';
        context.lineWidth = 1;
        context.stroke();
        context.fillStyle = color;
        const fill = 12 * charge;
        context.fillRect(side * 13 - 2, 2 - fill, 4, fill);
      }
    }
    // 고리(위로 갈수록 작게). 쏠 때 하얗게
    const rings = level >= 2 ? 3 : 1;
    for (let ring = 0; ring < rings; ring++) {
      const ringY = -24 + ring * 7;
      const radius = 11 - ring * 1.5 + (rings === 1 ? 2 : 0);
      context.strokeStyle = fired > 0 ? `rgba(255, 255, 255, ${0.6 + fired * 0.4})` : color;
      context.shadowColor = color;
      context.shadowBlur = 6 + fired * 12 + charge * 4;
      context.lineWidth = 2.5;
      context.beginPath();
      context.ellipse(0, ringY, radius, radius * 0.35, 0, 0, Math.PI * 2);
      context.stroke();
    }
    context.shadowBlur = 0;
    // 꼭대기 구슬 / Lv.3 떠 있는 플라스마 구체
    const orbY = level >= 3 ? -38 + Math.sin(time * 2.5) * 2 : -29;
    const orbRadius = level >= 3 ? 6 : 4;
    const orb = context.createRadialGradient(0, orbY, 0, 0, orbY, orbRadius * 2);
    orb.addColorStop(0, '#ffffff');
    orb.addColorStop(0.45, color);
    orb.addColorStop(1, 'rgba(179, 140, 255, 0)');
    context.globalCompositeOperation = 'lighter';
    context.fillStyle = orb;
    context.beginPath();
    context.arc(0, orbY, orbRadius * 2, 0, Math.PI * 2);
    context.fill();
    // 작은 번개(구체 둘레 / Lv.3은 구체 ↔ 고리)
    const sparks = level >= 3 ? 3 : 1;
    context.strokeStyle = 'rgba(230, 220, 255, 0.85)';
    context.lineWidth = 1;
    for (let spark = 0; spark < sparks; spark++) {
      if (Math.sin(time * 17 + spark * 2.3) < 0.2) continue;
      const angle = time * 5 + spark * 2.1;
      const endX = Math.cos(angle) * (level >= 3 ? 10 : 8);
      const endY = level >= 3 ? -24 : orbY + Math.sin(angle) * 6;
      context.beginPath();
      context.moveTo(0, orbY);
      context.lineTo((endX) * 0.5 + Math.sin(time * 40 + spark) * 3, (orbY + endY) / 2);
      context.lineTo(endX, endY);
      context.stroke();
    }
    context.globalCompositeOperation = 'source-over';
  }

  // 미사일 폭발 예약(화면 좌표). 레벨이 높을수록 크다
  spawnExplosion(x, y, level) {
    const unit = this.unit();
    this.explosions.push({ x, y, at: wallSeconds(), size: (16 + level * 4) * unit });
    if (this.explosions.length > 24) this.explosions.shift();
    this.particles.burst(x, y, { color: '#ffb547', count: 10 + level * 3, speed: 180, life: 0.45 });
    this.particles.burst(x, y, { color: '#ffffff', count: 5, speed: 260, life: 0.25, size: 2 });
    this.juice.shake(0.06 * level);
  }

  // 폭발: 흰 섬광 → 노랑·주황 불덩이가 커지며 흐려짐 + 충격파 고리 + 남는 회색 연기 셋
  drawExplosions(context) {
    if (!this.explosions.length) return;
    const now = wallSeconds();
    this.explosions = this.explosions.filter(entry => now - entry.at < 0.55);
    context.save();
    for (const blast of this.explosions) {
      const progress = (now - blast.at) / 0.55;
      const radius = blast.size * (0.4 + easeOutBack(Math.min(1, progress * 2.2)) * 0.8);
      context.globalCompositeOperation = 'source-over';
      for (let puff = 0; puff < 3; puff++) {
        const angle = puff * 2.1 + blast.at;
        context.fillStyle = `rgba(90, 96, 120, ${0.35 * (1 - progress)})`;
        context.beginPath();
        context.arc(blast.x + Math.cos(angle) * radius * 0.6, blast.y + Math.sin(angle) * radius * 0.4 - progress * 14, radius * (0.5 + progress * 0.5), 0, Math.PI * 2);
        context.fill();
      }
      context.globalCompositeOperation = 'lighter';
      const fire = context.createRadialGradient(blast.x, blast.y, 0, blast.x, blast.y, radius);
      fire.addColorStop(0, `rgba(255, 255, 255, ${Math.max(0, 1 - progress * 2.5)})`);
      fire.addColorStop(0.3, `rgba(255, 220, 110, ${0.9 * (1 - progress)})`);
      fire.addColorStop(0.7, `rgba(255, 110, 40, ${0.6 * (1 - progress)})`);
      fire.addColorStop(1, 'rgba(255, 60, 30, 0)');
      context.fillStyle = fire;
      context.beginPath();
      context.arc(blast.x, blast.y, radius, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = `rgba(255, 230, 170, ${0.8 * (1 - progress)})`;
      context.lineWidth = 2.5 * (1 - progress) + 0.5;
      context.beginPath();
      context.arc(blast.x, blast.y, blast.size * (0.6 + progress * 1.6), 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  // 끈끈이 웅덩이(길 위): 떨어지면 철퍽 퍼지고, 가장자리가 출렁이며, 기포가 올라왔다 터진다. 마르기 직전 흐려진다
  drawPuddles(context, engine) {
    const puddles = engine.puddles ?? [];
    if (!puddles.length) return;
    const time = engine.gameTime;
    const field = this.field();
    context.save();
    for (const puddle of puddles) {
      if (time < puddle.activeAt) continue;
      const center = this.toScreen(puddle);
      const age = time - puddle.activeAt;
      const left = puddle.until - time;
      const spread = Math.min(1, easeOutBack(Math.min(1, age / 0.3)));
      const radiusY = puddle.radius * field.height * spread;
      const radiusX = radiusY * 1.25;
      context.globalAlpha = Math.min(1, left / 0.8) * 0.9;
      const goo = context.createRadialGradient(center.x - radiusX * 0.3, center.y - radiusY * 0.3, 1, center.x, center.y, radiusX);
      goo.addColorStop(0, HONEY.light);
      goo.addColorStop(0.55, HONEY.body);
      goo.addColorStop(1, 'rgba(168, 102, 12, 0.85)');
      context.fillStyle = goo;
      context.beginPath();
      const lobes = 10;
      for (let index = 0; index <= lobes; index++) {
        const angle = index / lobes * Math.PI * 2;
        const wobble = 1 + 0.08 * Math.sin(time * 3 + index * 1.9 + puddle.id);
        const px = center.x + Math.cos(angle) * radiusX * wobble, py = center.y + Math.sin(angle) * radiusY * 0.62 * wobble;
        if (index) context.lineTo(px, py);
        else context.moveTo(px, py);
      }
      context.closePath();
      context.fill();
      // 윤기
      context.fillStyle = 'rgba(255, 250, 220, 0.6)';
      context.beginPath();
      context.ellipse(center.x - radiusX * 0.35, center.y - radiusY * 0.2, radiusX * 0.22, radiusY * 0.09, -0.2, 0, Math.PI * 2);
      context.fill();
      // 기포
      for (let bubble = 0; bubble < 3 + (puddle.level ?? 1); bubble++) {
        const cycle = (time * 0.8 + bubble * 0.37 + puddle.id * 0.11) % 1;
        const bx = center.x + Math.cos(bubble * 2.4 + puddle.id) * radiusX * 0.55;
        const by = center.y + Math.sin(bubble * 2.4 + puddle.id) * radiusY * 0.3;
        context.strokeStyle = `rgba(255, 245, 200, ${0.8 * (1 - cycle)})`;
        context.lineWidth = 1;
        context.beginPath();
        context.arc(bx, by, 1 + cycle * 3.5, 0, Math.PI * 2);
        context.stroke();
      }
    }
    context.restore();
  }

  // 허니팟(레벨별):
  // Lv.1 흙 단지에 꿀이 넘쳐 흐르고 국자가 꽂혀 있음 · Lv.2 육각 벌집 탑(칸마다 꿀빛) + 투석 팔
  // Lv.3 황금 벌집 + 유리 돔 속에서 꿀이 소용돌이 + 둘레를 도는 작은 벌 둘. 던질 때 국자·팔이 휙 젖혀진다
  drawHoneypot(context, tower, engine, fired) {
    const level = tower.level ?? 1;
    const time = wallSeconds();
    if (level === 1) {
      const pot = context.createLinearGradient(0, -20, 0, 6);
      pot.addColorStop(0, '#c07a3a');
      pot.addColorStop(1, '#6a3a16');
      context.fillStyle = pot;
      context.beginPath();
      context.moveTo(-9, -16);
      context.quadraticCurveTo(-17, -6, -12, 4);
      context.lineTo(12, 4);
      context.quadraticCurveTo(17, -6, 9, -16);
      context.closePath();
      context.fill();
      context.fillStyle = '#8a4e20';
      context.fillRect(-10, -19, 20, 4);
    } else {
      // 육각 벌집 탑
      const cell = (cx, cy, radius, fill, stroke) => {
        context.beginPath();
        for (let corner = 0; corner < 6; corner++) {
          const angle = corner * Math.PI / 3;
          const px = cx + Math.cos(angle) * radius, py = cy + Math.sin(angle) * radius;
          if (corner) context.lineTo(px, py);
          else context.moveTo(px, py);
        }
        context.closePath();
        context.fillStyle = fill;
        context.fill();
        context.strokeStyle = stroke;
        context.lineWidth = 1.2;
        context.stroke();
      };
      const frame = level >= 3 ? '#ffd166' : '#7a4a14';
      const cells = [[0, -4], [-8, -9], [8, -9], [-8, 1], [8, 1], [0, -14]];
      cells.forEach(([cx, cy], index) => {
        const glow = 0.55 + 0.45 * Math.sin(time * 3 + index);
        cell(cx, cy, 5.2, `rgba(245, ${Math.round(160 + glow * 50)}, 46, ${0.75 + glow * 0.25})`, frame);
      });
      if (level >= 3) {
        // 유리 돔 + 소용돌이 꿀
        context.fillStyle = HONEY.glass;
        context.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        context.lineWidth = 1;
        context.beginPath();
        context.arc(0, -22, 8, Math.PI, 0);
        context.closePath();
        context.fill();
        context.stroke();
        context.strokeStyle = HONEY.body;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(0, -24, 4, time * 4, time * 4 + Math.PI * 1.3);
        context.stroke();
      }
    }
    // 넘쳐 흐르는 꿀(위 테두리 + 방울)
    const rim = level === 1 ? -17 : level >= 3 ? -16 : -19;
    context.fillStyle = HONEY.body;
    context.beginPath();
    context.ellipse(0, rim, level === 1 ? 10 : 8, 3, 0, 0, Math.PI * 2);
    context.fill();
    const drip = (time * 0.7 + (tower.id ?? 0) * 0.3) % 1;
    context.beginPath();
    context.moveTo(level === 1 ? -9 : -6, rim);
    context.quadraticCurveTo(level === 1 ? -11 : -8, rim + 4 + drip * 10, level === 1 ? -9 : -6, rim + 6 + drip * 12);
    context.lineTo(level === 1 ? -7 : -4, rim + 1);
    context.fill();
    context.beginPath();
    context.arc(level === 1 ? -9 : -6, rim + 7 + drip * 12, 1.8, 0, Math.PI * 2);
    context.fill();
    // 국자 / 투석 팔(던질 때 젖혀짐)
    const swing = -0.6 + fired * 1.8;
    context.save();
    context.translate(level === 1 ? 5 : 10, rim);
    context.rotate(swing);
    context.strokeStyle = level >= 3 ? '#ffd166' : level >= 2 ? '#9aa3c7' : '#d9b27a';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(0, -14 - level * 2);
    context.stroke();
    context.fillStyle = HONEY.body;
    context.beginPath();
    context.arc(0, -15 - level * 2, 3 + level * 0.6, 0, Math.PI * 2);
    context.fill();
    context.restore();
    if (level >= 3) {
      // 벌 둘
      for (let bee = 0; bee < 2; bee++) {
        const angle = time * 3.2 + bee * Math.PI;
        const bx = Math.cos(angle) * 20, by = -16 + Math.sin(angle) * 7;
        context.fillStyle = '#ffd166';
        context.beginPath();
        context.ellipse(bx, by, 3, 2.2, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#2a1a06';
        context.fillRect(bx - 0.6, by - 2.2, 1.2, 4.4);
        context.fillStyle = 'rgba(255, 255, 255, 0.7)';
        context.beginPath();
        context.ellipse(bx, by - 2.5, 1.8, 1.2 * Math.abs(Math.sin(time * 40 + bee)), 0, 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  // 강화 카드: 고른 타워 위(자리가 없으면 아래)에 이름·레벨, 다음 레벨 능력(또는 Lv.3 특수 능력), [강화] [판매] 버튼.
  // 버튼 사각형은 cardButtons에 저장해 누르기 판정에 쓴다
  drawUpgradeCard(context, engine) {
    this.cardButtons = [];
    this.cardRect = null;
    const tower = engine.towers.find(entry => entry.id === this.selectedTowerId);
    if (!tower) {
      this.selectedTowerId = null;
      return;
    }
    const info = engine.upgradeInfo(tower);
    const { x, y } = this.towerPosition(tower);
    const field = this.field();
    const unit = this.unit();
    const width = 200, height = 78;
    const left = Math.max(field.left, Math.min(field.left + field.width - width, x - width / 2));
    let top = y - 52 * unit - height;
    if (top < HUD_HEIGHT + 6) top = y + 30 * unit;
    const color = TOWER_STYLE[tower.type];
    context.save();
    context.fillStyle = 'rgba(12, 16, 32, 0.95)';
    roundedRect(context, left, top, width, height, 10);
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.stroke();
    this.cardRect = { x: left, y: top, width, height };
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.font = canvasFont(13, 'ui', 700);
    context.fillStyle = color;
    context.fillText(`${TOWER_TYPES[tower.type].label}`, left + 10, top + 14);
    context.fillStyle = '#ffd166';
    context.fillText('★'.repeat(info.level) + '☆'.repeat(DEFENSE_RULES.maxTowerLevel - info.level), left + 60, top + 14);
    context.font = canvasFont(10, 'ui', 600);
    context.fillStyle = SCENE.fog;
    const percent = (next, current) => Math.round((next / current - 1) * 100);
    const detail = info.maxed
      ? `MAX · ${TOWER_MAX_PERKS[tower.type]?.label ?? ''}`
      : info.perk
        ? `Lv.3 → ${info.perk.label} · 사거리 +${percent(info.next.range, info.current.range)}%`
        : `Lv.${info.level + 1} → 사거리 +${percent(info.next.range, info.current.range)}% · 연사 +${percent(info.current.cooldown, info.next.cooldown)}%`;
    context.fillText(detail, left + 10, top + 32);
    const buttonTop = top + 44, buttonHeight = 26;
    const upgrade = { x: left + 8, y: buttonTop, width: 116, height: buttonHeight };
    const sell = { x: left + 130, y: buttonTop, width: 62, height: buttonHeight };
    context.globalAlpha = info.maxed ? 0.35 : info.affordable ? 1 : 0.5;
    context.fillStyle = info.maxed ? '#2a3152' : '#ffd166';
    roundedRect(context, upgrade.x, upgrade.y, upgrade.width, upgrade.height, 7);
    context.fill();
    context.fillStyle = '#1a1406';
    context.font = canvasFont(12, 'ui', 700);
    context.textAlign = 'center';
    context.fillText(info.maxed ? 'MAX' : `▲ 강화 ${info.price}🪙`, upgrade.x + upgrade.width / 2, upgrade.y + upgrade.height / 2 + 0.5);
    context.globalAlpha = 1;
    context.fillStyle = 'rgba(255, 255, 255, 0.08)';
    roundedRect(context, sell.x, sell.y, sell.width, sell.height, 7);
    context.fill();
    context.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = SCENE.ink;
    context.font = canvasFont(10, 'ui', 600);
    context.fillText(`판매 +${engine.sellValue(tower)}`, sell.x + sell.width / 2, sell.y + sell.height / 2 + 0.5);
    context.restore();
    this.cardButtons = [{ action: 'upgrade', rect: upgrade }, { action: 'sell', rect: sell }];
  }

  // 상점 줄: 누를 수 있는 칸 4개 [숫자 키] 아이콘 이름 가격. 코인이 모자라면 흐리게, 고른 타워는 테두리
  drawShop(context, width, height, engine) {
    const top = height - SHOP_HEIGHT;
    context.fillStyle = 'rgba(9, 12, 24, 0.96)';
    context.fillRect(0, top, width, SHOP_HEIGHT);
    context.fillStyle = 'rgba(42, 49, 82, 0.9)';
    context.fillRect(0, top, width, 1);
    const narrow = width < 520;
    const prices = engine.snapshotExtras().prices;
    for (const { entry, left, width: cellWidth } of this.shopCells(engine)) {
      const item = SHOP_ITEMS[entry.item];
      const price = prices[entry.item];
      const affordable = Number.isFinite(price) && engine.coins >= price;
      const selected = item.kind === 'tower' && engine.buildMode?.tower === item.tower;
      const color = TOWER_STYLE[item.tower] ?? '#4df0a6';
      context.globalAlpha = affordable || selected ? 1 : 0.45;
      context.fillStyle = selected ? `${color}22` : 'rgba(255, 255, 255, 0.03)';
      roundedRect(context, left + 4, top + 5, cellWidth - 8, SHOP_HEIGHT - 10, 8);
      context.fill();
      context.strokeStyle = selected ? color : 'rgba(255, 255, 255, 0.08)';
      context.lineWidth = selected ? 2 : 1;
      context.stroke();
      const middle = top + SHOP_HEIGHT / 2;
      context.textBaseline = 'middle';
      context.textAlign = 'left';
      context.font = canvasFont(10, 'code', 700);
      context.fillStyle = SCENE.fog;
      context.fillText(entry.hotkey, left + 10, middle - (narrow ? 8 : 0));
      context.font = canvasFont(narrow ? 14 : 16, 'ui', 500);
      context.fillText(SHOP_ICONS[entry.item], left + (narrow ? 8 : 22), middle + (narrow ? 7 : 0));
      context.font = canvasFont(narrow ? 11 : 12, 'ui', 700);
      context.fillStyle = color;
      const textLeft = left + (narrow ? 28 : 46);
      context.fillText(SHOP_LABELS[entry.item], textLeft, middle - 7);
      context.font = canvasFont(10, 'ui', 600);
      context.fillStyle = affordable ? SCENE.coin : SCENE.fog;
      context.fillText(Number.isFinite(price) ? `${price}🪙` : '—', textLeft, middle + 8);
      context.globalAlpha = 1;
    }
  }

  // 위: 웨이브 · BPM · 코인 · 컴퓨터 체력
  drawHud(context, width, engine) {
    const gradient = context.createLinearGradient(0, 0, 0, HUD_HEIGHT);
    gradient.addColorStop(0, 'rgba(14, 18, 34, 0.96)');
    gradient.addColorStop(1, 'rgba(9, 12, 24, 0.92)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, HUD_HEIGHT);
    context.fillStyle = 'rgba(42, 49, 82, 0.9)';
    context.fillRect(0, HUD_HEIGHT - 1, width, 1);
    const middle = HUD_HEIGHT / 2 + 1;
    context.font = canvasFont(12, 'ui', 600);
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = SCENE.ink;
    context.fillText(`WAVE ${engine.wave}/${DEFENSE_RULES.waves}`, 12, middle);
    context.fillStyle = SCENE.fog;
    context.fillText(`♩ ${engine.bpm()}`, 104, middle);
    context.fillStyle = SCENE.coin;
    context.fillText(`🪙 ${engine.coins}`, 160, middle);
    const barWidth = Math.min(160, width * 0.28);
    const left = width - barWidth - 12;
    const ratio = Math.max(0, this.displayHealth / engine.maxHealth);
    context.fillStyle = 'rgba(255, 255, 255, 0.08)';
    roundedRect(context, left, middle - 5, barWidth, 10, 5);
    context.fill();
    context.fillStyle = engine.isDanger() ? SCENE.danger : SCENE.shield;
    roundedRect(context, left, middle - 5, Math.max(6, barWidth * ratio), 10, 5);
    context.fill();
    context.textAlign = 'right';
    context.fillStyle = SCENE.fog;
    context.fillText(`🛡 ${Math.ceil(engine.health)}`, left - 8, middle);
  }

  drawBanner(context, width) {
    if (!this.banner) return;
    const age = wallSeconds() - this.banner.at;
    if (age > 2) {
      this.banner = null;
      return;
    }
    const scale = easeOutBack(Math.min(1, age / 0.3));
    context.save();
    context.globalAlpha = age > 1.6 ? 1 - (age - 1.6) / 0.4 : 1;
    context.translate(width / 2, this.surface.height * 0.36);
    context.scale(scale, scale);
    context.font = canvasFont(24);
    const panelWidth = Math.max(260, context.measureText(this.banner.text).width + 64);
    context.fillStyle = 'rgba(14, 18, 34, 0.94)';
    roundedRect(context, -panelWidth / 2, -36, panelWidth, 72, 14);
    context.fill();
    context.fillStyle = this.banner.color;
    roundedRect(context, -panelWidth / 2 + 20, -36, panelWidth - 40, 3, 1.5);
    context.fill();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(this.banner.text, 0, -6);
    context.font = canvasFont(12, 'ui', 500);
    context.fillStyle = SCENE.fog;
    context.fillText(this.banner.sub, 0, 20);
    context.restore();
  }
}
