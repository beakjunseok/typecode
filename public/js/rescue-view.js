// 에러 구조 SOS 화면: 위쪽 DevOps 구조선, 버그 바다에 가라앉는 프로세스 창, 날아가는 패치 튜브, 롤백 상자.
import { ARCADE_RULES } from './target-game.js';
import { VICTIM_TYPES, RESCUE_RULES } from './rescue-engine.js';
import { setupCanvas, roundedRect, drawTokenLabel, ParticleSystem, drawHud, easeOutCubic, easeOutBack, easeInOutSine, Spring, VisualStates } from './game-view.js';

const VICTIM_STYLE = {
  process: { frame: '#4b5767', title: '#ff4d6d', face: 'x_x', width: 46, height: 34 },
  coredump: { frame: '#a2412a', title: '#ffb547', face: '@_@', width: 40, height: 30 },
  cluster: { frame: '#3a6073', title: '#36e2ff', face: 'T_T', width: 62, height: 40 }
};

export class RescueRenderer {
  constructor(canvas) {
    this.surface = setupCanvas(canvas);
    this.particles = new ParticleSystem();
    this.lastGameTime = 0;
    this.accent = '#36e2ff';
    this.visuals = new VisualStates(() => ({
      lift: new Spring(0, { stiffness: 160, damping: 9 }),
      labelPop: new Spring(0, { stiffness: 420, damping: 18 })
    }));
    this.boatSwing = new Spring(0, { stiffness: 90, damping: 6 });
  }

  get context() {
    return this.surface.context;
  }

  get surfaceY() {
    return Math.round(this.surface.height * 0.3);
  }

  get seaDepth() {
    return this.surface.height - this.surfaceY - 30;
  }

  boatPosition() {
    return { x: this.surface.width / 2, y: this.surfaceY - 22 };
  }

  victimPosition(victim) {
    return { x: victim.x * this.surface.width, y: this.surfaceY + 10 + victim.depth * this.seaDepth };
  }

  cratePosition(crate, gameTime) {
    return { x: crate.x * this.surface.width, y: this.surfaceY - 4 + Math.sin(gameTime * 3 + crate.id) * 3 };
  }

  onEvent(type, payload) {
    if (type === 'throw') {
      this.boatSwing.kick(payload.target.x < 0.5 ? -0.9 : 0.9);
    } else if (type === 'lock') {
      this.visuals.get(payload.target.id).labelPop.kick(14);
    } else if (type === 'mistake' && payload.target) {
      this.visuals.get(payload.target.id).labelPop.kick(-10);
    } else if (type === 'hit') {
      this.visuals.get(payload.victim.id).lift.kick(-160);
    }
    if (!this.context) return;
    if (type === 'kill' || type === 'hit') {
      const { x, y } = this.victimPosition(payload.victim);
      this.particles.burst(x, y, { color: type === 'kill' ? '#39ff88' : '#36e2ff', count: type === 'kill' ? 24 : 12, speed: 160, life: 0.7, gravity: 120 });
    } else if (type === 'damage') {
      const { x, y } = this.victimPosition(payload.cause.victim);
      this.particles.burst(x, y, { color: '#5b8bd6', count: 20, speed: 90, life: 0.9, gravity: -160, size: 4 });
    } else if (type === 'item') {
      this.particles.burst(this.surface.width / 2, this.surfaceY, { color: '#7fdbca', count: 40, speed: 260, life: 0.9 });
    }
  }

