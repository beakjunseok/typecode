// 진입점: 모드(연습 · 휴대폰 던지기 · 에러 구조 SOS)를 고르고, 엔진 이벤트를 화면·효과음·키보드·서버 호출에 연결한다.
import { TypingEngine, DURATIONS } from './engine.js';
import { LANGUAGES, getTokenPool } from './tokens.js';
import { ThrowEngine, ROBOT_TYPES } from './throw-engine.js';
import { BatteryEngine } from './battery-engine.js';
import { DIFFICULTY_LEVELS } from './target-game.js';
import { ThrowRenderer } from './throw-view.js';
import { BatteryRenderer } from './battery-view.js';
import { createInputDiffer, INPUT_SENTINEL } from './input.js';
import { SoundEngine } from './audio.js';
import { BgmEngine } from './bgm.js';
import { emitSparks, pulseClass } from './effects.js';
import { createKeyboard } from './keyboard.js';
import { requestSession, submitScore, fetchBoard, localBoard, preferences } from './api.js';
import { createUi, TIER_COLORS } from './ui.js';
import { getWeekLabel } from './week.js';

const TICK_INTERVAL_MS = 100;
const NARROW_WIDTH = 520;
const IME_WARNING_INTERVAL_MS = 4000;

const MODE_CONFIG = Object.freeze({
  practice: { label: '연습', arcade: false },
  throw: {
    label: '휴대폰 던지기', arcade: true, title: 'phone-throw.exe', resultTitle: 'GAME OVER',
    hint: '로봇 발밑 낱말을 다 치면 휴대폰 발사 · 🔋 건전지로 생명 회복', Renderer: ThrowRenderer,
    // 좁은 세로 화면: 레인 3개, 토큰 14자 이하(라벨이 열 너비를 넘지 않게)
    createEngine: options => new ThrowEngine({
      ...options, lanes: options.narrow ? 3 : 4, maxTokenLength: options.narrow ? 14 : 22
    })
  },
  battery: {
    label: '배터리 구조 SOS', arcade: true, title: 'battery-rescue.sh', resultTitle: 'BATTERY REPORT',
    hint: '지나가는 셀 낱말로 충전 · 방전봇 탑 낱말로 공격', Renderer: BatteryRenderer,
    createEngine: options => new BatteryEngine({ ...options, maxTokenLength: options.narrow ? 14 : 18 })
  }
});

const ui = createUi(document);
const sound = new SoundEngine();
const bgm = new BgmEngine(sound);
const keyboard = createKeyboard(ui.elements.keyboardSection);
const renderers = {};
const savedMode = preferences.get('mode', 'practice') === 'rescue' ? 'battery' : preferences.get('mode', 'practice');
const settings = {
  mode: MODE_CONFIG[savedMode] ? savedMode : 'practice',
  languageKey: LANGUAGES[preferences.get('lang', 'javascript')] ? preferences.get('lang', 'javascript') : 'javascript',
  durationSeconds: DURATIONS.includes(preferences.get('duration', 60)) ? preferences.get('duration', 60) : 60,
  level: DIFFICULTY_LEVELS[preferences.get('level', 2)] ? Number(preferences.get('level', 2)) : 2,
  keyboardVisible: preferences.get('keyboard', true) !== false
};
const run = { engine: null, generation: 0, sessionPromise: null, submitted: false, tickId: null, frameId: null, highlightId: null, lastTier: 0, powerActive: false, lastImeWarning: 0 };
const now = () => performance.now();
const modeConfig = () => MODE_CONFIG[settings.mode];
const isArcade = () => modeConfig().arcade;

function visible(character) {
  return { ' ': '␣', '\n': '↵', '\t': '⇥' }[character] ?? character;
}

