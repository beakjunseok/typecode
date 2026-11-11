// 휴대폰 던지기 아래쪽 장면: 책상(듀얼 모니터·키보드·소품) + 개발자(어깨 너머 뒷모습) + 게이밍 의자 등받이.
// 카메라는 개발자 뒤쪽 위: 멀리(위) 로봇 → 위험선 → 책상·모니터 → 개발자 → 의자 등받이(화면 맨 아래, 가장 가까움).
// 좌표 원점 = 개발자 위치(playerPosition). 그리기는 프레임마다 O(1)(코드 줄 수 고정).
import { roundedRect, easeOutBack, easeOutCubic, easeInOutSine } from './game-view.js';

// 피부: 어두운 남색 화면에서도 칙칙하지 않게 밝은 톤. shade는 윤곽·주름용으로 연하게
export const SKIN = Object.freeze({ base: '#ffd8bc', shade: '#efb894', light: '#fff1e6' });
const COLORS = Object.freeze({
  hoodie: '#2f4a63', hoodieLight: '#46698a', hoodieDark: '#203447',
  hair: '#161b28', hairLight: '#2a3346', skin: SKIN.base, skinShade: SKIN.shade,
  silver: '#c9d4e0', chair: '#141a23', chairLight: '#222b37', desk: '#1e2547', deskEdge: '#ffb547'
});
// 모니터 코드 줄: [들여쓰기, [폭, 색] …] — 문법 색(키워드 보라·함수 하늘·문자열 초록·숫자 주황)
const CODE_LINES = Object.freeze([
  [0, [12, '#c792ea'], [18, '#82aaff'], [6, '#89ddff']],
  [6, [10, '#c792ea'], [14, '#eeffff'], [16, '#c3e88d']],
  [6, [14, '#82aaff'], [8, '#f78c6c'], [6, '#89ddff']],
  [12, [8, '#c792ea'], [20, '#eeffff']],
  [6, [6, '#89ddff']],
  [0, [10, '#546e7a'], [22, '#546e7a']],
  [0, [12, '#c792ea'], [10, '#ffcb6b'], [12, '#82aaff']],
  [6, [16, '#eeffff'], [10, '#c3e88d']]
]);
// ---------- 던지기 동작 ----------
// 카메라는 개발자 뒤쪽 위. 화면 위 = 앞(목표 쪽), 화면 아래 = 카메라 쪽(뒤).
// 낱말을 칠수록 팔꿈치를 옆으로 어깨 높이까지 들고 휴대폰을 귀 뒤로 넘겨 '장전'(charge 0→1)
// → 마지막 글자에서 몸통 → 위팔 → 아래팔 순서로 채찍처럼 휘둘러 RELEASE 시점에 손을 떠남
// → 팔이 몸 앞을 가로질러 내려가 뒤에서는 몸에 가려지고(follow) → 몸 옆 아래로 돌아 나와 새 휴대폰을 쥐고(low)
// → 오른쪽 옆으로 들어 올려 준비 자세로 복귀(recover). 머리 위를 가로지르지 않는다. 시간은 게임 시계(초).
export const THROW_TIMING = Object.freeze({ release: 0.07, follow: 0.2, low: 0.32, recover: 0.6, newPhone: 0.3, newPhonePop: 0.16 });
// 자세 = 위팔 각도(조준 방향 기준 오프셋, rad) · 팔꿈치 굽힘(rad, +면 아래팔이 머리 쪽으로 접힘)
//      · 상체 기울기(rad, +는 목표 쪽으로) · 어깨 비틀기(+1 오른어깨가 뒤로, -1 앞으로)
const POSES = Object.freeze({
  ready: Object.freeze({ upper: 0.35, bend: 0.75, lean: 0, twist: 0 }),
  cocked: Object.freeze({ upper: 1.45, bend: 2.25, lean: -0.07, twist: 1 }),
  release: Object.freeze({ upper: -0.05, bend: 0.1, lean: 0.06, twist: -0.7 }),
  // 몸 앞을 가로질러 왼쪽 아래로: 뒤에서 보면 머리·몸통 뒤로 숨는다
  follow: Object.freeze({ upper: -1.02, bend: 1.27, lean: 0.1, twist: -1 }),
  // 몸 오른쪽 옆 아래(4시 방향). 같은 자세를 두 각도로 둔다: 따라 휘두르기에서 올 때는 반시계로(몸 뒤로) 돌아오고,
  // 준비 자세로 갈 때는 오른쪽 옆을 따라 올라간다(어느 쪽도 머리 위를 지나지 않음)
  low: Object.freeze({ upper: 2.17 - Math.PI * 2, bend: 1.7, lean: 0.03, twist: -0.3 }),
  lowRising: Object.freeze({ upper: 2.17, bend: 1.7, lean: 0.03, twist: -0.3 })
});
const JOINTS = Object.freeze(['upper', 'bend', 'lean', 'twist']);

function mixPose(from, to, amount) {
  const pose = {};
  for (const joint of JOINTS) pose[joint] = from[joint] + (to[joint] - from[joint]) * amount;
  return pose;
}

// 장전 정도(0~1)에 따른 자세: 처음엔 천천히, 끝으로 갈수록 크게 당긴다
export function chargePose(charge) {
  const amount = Math.max(0, Math.min(1, charge));
  return mixPose(POSES.ready, POSES.cocked, amount * amount * (3 - 2 * amount));
}

