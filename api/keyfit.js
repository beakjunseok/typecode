// /api/keyfit — 키 위치 편집기의 그림 스킨 키 좌표·글씨 색 덮어쓰기(Vercel Blob에 최신 하나만 둔다).
import { list, put, del } from '@vercel/blob';
import { createKeyfitRoutes } from './_keyfit.js';

const blobStorage = {
  async putJson(prefix, data) {
    await put(`${prefix}.json`, JSON.stringify(data), { access: 'public', addRandomSuffix: true, contentType: 'application/json' });
  },
  async list(prefix) {
    const { blobs } = await list({ prefix, limit: 100 });
    return blobs.map(blob => ({ pathname: blob.pathname, url: blob.url, uploadedAt: new Date(blob.uploadedAt).getTime() }));
  },
  async readJson(file) {
    const response = await fetch(file.url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`keyfit blob ${response.status}`);
    return response.json();
  },
  async remove(urls) {
    await del(urls);
  }
};

export const { GET, POST } = createKeyfitRoutes(blobStorage);
