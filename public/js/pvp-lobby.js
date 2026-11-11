// 배터리 구조 PvP 로비(게임 화면 위에 뜨는 패널). 화면 전환만 맡고, 연결·경기 흐름은 main.js가 정한다.
// 화면: menu(이름·방 만들기·코드로 참가) → hosting(코드·링크 공유) / joining(진행 상태) → countdown → (경기 중 숨김)
//      → rematch(경기 뒤: 한 판 더 / 나가기) / error
const VIEWS = Object.freeze(['menu', 'hosting', 'joining', 'countdown', 'rematch', 'error']);
const CODE_PATTERN = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;

export function createPvpLobby(root, { onCreate, onJoin, onCancel, onBack, onRematch, onLeave }) {
  const byId = id => root.querySelector(`#${id}`);
  const elements = {
    name: byId('pvpName'), codeInput: byId('pvpCodeInput'), create: byId('pvpCreate'), join: byId('pvpJoin'),
    code: byId('pvpCode'), copy: byId('pvpCopy'), share: byId('pvpShare'), status: root.querySelectorAll('[data-pvp-status]'),
    cancel: root.querySelectorAll('[data-pvp-cancel]'), opponent: byId('pvpOpponent'), countdown: byId('pvpCountdown'),
    error: byId('pvpError'), back: byId('pvpBack'), expires: byId('pvpExpires'),
    rematch: byId('pvpRematch'), leave: byId('pvpLeave'), rematchText: byId('pvpRematchText')
  };
  let currentCode = '';

  // 로비 안 클릭·입력은 게임 입력칸으로 포커스를 뺏기지 않게 여기서 멈춘다
  root.addEventListener('click', event => event.stopPropagation());
  root.addEventListener('keydown', event => event.stopPropagation());

  const name = () => elements.name.value.trim().slice(0, 16) || 'anonymous';
  const normalizedCode = () => elements.codeInput.value.toUpperCase().replace(CODE_PATTERN, '').slice(0, 4);

  elements.codeInput.addEventListener('input', () => {
    elements.codeInput.value = normalizedCode();
    elements.join.disabled = elements.codeInput.value.length !== 4;
  });
  elements.codeInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !elements.join.disabled) elements.join.click();
  });
  elements.create.addEventListener('click', () => onCreate(name()));
  elements.join.addEventListener('click', () => onJoin(normalizedCode(), name()));
  elements.cancel.forEach(button => button.addEventListener('click', () => onCancel()));
  elements.back.addEventListener('click', () => onBack());
  elements.rematch.addEventListener('click', () => onRematch());
  elements.leave.addEventListener('click', () => onLeave());

  const inviteLink = () => `${location.origin}${location.pathname}?room=${currentCode}`;
  elements.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inviteLink());
      elements.copy.textContent = '복사됨 ✓';
    } catch {
      elements.copy.textContent = currentCode;
    }
    setTimeout(() => { elements.copy.textContent = '링크 복사'; }, 1500);
  });
  elements.share.hidden = typeof navigator.share !== 'function';
  elements.share.addEventListener('click', () => {
    navigator.share?.({ title: 'TYPE//CODE 배터리 구조 대결', text: `방 코드 ${currentCode} — 같이 타자 대결해요!`, url: inviteLink() }).catch(() => {});
  });

  function show(view) {
    root.hidden = false;
    for (const name of VIEWS) root.querySelector(`[data-view="${name}"]`).hidden = name !== view;
    if (view === 'menu') elements.join.disabled = normalizedCode().length !== 4;
  }

  return {
    show,
    hide() {
      root.hidden = true;
    },
    get visible() {
      return !root.hidden;
    },
    setName(value) {
      if (!elements.name.value) elements.name.value = value ?? '';
    },
    getName: name,
    prefillCode(code) {
      elements.codeInput.value = String(code ?? '').toUpperCase().replace(CODE_PATTERN, '').slice(0, 4);
      elements.join.disabled = elements.codeInput.value.length !== 4;
    },
    setCode(code, expiresAt) {
      currentCode = code;
      elements.code.textContent = code;
      const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60000));
      elements.expires.textContent = `${minutes}분 동안 유효`;
    },
    setStatus(text) {
      elements.status.forEach(element => { element.textContent = text; });
    },
    setOpponent(opponentName) {
      elements.opponent.textContent = opponentName;
    },
    setCountdown(value) {
      elements.countdown.textContent = String(value);
      elements.countdown.classList.remove('pop');
      void elements.countdown.offsetWidth;
      elements.countdown.classList.add('pop');
    },
    // 경기 뒤 화면: 결과 문구, 버튼 글자(방장 '한 판 더' / 손님 '한 판 더 요청'), 요청을 보냈으면 버튼 잠금
    showRematch({ text, buttonLabel, waiting = false }) {
      elements.rematchText.textContent = text;
      elements.rematch.textContent = buttonLabel;
      elements.rematch.disabled = waiting;
      show('rematch');
    },
    showError(message) {
      elements.error.textContent = message;
      show('error');
    }
  };
}