// ---------- 연습 모드 이벤트 ----------
function handlePracticeEvent(type, payload) {
  switch (type) {
    case 'start':
      run.sessionPromise = startSession(run.generation);
      sound.play('gameStart');
      ui.log('sys', `run started · ${LANGUAGES[settings.languageKey].label} · ${settings.durationSeconds}s`);
      break;
    case 'keystroke':
      sound.play('key');
      break;
    case 'backspace':
      sound.play('erase');
      break;
    case 'mistake':
      sound.play('keyWrong');
      sound.play('error');
      pulseClass(ui.elements.stage, 'shake', 200);
      if (payload.comboLost >= 5) ui.log('warn', `combo ${payload.comboLost} dropped`);
      ui.log('err', `SyntaxError: unexpected '${visible(payload.typed)}' in '${payload.token.text}' — expected '${visible(payload.expected)}' (#${payload.tokenNumber}:${payload.position + 1})`);
      break;
    case 'token':
      handlePracticeToken(payload);
      break;
    case 'warning':
      sound.play('warning', payload);
      break;
    case 'finish':
      handleFinish(payload.summary);
      break;
    default:
      break;
  }
}

function handlePracticeToken({ clean, combo, tier, tierUp, milestone }) {
  sound.play('key');
  bgm.setIntensity(tier);
  if (tierUp) {
    sound.play('tierUp', { tier });
    emitSparks(ui.elements.currentView, { color: TIER_COLORS[tier], count: 22, distance: 110 });
    pulseClass(ui.elements.stage, 'tier-flash', 600);
    ui.log('info', `combo ${combo} → multiplier ×${tier === 2 ? '2.0' : '1.5'}`);
  } else if (milestone) {
    sound.play('milestone');
    emitSparks(ui.elements.currentView, { color: TIER_COLORS[tier] });
  } else {
    sound.play(clean ? 'token' : 'tokenDirty', { combo });
  }
}

// ---------- 아케이드 모드 이벤트 ----------
function handleArcadeEvent(type, payload) {
  const renderer = renderers[settings.mode];
  renderer?.onEvent(type, payload, run.engine);
  const battery = settings.mode === 'battery';
  switch (type) {
    case 'start':
      run.sessionPromise = startSession(run.generation);
      sound.play('gameStart');
      ui.log('sys', `${modeConfig().label} started · ${LANGUAGES[settings.languageKey].label} · ${DIFFICULTY_LEVELS[settings.level].label}`);
      break;
    case 'spawn':
      sound.play('spawnRobot', { type: payload.robot.type });
      break;
    case 'lock':
      sound.play('lock');
      break;
    case 'keystroke':
      sound.play('key');
      break;
    case 'backspace':
      sound.play('erase');
      break;
    case 'mistake':
      sound.play('keyWrong');
      sound.play('error');
      pulseClass(ui.elements.arcadeStage, 'shake', 200);
      ui.log('err', payload.target
        ? `SyntaxError: unexpected '${visible(payload.typed)}' in '${payload.target.token.text}' — expected '${visible(payload.expected)}'`
        : `TargetNotFound: '${visible(payload.typed)}'로 시작하는 낱말이 없습니다`);
      break;
    case 'throw':
      sound.play('key');
      sound.play(battery ? 'splash' : payload.weapon === 'laptop' ? 'throwLaptop' : 'throwPhone');
      if (payload.tier > run.lastTier) {
        sound.play('tierUp', { tier: payload.tier });
        pulseClass(ui.elements.arcadeStage, 'tier-flash', 600);
        ui.log('info', `combo ${payload.combo} → multiplier ×${payload.tier === 2 ? '2.0' : '1.5'}`);
      }
      run.lastTier = payload.tier;
      break;
    case 'hit':
      sound.play('hit');
      break;
    case 'kill':
      sound.play('explode');
      ui.log('ok', `${ROBOT_TYPES[payload.robot.type].label} 처치 (+${payload.bounty})`);
      break;
    case 'item-spawn':
      sound.play('itemSpawn');
      if (!battery) ui.log('info', payload.item.item === 'battery' ? '🔋 건전지 등장 — 치면 생명 1칸 회복' : '💻 노트북 상자 등장');
      break;
    case 'item':
      sound.play(battery && payload.item.item === 'heat' ? 'explode' : 'powerUp');
      ui.log('ok', battery ? `${BATTERY_ITEM_LOG[payload.item.item]}`
        : payload.item.item === 'battery' ? `건전지 충전 — 생명 ${payload.lives}칸` : '노트북 장착 — 8초간 위력 ×3');
      break;
    case 'drain':
      sound.play('hit');
      ui.log('ok', '방전봇 탑 −0.5칸');
      break;
    case 'rival-take':
      sound.play('error');
      ui.log('warn', `방전봇이 ${BATTERY_ITEM_NAMES[payload.item.item]}을(를) 가져갔습니다`);
      break;
    case 'rival-attack':
      sound.play('lifeLost');
      pulseClass(ui.elements.arcadeStage, 'shake', 260);
      ui.log('err', '방전봇 공격 — 내 탑 −0.5칸');
      break;
    case 'target-lost':
      if (payload.reason === 'stolen') ui.log('warn', '치던 낱말을 방전봇이 먼저 쳤습니다!');
      break;
    case 'stage-clear':
      sound.play('newRecord');
      pulseClass(ui.elements.arcadeStage, 'tier-flash', 800);
      ui.log('ok', `STAGE ${payload.stage} CLEAR — ${payload.how === 'charged' ? '100% 충전 구조' : '방전봇 침몰'} (+${payload.bonus})`);
      break;
    case 'damage':
      sound.play(battery ? 'sink' : 'lifeLost');
      if (!battery) sound.play('glassCrack');
      pulseClass(ui.elements.arcadeStage, 'shake', 300);
      ui.log('err', battery ? (payload.cause.how === 'sunk' ? '배터리 0% — 방전의 바다에 빠졌습니다' : '방전봇이 먼저 100% 충전했습니다')
        : `로봇이 빨간 선 돌파 — 건전지 ${payload.lives}칸 · 휴대폰에 금이 갔습니다`);
      run.lastTier = 0;
      break;
    case 'finish':
      handleFinish(payload.summary);
      break;
    default:
      break;
  }
}