// 휘두르기(장전 → 놓기): 운동 사슬. 몸통이 먼저 돌고, 위팔이 따라가고, 아래팔은 늦게 출발해 마지막에 채찍처럼 펴진다
function whipPose(progress) {
  const { cocked, release } = POSES;
  const lerp = (joint, amount) => cocked[joint] + (release[joint] - cocked[joint]) * amount;
  return {
    upper: lerp('upper', progress ** 1.6),
    bend: lerp('bend', progress ** 2.6),
    lean: lerp('lean', easeOutCubic(progress)),
    twist: lerp('twist', easeOutCubic(progress))
  };
}

// 던진 뒤 경과 시간(sinceThrow)과 지금 장전 정도로 목표 자세를 정한다. O(1)
// held: 손에 든 휴대폰 크기(0 = 빈손), front: 1이면 팔을 몸 앞(카메라 쪽)에, 0이면 몸 뒤에 그린다
export function throwPose({ charge, sinceThrow }) {
  const timing = THROW_TIMING;
  const resting = chargePose(charge);
  if (!(sinceThrow >= 0) || sinceThrow >= timing.recover) return { ...resting, held: 1, released: true, front: 1 };
  let pose;
  let front = 1;
  if (sinceThrow < timing.release) {
    pose = whipPose(sinceThrow / timing.release);
  } else if (sinceThrow < timing.follow) {
    const progress = (sinceThrow - timing.release) / (timing.follow - timing.release);
    pose = mixPose(POSES.release, POSES.follow, easeOutCubic(progress));
    front = progress < 0.15 ? 1 : 0;
  } else if (sinceThrow < timing.low) {
    pose = mixPose(POSES.follow, POSES.low, easeInOutSine((sinceThrow - timing.follow) / (timing.low - timing.follow)));
    front = 0;
  } else {
    pose = mixPose(POSES.lowRising, resting, easeInOutSine((sinceThrow - timing.low) / (timing.recover - timing.low)));
  }
  const held = sinceThrow < timing.release ? 1
    : sinceThrow < timing.newPhone ? 0
      : easeOutBack(Math.min(1, (sinceThrow - timing.newPhone) / timing.newPhonePop));
  return { ...pose, held, released: sinceThrow >= timing.release, front };
}

// 책상 상판(원근 사다리꼴) + 듀얼 모니터 + RGB 키보드 + 커피·러버덕. 개발자보다 먼저(뒤에) 그린다
export function drawDeskSetup(context, { x, y, width, time, laptopMode, hurt, gameOver }) {
  const deskFar = y - 26;
  const deskNear = y - 10;
  const gradient = context.createLinearGradient(0, deskFar, 0, deskNear);
  gradient.addColorStop(0, '#161c3a');
  gradient.addColorStop(1, COLORS.desk);
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(width * 0.04, deskFar);
  context.lineTo(width * 0.96, deskFar);
  context.lineTo(width, deskNear);
  context.lineTo(0, deskNear);
  context.closePath();
  context.fill();
  context.fillStyle = 'rgba(255, 181, 71, 0.35)';
  context.fillRect(0, deskNear - 1, width, 1.5);
  context.fillStyle = '#090c1c';
  context.fillRect(0, deskNear + 0.5, width, 200);

  const monitorOffset = Math.min(122, width * 0.3);
  for (const side of [-1, 1]) {
    drawMonitor(context, { x: x + side * monitorOffset, bottom: deskFar + 8, side, time, laptopMode, hurt, gameOver });
  }
  drawKeyboard(context, x, deskNear - 6, time, gameOver);
  const mugX = x - monitorOffset - 46;
  const duckX = x + monitorOffset + 46;
  if (mugX > 14) drawMug(context, mugX, deskNear - 4, time);
  if (duckX < width - 14) drawRubberDuck(context, duckX, deskNear - 3, time);
}

