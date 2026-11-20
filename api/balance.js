// /api/balance — 판마다 아이템·카드 사용과 결과(익명)를 모아 밸런스 조정에 쓴다.
import { list, put } from '@vercel/blob';
import { createBalanceRoutes } from './_balance.js';

const blobStorage = {
  async exists(prefix) {
    const { blobs } = await list({ prefix, limit: 1 });
    return blobs.length > 0;
  },
  async save(pathname) {
    await put(pathname, '{}', { access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
  },
  // prefix 아래 경로 이름들(최대 limit개)
  async list(prefix, limit) {
    const names = [];
    let cursor;
    while (names.length < limit) {
      const result = await list({ prefix, limit: Math.min(1000, limit - names.length), cursor });
      names.push(...result.blobs.map(blob => blob.pathname));
      if (!result.hasMore) break;
      cursor = result.cursor;
    }
    return names;
  }
};

export const { GET, POST } = createBalanceRoutes(blobStorage);
