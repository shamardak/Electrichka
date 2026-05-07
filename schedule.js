const https = require('https');
const zlib  = require('zlib');

exports.handler = async function(event) {
  const p = event.queryStringParameters || {};
  const from = p.from || 'tarasivka,kyivska-obl';
  const to   = p.to   || 'kyiv';
  const url  = `https://poizdato.net/rozklad-poizdiv/${from}--${to}/elektrychky/`;

  try {
    const html   = await fetchHtml(url);
    const trains = parseSchedule(html);
    return {
      statusCode: 200,
      headers: { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*', 'Cache-Control':'public,max-age=1800' },
      body: JSON.stringify({ trains, count: trains.length, fetchedAt: new Date().toISOString(), url,
        debug: trains.length === 0 ? html.slice(0,300) : undefined }),
    };
  } catch(e) {
    return { statusCode:500, headers:{'Access-Control-Allow-Origin':'*'}, body: JSON.stringify({ error: e.message }) };
  }
};

function fetchHtml(url, r) {
  r = r||0;
  return new Promise((resolve, reject) => {
    if (r>5) return reject(new Error('Redirects'));
    const req = https.get(url, { headers:{
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0) Chrome/124.0',
      'Accept':'text/html','Accept-Language':'uk-UA,uk;q=0.9',
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

function parseSchedule(html) {
  const trains=[];
  const trRe=/<tr[\s\S]*?<\/tr>/gi; let tm;
  while((tm=trRe.exec(html))!==null) {
    const row=tm[0]; const cells=[];
    const tdRe=/<td[^>]*>([\s\S]*?)<\/td>/gi; let cm;
    while((cm=tdRe.exec(row))!==null) cells.push(cm[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
    if(cells.length<6) continue;
    const dM=cells[3].match(/(\d{2})\.(\d{2})/);
    const aM=cells[4].match(/(\d{2})\.(\d{2})/);
    const num=cells[1].replace(/[*\s]/g,'');
    if(!dM||!num||num.length<2) continue;
    trains.push({ dep:`${dM[1]}:${dM[2]}`, arr:aM?`${aM[1]}:${aM[2]}`:'—', dur:cells[5].trim(), num, route:cells[2].trim() });
  }
  return trains;
}
