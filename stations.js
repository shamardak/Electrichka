const https = require('https');
const zlib  = require('zlib');

// Кеш на час життя процесу Lambda (~15 хв)
let stationsCache = null;
let cacheTime = 0;
const CACHE_TTL = 15 * 60 * 1000;

exports.handler = async function() {
  try {
    if (stationsCache && Date.now() - cacheTime < CACHE_TTL) {
      return ok(stationsCache);
    }
    const stations = await scrapeStations();
    stationsCache = stations;
    cacheTime = Date.now();
    return ok(stations);
  } catch(e) {
    return ok(FALLBACK_STATIONS); // завжди повертаємо щось
  }
};

function ok(data) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
    body: JSON.stringify(data),
  };
}

// Парсимо сторінку з алфавітним списком станцій poizdato.net
async function scrapeStations() {
  const pages = [
    'https://poizdato.net/stantsii/',
  ];
  const stations = [];
  const seen = new Set();

  for (const url of pages) {
    try {
      const html = await fetchHtml(url);
      // Шукаємо посилання виду /rozklad-po-stantsii/slug/
      const re = /href="\/rozklad-po-stantsii\/([^"\/]+)\/"[^>]*>([^<]+)</gi;
      let m;
      while ((m = re.exec(html)) !== null) {
        const slug = m[1].trim();
        const name = m[2].trim();
        if (!seen.has(slug) && name.length > 1 && name.length < 60) {
          seen.add(slug);
          stations.push({ name, slug });
        }
      }
    } catch(e) {}
  }

  // Якщо нічого не знайшли — повертаємо запасний список
  return stations.length > 10 ? stations : FALLBACK_STATIONS;
}

function fetchHtml(url, redirects) {
  redirects = redirects || 0;
  return new Promise(function(resolve, reject) {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    var req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0',
        'Accept': 'text/html',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    }, function(res) {
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location) {
        req.destroy();
        return fetchHtml(res.headers.location, redirects + 1).then(resolve).catch(reject);
      }
      var enc = res.headers['content-encoding'] || '';
      var stream = res;
      if      (enc.includes('br'))      stream = res.pipe(zlib.createBrotliDecompress());
      else if (enc.includes('gzip'))    stream = res.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
      var chunks = [];
      stream.on('data', c => chunks.push(c));
      stream.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Запасний список найпоширеніших станцій України
const FALLBACK_STATIONS = [
  // Київ та приміські
  {name:"Київ",                   slug:"kyiv"},
  {name:"Київ-Пасажирський",      slug:"kyiv-pas"},
  {name:"Київ-Волинський",        slug:"kyiv-volynskyi"},
  {name:"Тарасівка",              slug:"tarasivka,kyivska-obl"},
  {name:"Боярка",                 slug:"boiarka"},
  {name:"Фастів",                 slug:"fastiv"},
  {name:"Васильків",              slug:"vasylkiv,kyivska-obl"},
  {name:"Вишневе",                slug:"vyshneve"},
  {name:"Ірпінь",                 slug:"irpin"},
  {name:"Буча",                   slug:"bucha"},
  {name:"Бровари",                slug:"brovary"},
  {name:"Миронівка",              slug:"myronivka"},
  {name:"Козятин",                slug:"koziatyn-1"},
  {name:"Біла Церква",            slug:"bila-tserkva"},
  {name:"Переяслав",              slug:"pereiaslav"},
  {name:"Яготин",                 slug:"yahotyn"},
  {name:"Бориспіль",              slug:"boryspil"},
  {name:"Святошин",               slug:"sviatoshyn"},
  {name:"Жуляни",                 slug:"zhuliany"},
  // Великі міста
  {name:"Харків",                 slug:"kharkiv-pasazhyrskyi"},
  {name:"Дніпро",                 slug:"dnipro-holovnyi"},
  {name:"Одеса",                  slug:"odesa-holovna"},
  {name:"Запоріжжя",              slug:"zaporizhzhia-1"},
  {name:"Львів",                  slug:"lviv"},
  {name:"Вінниця",                slug:"vinnytsia"},
  {name:"Полтава",                slug:"poltava-kyivska"},
  {name:"Кривий Ріг",            slug:"kryvyi-rih-holovnyi"},
  {name:"Рівне",                  slug:"rivne"},
  {name:"Хмельницький",           slug:"khmelnytskyi"},
  {name:"Житомир",               slug:"zhytomyr"},
  {name:"Чернігів",              slug:"chernihiv"},
  {name:"Черкаси",               slug:"cherkasy"},
  {name:"Миколаїв",              slug:"mykolaiv"},
  {name:"Луцьк",                  slug:"lutsk"},
  {name:"Ужгород",               slug:"uzhhorod"},
  {name:"Тернопіль",             slug:"ternopil"},
  {name:"Івано-Франківськ",      slug:"ivano-frankivsk"},
  {name:"Чернівці",              slug:"chernivtsi"},
  {name:"Суми",                  slug:"sumy"},
  {name:"Краматорськ",           slug:"kramatorsk"},
  {name:"Кропивницький",         slug:"kropyvnytskyi"},
  {name:"Херсон",                slug:"kherson"},
  {name:"Мукачево",              slug:"mukachevo"},
  {name:"Коростень",             slug:"korosten"},
  {name:"Бердичів",              slug:"berdychiv"},
  {name:"Козятин",               slug:"koziatyn-1"},
  {name:"Шепетівка",             slug:"shepetivka"},
  {name:"Здолбунів",             slug:"zdolbuniv"},
  {name:"Сарни",                 slug:"sarny"},
  {name:"Ковель",                slug:"kovel"},
  {name:"Нові Ворота",           slug:"novi-vorota"},
  {name:"Коломия",               slug:"kolomyia"},
  {name:"Стрий",                 slug:"stryi"},
  {name:"Дрогобич",              slug:"drohobych"},
  {name:"Трускавець",            slug:"truskavets"},
  {name:"Хирів",                 slug:"khyriv"},
  {name:"Sambir",                slug:"sambir"},
  {name:"Новий Розділ",          slug:"novyi-rozdil"},
  {name:"Знам'янка",             slug:"znamianka"},
  {name:"Помічна",               slug:"pomichna"},
  {name:"Бахмач",                slug:"bakhmach"},
  {name:"Ніжин",                 slug:"nizhyn"},
  {name:"Прилуки",               slug:"pryluky"},
  {name:"Лубни",                 slug:"lubny"},
  {name:"Гребінка",              slug:"hrebinka"},
  {name:"Пирятин",               slug:"pyriatyn"},
  {name:"Золотоноша",            slug:"zolotonosha-1"},
  {name:"Ромодан",               slug:"romodan"},
  {name:"Лохвиця",               slug:"lokhvytsia"},
  {name:"Гадяч",                 slug:"hadach"},
  {name:"Охтирка",               slug:"okhtyrka"},
  {name:"Конотоп",               slug:"konotop"},
  {name:"Шостка",                slug:"shostka"},
  {name:"Кролевець",             slug:"krolevets"},
  {name:"Глухів",                slug:"hlukhiv"},
  {name:"Ромни",                 slug:"romny"},
];
