// 배터리 구조 캐릭터: 내 폰 마스코트 · PvP 상대 폰 · 방전봇.
// 가만히 서 있지 않도록 '리그'(스프링 몇 개 + 짧은 기분 타이머)가 숨쉬기 · 체중 이동 · 시선 · 조준(타자) · 발사 ·
// 맞음 · 환호 · 위급 · 잠 · 승패를 섞는다. 시간은 실제 시계(게임이 끝나도 승패 동작이 이어지게).
// 좌표: 원점 = 발 밑, +x = 바라보는 쪽, 위가 -y. 그리기·갱신은 프레임마다 O(1).
import { roundedRect, Spring } from './game-view.js';

export const MASCOT_PALETTES = Object.freeze({
  me: Object.freeze({ screenTop: '#36e2ff', screenBottom: '#1a7fa0', body: '#1b2430', trim: '#8a98aa', limb: '#c9d4e0', limbShade: '#7d8aa0' }),
  opponent: Object.freeze({ screenTop: '#ffb86c', screenBottom: '#c2563a', body: '#2a1c1c', trim: '#c9a08a', limb: '#e3cbbd', limbShade: '#9c7f72' })
});
const DRAIN_BOT = Object.freeze({ body: '#6a3a55', bodyDark: '#3b1f33', trim: '#ff5d73', limb: '#7a4462', limbShade: '#4a2840' });
const FACE_INK = '#05111a';
const ARM_SEGMENT = 8;
const MOOD_SECONDS = Object.freeze({ cheer: 0.8, hurt: 0.6, cast: 0.35, oops: 0.4 });

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const approach = (seconds, rate) => 1 - Math.exp(-seconds * rate);

export function createRig({ seed = 0, facing = 1 } = {}) {
  return {
    seed,
    facing,
    facingValue: facing,
    squash: new Spring(0, { stiffness: 320, damping: 13 }), // + 늘어남 / - 찌그러짐(비율)
    tilt: new Spring(0, { stiffness: 170, damping: 10 }), // + 앞으로 / - 뒤로(rad)
    hop: new Spring(0, { stiffness: 210, damping: 10 }), // 세로 위치(px, - 가 위)
    cast: new Spring(0, { stiffness: 240, damping: 15 }), // 팔을 뻗는 정도
    pump: new Spring(0, { stiffness: 700, damping: 22 }), // 키 칠 때 손 튕김
    look: { x: 1, y: 0 },
    typing: 0,
    arms: { front: { angle: 1.15, bend: -0.35 }, back: { angle: Math.PI - 1.15, bend: 0.35 } },
    mood: null,
    moodUntil: 0,
    clock: seed * 1.37
  };
}

// 사건 반응: cheer(충전·뺏어 옴) · hurt(뺏김) · cast(발사) · oops(오타·놓침) · key(한 타) · lock(조준)
export function reactRig(rig, type) {
  if (type === 'key') {
    rig.pump.kick(40);
    rig.squash.kick(-0.35);
    return;
  }
  if (type === 'lock') {
    rig.squash.kick(1.2);
    return;
  }
  if (type === 'cheer') {
    rig.hop.kick(-140);
    rig.squash.kick(2.4);
  } else if (type === 'hurt') {
    rig.tilt.kick(-3.4);
    rig.squash.kick(-2.6);
    rig.hop.kick(40);
  } else if (type === 'cast') {
    rig.cast.kick(16);
    rig.tilt.kick(1.8);
    rig.squash.kick(-1);
  } else if (type === 'oops') {
    rig.tilt.kick(-1.6);
  }
  if (MOOD_SECONDS[type]) {
    rig.mood = type;
    rig.moodUntil = rig.clock + MOOD_SECONDS[type];
  }
}

