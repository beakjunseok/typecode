// 화면 렌더링 전담. 게임 규칙은 모르고, 엔진 상태와 요약 값을 받아 그리기만 한다.
import { LANGUAGES, TOKEN_KINDS } from './tokens.js';
import { prefersReducedMotion } from './effects.js';

export const TIER_COLORS = Object.freeze(['#36e2ff', '#ffb547', '#ff4fd8']);
const CONSOLE_LINES = 6;

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function kindColor(kind) {
  return TOKEN_KINDS[kind]?.color ?? '#c9d4e0';
}

function languageLabel(languageKey) {
  return LANGUAGES[languageKey]?.label ?? languageKey;
}

export function createUi(root = document) {
  const byId = id => root.getElementById(id);
  const elements = {
    app: byId('app'), languageSelect: byId('languageSelect'), durationButtons: root.querySelectorAll('#durationGroup button'),
    soundToggle: byId('soundToggle'), bgmToggle: byId('bgmToggle'), restartButton: byId('restartButton'),
    timerFill: byId('timerFill'), timeStat: byId('timeStat'), timeLabel: byId('timeLabel'), timeValue: byId('timeValue'), wpmValue: byId('wpmValue'),
    accuracyValue: byId('accuracyValue'), comboValue: byId('comboValue'), multiplierStat: byId('multiplierStat'),
    multiplierValue: byId('multiplierValue'), scoreValue: byId('scoreValue'),
    stage: byId('stage'), arcadeStage: byId('arcadeStage'), arcadeCanvas: byId('arcadeCanvas'), arcadeTitle: byId('arcadeTitle'),
    arcadeHint: byId('arcadeHint'), arcadeOverlay: byId('arcadeOverlay'), songSelect: byId('songSelect'), modeButtons: root.querySelectorAll('[data-mode]'), sectionButtons: root.querySelectorAll('[data-section]'), gameTabs: byId('gameTabs'),
    durationGroup: byId('durationGroup'), levelSelect: byId('levelSelect'), keyboardSection: byId('keyboardSection'), keyboardToggle: byId('keyboardToggle'),
    inputBar: byId('inputBar'), inputTyped: byId('inputTyped'), inputWrong: byId('inputWrong'), inputRest: byId('inputRest'),
    inputTarget: byId('inputTarget'),
    fileName: byId('fileName'), tokenCounter: byId('tokenCounter'),
    historyView: byId('historyView'), kindLabel: byId('kindLabel'), currentView: byId('currentView'),
    comboFill: byId('comboFill'), comboHint: byId('comboHint'), queueView: byId('queueView'),
    focusOverlay: byId('focusOverlay'), hiddenInput: byId('hiddenInput'), consoleView: byId('consoleView'),
    boardTitle: byId('boardTitle'), boardBadge: byId('boardBadge'), boardBody: byId('boardBody'),
    resultModal: byId('resultModal'), resultClose: byId('resultClose'), resultTitle: byId('resultTitle'), resultSub: byId('resultSub'), resultScore: byId('resultScore'),
    resultWpm: byId('resultWpm'), resultWpmSub: byId('resultWpmSub'), resultAccuracy: byId('resultAccuracy'), resultCombo: byId('resultCombo'),
    wpmChart: byId('wpmChart'), wpmChartPeak: byId('wpmChartPeak'), weakTokens: byId('weakTokens'),
    saveForm: byId('saveForm'), playerName: byId('playerName'), saveStatus: byId('saveStatus'),
    saveButton: byId('saveButton'), retryButton: byId('retryButton'), pvpResultNote: byId('pvpResultNote'),
    batteryVariantGroup: byId('batteryVariantGroup'), batteryVariantButtons: root.querySelectorAll('[data-battery-variant]')
  };

  function populateLanguages(selectedKey) {
    const options = Object.entries(LANGUAGES).map(([key, language]) => {
      const option = element('option', null, language.label);
      option.value = key;
      return option;
    });
    elements.languageSelect.replaceChildren(...options);
    elements.languageSelect.value = selectedKey;
  }

  // 현재 토큰: 맞은 글자는 종류 색, 틀린 글자는 빨강, 지운 글자는 다시 기본색. O(L)
  // 방금 맞게 친 글자 하나만 톡 튀게(pop) 한다. 지울 때·토큰이 바뀔 때는 튀지 않는다
  let lastCorrectCount = 0;
  let lastTokenNumber = null;
  function renderCurrentToken(engine) {
    const { text, kind } = engine.current;
    const color = kindColor(kind);
    const states = engine.getCharacterStates();
    const correctCount = states.filter(state => state === 'correct').length;
    const sameToken = engine.tokenNumber === lastTokenNumber;
    const poppedIndex = sameToken && correctCount > lastCorrectCount ? states.lastIndexOf('correct') : -1;
    lastCorrectCount = correctCount;
    lastTokenNumber = engine.tokenNumber;
    const spans = [...text].map((character, index) => {
      const span = element('span', `ch ${states[index]}${character === ' ' ? ' space' : ''}${index === poppedIndex ? ' pop' : ''}`, character === ' ' ? '·' : character);
      if (states[index] === 'correct') span.style.color = color;
      return span;
    });
    elements.currentView.replaceChildren(...spans);
    elements.currentView.style.setProperty('--kind-color', color);
    elements.kindLabel.textContent = TOKEN_KINDS[kind]?.label ?? kind;
    elements.kindLabel.style.color = color;
  }

  function renderQueueAndHistory(engine) {
    elements.queueView.replaceChildren(...engine.queue.map(token => {
      const span = element('span', null, token.text);
      span.style.color = kindColor(token.kind);
      return span;
    }));
    elements.historyView.replaceChildren(...engine.history.map(token => {
      const span = element('span', `past ${token.clean ? 'clean' : 'dirty'}${token.skipped ? ' skipped' : ''}`, token.text);
      if (token.skipped) span.title = 'Enter로 건너뜀';
      if (token.clean) span.style.color = kindColor(token.kind);
      return span;
    }));
    elements.tokenCounter.textContent = `token #${engine.tokenNumber}`;
  }

  // 토큰이 바뀔 때만 큐·기록을 다시 그리고, 글자 입력 때는 현재 토큰만 다시 그린다.
  function renderToken(engine, { full = true } = {}) {
    renderCurrentToken(engine);
    if (full) {
      renderQueueAndHistory(engine);
      elements.currentView.classList.remove('enter');
      void elements.currentView.offsetWidth;
      elements.currentView.classList.add('enter');
    }
  }

  // 연습 모드: 남은 시간 / 아케이드 모드: 버틴 시간 + 아이템 남은 시간을 타이머 바로 표시
  // 글자·변형이 그대로면 DOM을 건드리지 않는다(매 프레임 불리므로, 같은 값을 다시 쓰면 레이아웃·그리기가 헛돈다)
  function setText(node, value) {
    const text = String(value);
    if (node && node.textContent !== text) node.textContent = text;
  }
  function setTransform(node, value) {
    if (node && node.style.transform !== value) node.style.transform = value;
  }

  function renderStats(snapshot) {
    const tier = snapshot.tierProgress.index;
    const arcade = snapshot.elapsedSeconds !== undefined;
    const timeAttack = snapshot.mode === 'timeattack';
    setText(elements.timeLabel, arcade ? '버틴 시간' : timeAttack ? '남은 시간 ⏳' : '남은 시간');
    // 시간 연장 모드는 소수 한 자리(시간이 조금씩 늘어나는 게 보이도록)
    setText(elements.timeValue, arcade ? `${Math.floor(snapshot.elapsedSeconds)}s`
      : timeAttack ? snapshot.remainingExact.toFixed(1) : snapshot.remainingSeconds);
    elements.timeStat.classList.toggle('low', arcade ? snapshot.lives === 1 && snapshot.status === 'running'
      : snapshot.status === 'running' && snapshot.remainingSeconds <= 5);
    const barRatio = arcade ? (snapshot.powerSeconds ? snapshot.powerRemaining / snapshot.powerSeconds : 0) : snapshot.remainingRatio;
    setTransform(elements.timerFill, `scaleX(${Math.max(0, Math.min(1, barRatio)).toFixed(3)})`);
    setText(elements.wpmValue, snapshot.charactersPerMinute ?? snapshot.wordsPerMinute * 5);
    setText(elements.accuracyValue, `${snapshot.accuracy}%`);
    renderCombo(snapshot.combo);
    setText(elements.multiplierValue, `×${snapshot.multiplier.toFixed(1)}`);
    setText(elements.scoreValue, snapshot.score.toLocaleString());
    setTransform(elements.comboFill, `scaleX(${Number(snapshot.tierProgress.ratio).toFixed(3)})`);
    setText(elements.comboHint, snapshot.tierProgress.nextMultiplier
      ? `×${snapshot.tierProgress.nextMultiplier.toFixed(1)}까지 클린 토큰 ${snapshot.tierProgress.remaining}개`
      : 'MAX ×2.0');
    setTier(tier);
  }

  function setTier(tier) {
    if (elements.stage.dataset.tier === String(tier)) return;
    elements.stage.dataset.tier = String(tier);
    elements.app.style.setProperty('--tier-color', TIER_COLORS[tier]);
  }

  function setFocusState({ focused, finished, arcade = false }) {
    elements.focusOverlay.hidden = arcade || focused || finished;
    elements.arcadeOverlay.hidden = !arcade || focused || finished;
    elements.stage.classList.toggle('focused', focused && !arcade);
    elements.arcadeStage.classList.toggle('focused', focused && arcade);
  }

  function log(level, message) {
    const time = new Date().toTimeString().slice(0, 8);
    elements.consoleView.appendChild(element('div', `log ${level}`, `${time} [${level.toUpperCase()}] ${message}`));
    while (elements.consoleView.children.length > CONSOLE_LINES) elements.consoleView.firstChild.remove();
  }

  function renderBoard(entries, { week, isLive, highlightId = null, modeLabel = '' }) {
    elements.boardTitle.textContent = `${modeLabel ? `${modeLabel} ` : ''}이번 주 순위`;
    elements.boardTitle.title = `${week} · 매주 월요일 0시(KST) 새로 집계`;
    elements.boardBadge.textContent = isLive ? '실시간' : '이 기기만';
    elements.boardBadge.className = `badge ${isLive ? 'live' : 'local'}`;
    if (!entries.length) {
      elements.boardBody.replaceChildren(element('p', 'empty', '이번 주 기록이 아직 없어요. 한 판 끝내고 첫 기록을 남겨 보세요.'));
      return;
    }
    const table = element('table');
    const head = element('thead');
    const headRow = element('tr');
    [['순위', 'rank'], ['이름'], ['언어'], ['타수', 'num'], ['정확도', 'num hide-mobile'], ['점수', 'num']]
      .forEach(([label, className]) => headRow.appendChild(element('th', className, label)));
    head.appendChild(headRow);
    const body = element('tbody');
    entries.forEach((entry, index) => {
      const row = element('tr', [entry.id === highlightId ? 'me' : '', index === 0 ? 'rank1' : ''].join(' ').trim());
      [
        [String(index + 1), 'rank'], [entry.name], [languageLabel(entry.language)], [entry.cpm ?? entry.wpm * 5, 'num'],
        [`${entry.accuracy}%`, 'num hide-mobile'], [Number(entry.score).toLocaleString(), 'num']
      ].forEach(([value, className]) => row.appendChild(element('td', className, value)));
      body.appendChild(row);
    });
    table.append(head, body);
    elements.boardBody.replaceChildren(table);
  }

  // 5초 이동 평균 WPM을 SVG 꺾은선으로. 값 n개에 대해 O(n)
  function renderWpmChart(timeline) {
    const width = 300;
    const height = 64;
    const peak = Math.max(10, ...timeline);
    const step = timeline.length > 1 ? width / (timeline.length - 1) : width;
    const points = timeline.map((value, index) => `${(index * step).toFixed(1)},${(height - (value / peak) * (height - 6) - 3).toFixed(1)}`);
    const namespace = 'http://www.w3.org/2000/svg';
    const area = document.createElementNS(namespace, 'polygon');
    area.setAttribute('points', `0,${height} ${points.join(' ')} ${width},${height}`);
    area.setAttribute('class', 'chart-area');
    const line = document.createElementNS(namespace, 'polyline');
    line.setAttribute('points', points.join(' '));
    line.setAttribute('class', 'chart-line');
    elements.wpmChart.replaceChildren(area, line);
    elements.wpmChartPeak.textContent = `최고 ${Math.max(0, ...timeline)}타`;
  }

  function renderWeakTokens(weakTokens) {
    if (!weakTokens.length) {
      elements.weakTokens.replaceChildren(element('span', 'muted', '오타 없음 — clean build'));
      return;
    }
    elements.weakTokens.replaceChildren(...weakTokens.map(token => {
      const chip = element('span', 'chip', `${token.text}  ×${token.misses}`);
      chip.style.borderColor = kindColor(token.kind);
      chip.style.color = kindColor(token.kind);
      return chip;
    }));
  }

  // saveable: false면 랭킹 등록 폼을 숨긴다(PvP 결과)
  // mood: 'win'이면 축하 그림, 'lose'면 좌절 그림을 결과창 위에 깐다
  function showResult(summary, { languageKey, playerName, title = 'BUILD FINISHED', subtitle = null, saveable = true, unsavedNote = null, mood = 'win' }) {
    elements.resultModal.dataset.mood = mood === 'lose' ? 'lose' : 'win';
    elements.resultModal.dataset.game = summary?.mode ?? '';
    elements.saveForm.querySelector('label').hidden = !saveable;
    elements.playerName.hidden = !saveable;
    elements.saveButton.hidden = !saveable;
    elements.saveStatus.hidden = !saveable;
    elements.pvpResultNote.hidden = saveable;
    if (!elements.pvpResultNote.dataset.defaultText) elements.pvpResultNote.dataset.defaultText = elements.pvpResultNote.textContent;
    elements.pvpResultNote.textContent = unsavedNote ?? elements.pvpResultNote.dataset.defaultText;
    elements.resultTitle.textContent = title;
    elements.resultSub.textContent = subtitle ??
      `${languageLabel(languageKey)} · ${summary.durationSeconds}s · 토큰 ${summary.completedTokens}개 (클린 ${summary.cleanTokens})${summary.skippedTokens ? ` · 건너뜀 ${summary.skippedTokens}` : ''}`;
    elements.resultScore.textContent = summary.score.toLocaleString();
    elements.resultWpm.textContent = summary.charactersPerMinute ?? summary.wordsPerMinute * 5;
    elements.resultWpmSub.textContent = `· ${summary.wordsPerMinute} WPM`;
    elements.resultAccuracy.textContent = `${summary.accuracy}%`;
    elements.resultCombo.textContent = summary.maxCombo;
    renderWpmChart(summary.wordsPerMinuteTimeline.map(value => value * 5));
    renderWeakTokens(summary.weakTokens);
    elements.playerName.value = playerName;
    elements.saveButton.textContent = '랭킹 등록';
    elements.saveButton.disabled = summary.score <= 0;
    setSaveStatus(summary.score <= 0 ? '완성한 토큰이 없어 등록할 기록이 없습니다.' : '');
    elements.resultModal.hidden = false;
  }

  // 시간 연장: 타이머 칸 위로 '+1.2s'가 떠오르며 사라진다. 이전 표시가 남아 있으면 교체
  function showTimeBonus(seconds) {
    if (!(seconds > 0)) return;
    elements.timeStat.querySelector('.time-bonus')?.remove();
    const badge = element('span', 'time-bonus', `+${seconds.toFixed(1)}s`);
    elements.timeStat.appendChild(badge);
    setTimeout(() => badge.remove(), 900);
  }

  function hideResult() {
    elements.resultModal.hidden = true;
  }

  function setSaveStatus(message, tone = 'info') {
    elements.saveStatus.textContent = message;
    elements.saveStatus.className = `status ${tone}`;
  }

  function setSaveButton({ label, disabled }) {
    if (label) elements.saveButton.textContent = label;
    elements.saveButton.disabled = disabled;
  }

  // 콤보 숫자: 오를 때마다 통 튀고, 콤보가 클수록(50에서 최대) 숫자가 커지고 색이 달아오른다.
  // 5 이상에서 끊기면 금 가듯 흔들린다
  let shownCombo = 0;
  function renderCombo(combo) {
    const value = elements.comboValue;
    if (combo === shownCombo) return;
    value.textContent = combo;
    value.style.setProperty('--combo-heat', Math.min(1, combo / 50).toFixed(3));
    const className = combo > shownCombo ? 'bump' : shownCombo >= 5 ? 'broke' : null;
    shownCombo = combo;
    if (!className) return;
    value.classList.remove('bump', 'broke');
    void value.offsetWidth;
    value.classList.add(className);
  }

  // 토큰을 끝내면 그 글자들이 하나씩 위로 튀어 오르며 흩어진다(화면에 떠 있는 복제본, 끝나면 제거).
  // 깨끗하게 쳤으면 종류 색, 아니면 회색. 콤보 10마다 가운데 위로 'N COMBO' 글씨. 글자 수 L에 대해 O(L)
  function celebrateToken({ clean, combo, color }) {
    if (prefersReducedMotion()) return;
    const letters = [...elements.currentView.querySelectorAll('.ch')];
    const fragment = document.createDocumentFragment();
    letters.forEach((letter, index) => {
      const rect = letter.getBoundingClientRect();
      if (!rect.width) return;
      const flyer = element('span', 'fly-letter', letter.textContent);
      flyer.style.left = `${rect.left}px`;
      flyer.style.top = `${rect.top}px`;
      flyer.style.color = clean ? color : 'var(--ghost)';
      flyer.style.setProperty('--fly-x', `${(index - (letters.length - 1) / 2) * 6 + (Math.random() - 0.5) * 24}px`);
      flyer.style.setProperty('--fly-y', `${-60 - Math.random() * 40 - Math.min(combo, 40)}px`);
      flyer.style.setProperty('--fly-rotate', `${(Math.random() - 0.5) * 50}deg`);
      flyer.style.animationDelay = `${index * 18}ms`;
      flyer.addEventListener('animationend', () => flyer.remove(), { once: true });
      setTimeout(() => flyer.remove(), 1400);
      fragment.append(flyer);
    });
    if (clean && combo > 0 && combo % 10 === 0) {
      const rect = elements.currentView.getBoundingClientRect();
      const banner = element('div', 'combo-burst', `${combo} COMBO`);
      banner.style.left = `${rect.left + rect.width / 2}px`;
      banner.style.top = `${rect.top - 8}px`;
      banner.addEventListener('animationend', () => banner.remove(), { once: true });
      setTimeout(() => banner.remove(), 1600);
      fragment.append(banner);
    }
    document.body.append(fragment);
  }

  return {
    elements, populateLanguages, celebrateToken, renderToken, renderStats, setFocusState, log, renderBoard,
    showResult, hideResult, showTimeBonus, setSaveStatus, setSaveButton, kindColor
  };
}
