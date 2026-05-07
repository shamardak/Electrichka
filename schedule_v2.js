const https = require('https');
const zlib  = require('zlib');

// Кеш station IDs щоб не шукати щоразу
var stationCache = {};

exports.handler = async function(event) {
  const p    = event.queryStringParameters || {};
  const from = p.from || 'Тарасівка';
  const to   = p.to   || 'Київ-Пас.(Приміський)';

  try {
    // 1. Отримуємо ID станцій з swrailway
    const stations = await getStationList();
    const fromId   = findStation(stations, from);
    const toId     = findStation(stations, to);

    if (!fromId || !toId) {
      throw new Error(`Станцію не знайдено: "${!fromId ? from : to}". Доступні: ${Object.keys(stations).slice(0,5).join(', ')}...`);
    }

    // 2. Отримуємо розклад
    const url    = `https://swrailway.gov.ua/timetable/eltrain/?sid1=${fromId}&sid2=${toId}&lng=`;
    const html   = await fetchHtml(url);
    const trains = parseSwrailway(html);

    if (trains.length === 0) {
      // Fallback — якщо swrailway повернув порожню таблицю
      throw new Error('swrailway: порожній результат');
    }

    return ok({
      trains,
      source: 'swrailway.gov.ua',
      fromId, toId,
      fetchedAt: new Date().toISOString(),
    });

  } catch (swErr) {
    // Fallback — poizdato.net (попередня логіка)
    try {
      const fromSlug = p.fromSlug || 'tarasivka,kyivska-obl';
      const toSlug   = p.toSlug   || 'kyiv';
      const fbUrl    = `https://poizdato.net/rozklad-poizdiv/${fromSlug}--${toSlug}/elektrychky/`;
      const html     = await fetchHtml(fbUrl);
      const trains   = parsePoizdato(html);

      return ok({
        trains,
        source: 'poizdato.net (fallback)',
        swError: swErr.message,
        fetchedAt: new Date().toISOString(),
      });
    } catch (fbErr) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: swErr.message + ' | ' + fbErr.message }) };
    }
  }
};

// ── Отримання списку станцій зі swrailway ─────────────────────────────────────
async function getStationList() {
  if (Object.keys(stationCache).length > 20) return stationCache; // вже є

  const html = await fetchHtml('https://swrailway.gov.ua/timetable/eltrain/');

  // Шукаємо <option value="ID">Назва станції</option>
  const re = /<option[^>]+value="(\d+)"[^>]*>([^<]+)<\/option>/gi;
  let m;
  const result = {};
  while ((m = re.exec(html)) !== null) {
    const id   = m[1].trim();
    const name = m[2].replace(/&amp;/g,'&').trim();
    if (id && name && name.length > 1) {
      result[name.toLowerCase()] = id;
    }
  }

  if (Object.keys(result).length > 5) {
    stationCache = result;
  }
  return result;
}

function findStation(stations, query) {
  const q = query.toLowerCase().trim();
  // Точний збіг
  if (stations[q]) return stations[q];
  // Частковий збіг
  const key = Object.keys(stations).find(k => k.includes(q) || q.includes(k));
  return key ? stations[key] : null;
}

// ── Парсинг swrailway.gov.ua ──────────────────────────────────────────────────
function parseSwrailway(html) {
  const trains = [];
  // swrailway показує таблицю з часом відправлення / прибуття
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tm;
  while ((tm = trRe.exec(html)) !== null) {
    const row   = tm[1];
    const cells = [];
    const tdRe  = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = tdRe.exec(row)) !== null) {
      cells.push(cm[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
    }
    if (cells.length < 3) continue;

    // Формат swrailway: [Номер поїзда] [Від] [Відправл.] [Прибуття] [Дні]
    // або [Час відправл.] [Час прибуття] [Номер] [Маршрут]
    const timeRe = /(\d{1,2}:\d{2})/g;
    const times  = [];
    for (const c of cells) {
      const t = c.match(/^(\d{1,2}:\d{2})$/);
      if (t) times.push(t[1]);
    }
    if (times.length < 1) continue;

    // Номер поїзда — перша комірка яка схожа на номер
    const numCell = cells.find(c => /^\d{3,6}/.test(c.replace(/\s/,'')));
    const num     = numCell ? numCell.replace(/[^\d\-\/]/g,'').trim() : '—';

    trains.push({
      dep:   times[0],
      arr:   times[1] || '—',
      dur:   times.length >= 2 ? calcDur(times[0], times[1]) : '—',
      num,
      route: cells.find(c => c.includes('→') || c.includes('—')) || '',
    });
  }
  return trains;
}

function calcDur(dep, arr) {
  try {
    const [dh,dm] = dep.split(':').map(Number);
    const [ah,am] = arr.split(':').map(Number);
    let diff = (ah*60+am) - (dh*60+dm);
    if (diff < 0) diff += 1440;
    return Math.floor(diff/60) + 'г ' + (diff%60) + 'хв';
  } catch { return '—'; }
}

// ── Парсинг poizdato.net (fallback) ──────────────────────────────────────────
function parsePoizdato(html) {
  const trains = [];
  const trRe = /<tr[\s\S]*?<\/tr>/gi; let tm;
  while ((tm = trRe.exec(html)) !== null) {
    const row = tm[0]; const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi; let cm;
    while ((cm = tdRe.exec(row)) !== null)
      cells.push(cm[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
    if (cells.length < 6) continue;
    const dM = cells[3].match(/(\d{2})\.(\d{2})/);
    const aM = cells[4].match(/(\d{2})\.(\d{2})/);
    const num = cells[1].replace(/[*\s]/g,'');
    if (!dM || !num || num.length < 2) continue;
    trains.push({ dep:`${dM[1]}:${dM[2]}`, arr:aM?`${aM[1]}:${aM[2]}`:'—', dur:cells[5].trim(), num, route:cells[2].trim() });
  }
  return trains;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────
function ok(data) {
  return { statusCode:200, headers:{ ...cors(), 'Content-Type':'application/json', 'Cache-Control':'public,max-age=1800' }, body:JSON.stringify(data) };
}
function cors() { return { 'Access-Control-Allow-Origin':'*' }; }

function fetchHtml(url, r) {
  r = r||0;
  return new Promise((resolve, reject) => {
    if (r>5) return reject(new Error('Redirects'));
    const req = https.get(url, { headers:{
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
      'Accept':'text/html', 'Accept-Language':'uk-UA,uk;q=0.9',
      'Accept-Encoding':'gzip, deflate, br',
    }}, res => {
      if (res.statusCode>=301&&res.statusCode<=308&&res.headers.location) {
        req.destroy(); return fetchHtml(res.headers.location, r+1).then(resolve).catch(reject);
      }
      const enc = res.headers['content-encoding']||'';
      let s = res;
      if (enc.includes('br'))      s = res.pipe(zlib.createBrotliDecompress());
      else if (enc.includes('gzip'))    s = res.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) s = res.pipe(zlib.createInflate());
      const chunks=[];
      s.on('data',c=>chunks.push(c));
      s.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
      s.on('error',reject);
    });
    req.on('error',reject);
    req.setTimeout(10000,()=>{req.destroy();reject(new Error('Timeout'));});
  });
}