// state: { typing, look: {x,y} | null (목표 쪽 화면 방향), facing: ±1, worried, excited, sleeping, result: 'win'|'lose'|null }
export function updateRig(rig, state, frameSeconds) {
  const seconds = clamp(frameSeconds, 0, 0.05);
  rig.clock += seconds;
  for (const spring of [rig.squash, rig.tilt, rig.hop, rig.cast, rig.pump]) spring.step(seconds);
  if (rig.mood && rig.clock > rig.moodUntil) rig.mood = null;
  const wantsTyping = state.typing && !state.sleeping && !state.result ? 1 : 0;
  rig.typing += (wantsTyping - rig.typing) * approach(seconds, wantsTyping ? 12 : 4);
  if (state.facing) rig.facing = state.facing;
  rig.facingValue += (rig.facing - rig.facingValue) * approach(seconds, 12);

  let lookX;
  let lookY;
  if (state.sleeping) {
    lookX = 0;
    lookY = 0.6;
  } else if (state.look) {
    const length = Math.hypot(state.look.x, state.look.y) || 1;
    lookX = (state.look.x / length) * rig.facing;
    lookY = state.look.y / length;
  } else if (state.worried) {
    // 발밑 바다를 힐끔힐끔
    lookX = Math.sin(rig.clock * 3 + rig.seed) * 0.6;
    lookY = 0.9;
  } else {
    // 평소: 대개 앞(상대 쪽)을 보다가 가끔 뒤를 돌아보고 위아래로 두리번
    const glance = Math.sin(rig.clock * 0.37 + rig.seed * 2) + Math.sin(rig.clock * 0.91 + rig.seed);
    lookX = glance > 1.25 ? -0.75 : 0.85;
    lookY = Math.sin(rig.clock * 0.53 + rig.seed) * 0.45 - 0.1;
  }
  const lookRate = approach(seconds, 9);
  rig.look.x += (lookX - rig.look.x) * lookRate;
  rig.look.y += (lookY - rig.look.y) * lookRate;

  const target = armTargets(rig, state);
  const armRate = approach(seconds, rig.mood === 'hurt' || rig.mood === 'cast' ? 26 : 12);
  for (const side of ['front', 'back']) {
    rig.arms[side].angle += (target[side].angle - rig.arms[side].angle) * armRate;
    rig.arms[side].bend += (target[side].bend - rig.arms[side].bend) * armRate;
  }
}

// 팔 자세(각도: 0 = 앞, π/2 = 아래, -π/2 = 위, π = 뒤 / bend: + 면 아래팔이 위로 접힘). 우선순위대로 하나를 고른다
function armTargets(rig, state) {
  const time = rig.clock;
  const swing = Math.sin(time * 2.3 + rig.seed) * 0.14;
  // 몸이 뛰어오를 때 팔은 처지고, 떨어질 때 떠오른다(관성)
  const lag = clamp(-rig.hop.velocity * 0.004, -0.6, 0.6);
  let front = { angle: 1.15 + swing + lag, bend: -0.35 };
  let back = { angle: Math.PI - 1.15 - swing - lag, bend: 0.35 };
  if (state.result === 'win') {
    const wave = Math.sin(time * 12) * 0.35;
    front = { angle: -1.2 + wave, bend: 0.4 };
    back = { angle: Math.PI + 1.2 - wave, bend: -0.4 };
  } else if (state.result === 'lose' || state.sleeping) {
    front = { angle: 1.5, bend: 0.15 };
    back = { angle: Math.PI - 1.5, bend: -0.15 };
  } else if (rig.mood === 'hurt') {
    // 막는 자세: 앞팔을 얼굴 앞으로 접어 올리고 뒷팔은 놀라 뒤로
    front = { angle: -0.35, bend: 1.9 };
    back = { angle: Math.PI + 0.5, bend: -0.4 };
  } else if (rig.mood === 'cheer') {
    const pump = Math.sin(time * 14) * 0.2;
    front = { angle: -1.15 + pump, bend: 0.3 };
    back = { angle: Math.PI + 1.15 - pump, bend: -0.3 };
  } else if (state.worried && rig.typing < 0.5) {
    const flail = Math.sin(time * 13 + rig.seed);
    front = { angle: -1.3 + flail * 0.55, bend: 0.5 };
    back = { angle: Math.PI + 1.3 + flail * 0.55, bend: -0.5 };
  } else if (rig.typing > 0.02 || rig.cast.value > 0.05) {
    // 조준: 앞팔로 목표를 가리키고(손끝에 전기), 뒷팔은 허리에 짚은 채 한 타마다 까딱
    const aim = clamp(Math.atan2(rig.look.y, Math.max(0.2, rig.look.x)), -1.35, 1.2);
    const amount = Math.max(rig.typing, clamp(rig.cast.value, 0, 1));
    front = {
      angle: front.angle + (aim - front.angle) * amount,
      bend: front.bend + (0.12 - front.bend) * amount
    };
    back = { angle: back.angle + (Math.PI - 0.7 + rig.pump.value * 0.08 - back.angle) * amount, bend: back.bend + (1.44 - back.bend) * amount };
  } else if (state.excited) {
    // 100%가 코앞: 충전 케이블 쪽으로 손을 뻗어 까치발
    front = { angle: -1.35 + Math.sin(time * 4) * 0.12, bend: 0.15 };
  }
  return { front, back };
}

