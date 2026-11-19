// 게임 설명·튜토리얼 창: ❓ 버튼을 눌렀을 때만 연다(자동으로 뜨지 않음).
// 「튜토리얼」은 한 장씩 넘기는 단계 카드이고, 마지막 장에서 실제 낱말을 직접 쳐 본다.
// 「설명」은 목표·조작키·팁을 한눈에 보는 요약이다. 내용은 각 엔진의 규칙 상수와 맞춰 적었다.

import { GUIDE_SHOTS } from './guide-shots.js';

export const GUIDES = Object.freeze({
  practice: {
    title: '⌨ 연습',
    goal: '가운데 나오는 코드 토큰을 한 글자씩 정확하게 칩니다. 정해진 시간 안에 많이, 정확하게 칠수록 점수가 높아요.',
    steps: [
      { icon: '🖼', title: '화면 구성', text: '번호가 붙은 곳이 각각 무엇인지 확인하세요. 아래 목록에 마우스를 올리면 그 자리가 반짝여요.', shot: 'practice-overview' },
      { icon: '🖱', title: '시작 준비', text: '입력 영역을 클릭(탭)하세요. 첫 키를 누르는 순간부터 타이머가 돌아요.' },
      { icon: '⌨', title: '토큰 치기', text: '가운데 큰 토큰을 그대로 칩니다. 다 치면 다음 토큰이 자동으로 와요. 아래 줄에 다음 토큰들이 미리 보여요.', shot: 'practice-overview' },
      { icon: '🔥', title: '콤보와 배율', text: '틀리지 않고 이어 치면 콤보가 쌓여요. 10콤보 ×1.5, 30콤보 ×2.0 배율. 오타가 나면 콤보가 0으로 돌아가요.', shot: 'practice-combo' },
      { icon: '⏳', title: '시간 고르기', text: '30·60·120초 중 고르거나 ⏳연장을 고르세요. 연장은 20초로 시작해 토큰을 맞출 때마다 시간이 늘어나요(최대 30초까지 쌓임). 긴 토큰일수록 많이 늘어요.', shot: 'practice-overview' },
      { icon: '✍', title: '직접 쳐 보기', text: '아래 낱말을 그대로 쳐 보세요.', practice: 'const' }
    ],
    keys: [['Backspace', '틀린 글자 지우기'], ['Enter', '지금 토큰 건너뛰기(틀린 것으로 처리)'], ['Esc', '처음부터 다시']],
    tips: ['속도보다 정확도가 먼저예요 — 오타는 콤보를 끊어요.', '기호 토큰( => , !== 등)은 손가락 위치를 미리 익혀 두세요.']
  },
  throw: {
    title: '📱 휴대폰 던지기',
    goal: '오른쪽에서 다가오는 로봇이 내 책상에 닿기 전에 휴대폰을 던져 쓰러뜨리세요. 50마리를 처치하면 보스가 나오고, 보스를 쓰러뜨리면 승리!',
    steps: [
      { icon: '🖼', title: '화면 구성', text: '로봇은 위에서 아래로 내려와요. 번호가 붙은 곳을 확인하세요.', shot: 'throw-overview' },
      { icon: '🎯', title: '조준', text: '로봇 발밑의 낱말 첫 글자를 치면 그 로봇이 조준돼요(잠김). 첫 글자는 화면에 있는 낱말끼리 겹치지 않아요.', shot: 'throw-aim' },
      { icon: '📱', title: '발사', text: '조준한 낱말을 끝까지 치면 휴대폰이 날아가 로봇을 맞혀요. 틀린 글자는 Backspace로 지워야 이어서 칠 수 있어요.', shot: 'throw-fire' },
      { icon: '💔', title: '생명', text: '로봇이 책상에 닿으면 생명이 1 줄어요. 생명 3개가 다 없어지면 끝.', shot: 'throw-life' },
      { icon: '🔋', title: '아이템', text: '지나가는 아이템 낱말도 치면 가져가요. 🔋 건전지 = 생명 회복, 💻 노트북 = 8초간 두 개씩 던지기.', shot: 'throw-items' },
      { icon: '🤖', title: '특수 로봇', text: '시간이 지나면 편대가 나와요. 거울봇(글자가 거꾸로 보임) · 쌍둥이(한 번에 둘) · 방패 편대(🔒 방패봇부터) · 카멜레온(3초마다 낱말이 바뀜, 치는 중엔 그대로) · 분열봇(쓰러지면 꼬마봇 둘).', shot: 'throw-special' },
      { icon: '👾', title: '보스', text: '서버봇·프린터봇·해커봇 중 하나가 나와요. 보스가 쏘는 패드·종이의 낱말을 쳐서 막고, 보스 낱말을 쳐서 맞히세요. 보스가 책상에 닿으면 바로 패배.', shot: 'throw-boss' },
      { icon: '✍', title: '직접 쳐 보기', text: '로봇 발밑 낱말이라고 생각하고 쳐 보세요.', practice: 'return' }
    ],
    keys: [['첫 글자', '로봇 조준'], ['Backspace', '틀린 글자 지우기'], ['Enter', '친 낱말 지우기(조준 풀기)'], ['Esc', '처음부터 다시']],
    tips: ['가까운 로봇부터 처리하세요.', '방패 편대는 앞의 방패봇을 먼저 쓰러뜨려야 뒤 로봇을 칠 수 있어요.', '쌍둥이는 같은 낱말이라 한 번에 둘을 잡아요.']
  },
  battery: {
    title: '🔋 배터리 구조',
    goal: '내 폰과 방전봇이 각자 배터리 셀 탑 위에 서 있고, 두 탑은 계속 바다로 가라앉아요. 8칸(100%)을 채우면 충전 드론이 구조해 승리, 0칸이 되면 패배.',
    steps: [
      { icon: '🖼', title: '화면 구성', text: '왼쪽이 내 탑, 오른쪽이 방전봇 탑이에요. 번호가 붙은 곳을 확인하세요.', shot: 'battery-overview' },
      { icon: '⚔', title: '공격(뺏기)', text: '방전봇 탑 꼭대기 셀의 낱말을 치면 셀 0.5칸을 뺏어 와요(상대 −0.5, 나 +0.5). 방전봇도 내 탑 낱말을 쳐서 똑같이 뺏어 가요.', shot: 'battery-attack' },
      { icon: '🔋', title: '아이템 줍기', text: '바다 위로 지나가는 아이템 낱말을 먼저 끝까지 친 쪽이 가져가요. 셀 +0.5, 보조배터리 +1, 그 밖엔 특수 효과.', shot: 'battery-items' },
      { icon: '🃏', title: '아이템 덱', text: '시작 전 준비 칸에서 12종 중 4개를 골라요. 배터리 셀은 늘 나오고, 고른 4종만 바다에 떠다녀요. 반사 방패(뺏기 되돌리기), 난독화(상대 낱말이 길어짐), 셀 자석, 오버클럭(뺏기 2배), 백신 패치, 함정 셀, 행운 낚시 등.', shot: 'battery-prep' },
      { icon: '🤖', title: '상대 6종', text: '돌격봇 → 수비봇 → 도박봇 → 얌체봇 → 느림보 보스 → 미러봇 순서로 상대해요. 이기면 다음 상대로 넘어가요. 성격마다 노리는 게 달라요.', shot: 'battery-persona' },
      { icon: '🌊', title: '바다 날씨', text: '판마다 날씨가 바뀌어요. 잔잔함 · 파도(10초마다 크게 가라앉음) · 폭풍(아이템 2배, 대신 빠름) · 해류(아이템이 방전봇 쪽에서 옴) · 썰물(덜 가라앉음).', shot: 'battery-weather' },
      { icon: '✍', title: '직접 쳐 보기', text: '방전봇 탑 낱말이라고 생각하고 쳐 보세요.', practice: 'import' }
    ],
    keys: [['첫 글자', '그 낱말 잡기(공격·아이템)'], ['Backspace', '틀린 글자 지우기'], ['Enter', '친 낱말 지우기'], ['Esc', '처음부터 다시']],
    tips: ['내 탑이 낮을 땐 짧은 아이템 낱말부터 노리세요.', '🪞 반사 방패가 있으면 방전봇이 뺏으려다 오히려 잃어요.', '👥 PvP로 친구와 방 코드로 대결할 수도 있어요.']
  },
  rhythm: {
    title: '🎵 코딩 리듬',
    goal: '코드 낱말이 한 글자씩 원 노트로 박자에 맞춰 떨어져요. 원이 판정선에 닿는 순간 그 글자를 치세요. 곡을 끝까지 버티면 클리어.',
    steps: [
      { icon: '🖼', title: '화면 구성', text: '글자 노트가 위에서 판정선으로 떨어져요. 번호가 붙은 곳을 확인하세요.', shot: 'rhythm-overview' },
      { icon: '🎶', title: '곡 고르기', text: '목록에서 곡과 난이도를 고르세요. 글자 키를 치면 곡이 시작돼요.', shot: 'rhythm-select' },
      { icon: '🖐', title: '4개 레인', text: '레인은 손가락 구역이에요 — 왼손 바깥 · 왼손 안쪽 · 오른손 안쪽 · 오른손 바깥. 그 글자를 치는 손 쪽으로 떨어져요.', shot: 'rhythm-overview' },
      { icon: '🎯', title: '판정', text: '판정선에 딱 맞으면 PERFECT, 조금 어긋나면 GREAT · GOOD · BAD, 놓치면 MISS. 낱말 하나를 오타 없이 GOOD 이상으로 치면 보너스.', shot: 'rhythm-judge' },
      { icon: '━', title: '롱노트', text: '막대 모양 노트는 머리에서 키를 누르고 꼬리까지 누르고 있어야 성공이에요. 너무 일찍 떼면 끊겨요.', shot: 'rhythm-hold' },
      { icon: '🔥', title: '피버', text: 'GOOD 이상으로 게이지가 차면 피버 레벨이 올라요(최대 5, 점수 최대 +50%). BAD · MISS · 오타가 나면 피버가 끝나요.' },
      { icon: '✍', title: '직접 쳐 보기', text: '박자를 생각하며 한 글자씩 쳐 보세요.', practice: 'beat' }
    ],
    keys: [['글자 키', '판정선의 노트 치기'], ['꾹 누르기', '롱노트 유지'], ['Esc', '처음부터 다시']],
    tips: ['화면보다 소리(박자)를 믿으세요.', '롱노트 중엔 다른 손으로 다음 글자를 준비하세요.']
  },
  defense: {
    title: '🛡️ 컴퓨터 디펜스',
    goal: '해킹 공격이 길을 따라 컴퓨터로 와요. 공격을 막는 건 타워뿐! 낱말을 쳐서 코인을 벌고, 그 코인으로 타워를 세워 25웨이브를 버티세요.',
    steps: [
      { icon: '🖼', title: '화면 구성', text: '왼쪽이 싸움터, 오른쪽이 코인을 버는 낱말 칸, 아래가 상점이에요.', shot: 'defense-overview' },
      { icon: '🪙', title: '코인 벌기', text: '오른쪽(휴대폰은 아래)에 낱말이 차례로 올라와요. 하나 칠 때마다 코인을 벌어요. 길수록, 콤보가 높을수록 많이 벌어요.', shot: 'defense-overview' },
      { icon: '🏗', title: '타워 세우기', text: '상점에서 타워를 누르거나 숫자 키를 누른 뒤, 길이 아닌 빈 곳을 누르거나 자리 번호(1~9)를 눌러 세워요. Esc로 취소.', shot: 'defense-build' },
      { icon: '⬆', title: '강화와 수리', text: '세운 타워를 누르면 강화돼요. 컴퓨터 체력이 깎이면 상점의 수리(patch)로 회복하세요.' },
      { icon: '🛸', title: '공중 공격', text: '4웨이브부터 길을 무시하고 날아오는 드론이 섞여요. 드론은 EMP포와 요격포만 맞힐 수 있어요.', shot: 'defense-air' },
      { icon: '🃏', title: '카드와 보스', text: '3웨이브마다 카드 중 하나를 골라 타워를 강화해요(숫자 키로도 선택). 5 · 10 · 15 · 20 · 25웨이브 끝에 랜섬웨어 · 루트킷 보스가 나와요.', shot: 'defense-draft' },
      { icon: '🗺', title: '매번 다른 지도', text: '판마다 길 모양이 무작위로 바뀌어요. 길이 꺾이는 곳 근처가 타워 자리로 좋아요.' },
      { icon: '✍', title: '직접 쳐 보기', text: '코인을 버는 낱말이라고 생각하고 쳐 보세요.', practice: 'firewall' }
    ],
    keys: [['글자', '낱말 쳐서 코인'], ['1~6', '상점 고르기(방화벽·허니팟·백신·EMP포·요격포·수리)'], ['1~9', '설치 자리 / 카드 고르기'], ['Esc', '설치 취소']],
    tips: ['초반엔 싼 방화벽으로 감속부터 걸어 두세요.', '4웨이브 전에 EMP포나 요격포를 하나 준비하세요.', '보스는 체력 절반에서 2페이즈로 바뀌어요.']
  }
});

