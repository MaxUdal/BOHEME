const byId = (id) => document.getElementById(id);
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const primaryBrand = 'Boheme';
const brandDirectories = [
  { name: primaryBrand, id: 'boheme', logo: 'boheme-logo.svg', categories: [
    'Аксессуары', 'Смесители', 'Санфаянс', 'Душевые гарнитуры', 'Зеркала',
    'Слив и канализация', 'Инсталляция и кнопки', 'Полотенцесушители', 'Раковины',
  ] },
  { name: 'Armadi Art', id: 'armadi-art', logo: 'armadi-art-logo.png',
    categories: ['Мебель', 'Раковины', 'Зеркала'] },
];
let catalog = { products: [] };
let storefrontProducts = [];
let shuffledCatalogProducts = [];
let components = [];
let catalogMessage = 'Загружаем ассортимент…';
const catalogBatchSize = 24;
let catalogPages = 1;
let catalogColumns = 1;
const cartStorageKey = 'boheme-cart';
const cart = new Map();
try {
  const saved = JSON.parse(localStorage.getItem(cartStorageKey) || '[]');
  for (const [id,quantity] of saved) {
    if (typeof id === 'string' && Number.isSafeInteger(quantity) && quantity > 0) cart.set(id,quantity);
  }
} catch {
  // Cart remains available for the current visit if storage is disabled.
}
function saveCart() {
  try {
    localStorage.setItem(cartStorageKey,JSON.stringify([...cart]));
  } catch {
    // Storage can be unavailable in some browser modes.
  }
}
let consultation = false;
const facetFields = [['color','Все цвета'], ['type','Все виды']];

function addToCart(item) {
  cart.set(item.id, (cart.get(item.id) || 0) + 1);
  saveCart();
  renderCart();
  toast('Товар добавлен в корзину');
}
const productHash = '#product=';
const catalogHash = '#catalog?';
const storefrontTitle = document.title;
let productDataReady = false;
let catalogReturn = null;
let productActionsObserver;
let productColorVariants = new Map();

const finishSkuCodes = {
  antracite: ['ant', 'an'], capucino: ['cp'], coffee: ['c'],
  grey: ['gr'], luna: ['l'], olive: ['ol'], terracotta: ['t'],
  violet: ['bur', 'vio'], calacatta: ['cal'],
};

function indexProductColorVariants(products) {
  const groups = new Map();
  for (const item of products) {
    if (!item.sku || !item.color || !item.collection || item.sku.includes('+')) continue;
    const color = item.color.split(' (')[0].trim().toLowerCase();
    const tokens = item.sku.toLowerCase().split(/([-.])/);
    const codes = [color.replace(/\s+/g, ''), ...(Object.hasOwn(finishSkuCodes, color) ? finishSkuCodes[color] : [])];
    const positions = tokens.map((token, i) => i > 0 && i % 2 === 0 && codes.includes(token) ? i : -1)
      .filter(i => i !== -1);
    if (positions.length !== 1) continue;
    tokens[positions[0]] = '';
    const key = JSON.stringify([item.brand, item.category, item.collection, item.type, item.material, tokens.join('')]
      .map(value => String(value || '').trim().toLowerCase()));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const variantsByProduct = new Map();
  for (const group of groups.values()) {
    if (group.length < 2 || new Set(group.map(item => item.color.trim().toLowerCase())).size !== group.length) continue;
    for (const item of group) variantsByProduct.set(item.id, group);
  }
  return variantsByProduct;
}

function productLink(item, label, className) {
  const link = node('a',label,className);
  link.href = productHash + encodeURIComponent(item.id);
  link.addEventListener('click',event => {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || document.body.classList.contains('productRoute')) return;
    catalogReturn = {hash:window.location.hash,top:window.scrollY};
  });
  return link;
}
function catalogLink(brand, collection = '') {
  const link = node('a',collection || brand,'productSpecLink');
  const params = new URLSearchParams({brand});
  if (collection) params.set('collection',collection);
  link.href = catalogHash + params;
  return link;
}
function syncProductRoute() {
  const hash = window.location.hash;
  const page = byId('productPage');
  const wasOpen = !page.hidden;
  const isProduct = hash.startsWith(productHash);
  page.hidden = !isProduct;
  document.body.classList.toggle('productRoute',isProduct);
  document.title = storefrontTitle;
  productActionsObserver?.disconnect();
  if (isProduct) {
    const item = catalog.products.find(product => productHash + encodeURIComponent(product.id) === hash);
    byId('productBreadcrumbs').hidden = !item;
    if (item) {
      const back = byId('catalogReturn');
      back.hidden = !catalogReturn;
      if (catalogReturn) back.href = catalogReturn.hash || '#';
      const restoreVariantFocus = document.activeElement?.classList.contains('colorVariant');
      renderProductPage(item);
      if (restoreVariantFocus) page.querySelector('.colorVariant[aria-current="true"]')?.focus({preventScroll:true});
      document.title = item.name + ' — Boheme и Armadi Art';
    } else {
      const title = node('h1',productDataReady ? 'Товар не найден' : 'Загружаем карточку…');
      title.id = 'detailTitle';
      byId('productDetail').replaceChildren(title);
    }
    if (!wasOpen) page.scrollIntoView();
  } else if (wasOpen && catalogReturn && hash === catalogReturn.hash) {
    const {top} = catalogReturn;
    catalogReturn = null;
    window.requestAnimationFrame(() => window.scrollTo({top,behavior:'instant'}));
  } else if (hash.startsWith(catalogHash)) {
    const params = new URLSearchParams(hash.slice(catalogHash.length));
    showSelection(params.get('brand') || '', params.get('category') || '', params.get('collection') || '');
  } else if (wasOpen) {
    const target = byId(hash.slice(1) || 'catalog');
    (target || byId('catalog')).scrollIntoView();
  }
  scheduleBanner();
}
let viewerMedia = [];
let viewerIndex = 0;
let touchStart = null;

