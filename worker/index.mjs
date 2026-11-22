const seedPath = '/catalog-2026-09-11.json';
const stateKey = 'catalog/state.json';
const maxSourceBytes = 10 * 1024 * 1024;
const json = (body, status = 200) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
const error = (message, status = 400) => Object.assign(new Error(message), {status});
const empty = {source:'', live:null, draft:null, history:[], checked:null};
const versionKey = id => 'catalog/versions/' + id + '.json';

function asset(path, request) {
  const entry = assets[path];
  if (!entry) return new Response('Страница не найдена', {status:404});
  const decoded = atob(entry.data);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  const headers = new Headers({
    'Content-Type':entry.type,
    'Cache-Control':path.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
  });
  if (entry.type === 'video/mp4' && request) {
    headers.set('Accept-Ranges','bytes');
    const range = request.headers.get('Range')?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2]) && request.method === 'GET') {
      const lastByte = bytes.length - 1;
      const start = range[1] ? Number(range[1]) : Math.max(0,bytes.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]),lastByte) : lastByte;
      if (start > end) {
        headers.set('Content-Range','bytes */' + bytes.length);
        return new Response(null,{status:416,headers});
      }
      headers.set('Content-Range',`bytes ${start}-${end}/${bytes.length}`);
      headers.set('Content-Length',String(end - start + 1));
      return new Response(bytes.subarray(start,end + 1),{status:206,headers});
    }
    headers.set('Content-Length',String(bytes.length));
    if (request.method === 'HEAD') return new Response(null,{headers});
  }
  return new Response(bytes,{headers});
}
async function readState(bucket) {
  const object = await bucket.get(stateKey);
  return object ? {data:await object.json(),etag:object.etag} : {data:empty,etag:null};
}
async function writeState(bucket, previous, data) {
  const conditions = previous.etag ? {etagMatches:previous.etag} : {etagDoesNotMatch:'*'};
  if (!await bucket.put(stateKey,JSON.stringify(data),{onlyIf:conditions})) {
    throw error('Настройки изменились в другой вкладке. Обновите страницу и повторите действие.',409);
  }
}
async function readCatalog(bucket, id) {
  if (!id) return JSON.parse(await asset(seedPath).text());
  const object = await bucket.get(versionKey(id));
  if (!object) throw error('Версия каталога недоступна.',503);
  return object.json();
}
async function limitedBytes(stream) {
  if (!stream) throw error('Файл пуст.');
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxSourceBytes) {
      await reader.cancel();
      throw error('Максимальный размер Excel — 10 МБ.',413);
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk,offset);
    offset += chunk.byteLength;
  }
  if (data[0] !== 80 || data[1] !== 75) throw error('Ожидается файл Excel в формате .xlsx.');
  return data;
}
function sourceUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw error('Укажите действительную HTTPS-ссылку.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !/^[a-z][a-z0-9.-]*\.[a-z]{2,}$/i.test(url.hostname) || /\.(local|internal|test|localhost)$/i.test(url.hostname)) {
    throw error('Укажите прямую HTTPS-ссылку на файл .xlsx.');
  }
  return url.href;
}
function compare(current, incoming) {
  const old = new Map(current.map(item => [item.id,item]));
  const next = new Map(incoming.map(item => [item.id,item]));
  const changes = {added:0,updated:0,price:0,missing:0,missingExamples:[]};
  for (const item of incoming) {
    const before = old.get(item.id);
    if (!before) changes.added++;
    else {
      if (JSON.stringify(before) !== JSON.stringify(item)) changes.updated++;
      if (before.price !== item.price) changes.price++;
    }
  }
  for (const item of current) {
    if (next.has(item.id)) continue;
    changes.missing++;
    if (changes.missingExamples.length < 50) changes.missingExamples.push({brand:item.brand,sku:item.sku,name:item.name});
  }
  return changes;
}
async function prepareImport(bucket, previous, stream) {
  const {products,stats} = parseCatalog(await limitedBytes(stream),brandDirectories);
  const {data} = previous;
  const current = await readCatalog(bucket,data.live);
  const changes = compare(current.products,products);
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  await bucket.put(versionKey(id),JSON.stringify({products}));
  const draft = {id,base:data.live,at,changes,stats,count:products.length};
  await writeState(bucket,previous,{...data,draft,checked:{at,message:'Выгрузка проверена'}});
  return json(draft);
}
async function adminApi(request, bucket, path) {
  const previous = await readState(bucket);
  const {data} = previous;
  if (path === '/admin/api/state' && request.method === 'GET') return json(data);
  if (request.method !== 'POST') return json({error:'Действие недоступно.'},405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({error:'Откройте админку на сайте.'},403);
  if (path === '/admin/api/source') {
    const source = sourceUrl((await request.json()).source);
    await writeState(bucket,previous,{...data,source});
    return json({saved:true});
  }
  if (path === '/admin/api/upload' || path === '/admin/api/check') {
    try {
      if (path.endsWith('/upload')) return await prepareImport(bucket,previous,request.body);
      if (!data.source) throw error('Сначала сохраните ссылку на Excel.');
      const response = await fetch(data.source,{redirect:'error',signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw error('Источник ответил HTTP ' + response.status + '.');
      return await prepareImport(bucket,previous,response.body);
    } catch (failure) {
      if (failure.status === 409) throw failure;
      const message = failure.status ? failure.message : 'Не удалось прочитать выгрузку. Проверьте файл или прямую ссылку.';
      await writeState(bucket,previous,{...data,checked:{at:new Date().toISOString(),message}});
      return json({error:message},failure.status || 422);
    }
  }
  if (path === '/admin/api/publish') {
    const {id,removeMissing} = await request.json();
    if (!data.draft || id !== data.draft.id || data.draft.base !== data.live) throw error('Черновик устарел. Проверьте выгрузку ещё раз.',409);
    const incoming = await readCatalog(bucket,id);
    const current = await readCatalog(bucket,data.live);
    const ids = new Set(incoming.products.map(item => item.id));
    const products = removeMissing === true ? incoming.products : [
      ...incoming.products,...current.products.filter(item => !ids.has(item.id)),
    ];
    const version = crypto.randomUUID();
    const at = new Date().toISOString();
    await bucket.put(versionKey(version),JSON.stringify({products}));
    const history = [{id:version,at,count:products.length},...data.history].slice(0,20);
    await writeState(bucket,previous,{...data,live:version,draft:null,history});
    return json({count:products.length});
  }
  if (path === '/admin/api/restore') {
    const {id} = await request.json();
    if (id !== null && !data.history.some(entry => entry.id === id)) throw error('Версия не найдена.',404);
    const {products} = await readCatalog(bucket,id);
    await writeState(bucket,previous,{...data,live:id,draft:null});
    return json({count:products.length});
  }
  return json({error:'Действие не найдено.'},404);
}
const pdfCatalogs = new Map([
  ['/pdf/boheme-modern.pdf', 'https://boheme.su/upload/iblock/806/0qn6hs6c7k7r61r75bixtjyobo1zm10y/Katalog_Boheme_2025_Modern_Part_1_18.07.25.pdf'],
  ['/pdf/boheme-classic.pdf', 'https://boheme.su/upload/iblock/846/qyrhz1ur9c2a9v02822qudz2p01xtn2r/Katalog_Boheme_2025_Classic.pdf'],
]);

async function downloadCatalogPdf(request, source, filename) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const upstream = await fetch(source, { method: request.method, redirect: 'error' });
  if (!upstream.ok || !upstream.headers.get('Content-Type')?.startsWith('application/pdf')) {
    await upstream.body?.cancel();
    return new Response('Каталог временно недоступен.', { status: 502 });
  }
  const headers = new Headers({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  const length = upstream.headers.get('Content-Length');
  if (length) headers.set('Content-Length', length);
  return new Response(upstream.body, { headers });
}


function productVideoAsset(id) {
  const fileId = id === '598' ? '564' : id;
  if (fileId === '558') return '/boheme-648.mp4';
  if (fileId === '702') return '/glow-olive.mp4';
  return '/product-video-' + fileId + '.mp4';
}

async function storedProductVideo(request, bucket, path) {
  if (!bucket) return null;
  const key = 'media' + path;
  const object = request.method === 'HEAD'
    ? await bucket.head(key)
    : await bucket.get(key,{range:request.headers});
  if (!object) return null;

  const headers = new Headers({
    'Content-Type':'video/mp4',
    'Accept-Ranges':'bytes',
    'Cache-Control':'private, max-age=300',
    'Content-Length':String(object.size),
    'ETag':object.httpEtag,
  });
  if (request.method === 'HEAD') return new Response(null,{headers});
  if (object.range && object.range.length < object.size) {
    const {offset,length} = object.range;
    headers.set('Content-Range',`bytes ${offset}-${offset+length-1}/${object.size}`);
    headers.set('Content-Length',String(length));
    return new Response(object.body,{status:206,headers});
  }
  return new Response(object.body,{headers});
}

async function uploadProductVideo(request, bucket, id) {
  if (request.method !== 'PUT') return json({error:'Действие недоступно.'},405);
  const path = productVideoAsset(id);
  if (!assets[path]) return json({error:'Ролик не найден в каталоге.'},404);
  const size = Number(request.headers.get('Content-Length'));
  if (!size || size > 30 * 1024 * 1024) return json({error:'Размер MP4 должен быть до 30 МБ.'},413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length !== size || String.fromCharCode(...bytes.subarray(4,8)) !== 'ftyp') {
    return json({error:'Выберите корректный файл MP4.'},400);
  }
  await bucket.put('media' + path,bytes,{httpMetadata:{contentType:'video/mp4'}});
  return json({id,bytes:size});
}

export default {
  async fetch(request,env) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/glow-olive.mp4' && ['GET','HEAD'].includes(request.method)) {
        return await storedProductVideo(request,env.BUCKET,path) ?? asset(path,request);
      }
      const videoId = path.match(/^\/media\/product-video\/(\d+)$/)?.[1];
      if (videoId) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
        }
        const videoPath = productVideoAsset(videoId);
        return await storedProductVideo(request,env.BUCKET,videoPath) ?? asset(videoPath,request);
      }
      if (pdfCatalogs.has(path)) {
        return await downloadCatalogPdf(request, pdfCatalogs.get(path), path.slice('/pdf/'.length));
      }
      if (path === '/api/catalog') {
        const state = env.BUCKET ? (await readState(env.BUCKET)).data : empty;
        return json(await readCatalog(env.BUCKET,state.live));
      }
      if (path === '/admin' || path.startsWith('/admin/')) {
        const email = request.headers.get('oai-authenticated-user-email');
        if (!email || !env.CATALOG_ADMIN_EMAIL || email.toLowerCase() !== env.CATALOG_ADMIN_EMAIL.toLowerCase()) {
          return new Response('Войдите через аккаунт владельца сайта.',{status:403,headers:{'Cache-Control':'no-store'}});
        }
        if (path === '/admin' || path === '/admin/') return asset('/admin.html');
        if (!env.BUCKET) return json({error:'Хранилище каталога недоступно.'},503);
        const uploadId = path.match(/^\/admin\/api\/product-video\/(\d+)$/)?.[1];
        if (uploadId) return await uploadProductVideo(request,env.BUCKET,uploadId);
        return await adminApi(request,env.BUCKET,path);
      }
      return path === '/admin.html' ? new Response('Страница не найдена',{status:404}) : asset(path === '/' ? '/index.html' : path,request);
    } catch (failure) {
      return json({error:failure.status ? failure.message : 'Не удалось выполнить действие. Повторите попытку.'},failure.status || 500);
    }
  },
};
