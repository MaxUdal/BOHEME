import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const types = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',json:'application/json',jpg:'image/jpeg',png:'image/png',webp:'image/webp',svg:'image/svg+xml',mp4:'video/mp4',woff:'font/woff',txt:'text/plain; charset=utf-8'};
const assets = {};
for (const file of readdirSync('dist')) {
  const type = types[file.split('.').at(-1)];
  if (type && !['xlsx.js','catalog-import.js'].includes(file)) {
    assets['/'+file] = {type,data:readFileSync('dist/'+file).toString('base64')};
  }
}
assets['/admin.html'] = {type:types.html,data:readFileSync('worker/admin.html').toString('base64')};
const storefront = readFileSync('dist/app.js','utf8');
const directories = storefront.slice(storefront.indexOf('const primaryBrand'),storefront.indexOf('let catalog ='));
mkdirSync(process.argv[2],{recursive:true});
writeFileSync(process.argv[2]+'/index.js',[
  'const assets = '+JSON.stringify(assets)+';',
  directories,
  readFileSync('dist/xlsx.js','utf8'),
  readFileSync('dist/catalog-import.js','utf8'),
  readFileSync('worker/index.mjs','utf8'),
].join('\n'));
