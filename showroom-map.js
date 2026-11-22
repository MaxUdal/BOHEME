const mapFrame = document.getElementById('showroomMap');
const mapControls = document.getElementById('showroomMapControls');
const overview = new URL(mapFrame.src);
const overviewTitle = mapFrame.title;
mapControls.addEventListener('click', event => {
  const selected = event.target.closest('button');
  if (!selected || selected.getAttribute('aria-pressed') === 'true') return;
  for (const button of mapControls.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button === selected));
  }
  const location = selected.dataset.location;
  const url = new URL(overview);
  if (location) {
    const marker = overview.searchParams.get('pt').split('~')
      .find(point => point.startsWith(location + ','));
    url.searchParams.set('ll',location);
    url.searchParams.set('z','17');
    url.searchParams.set('pt',marker);
  }
  mapFrame.title = location ? 'Яндекс Карты — ' + selected.textContent : overviewTitle;
  mapFrame.src = url.href;
});
mapControls.hidden = false;
