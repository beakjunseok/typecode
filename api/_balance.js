// 밸런스 통계 저장·집계. 판 하나 = 빈 blob 하나, 내용은 경로에 base64로 담아 list 한 번으로 읽는다(점수판과 같은 방식).
// 저장소는 주입식(테스트는 메모리). 세션 토큰(서명)으로 판마다 한 번만 받는다.
import { HttpError, jsonResponse, readJsonBody, verifySessionToken, withErrorHandling, getWeekLabel } from './_lib.js';
import { REPORT_MODES, normalizeReport, aggregate } from '../public/js/balance-report.js';

const PREFIX = 'bal';
const MAX_WEEKS = 12;
const MAX_REPORTS = 5000;

export const reportPrefix = (mode, week) => `${PREFIX}-${mode}/${week}/`;

// 지난 몇 주의 주차 이름(이번 주부터 거꾸로)
export function recentWeeks(count, now = Date.now()) {
  const weeks = [];
  for (let index = 0; index < count; index++) {
    const week = getWeekLabel(now - index * 7 * 24 * 60 * 60 * 1000);
    if (!weeks.includes(week)) weeks.push(week);
  }
  return weeks;
}

export function decodeReportPath(mode, pathname) {
  try {
    const payload = pathname.split('/').pop().split('.')[1];
    return normalizeReport(mode, JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

export function createBalanceRoutes(storage) {
  // POST { token, report }: 서명 확인 → 모드 일치 → 형식 정리 → 판마다 한 번 저장
  const POST = withErrorHandling(async request => {
    const body = await readJsonBody(request);
    const session = verifySessionToken(body.token);
    if (!REPORT_MODES.includes(session.mode)) throw new HttpError(422, 'unsupported_mode', '통계를 받지 않는 모드입니다');
    const report = normalizeReport(session.mode, body.report);
    if (!report) throw new HttpError(422, 'invalid_report', '통계 형식이 올바르지 않습니다');
    if (report.s * 1000 > Date.now() - session.startedAt + 5000) throw new HttpError(422, 'too_early', '판 길이가 서버 시간과 맞지 않습니다');
    const week = getWeekLabel(session.startedAt);
    const prefix = `${reportPrefix(session.mode, week)}${session.sid}.`;
    if (await storage.exists(prefix)) throw new HttpError(409, 'already_reported', '이미 받은 판입니다');
    await storage.save(`${prefix}${Buffer.from(JSON.stringify(report)).toString('base64url')}.json`);
    return jsonResponse({ ok: true }, 201);
  });

  // GET ?mode=defense&weeks=4[&raw=1]: 지난 weeks주 집계(raw=1이면 정리된 기록 목록도)
  const GET = withErrorHandling(async request => {
    const params = new URL(request.url).searchParams;
    const mode = params.get('mode');
    if (!REPORT_MODES.includes(mode)) throw new HttpError(422, 'invalid_mode', 'mode는 defense·battery·throw 중 하나');
    const weeks = Math.max(1, Math.min(MAX_WEEKS, Number(params.get('weeks')) || 4));
    const reports = [];
    for (const week of recentWeeks(weeks)) {
      for (const pathname of await storage.list(reportPrefix(mode, week), MAX_REPORTS - reports.length)) {
        const report = decodeReportPath(mode, pathname);
        if (report) reports.push(report);
      }
      if (reports.length >= MAX_REPORTS) break;
    }
    const body = { mode, weeks, ...aggregate(mode, reports), ...(params.get('raw') === '1' ? { reports } : {}) };
    return jsonResponse(body, 200, { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' });
  });

  return { GET, POST };
}