const BATTERY_ITEM_NAMES = { cell: '배터리 셀', powerbank: '보조배터리', eco: '저전력 모드', heat: '발열 폭탄', blackout: '화면 꺼짐' };
const BATTERY_ITEM_LOG = {
  cell: '배터리 셀 획득 — +0.5칸', powerbank: '보조배터리 드론 — +1칸', eco: '저전력 모드 — 4초간 방전 감속',
  heat: '발열 폭탄 — 방전봇 4초간 급방전', blackout: '화면 꺼짐 — 방전봇 3초 정지'
};

// ---------- 세션 · 제출 ----------
function startSession(generation) {
  return requestSession({ mode: settings.mode, language: settings.languageKey, durationSeconds: settings.durationSeconds }).catch(error => {
    if (generation === run.generation) ui.log('warn', `session 발급 실패 (${error.message}) — 이번 판은 로컬 랭킹에만 저장`);
    return null;
  });
}

function buildSubmission(summary, token, name) {
  return {
    token, name, score: summary.score, maxCombo: summary.maxCombo,
    correctKeystrokes: summary.correctKeystrokes, wrongKeystrokes: summary.wrongKeystrokes,
    ...(isArcade() ? { survivedSeconds: summary.survivedSeconds } : {})
  };
}

async function handleSave(event) {
  event.preventDefault();
  const engine = run.engine;
  if (!engine || engine.status !== 'finished' || run.submitted || engine.score <= 0) return;
  const generation = run.generation;
  const mode = settings.mode;
  const name = ui.elements.playerName.value.trim().slice(0, 16) || 'anonymous';
  preferences.set('name', name);
  ui.setSaveButton({ label: '등록 중…', disabled: true });
  ui.setSaveStatus('');

  const token = await run.sessionPromise;
  if (generation !== run.generation) return;
  const summary = engine.summary();
  if (!token) {
    saveLocally(summary, name, mode);
    return;
  }
  try {
    const result = await submitScore(buildSubmission(summary, token, name));
    if (generation !== run.generation) return;
    run.submitted = true;
    run.highlightId = result.myEntry.id;
    ui.renderBoard(result.entries, { week: result.week, isLive: true, highlightId: run.highlightId, modeLabel: MODE_CONFIG[mode].label });
    ui.setSaveButton({ label: '등록 완료', disabled: true });
    ui.setSaveStatus(`이번 주 ${MODE_CONFIG[mode].label} ${result.myRank}위로 등록됐습니다.`, 'ok');
    if (result.myRank === 1) sound.play('newRecord');
    ui.log('ok', `ranking updated: ${name} · #${result.myRank} (${result.week})`);
  } catch (error) {
    if (generation !== run.generation) return;
    ui.setSaveStatus(`[${error.status || 'NET'}] ${error.message}`, 'err');
    ui.setSaveButton({ label: error.isFinal ? '등록 불가' : '다시 시도', disabled: error.isFinal });
    ui.log('err', `SubmitError ${error.status || ''} ${error.code || ''}: ${error.message}`);
  }
}

