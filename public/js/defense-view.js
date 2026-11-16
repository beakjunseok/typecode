// 컴퓨터 디펜스 화면. 들판: 지그재그 길을 따라 해킹 공격이 아래 가운데 컴퓨터(방패 돔)로 온다 /
// 길 사이 설치 자리 6곳(설치 모드면 자리 낱말이 뜬다) / 맨 아래: 상점 낱말(firewall · antivirus · patch)과 가격.
// 배경 그림(public/art/defense-stage.webp)이 있으면 그림 속 돔이 길 끝에 오도록 깔고, 없으면 격자·코드 비·컴퓨터를 직접 그린다.
import { ARCADE_RULES } from './target-game.js';
import { DEFENSE_RULES, TOWER_TYPES, TOWER_SLOTS, SHOP_ITEMS, DEFENSE_PATH } from './defense-engine.js';
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

  slotPosition(slot) {
    return this.toScreen(TOWER_SLOTS[slot]);
  }

  computerPosition() {
    return this.toScreen(DEFENSE_PATH.at(-1));
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
      const { x, y } = this.slotPosition(payload.tower.slot);
      juice.ring(x, y, { color: TOWER_STYLE[payload.tower.type], radius: 60, width: 4 });
      juice.popup(x, y - 30, type === 'tower-built' ? '설치!' : `Lv.${payload.tower.level}`, { color: TOWER_STYLE[payload.tower.type], size: 16 });
    } else if (type === 'repair') {
      const { x, y } = this.computerPosition();
      juice.ring(x, y - 20, { color: '#4df0a6', radius: 90, width: 5 });
      juice.popup(x, y - 70, `+${DEFENSE_RULES.repairAmount}`, { color: '#4df0a6', size: 20 });
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
    for (let slot = 0; slot < DEFENSE_RULES.slots; slot++) this.drawSlot(context, slot, engine);
    this.drawComputer(context, engine);
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

  // 그림 배치: 덮어 채우되 그림 속 돔이 길 끝(컴퓨터 자리)에 오게 옮긴다. 그림 밖이 보이지 않게 이동량을 제한
  artLayout() {
    const image = STAGE_ART;
    const { width, height } = this.surface;
    const computer = this.computerPosition();
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight,
      // 돔이 컴퓨터를 덮을 만큼은 크게
      44 / (ART_DOME.radius * image.naturalWidth));
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const left = Math.min(0, Math.max(width - drawWidth, computer.x - ART_DOME.x * drawWidth));
    const top = Math.min(0, Math.max(height - drawHeight, computer.y - ART_DOME.y * drawHeight));
    return { left, top, drawWidth, drawHeight, dome: { x: left + ART_DOME.x * drawWidth, y: top + ART_DOME.y * drawHeight, radius: ART_DOME.radius * drawWidth } };
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
    context.lineWidth = 34;
    trace();
    context.stroke();
    context.strokeStyle = 'rgba(8, 11, 26, 0.9)';
    context.lineWidth = 30;
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
    const text = `${label} ${mode.upgrade ? '업그레이드할' : '설치할'} 자리 낱말을 치세요 · ${TOWER_TYPES[mode.tower].word} 다시 치면 취소 · ${Math.ceil(left)}s`;
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
      const { x, y } = this.slotPosition(spot.slot);
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

  // 타워 슬롯: 빈 슬롯은 점선 사각형, 타워는 종류별 아이콘 + 레벨 점 + 사거리 원
  drawSlot(context, slot, engine) {
    const { x, y } = this.slotPosition(slot);
    const tower = engine.towers.find(entry => entry.slot === slot);
    const choosable = engine.spots[slot]?.token;
    if (!tower) {
      // 빈 설치 자리: 육각 받침. 설치 모드면 고를 타워 색으로 맥박
      const pulse = choosable ? 0.5 + 0.5 * Math.sin(wallSeconds() * 6) : 0;
      const color = choosable ? TOWER_STYLE[engine.buildMode.tower] : 'rgba(138, 147, 184, 0.45)';
      context.beginPath();
      for (let corner = 0; corner < 6; corner++) {
        const angle = Math.PI / 6 + corner * Math.PI / 3;
        const px = x + Math.cos(angle) * 18;
        const py = y + Math.sin(angle) * 18;
        if (corner) context.lineTo(px, py);
        else context.moveTo(px, py);
      }
      context.closePath();
      context.fillStyle = choosable ? `rgba(54, 226, 255, ${0.08 + pulse * 0.12})` : 'rgba(14, 18, 34, 0.6)';
      context.fill();
      context.strokeStyle = color;
      context.lineWidth = choosable ? 2 : 1.25;
      context.setLineDash(choosable ? [] : [3, 4]);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = color;
      context.font = canvasFont(14, 'ui', 700);
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText('+', x, y + 1);
      return;
    }
    const color = TOWER_STYLE[tower.type];
    const config = TOWER_TYPES[tower.type];
    const range = this.rangePixels(config.range + 0.04 * (tower.level - 1));
    context.fillStyle = `${color}0f`;
    context.beginPath();
    context.arc(x, y, range, 0, Math.PI * 2);
    context.fill();
    const pulse = Math.max(0, 1 - (engine.gameTime - (tower.upgradedAt ?? tower.builtAt)) / 0.5);
    context.save();
    context.translate(x, y);
    context.scale(1 + pulse * 0.25, 1 + pulse * 0.25);
    context.fillStyle = '#0e1222';
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.shadowColor = color;
    context.shadowBlur = 10;
    roundedRect(context, -17, -17, 34, 34, 8);
    context.fill();
    context.stroke();
    context.shadowBlur = 0;
    if (tower.type === 'firewall') {
      // 벽돌 세 줄
      context.fillStyle = color;
      for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 2; column++) {
          const offset = row % 2 ? 4 : 0;
          context.fillRect(-11 + column * 11 + offset - (row % 2 ? 4 : 0), -10 + row * 7, 9, 5);
        }
      }
    } else {
      // 알약(캡슐)
      context.rotate(-Math.PI / 4);
      context.fillStyle = color;
      roundedRect(context, -11, -5, 11, 10, 5);
      context.fill();
      context.fillStyle = '#e9edf8';
      roundedRect(context, 0, -5, 11, 10, 5);
      context.fill();
    }
    context.restore();
    for (let level = 0; level < tower.level; level++) {
      context.fillStyle = color;
      context.beginPath();
      context.arc(x - (tower.level - 1) * 4 + level * 8, y + 24, 2.5, 0, Math.PI * 2);
      context.fill();
    }
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

  // 버그 낱말: 버그 몸 위. 조준 중인 낱말은 맨 위에
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
    const from = this.slotPosition(shot.slot);
    const to = this.bugPosition(shot);
    context.globalAlpha = 1 - age;
    context.strokeStyle = TOWER_STYLE[shot.type];
    context.lineWidth = 3 - age * 2;
    context.shadowColor = TOWER_STYLE[shot.type];
    context.shadowBlur = 10;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.shadowBlur = 0;
    context.globalAlpha = 1;
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
