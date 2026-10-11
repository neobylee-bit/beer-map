// 공유 가게 데이터 처리 (저장소는 바깥에서 넣어 줘요: 실제로는 Netlify Blobs, 테스트에서는 메모리)
// 인증: 헤더 x-access-code (환경변수 ACCESS_CODE와 같아야 함), x-nick (닉네임)

const AX = ['temp', 'foam', 'line', 'fresh', 'glass'];
const REPORT_KINDS = ['탭 리스트가 바뀌었어요', '가격이 달라졌어요', '폐업했거나 쉬고 있어요', '위치가 달라요', '기타'];
const MAX_SHOPS = 1000;

function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function out(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
function str(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, max);
}
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function norm(t) {
  return String(t || '').toLowerCase().replace(/[\s\-·.()]/g, '');
}
function distM(a, b, c, d) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (c - a) * r, dLng = (d - b) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function authenticate(req, env) {
  const expected = env.ACCESS_CODE;
  if (!expected) return { err: out(500, { error: 'not_configured' }) };
  const code = req.headers.get('x-access-code') || '';
  if (code !== expected) return { err: out(401, { error: 'bad_code' }) };
  let nick = '';
  try { nick = decodeURIComponent(req.headers.get('x-nick') || ''); } catch (e) { nick = ''; }
  nick = str(nick, 12);
  if (!nick) return { err: out(400, { error: 'bad_nick' }) };
  return { nick, key: nick.toLowerCase() };
}

function publicShop(s, key, today) {
  const v = s.votes || { c: {}, r: {}, p: {} };
  const { votes, by, created, ...rest } = s;
  return { ...rest, my: { c: v.c && v.c[key] === today ? true : false, r: v.r && v.r[key] === today ? true : false, p: !!(v.p && v.p[key]) } };
}

async function loadAll(store) {
  const { blobs } = await store.list({ prefix: 'shop:' });
  const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' }).catch(() => null)));
  return items.filter(Boolean);
}

function validateNew(b, nick, today) {
  const name = str(b.name, 40);
  if (!name) return { error: 'bad_name' };
  const lat = num(b.lat), lng = num(b.lng);
  if (lat == null || lng == null || lat < 33 || lat > 39 || lng < 124 || lng > 132) return { error: 'bad_location' };
  if (!Array.isArray(b.kegs) || !b.kegs.length || b.kegs.length > 5) return { error: 'bad_kegs' };
  const kegs = [];
  for (const k of b.kegs) {
    const brand = str(k && k.brand, 40), style = str(k && k.style, 12);
    const ml = num(k && k.ml), price = num(k && k.price);
    if (!brand || !style || ml == null || ml < 100 || ml > 3000 || price == null || price < 100 || price > 200000) return { error: 'bad_kegs' };
    kegs.push({ brand, style, ml: Math.round(ml), price: Math.round(price) });
  }
  let ratings = { temp: 0, foam: 0, line: 0, fresh: 0, glass: 0 }, rn = 0;
  if (b.ratings && Number(b.rn) >= 1) {
    const r = {};
    for (const a of AX) {
      const v = num(b.ratings[a]);
      if (v == null) { r.bad = true; break; }
      r[a] = Math.min(5, Math.max(1, v));
    }
    if (!r.bad) { ratings = r; rn = 1; }
  }
  return {
    shop: {
      id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, address: str(b.address, 120), category: str(b.category, 60), area: str(b.area, 20),
      lat, lng, reports: 0, kegs, ratings, rn, confirms: 1, last: today,
      log: [{ d: today, x: '가게 등록' }],
      votes: { c: { [nick.toLowerCase()]: today }, r: rn ? { [nick.toLowerCase()]: today } : {}, p: {} },
      by: nick, created: new Date().toISOString()
    }
  };
}

