// 미세미세 앱용 TAGO API 중계 서버 (Cloudflare Worker)
// 공공데이터포털 API는 CORS를 지원하지 않아 브라우저 대신 여기서 호출한다.
// 키(TAGO_KEY)는 Worker Secret — 클라이언트에 노출되지 않음.

const ROUTES = {
  '/citycodes': 'https://apis.data.go.kr/1613000/ArvlInfoInqireService/getCtyCodeList',
  '/arrivals':  'https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList',
  '/stops':     'https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList',
};

const ALLOWED_ORIGINS = [
  'https://thsckdgns33.github.io',
  'http://localhost:8765',
];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const target = ROUTES[url.pathname];
    if (!target) return new Response('Not found', { status: 404, headers: cors });

    const qs = new URLSearchParams(url.search);
    qs.set('serviceKey', env.TAGO_KEY);
    qs.set('_type', 'json');
    if (!qs.has('numOfRows')) qs.set('numOfRows', '30');
    if (!qs.has('pageNo')) qs.set('pageNo', '1');

    const upstream = await fetch(`${target}?${qs}`, {
      cf: { cacheTtl: 15, cacheEverything: true },  // 15초 캐시로 트래픽 절약
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=15',
      },
    });
  },
};
