// 컴퓨터 디펜스 화면. 들판: 지그재그 길을 따라 해킹 공격이 아래 가운데 컴퓨터(방패 돔)로 온다 /
// 길 사이 설치 자리 6곳(설치 모드면 자리 낱말이 뜬다) / 맨 아래: 상점 낱말(firewall · antivirus · patch)과 가격.
// 배경 그림(public/art/defense-stage.webp)이 있으면 그림 속 돔이 길 끝에 오도록 깔고, 없으면 격자·코드 비·컴퓨터를 직접 그린다.
import { ARCADE_RULES } from './target-game.js';
import { DEFENSE_RULES, TOWER_TYPES, SHOP_ITEMS, DEFENSE_PATH, DEFENSE_COMPUTER, pointOnPath } from './defense-engine.js';
import { setupCanvas, roundedRect, drawTokenLabel, ParticleSystem, easeOutBack, Spring, VisualStates, canvasFont, seededRandom, loadArt, isArtReady, Juice } from './game-view.js';

const HUD_HEIGHT = 34;
const SHOP_HEIGHT = 40;
const STAGE_ART = loadArt('/art/defense-stage.webp');
// 그림 속 방패 돔(컴퓨터) 중심과 반지름(그림 크기 비율)
const ART_DOME = Object.freeze({ x: 0.502, y: 0.846, radius: 0.117 });
const wallSeconds = () => performance.now() / 1000;
const SCENE = Object.freeze({
  bgTop: '#060916', bgBottom: '#0b1030', grid: 'rgba(54, 226, 255, 0.07)', rain: '#2fd27a', shield: '#36e2ff',
  ink: '#e9edf8', fog: '#8a93b8', coin: '#ffd166', danger: '#ff4d6d', amber: '#ffb547'
});
// 공격 모양: 패킷 = 빨간 마름모, 스팸 = 성난 봉투, 악성 파일 = 성난 문서, 랜섬웨어 = 큰 자물쇠 괴물
const BUG_STYLE = Object.freeze({
  packet: { body: '#ff5d73', dark: '#7a1530', size: 12 },
  spam: { body: '#ffd166', dark: '#8a6414', size: 13 },
  malware: { body: '#c792ea', dark: '#5a2f8a', size: 15 },
  ransomware: { body: '#ff4d6d', dark: '#6a0f24', size: 28 }
});
const TOWER_STYLE = Object.freeze({ firewall: '#ff7a45', antivirus: '#36e2ff' });
const SHOP_LABELS = Object.freeze({ firewall: '방화벽', antivirus: '백신', patch: '수리' });

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
  }

  get context() {
    return this.surface.context;
  }

  // ---------- 좌표 ----------
  // 들판(0~1 정사각형 좌표)을 화면에 놓는 사각형: HUD 아래 ~ 상점 줄 위, 좌우 여백
  field() {
    const { width, height } = this.surface;
    const top = HUD_HEIGHT + 26;
    const bottom = height - SHOP_HEIGHT - 10;
    const side = Math.max(30, width * 0.06);
    return { left: side, top, width: width - side * 2, height: bottom - top };
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
    if (type === 'wave-intro' || (type === 'start' && engine)) {
      const wave = payload.wave ?? 1;
      this.banner = { text: wave === DEFENSE_RULES.waves ? `FINAL WAVE ${wave}` : `WAVE ${wave}`, sub: `BPM ${payload.bpm ?? engine?.bpm?.() ?? ''} · 해킹을 막으세요`, at: now, color: wave === DEFENSE_RULES.waves ? SCENE.danger : SCENE.shield };
    } else if (type === 'wave-clear') {
      this.banner = { text: `WAVE ${payload.wave} CLEAR`, sub: `+${payload.bonus} 코인${payload.perfect ? ' · 무피해 보너스' : ''}`, at: now, color: '#4df0a6' };
    } else if (type === 'goal') {
      this.banner = { text: 'SYSTEM SECURE', sub: '모든 공격을 막았습니다!', at: now, color: '#4df0a6' };
    } else if (type === 'boss-appear') {
      this.banner = { text: 'RANSOMWARE!', sub: '여러 번 맞혀야 하는 랜섬웨어가 옵니다', at: now, color: SCENE.danger };
    }
    if (!this.context) return;
    const juice = this.juice;
    if (type === 'bug-kill') {
      const { x, y } = this.bugPosition(payload.bug);
      const style = BUG_STYLE[payload.bug.type];
      this.particles.burst(x, y, { color: style.body, count: payload.bug.type === 'ransomware' ? 60 : 18, speed: 200, life: 0.6 });
      juice.ring(x, y, { color: style.body, radius: style.size * 3, width: 3 });
      if (payload.bug.type === 'ransomware') {
        juice.shake(0.6);
        juice.flash('#ffffff', 0.4, 0.4);
      }
    } else if (type === 'bug-hit') {
      const { x, y } = this.bugPosition(payload.bug);
      this.particles.burst(x, y, { color: '#ffffff', count: 8, speed: 140, life: 0.35 });
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
    } else if (type === 'tower-built' || type === 'tower-upgraded') {
      const { x, y } = this.towerPosition(payload.tower);
      juice.ring(x, y, { color: TOWER_STYLE[payload.tower.type], radius: 60, width: 4 });
      juice.popup(x, y - 30, type === 'tower-built' ? '설치!' : `Lv.${payload.tower.level}`, { color: TOWER_STYLE[payload.tower.type], size: 16 });
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
    for (const tower of engine.towers) this.drawTowerRange(context, tower, engine);
    for (const tower of engine.towers) this.drawTower(context, tower, engine);
    this.drawBuildPreview(context, engine);
    this.drawSpotLabels(context, engine);
    for (const shot of engine.towerShots) this.drawTowerShot(context, shot, engine);
    for (const bug of engine.bugs) this.drawBug(context, bug, engine);
    for (const projectile of engine.projectiles) this.drawPatch(context, projectile, engine);
    this.drawBugLabels(context, engine);
    this.particles.draw(context);
    this.juice.endShake(context);
    this.juice.drawOverlay(context, width, height);
    this.drawShop(context, width, height, engine);
    this.drawHud(context, width, engine);
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
      ? `${label} ${mode.upgrade ? '업그레이드' : '설치'}: 빈 곳 탭 또는 자리 낱말 · ${Math.ceil(left)}s`
      : `${label} ${mode.upgrade ? '업그레이드할' : '설치할'} 곳을 누르거나 자리 낱말을 치세요 · ${TOWER_TYPES[mode.tower].word} 다시 치면 취소 · ${Math.ceil(left)}s`;
    context.font = canvasFont(12, 'ui', 600);
    const textWidth = context.measureText(text).width + 24;
    context.fillStyle = 'rgba(14, 18, 34, 0.92)';
    roundedRect(context, width / 2 - textWidth / 2, HUD_HEIGHT + 4, textWidth, 20, 10);
    context.fill();
    context.strokeStyle = TOWER_STYLE[mode.tower];
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = TOWER_STYLE[mode.tower];
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, HUD_HEIGHT + 14);
  }

  // 설치 모드: 고를 수 있는 자리 위에 낱말
  drawSpotLabels(context, engine) {
    const narrow = this.surface.width < 520;
    for (const spot of engine.spots) {
      if (!spot.token) continue;
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
      context.save();
      context.translate(x, y - 22);
      drawTokenLabel(context, 0, 0, spot, engine.getCharacterStates(spot), { active: spot.id === engine.targetId, accent: TOWER_STYLE[engine.buildMode?.tower] ?? this.accent, compact: narrow });
      context.restore();
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
    const range = this.rangePixels(TOWER_TYPES[tower.type].range + 0.04 * (tower.level - 1));
    context.save();
    context.globalAlpha = engine.buildMode ? 0.16 : 0.07;
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, range, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = engine.buildMode ? 0.4 : 0.15;
    context.strokeStyle = color;
    context.setLineDash([4, 6]);
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  // 타워 공통 받침: 육각 금속판 + 그림자 + 레벨 갈매기표(금색)
  drawTowerBase(context, color, level) {
    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
    context.beginPath();
    context.ellipse(0, 15, 22, 7, 0, 0, Math.PI * 2);
    context.fill();
    const hexagon = radius => {
      context.beginPath();
      for (let corner = 0; corner < 6; corner++) {
        const angle = Math.PI / 6 + corner * Math.PI / 3;
        const px = Math.cos(angle) * radius, py = Math.sin(angle) * radius * 0.62 + 6;
        if (corner) context.lineTo(px, py);
        else context.moveTo(px, py);
      }
      context.closePath();
    };
    const metal = context.createLinearGradient(0, -6, 0, 18);
    metal.addColorStop(0, '#3a4378');
    metal.addColorStop(1, '#151a33');
    context.fillStyle = metal;
    hexagon(20);
    context.fill();
    context.strokeStyle = color;
    context.globalAlpha = 0.8;
    context.lineWidth = 1.5;
    context.stroke();
    context.globalAlpha = 1;
    for (let index = 0; index < level; index++) {
      const cx = -(level - 1) * 6 + index * 12;
      context.strokeStyle = '#ffd166';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(cx - 4, 22);
      context.lineTo(cx, 18);
      context.lineTo(cx + 4, 22);
      context.stroke();
    }
  }

  // 방화벽: 금속 받침 위 벽돌 성벽 + 위로 넘실대는 불꽃. 레벨이 오를수록 불꽃이 높고 밝다. 쏠 때 불꽃이 확 솟는다
  drawFirewall(context, tower, engine, fired) {
    const color = TOWER_STYLE.firewall;
    const time = wallSeconds();
    // 성벽
    const wall = context.createLinearGradient(0, -18, 0, 6);
    wall.addColorStop(0, '#c2452a');
    wall.addColorStop(1, '#6e1f14');
    context.fillStyle = wall;
    roundedRect(context, -14, -16, 28, 22, 3);
    context.fill();
    context.strokeStyle = 'rgba(20, 8, 6, 0.8)';
    context.lineWidth = 1;
    for (let row = 0; row < 3; row++) {
      const y = -16 + row * 7.3;
      context.beginPath();
      context.moveTo(-14, y);
      context.lineTo(14, y);
      context.stroke();
      for (let column = (row % 2 ? -7 : 0); column < 14; column += 14) {
        context.beginPath();
        context.moveTo(column, y);
        context.lineTo(column, y + 7.3);
        context.stroke();
      }
    }
    // 성가퀴
    context.fillStyle = '#d4583a';
    for (const notch of [-14, -4, 6]) context.fillRect(notch, -21, 8, 5);
    // 불꽃(세 갈래, 시간마다 일렁임)
    const height = 10 + tower.level * 4 + fired * 14;
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (const [offset, phase] of [[-7, 0], [0, 1.7], [7, 3.1]]) {
      const flicker = Math.sin(time * 11 + phase + tower.id) * 2.5;
      const flame = context.createLinearGradient(0, -21 - height, 0, -18);
      flame.addColorStop(0, 'rgba(255, 220, 120, 0)');
      flame.addColorStop(0.45, 'rgba(255, 170, 60, 0.85)');
      flame.addColorStop(1, color);
      context.fillStyle = flame;
      context.beginPath();
      context.moveTo(offset - 5, -19);
      context.quadraticCurveTo(offset - 6, -21 - height * 0.5, offset + flicker, -21 - height);
      context.quadraticCurveTo(offset + 6, -21 - height * 0.5, offset + 5, -19);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  // 백신: 받침 위 회전 포탑, 캡슐 모양 포신이 마지막 표적을 향한다. 레벨마다 포신 고리 하나. 쏘면 포구가 번쩍
  drawAntivirus(context, tower, engine, fired) {
    const color = TOWER_STYLE.antivirus;
    const angle = tower.viewAngle ?? -Math.PI / 2;
    // 포탑 몸통(돔)
    const dome = context.createRadialGradient(-4, -12, 2, 0, -8, 15);
    dome.addColorStop(0, '#e9fbff');
    dome.addColorStop(0.5, '#4fbfdc');
    dome.addColorStop(1, '#1b4a66');
    context.fillStyle = dome;
    context.beginPath();
    context.arc(0, -6, 13, Math.PI, 0);
    context.lineTo(13, 2);
    context.lineTo(-13, 2);
    context.closePath();
    context.fill();
    context.save();
    context.translate(0, -8);
    context.rotate(angle);
    // 캡슐 포신(반은 흰색, 반은 하늘색)
    const recoil = fired * 4;
    context.fillStyle = '#f2f6ff';
    roundedRect(context, 4 - recoil, -4.5, 12, 9, 4.5);
    context.fill();
    context.fillStyle = color;
    roundedRect(context, 14 - recoil, -4.5, 11, 9, 4.5);
    context.fill();
    context.strokeStyle = '#0d2c3d';
    context.lineWidth = 1.2;
    for (let ring = 0; ring < tower.level; ring++) {
      context.beginPath();
      context.moveTo(7 + ring * 3 - recoil, -4.5);
      context.lineTo(7 + ring * 3 - recoil, 4.5);
      context.stroke();
    }
    if (fired > 0) {
      context.globalCompositeOperation = 'lighter';
      context.fillStyle = `rgba(150, 240, 255, ${fired})`;
      context.beginPath();
      context.arc(27, 0, 4 + fired * 6, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
    // 십자 마크(백신)
    context.fillStyle = '#ffffff';
    context.fillRect(-1.5, -12, 3, 8);
    context.fillRect(-4, -9.5, 8, 3);
  }

  drawTower(context, tower, engine) {
    const { x, y } = this.towerPosition(tower);
    const color = TOWER_STYLE[tower.type];
    const shot = engine.towerShots.filter(entry => entry.towerId === tower.id).at(-1);
    if (shot) tower.viewAngle = Math.atan2(this.toScreen(shot).y - (y - 8), this.toScreen(shot).x - x);
    const fired = shot ? Math.max(0, 1 - (engine.gameTime - shot.at) / 0.25) : 0;
    const pop = Math.max(0, 1 - (engine.gameTime - (tower.upgradedAt ?? tower.builtAt)) / 0.5);
    const unit = this.unit();
    context.save();
    context.translate(x, y);
    context.scale(unit * (1 + pop * 0.3), unit * (1 + pop * 0.3));
    context.shadowColor = color;
    context.shadowBlur = 8 + fired * 12;
    this.drawTowerBase(context, color, tower.level);
    context.shadowBlur = 0;
    if (tower.type === 'firewall') this.drawFirewall(context, tower, engine, fired);
    else this.drawAntivirus(context, tower, engine, fired);
    context.restore();
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
    const problem = engine.placementProblem(field);
    const sameTower = engine.towers.find(tower => tower.type === mode.tower && Math.hypot((tower.x - field.x) * this.field().width, (tower.y - field.y) * this.field().height) < 26);
    const ok = !problem || Boolean(sameTower);
    const color = ok ? TOWER_STYLE[mode.tower] : SCENE.danger;
    const { x, y } = this.pointer;
    context.save();
    context.globalAlpha = 0.85;
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.setLineDash([5, 5]);
    context.beginPath();
    context.arc(x, y, ok ? this.rangePixels(TOWER_TYPES[mode.tower].range) : 22, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    if (ok) {
      context.globalAlpha = 0.6;
      context.translate(x, y);
      context.scale(this.unit(), this.unit());
      this.drawTowerBase(context, color, 1);
      if (mode.tower === 'firewall') this.drawFirewall(context, { level: 1, id: 0 }, engine, 0);
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

  // 공격: 종류별 아이콘(마름모 패킷 · 성난 봉투 · 성난 문서 · 자물쇠 괴물), 길을 따라 통통 튄다
  drawBug(context, bug, engine) {
    const style = BUG_STYLE[bug.type];
    const { x, y } = this.bugPosition(bug);
    const deadAge = bug.state === 'alive' ? 0 : engine.gameTime - bug.resolvedAt;
    if (bug.state !== 'alive' && deadAge > 0.4) return;
    const wiggle = Math.sin(engine.gameTime * 14 + bug.id) * 3;
    const size = style.size;
    context.save();
    context.translate(x, y);
    context.globalAlpha = bug.state === 'alive' ? 1 : 1 - deadAge / 0.4;
    if (bug.state !== 'alive') context.scale(1 + deadAge, 1 + deadAge);
    context.translate(0, -Math.abs(wiggle) * 0.8);
    context.shadowColor = style.body;
    context.shadowBlur = bug.type === 'ransomware' ? 18 : 10;
    context.fillStyle = style.body;
    context.strokeStyle = style.dark;
    context.lineWidth = 2;
    if (bug.type === 'packet') {
      context.beginPath();
      context.moveTo(0, -size);
      context.lineTo(size, 0);
      context.lineTo(0, size);
      context.lineTo(-size, 0);
      context.closePath();
      context.fill();
      context.shadowBlur = 0;
      context.stroke();
      context.strokeStyle = '#ffe2e8';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(-size * 0.35, -size * 0.2);
      context.lineTo(0, size * 0.25);
      context.lineTo(size * 0.35, -size * 0.2);
      context.stroke();
    } else if (bug.type === 'spam') {
      roundedRect(context, -size, -size * 0.7, size * 2, size * 1.4, 3);
      context.fill();
      context.shadowBlur = 0;
      context.stroke();
      context.beginPath();
      context.moveTo(-size, -size * 0.7);
      context.lineTo(0, size * 0.1);
      context.lineTo(size, -size * 0.7);
      context.stroke();
    } else {
      // 문서(악성 파일) · 자물쇠(랜섬웨어)
      if (bug.type === 'ransomware') {
        context.lineWidth = 5;
        context.strokeStyle = '#ffe08a';
        context.beginPath();
        context.arc(0, -size * 0.45, size * 0.55, Math.PI, 0);
        context.stroke();
        context.fillStyle = style.body;
        roundedRect(context, -size * 0.85, -size * 0.45, size * 1.7, size * 1.35, 6);
        context.fill();
      } else {
        context.beginPath();
        context.moveTo(-size * 0.75, -size);
        context.lineTo(size * 0.35, -size);
        context.lineTo(size * 0.75, -size * 0.6);
        context.lineTo(size * 0.75, size);
        context.lineTo(-size * 0.75, size);
        context.closePath();
        context.fill();
        context.shadowBlur = 0;
        context.stroke();
      }
    }
    context.shadowBlur = 0;
    // 성난 눈(패킷 제외)
    if (bug.type !== 'packet') {
      const eyeY = bug.type === 'spam' ? size * 0.25 : bug.type === 'ransomware' ? size * 0.1 : -size * 0.1;
      const eye = Math.max(2, size * 0.13);
      context.fillStyle = '#0e1222';
      for (const side of [-1, 1]) {
        context.beginPath();
        context.arc(side * size * 0.32, eyeY, eye, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = '#0e1222';
        context.lineWidth = Math.max(1.5, size * 0.09);
        context.beginPath();
        context.moveTo(side * size * 0.52, eyeY - eye * 2.2);
        context.lineTo(side * size * 0.14, eyeY - eye * 1.2);
        context.stroke();
      }
    }
    context.restore();
    if (bug.state === 'alive' && bug.maxHp > 1) {
      const barWidth = size * 1.8;
      context.fillStyle = 'rgba(0, 0, 0, 0.6)';
      context.fillRect(x - barWidth / 2, y + size + 6, barWidth, 4);
      context.fillStyle = style.body;
      context.fillRect(x - barWidth / 2, y + size + 6, barWidth * bug.hp / bug.maxHp, 4);
    }
  }

  // 공격 디자인(네온 사이버 위협): 패킷 = 빛나는 붉은 결정 + 잔상, 스팸 = 날개 달린 성난 봉투,
  // 악성 파일 = 색이 갈라지는(글리치) 보라 문서, 랜섬웨어 = 쇠사슬이 도는 거대한 자물쇠 괴물(남은 체력 = 방패 조각)
  drawBug(context, bug, engine) {
    const style = BUG_STYLE[bug.type];
    const { x, y } = this.bugPosition(bug);
    const deadAge = bug.state === 'alive' ? 0 : engine.gameTime - bug.resolvedAt;
    if (bug.state !== 'alive' && deadAge > 0.4) return;
    const ahead = this.toScreen(pointOnPath(Math.min(1, bug.progress + 0.01)));
    const heading = Math.atan2(ahead.y - y, ahead.x - x) || 0;
    const time = engine.gameTime;
    const bob = Math.sin(time * 6 + bug.id) * 2.5;
    context.save();
    context.translate(x, y + bob);
    context.scale(this.unit(), this.unit());
    context.globalAlpha = bug.state === 'alive' ? 1 : 1 - deadAge / 0.4;
    if (bug.state !== 'alive') context.scale(1 + deadAge * 1.5, 1 + deadAge * 1.5);
    // 바닥 그림자
    context.fillStyle = 'rgba(0, 0, 0, 0.35)';
    context.beginPath();
    context.ellipse(0, style.size + 6 - bob, style.size * 0.9, style.size * 0.3, 0, 0, Math.PI * 2);
    context.fill();
    if (bug.type === 'packet') this.drawPacket(context, style, heading, time, bug);
    else if (bug.type === 'spam') this.drawSpam(context, style, time, bug);
    else if (bug.type === 'malware') this.drawMalware(context, style, time, bug);
    else this.drawRansomware(context, style, time, bug);
    context.restore();
    if (bug.state === 'alive' && bug.maxHp > 1 && bug.type !== 'ransomware') {
      const barWidth = style.size * 2;
      context.fillStyle = 'rgba(0, 0, 0, 0.6)';
      roundedRect(context, x - barWidth / 2, y + style.size + 10, barWidth, 4, 2);
      context.fill();
      context.fillStyle = style.body;
      roundedRect(context, x - barWidth / 2, y + style.size + 10, barWidth * bug.hp / bug.maxHp, 4, 2);
      context.fill();
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
    context.translate(0, -1);
    this.drawAngryFace(context, size / 13, '#ffffff', false);
  }

  drawSpam(context, style, time, bug) {
    const size = style.size;
    const flap = Math.sin(time * 18 + bug.id) * 0.6;
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

  drawRansomware(context, style, time, bug) {
    const size = style.size;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4);
    // 붉은 기운
    const aura = context.createRadialGradient(0, 0, size * 0.4, 0, 0, size * 1.9);
    aura.addColorStop(0, `rgba(255, 40, 70, ${0.25 + pulse * 0.15})`);
    aura.addColorStop(1, 'rgba(255, 40, 70, 0)');
    context.fillStyle = aura;
    context.beginPath();
    context.arc(0, 0, size * 1.9, 0, Math.PI * 2);
    context.fill();
    // 남은 체력 = 도는 방패 조각
    context.save();
    context.rotate(time * 0.8);
    for (let index = 0; index < bug.maxHp; index++) {
      const angle = index / bug.maxHp * Math.PI * 2;
      context.strokeStyle = index < bug.hp ? '#ffb547' : 'rgba(255, 181, 71, 0.15)';
      context.lineWidth = 4;
      context.beginPath();
      context.arc(0, 0, size * 1.45, angle + 0.12, angle + Math.PI * 2 / bug.maxHp - 0.12);
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

  drawBugLabels(context, engine) {
    const narrow = this.surface.width < 520;
    const alive = engine.bugs.filter(bug => bug.state === 'alive').sort((first, second) => (first.id === engine.targetId) - (second.id === engine.targetId));
    for (const bug of alive) {
      const { x, y } = this.bugPosition(bug);
      const pop = this.visuals.get(bug.id).labelPop.value;
      context.save();
      context.translate(x, y - BUG_STYLE[bug.type].size - 6);
      context.scale(1 + pop / 100, 1 + pop / 100);
      drawTokenLabel(context, 0, 0, bug, engine.getCharacterStates(bug), { active: bug.id === engine.targetId, accent: this.accent, compact: narrow, dimmed: bug.doomed });
      context.restore();
    }
  }

  // 패치 투사체: 컴퓨터에서 버그로 날아가는 초록 코드 조각
  drawPatch(context, projectile, engine) {
    const bug = engine.findEntity(projectile.targetId);
    if (!bug || bug.kind !== 'bug') return;
    const progress = Math.min(1, (engine.gameTime - projectile.launchedAt) / ARCADE_RULES.projectileSeconds);
    const from = this.computerPosition();
    const to = this.bugPosition(bug);
    const px = from.x + (to.x - from.x) * progress;
    const py = from.y - 40 + (to.y - from.y + 40) * progress;
    context.fillStyle = '#7dffc4';
    context.shadowColor = '#7dffc4';
    context.shadowBlur = 12;
    context.font = canvasFont(14, 'code', 700);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('{ }', px, py);
    context.shadowBlur = 0;
  }

  drawTowerShot(context, shot, engine) {
    const age = (engine.gameTime - shot.at) / 0.3;
    if (age > 1) return;
    // 방화벽 = 넘실대는 불덩이가 날아감, 백신 = 하늘색 레이저 + 맞은 곳 불꽃
    const from = this.toScreen({ x: shot.fromX, y: shot.fromY });
    const to = this.bugPosition(shot);
    context.save();
    context.globalCompositeOperation = 'lighter';
    if (shot.type === 'firewall') {
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

  // 상점 줄: 낱말 + 이름 + 가격. 코인이 모자라면 흐리게
  drawShop(context, width, height, engine) {
    const top = height - SHOP_HEIGHT;
    context.fillStyle = 'rgba(9, 12, 24, 0.94)';
    context.fillRect(0, top, width, SHOP_HEIGHT);
    context.fillStyle = 'rgba(42, 49, 82, 0.9)';
    context.fillRect(0, top, width, 1);
    const narrow = width < 520;
    const prices = engine.snapshotExtras().prices;
    engine.shop.forEach((entry, index) => {
      const centerX = width * (index + 0.5) / engine.shop.length;
      const affordable = engine.coins >= prices[entry.item];
      context.save();
      context.translate(centerX, top + 26);
      drawTokenLabel(context, 0, 0, entry, engine.getCharacterStates(entry), { active: entry.id === engine.targetId, accent: this.accent, compact: narrow, dimmed: !affordable });
      context.restore();
      context.font = canvasFont(10, 'ui', 600);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillStyle = affordable ? SCENE.coin : SCENE.fog;
      const label = SHOP_ITEMS[entry.item].kind === 'repair' ? SHOP_LABELS.patch : SHOP_LABELS[entry.item];
      context.fillText(`${label} ${Number.isFinite(prices[entry.item]) ? prices[entry.item] : '—'}🪙`, centerX, top + 34);
    });
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