  render(engine, { accent }) {
    const context = this.context;
    if (!context) return;
    this.surface.resize?.();
    this.accent = accent;
    const frameSeconds = Math.min(0.1, Math.max(0, engine.gameTime - this.lastGameTime)) || (engine.status === 'running' ? 0 : 1 / 60);
    this.lastGameTime = engine.gameTime;
    this.particles.update(frameSeconds);
    this.visuals.step(frameSeconds, new Set([...engine.victims, ...engine.crates].map(entity => entity.id)));
    this.boatSwing.step(frameSeconds);

    const { width, height } = this.surface;
    context.clearRect(0, 0, width, height);
    this.drawSkyAndSea(context, width, height, engine);
    this.drawBoat(context, engine);
    for (const crate of engine.crates) if (!crate.consumed || engine.projectiles.some(projectile => projectile.targetId === crate.id)) this.drawCrate(context, crate, engine);
    for (const victim of engine.victims) this.drawVictim(context, victim, engine);
    this.drawWaterFront(context, width, height, engine);
    for (const projectile of engine.projectiles) this.drawPatchRing(context, projectile, engine);
    this.drawLabels(context, engine);
    this.particles.draw(context);
    drawHud(context, {
      lives: engine.lives, maxLives: ARCADE_RULES.startLives, livesLabel: 'SLA',
      powerLabel: '⏪ 롤백', powerRemaining: engine.freezeRemaining(), powerSeconds: RESCUE_RULES.rollbackFreezeSeconds, accent: '#7fdbca'
    });
    if (engine.status === 'ready') {
      context.font = "600 14px 'JetBrains Mono', ui-monospace, monospace";
      context.textAlign = 'center';
      context.fillStyle = '#8a98aa';
      context.fillText('첫 글자를 치면 시작 · 가라앉는 프로세스의 에러를 쳐서 패치 튜브 투하', width / 2, height - 14);
      context.textAlign = 'start';
    }
  }

  drawSkyAndSea(context, width, height, engine) {
    const sky = context.createLinearGradient(0, 0, 0, this.surfaceY);
    sky.addColorStop(0, '#0a0d12');
    sky.addColorStop(1, '#121b28');
    context.fillStyle = sky;
    context.fillRect(0, 0, width, this.surfaceY);
    const frozen = engine.freezeRemaining() > 0;
    const sea = context.createLinearGradient(0, this.surfaceY, 0, height);
    sea.addColorStop(0, frozen ? '#14444a' : '#0f2a44');
    sea.addColorStop(1, frozen ? '#06181c' : '#050c16');
    context.fillStyle = sea;
    context.fillRect(0, this.surfaceY, width, height - this.surfaceY);
    // 바닷속에 떠다니는 버그 로그 조각
    context.font = "11px 'JetBrains Mono', monospace";
    context.fillStyle = 'rgba(91, 139, 214, 0.12)';
    const lines = ['at main.js:42', 'Traceback (most recent call last)', 'stack overflow', '0xDEADBEEF', 'exit code 137', 'OOMKilled'];
    lines.forEach((line, index) => {
      const x = ((index * 173 + engine.gameTime * 12) % (width + 200)) - 100;
      context.fillText(line, x, this.surfaceY + 50 + index * ((height - this.surfaceY - 60) / lines.length));
    });
    // 깊이 눈금
    context.fillStyle = 'rgba(255, 77, 109, 0.5)';
    context.fillRect(0, this.surfaceY + this.seaDepth + 10, width, 1);
  }

  // 수면 물결과 반투명 물(가라앉는 물체 위로 덮어 잠긴 느낌을 준다)
  drawWaterFront(context, width, height, engine) {
    context.beginPath();
    context.moveTo(0, this.surfaceY);
    for (let x = 0; x <= width; x += 12) {
      context.lineTo(x, this.surfaceY + Math.sin(x / 38 + engine.gameTime * 2) * 3);
    }
    context.strokeStyle = engine.freezeRemaining() > 0 ? '#7fdbca' : '#5b8bd6';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = 'rgba(15, 42, 68, 0.28)';
    context.fillRect(0, this.surfaceY + 2, width, height - this.surfaceY);
  }