function saveLocally(summary, name, mode) {
  const entry = {
    id: `local-${Date.now()}`, name, language: settings.languageKey, score: summary.score,
    wpm: summary.wordsPerMinute, accuracy: summary.accuracy, achievedAt: Date.now()
  };
  run.submitted = true;
  run.highlightId = entry.id;
  ui.renderBoard(localBoard.save(entry, mode), { week: getWeekLabel(), isLive: false, highlightId: entry.id, modeLabel: MODE_CONFIG[mode].label });
  ui.setSaveButton({ label: '로컬 저장됨', disabled: true });
  ui.setSaveStatus('서버에 연결하지 못해 이 브라우저에만 저장했습니다.', 'warn');
}

async function refreshBoard() {
  const mode = settings.mode;
  const modeLabel = MODE_CONFIG[mode].label;
  try {
    const result = await fetchBoard(mode);
    if (mode !== settings.mode) return;
    ui.renderBoard(result.entries, { week: result.week, isLive: true, highlightId: run.highlightId, modeLabel });
  } catch (error) {
    if (mode !== settings.mode) return;
    ui.renderBoard(localBoard.load(mode), { week: getWeekLabel(), isLive: false, highlightId: run.highlightId, modeLabel });
  }
}

// ---------- 결과 ----------
function arcadeSubtitle(summary) {
  const base = `${LANGUAGES[settings.languageKey].label} · ${DIFFICULTY_LEVELS[summary.level].label} · 생존 ${summary.survivedSeconds}s`;
  if (summary.mode === 'battery') {
    const cause = summary.outcome === 'rival-charged' ? '방전봇 선충전' : '방전';
    return `${base} · 클리어 ${summary.stagesCleared}스테이지 · 공격 ${summary.drains} · 아이템 ${summary.itemsCollected} · 뺏김 ${summary.stolen} · 패배: ${cause}`;
  }
  const { basic, fast, tank } = summary.kills;
  return `${base} · 처치 ${summary.totalKills} (기본 ${basic} · 빠른 ${fast} · 헤비 ${tank}) · 아이템 ${summary.itemsCollected}`;
}

function handleFinish(summary) {
  stopTicking();
  sound.play(isArcade() ? 'gameOver' : 'finish');
  bgm.duck(true);
  ui.elements.hiddenInput.blur();
  renderStats();
  ui.setFocusState({ focused: false, finished: true, arcade: isArcade() });
  keyboard.setNext(null);
  ui.log('sys', `run finished · score ${summary.score} · ${summary.wordsPerMinute} WPM · ${summary.accuracy}%`);
  ui.showResult(summary, {
    languageKey: settings.languageKey,
    playerName: preferences.get('name', ''),
    ...(isArcade() ? { title: modeConfig().resultTitle, subtitle: arcadeSubtitle(summary) } : {})
  });
}

// ---------- 진행 ----------
function renderStats() {
  const engine = run.engine;
  if (!engine) return;
  ui.renderStats(isArcade() ? engine.snapshot() : engine.snapshot(now()));
}

function startTicking() {
  if (run.tickId || isArcade()) return;
  run.tickId = setInterval(() => {
    const engine = run.engine;
    engine.update(now());
    if (engine.status === 'running') renderStats();
  }, TICK_INTERVAL_MS);
}

function stopTicking() {
  clearInterval(run.tickId);
  run.tickId = null;
}

