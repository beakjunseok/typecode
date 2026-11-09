import {
  BOARD_SIZE, HttpError, getWeekLabel, jsonResponse, loadWeeklyEntries, rankEntries, readJsonBody,
  sanitizeName, sessionAlreadySubmitted, storeEntry, toPublicEntry, validateSubmission, verifySessionToken, withErrorHandling
} from './_lib.js';

// 이번 주 TOP 10. 엣지에서 5초 캐시해 list 호출 수를 줄인다.
export const GET = withErrorHandling(async () => {
  const week = getWeekLabel();
  const top = rankEntries(await loadWeeklyEntries(week)).slice(0, BOARD_SIZE).map(toPublicEntry);
  return jsonResponse({ week, entries: top }, 200, { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=30' });
});

// 점수 제출: 서명 검증(401) → 값 검증(422) → 중복 세션(409) → 저장. 주차는 세션 시작 시각 기준.
export const POST = withErrorHandling(async request => {
  const body = await readJsonBody(request);
  const session = verifySessionToken(body.token);
  const verified = validateSubmission(session, body);
  const week = getWeekLabel(session.startedAt);

  if (await sessionAlreadySubmitted(week, session.sid)) {
    throw new HttpError(409, 'already_submitted', '이미 등록된 기록입니다');
  }
  const entry = { name: sanitizeName(body.name), language: session.language, ...verified, achievedAt: Date.now() };
  await storeEntry(week, session.sid, entry);

  const stored = await loadWeeklyEntries(week);
  if (!stored.some(item => item.sid === session.sid)) stored.push({ ...entry, sid: session.sid });
  const ranked = rankEntries(stored);
  const myRank = ranked.findIndex(item => item.sid === session.sid) + 1;

  return jsonResponse({
    week,
    myRank,
    myEntry: toPublicEntry({ ...entry, sid: session.sid }, myRank - 1),
    entries: ranked.slice(0, BOARD_SIZE).map(toPublicEntry)
  }, 201);
});
