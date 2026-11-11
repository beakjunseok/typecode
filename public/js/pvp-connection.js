// 배터리 구조 PvP 연결: 방 코드로 두 기기를 WebRTC 데이터 채널로 직접 잇는다.
// 서버(/api/room)는 연결 정보(offer/answer)만 한 번씩 전달한다. ICE 후보를 다 모은 뒤 한 번에 보내서(non-trickle)
// 왕복을 2번으로 줄였다. STUN만 쓰므로 일부 통신사 망(대칭형 NAT)에서는 연결이 안 될 수 있다.
import { parsePvpMessage } from './battery-pvp.js';

const ICE_SERVERS = Object.freeze([
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' }
]);
const GATHER_TIMEOUT_MS = 4000;
const ANSWER_POLL_MS = 1200;
const CONNECT_TIMEOUT_MS = 20_000;
const ROOM_API = '/api/room';
const CLOSE_FLUSH_MS = 300;

export class PvpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function isPvpSupported() {
  return typeof globalThis.RTCPeerConnection === 'function';
}

// ---------- 방 API ----------
async function roomRequest(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new PvpError('network', '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new PvpError(body.error ?? `http_${response.status}`, body.message ?? `서버 오류(${response.status})`);
  return body;
}

const createRoom = (offer, name, settings) =>
  roomRequest(ROOM_API, { method: 'POST', body: JSON.stringify({ action: 'create', offer, name, settings }) });
const fetchRoom = (code, signal) => roomRequest(`${ROOM_API}?code=${encodeURIComponent(code)}`, { signal });
const postAnswer = (code, answer, name) =>
  roomRequest(ROOM_API, { method: 'POST', body: JSON.stringify({ action: 'answer', code, answer, name }) });

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

// 손님이 들어올 때까지 방장이 주기적으로 확인(방은 10분 뒤 만료 → 404로 끝남)
async function waitForAnswer(code, key, signal) {
  for (;;) {
    const result = await roomRequest(`${ROOM_API}?code=${encodeURIComponent(code)}&key=${encodeURIComponent(key)}`, { signal });
    if (result.answer) return result;
    await sleep(ANSWER_POLL_MS, signal);
  }
}

// ---------- WebRTC ----------
function waitForIceGathering(peer) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(done, GATHER_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', check);
      resolve();
    }
    function check() {
      if (peer.iceGatheringState === 'complete') done();
    }
    peer.addEventListener('icegatheringstatechange', check);
  });
}

function withTimeout(promise, ms, error) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(error), ms); })])
    .finally(() => clearTimeout(timer));
}

function waitForOpen(channel) {
  if (channel.readyState === 'open') return Promise.resolve(channel);
  return new Promise((resolve, reject) => {
    channel.addEventListener('open', () => resolve(channel), { once: true });
    channel.addEventListener('close', () => reject(new PvpError('closed', '연결이 닫혔습니다')), { once: true });
  });
}

const CONNECT_FAILED = () => new PvpError('connect_failed',
  '상대 기기와 직접 연결하지 못했습니다. 같은 와이파이에서 하거나 다른 네트워크(와이파이 ↔ 데이터)로 바꿔 보세요');

// 연결된 채널을 감싼다: JSON 메시지 송수신, 닫힘 감지(한 번만 알림).
// 받는 쪽 처리기가 붙기 전에 도착한 메시지(연결 직후 상대의 hello 등)는 모아 두었다가 첫 처리기에 넘긴다
function createConnection(peer, channel, details) {
  const messageHandlers = new Set();
  const closeHandlers = new Set();
  const earlyMessages = [];
  let closed = false;
  const notifyClose = reason => {
    if (closed) return;
    closed = true;
    for (const handler of closeHandlers) handler(reason);
  };
  channel.addEventListener('message', event => {
    const message = parsePvpMessage(event.data);
    if (!message) return;
    if (message.t === 'bye') {
      notifyClose('remote-left');
      return;
    }
    if (messageHandlers.size === 0) earlyMessages.push(message);
    else for (const handler of messageHandlers) handler(message);
  });
  channel.addEventListener('close', () => notifyClose('closed'));
  peer.addEventListener('connectionstatechange', () => {
    if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) notifyClose(peer.connectionState);
  });
  return {
    ...details,
    get open() {
      return !closed && channel.readyState === 'open';
    },
    send(message) {
      if (closed || channel.readyState !== 'open') return false;
      try {
        channel.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      for (const message of earlyMessages.splice(0)) handler(message);
      return () => messageHandlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    // 'bye'가 실제로 나간 뒤 닫는다(바로 닫으면 보내기 버퍼가 버려져 상대가 늦게 알아챔)
    close() {
      if (closed) return;
      try { channel.send(JSON.stringify({ t: 'bye' })); } catch { /* 이미 닫힘 */ }
      notifyClose('local');
      setTimeout(() => {
        channel.close();
        peer.close();
      }, CLOSE_FLUSH_MS);
    }
  };
}

// 방장: 방을 만들고 코드를 알려준 뒤 손님을 기다린다. signal로 취소
export async function hostRoom({ name, settings, onCode, onStatus = () => {}, signal }) {
  if (!isPvpSupported()) throw new PvpError('unsupported', '이 브라우저는 PvP(WebRTC)를 지원하지 않습니다');
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  signal?.addEventListener('abort', () => peer.close(), { once: true });
  try {
    const channel = peer.createDataChannel('typecode-pvp', { ordered: true });
    onStatus('연결 정보 만드는 중…');
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIceGathering(peer);
    const { code, key, expiresAt } = await createRoom(peer.localDescription.toJSON(), name, settings);
    onCode({ code, expiresAt });
    onStatus('상대를 기다리는 중…');
    const { answer, guestName } = await waitForAnswer(code, key, signal);
    onStatus('연결하는 중…');
    await peer.setRemoteDescription(answer);
    await withTimeout(waitForOpen(channel), CONNECT_TIMEOUT_MS, CONNECT_FAILED());
    return createConnection(peer, channel, { role: 'host', code, opponentName: guestName, settings });
  } catch (error) {
    peer.close();
    throw error;
  }
}

// 손님: 코드로 방 정보를 받아 응답하고 연결을 기다린다
export async function joinRoom({ code, name, onStatus = () => {}, signal }) {
  if (!isPvpSupported()) throw new PvpError('unsupported', '이 브라우저는 PvP(WebRTC)를 지원하지 않습니다');
  onStatus('방 찾는 중…');
  const room = await fetchRoom(code, signal);
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  signal?.addEventListener('abort', () => peer.close(), { once: true });
  try {
    const channelReady = new Promise(resolve => peer.addEventListener('datachannel', event => resolve(event.channel), { once: true }));
    await peer.setRemoteDescription(room.offer);
    await peer.setLocalDescription(await peer.createAnswer());
    await waitForIceGathering(peer);
    onStatus('연결하는 중…');
    await postAnswer(code, peer.localDescription.toJSON(), name);
    const channel = await withTimeout(channelReady.then(waitForOpen), CONNECT_TIMEOUT_MS, CONNECT_FAILED());
    return createConnection(peer, channel, { role: 'guest', code: code.toUpperCase(), opponentName: room.hostName, settings: room.settings });
  } catch (error) {
    peer.close();
    throw error;
  }
}