function showProductMedia(index) {
  viewerIndex = index;
  const {url,label} = viewerMedia[index];
  const image = byId('mediaImage');
  byId('mediaTitle').textContent = label;
  byId('mediaError').hidden = true;
  byId('mediaOriginal').href = url;
  byId('mediaPosition').textContent = (index + 1) + ' из ' + viewerMedia.length;
  image.alt = label;
  image.hidden = false;
  image.src = url;
}
function openProductMedia(media, index) {
  viewerMedia = media;
  byId('mediaNavigation').hidden = media.length < 2;
  byId('mediaPosition').hidden = media.length < 2;
  showProductMedia(index);
  byId('mediaDialog').showModal();
}
function stepProductMedia(direction) {
  if (viewerMedia.length < 2) return;
  showProductMedia((viewerIndex + direction + viewerMedia.length) % viewerMedia.length);
}
byId('mediaPrevious').addEventListener('click', () => stepProductMedia(-1));
byId('mediaNext').addEventListener('click', () => stepProductMedia(1));
byId('mediaDialog').addEventListener('keydown', event => {
  if (viewerMedia.length < 2 || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  stepProductMedia(event.key === 'ArrowLeft' ? -1 : 1);
});
const viewerImage = byId('mediaImage');
viewerImage.addEventListener('touchstart', event => {
  touchStart = event.touches.length === 1 ? event.touches[0] : null;
}, {passive:true});
viewerImage.addEventListener('touchend', event => {
  const start = touchStart;
  touchStart = null;
  if (!start || event.touches.length) return;
  const end = event.changedTouches[0];
  const distance = end.clientX - start.clientX;
  if (Math.abs(distance) >= 45 && Math.abs(distance) > Math.abs(end.clientY - start.clientY)) {
    stepProductMedia(distance < 0 ? 1 : -1);
  }
}, {passive:true});
viewerImage.addEventListener('touchcancel', () => { touchStart = null; }, {passive:true});
viewerImage.addEventListener('error', () => {
  viewerImage.hidden = true;
  byId('mediaError').hidden = false;
});

const componentCategories = {
  'крышка': 'Санфаянс',
  'ножки': 'Мебель',
  'полотенцедержатель': 'Полотенцесушители',
};
function componentCategory(item) {
  const prefix = item.name.trim().toLowerCase().match(/^(крышка|ножки|полотенцедержатель)(?![\p{L}\p{N}])/u);
  return prefix ? componentCategories[prefix[1]] : '';
}
function relatedComponents(item) {
  const collection = item.collection?.trim().toLowerCase();
  if (!collection || componentCategory(item)) return [];
  if (item.category === 'Санфаянс' && item.type?.trim().toLowerCase() !== 'унитаз') return [];

  return components.filter(component =>
    componentCategory(component) === item.category &&
    component.brand === item.brand &&
    component.collection?.trim().toLowerCase() === collection);
}
function collectionVideos(item) {
  const collection = item.collection?.trim().toLowerCase();
  if (item.brand === 'Armadi Art' && item.category === 'Мебель') {
    if (collection === 'voi') {
      return [{post:588,available:true,description:'Коллекция Armadi Art Voi с закруглёнными фасадами. Размеры: 80, 100, 120 и 140 см. Раковины из искусственного камня доступны в матовом и глянцевом белом цвете или в цвете тумбы. Корпус из МДФ, фурнитура Hettich, отделка полок экокожей и внутренняя подсветка.'}];
    }
    if (collection === 'ovale') {
      return [{post:637,available:true,description:'Тумба Armadi Art Ovale в отделке Metallico Vision. В композиции также показаны смеситель Boheme Stick и унитаз Boheme Fiore.'}];
    }
    if (collection === 'minimal' || collection === 'minimal arte') {
      return [{post:567,available:true,description:'Мебель Armadi Art Minimal Arte с фасадами из искусственного камня. Размеры — от 70 до 240 см, с разными вариантами оснащения.'}];
    }
  }
  if (item.brand !== primaryBrand) return [];
  if (item.category === 'Раковины' && collection === 'sole' &&
      /^(?:комплект\s+)?раковина(?:\s|$)/iu.test(item.name.trim())) {
    if (/^g(?:\s*\(|$)/i.test(item.color?.trim() || '')) {
      return [{post:560,available:true,description:'Напольная раковина Boheme Sole в цвете Metallic Gold. В ролике показана напольная композиция.'}];
    }
    if (/\b(?:calacatta|nero\s+marquina)\b/i.test(item.color + ' ' + item.name)) {
      return [{post:614,available:true,description:'Рифлёные раковины Boheme Sole в цветах Calacatta и Nero Marquina. В ролике показаны напольные композиции в этих цветах.'}];
    }
  }
  if (item.category === 'Смесители' && collection === 'duo') {
    return [{post:606,available:true,description:'Новый смеситель Boheme Duo — решение для ванной комнаты, представленное в нескольких цветах.'}];
  }
  if (item.category === 'Смесители' && collection === 'prestige') {
    return [{post:565,available:true,description:'Смесители Boheme Prestige в цветах Brushed Nickel, Matt Gold, Gunmetal и Shiny Gunmetal.'}];
  }
  return [];
}
function renderProductGallery(item) {
  const photos = [item.photo, ...(item.photos || [])].filter(Boolean);
  const media = photos.map((url,index) => ({
    url, label: (index === 0 && item.photo ? 'Основное фото' : 'Фото ' + (index + 1)) + ' — ' + item.name,
  }));
  if (item.diagram) media.push({url:item.diagram,label:'Схема — ' + item.name});

  const clips = [...(productVideos.get(item.id) || []), ...collectionVideos(item)].filter(clip => clip.available);
  const isGlowOlive = item.brand === primaryBrand && item.category === 'Раковины' &&
    item.collection?.trim().toLowerCase() === 'glow' &&
    item.color?.trim().toLowerCase() === 'olive' && /раковина/iu.test(item.name);
  if (isGlowOlive && !clips.some(({post}) => post === 702)) {
    clips.push({post:702,description:'Напольная раковина Boheme Glow в цвете Olive.'});
  }

  const gallery = node('div',null,'detailGallery');
  const stage = node('div',null,'galleryStage');
  const controls = node('div',null,'galleryChoices');
  controls.setAttribute('role','group');
  controls.setAttribute('aria-label','Фото, видео и схема товара');
  const caption = node('p',null,'productVideoCaption');
  caption.hidden = true;
  const placeholder = node('div','Фото отсутствует','productVisual');
  stage.append(placeholder);
  gallery.append(stage,controls,caption);

  function select(button, content, description = '') {
    stage.querySelector('video')?.pause();
    stage.replaceChildren(content);
    caption.textContent = description;
    caption.hidden = !description;
    for (const choice of controls.querySelectorAll('[aria-pressed]')) {
      choice.setAttribute('aria-pressed',String(choice === button));
    }
  }

  function selectPhoto(index, button) {
    const image = node('img',null,'detailPhoto');
    image.src = media[index].url;
    image.alt = item.name;
    const enlarge = action(null,() => openProductMedia(media,index),'mediaZoom');
    enlarge.setAttribute('aria-label','Увеличить фото: ' + item.name);
    image.addEventListener('error',() => {
      if (stage.contains(enlarge)) stage.replaceChildren(placeholder);
    });
    enlarge.append(image);
    select(button,enlarge);
  }

  function addThumbnail(url, label, onClick, isVideo = false) {
    const button = action(null,onClick,'outline');
    button.setAttribute('aria-label',label);
    if (isVideo) button.classList.add('galleryVideoChoice');
    const thumb = node('img');
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.src = url;
    button.append(thumb);
    controls.append(button);
    return button;
  }

  photos.forEach((url,index) => {
    const button = addThumbnail(url,media[index].label,() => selectPhoto(index,button));
    button.setAttribute('aria-pressed','false');
  });

  clips.forEach(({post,description},index) => {
    const poster = './video-poster-' + (post === 598 ? 564 : post) + '.jpg';
    const label = 'Видео ' + (index + 1) + ' — ' + item.name;
    const button = addThumbnail(poster,label,() => {
      const video = node('video',null,'detailVideo');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'none';
      video.poster = poster;
      video.src = post === 702 ? './glow-olive.mp4' : post === 558 ? './boheme-648.mp4' : './product-video-' + (post === 598 ? 564 : post) + '.mp4';
      video.setAttribute('aria-label',label);
      select(button,video,description);
    },true);
    button.setAttribute('aria-pressed','false');
  });

  if (item.diagram) {
    const index = photos.length;
    const scheme = addThumbnail(item.diagram,'Увеличить схему — ' + item.name,() => {
      stage.querySelector('video')?.pause();
      openProductMedia(media,index);
    });
    scheme.title = 'Схема товара';
    scheme.classList.add('gallerySchemeChoice');
    scheme.append(node('span','Схема'));
  }
  if (photos.length) selectPhoto(0,controls.firstChild);
  controls.hidden = !clips.length && media.length <= 1 && !item.diagram;
  return gallery;
}

function renderProductColors(item) {
  const variants = productColorVariants.get(item.id);
  if (!variants) return null;
  const section = node('div',null,'productColors');
  const label = node('p',null,'productColorLabel');
  label.append('Цвет: ',node('strong',item.color));
  const options = node('div',null,'productColorOptions');
  options.setAttribute('role','group');
  options.setAttribute('aria-label','Варианты цвета');
  for (const variant of variants) {
    const link = productLink(variant,null,'colorVariant');
    link.setAttribute('aria-label',variant.color);
    link.title = variant.color;
    if (variant.id === item.id) link.setAttribute('aria-current','true');
    const fallback = node('span',variant.color,'colorVariantFallback');
    if (variant.photo) {
      const img = node('img');
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error',() => img.replaceWith(fallback),{once:true});
      img.src = variant.photo;
      link.append(img);
    } else link.append(fallback);
    options.append(link);
  }
  section.append(label,options);
  return section;
}

function renderProductPage(item) {
  const categoryLink = byId('breadcrumbCategory');
  categoryLink.textContent = item.category;
  categoryLink.href = catalogHash + new URLSearchParams({category:item.category});
  byId('breadcrumbProduct').textContent = item.name;
  const title = node('h1',item.name);
  title.id = 'detailTitle';
  const info = node('div',null,'detailInfo');
  info.append(title);
  if (item.sku) info.append(node('p','Арт. ' + item.sku,'productSku'));
  const colors = renderProductColors(item);
  if (colors) info.append(colors);
  const actions = node('div',null,'detailActions');
  const add = action('В корзину',() => addToCart(item));
  actions.append(node('strong',money.format(item.price)),add);
  const warranty = node('a','Гарантия','productWarranty');
  warranty.href = '#warranty';
  const help = node('div',null,'productHelp');
  help.append(action('Уточнить наличие',() => openRequest(true,item),'productConsultation'),warranty);
  info.append(actions,help);
  const layout = node('div',null,'productLayout');
  const gallery = renderProductGallery(item);
  const fields = [
    ['Бренд',item.brand], ['Артикул',item.sku], ['Цвет',item.color], ['Вид',item.type],
    ['Коллекция',item.collection], ['Материал',item.material], ...(item.specs || []),
  ].filter(([, value]) => value);
  if (fields.length) {
    const details = node('dl',null,'productSpecs');
    for (const [label, value, unit] of fields) {
      const content = node('dd');
      if (label === 'Бренд') content.append(catalogLink(item.brand));
      else if (label === 'Коллекция') content.append(catalogLink(item.brand,value));
      else content.textContent = unit ? value + ' ' + unit : value;
      details.append(node('dt',label),content);
    }
    info.append(node('h2','Характеристики'),details);
  }
  layout.append(gallery,info);
  const detail = byId('productDetail');
  detail.replaceChildren(layout);
  const quickPurchase = node('div',null,'mobilePurchase');
  quickPurchase.hidden = true;
  quickPurchase.append(node('strong',money.format(item.price)),action('В корзину',() => addToCart(item)));
  detail.append(quickPurchase);
  productActionsObserver = new IntersectionObserver(([entry]) => {
    quickPurchase.hidden = entry.isIntersecting || entry.boundingClientRect.top >= 0;
  });
  productActionsObserver.observe(add);
  const related = relatedComponents(item);
  if (related.length) {
    const section = node('section',null,'relatedProducts');
    const heading = node('h2','Сопутствующие товары');
    heading.id = 'relatedProductsTitle';
    section.setAttribute('aria-labelledby',heading.id);
    const list = node('div',null,'products');
    list.append(...related.map(productTile));
    section.append(heading,list);
    detail.append(section);
  }
}

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value != null) element.textContent = value;
  if (className) element.className = className;
  return element;
}
function action(value, callback, className = 'button') {
  const button = node('button', value, className);
  button.type = 'button';
  button.addEventListener('click', callback);
  return button;
}
function fillSelect(id, label, values) {
  const select = byId(id);
  select.replaceChildren(new Option(label, ''), ...values.map(value => new Option(value, value)));
}
let toastTimer;
function toast(value) {
  const message = byId('toast');
  message.textContent = value;
  message.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { message.hidden = true; }, 1900);
}
function resetCatalogPrice() {
  byId('priceRange').value = '';
  byId('priceFrom').value = '';
  byId('priceTo').value = '';
}
function setCatalogSelection(brand, category, collection) {
  byId('search').value = '';
  resetCatalogPrice();
  byId('catalogSort').value = '';
  byId('category').value = category;
  refreshCatalog(true,collection,brand);
}
function showSelection(brand, category = '', collection = '') {
  setCatalogSelection(brand,category,collection);
  byId('catalog').scrollIntoView();
}
function initCatalog() {
  const categories = new Set(brandDirectories.flatMap(directory => directory.categories));
  fillSelect('category','Все категории',[...categories]);
  byId('search').value = '';
  byId('brandCards').replaceChildren(...brandDirectories.map(directory => {
    const section = node('section',null,'brandDirectory');
    section.id = directory.id;
    const header = node('h3');
    const logo = node('img');
    logo.src = directory.logo;
    logo.alt = directory.name;
    const homeLink = node('a');
    homeLink.href = './#top';
    homeLink.setAttribute('data-home-link','');
    homeLink.setAttribute('aria-label',directory.name + ' — главная');
    homeLink.append(logo);
    header.append(homeLink);
    const categories = node('ul',null,'brandCategoryList');
    for (const category of directory.categories) {
      const item = node('li');
      const button = action(category,() => showSelection(directory.name,category),'categoryLink');
      item.append(button);
      categories.append(item);
    }
    section.append(header,categories,action('Весь каталог ' + directory.name,() => showSelection(directory.name),'outline'));
    return section;
  }));
  refreshCatalog(true);
}
function refreshCatalog(resetFacets = false, collection = byId('collection').value, brand = byId('brand').value) {
  catalogPages = 1;
  const category = byId('category').value;
  for (const tile of byId('shopfrontCategories').children) {
    tile.setAttribute('aria-pressed', String(tile.dataset.category === category));
  }
  const categoryProducts = category
    ? storefrontProducts.filter(item => item.category === category)
    : storefrontProducts;
  const brands = [...new Set(categoryProducts.map(item => item.brand))];
  const brandFilter = byId('brand');
  if (category && brands.length === 1) {
    // A sole brand is a label, so it does not carry a filter into the next category.
    brandFilter.replaceChildren(new Option(brands[0], ''));
  } else {
    fillSelect('brand','Все бренды',brands);
    if (brands.includes(brand)) brandFilter.value = brand;
  }
  const brandProducts = brandFilter.value
    ? categoryProducts.filter(item => item.brand === brandFilter.value)
    : categoryProducts;
  const collections = [...new Set(brandProducts.map(item => item.collection).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru'));
  fillSelect('collection','Все коллекции',collections);
  const collectionFilter = byId('collection');
  collectionFilter.hidden = collections.length === 0;
  if (collections.includes(collection)) collectionFilter.value = collection;
  const scope = collectionFilter.value
    ? brandProducts.filter(item => item.collection === collectionFilter.value)
    : brandProducts;
  for (const [field,label] of facetFields) {
    const select = byId(field);
    const previous = resetFacets ? '' : select.value;
    const values = [...new Set(scope.map(item => item[field]).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru'));
    fillSelect(field,label,values);
    select.hidden = values.length === 0;
    if (values.includes(previous)) select.value = previous;
  }
  renderCatalog();
}
const categoryOrder = [
  'Смесители', 'Душевые гарнитуры', 'Раковины', 'Мебель', 'Санфаянс', 'Зеркала',
  'Полотенцесушители', 'Инсталляция и кнопки', 'Слив и канализация', 'Аксессуары',
];

function catalogOrder(products, field = 'category') {
  const groupOrder = field === 'category' ? categoryOrder : [];
  const groups = new Map(groupOrder.map(key => [key,[]]));
  for (const item of products) {
    const key = item[field];
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(item);
  }
  const queues = [...groups.values()].filter(group => group.length);
  return Array.from({length:Math.max(0,...queues.map(group => group.length))},
    (_,index) => queues.flatMap(group => index < group.length ? [group[index]] : [])).flat();
}
const categoryPhotos = new Map([
  ['Полотенцесушители','category-towel-warmers.png'],
  ['Инсталляция и кнопки','category-installation-buttons.jpg'],
  ['Слив и канализация','category-drainage.webp'],
  ['Аксессуары','category-accessories.jpg'],
  ['Смесители','category-faucets.jpg'],
  ['Душевые гарнитуры','category-showers.jpg'],
  ['Раковины','category-basins.jpg'],
  ['Мебель','category-furniture.jpg'],
  ['Санфаянс','category-sanitaryware.jpg'],
  ['Зеркала','category-mirrors.jpg'],
]);
function renderShopfront() {
  const pick = (brand,category) => storefrontProducts.find(item =>
    item.brand === brand && item.category === category && item.photo);
  const categoryCards = categoryOrder.map(category => {
    const product = pick(primaryBrand,category) || pick('Armadi Art',category);
    const photo = categoryPhotos.get(category) ?? product?.photo;
    const label = category === 'Мебель' ? 'Мебель для ванной' : category;
    const tile = action(null,() => showSelection('',category),'shopfrontTile');
    tile.dataset.category = category;
    const placeholder = node('span',null,'shopfrontTilePlaceholder');
    placeholder.setAttribute('aria-hidden','true');
    if (photo) {
      const image = node('img');
      image.loading = 'lazy';
      image.alt = '';
      image.addEventListener('error',() => image.replaceWith(placeholder),{once:true});
      image.src = photo;
      tile.append(image);
    } else {
      tile.append(placeholder);
    }
    tile.append(node('span',label));
    return tile;
  });
  byId('shopfrontCategories').replaceChildren(...categoryCards);
  byId('shopfront').hidden = storefrontProducts.length === 0;
}

function catalogPageLimit(columns, pages) {
  return Math.ceil(catalogBatchSize / columns) * columns * pages;
}
function catalogPriceRange() {
  const preset = byId('priceRange').value;
  const custom = preset === 'custom';
  const from = byId('priceFrom');
  const to = byId('priceTo');
  const min = custom && from.value !== '' ? from.valueAsNumber : -Infinity;
  const max = custom && to.value !== '' ? to.valueAsNumber : Infinity;
  const invalid = custom && (!from.validity.valid || !to.validity.valid || min > max);
  byId('customPrice').hidden = !custom;
  byId('priceError').hidden = !invalid;

  if (preset === 'low') return [-Infinity, 9999];
  if (preset === 'mid') return [10000, 30000];
  if (preset === 'high') return [30001, Infinity];
  return invalid ? [-Infinity, Infinity] : [min, max];
}
function renderActiveFilters() {
  const filterBar = byId('activeFilters');
  const badges = [];
  for (const id of ['category','brand','collection','color','type','priceRange']) {
    const field = byId(id);
    if (!field.value) continue;
    let label = field.selectedOptions[0].textContent;
    if (id === 'priceRange' && field.value === 'custom') {
      label = [
        byId('priceFrom').value && 'от ' + Number(byId('priceFrom').value).toLocaleString('ru') + ' ₽',
        byId('priceTo').value && 'до ' + Number(byId('priceTo').value).toLocaleString('ru') + ' ₽',
      ].filter(Boolean).join(' ') || label;
    }
    const badge = action(label + ' ×',() => {
      field.value = '';
      field.dispatchEvent(new Event(['color','type','priceRange'].includes(id) ? 'input' : 'change'));
    },'filterChip');
    badge.setAttribute('aria-label','Снять фильтр: ' + label);
    badges.push(badge);
  }
  filterBar.hidden = badges.length === 0;
  filterBar.replaceChildren(...badges);
  byId('filterReset').hidden = badges.length === 0 && !byId('search').value.trim();
}
function renderCatalog() {
  const query = byId('search').value.trim().toLocaleLowerCase('ru');
  const skuQuery = query.match(/^(?:артикул|арт)(?:\.\s*|\s+|\s*[:№]\s*)(?:[:№]\s*)?([^\s].*)$/)?.[1];
  const search = skuQuery ?? query;
  const selectedBrand = byId('brand').value;
  const category = byId('category').value;
  const collection = byId('collection').value;
  const color = byId('color').value;
  const type = byId('type').value;
  const [minPrice, maxPrice] = catalogPriceRange();
  const filterPrice = Number.isFinite(minPrice) || Number.isFinite(maxPrice);
  const isGeneralCatalog = !filterPrice && !search && !selectedBrand && !category && !collection && !color && !type;
  const shuffleCategory = Boolean(category && !search);
  let sourceProducts = storefrontProducts;
  if (search) {
    sourceProducts = catalog.products;
  } else if (isGeneralCatalog || shuffleCategory) {
    sourceProducts = shuffledCatalogProducts;
  }
  const products = sourceProducts.filter(item => (
    (!selectedBrand || item.brand === selectedBrand) &&
    (!category || item.category === category) &&
    (!collection || item.collection === collection) &&
    (!color || item.color === color) &&
    (!type || item.type === type) &&
    (!filterPrice || (Math.round(item.price) >= minPrice && Math.round(item.price) <= maxPrice)) &&
    (skuQuery ? item.sku : item.name + ' ' + item.sku).toLocaleLowerCase('ru').includes(search)
  ));
  if (!shuffleCategory) {
    const isExactSku = item => search && item.sku.toLocaleLowerCase('ru') === search ? 1 : 0;
    products.sort((a,b) => isExactSku(b) - isExactSku(a) ||
      Number(b.brand === primaryBrand) - Number(a.brand === primaryBrand));
  }
  byId('empty').hidden = !catalog.products.length || products.length > 0;
  byId('catalogTitle').textContent = category || 'Каталог';
  const categoryPhoto = byId('catalogCategoryPhoto');
  const categoryPhotoSource = categoryPhotos.get(category);
  categoryPhoto.hidden = !categoryPhotoSource;
  if (categoryPhotoSource) categoryPhoto.src = categoryPhotoSource;
  const count = products.length.toLocaleString('ru');
  byId('catalogStatus').textContent = catalog.products.length ? 'Товаров найдено: ' + count : catalogMessage;
  const grid = byId('products');
  const visibleLimit = catalogPageLimit(catalogColumns,catalogPages);
  byId('moreProducts').hidden = products.length <= visibleLimit;
  let ordered = products;
  const sort = byId('catalogSort').value;
  if (sort) {
    const direction = sort === 'asc' ? 1 : -1;
    ordered.sort((a,b) => direction * (a.price - b.price));
  } else if (filterPrice && !collection) {
    ordered = catalogOrder(products,'collection');
  } else if (!category && !search) {
    ordered = catalogOrder(products);
  }
  grid.replaceChildren(...ordered.slice(0,visibleLimit).map(productTile));
  renderActiveFilters();
}
function productTile(item) {
  const card = node('article', null, 'product');
  const photoLink = productLink(item,null,'productPhotoLink');
  photoLink.setAttribute('aria-label', 'Открыть карточку: ' + item.name);
  const fallback = node('div',item.category,'productVisual');
  if (item.photo) {
    const image = node('img');
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => image.replaceWith(fallback), {once:true});
    image.src = item.photo;
    photoLink.append(image);
  } else {
    photoLink.append(fallback);
  }
  card.append(photoLink);
  const info = node('div', null, 'info');
  const bottom = node('div', null, 'productEnd');
  const add = action('В корзину', () => addToCart(item));
  add.setAttribute('aria-label', 'В корзину: ' + item.name);
  add.classList.add('tileAdd');
  add.textContent = '';
  const icon = byId('basket').querySelector('svg').cloneNode(true);
  icon.classList.add('tileAddIcon');
  add.append(node('span','В корзину','tileAddLabel'),icon);
  bottom.append(node('strong', money.format(item.price)),add);
  const heading = node('h3');
  heading.append(productLink(item,item.name,'productTitle'));
  info.append(node('small', [item.brand,item.color].filter(Boolean).join(' · ')),heading);
  if (item.sku) info.append(node('small','Арт. ' + item.sku,'tileSku'));
  info.append(bottom);
  card.append(info);
  return card;
}
function renderCart() {
  let count = 0;
  let total = 0;
  const rows = [];
  const byProductId = new Map(catalog.products.map(item => [item.id,item]));
  for (const [id, quantity] of cart) {
    const item = byProductId.get(id);
    if (!item) continue;
    count += quantity;
    total += item.price * quantity;
    const row = node('div', null, 'cartRow');
    const controls = node('div', null, 'qty');
    const adjust = (delta,label) => {
      const button = action(delta > 0 ? '+' : '−', () => {
        const next = quantity + delta;
        if (next > 0) cart.set(id,next);
        else cart.delete(id);
        saveCart();
        renderCart();
      }, '');
      button.setAttribute('aria-label',label + ': ' + item.name);
      return button;
    };
    controls.append(adjust(-1,'Уменьшить количество'),node('span',quantity),adjust(1,'Увеличить количество'));
    row.append(node('span', item.name + ' · ' + money.format(item.price)), controls);
    rows.push(row);
  }
  byId('basket').setAttribute('aria-label', count ? 'Корзина, товаров: ' + count : 'Корзина');
  byId('count').textContent = count;
  byId('count').hidden = count === 0;
  byId('cartTitle').textContent = consultation ? 'Заказать звонок' : 'Корзина';
  byId('cartItems').hidden = consultation;
  byId('total').hidden = consultation;
  byId('cartItems').replaceChildren(...rows);
  byId('total').textContent = count ? 'Итого: ' + money.format(total) : 'Корзина пока пуста.';
  byId('request').hidden = count === 0 && !consultation;
  byId('requestStatus').textContent = '';
}
byId('request').addEventListener('submit', (event) => {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  const name = fields.get('customer').trim();
  const digits = fields.get('phone').replace(/\D/g,'');
  const status = byId('requestStatus');
  if (!name || digits.length < 10 || digits.length > 15) {
    status.textContent = 'Укажите имя и телефон с 10–15 цифрами.';
    return;
  }
  event.currentTarget.reset();
  status.textContent = 'Форма заполнена верно. Это проверка заявки. Данные менеджеру не отправлены.';
});
function openRequest(isConsultation, item = null) {
  consultation = isConsultation;
  const product = byId('requestProduct');
  product.hidden = !item;
  product.textContent = item ? [item.name,item.sku && 'арт. ' + item.sku].filter(Boolean).join(' · ') : '';
  renderCart();
  byId('cartDialog').showModal();
}
byId('basket').addEventListener('click',() => openRequest(false));
const requestDialog = byId('cartDialog');
let startedOnBackdrop = false;
function isRequestBackdrop(event) {
  const bounds = requestDialog.getBoundingClientRect();
  return event.target === requestDialog && (
    event.clientX < bounds.left || event.clientX >= bounds.right ||
    event.clientY < bounds.top || event.clientY >= bounds.bottom
  );
}
requestDialog.addEventListener('pointerdown', event => {
  startedOnBackdrop = isRequestBackdrop(event);
});
requestDialog.addEventListener('click', event => {
  if (startedOnBackdrop && isRequestBackdrop(event)) requestDialog.close();
  startedOnBackdrop = false;
});

for (const link of document.querySelectorAll('[data-consultation]')) {
  link.addEventListener('click',event => {
    event.preventDefault();
    openRequest(true);
  });
}
byId('search').addEventListener('input',() => {
  if (byId('search').value.trim()) {
    byId('category').value = '';
    resetCatalogPrice();
    if (location.hash.startsWith(catalogHash)) history.replaceState(history.state,'','#catalog');
    refreshCatalog(true,'','');
    return;
  }
  catalogPages = 1;
  renderCatalog();
});
for (const id of ['color','type','priceRange','priceFrom','priceTo']) byId(id).addEventListener('input',() => {
  catalogPages = 1;
  renderCatalog();
});
byId('category').addEventListener('change',() => refreshCatalog(true,''));
byId('collection').addEventListener('change',() => refreshCatalog(true));
byId('brand').addEventListener('change',() => refreshCatalog(true,''));
byId('catalogSort').addEventListener('change',() => {
  catalogPages = 1;
  renderCatalog();
});
const compactScreen = window.matchMedia('(max-width: 760px)');
function setCompactSections() {
  byId('showroomMapPanel').open = !compactScreen.matches;
}
setCompactSections();
compactScreen.addEventListener('change',setCompactSections);
const compactContacts = window.matchMedia('(max-width: 1080px)');
function setContactLayout() {
  byId('headerLocations').open = !compactContacts.matches;
}
setContactLayout();
compactContacts.addEventListener('change',setContactLayout);
const menuToggle = byId('mobileMenuToggle');
const siteNav = byId('siteNav');
menuToggle.addEventListener('click',() => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded',String(open));
  siteNav.classList.toggle('is-open',open);
});
siteNav.addEventListener('click',event => {
  if (!event.target.closest('a')) return;
  menuToggle.setAttribute('aria-expanded','false');
  siteNav.classList.remove('is-open');
});
byId('filterReset').addEventListener('click',() => {
  showSelection('');
  byId('search').focus({preventScroll:true});
});
byId('moreProducts').addEventListener('click',() => {
  catalogPages += 1;
  renderCatalog();
});
for (const id of ['allProducts','shopfrontAll']) {
  byId(id).addEventListener('click',() => showSelection(''));
}
initCatalog();
renderCart();

const productGrid = byId('products');
new ResizeObserver(() => {
  if (!productGrid.clientWidth) return;
  const columns = getComputedStyle(productGrid).gridTemplateColumns.trim().split(/\s+/).length;
  if (columns === catalogColumns) return;
  catalogColumns = columns;
  renderCatalog();
}).observe(productGrid);

const reloadStorageKey = 'storefront-reload:' + location.pathname;
let savedPage = null;
if (performance.getEntriesByType('navigation')[0]?.type === 'reload') {
  try {
    savedPage = JSON.parse(sessionStorage.getItem(reloadStorageKey));
  } catch {}
}
const reloadPage = savedPage?.hash === location.hash ? savedPage : null;
const catalogFields = ['search','category','brand','collection','color','type','priceRange','priceFrom','priceTo','catalogSort'];
const shuffleSeed = reloadPage?.shuffleSeed ?? Math.floor(Math.random() * 2 ** 32);
if (reloadPage) history.scrollRestoration = 'manual';

window.addEventListener('pagehide', () => {
  const catalogTop = byId('catalog').getBoundingClientRect().top;
  const inCatalog = !document.body.classList.contains('productRoute') &&
    catalogTop <= 0 && byId('catalog').getBoundingClientRect().bottom > 0;
  const state = {
    hash: location.hash,
    top: window.scrollY,
    catalogOffset: inCatalog ? -catalogTop : null,
    filters: Object.fromEntries(catalogFields.map(id => [id,byId(id).value])),
    catalogPages,
    catalogReturn,
    shuffleSeed: inCatalog || catalogReturn ? shuffleSeed : null,
  };
  try {
    sessionStorage.setItem(reloadStorageKey,JSON.stringify(state));
  } catch {}
});

function restoreCatalogAfterReload(state) {
  for (const id of ['search','category','priceRange','priceFrom','priceTo','catalogSort']) {
    byId(id).value = state.filters[id] ?? '';
  }
  refreshCatalog(true,state.filters.collection,state.filters.brand);
  for (const id of ['color','type']) {
    const value = state.filters[id] ?? '';
    if ([...byId(id).options].some(option => option.value === value)) byId(id).value = value;
  }
  catalogPages = state.catalogPages || 1;
  catalogReturn = state.catalogReturn;
  renderCatalog();
}

async function loadPublishedCatalog() {
  try {
    const response = await fetch('./catalog-2026-09-11.json');
    if (!response.ok) throw new Error('Catalog unavailable');
    catalog = await response.json();
    productColorVariants = indexProductColorVariants(catalog.products);
    // Shuffle once per page load so pagination and resizing keep the same order.
    components = catalog.products.filter(componentCategory);
    storefrontProducts = catalog.products.filter(item => !componentCategory(item));
    shuffledCatalogProducts = [...storefrontProducts];
    let random = shuffleSeed;
    for (let index = shuffledCatalogProducts.length - 1; index > 0; index--) {
      random = (Math.imul(1664525, random) + 1013904223) >>> 0;
      const other = Math.floor(random / 2 ** 32 * (index + 1));
      [shuffledCatalogProducts[index], shuffledCatalogProducts[other]] =
        [shuffledCatalogProducts[other], shuffledCatalogProducts[index]];
    }
    renderShopfront();
    renderCart();
  } catch {
    catalogMessage = 'Не удалось загрузить каталог. Обновите страницу.';
  }
  refreshCatalog();
}

const bannerTrack = byId('bannerTrack');
const bannerControls = byId('bannerControls');
const bannerPause = byId('bannerPause');
const bannerCount = bannerTrack.children.length;
const bannerPosition = byId('bannerPosition');
const reducedBannerMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let activeBanner = 0;
let bannerPaused = false;
let bannerTimer;

function scheduleBanner() {
  clearTimeout(bannerTimer);
  if (bannerPaused || reducedBannerMotion.matches || !byId('productPage').hidden || document.hidden || bannerTrack.contains(document.activeElement)) return;
  bannerTimer = setTimeout(() => moveBanner((activeBanner + 1) % bannerCount), 5000);
}
function syncBanner() {
  if (!bannerTrack.clientWidth) return;
  const index = Math.round(bannerTrack.scrollLeft / bannerTrack.clientWidth);
  if (index === activeBanner || index < 0 || index >= bannerCount) return;
  activeBanner = index;
  bannerPosition.textContent = (index + 1) + ' / ' + bannerCount;
}
function moveBanner(index) {
  bannerTrack.scrollTo({
    left: index * bannerTrack.clientWidth,
    behavior: reducedBannerMotion.matches ? 'instant' : 'smooth',
  });
  scheduleBanner();
}
function updateBannerPause() {
  const label = bannerPaused ? 'Возобновить автопрокрутку' : 'Остановить автопрокрутку';
  bannerPause.dataset.paused = String(bannerPaused);
  bannerPause.setAttribute('aria-label', label);
  bannerPause.title = label;
  scheduleBanner();
}
for (const button of bannerControls.querySelectorAll('[data-banner-step]')) {
  button.addEventListener('click', () => moveBanner((activeBanner + Number(button.dataset.bannerStep) + bannerCount) % bannerCount));
}
bannerPause.addEventListener('click', () => {
  bannerPaused = !bannerPaused;
  updateBannerPause();
});
bannerTrack.addEventListener('scroll', syncBanner, { passive: true });
bannerTrack.addEventListener('scrollend', scheduleBanner);
bannerTrack.addEventListener('touchstart', () => clearTimeout(bannerTimer), { passive: true });
bannerTrack.addEventListener('touchend', scheduleBanner, { passive: true });
bannerTrack.addEventListener('touchcancel', scheduleBanner, { passive: true });
bannerTrack.addEventListener('focusin', scheduleBanner);
bannerTrack.addEventListener('focusout', () => setTimeout(scheduleBanner, 0));
bannerTrack.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  moveBanner(event.key === 'ArrowLeft' ? 0 : 1);
});
document.addEventListener('visibilitychange', scheduleBanner);
bannerControls.hidden = false;
updateBannerPause();

document.addEventListener('click',event => {
  if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (!event.target.closest('[data-home-link]')) return;
  event.preventDefault();
  catalogReturn = null;
  setCatalogSelection('','','');
  if (location.hash !== '#top') location.hash = '#top';
  window.scrollTo({top:0,behavior:'instant'});
});

window.addEventListener('hashchange', syncProductRoute);
syncProductRoute();
loadPublishedCatalog().then(async () => {
  productDataReady = true;
  const restore = reloadPage && reloadPage.hash === location.hash;
  if (restore) restoreCatalogAfterReload(reloadPage);
  if (location.hash.startsWith(productHash) || (!restore && location.hash.startsWith(catalogHash))) syncProductRoute();
  if (!restore) return;
  await document.fonts.ready;
  window.requestAnimationFrame(() => {
    if (location.hash !== reloadPage.hash) return;
    const top = reloadPage.catalogOffset === null ? reloadPage.top :
      window.scrollY + byId('catalog').getBoundingClientRect().top + reloadPage.catalogOffset;
    window.scrollTo({top,behavior:'instant'});
    history.scrollRestoration = 'auto';
  });
});