// 아케이드는 requestAnimationFrame으로 엔진 진행과 그리기를 함께 한다(탭이 숨으면 자동으로 멈춤).
function startFrameLoop() {
  cancelAnimationFrame(run.frameId);
  const loop = () => {
    const engine = run.engine;
    if (!isArcade() || !engine) return;
    engine.update(now());
    const snapshot = engine.snapshot();
    renderers[settings.mode]?.render(engine, { accent: TIER_COLORS[snapshot.tierProgress.index] });
    if (engine.status === 'running') {
      renderStats();
      updateArcadeMusic(snapshot);
      renderInputBar();
    }
    run.frameId = requestAnimationFrame(loop);
  };
  run.frameId = requestAnimationFrame(loop);
}

// 게임 상황 → BGM: 던지기는 콤보 단계, 구조는 SLA 위기도. 아이템 효과가 끝나면 종료음.
function updateArcadeMusic(snapshot) {
  const powerActive = snapshot.powerRemaining > 0;
  if (run.powerActive && !powerActive) sound.play('powerDown');
  run.powerActive = powerActive;
  if (settings.mode === 'battery') {
    const danger = snapshot.myCells < 1.5 ? 2 : snapshot.myCells < 2.5 ? 1 : 0;
    bgm.setIntensity(Math.max(danger, snapshot.tierProgress.index), { tempoBoost: snapshot.myCells < 1.5 ? 1.08 : 1, power: powerActive });
  } else {
    bgm.setIntensity(snapshot.lives <= 1 ? Math.max(snapshot.tierProgress.index, 1) : snapshot.tierProgress.index, { power: powerActive });
  }
}

function startMusic() {
  bgm.play(settings.mode);
}

function createEngine() {
  if (!isArcade()) {
    return new TypingEngine({
      tokenPool: getTokenPool(settings.languageKey),
      durationSeconds: settings.durationSeconds,
      onEvent: handlePracticeEvent
    });
  }
  const config = modeConfig();
  return config.createEngine({
    tokenPool: getTokenPool(settings.languageKey), level: settings.level, onEvent: handleArcadeEvent,
    narrow: ui.elements.arcadeCanvas.getBoundingClientRect().width < NARROW_WIDTH || window.innerWidth < NARROW_WIDTH
  });
}

function resetGame() {
  stopTicking();
  cancelAnimationFrame(run.frameId);
  run.generation++;
  run.sessionPromise = null;
  run.submitted = false;
  run.lastTier = 0;
  run.powerActive = false;
  run.engine = createEngine();
  bgm.setIntensity(0);
  bgm.duck(false);
  ui.hideResult();
  if (isArcade()) {
    const config = modeConfig();
    fitArcadeCanvas();
    renderers[settings.mode] ??= new config.Renderer(ui.elements.arcadeCanvas);
    ui.elements.arcadeTitle.textContent = config.title;
    ui.elements.arcadeHint.textContent = `${LANGUAGES[settings.languageKey].label} · ${DIFFICULTY_LEVELS[settings.level].label}`;
    startFrameLoop();
  } else {
    ui.elements.fileName.textContent = LANGUAGES[settings.languageKey].file;
    ui.renderToken(run.engine);
    updateKeyboardHint();
  }
  renderStats();
  renderInputBar();
  updateFocusState();
}

// ---------- 화면 키보드(연습 모드 전용) ----------
function updateKeyboardHint() {
  if (isArcade()) return;
  const engine = run.engine;
  if (engine.status === 'finished') {
    keyboard.setNext(null);
    return;
  }
  keyboard.setNext(engine.wrongInBuffer > 0 ? 'Backspace' : engine.current.text[engine.cursor]);
}

function applyKeyboardVisibility() {
  keyboard.setVisible(settings.keyboardVisible && !isArcade());
  ui.elements.keyboardToggle.hidden = isArcade();
  ui.elements.keyboardToggle.textContent = settings.keyboardVisible ? '⌨ KBD' : '⌨ OFF';
  ui.elements.keyboardToggle.classList.toggle('off', !settings.keyboardVisible);
  ui.elements.keyboardToggle.setAttribute('aria-pressed', String(settings.keyboardVisible));
}

