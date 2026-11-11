// 화면 렌더링 전담. 게임 규칙은 모르고, 엔진 상태와 요약 값을 받아 그리기만 한다.
import { LANGUAGES, TOKEN_KINDS } from './tokens.js';

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
    arcadeHint: byId('arcadeHint'), arcadeOverlay: byId('arcadeOverlay'), modeButtons: root.querySelectorAll('[data-mode]'),
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
  function renderCurrentToken(engine) {
    const { text, kind } = engine.current;
    const color = kindColor(kind);
    const states = engine.getCharacterStates();
    const spans = [...text].map((character, index) => {
      const span = element('span', `ch ${states[index]}${character === ' ' ? ' space' : ''}`, character === ' ' ? '·' : character);
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
  function renderStats(snapshot) {
    const tier = snapshot.tierProgress.index;
    const arcade = snapshot.elapsedSeconds !== undefined;
    const timeAttack = snapshot.mode === 'timeattack';
    elements.timeLabel.textContent = arcade ? '버틴 시간' : timeAttack ? '남은 시간 ⏳' : '남은 시간';
    // 시간 연장 모드는 소수 한 자리(시간이 조금씩 늘어나는 게 보이도록)
    elements.timeValue.textContent = arcade ? `${Math.floor(snapshot.elapsedSeconds)}s`
      : timeAttack ? snapshot.remainingExact.toFixed(1) : snapshot.remainingSeconds;
    elements.timeStat.classList.toggle('low', arcade ? snapshot.lives === 1 && snapshot.status === 'running'
      : snapshot.status === 'running' && snapshot.remainingSeconds <= 5);
    const barRatio = arcade ? (snapshot.powerSeconds ? snapshot.powerRemaining / snapshot.powerSeconds : 0) : snapshot.remainingRatio;
    elements.timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, barRatio))})`;
    elements.wpmValue.textContent = snapshot.charactersPerMinute ?? snapshot.wordsPerMinute * 5;
    elements.accuracyValue.textContent = `${snapshot.accuracy}%`;
    elements.comboValue.textContent = snapshot.combo;
    elements.multiplierValue.textContent = `×${snapshot.multiplier.toFixed(1)}`;
    elements.scoreValue.textContent = snapshot.score.toLocaleString();
    elements.comboFill.style.transform = `scaleX(${snapshot.tierProgress.ratio})`;
    elements.comboHint.textContent = snapshot.tierProgress.nextMultiplier
      ? `×${snapshot.tierProgress.nextMultiplier.toFixed(1)}까지 클린 토큰 ${snapshot.tierProgress.remaining}개`
      : 'MAX ×2.0';
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
  function showResult(summary, { languageKey, playerName, title = 'BUILD FINISHED', subtitle = null, saveable = true }) {
    elements.saveForm.querySelector('label').hidden = !saveable;
    elements.playerName.hidden = !saveable;
    elements.saveButton.hidden = !saveable;
    elements.saveStatus.hidden = !saveable;
    elements.pvpResultNote.hidden = saveable;
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

  return {
    elements, populateLanguages, renderToken, renderStats, setFocusState, log, renderBoard,
    showResult, hideResult, showTimeBonus, setSaveStatus, setSaveButton, kindColor
  };
}
