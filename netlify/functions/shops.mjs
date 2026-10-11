// 친구들과 공유하는 가게 데이터 API (저장소: Netlify Blobs)
import { getStore } from '@netlify/blobs';
import { handle } from '../lib/shops-core.mjs';

export default async (req) => {
  const store = getStore({ name: 'beer-shops', consistency: 'strong' });
  return handle(req, store, process.env);
};

export const config = { path: '/api/shops' };