// 공통 몸놀림 값: 숨쉬기 비율 · 기울기 · 체중 이동 · 점프 높이 · 떨림
function bodyMotion(rig, { sleeping, worried, result }) {
  const time = rig.clock;
  const breathe = Math.sin(time * (sleeping ? 1.3 : 2.3) + rig.seed) * (sleeping ? 0.035 : 0.022);
  const stretch = clamp(1 + breathe + rig.squash.value + (result === 'lose' ? -0.08 : 0) + (worried ? Math.sin(time * 9) * 0.015 : 0), 0.65, 1.35);
  const lean = rig.tilt.value + rig.typing * 0.08 + Math.min(0.12, Math.max(0, rig.cast.value) * 0.06)
    + (sleeping ? 0.14 : 0) + (result === 'lose' ? 0.18 : 0) - (worried ? 0.04 : 0);
  const calm = (1 - rig.typing) * (worried || sleeping || result ? 0 : 1);
  const phase = time * 0.8 + rig.seed;
  return {
    stretch,
    widen: 1 - (stretch - 1) * 0.55,
    lean,
    shift: Math.sin(phase) * 1.8 * calm,
    footLift: [Math.max(0, Math.cos(phase)) * 1.6 * calm, Math.max(0, -Math.cos(phase)) * 1.6 * calm],
    hop: rig.hop.value + (result === 'win' ? -Math.abs(Math.sin(time * 6.5)) * 12 : 0),
    tremble: worried && !sleeping ? Math.sin(time * 43) * 0.7 : 0
  };
}

// 다리 둘: 엉덩이 → 무릎(쪼그릴수록 바깥으로 굽음) → 발(신발). 점프 중이면 발이 땅에서 뜬다
function drawLegs(context, { hipY, spread, feetY, footLift, shift, color, shoe, width, length }) {
  context.lineCap = 'round';
  context.strokeStyle = color;
  context.lineWidth = width;
  for (const [index, side] of [[0, -1], [1, 1]]) {
    const hip = { x: side * spread + shift * 0.6, y: hipY - 2 };
    const foot = { x: side * (spread + 1), y: feetY - footLift[index] };
    const distance = Math.hypot(foot.x - hip.x, foot.y - hip.y);
    const bendOut = Math.sqrt(Math.max(0, length * length - distance * distance)) * 0.5;
    const knee = { x: (hip.x + foot.x) / 2 + side * bendOut, y: (hip.y + foot.y) / 2 };
    context.beginPath();
    context.moveTo(hip.x, hip.y);
    context.quadraticCurveTo(knee.x, knee.y, foot.x, foot.y);
    context.stroke();
    context.fillStyle = shoe;
    context.beginPath();
    context.ellipse(foot.x + 1.2, foot.y + 0.4, 3.4, 1.9, 0, 0, Math.PI * 2);
    context.fill();
  }
}