// ---------- 입력 ----------
// 숨은 textarea의 값 변화를 글자·지우기로 바꾼다(input.js). 모바일 조합 입력·스와이프·자동수정도 같은 규칙.
const inputDiffer = createInputDiffer({
  onCharacter: character => applyCharacter(character),
  onBackspace: () => applyBackspace(false),
  onIgnored: () => warnIme(),
  onHangul: () => showInputNotice('한→영 자동 변환 · 대문자는 영문 키보드')
});

function resetInputBuffer() {
  ui.elements.hiddenInput.value = inputDiffer.reset();
}

function warnIme() {
  showInputNotice('⚠ 영문 키보드로 바꿔 주세요');
  if (Date.now() - run.lastImeWarning < IME_WARNING_INTERVAL_MS) return;
  run.lastImeWarning = Date.now();
  ui.log('warn', '영문 자판에 없는 글자는 무시됩니다 — 키보드를 영문으로 바꿔 주세요');
}

function applyCharacter(character) {
  startMusic();
  const engine = run.engine;
  if (isArcade()) {
    engine.input(character, now());
    renderStats();
    renderInputBar();
    return;
  }
  const tokenNumberBefore = engine.tokenNumber;
  const result = engine.input(character, now());
  if (!result.accepted) return;
  keyboard.press(character, result.correct);
  if (engine.status === 'running') startTicking();
  ui.renderToken(engine, { full: engine.tokenNumber !== tokenNumberBefore });
  renderStats();
  updateKeyboardHint();
}

function applyBackspace(wholeToken) {
  const engine = run.engine;
  if (!engine.backspace(now(), { wholeToken }).accepted) return;
  if (isArcade()) {
    renderInputBar();
    return;
  }
  keyboard.press('Backspace', true);
  ui.renderToken(engine, { full: false });
  updateKeyboardHint();
}

function handleKeyDown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    resetGame();
    return;
  }
  if (event.isComposing) return;
  if (event.key === 'Backspace') {
    event.preventDefault();
    applyBackspace(event.ctrlKey || event.altKey || event.metaKey);
    return;
  }
  if (event.key === 'Enter' || event.key === 'Tab') event.preventDefault();
}

function handleInput(event) {
  inputDiffer.sync(ui.elements.hiddenInput.value);
  // 조합 중에는 값을 건드리면 IME가 깨지므로, 조합이 끝났을 때만 센티널로 되돌린다
  if (!event.isComposing) resetInputBuffer();
}

function handleCompositionEnd() {
  inputDiffer.sync(ui.elements.hiddenInput.value);
  resetInputBuffer();
}

// 아케이드 하단 입력창: 원작의 입력칸처럼 지금 치는 낱말과 진행 상황을 보여준다
function renderInputBar() {
  const bar = ui.elements.inputBar;
  if (!bar) return;
  const engine = run.engine;
  if (!isArcade() || !engine) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const target = engine.target;
  const typed = engine.typed.join('');
  const correctLength = target ? [...typed].findIndex((character, index) => character !== target.token.text[index]) : -1;
  const goodPart = correctLength === -1 ? typed : typed.slice(0, correctLength);
  const badPart = correctLength === -1 ? '' : typed.slice(correctLength);
  ui.elements.inputTyped.textContent = goodPart;
  ui.elements.inputWrong.textContent = badPart;
  ui.elements.inputRest.textContent = target ? target.token.text.slice(typed.length) : '';
  const notice = run.inputNotice && run.inputNotice.until > Date.now() ? run.inputNotice.message : '';
  ui.elements.inputTarget.textContent = notice || (target ? '' : engine.status === 'finished' ? 'game over' : '낱말의 첫 글자를 치세요');
  ui.elements.inputTarget.classList.toggle('notice', Boolean(notice));
}

// 입력창 안내(영문 키보드 전환 등)를 잠깐 띄운다. 게임 로그는 모바일에서 화면 밖이라 입력창에 직접 보여준다.
const INPUT_NOTICE_MS = 2500;
function showInputNotice(message) {
  run.inputNotice = { message, until: Date.now() + INPUT_NOTICE_MS };
  renderInputBar();
  clearTimeout(run.inputNoticeTimer);
  run.inputNoticeTimer = setTimeout(renderInputBar, INPUT_NOTICE_MS + 50);
}