// 모니터: 얇은 받침 + 화면. 평소엔 코드가 천천히 위로 흐르고, 노트북 모드는 보라 톤, 맞으면 빨간 글리치, 게임 오버면 FATAL
function drawMonitor(context, { x, bottom, side, time, laptopMode, hurt, gameOver }) {
  const width = 66;
  const height = 31;
  const top = bottom - height - 5;
  const left = x - width / 2;
  context.fillStyle = '#2a3442';
  context.fillRect(x - 2, top + height, 4, 5);
  roundedRect(context, x - 12, bottom - 2, 24, 3, 1.5);
  context.fill();
  context.fillStyle = '#070a0e';
  roundedRect(context, left, top, width, height, 3);
  context.fill();
  context.strokeStyle = '#2c3a4b';
  context.lineWidth = 1;
  context.stroke();

  const screenLeft = left + 3;
  const screenTop = top + 3;
  const screenWidth = width - 6;
  const screenHeight = height - 6;
  context.save();
  context.beginPath();
  context.rect(screenLeft, screenTop, screenWidth, screenHeight);
  context.clip();
  context.fillStyle = gameOver ? '#2a0b12' : laptopMode ? '#1d1430' : '#0c1622';
  context.fillRect(screenLeft, screenTop, screenWidth, screenHeight);
  if (gameOver) {
    context.fillStyle = '#ff4d6d';
    context.font = "800 10px 'JetBrains Mono', monospace";
    context.textAlign = 'center';
    context.fillText(side < 0 ? 'FATAL' : 'ERROR', x, screenTop + screenHeight / 2 + 3);
    context.textAlign = 'start';
  } else {
    const lineHeight = 5;
    const scroll = (time * 6 + (side > 0 ? 17 : 0)) % (CODE_LINES.length * lineHeight);
    for (let row = -1; row < screenHeight / lineHeight + 1; row++) {
      const lineIndex = ((row + Math.floor(scroll / lineHeight)) % CODE_LINES.length + CODE_LINES.length) % CODE_LINES.length;
      const [indent, ...tokens] = CODE_LINES[(lineIndex + (side > 0 ? 3 : 0)) % CODE_LINES.length];
      let cursorX = screenLeft + 4 + indent * 0.7;
      const lineY = screenTop + 3 + row * lineHeight - (scroll % lineHeight);
      for (const [tokenWidth, color] of tokens) {
        context.fillStyle = laptopMode && color !== '#546e7a' ? '#c792ea' : color;
        context.globalAlpha = 0.75;
        context.fillRect(cursorX, lineY, tokenWidth * 0.8, 2);
        cursorX += tokenWidth * 0.8 + 2;
      }
    }
    context.globalAlpha = 1;
    if (Math.sin(time * 6) > 0) {
      context.fillStyle = '#eeffff';
      context.fillRect(screenLeft + 30, screenTop + screenHeight - 7, 3, 4);
    }
  }
  if (hurt > 2) {
    context.globalAlpha = Math.min(0.55, hurt / 40);
    context.fillStyle = '#ff4d6d';
    context.fillRect(screenLeft, screenTop, screenWidth, screenHeight);
    context.globalAlpha = 1;
    for (let band = 0; band < 3; band++) {
      const bandY = screenTop + ((time * 90 + band * 13) % screenHeight);
      context.fillStyle = 'rgba(255, 255, 255, 0.35)';
      context.fillRect(screenLeft, bandY, screenWidth, 1.5);
    }
  }
  context.restore();
  // 화면 빛이 책상에 비침
  context.globalAlpha = 0.12;
  context.fillStyle = gameOver ? '#ff4d6d' : laptopMode ? '#c792ea' : '#36e2ff';
  context.beginPath();
  context.ellipse(x, bottom + 2, width * 0.45, 4, 0, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
}

// RGB 키보드: 무지개 빛이 흐른다(대부분 개발자 몸에 가려지고 양 끝이 보임)
function drawKeyboard(context, x, y, time, gameOver) {
  const width = 78;
  context.fillStyle = '#0b0f14';
  roundedRect(context, x - width / 2, y - 4, width, 7, 2);
  context.fill();
  const segments = 13;
  for (let index = 0; index < segments; index++) {
    const hue = gameOver ? 350 : (index * 28 + time * 90) % 360;
    context.fillStyle = `hsla(${hue}, 90%, 60%, ${gameOver ? 0.35 : 0.7})`;
    context.fillRect(x - width / 2 + 3 + index * ((width - 6) / segments), y - 2, (width - 6) / segments - 1.5, 3);
  }
}

function drawMug(context, x, y, time) {
  context.fillStyle = '#e0e6ee';
  roundedRect(context, x - 6, y - 10, 12, 11, 2);
  context.fill();
  context.strokeStyle = '#e0e6ee';
  context.lineWidth = 2;
  context.beginPath();
  context.arc(x + 7, y - 5, 3, -Math.PI / 2, Math.PI / 2);
  context.stroke();
  context.fillStyle = '#36e2ff';
  context.fillRect(x - 6, y - 7, 12, 2);
  context.strokeStyle = 'rgba(220, 230, 240, 0.35)';
  context.lineWidth = 1.2;
  for (const offset of [-2, 2]) {
    const sway = Math.sin(time * 2 + offset) * 2;
    context.beginPath();
    context.moveTo(x + offset, y - 12);
    context.quadraticCurveTo(x + offset + sway, y - 17, x + offset - sway, y - 22);
    context.stroke();
  }
}

// 러버덕 디버깅용 오리: 가끔 고개를 까딱
function drawRubberDuck(context, x, y, time) {
  const nod = Math.sin(time * 1.3) > 0.92 ? 0.25 : 0;
  context.fillStyle = '#ffcb47';
  context.beginPath();
  context.ellipse(x, y - 5, 8, 5.5, 0, 0, Math.PI * 2);
  context.fill();
  context.save();
  context.translate(x - 4, y - 11);
  context.rotate(-nod);
  context.beginPath();
  context.arc(0, 0, 4.5, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ff8a3d';
  context.beginPath();
  context.moveTo(-4, -0.5);
  context.lineTo(-8, 0.8);
  context.lineTo(-4, 2);
  context.closePath();
  context.fill();
  context.fillStyle = '#10151d';
  context.beginPath();
  context.arc(-1.5, -1.2, 0.9, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

// 개발자 + 의자 등받이 + 던지는 팔. 손 위치(투사체 출발점)를 돌려준다.
// aim: -0.55~0.55 (목표 열 방향). pose: throwPose를 부드럽게 따라간 값 { upper, bend, lean, twist, held, front }.
// motion: 살아 있는 느낌을 내는 값들 — keyPulse(키를 칠 때 튀는 스프링), keySide(번갈아 치는 손가락 쪽 -1/1),
//   typing(최근 타자 활동 0~1), tension(로봇이 가까울수록 0→1), recoil(맞았을 때 뒤로 젖혀지는 스프링), slump(게임 오버 후 0→1)
// trail: 최근 손 위치(휘두르는 잔상)
export function drawDeveloper(context, {
  x, y, time, aim, pose, trail = [], hurt, lives, gameOver, laptopMode, drawHeld, scale = 1, motion = {}
}) {
  const { keyPulse = 0, keySide = 1, typing = 0, tension = 0, recoil = 0, slump: slumpAmount = gameOver ? 1 : 0 } = motion;
  const slump = easeOutCubic(Math.min(1, slumpAmount));
  // 숨쉬기: 긴장하면 빨라지고 얕아진다. 어깨·머리가 함께 오르내린다
  const breathRate = 1.6 + tension * 1.6;
  const breath = Math.sin(time * breathRate) * (1 - slump * 0.6);
  const rise = breath * (0.9 - tension * 0.3);
  const shake = Math.sin(hurt) * hurt * 0.2;
  const lookSide = aim >= 0 ? 1 : -1;
  // 상체 기울기 = 던지기 + 긴장(앞으로) + 맞음(뒤로 젖힘) + 게임 오버(앞으로 푹)
  const lean = pose.lean * (1 - slump) + tension * 0.035 - recoil * 0.004 + slump * 0.12;
  const twist = pose.twist * (1 - slump);
  drawSwoosh(context, trail, laptopMode);
  context.save();
  context.translate(x + shake, y);
  context.scale(scale, scale);
  // 상체 기울기: 의자 쪽(아래) 축을 중심으로 목표 쪽 앞뒤로 젖힘. 의자는 기울지 않는다
  const leanUpperBody = () => {
    context.translate(0, 14);
    context.rotate(lean * lookSide);
    context.translate(0, -14);
  };
  // 머리: 목표 쪽으로 돌리되 어깨 비틀림과 반대로 조금 버티고(시선 고정), 키를 칠 때마다 살짝 끄덕
  const idleLook = Math.sin(time * 0.53) * 0.8 + Math.sin(time * 1.31) * 0.4;
  const headX = aim * 5 - twist * 1.5 + idleLook * (1 - typing) * (1 - slump);
  const headY = -30 - rise * 0.8 - keyPulse * 0.5 + slump * 8 - tension * 1.2;
  const headTilt = aim * 0.08 + Math.sin(time * 0.71) * 0.03 * (1 - typing) - recoil * 0.002 * lookSide;
  const behind = pose.front < 0.5 && !gameOver;
  // 소매(팔)는 몸통보다 먼저 그려 어깨에서 자연스럽게 나오게 한다(이음선 없음).
  // 손·휴대폰은 머리·의자 뒤에 그려 귀 뒤로 넘긴 휴대폰이 머리 앞(카메라 쪽)에 보이게 한다
  const armGeometry = throwingArmGeometry({ aim, pose, twist, rise, gameOver, slump });
  const typingHand = typingHandPosition({ time, keyPulse, keySide, typing, rise, slump, gameOver });
  context.save();
  leanUpperBody();
  drawTypingSleeve(context, typingHand, rise);
  drawThrowingSleeve(context, armGeometry);
  drawTorso(context, { rise, twist });
  drawKeyboardHand(context, typingHand.x, typingHand.y, { press: typingHand.press, keySide, relaxed: gameOver });
  drawHead(context, { headX, headY, headTilt, lookSide, time, armSwing: (pose.upper - POSES.ready.upper) * -25 + keyPulse * 4, lives, laptopMode, gameOver, rise, twist });
  context.restore();
  drawChairBack(context, time, lives);
  context.save();
  leanUpperBody();
  // 따라 휘두르는 동안(팔이 몸 앞으로 넘어감)은 손이 몸에 가려 보이지 않는다
  const hand = behind ? armGeometry.hand : drawThrowingHand(context, armGeometry, { aim, pose, gameOver, laptopMode, drawHeld });
  drawReaction(context, { headX, headY, hurt, lives, time, gameOver });
  context.restore();
  context.restore();
  // 손 좌표 → 화면 좌표: 위와 같은 변환(이동 · 크기 · 의자 축 기준 회전)을 직접 적용
  const angle = lean * lookSide;
  const pivotY = 14;
  const rotatedX = Math.cos(angle) * hand.x - Math.sin(angle) * (hand.y - pivotY);
  const rotatedY = Math.sin(angle) * hand.x + Math.cos(angle) * (hand.y - pivotY) + pivotY;
  return { x: x + shake + rotatedX * scale, y: y + rotatedY * scale };
}

// 왼손 위치: 키를 칠 때마다 손끝이 톡 내려가고(keyPulse), 번갈아 옆 키로 조금씩 옮겨 간다.
// 한동안 안 치면 손목을 내려 쉬고, 게임 오버면 축 늘어진다
function typingHandPosition({ time, keyPulse, keySide, typing, rise, slump, gameOver }) {
  if (gameOver) return { x: -26 + slump, y: -15 + slump * 8, press: 0 };
  const resting = { x: -27, y: -14 };
  const hover = { x: -28.5 + keySide * 1.6, y: -17.5 };
  const active = Math.min(1, typing);
  const press = Math.max(0, keyPulse) * 0.9;
  return {
    x: resting.x + (hover.x - resting.x) * active,
    y: resting.y + (hover.y - resting.y) * active + press - rise * 0.4 + Math.sin(time * 0.9) * 0.4 * (1 - active),
    press
  };
}

// 왼팔 소매: 몸통 안(어깨)에서 시작해 손목까지 한 줄. 몸통이 위에 덮여 어깨 이음선이 생기지 않는다
function drawTypingSleeve(context, hand, rise) {
  context.lineCap = 'round';
  context.strokeStyle = COLORS.hoodie;
  context.lineWidth = 7;
  context.beginPath();
  context.moveTo(-16, -9 - rise * 0.5);
  context.quadraticCurveTo(-26, -9, hand.x + 1.5, hand.y + 3);
  context.stroke();
}

// 키보드 위 왼손(뒤 위에서 본 손등): 손가락 넷이 앞(화면 위)으로 뻗어 키에 얹히고, 엄지는 안쪽(오른쪽)으로.
// 키를 누르면 번갈아 검지·중지가 아래로 눌려 짧아 보인다
function drawKeyboardHand(context, x, y, { press, keySide, relaxed }) {
  context.save();
  context.translate(x, y);
  context.rotate(relaxed ? 0.5 : 0.62);
  // 새끼 → 검지(왼손이라 바깥쪽이 왼편). 키 위에 말려 있어 위에서 보면 짧고 서로 붙어 있다. [가로 위치, 길이]
  const fingers = [[-2.4, 1.3], [-0.8, 1.7], [0.8, 1.8], [2.4, 1.55]];
  const pressedIndex = keySide > 0 ? 3 : 2;
  fingers.forEach(([offsetX, length], index) => {
    const shorten = index === pressedIndex ? Math.min(0.9, press * 0.5) : 0;
    const fingerLength = (relaxed ? length * 0.6 : length) - shorten;
    context.fillStyle = SKIN.base;
    roundedRect(context, offsetX - 0.86, -1.4 - fingerLength, 1.72, fingerLength + 1.4, 0.86);
    context.fill();
    // 말린 손가락 끝(그늘)
    context.globalAlpha = 0.5;
    context.fillStyle = SKIN.shade;
    roundedRect(context, offsetX - 0.86, -1.4 - fingerLength, 1.72, 0.9, 0.45);
    context.fill();
    context.globalAlpha = 1;
  });
  // 손등
  context.fillStyle = SKIN.base;
  roundedRect(context, -3.5, -2, 7, 4.4, 2);
  context.fill();
  context.fillStyle = SKIN.light;
  context.beginPath();
  context.ellipse(-0.6, -0.3, 1.8, 0.9, -0.1, 0, Math.PI * 2);
  context.fill();
  // 엄지: 손등 안쪽(오른쪽)에서 비스듬히 스페이스바 쪽으로 — 손등 위에 그려 다섯 손가락이 다 보이게
  context.save();
  context.translate(3, 0.6);
  context.rotate(0.85);
  context.fillStyle = SKIN.base;
  roundedRect(context, -0.85, -3.6, 1.7, 3.9, 0.85);
  context.fill();
  context.fillStyle = SKIN.shade;
  roundedRect(context, -0.65, -3.6, 1.3, 0.9, 0.45);
  context.fill();
  context.restore();
  context.restore();
}

// 몸통(후드티 뒷모습): 어깨가 머리 폭의 약 1.9배인 사다리꼴 + 둥근 어깨. 윤곽선 없이 한 실루엣으로 칠하고
// 입체는 반투명 면으로만(가운데 등 그늘, 어깨 빛). 숨 쉴 때 어깨선이 오르내리고(rise),
// 비틀면 오른쪽 어깨가 앞(위)·뒤(아래)로 움직인다(twist)
function drawTorso(context, { rise = 0, twist = 0 } = {}) {
  const shoulderY = -15 - rise;
  const rightDrop = twist * 2.5;
  const leftY = shoulderY - rightDrop * 0.4;
  const rightY = shoulderY + rightDrop;
  const rightEdge = 25 - Math.abs(twist) * 1.5;
  const gradient = context.createLinearGradient(0, shoulderY, 0, 14);
  gradient.addColorStop(0, COLORS.hoodieLight);
  gradient.addColorStop(1, COLORS.hoodie);
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(-24, 16);
  context.bezierCurveTo(-25.5, 4, -26.5, leftY + 6, -21, leftY + 1.2);
  context.quadraticCurveTo(-16, leftY - 1.2, -8, leftY - 0.4);
  context.quadraticCurveTo(0, (leftY + rightY) / 2 + 1.4, 8, rightY - 0.4);
  context.quadraticCurveTo(16, rightY - 1.2, rightEdge - 4, rightY + 1.2);
  context.bezierCurveTo(rightEdge + 1.5, rightY + 6, rightEdge + 0.5, 4, rightEdge - 1, 16);
  context.closePath();
  context.fill();
  // 등 가운데 그늘(척추 쪽으로 살짝 들어감) — 선 대신 반투명 면
  const spine = context.createRadialGradient(0, 8, 2, 0, 8, 20);
  spine.addColorStop(0, 'rgba(18, 30, 44, 0.32)');
  spine.addColorStop(1, 'rgba(18, 30, 44, 0)');
  context.fillStyle = spine;
  context.fillRect(-24, shoulderY, 48, 32);
  // 어깨 빛
  context.fillStyle = 'rgba(255, 255, 255, 0.05)';
  context.beginPath();
  context.ellipse(-15, leftY + 3, 7, 2.6, -0.15, 0, Math.PI * 2);
  context.ellipse(15, rightY + 3, 7, 2.6, 0.15, 0, Math.PI * 2);
  context.fill();
}

// 목이 옷깃 속으로 들어가는 곳의 부드러운 그늘(선·덩어리 없이 반투명 면 하나)
function drawCollarShadow(context, { rise }) {
  const y = -15 - rise + 1.5;
  const shade = context.createRadialGradient(0, y, 1, 0, y, 11);
  shade.addColorStop(0, 'rgba(18, 30, 44, 0.45)');
  shade.addColorStop(1, 'rgba(18, 30, 44, 0)');
  context.fillStyle = shade;
  context.beginPath();
  context.ellipse(0, y + 1, 11, 5, 0, 0, Math.PI * 2);
  context.fill();
}

// 머리(뒷모습): 짧은 목(가운데) + 양쪽 귀 + 뒤통수 머리 실루엣(결은 밝은 면으로만) + 바보털 + 헤드폰
function drawHead(context, { headX, headY, headTilt = 0, lookSide, time, armSwing, lives, laptopMode, gameOver, rise = 0, twist = 0 }) {
  // 목: 양 어깨 가운데, 앉아 몸을 숙인 자세라 짧게. 아래는 옷깃 속으로 들어간다
  drawCollarShadow(context, { rise });
  context.fillStyle = COLORS.skinShade;
  roundedRect(context, headX * 0.6 - 4.5, headY + 6, 9, -15 - rise - headY - 4.5, 3.5);
  context.fill();
  // 고개 기울임: 목 밑동을 축으로 돌린다
  context.save();
  context.translate(headX, headY + 12);
  context.rotate(headTilt);
  context.translate(-headX, -(headY + 12));
  // 양쪽 귀(작은 반원, 대부분 헤드폰 컵 아래)
  context.fillStyle = COLORS.skin;
  for (const side of [-1, 1]) {
    context.beginPath();
    context.ellipse(headX + side * 12, headY + 4.5, 2.4, 3.6, 0, 0, Math.PI * 2);
    context.fill();
  }
  // 머리카락(뒤통수): 한 덩어리 실루엣 + 위쪽 삐침 + 뒷목 쪽 머리끝 + 밝은 결 면(선 없음)
  context.fillStyle = COLORS.hair;
  context.beginPath();
  context.ellipse(headX - lookSide * 1.5, headY - 1, 12.5, 12.5, 0, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  for (const [offsetX, offsetY, size] of [[-9, -8, 5], [-3, -12, 6], [4, -11, 5.5], [10, -6, 4.5]]) {
    context.moveTo(headX + offsetX - size, headY + offsetY + 3);
    context.lineTo(headX + offsetX, headY + offsetY - size * 0.6);
    context.lineTo(headX + offsetX + size, headY + offsetY + 3);
  }
  context.fill();
  // 뒷머리 끝: 목덜미 위로 내려오는 머리 다발 다섯(끝이 둥근 뾰족)
  const hairX = headX - lookSide * 1.5;
  context.beginPath();
  for (const [offsetX, length] of [[-9, 2.6], [-4.6, 4], [0, 4.6], [4.6, 4], [9, 2.6]]) {
    context.moveTo(hairX + offsetX - 3.4, headY + 7);
    context.quadraticCurveTo(hairX + offsetX - 1, headY + 10.5 + length * 0.4, hairX + offsetX + 0.3, headY + 10.5 + length * 0.6);
    context.quadraticCurveTo(hairX + offsetX + 1.2, headY + 10.5, hairX + offsetX + 3.4, headY + 7);
  }
  context.fill();
  // 머릿결 빛: 정수리 둘레를 따라 휘어지는 초승달 띠(선이 아니라 면)
  const sheen = (start, end, inset, alpha) => {
    context.globalAlpha = alpha;
    context.fillStyle = COLORS.hairLight;
    context.beginPath();
    context.arc(hairX, headY - 1, 12.5 - inset, start, end);
    context.arc(hairX + 0.6, headY + 0.8, 12.5 - inset - 2, end, start, true);
    context.closePath();
    context.fill();
  };
  sheen(Math.PI * 1.12, Math.PI * 1.5, 1.6, 0.9);
  sheen(Math.PI * 1.58, Math.PI * 1.8, 1.6, 0.5);
  context.globalAlpha = 1;
  // 바보털: 끝이 뾰족한 면으로(선 아님), 던질 때·평소에 살랑
  const sway = Math.sin(time * 3) * 2 + armSwing * 0.08;
  context.fillStyle = COLORS.hair;
  context.beginPath();
  context.moveTo(headX - 0.6, headY - 11.5);
  context.quadraticCurveTo(headX + 2 + sway, headY - 21, headX + 8.5 + sway, headY - 19.5);
  context.quadraticCurveTo(headX + 4 + sway, headY - 17.5, headX + 2.6, headY - 11.5);
  context.closePath();
  context.fill();
  // 헤드폰: 은색 밴드 + 양쪽 컵(빛나는 링). 평소 하늘색, 노트북 모드 보라, 마지막 생명 빨강
  const glow = gameOver ? '#3a4656' : lives <= 1 ? '#ff4d6d' : laptopMode ? '#c792ea' : '#36e2ff';
  context.strokeStyle = COLORS.silver;
  context.lineWidth = 3;
  context.beginPath();
  context.arc(headX, headY + 1, 14, Math.PI * 1.08, Math.PI * 1.92);
  context.stroke();
  for (const side of [-1, 1]) {
    const cupX = headX + side * 13.5;
    context.fillStyle = '#1a222d';
    roundedRect(context, cupX - 3.5, headY - 4, 7, 12, 3);
    context.fill();
    context.fillStyle = glow;
    context.globalAlpha = gameOver ? 0.6 : 0.7 + 0.3 * Math.sin(time * 4 + side);
    context.shadowColor = glow;
    context.shadowBlur = gameOver ? 0 : 8;
    roundedRect(context, cupX - 1.2, headY - 1.5, 2.4, 7, 1.2);
    context.fill();
    context.shadowBlur = 0;
    context.globalAlpha = 1;
  }
  context.restore();
}

// 게이밍 의자 등받이(가장 앞): 몸 아래쪽을 가리고, 하늘색 파이핑 + 등판 로고 </>. 마지막 생명이면 파이핑이 빨갛게 깜빡
function drawChairBack(context, time, lives) {
  const gradient = context.createLinearGradient(0, -4, 0, 56);
  gradient.addColorStop(0, COLORS.chairLight);
  gradient.addColorStop(1, COLORS.chair);
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(-31, 56);
  context.lineTo(-33, 6);
  context.quadraticCurveTo(-33, -5, -22, -5);
  context.lineTo(22, -5);
  context.quadraticCurveTo(33, -5, 33, 6);
  context.lineTo(31, 56);
  context.closePath();
  context.fill();
  const danger = lives <= 1 && Math.sin(time * 6) > 0;
  context.strokeStyle = danger ? 'rgba(255, 77, 109, 0.85)' : 'rgba(54, 226, 255, 0.55)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(-26, 56);
  context.lineTo(-27, 7);
  context.quadraticCurveTo(-27, 0, -20, 0);
  context.lineTo(20, 0);
  context.quadraticCurveTo(27, 0, 27, 7);
  context.lineTo(26, 56);
  context.stroke();
  context.fillStyle = danger ? '#ff4d6d' : '#36e2ff';
  context.globalAlpha = 0.8;
  context.font = "800 11px 'JetBrains Mono', monospace";
  context.textAlign = 'center';
  context.fillText('</>', 0, 24);
  context.textAlign = 'start';
  context.globalAlpha = 1;
}

// 던지는 오른팔 관절 위치(어깨 → 팔꿈치 → 손목). pose.upper는 조준 방향 기준 오프셋, pose.bend는 팔꿈치 굽힘.
// 어깨는 비틀면 앞(위)·뒤(아래)로, 원근 때문에 몸 쪽으로 붙어 보인다
function throwingArmGeometry({ aim, pose, twist = 0, rise = 0, gameOver, slump = 1 }) {
  const shoulder = { x: 17 - Math.abs(twist) * 2, y: -10 + twist * 3 - rise };
  const upperLength = 15;
  const foreLength = 14;
  const aimAngle = -Math.PI / 2 + aim * 0.75;
  // 게임 오버: 들고 있던 팔이 천천히 아래로 떨어진다
  const droop = gameOver ? easeOutCubic(Math.min(1, slump)) : 0;
  const upperAngle = aimAngle + pose.upper + (0.35 * Math.PI - aimAngle - pose.upper) * droop;
  const bend = pose.bend + (0.6 - pose.bend) * droop;
  const elbow = { x: shoulder.x + Math.cos(upperAngle) * upperLength, y: shoulder.y + Math.sin(upperAngle) * upperLength };
  const foreAngle = upperAngle - bend;
  const hand = { x: elbow.x + Math.cos(foreAngle) * foreLength, y: elbow.y + Math.sin(foreAngle) * foreLength };
  // 귀 뒤로 넘길수록 휴대폰이 카메라에 가까워져 조금 커 보인다
  return { shoulder, elbow, hand, foreAngle, droop, nearness: 1 + 0.16 * Math.max(0, twist) };
}

// 던지는 팔 소매: 몸통보다 먼저(아래에) 그려 어깨에서 이음선 없이 나온다
function drawThrowingSleeve(context, { shoulder, elbow, hand }) {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = COLORS.hoodie;
  context.lineWidth = 7.5;
  context.beginPath();
  context.moveTo(shoulder.x - 3, shoulder.y + 2);
  context.lineTo(elbow.x, elbow.y);
  context.lineTo(hand.x, hand.y);
  context.stroke();
}

// 손목 소맷부리 + 손(휴대폰). 투사체 출발점(휴대폰 중심 또는 손)을 돌려준다
function drawThrowingHand(context, { hand, foreAngle, droop, nearness }, { aim, pose, gameOver, laptopMode, drawHeld }) {
  const directionX = Math.cos(foreAngle);
  const directionY = Math.sin(foreAngle);
  const holding = gameOver || pose.held > 0.01;
  const phoneGrip = !laptopMode && (gameOver || pose.held > 0.6);
  if (laptopMode || !phoneGrip) {
    if (holding) drawHeld(context, hand.x + directionX * GRIP_OFFSET, hand.y + directionY * GRIP_OFFSET, foreAngle + Math.PI / 2, pose.held * nearness, laptopMode, false);
    drawHand(context, hand, foreAngle, holding);
    return hand;
  }
  // 손목 관절: 팔(소매)은 손목에서 끝나고 소맷부리를 두른다. 손은 손목을 축으로 휴대폰이 대체로 서 있도록 꺾이되
  // 실제 손목처럼 팔 방향에서 ±WRIST_LIMIT 안에서만 꺾인다(휴대폰이 팔에 붙어 같이 돌아가지 않게)
  drawCuff(context, hand, foreAngle);
  // 휴대폰은 대체로 서 있되 위쪽이 살짝 오른쪽으로 기운다(손이 왼쪽 아래 모서리를 받쳐 쥐므로)
  const upright = -Math.PI / 2 + aim * 0.5 + 0.16;
  const wanted = Math.atan2(Math.sin(upright - foreAngle), Math.cos(upright - foreAngle));
  const handAngle = gameOver && droop > 0.95
    ? foreAngle + 0.35
    : foreAngle + Math.max(-WRIST_LIMIT, Math.min(WRIST_LIMIT, wanted));
  // 휴대폰 좌표의 손목 점(WRIST_IN_PHONE)이 팔 끝(hand)에 오도록 휴대폰 중심을 잡는다
  const phoneAngle = handAngle + Math.PI / 2;
  const scale = PHONE_HELD_SCALE * (gameOver ? 1 : pose.held * nearness);
  const localX = WRIST_IN_PHONE.x * scale;
  const localY = WRIST_IN_PHONE.y * scale;
  const center = {
    x: hand.x - (localX * Math.cos(phoneAngle) - localY * Math.sin(phoneAngle)),
    y: hand.y - (localX * Math.sin(phoneAngle) + localY * Math.cos(phoneAngle))
  };
  drawHeld(context, center.x, center.y, phoneAngle, gameOver ? 1 : pose.held * nearness, false, true);
  return center;
}

// 소맷부리: 팔 끝(손목)에 두르는 후드 소매 끝단
function drawCuff(context, wrist, foreAngle) {
  context.save();
  context.translate(wrist.x, wrist.y);
  context.rotate(foreAngle);
  context.fillStyle = COLORS.hoodieLight;
  roundedRect(context, -4.6, -4.6, 5.4, 9.2, 2.6);
  context.fill();
  context.restore();
}

// 휴대폰을 쥐지 않은 손: 가볍게 쥔 주먹(손등 + 손가락 마디 줄). holding이면(노트북) 손가락을 앞으로 말아 쥔다
const GRIP_OFFSET = 9;
// 쥔 휴대폰 배율(throw-view의 휴대폰 그리기와 같은 값), 휴대폰 좌표계에서 손목 점(엄지 쪽 아래), 손목이 꺾일 수 있는 한도(rad)
export const PHONE_HELD_SCALE = 1.45;
const WRIST_IN_PHONE = Object.freeze({ x: -3.6, y: 13.6 });
const WRIST_LIMIT = 0.7;
function drawHand(context, hand, foreAngle, holding) {
  context.save();
  context.translate(hand.x, hand.y);
  context.rotate(foreAngle);
  context.fillStyle = SKIN.base;
  roundedRect(context, -3.2, -3.6, holding ? 7.4 : 6.6, 7.2, 3);
  context.fill();
  context.fillStyle = SKIN.shade;
  roundedRect(context, holding ? 2.6 : 1.8, -3.4, 1.8, 6.8, 0.9);
  context.fill();
  context.strokeStyle = 'rgba(214, 150, 112, 0.5)';
  context.lineWidth = 0.6;
  for (const offset of [-1.7, 0, 1.7]) {
    context.beginPath();
    context.moveTo(holding ? 2.8 : 2, offset);
    context.lineTo(holding ? 4.2 : 3.4, offset);
    context.stroke();
  }
  context.restore();
}

// 휘두르는 잔상: 최근 손 위치를 이어 끝으로 갈수록 굵고 진하게(화면 좌표)
function drawSwoosh(context, trail, laptopMode) {
  if (trail.length < 3) return;
  context.lineCap = 'round';
  for (let index = 1; index < trail.length; index++) {
    const amount = index / (trail.length - 1);
    context.strokeStyle = laptopMode ? `rgba(199, 146, 234, ${0.35 * amount})` : `rgba(210, 240, 255, ${0.35 * amount})`;
    context.lineWidth = 2 + amount * 5;
    context.beginPath();
    context.moveTo(trail[index - 1].x, trail[index - 1].y);
    context.lineTo(trail[index].x, trail[index].y);
    context.stroke();
  }
}

// 반응: 맞으면 머리 위 '!', 마지막 생명이면 땀방울, 게임 오버면 머리 위 회색 구름
function drawReaction(context, { headX, headY, hurt, lives, time, gameOver }) {
  if (gameOver) {
    context.fillStyle = 'rgba(138, 152, 170, 0.6)';
    for (const [offsetX, radius] of [[-5, 4], [0, 5], [5, 4]]) {
      context.beginPath();
      context.arc(headX + offsetX, headY - 26 + Math.sin(time * 2) * 1, radius, 0, Math.PI * 2);
      context.fill();
    }
    return;
  }
  if (hurt > 4) {
    context.fillStyle = '#ff4d6d';
    context.font = "900 16px 'JetBrains Mono', monospace";
    context.textAlign = 'center';
    context.fillText('!', headX + 14, headY - 16 - Math.min(6, hurt * 0.2));
    context.textAlign = 'start';
  }
  if (lives <= 1) {
    const cycle = (time * 0.8) % 1;
    context.globalAlpha = 1 - cycle;
    context.fillStyle = '#7fdbff';
    const dropX = headX - 12;
    const dropY = headY - 8 + cycle * 10;
    context.beginPath();
    context.moveTo(dropX, dropY - 4);
    context.quadraticCurveTo(dropX + 3, dropY, dropX, dropY + 2);
    context.quadraticCurveTo(dropX - 3, dropY, dropX, dropY - 4);
    context.fill();
    context.globalAlpha = 1;
  }
}