const STORAGE_KEY = 'typecode:guide-tab';

// 튜토리얼·설명 창. root = #guideModal. open(mode)로 그 모드 내용을 그린다
export function createGuide(root, { onOpen, onClose, sound } = {}) {
  if (!root) return { open() {}, close() {}, isOpen: () => false };
  const card = root.querySelector('.guide-card');
  const elements = {
    title: root.querySelector('#guideTitle'),
    tabs: [...root.querySelectorAll('[data-guide-tab]')],
    tutorial: root.querySelector('[data-guide-panel="tutorial"]'),
    summary: root.querySelector('[data-guide-panel="summary"]'),
    close: root.querySelector('#guideClose')
  };
  const state = { mode: null, step: 0, tab: 'tutorial', practiced: false };

  function readTab() {
    try { return localStorage.getItem(STORAGE_KEY) === 'summary' ? 'summary' : 'tutorial'; } catch { return 'tutorial'; }
  }

  // 탭 전환(튜토리얼 ↔ 설명)
  function setTab(tab) {
    state.tab = tab === 'summary' ? 'summary' : 'tutorial';
    try { localStorage.setItem(STORAGE_KEY, state.tab); } catch { /* 저장 못 해도 동작엔 지장 없음 */ }
    elements.tabs.forEach(button => button.setAttribute('aria-selected', String(button.dataset.guideTab === state.tab)));
    elements.tutorial.hidden = state.tab !== 'tutorial';
    elements.summary.hidden = state.tab !== 'summary';
    if (state.tab === 'tutorial') renderStep(); else renderSummary();
  }

  // 튜토리얼 한 장: 진행 점 + 큰 아이콘 + 설명 + (마지막 장) 직접 쳐 보기
  function renderStep() {
    const guide = GUIDES[state.mode];
    const steps = guide.steps;
    const step = steps[state.step];
    const last = state.step === steps.length - 1;
    const dots = steps.map((_, index) => `<i class="${index === state.step ? 'on' : index < state.step ? 'done' : ''}"></i>`).join('');
    elements.tutorial.innerHTML = `
      <div class="guide-dots" aria-hidden="true">${dots}</div>
      <div class="guide-step" aria-live="polite">
        ${step.shot ? '' : `<div class="guide-icon" aria-hidden="true">${step.icon}</div>`}
        <h4>${state.step + 1}. ${escapeHtml(step.title)}</h4>
        <p>${escapeHtml(step.text)}</p>
        ${step.shot ? shotMarkup(step.shot) : ''}
        ${step.practice ? practiceMarkup(step.practice) : ''}
      </div>
      <div class="guide-nav">
        <button type="button" data-guide-nav="prev" ${state.step === 0 ? 'disabled' : ''}>← 이전</button>
        <span>${state.step + 1} / ${steps.length}</span>
        <button type="button" class="primary" data-guide-nav="${last ? 'done' : 'next'}">${last ? '시작하러 가기' : '다음 →'}</button>
      </div>`;
    if (step.practice) bindPractice(step.practice);
    bindShotHighlights(elements.tutorial);
  }

  function practiceMarkup(word) {
    const letters = [...word].map(letter => `<span>${escapeHtml(letter)}</span>`).join('');
    return `<div class="guide-practice">
      <div class="guide-word" data-word>${letters}</div>
      <input class="guide-input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="연습 낱말 입력" maxlength="${word.length + 4}">
      <p class="guide-feedback" data-feedback>여기에 쳐 보세요</p>
    </div>`;
  }

  // 직접 쳐 보기: 맞은 글자 초록, 틀린 글자 빨강. 다 맞으면 완료 표시
  function bindPractice(word) {
    const input = elements.tutorial.querySelector('.guide-input');
    const letters = [...elements.tutorial.querySelectorAll('[data-word] span')];
    const feedback = elements.tutorial.querySelector('[data-feedback]');
    if (!input) return;
    const update = () => {
      const typed = input.value;
      let firstWrong = -1;
      letters.forEach((letter, index) => {
        const character = typed[index];
        const correct = character === word[index];
        if (character !== undefined && !correct && firstWrong < 0) firstWrong = index;
        letter.className = character === undefined ? (index === typed.length ? 'next' : '') : correct && (firstWrong < 0 || index < firstWrong) ? 'ok' : 'bad';
      });
      if (typed === word) {
        feedback.textContent = '✔ 완벽해요! 이제 시작해 볼까요?';
        feedback.className = 'guide-feedback ok';
        input.disabled = true;
        state.practiced = true;
        sound?.play?.('uiClick');
      } else if (firstWrong >= 0 || typed.length > word.length) {
        feedback.textContent = '틀린 글자가 있어요 — Backspace로 지우고 다시';
        feedback.className = 'guide-feedback bad';
      } else {
        feedback.textContent = typed.length ? `${typed.length} / ${word.length}` : '여기에 쳐 보세요';
        feedback.className = 'guide-feedback';
      }
    };
    input.addEventListener('input', update);
    update();
  }

  // 설명: 목표 · 조작키 · 팁
  function renderSummary() {
    const guide = GUIDES[state.mode];
    const keys = guide.keys.map(([key, action]) => `<tr><th><kbd>${escapeHtml(key)}</kbd></th><td>${escapeHtml(action)}</td></tr>`).join('');
    const tips = guide.tips.map(tip => `<li>${escapeHtml(tip)}</li>`).join('');
    const steps = guide.steps.filter(step => !step.practice && step.title !== '화면 구성').map(step => `<li><b>${step.icon} ${escapeHtml(step.title)}</b> ${escapeHtml(step.text)}</li>`).join('');
    const overview = guide.steps.find(step => step.shot?.endsWith('-overview'))?.shot;
    elements.summary.innerHTML = `
      <h4>목표</h4><p>${escapeHtml(guide.goal)}</p>
      ${overview ? `<h4>화면 한눈에</h4>${shotMarkup(overview)}` : ''}
      <h4>규칙</h4><ul class="guide-rules">${steps}</ul>
      <h4>조작</h4><table class="guide-keys">${keys}</table>
      <h4>팁</h4><ul class="guide-tips">${tips}</ul>`;
    bindShotHighlights(elements.summary);
  }

  function open(mode) {
    if (!GUIDES[mode]) return;
    state.mode = mode;
    state.step = 0;
    state.practiced = false;
    elements.title.textContent = `${GUIDES[mode].title} — 게임 방법`;
    root.hidden = false;
    setTab(readTab());
    onOpen?.();
    requestAnimationFrame(() => (card.querySelector('[data-guide-nav="next"], [data-guide-nav="done"]') ?? elements.close)?.focus({ preventScroll: true }));
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    onClose?.();
  }

  elements.tabs.forEach(button => button.addEventListener('click', () => setTab(button.dataset.guideTab)));
  elements.close.addEventListener('click', close);
  root.addEventListener('click', event => {
    if (event.target === root) return close();
    const nav = event.target.closest('[data-guide-nav]');
    if (!nav) return;
    const steps = GUIDES[state.mode].steps;
    if (nav.dataset.guideNav === 'prev') state.step = Math.max(0, state.step - 1);
    else if (nav.dataset.guideNav === 'next') state.step = Math.min(steps.length - 1, state.step + 1);
    else return close();
    renderStep();
    // 직접 쳐 보기 장이면 입력칸(bindPractice가 포커스), 아니면 다음 버튼에 포커스
    const input = elements.tutorial.querySelector('.guide-input');
    (input ?? elements.tutorial.querySelector('[data-guide-nav="next"], [data-guide-nav="done"]'))?.focus({ preventScroll: true });
  });
  // 창 안의 키 입력이 게임(리듬 구역 안내·Esc 재시작 등)으로 새지 않게 막는다. ←/→로 넘기기
  root.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.target.classList?.contains('guide-input') || state.tab !== 'tutorial') return;
    if (event.key === 'ArrowRight') root.querySelector('[data-guide-nav="next"]')?.click();
    if (event.key === 'ArrowLeft') root.querySelector('[data-guide-nav="prev"]')?.click();
  });

  // 포커스가 창 밖(본문 등)에 있어도 Esc로 닫히게: 캡처 단계에서 먼저 받아 게임 쪽 Esc(재시작)로 새지 않게 한다
  document.addEventListener('keydown', event => {
    if (root.hidden || event.key !== 'Escape' || root.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }, true);

  return { open, close, isOpen: () => !root.hidden };
}