// 게임 화면 높이: 모바일 키보드가 올라오면(visualViewport 축소) 그만큼 줄여서 입력창이 키보드 바로 위에 오게 한다.
function fitArcadeCanvas() {
  if (!isArcade()) return;
  const canvas = ui.elements.arcadeCanvas;
  const viewport = window.visualViewport;
  const viewportHeight = viewport ? viewport.height : window.innerHeight;
  const top = canvas.getBoundingClientRect().top + (viewport ? 0 : 0);
  const reserved = (ui.elements.inputBar?.offsetHeight || 40) + 12;
  const available = Math.round(viewportHeight - Math.max(0, top) - reserved);
  const narrow = window.innerWidth < NARROW_WIDTH;
  const height = Math.max(narrow ? 300 : 360, Math.min(narrow ? 640 : 560, available));
  if (Math.abs(canvas.clientHeight - height) > 2) canvas.style.height = `${height}px`;
}

function focusTypingArea() {
  startMusic();
  if (run.engine.status === 'finished') return;
  // 이미 입력 중이면 건드리지 않는다: 값을 되돌리면 모바일 키보드의 조합이 깨지고, 스크롤이 튀어 화면이 흔들린다
  if (document.activeElement === ui.elements.hiddenInput) return;
  resetInputBuffer();
  ui.elements.hiddenInput.focus({ preventScroll: true });
  // 모바일: 키보드가 올라온 뒤 게임 화면이 보이도록 스크롤하고 높이를 다시 맞춘다
  if (isArcade()) {
    setTimeout(() => {
      ui.elements.arcadeStage.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      fitArcadeCanvas();
    }, 350);
  }
}

function updateFocusState() {
  ui.setFocusState({
    focused: document.activeElement === ui.elements.hiddenInput,
    finished: run.engine.status === 'finished',
    arcade: isArcade()
  });
}

