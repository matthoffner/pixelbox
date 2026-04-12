const changelogList = document.getElementById('changelog-list');
const itemTemplate = document.getElementById('changelog-item-template');

async function loadChangelog() {
  const response = await fetch('./changelog.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load changelog: ${response.status}`);
  }
  return response.json();
}

function renderChangelog(entries = []) {
  changelogList.innerHTML = '';

  for (const entry of entries) {
    const node = itemTemplate.content.cloneNode(true);
    node.querySelector('.changelog-date').textContent = entry.date;
    node.querySelector('.changelog-tag').textContent = entry.type;
    node.querySelector('.changelog-title').textContent = entry.title;
    node.querySelector('.changelog-summary').textContent = entry.summary;

    const pointsList = node.querySelector('.changelog-points');
    for (const point of entry.points || []) {
      const li = document.createElement('li');
      li.textContent = point;
      pointsList.appendChild(li);
    }

    changelogList.appendChild(node);
  }
}

function renderFallback(message) {
  changelogList.innerHTML = '';
  const item = document.createElement('article');
  item.className = 'changelog-item';
  item.innerHTML = `
    <div class="changelog-meta">
      <span>Unavailable</span>
      <span class="changelog-tag">Fallback</span>
    </div>
    <h4 class="changelog-title">Changelog feed not loaded</h4>
    <p class="changelog-summary">${message}</p>
  `;
  changelogList.appendChild(item);
}

loadChangelog()
  .then((payload) => renderChangelog(payload.entries || []))
  .catch((error) => renderFallback(error.message));