  drawBoat(context, engine) {
    const { x, y } = this.boatPosition();
    const sway = Math.sin(engine.gameTime * 1.6) * 0.04 + this.boatSwing.value * 0.08;
    context.save();
    context.translate(x, y);
    context.rotate(sway);
    context.fillStyle = '#c9d4e0';
    context.beginPath();
    context.moveTo(-70, 0);
    context.lineTo(70, 0);
    context.lineTo(54, 20);
    context.lineTo(-54, 20);
    context.closePath();
    context.fill();
    context.fillStyle = '#ff4d6d';
    context.fillRect(-54, 8, 108, 4);
    context.fillStyle = '#1b2430';
    roundedRect(context, -26, -24, 52, 24, 4);
    context.fill();
    context.fillStyle = '#36e2ff';
    context.font = "600 10px 'JetBrains Mono', monospace";
    context.textAlign = 'center';
    context.fillText('DevOps 구조선', 0, -10);
    context.textAlign = 'start';
    // 경광등
    context.fillStyle = Math.sin(engine.gameTime * 8) > 0 ? '#ff4d6d' : '#36e2ff';
    context.beginPath();
    context.arc(0, -28, 4, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  // 가라앉는 프로세스 창: 등장은 물보라와 함께 튀어 오르고, 깊어질수록 얼굴이 o_o → x_x 로 바뀌며 더 허우적댄다.
  // 패치를 맞으면 스프링으로 솟구치고, 구조되면 포물선을 그리며 구조선으로 날아간다.
  drawVictim(context, victim, engine) {
    const style = VICTIM_STYLE[victim.type];
    const visual = this.visuals.get(victim.id);
    let { x, y } = this.victimPosition(victim);
    y += visual.lift.value * 0.1;
    let alpha = 1 - victim.depth * 0.4;
    let scale = easeOutBack(Math.min(1, (engine.gameTime - victim.spawnedAt) / 0.4));
    let rotation = 0;
    const since = engine.gameTime - victim.stateAt;
    if (victim.state === 'rescued') {
      const progress = easeInOutSine(Math.min(1, since / RESCUE_RULES.rescuedSeconds));
      const boat = this.boatPosition();
      const startX = x;
      const startY = y;
      x = startX + (boat.x - startX) * progress;
      y = startY + (boat.y - startY) * progress - Math.sin(progress * Math.PI) * 60;
      rotation = progress * Math.PI * 2;
      scale = 1 - progress * 0.5;
      alpha = 1 - progress * 0.7;
    } else if (victim.state === 'sunk') {
      y += since * 50;
      alpha = Math.max(0, 0.5 - since);
    }
    if (alpha <= 0 || scale <= 0) return;
    const panic = 0.6 + victim.depth * 1.6;
    const wobble = victim.state === 'sinking' ? Math.sin(engine.gameTime * 4 * panic + victim.id) * (2 + victim.depth * 4) : 0;
    const tilt = victim.state === 'sinking' ? Math.sin(engine.gameTime * 2.2 * panic + victim.id) * (0.05 + victim.depth * 0.12) : 0;
    const { width, height } = style;

    context.save();
    context.globalAlpha = alpha;
    context.translate(x + wobble, y);
    context.rotate(rotation + tilt);
    context.scale(scale, scale);
    // 창 프레임 + 제목 표시줄 + 버튼 3개
    context.fillStyle = '#10151c';
    roundedRect(context, -width / 2, -height / 2, width, height, 5);
    context.fill();
    context.strokeStyle = engine.gameTime - (victim.hitAt ?? -1) < 0.15 ? '#ffffff' : style.frame;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = style.title;
    context.fillRect(-width / 2 + 1, -height / 2 + 1, width - 2, 7);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((color, index) => {
      context.fillStyle = color;
      context.beginPath();
      context.arc(-width / 2 + 6 + index * 6, -height / 2 + 4.5, 1.8, 0, Math.PI * 2);
      context.fill();
    });
    const face = victim.state === 'rescued' ? '^_^' : victim.depth < 0.35 ? 'o_o' : victim.depth < 0.65 ? style.face : 'T_T';
    context.fillStyle = victim.depth > 0.65 && victim.state === 'sinking' ? '#ff9aa8' : '#c9d4e0';
    context.font = "700 12px 'JetBrains Mono', monospace";
    context.textAlign = 'center';
    context.fillText(face, 0, 4);
    context.font = "9px 'JetBrains Mono', monospace";
    context.fillStyle = '#8a98aa';
    context.fillText(victim.type === 'cluster' ? `${victim.hp}/${victim.maxHp} nodes` : `PID ${victim.pid}`, 0, height / 2 - 4);
    context.textAlign = 'start';
    // 허우적대는 팔: 깊을수록 빠르고 크게
    if (victim.state === 'sinking') {
      const flap = Math.sin(engine.gameTime * 9 * panic + victim.id) * (5 + victim.depth * 5);
      context.strokeStyle = '#8a98aa';
      context.lineWidth = 2.5;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(-width / 2, -2);
      context.quadraticCurveTo(-width / 2 - 8, -6, -width / 2 - 12, -12 - flap);
      context.moveTo(width / 2, -2);
      context.quadraticCurveTo(width / 2 + 8, -6, width / 2 + 12, -12 + flap);
      context.stroke();
    }
    context.restore();

    // 위급하면 SOS 말풍선 깜빡임 + 거품
    if (victim.state === 'sinking' && victim.depth > 0.55 && Math.sin(engine.gameTime * 9) > -0.2) {
      const bubbleX = x + width / 2 + 16;
      const bubbleY = y - height / 2 - 4;
      context.fillStyle = 'rgba(255, 77, 109, 0.9)';
      roundedRect(context, bubbleX - 15, bubbleY - 9, 30, 16, 6);
      context.fill();
      context.font = "800 11px 'JetBrains Mono', monospace";
      context.fillStyle = '#ffffff';
      context.textAlign = 'center';
      context.fillText('SOS', bubbleX, bubbleY);
      context.textAlign = 'start';
    }
    if (victim.state === 'sinking' && Math.random() < 0.05 + victim.depth * 0.12) {
      this.particles.burst(x + (Math.random() - 0.5) * width, y - height / 2, { color: '#5b8bd6', count: 1, speed: 20, life: 1.2, gravity: -60, size: 2.5 });
    }
    // 등장 물보라
    if (victim.state === 'sinking' && engine.gameTime - victim.spawnedAt < 0.05) {
      this.particles.burst(x, this.surfaceY, { color: '#9cc3ff', count: 14, speed: 140, life: 0.6, gravity: 380, size: 2.5 });
    }
  }

  drawCrate(context, crate, engine) {
    const { x, y } = this.cratePosition(crate, engine.gameTime);
    context.save();
    context.translate(x, y);
    context.shadowColor = '#7fdbca';
    context.shadowBlur = 14;
    context.fillStyle = '#123236';
    roundedRect(context, -18, -16, 36, 24, 4);
    context.fill();
    context.strokeStyle = '#7fdbca';
    context.lineWidth = 2;
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = '#7fdbca';
    context.font = "700 13px 'JetBrains Mono', monospace";
    context.textAlign = 'center';
    context.fillText('⏪', 0, 0);
    context.textAlign = 'start';
    context.restore();
  }

  // 구조선에서 목표로 던지는 패치 튜브(주황/흰 줄무늬 링)
  drawPatchRing(context, projectile, engine) {
    const target = engine.findEntity(projectile.targetId);
    if (!target) return;
    const progress = easeOutCubic(Math.min(1, (engine.gameTime - projectile.launchedAt) / ARCADE_RULES.projectileSeconds));
    const start = this.boatPosition();
    const end = target.kind === 'crate' ? this.cratePosition(target, engine.gameTime) : this.victimPosition(target);
    const x = start.x + (end.x - start.x) * progress;
    const y = start.y + (end.y - start.y) * progress - Math.sin(progress * Math.PI) * 50;
    // 구조선과 이어진 밧줄
    context.strokeStyle = 'rgba(201, 212, 224, 0.5)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(x, y);
    context.stroke();
    context.save();
    context.translate(x, y);
    context.rotate(progress * Math.PI * 4);
    for (let segment = 0; segment < 8; segment++) {
      context.strokeStyle = segment % 2 ? '#ffffff' : '#ff7a45';
      context.lineWidth = 5;
      context.beginPath();
      context.arc(0, 0, 9, (segment * Math.PI) / 4, ((segment + 1) * Math.PI) / 4);
      context.stroke();
    }
    context.restore();
  }

  drawLabels(context, engine) {
    for (const victim of engine.victims) {
      if (victim.state !== 'sinking' || victim.secured) continue;
      const { x, y } = this.victimPosition(victim);
      const pop = this.visuals.get(victim.id).labelPop.value * 0.4 - this.visuals.get(victim.id).lift.value * 0.1;
      drawTokenLabel(context, x, y - VICTIM_STYLE[victim.type].height / 2 - 8 - pop, victim, engine.getCharacterStates(victim), {
        active: victim.id === engine.targetId, accent: this.accent
      });
    }
    for (const crate of engine.crates) {
      if (crate.consumed) continue;
      const { x, y } = this.cratePosition(crate, engine.gameTime);
      drawTokenLabel(context, x, y - 22, crate, engine.getCharacterStates(crate), { active: crate.id === engine.targetId, accent: '#7fdbca' });
    }
  }
}

export { VICTIM_TYPES };