// ---------- 모드 · 설정 ----------
function applyMode() {
  const arcade = isArcade();
  ui.elements.modeButtons.forEach(button => {
    const active = button.dataset.mode === settings.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  ui.elements.stage.hidden = arcade;
  ui.elements.arcadeStage.hidden = !arcade;
  ui.elements.durationGroup.hidden = arcade;
  ui.elements.levelSelect.hidden = !arcade;
  document.getElementById('practiceHint').hidden = arcade;
  document.getElementById('throwHint').hidden = settings.mode !== 'throw';
  document.getElementById('batteryHint').hidden = settings.mode !== 'battery';
  document.body.dataset.mode = settings.mode;
  document.getElementById('arcadeOverlayHint').textContent = arcade ? `${modeConfig().hint} · 첫 글자를 치면 시작` : '';
  applyKeyboardVisibility();
  renderInputBar();
  requestAnimationFrame(fitArcadeCanvas);
}

function switchMode(mode) {
  if (!MODE_CONFIG[mode] || mode === settings.mode) return;
  settings.mode = mode;
  preferences.set('mode', mode);
  run.highlightId = null;
  applyMode();
  resetGame();
  refreshBoard();
  sound.play('uiClick');
  startMusic();
}

function bindSettings() {
  ui.populateLanguages(settings.languageKey);
  ui.elements.levelSelect.replaceChildren(...Object.entries(DIFFICULTY_LEVELS).map(([level, config]) => {
    const option = document.createElement('option');
    option.value = level;
    option.textContent = config.label;
    return option;
  }));
  ui.elements.levelSelect.value = String(settings.level);
  ui.elements.levelSelect.addEventListener('change', () => {
    settings.level = Number(ui.elements.levelSelect.value);
    preferences.set('level', settings.level);
    resetGame();
  });
  ui.elements.modeButtons.forEach(button => button.addEventListener('click', () => switchMode(button.dataset.mode)));
  ui.elements.durationButtons.forEach(button => {
    button.classList.toggle('active', Number(button.dataset.seconds) === settings.durationSeconds);
    button.addEventListener('click', () => {
      settings.durationSeconds = Number(button.dataset.seconds);
      preferences.set('duration', settings.durationSeconds);
      ui.elements.durationButtons.forEach(other => other.classList.toggle('active', other === button));
      resetGame();
    });
  });
  ui.elements.languageSelect.addEventListener('change', () => {
    settings.languageKey = ui.elements.languageSelect.value;
    preferences.set('lang', settings.languageKey);
    resetGame();
  });
  sound.setEnabled(preferences.get('sound', true));
  const renderSoundToggle = () => {
    ui.elements.soundToggle.textContent = sound.enabled ? '🔊' : '🔇';
    ui.elements.soundToggle.classList.toggle('off', !sound.enabled);
    ui.elements.soundToggle.setAttribute('aria-pressed', String(sound.enabled));
  };
  renderSoundToggle();
  ui.elements.soundToggle.addEventListener('click', () => {
    sound.setEnabled(!sound.enabled);
    preferences.set('sound', sound.enabled);
    renderSoundToggle();
  });
  bgm.setEnabled(preferences.get('bgm', true));
  const renderBgmToggle = () => {
    ui.elements.bgmToggle.textContent = bgm.enabled ? '♫ BGM' : '♫ OFF';
    ui.elements.bgmToggle.classList.toggle('off', !bgm.enabled);
    ui.elements.bgmToggle.setAttribute('aria-pressed', String(bgm.enabled));
  };
  renderBgmToggle();
  ui.elements.bgmToggle.addEventListener('click', () => {
    bgm.setEnabled(!bgm.enabled);
    preferences.set('bgm', bgm.enabled);
    renderBgmToggle();
    if (bgm.enabled) startMusic();
  });
  ui.elements.keyboardToggle.addEventListener('click', () => {
    settings.keyboardVisible = !settings.keyboardVisible;
    preferences.set('keyboard', settings.keyboardVisible);
    applyKeyboardVisibility();
  });
}

function bindEvents() {
  const { elements } = ui;
  const restart = () => { resetGame(); focusTypingArea(); };
  elements.restartButton.addEventListener('click', restart);
  elements.retryButton.addEventListener('click', restart);
  // 결과창 닫기: ✕ 버튼 · 바깥 어두운 영역 클릭. 기록은 그대로 두고 화면만 보여준다(↻로 재시작)
  const closeResult = () => { sound.play('uiClick'); ui.hideResult(); };
  elements.resultClose.addEventListener('click', closeResult);
  elements.resultModal.addEventListener('click', event => { if (event.target === elements.resultModal) closeResult(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || elements.resultModal.hidden) return;
    event.preventDefault();
    closeResult();
  });
  elements.saveForm.addEventListener('submit', handleSave);
  elements.focusOverlay.addEventListener('click', focusTypingArea);
  elements.arcadeOverlay.addEventListener('click', focusTypingArea);
  elements.stage.addEventListener('click', focusTypingArea);
  elements.arcadeStage.addEventListener('click', focusTypingArea);
  elements.hiddenInput.addEventListener('keydown', handleKeyDown);
  elements.hiddenInput.addEventListener('input', handleInput);
  elements.hiddenInput.addEventListener('compositionend', handleCompositionEnd);
  elements.hiddenInput.addEventListener('paste', event => event.preventDefault());
  elements.hiddenInput.addEventListener('focus', updateFocusState);
  elements.hiddenInput.addEventListener('blur', updateFocusState);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.activeElement !== elements.hiddenInput) restart();
  });
  window.visualViewport?.addEventListener('resize', fitArcadeCanvas);
  window.addEventListener('resize', fitArcadeCanvas);
  elements.inputBar?.addEventListener('click', focusTypingArea);
}

bindSettings();
bindEvents();
applyMode();
ui.log('sys', 'TYPE//CODE ready. 오타는 에러 로그로 남고, Backspace로 지울 수 있습니다.');
resetGame();
refreshBoard();

// 자동화 테스트·디버깅용 읽기 창구(게임 상태 조회). 게임 로직은 이 값에 의존하지 않는다.
globalThis.__TYPECODE__ = { run, settings, renderers };
