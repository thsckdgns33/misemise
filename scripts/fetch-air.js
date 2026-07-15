// 에어코리아 전국 실시간 측정 데이터를 받아 data/airkorea.json 으로 저장
// GitHub Actions에서 매시간 실행 (환경변수 AIRKOREA_KEY 필요)
const fs = require('fs');
const path = require('path');

const KEY = process.env.AIRKOREA_KEY;
if (!KEY) { console.error('AIRKOREA_KEY 환경변수가 없습니다.'); process.exit(1); }

const BASE = 'https://apis.data.go.kr/B552584';
const OUT = path.join(__dirname, '..', 'data', 'airkorea.json');
const STATIONS_CACHE = path.join(__dirname, '..', 'data', 'stations.json');

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url.replace(KEY, '***')}`);
  const d = await res.json();
  const header = d?.response?.header;
  if (header && header.resultCode !== '00') throw new Error(`API 오류 ${header.resultCode}: ${header.resultMsg}`);
  return d?.response?.body?.items ?? [];
}

// 측정소 좌표 목록 (거의 안 바뀌므로 캐시 파일 재사용)
async function getStationCoords() {
  if (fs.existsSync(STATIONS_CACHE)) {
    const cached = JSON.parse(fs.readFileSync(STATIONS_CACHE, 'utf8'));
    const age = Date.now() - new Date(cached.updated).getTime();
    if (age < 30 * 24 * 3600 * 1000 && cached.coords) return cached.coords;
  }
  const items = await getJSON(`${BASE}/MsrstnInfoInqireSvc/getMsrstnList?serviceKey=${KEY}&returnType=json&numOfRows=1000&pageNo=1`);
  const coords = {};
  for (const it of items) {
    // dmX/dmY 필드명이 위도/경도 순서가 뒤섞인 사례가 있어 값 범위로 판별 (한국: 위도 33~39, 경도 124~132)
    let a = num(it.dmX), b = num(it.dmY);
    if (a == null || b == null) continue;
    let lat, lon;
    if (a >= 32 && a <= 40 && b >= 123 && b <= 133) { lat = a; lon = b; }
    else if (b >= 32 && b <= 40 && a >= 123 && a <= 133) { lat = b; lon = a; }
    else continue;
    coords[it.stationName] = { lat, lon, addr: it.addr || '' };
  }
  fs.mkdirSync(path.dirname(STATIONS_CACHE), { recursive: true });
  fs.writeFileSync(STATIONS_CACHE, JSON.stringify({ updated: new Date().toISOString(), coords }));
  return coords;
}

// 미세먼지 주의보·경보 발령 현황 (해제 안 된 것만)
async function getAlerts() {
  try {
    const year = new Date().getFullYear();
    const items = await getJSON(
      `${BASE}/UlfptcaAlarmInqireSvc/getUlfptcaAlarmInfo?serviceKey=${KEY}&returnType=json&numOfRows=200&pageNo=1&year=${year}`
    );
    return items
      .filter(it => !it.clearDate || !it.clearTime)
      .map(it => ({
        district: it.districtName,   // 예: 서울, 경북
        item: it.itemCode,           // PM10 | PM25
        level: it.issueGbn,          // 주의보 | 경보
        issueDate: it.issueDate,
        issueTime: it.issueTime,
      }));
  } catch (e) {
    console.error(`경보 조회 실패(무시): ${e.message}`);
    return [];
  }
}

async function main() {
  const coords = await getStationCoords();
  console.log(`측정소 좌표 ${Object.keys(coords).length}개 확보`);

  const alerts = await getAlerts();
  console.log(`발령 중인 경보 ${alerts.length}건`);

  const items = await getJSON(
    `${BASE}/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty?serviceKey=${KEY}&returnType=json&sidoName=${encodeURIComponent('전국')}&numOfRows=1000&pageNo=1&ver=1.0`
  );
  console.log(`실시간 측정값 ${items.length}건 수신`);

  const stations = items.map(it => {
    const c = coords[it.stationName];
    return {
      name: it.stationName,
      sido: it.sidoName,
      addr: c?.addr ?? '',
      lat: c?.lat ?? null,
      lon: c?.lon ?? null,
      pm25: num(it.pm25Value),
      pm10: num(it.pm10Value),
      o3: num(it.o3Value),
      no2: num(it.no2Value),
      so2: num(it.so2Value),
      co: num(it.coValue),
      dataTime: it.dataTime || null,
    };
  }).filter(s => s.lat != null);

  if (stations.length < 100) throw new Error(`측정소 수가 비정상적으로 적음 (${stations.length}개) — 저장 중단`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), alerts, stations }));
  console.log(`저장 완료: ${stations.length}개 측정소, 경보 ${alerts.length}건 → data/airkorea.json`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