function findDup(all, shop) {
  return all.find((s) => distM(s.lat, s.lng, shop.lat, shop.lng) < 150 && (norm(s.name) === norm(shop.name) || norm(s.name).includes(norm(shop.name)) || norm(shop.name).includes(norm(s.name))));
}

function pushLog(s, d, x) {
  s.log = (s.log || []).concat([{ d, x }]).slice(-60);
}

export async function handle(req, store, env) {
  const au = authenticate(req, env);
  if (au.err) return au.err;
  const today = kstToday();
  const key = au.key;

  if (req.method === 'GET') {
    const all = await loadAll(store);
    return out(200, { today, me: au.nick, mapKey: env.NAVER_MAP_CLIENT_ID || '', shops: all.map((s) => publicShop(s, key, today)) });
  }
  if (req.method !== 'POST') return out(405, { error: 'method' });

  let b;
  try { b = await req.json(); } catch (e) { return out(400, { error: 'bad_json' }); }
  const action = b && b.action;

  if (action === 'add' || action === 'import') {
    const list = action === 'import' ? (Array.isArray(b.shops) ? b.shops.slice(0, 200) : []) : [b];
    const all = await loadAll(store);
    if (all.length + list.length > MAX_SHOPS) return out(409, { error: 'full' });
    const added = [];
    let skipped = 0, dupName = '';
    for (const item of list) {
      const v = validateNew(item, au.nick, today);
      if (v.error) { if (action === 'add') return out(400, { error: v.error }); skipped++; continue; }
      const dup = findDup(all.concat(added), v.shop);
      if (dup) { if (action === 'add') return out(409, { error: 'dup', name: dup.name, id: dup.id }); skipped++; continue; }
      await store.setJSON('shop:' + v.shop.id, v.shop);
      added.push(v.shop);
    }
    if (action === 'add') return out(200, { today, shop: publicShop(added[0], key, today) });
    return out(200, { today, added: added.length, skipped });
  }

  const id = str(b && b.id, 40);
  if (!id) return out(400, { error: 'bad_id' });
  const s = await store.get('shop:' + id, { type: 'json' }).catch(() => null);
  if (!s) return out(404, { error: 'not_found' });
  s.votes = s.votes || { c: {}, r: {}, p: {} };
  s.votes.c = s.votes.c || {}; s.votes.r = s.votes.r || {}; s.votes.p = s.votes.p || {};

  if (action === 'confirm') {
    if (s.votes.c[key] === today) return out(409, { error: 'already', shop: publicShop(s, key, today), today });
    s.confirms += 1; s.last = today; s.votes.c[key] = today;
    pushLog(s, today, '방문 확인, 정보가 맞아요');
  } else if (action === 'rate') {
    if (s.votes.r[key] === today) return out(409, { error: 'already', shop: publicShop(s, key, today), today });
    const v = {};
    for (const a of AX) {
      const n = num(b.v && b.v[a]);
      if (n == null) return out(400, { error: 'bad_rating' });
      v[a] = Math.min(5, Math.max(1, n));
    }
    for (const a of AX) s.ratings[a] = s.rn ? (s.ratings[a] * s.rn + v[a]) / (s.rn + 1) : v[a];
    s.rn += 1; s.votes.r[key] = today;
    const mean = AX.reduce((t, a) => t + v[a], 0) / AX.length;
    pushLog(s, today, '맛 평가 ' + mean.toFixed(1) + '점');
  } else if (action === 'report') {
    if (s.votes.p[key]) return out(409, { error: 'already', shop: publicShop(s, key, today), today });
    const kind = REPORT_KINDS.includes(b.kind) ? b.kind : '기타';
    const note = str(b.note, 40);
    s.reports += 1; s.votes.p[key] = today;
    pushLog(s, today, '수정 제안: ' + kind + (note ? ' (' + note + ')' : ''));
  } else {
    return out(400, { error: 'bad_action' });
  }
  await store.setJSON('shop:' + s.id, s);
  return out(200, { today, shop: publicShop(s, key, today) });
}