// 팔 두 마디 + 손. reach: 위·아래팔 길이 배수. 손 위치를 돌려준다
function drawArm(context, shoulder, { angle, bend }, { color, shade, width, reach = 1, claw = false }) {
  const elbow = { x: shoulder.x + Math.cos(angle) * ARM_SEGMENT * reach, y: shoulder.y + Math.sin(angle) * ARM_SEGMENT * reach };
  const foreAngle = angle - bend;
  const hand = { x: elbow.x + Math.cos(foreAngle) * ARM_SEGMENT * reach, y: elbow.y + Math.sin(foreAngle) * ARM_SEGMENT * reach };
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(shoulder.x, shoulder.y);
  context.lineTo(elbow.x, elbow.y);
  context.lineTo(hand.x, hand.y);
  context.stroke();
  if (claw) {
    context.strokeStyle = shade;
    context.lineWidth = 1.8;
    for (const spread of [-0.55, 0.55]) {
      context.beginPath();
      context.moveTo(hand.x, hand.y);
      context.lineTo(hand.x + Math.cos(foreAngle + spread) * 4, hand.y + Math.sin(foreAngle + spread) * 4);
      context.stroke();
    }
  } else {
    context.fillStyle = color;
    context.beginPath();
    context.arc(hand.x, hand.y, width * 0.95, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = shade;
    context.beginPath();
    context.arc(hand.x + Math.cos(foreAngle) * 0.8, hand.y + Math.sin(foreAngle) * 0.8 + 0.6, width * 0.45, 0, Math.PI * 2);
    context.fill();
  }
  return { hand, foreAngle };
}

// 조준 중 손끝 전기: 타자 진행만큼 굵어지는 작은 번개 갈래
function drawFingerSpark(context, { hand, foreAngle }, strength, time, color) {
  if (strength < 0.1) return;
  context.save();
  context.strokeStyle = color;
  context.shadowColor = color;
  context.shadowBlur = 6;
  context.lineWidth = 1;
  context.globalAlpha = Math.min(1, strength);
  for (let branch = 0; branch < 3; branch++) {
    const angle = foreAngle + (branch - 1) * 0.6 + Math.sin(time * 37 + branch * 2.1) * 0.3;
    const length = 3 + strength * 4;
    context.beginPath();
    context.moveTo(hand.x, hand.y);
    context.lineTo(hand.x + Math.cos(angle) * length * 0.5 + Math.sin(time * 53 + branch) * 1.2, hand.y + Math.sin(angle) * length * 0.5);
    context.lineTo(hand.x + Math.cos(angle) * length, hand.y + Math.sin(angle) * length);
    context.stroke();
  }
  context.restore();
}

// 바라보는 방향으로 좌우 반전(돌아설 때는 납작해졌다가 펴져서 몸을 돌리는 것처럼 보인다)
function applyFacing(context, rig) {
  const value = rig.facingValue;
  context.scale(Math.sign(value || 1) * Math.max(0.12, Math.abs(value)), 1);
}

// 내 폰 / PvP 상대 폰 마스코트. options: { palette, percent(0~1 배터리), sleeping, worried, result }
export function drawPhoneMascot(context, rig, { palette, percent, sleeping = false, worried = false, result = null }) {
  const time = rig.clock;
  const motion = bodyMotion(rig, { sleeping, worried, result });
  const airborne = Math.min(0, motion.hop);
  const crouch = Math.min(4, Math.max(0, motion.hop) * 0.5 + Math.max(0, 1 - motion.stretch) * 12);
  const legLength = 7;
  const hipY = airborne - legLength + crouch;
  context.save();
  context.translate(motion.tremble, 0);
  applyFacing(context, rig);
  drawLegs(context, {
    hipY, spread: 6, feetY: airborne, footLift: motion.footLift, shift: motion.shift,
    color: palette.limb, shoe: palette.body, width: 3, length: legLength + 1
  });
  context.translate(motion.shift * 0.6, hipY);
  context.rotate(motion.lean);
  context.scale(motion.widen, motion.stretch);
  const limb = { color: palette.limb, shade: palette.limbShade, width: 3 };
  drawArm(context, { x: -14, y: -25 }, rig.arms.back, limb);

  // 몸(폰) + 화면
  context.fillStyle = palette.body;
  roundedRect(context, -15, -40, 30, 40, 7);
  context.fill();
  context.strokeStyle = palette.trim;
  context.lineWidth = 1.5;
  context.stroke();
  const flash = rig.mood === 'hurt' ? Math.max(0, 1 - (rig.moodUntil - rig.clock - (MOOD_SECONDS.hurt - 0.18)) / 0.18) : 0;
  const screen = context.createLinearGradient(0, -37, 0, -6);
  screen.addColorStop(0, sleeping ? '#2a2f3a' : palette.screenTop);
  screen.addColorStop(1, sleeping ? '#151922' : palette.screenBottom);
  context.fillStyle = screen;
  roundedRect(context, -12, -37, 24, 31, 4);
  context.fill();
  if (rig.mood === 'hurt' && rig.moodUntil - rig.clock > MOOD_SECONDS.hurt - 0.15) {
    context.fillStyle = `rgba(255, 255, 255, ${0.55 * (1 - flash)})`;
    roundedRect(context, -12, -37, 24, 31, 4);
    context.fill();
  }
  // 화면 위 배터리 상태줄
  context.fillStyle = 'rgba(5, 17, 26, 0.75)';
  context.fillRect(-9, -35, 14, 4);
  context.fillStyle = percent < 0.2 ? '#ff5d73' : '#4df0a6';
  context.fillRect(-8, -34.2, 12 * clamp(percent, 0, 1), 2.4);
  context.fillRect(5.3, -34, 1.2, 2);
  drawMascotFace(context, rig, { sleeping, worried, result, ink: FACE_INK });

  const front = drawArm(context, { x: 15.6, y: -25 }, rig.arms.front, { ...limb, reach: 1 + clamp(rig.cast.value, 0, 1.2) * 0.22 });
  if (!result && !sleeping) drawFingerSpark(context, front, rig.typing * 0.8 + clamp(rig.cast.value, 0, 1), time, palette.screenTop);
  context.restore();
  if (worried && !sleeping && !result) drawSweat(context, rig, motion);
}

function drawMascotFace(context, rig, { sleeping, worried, result, ink }) {
  const time = rig.clock;
  const shiftX = 1 + rig.look.x * 2.2;
  const shiftY = rig.look.y * 1.8;
  const eyeY = -24 + shiftY;
  const blinking = (time + rig.seed * 1.7) % 3.7 < 0.12;
  const happy = result === 'win' || rig.mood === 'cheer';
  const hurt = rig.mood === 'hurt' || result === 'lose';
  context.strokeStyle = ink;
  context.fillStyle = ink;
  context.lineCap = 'round';
  context.lineWidth = 1.8;
  for (const side of [-1, 1]) {
    const eyeX = side * 5 + shiftX;
    context.beginPath();
    if (sleeping) {
      context.arc(eyeX, eyeY - 1, 2.4, Math.PI * 0.15, Math.PI * 0.85);
      context.stroke();
    } else if (hurt) {
      // > <
      context.moveTo(eyeX - side * 2, eyeY - 2.2);
      context.lineTo(eyeX + side * 1.4, eyeY);
      context.lineTo(eyeX - side * 2, eyeY + 2.2);
      context.stroke();
    } else if (happy) {
      context.arc(eyeX, eyeY + 1.2, 2.4, Math.PI * 1.15, Math.PI * 1.85);
      context.stroke();
    } else if (blinking) {
      context.moveTo(eyeX - 2.2, eyeY);
      context.lineTo(eyeX + 2.2, eyeY);
      context.stroke();
    } else {
      const big = worried ? 1.2 : 1;
      context.ellipse(eyeX, eyeY, 2.3 * big, 2.9 * big, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(255, 255, 255, 0.9)';
      context.beginPath();
      context.arc(eyeX + 0.8 + rig.look.x * 0.4, eyeY - 1.1, 0.8, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = ink;
    }
    // 눈썹: 조준 중이면 안쪽이 내려간 결연한 눈썹, 위급하면 안쪽이 올라간 걱정 눈썹
    const browTilt = rig.typing > 0.3 && !worried ? 0.35 * rig.typing : worried ? -0.35 : 0;
    if (!sleeping && Math.abs(browTilt) > 0.05) {
      context.beginPath();
      context.moveTo(eyeX - 2.6, eyeY - 4.6 - side * browTilt * 2.2);
      context.lineTo(eyeX + 2.6, eyeY - 4.6 + side * browTilt * 2.2);
      context.stroke();
    }
  }
  // 입
  const mouthX = shiftX * 0.8;
  const mouthY = -14 + shiftY * 0.5;
  context.beginPath();
  if (happy) {
    context.moveTo(mouthX - 4, mouthY - 1.5);
    context.quadraticCurveTo(mouthX, mouthY + 5, mouthX + 4, mouthY - 1.5);
    context.closePath();
    context.fill();
    context.fillStyle = '#ff8fa3';
    context.beginPath();
    context.ellipse(mouthX, mouthY + 1.6, 2, 1, 0, 0, Math.PI * 2);
    context.fill();
  } else if (hurt || sleeping) {
    context.ellipse(mouthX, mouthY, sleeping ? 1.2 : 1.8, sleeping ? 1 : 2.2, 0, 0, Math.PI * 2);
    context.fill();
  } else if (worried) {
    context.arc(mouthX, mouthY + 3, 3.4, Math.PI * 1.2, Math.PI * 1.8);
    context.stroke();
  } else if (rig.typing > 0.4) {
    // 집중: 일자 입 + 혀끝 살짝
    context.moveTo(mouthX - 2.6, mouthY);
    context.lineTo(mouthX + 2.6, mouthY);
    context.stroke();
    context.fillStyle = '#ff8fa3';
    context.beginPath();
    context.ellipse(mouthX + 2.2, mouthY + 1.2, 1.2, 1, 0.4, 0, Math.PI * 2);
    context.fill();
  } else {
    context.arc(mouthX, mouthY - 2.5, 3.4, Math.PI * 0.2, Math.PI * 0.8);
    context.stroke();
  }
}

// 땀방울: 머리 옆에서 맺혀 떨어진다(1.1초 주기)
function drawSweat(context, rig, motion) {
  const cycle = (rig.clock * 0.9 + rig.seed) % 1;
  const side = rig.facing;
  context.globalAlpha = 1 - cycle;
  context.fillStyle = '#9cc3ff';
  const x = side * (17 + cycle * 2) + motion.tremble;
  const y = -44 + motion.hop + cycle * 14;
  context.beginPath();
  context.moveTo(x, y - 3.5);
  context.quadraticCurveTo(x + 2.6, y + 0.5, x, y + 2);
  context.quadraticCurveTo(x - 2.6, y + 0.5, x, y - 3.5);
  context.fill();
  context.globalAlpha = 1;
}

// 방전봇: 플러그 머리 상자 로봇. options: { paused(화면 꺼짐), worried, result }
export function drawDrainBot(context, rig, { paused = false, worried = false, result = null }) {
  const time = rig.clock;
  const motion = bodyMotion(rig, { sleeping: paused, worried, result });
  const airborne = Math.min(0, motion.hop);
  const crouch = Math.min(4, Math.max(0, motion.hop) * 0.5 + Math.max(0, 1 - motion.stretch) * 12);
  const legLength = 6;
  const hipY = airborne - legLength + crouch;
  context.save();
  context.translate(motion.tremble, 0);
  applyFacing(context, rig);
  drawLegs(context, {
    hipY, spread: 7, feetY: airborne, footLift: motion.footLift, shift: motion.shift,
    color: DRAIN_BOT.limbShade, shoe: '#1b2430', width: 4.5, length: legLength + 1
  });
  context.translate(motion.shift * 0.6, hipY);
  // 기계라서 기울기가 살짝 끊겨 보이게(작은 계단)
  context.rotate(Math.round(motion.lean * 40) / 40);
  context.scale(motion.widen, motion.stretch);
  const limb = { color: DRAIN_BOT.limb, shade: '#c9d4e0', width: 4, claw: true };
  drawArm(context, { x: -16, y: -20 }, rig.arms.back, limb);

  // 플러그 단자 + 단자 사이 전기(발사·조준 중)
  context.fillStyle = '#c9d4e0';
  context.fillRect(-8, -45, 4, 11);
  context.fillRect(4, -45, 4, 11);
  const charge = paused ? 0 : rig.typing * 0.6 + clamp(rig.cast.value, 0, 1);
  if (charge > 0.15) {
    context.strokeStyle = '#ff5d73';
    context.shadowColor = '#ff5d73';
    context.shadowBlur = 8;
    context.lineWidth = 1.2;
    context.globalAlpha = Math.min(1, charge);
    context.beginPath();
    context.moveTo(-4, -42);
    for (let step = 1; step <= 4; step++) context.lineTo(-4 + step * 2, -42 + (step % 2 ? -2 : 2) * Math.sin(time * 41 + step));
    context.stroke();
    context.shadowBlur = 0;
    context.globalAlpha = 1;
  }
  const body = context.createLinearGradient(-16, -35, 16, 0);
  body.addColorStop(0, DRAIN_BOT.body);
  body.addColorStop(1, DRAIN_BOT.bodyDark);
  context.fillStyle = body;
  roundedRect(context, -17, -35, 34, 35, 9);
  context.fill();
  context.strokeStyle = DRAIN_BOT.trim;
  context.lineWidth = 1.5;
  context.stroke();
  // 배 쪽 방전 표시등
  context.fillStyle = paused ? '#3a1a28' : `rgba(255, 93, 115, ${0.5 + 0.4 * Math.sin(time * 5)})`;
  context.fillRect(-6, -9, 12, 2.5);

  // 얼굴창: 눈이 시선 쪽으로 미끄러지고, 조준 중이면 가늘고 밝게. 맞으면 지직, 잠들면 꺼짐
  const visorTop = -29;
  context.fillStyle = paused ? '#05080c' : '#0b1017';
  roundedRect(context, -12, visorTop, 24, 14, 4);
  context.fill();
  if (rig.mood === 'hurt' && !paused) {
    context.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (let line = 0; line < 4; line++) {
      const y = visorTop + 2 + ((time * 120 + line * 3.7) % 10);
      context.fillRect(-11, y, 22, 0.8);
    }
  }
  if (!paused) {
    const eyeShift = clamp(rig.look.x, -1, 1) * 2.5;
    const eyeDrop = clamp(rig.look.y, -1, 1) * 1.5;
    const squint = rig.typing * 1.4;
    const happy = rig.mood === 'cheer' || result === 'win';
    const knocked = result === 'lose';
    context.strokeStyle = '#ff5d73';
    context.shadowColor = '#ff5d73';
    context.shadowBlur = 6 + rig.typing * 6;
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.beginPath();
    for (const side of [-1, 1]) {
      const eyeX = side * 5.5 + eyeShift;
      const eyeY = visorTop + 7 + eyeDrop;
      if (knocked) {
        context.moveTo(eyeX - 2, eyeY - 2);
        context.lineTo(eyeX + 2, eyeY + 2);
        context.moveTo(eyeX + 2, eyeY - 2);
        context.lineTo(eyeX - 2, eyeY + 2);
      } else if (happy) {
        context.moveTo(eyeX - 2.5, eyeY + 1);
        context.lineTo(eyeX, eyeY - 1.5);
        context.lineTo(eyeX + 2.5, eyeY + 1);
      } else {
        // 화난 눈: 안쪽이 내려간 사선
        context.moveTo(eyeX - side * 3, eyeY - 2 + squint * 0.5);
        context.lineTo(eyeX + side * 2, eyeY + 1.5 - squint * 0.3);
      }
    }
    context.stroke();
    context.shadowBlur = 0;
  }
  const front = drawArm(context, { x: 17.6, y: -20 }, rig.arms.front, { ...limb, reach: 1 + clamp(rig.cast.value, 0, 1.2) * 0.22 });
  if (!result && !paused) drawFingerSpark(context, front, rig.typing * 0.6 + clamp(rig.cast.value, 0, 1), time, '#ff5d73');
  context.restore();
  // 위급하면 단자에서 연기가 피어오른다
  if (worried && !paused && !result) {
    for (let puff = 0; puff < 3; puff++) {
      const cycle = (time * 0.7 + puff / 3) % 1;
      context.globalAlpha = 0.35 * (1 - cycle);
      context.fillStyle = '#8a93b8';
      context.beginPath();
      context.arc(Math.sin(time * 2 + puff) * 4, -52 + motion.hop - cycle * 18, 2.5 + cycle * 4, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }
}
