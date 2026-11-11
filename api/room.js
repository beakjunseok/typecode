// /api/room — 배터리 구조 PvP 방 만들기·참가(WebRTC 시그널링). Vercel Blob에 offer/answer를 잠깐 둔다.
import { list, put, del } from '@vercel/blob';
import { createRoomRoutes } from './_rooms.js';

const blobStorage = {
  async putJson(pathname, data) {
    await put(pathname, JSON.stringify(data), { access: 'public', addRandomSuffix: true, contentType: 'application/json' });
  },
  async list(prefix, limit = 1000) {
    const { blobs } = await list({ prefix, limit });
    return blobs.map(blob => ({ pathname: blob.pathname, url: blob.url, uploadedAt: new Date(blob.uploadedAt).getTime() }));
  },
  async readJson(file) {
    const response = await fetch(file.url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`room blob ${response.status}`);
    return response.json();
  },
  async remove(urls) {
    await del(urls);
  }
};

export const { GET, POST } = createRoomRoutes(blobStorage);
