// 가게 이름 검색: 네이버 API HUB 지역 검색을 대신 호출해 주는 서버 기능
// 키는 코드에 적지 않고 Netlify 환경변수(NAVER_API_KEY_ID, NAVER_API_KEY)에서 읽어요.

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store'
    },
    body: JSON.stringify(body)
  };
}

function clean(t) {
  return String(t || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .trim();
}

// mapx = 경도, mapy = 위도. 도 단위 또는 10^7 배 정수로 오는 경우를 모두 처리해요.
function toDeg(v) {
  var n = Number(v);
  if (!isFinite(n)) return null;
  if (Math.abs(n) > 1e6) n = n / 1e7;
  return n;
}

function normalize(it) {
  var lng = toDeg(it.mapx), lat = toDeg(it.mapy);
  var ok = lat !== null && lng !== null && lat > 33 && lat < 39 && lng > 124 && lng < 132;
  return {
    name: clean(it.title),
    address: clean(it.roadAddress || it.address),
    category: clean(it.category),
    lat: ok ? lat : null,
    lng: ok ? lng : null
  };
}

exports.handler = async function (event) {
  var q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (q.length < 2 || q.length > 60) return json(400, { error: 'bad_query' });

  var id = process.env.NAVER_API_KEY_ID;
  var key = process.env.NAVER_API_KEY;
  if (!id || !key) return json(500, { error: 'not_configured' });

  var url = 'https://naverapihub.apigw.ntruss.com/search/v1/local?query=' + encodeURIComponent(q) + '&display=5&sort=random';
  try {
    var r = await fetch(url, {
      headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': key }
    });
    if (!r.ok) return json(502, { error: 'upstream', status: r.status });
    var data = await r.json();
    var items = (data.items || []).map(normalize).filter(function (x) { return x.name; });
    return json(200, { items: items });
  } catch (e) {
    return json(502, { error: 'upstream' });
  }
};