// 캡처 + 번호 상자 + 번호 목록. 상자 위치는 이미지 대비 %라 창 크기가 바뀌어도 맞는다
function shotMarkup(shotId) {
  const shot = GUIDE_SHOTS[shotId];
  if (!shot) return '';
  let number = 0;
  const marks = shot.marks.map((mark, index) => {
    const label = mark.label ? ++number : null;
    const style = `left:${mark.x}%;top:${mark.y}%;width:${mark.w}%;height:${mark.h}%`;
    return `<div class="guide-mark${label ? '' : ' plain'}" data-mark="${index}" style="${style}">${label ? `<b>${label}</b>` : ''}</div>`;
  }).join('');
  number = 0;
  const legend = shot.marks.map((mark, index) => mark.label ? `<li data-mark="${index}"><b>${++number}</b>${escapeHtml(mark.label)}</li>` : '').join('');
  return `<figure class="guide-shot">
      <div class="guide-shot-frame" style="aspect-ratio:${shot.width} / ${shot.height}">
        <img src="/art/guide/${shotId}.webp" alt="" loading="lazy" decoding="async" width="${shot.width}" height="${shot.height}">
        ${marks}
      </div>
      <ol class="guide-legend">${legend}</ol>
    </figure>`;
}

// 번호 목록에 마우스를 올리거나 누르면 그 상자를 강조한다
function bindShotHighlights(container) {
  container.querySelectorAll('.guide-shot').forEach(figure => {
    const toggle = (index, on) => figure.querySelectorAll(`[data-mark="${index}"]`).forEach(node => node.classList.toggle('lit', on));
    figure.querySelectorAll('.guide-legend li, .guide-mark').forEach(node => {
      node.addEventListener('mouseenter', () => toggle(node.dataset.mark, true));
      node.addEventListener('mouseleave', () => toggle(node.dataset.mark, false));
    });
  });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
