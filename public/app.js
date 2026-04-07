let pendingDelete = null;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const res = await apiFetch('/api/status');
  const { authenticated, authUrl } = await res.json();
  if (!authenticated) {
    document.getElementById('empty-state').innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
      <p>Connect your Shopify store to get started</p>
      <a href="${authUrl}" class="btn btn-primary">Connect Shopify</a>
    `;
    document.getElementById('scan-btn').classList.add('hidden');
  }
}

init();

// ── Fetch helper (bypasses ngrok browser warning interstitial) ────────────────

function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { 'ngrok-skip-browser-warning': 'true', ...options.headers }
  });
}

// ── Scan ──────────────────────────────────────────────────────────────────────

document.getElementById('scan-btn').addEventListener('click', scan);

async function scan() {
  const btn = document.getElementById('scan-btn');
  btn.disabled = true;
  btn.textContent = 'Scanning…';

  show('loading');
  hide('empty-state', 'results', 'no-dupes');

  try {
    const res = await apiFetch('/api/duplicates');
    if (!res.ok) throw new Error((await res.json()).error || 'Scan failed');
    const { duplicates, totalProducts } = await res.json();

    if (duplicates.length === 0) {
      show('no-dupes');
    } else {
      renderResults(duplicates, totalProducts);
      show('results');
    }
  } catch (err) {
    showToast(err.message, 'error');
    show('empty-state');
  } finally {
    hide('loading');
    btn.disabled = false;
    btn.textContent = 'Scan for Duplicates';
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderResults(duplicates, totalProducts) {
  const summary = document.getElementById('summary');
  const totalVariants = duplicates.reduce((n, g) => n + g.variants.length, 0);

  summary.innerHTML = `
    <div class="summary-stats">
      <div class="stat">
        <span class="stat-value">${totalProducts.toLocaleString()}</span>
        <span class="stat-label">Products scanned</span>
      </div>
      <div class="stat">
        <span class="stat-value">${duplicates.length}</span>
        <span class="stat-label">Duplicate UPCs</span>
      </div>
      <div class="stat">
        <span class="stat-value">${totalVariants}</span>
        <span class="stat-label">Affected variants</span>
      </div>
    </div>
    <button class="btn btn-primary" onclick="scan()">Rescan</button>
  `;

  const groupsEl = document.getElementById('groups');
  groupsEl.className = 'groups';
  groupsEl.innerHTML = duplicates.map(group => renderGroup(group)).join('');
}

function renderGroup({ barcode, variants }) {
  const cards = variants.map(v => renderCard(v)).join('');
  return `
    <div class="group" id="group-${barcode.replace(/\W/g, '_')}">
      <div class="group-header">
        <div class="group-upc">
          <span class="upc-label">UPC</span>
          <span class="upc-value">${esc(barcode)}</span>
        </div>
        <span class="group-count">${variants.length} variants</span>
      </div>
      <div class="cards">${cards}</div>
    </div>
  `;
}

function renderCard(v) {
  const imageHtml = v.imageUrl
    ? `<img src="${esc(v.imageUrl)}" alt="${esc(v.productTitle)}" loading="lazy">`
    : `<div class="no-image">
         <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
           <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 20.25h18A2.25 2.25 0 0023.25 18V6A2.25 2.25 0 0021 3.75H3A2.25 2.25 0 00.75 6v12A2.25 2.25 0 003 20.25z"/>
         </svg>
       </div>`;

  const skuHtml = v.sku
    ? `<div class="meta-row"><span class="meta-key">SKU</span><span class="meta-value">${esc(v.sku)}</span></div>`
    : '';

  const warningHtml = v.isOnlyVariant
    ? `<div class="only-variant-warning">
         <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" style="flex-shrink:0;margin-top:1px">
           <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
         </svg>
         Deleting this will also delete the product (only variant)
       </div>`
    : '';

  return `
    <div class="card" id="card-${v.variantId}"
      data-variant-id="${v.variantId}"
      data-product-id="${v.productId}"
      data-product-title="${esc(v.productTitle)}"
      data-variant-title="${esc(v.variantTitle)}">
      <div class="card-image">${imageHtml}</div>
      <div class="card-body">
        <div class="card-titles">
          <div class="card-product">${esc(v.productTitle)}</div>
          <div class="card-variant">${esc(v.variantTitle)}</div>
        </div>
        <div class="card-meta">
          ${skuHtml}
          <div class="meta-row"><span class="meta-key">Price</span><span class="meta-value price">$${esc(v.price)}</span></div>
        </div>
        ${warningHtml}
      </div>
      <div class="card-footer">
        <button class="btn btn-danger delete-btn">Delete</button>
      </div>
    </div>
  `;
}

// ── Delete ────────────────────────────────────────────────────────────────────

document.getElementById('groups').addEventListener('click', e => {
  const btn = e.target.closest('.delete-btn');
  if (!btn) return;
  const card = btn.closest('.card');
  const { variantId, productId, productTitle, variantTitle } = card.dataset;
  pendingDelete = { variantId, productId, card };
  document.getElementById('confirm-text').textContent =
    `Delete "${variantTitle}" from "${productTitle}"? This cannot be undone.`;
  show('confirm-modal');
});

document.getElementById('confirm-cancel').addEventListener('click', () => {
  pendingDelete = null;
  hide('confirm-modal');
});

document.getElementById('confirm-delete').addEventListener('click', async () => {
  if (!pendingDelete) return;
  const { variantId, productId, card } = pendingDelete;
  pendingDelete = null;
  hide('confirm-modal');

  // Instant visual feedback — grey out immediately
  card.classList.add('deleting');
  card.querySelector('.delete-btn').textContent = 'Deleting…';
  card.querySelector('.delete-btn').disabled = true;

  await deleteVariant(variantId, productId, card);
});

async function deleteVariant(variantId, productId, card) {
  const btn = card.querySelector('.delete-btn');

  try {
    const res = await apiFetch(`/api/variants/${productId}/${variantId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');

    card.classList.remove('deleting');
    card.classList.add('deleted');
    btn.textContent = 'Deleted';
    showToast('Variant deleted', 'success');

    // Collapse group if only one card remains
    const groupCards = card.closest('.cards');
    const remaining = [...groupCards.querySelectorAll('.card:not(.deleted)')];
    if (remaining.length <= 1) {
      setTimeout(() => {
        const group = card.closest('.group');
        group.style.transition = 'opacity 0.4s';
        group.style.opacity = '0';
        setTimeout(() => group.remove(), 400);
      }, 800);
    }
  } catch (err) {
    card.classList.remove('deleting');
    btn.disabled = false;
    btn.textContent = 'Delete';
    showToast(err.message, 'error');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function show(...ids) { ids.forEach(id => document.getElementById(id)?.classList.remove('hidden')); }
function hide(...ids) { ids.forEach(id => document.getElementById(id)?.classList.add('hidden')); }

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast${type ? ' ' + type : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}
