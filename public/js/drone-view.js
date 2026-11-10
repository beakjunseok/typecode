// 공용 드론 그리기: 휴대폰 던지기(아이템 운반), 배터리 구조(충전 드론·보조배터리 드론)가 같은 디자인을 쓴다.
// 좌표 원점 = 몸통 중심. size 1일 때 폭 약 62px, 집게 끝은 원점 아래 +14px. 프레임마다 O(1).
import { roundedRect } from './game-view.js';

const BODY_WIDTH = 28;
const BODY_HEIGHT = 15;
const ARM_REACH = 24;
const ROTOR_RADIUS = 12;
const ROTOR_TILT = 0.22;      // 로터 원반을 살짝 위에서 내려다본 납작한 타원으로
const ROTOR_SPEED = 38;       // rad/s
export const DRONE_CLAW_REACH = 14;

// accent: 상태 LED·눈 빛 색(운반하는 아이템 색). tilt: 좌우 이동 방향으로 기울기(rad). seed: 드론마다 깜빡임·눈 움직임을 다르게
export function drawDrone(context, { x = 0, y = 0, size = 1, time = 0, accent = '#36e2ff', tilt = 0, seed = 0, claws = false }) {
  context.save();
  context.translate(x, y);
  context.rotate(tilt);
  context.scale(size, size);
  for (const side of [-1, 1]) drawArm(context, side, time, seed);
  drawBody(context, time, accent, seed);
  if (claws) drawClaws(context);
  context.restore();
}

// 팔: 몸통에서 위로 살짝 휘어 올라가 모터에 닿고, 모터 위에 로터. 끝에 항법등(왼쪽 빨강·오른쪽 초록)
function drawArm(context, side, time, seed) {
  const tipX = side * ARM_REACH;
  context.strokeStyle = '#46566a';
  context.lineWidth = 3.2;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(side * 9, -1);
  context.quadraticCurveTo(side * 17, -8, tipX, -8);
  context.stroke();
  context.strokeStyle = '#6f8196';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(side * 10, -3);
  context.quadraticCurveTo(side * 17, -9.5, tipX, -9.5);
  context.stroke();

  context.fillStyle = '#1c2530';
  roundedRect(context, tipX - 4.5, -12, 9, 7, 2.5);
  context.fill();
  context.fillStyle = '#9fb0c4';
  context.fillRect(tipX - 1, -15, 2, 3.5);
  drawRotor(context, tipX, -15, time * ROTOR_SPEED * side + seed * 1.7);

  const on = Math.sin(time * 5 + seed + (side > 0 ? Math.PI : 0)) > 0.35;
  context.fillStyle = side < 0 ? (on ? '#ff4d6d' : '#5a1f2b') : (on ? '#39ff88' : '#1d5a3a');
  if (on) {
    context.shadowColor = context.fillStyle;
    context.shadowBlur = 6;
  }
  context.beginPath();
  context.arc(tipX + side * 5.5, -8.5, 1.6, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
}

// 로터: 빠르게 도는 원반(잔상) + 반투명 날개 두 장. 날개 끝은 납작한 타원 궤도를 따라 돈다
function drawRotor(context, centerX, centerY, angle) {
  const radiusY = ROTOR_RADIUS * ROTOR_TILT;
  context.fillStyle = 'rgba(190, 215, 240, 0.12)';
  context.beginPath();
  context.ellipse(centerX, centerY, ROTOR_RADIUS, radiusY, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgba(190, 215, 240, 0.28)';
  context.lineWidth = 0.8;
  context.stroke();
  context.lineCap = 'round';
  for (const [offset, alpha] of [[0, 0.75], [Math.PI / 2, 0.3]]) {
    const bladeX = Math.cos(angle + offset) * ROTOR_RADIUS;
    const bladeY = Math.sin(angle + offset) * radiusY;
    context.strokeStyle = `rgba(220, 232, 245, ${alpha})`;
    context.lineWidth = 1.8;
    context.beginPath();
    context.moveTo(centerX - bladeX, centerY - bladeY);
    context.lineTo(centerX + bladeX, centerY + bladeY);
    context.stroke();
  }
  context.fillStyle = '#d6e0ea';
  context.beginPath();
  context.arc(centerX, centerY, 1.4, 0, Math.PI * 2);
  context.fill();
}

// 몸통: 위가 밝은 캡슐 + 광택 줄 + 앞쪽 카메라 눈(이리저리 보다가 가끔 깜빡임) + 아래 상태 LED
function drawBody(context, time, accent, seed) {
  const left = -BODY_WIDTH / 2;
  const top = -BODY_HEIGHT / 2;
  const shell = context.createLinearGradient(0, top, 0, top + BODY_HEIGHT);
  shell.addColorStop(0, '#5b6c80');
  shell.addColorStop(0.45, '#2c3847');
  shell.addColorStop(1, '#151c26');
  context.fillStyle = shell;
  roundedRect(context, left, top, BODY_WIDTH, BODY_HEIGHT, 7);
  context.fill();
  context.strokeStyle = 'rgba(0, 0, 0, 0.5)';
  context.lineWidth = 1;
  context.stroke();
  context.fillStyle = 'rgba(255, 255, 255, 0.22)';
  roundedRect(context, left + 5, top + 2, BODY_WIDTH - 12, 2.5, 1.2);
  context.fill();

  // 눈: 어두운 바이저 안에서 accent 빛 눈동자가 좌우로 천천히 움직이고, 약 4초마다 깜빡
  context.fillStyle = '#05080c';
  roundedRect(context, -8, -2, 16, 7.5, 3.5);
  context.fill();
  const blink = (time * 0.25 + seed * 0.37) % 1 > 0.965;
  const lookX = Math.sin(time * 0.9 + seed) * 3.2;
  context.fillStyle = accent;
  context.shadowColor = accent;
  context.shadowBlur = 8;
  if (blink) {
    context.fillRect(lookX - 2.6, 1.2, 5.2, 1.1);
  } else {
    context.beginPath();
    context.arc(lookX, 1.75, 2.4, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = 'rgba(255, 255, 255, 0.85)';
    context.beginPath();
    context.arc(lookX + 0.9, 0.9, 0.8, 0, Math.PI * 2);
    context.fill();
  }
  context.shadowBlur = 0;

  const pulse = 0.55 + 0.45 * Math.sin(time * 4 + seed);
  context.globalAlpha = pulse;
  context.fillStyle = accent;
  roundedRect(context, -5, BODY_HEIGHT / 2 - 2, 10, 2, 1);
  context.fill();
  context.globalAlpha = 1;
}

// 집게: 몸통 아래에서 두 갈래로 내려와 안쪽으로 굽어 짐을 문다(끝 = 원점 아래 DRONE_CLAW_REACH)
function drawClaws(context) {
  context.strokeStyle = '#7d8ea3';
  context.lineWidth = 2;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const side of [-1, 1]) {
    context.beginPath();
    context.moveTo(side * 4.5, BODY_HEIGHT / 2 - 1);
    context.lineTo(side * 6.5, BODY_HEIGHT / 2 + 3);
    context.lineTo(side * 6, DRONE_CLAW_REACH - 1.5);
    context.lineTo(side * 3.5, DRONE_CLAW_REACH);
    context.stroke();
  }
  context.fillStyle = '#7d8ea3';
  context.fillRect(-2.5, BODY_HEIGHT / 2 - 1, 5, 2);
}
