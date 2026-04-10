const API_URL = 'https://ecode-api-oc7z.onrender.com';
const REMEMBERED_USER_KEY = 'ecode_remembered_user';
const CUSTOM_CATEGORY_KEY_PREFIX = 'ecode_custom_categories_';
const MAX_CUSTOM_CATEGORIES = 3;
const DEFAULT_CATEGORIES = ['Employee', 'Visitor', 'VIP', 'Student', 'Partner'];

let qrInstance = null;
let history = [];
let generatedCount = 0;
let scannedCount = 0;
let cameraStream = null;
let scanInterval = null;
let lastScanned = null;
let currentPreviewUid = null;
let CURRENT_USER_ID = '0000001';
let CURRENT_USER_DB_ID = null;
let CURRENT_USER_NAME = '';
let customCategories = [];
const OP_COOLDOWN_MS = 5000;
const lastOperationAt = { create: 0, view: 0, delete: 0 };

function updateCounters() {
  document.getElementById('countGenerated').textContent = generatedCount;
  document.getElementById('countScanned').textContent = scannedCount;
}

function syncGeneratedCount() {
  generatedCount = history.length;
  updateCounters();
}

updateCounters();
initCharCounters();
initCategorySelect();
initAuth();

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  event.currentTarget.classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
  if (tab !== 'scan' && cameraStream) stopCamera();
}

function generateUID() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ts = `${yyyy}${mm}${dd}${hh}${min}`;
  const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7).padEnd(7, '0');
  return `EC-${ts}-${CURRENT_USER_ID}-${rand}`;
}

function toUTF8BinaryString(text) { return text; }

function fromUTF8BinaryString(binaryText) {
  try { return decodeURIComponent(escape(binaryText)); }
  catch (_) { return binaryText; }
}

function createQRCodeWithFallback(container, text) {
  try {
    return new QRCode(container, {
      text, typeNumber: 0, width: 188, height: 188,
      colorDark: '#0f172a', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (e) {
    const reason = e && e.message ? e.message : '';
    if (!reason.toLowerCase().includes('code length overflow')) throw e;
    container.innerHTML = '';
    return new QRCode(container, {
      text, typeNumber: 0, width: 188, height: 188,
      colorDark: '#0f172a', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.L
    });
  }
}

function buildCompactPayload(data) { return data.uid || ''; }

function parsePayload(raw) {
  const text = String(raw || '')
    .trim()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
  const match = text.match(/^EC-(\d{12})-(\d{7})-([A-Z0-9]{7})$/i);
  if (!match) return null;
  const ts = match[1];
  const iso = `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}T${ts.slice(8,10)}:${ts.slice(10,12)}:00`;
  return { uid: text, timestamp: iso, userId: match[2], qrId: match[3] };
}

async function loadHistoryFromDB() {
  if (!CURRENT_USER_DB_ID) return;
  try {
    const res = await fetch(`${API_URL}/api/QrCodes/user/${CURRENT_USER_DB_ID}`);
    if (!res.ok) return;
    const data = await res.json();
    history = data.map(item => ({
      uid: item.uid,
      name: item.name || item.customText || '(No name)',
      timestamp: item.generatedAt,
      data: item.payloadText
    }));
    syncGeneratedCount();
    renderHistory();
  } catch (_) {}
}

async function loadScanCountFromDB() {
  if (!CURRENT_USER_DB_ID) return;
  try {
    const res = await fetch(`${API_URL}/api/Scan/count/${CURRENT_USER_DB_ID}`);
    if (!res.ok) return;
    const data = await res.json();
    scannedCount = Number(data.count || 0);
    updateCounters();
  } catch (_) {}
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateQR() {
  const generateBtn = document.getElementById('generateQrBtn');
  const name = document.getElementById('fieldName').value.trim();
  const categorySelect = document.getElementById('fieldCategory').value;
  const customCategory = document.getElementById('fieldCustomCategory').value.trim();
  const custom = document.getElementById('fieldCustom').value.trim();

  if (categorySelect === '__custom__' && !customCategory) {
    showNotif('Enter custom category');
    document.getElementById('fieldCustomCategory').focus();
    return;
  }
  if (!categorySelect) {
    showNotif('Select a category');
    document.getElementById('fieldCategory').focus();
    return;
  }
  if (!name && !custom) {
    showNotif('Enter a name or text');
    document.getElementById('fieldName').focus();
    return;
  }
  if (!(await openConfirmModal('Create QR Code', 'Create a new QR code?'))) return;
  if (!consumeCooldown('create', 'Create')) return;

  const uid = generateUID();
  const timestamp = new Date().toISOString();
  const qrContent = buildCompactPayload({ uid });
  const qrPayload = toUTF8BinaryString(qrContent);
  const categoryName = categorySelect === '__custom__' ? customCategory : categorySelect;
  const qrModal = openQrBuildModal();

  if (categorySelect === '__custom__' && !addCustomCategory(customCategory, { notify: false })) {
    showNotif(`Max ${MAX_CUSTOM_CATEGORIES} custom categories`);
    return;
  }

  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.classList.add('is-loading');
  }

  try {
    if (CURRENT_USER_DB_ID) {
      let attempt = 0;
      while (true) {
        attempt += 1;
        try {
          const res = await fetch(`${API_URL}/api/QrCodes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uid,
              creatorUserId: CURRENT_USER_DB_ID,
              subjectName: name || null,
              subjectEmail: document.getElementById('fieldEmail').value.trim() || null,
              subjectPhone: document.getElementById('fieldPhone').value.trim() || null,
              categoryName,
              customText: custom || null,
              payloadText: qrContent
            })
          });
          if (res.ok) break;
        } catch (_) {}

        qrModal.setStatus(attempt < 2 ? 'Saving to database...' : 'Database unavailable. Retrying...');
        await delay(2000);
      }

      await loadHistoryFromDB();
    } else {
      qrModal.setStatus('No account linked. Finalizing locally...');
      await delay(800);
    }

    qrModal.showReadyQr(qrPayload);
    await qrModal.closeAfter(1000);

    const qrContainer = document.getElementById('qrcode');
    qrContainer.innerHTML = '';
    document.getElementById('qrPlaceholder').style.display = 'none';
    const frame = document.getElementById('qrFrame');
    frame.classList.add('has-qr');
    qrInstance = createQRCodeWithFallback(qrContainer, qrPayload);
  } catch (e) {
    qrModal.closeNow();
    clearQRPreview();
    showNotif('Generation error: ' + (e && e.message ? e.message : 'Unknown error'));
    return;
  } finally {
    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.classList.remove('is-loading');
    }
  }

  document.getElementById('qrMetaId').textContent = uid;
  document.getElementById('qrMetaTime').textContent = formatDateTime(timestamp);
  document.getElementById('qrMeta').style.display = 'block';
  document.getElementById('qrButtons').style.display = 'flex';
  currentPreviewUid = uid;
  showNotif('QR code created successfully');
}
function downloadQR() {
  const canvas = document.querySelector('#qrcode canvas');
  const img = document.querySelector('#qrcode img');
  let src;
  if (canvas) { src = canvas.toDataURL('image/png'); }
  else if (img) { src = img.src; }
  else { showNotif('QR code is not created yet'); return; }
  const uid = document.getElementById('qrMetaId').textContent || 'ecode';
  const a = document.createElement('a');
  a.href = src; a.download = uid + '.png'; a.click();
  showNotif('Downloading...');
}

function copyData() {
  const id = document.getElementById('qrMetaId').textContent;
  if (!id || id === '-') { showNotif('Create a QR code first'); return; }
  navigator.clipboard.writeText(id).then(() => showNotif('ID copied to clipboard'));
}

function resetForm() {
  ['fieldName','fieldEmail','fieldPhone','fieldCustomCategory','fieldCustom'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('fieldCategory').value = '';
  clearQRPreview();
  updateCustomCategoryVisibility();
  refreshCharCounters();
}

function renderHistory() {
  const list = document.getElementById('historyList');
  if (history.length === 0) {
    list.innerHTML = '<div class="history-empty">History is empty</div>';
    return;
  }
  list.innerHTML = history.map(item => `
    <div class="history-item" onclick="loadHistoryItem('${item.uid}')">
      <div class="history-thumb">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <rect x="7" y="7" width="3" height="3"></rect><rect x="14" y="7" width="3" height="3"></rect>
          <rect x="7" y="14" width="3" height="3"></rect><rect x="14" y="14" width="3" height="3"></rect>
        </svg>
      </div>
      <div class="history-info">
        <div class="history-name">${escapeHtml(item.name)}</div>
        <div class="history-id">${item.uid}</div>
      </div>
      <div class="history-actions">
        <div class="history-time">${formatTime(item.timestamp)}</div>
        <button class="history-delete" onclick="deleteHistoryItem(event,'${item.uid}')" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><rect x="6" y="6" width="12" height="14" rx="2"></rect>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

function loadHistoryItem(uid) {
  if (!consumeCooldown('view', 'View')) return;
  const item = history.find(h => h.uid === uid);
  if (!item) return;
  try {
    const data = parsePayload(item.data);
    const tsVal = data && data.timestamp ? data.timestamp : item.timestamp;
    const qrContainer = document.getElementById('qrcode');
    const frame = document.getElementById('qrFrame');
    qrContainer.innerHTML = '';
    document.getElementById('qrPlaceholder').style.display = 'none';
    frame.classList.add('has-qr');
    qrInstance = createQRCodeWithFallback(qrContainer, toUTF8BinaryString(item.data));
    document.getElementById('qrMetaId').textContent = item.data || item.uid || '-';
    document.getElementById('qrMetaTime').textContent = formatDateTime(tsVal);
    document.getElementById('qrMeta').style.display = 'block';
    document.getElementById('qrButtons').style.display = 'flex';
    currentPreviewUid = item.uid;
    showNotif('QR loaded from history');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch(e) {
    showNotif('Failed to load data: ' + (e && e.message ? e.message : 'Unknown error'));
  }
}

function initCategorySelect() {
  document.getElementById('saveCustomCategoryBtn').addEventListener('click', onSaveCustomCategoryClick);
  document.getElementById('fieldCategory').addEventListener('change', updateCustomCategoryVisibility);
  renderCategorySelect();
  renderCustomCategoryList();
  updateCustomCategoryVisibility();
}

function updateCustomCategoryVisibility() {
  const isCustom = document.getElementById('fieldCategory').value === '__custom__';
  const wrap = document.getElementById('customCategoryWrap');
  const customInput = document.getElementById('fieldCustomCategory');
  wrap.style.display = isCustom ? 'block' : 'none';
  customInput.required = isCustom;
  if (!isCustom) { customInput.value = ''; refreshCharCounters(); }
}

function getCustomCategoryStorageKey() {
  if (!CURRENT_USER_DB_ID) return null;
  return `${CUSTOM_CATEGORY_KEY_PREFIX}${CURRENT_USER_DB_ID}`;
}

function normalizeCategoryName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function loadCustomCategories() {
  const key = getCustomCategoryStorageKey();
  if (!key) {
    customCategories = [];
    return;
  }

  const raw = localStorage.getItem(key);
  if (!raw) {
    customCategories = [];
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      customCategories = [];
      return;
    }
    customCategories = parsed
      .map(normalizeCategoryName)
      .filter(Boolean)
      .slice(0, MAX_CUSTOM_CATEGORIES);
  } catch (_) {
    customCategories = [];
  }
}

function saveCustomCategories() {
  const key = getCustomCategoryStorageKey();
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(customCategories));
}

function renderCategorySelect(selectedValue = null) {
  const select = document.getElementById('fieldCategory');
  const prev = selectedValue !== null ? selectedValue : select.value;
  let html = '<option value="">Select category</option>';
  html += DEFAULT_CATEGORIES.map(cat => `<option value="${cat}">${cat}</option>`).join('');
  html += customCategories.map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
  html += '<option value="__custom__">Custom...</option>';
  select.innerHTML = html;
  select.value = prev;
  if (select.value !== prev) select.value = '';
}

function renderCustomCategoryList() {
  const list = document.getElementById('customCategoryList');
  if (!customCategories.length) {
    list.innerHTML = '<div class="history-empty">No custom categories</div>';
    return;
  }
  list.innerHTML = customCategories.map(cat => `
    <div class="custom-category-item">
      <span class="custom-category-name">${escapeHtml(cat)}</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick="deleteCustomCategory(decodeURIComponent('${encodeURIComponent(cat)}'))">Delete</button>
    </div>
  `).join('');
}

function addCustomCategory(categoryName, options = {}) {
  const { notify = true } = options;
  const normalized = normalizeCategoryName(categoryName);
  if (!normalized) {
    if (notify) showNotif('Enter the category name');
    return false;
  }

  const exists = customCategories.some(cat => cat.toLowerCase() === normalized.toLowerCase());
  if (exists) {
    if (notify) showNotif('This category already exists');
    return true;
  }

  if (customCategories.length >= MAX_CUSTOM_CATEGORIES) {
    if (notify) showNotif(`Max ${MAX_CUSTOM_CATEGORIES} custom categories`);
    return false;
  }

  customCategories.push(normalized);
  saveCustomCategories();
  renderCategorySelect(normalized);
  renderCustomCategoryList();
  if (notify) showNotif('Category saved');
  return true;
}

async function deleteCustomCategory(categoryName) {
  const normalized = normalizeCategoryName(categoryName);
  if (!normalized) return;
  if (!(await openConfirmModal(
    'Delete Category',
    'Delete this custom category and permanently delete all QR codes in this category?'
  ))) return;

  if (CURRENT_USER_DB_ID) {
    try {
      const res = await fetch(
        `${API_URL}/api/QrCodes/category/by-name/permanent?userId=${CURRENT_USER_DB_ID}&categoryName=${encodeURIComponent(normalized)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showNotif(err.message || 'Failed to delete category');
        return;
      }
    } catch (_) {
      showNotif('Failed to connect to server');
      return;
    }
  }

  const before = customCategories.length;
  customCategories = customCategories.filter(cat => cat !== normalized);
  if (customCategories.length === before) return;

  saveCustomCategories();
  const selected = document.getElementById('fieldCategory').value;
  renderCategorySelect(selected === normalized ? '' : selected);
  renderCustomCategoryList();
  updateCustomCategoryVisibility();
  await loadHistoryFromDB();
  if (currentPreviewUid && !history.some(item => item.uid === currentPreviewUid)) clearQRPreview();
  showNotif('Category and related QR codes deleted permanently');
}

function onSaveCustomCategoryClick() {
  const input = document.getElementById('fieldCustomCategory');
  if (!addCustomCategory(input.value)) return;
  input.value = '';
  refreshCharCounters();
}

function initCharCounters() {
  document.querySelectorAll('[data-counter][data-max]').forEach(field => {
    field.addEventListener('input', refreshCharCounters);
    field.addEventListener('beforeinput', handleLimitBeforeInput);
  });
  refreshCharCounters();
}

function refreshCharCounters() {
  document.querySelectorAll('[data-counter][data-max]').forEach(field => {
    const counter = document.getElementById(field.dataset.counter);
    const max = Number(field.dataset.max) || field.maxLength || 0;
    if (!counter) return;
    counter.textContent = `${field.value.length}/${max}`;
    field.classList.toggle('is-limit-full', max > 0 && field.value.length >= max);
  });
}

function handleLimitBeforeInput(e) {
  const field = e.currentTarget;
  const max = Number(field.dataset.max) || field.maxLength || 0;
  if (max <= 0 || !e.inputType || !e.inputType.startsWith('insert')) return;
  if (field.value.length >= max && field.selectionStart === field.selectionEnd) {
    field.classList.remove('limit-shake');
    void field.offsetWidth;
    field.classList.add('limit-shake');
  }
}

async function clearHistory() {
  if (!(await openConfirmModal('Clear History', 'Are you sure you want to clear the history?'))) return;
  if (!consumeCooldown('delete', 'Delete')) return;
  const deleteModal = openQrDeleteModal();
  if (CURRENT_USER_DB_ID) {
    let deleted = 0;
    for (const item of history) {
      try {
        await fetch(`${API_URL}/api/QrCodes/${item.uid}/permanent?userId=${CURRENT_USER_DB_ID}`, { method: 'DELETE' });
        deleted += 1;
        deleteModal.setStatus(`Deleting from database... ${deleted}/${history.length}`);
      } catch (_) {
        deleteModal.closeNow();
        showNotif('Failed to connect to server');
        return;
      }
    }
  }
  await deleteModal.closeAfter(500);
  history = [];
  syncGeneratedCount();
  renderHistory();
  clearQRPreview();
  showNotif('History cleared');
}

async function deleteHistoryItem(event, uid) {
  event.stopPropagation();
  if (!(await openConfirmModal('Delete Item', 'Delete this history item?'))) return;
  if (!consumeCooldown('delete', 'Delete')) return;
  const deleteModal = openQrDeleteModal();
  if (CURRENT_USER_DB_ID) {
    try {
      await fetch(`${API_URL}/api/QrCodes/${uid}/permanent?userId=${CURRENT_USER_DB_ID}`, { method: 'DELETE' });
    } catch (_) {
      deleteModal.closeNow();
      showNotif('Failed to connect to server');
      return;
    }
  }
  await deleteModal.closeAfter(500);
  history = history.filter(item => item.uid !== uid);
  syncGeneratedCount();
  renderHistory();
  if (currentPreviewUid === uid) clearQRPreview();
  showNotif('History item deleted');
}

async function deleteHistoryItemForever(event, uid) {
  event.stopPropagation();
  if (!(await openConfirmModal('Delete Permanently', 'Delete this item forever? This cannot be undone.'))) return;
  if (!consumeCooldown('delete', 'Delete')) return;
  const deleteModal = openQrDeleteModal();
  if (CURRENT_USER_DB_ID) {
    try {
      await fetch(`${API_URL}/api/QrCodes/${uid}/permanent?userId=${CURRENT_USER_DB_ID}`, { method: 'DELETE' });
    } catch (_) {
      deleteModal.closeNow();
      showNotif('Failed to connect to server');
      return;
    }
  }
  await deleteModal.closeAfter(500);
  history = history.filter(item => item.uid !== uid);
  syncGeneratedCount();
  renderHistory();
  if (currentPreviewUid === uid) clearQRPreview();
  showNotif('History item permanently deleted');
}

function consumeCooldown(operation, label) {
  const now = Date.now();
  const elapsed = now - (lastOperationAt[operation] || 0);
  if (elapsed < OP_COOLDOWN_MS) {
    showNotif(`${label} cooldown: ${Math.ceil((OP_COOLDOWN_MS - elapsed) / 1000)}s`);
    return false;
  }
  lastOperationAt[operation] = now;
  return true;
}

function clearQRPreview() {
  document.getElementById('qrcode').innerHTML = '';
  document.getElementById('qrPlaceholder').style.display = 'flex';
  document.getElementById('qrFrame').classList.remove('has-qr');
  document.getElementById('qrMeta').style.display = 'none';
  document.getElementById('qrMetaId').textContent = '-';
  document.getElementById('qrMetaTime').textContent = '-';
  document.getElementById('qrButtons').style.display = 'none';
  qrInstance = null;
  currentPreviewUid = null;
}

function openConfirmModal(title, text) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalText').textContent = text;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    updateBodyScrollLock();

    const okBtn = document.getElementById('confirmModalOk');
    const cancelBtn = document.getElementById('confirmModalCancel');

    const close = (result) => {
      modal.classList.remove('show');
      modal.setAttribute('aria-hidden', 'true');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onEsc);
      updateBodyScrollLock();
      resolve(result);
    };

    const onOk = () => close(true);
    const onCancel = () => close(false);
    const onBackdrop = (e) => { if (e.target === modal) close(false); };
    const onEsc = (e) => { if (e.key === 'Escape') close(false); };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);
  });
}

function openQrBuildModal() {
  const modal = document.getElementById('qrBuildModal');
  const status = document.getElementById('qrBuildStatus');
  const grid = document.getElementById('qrBuildGrid');
  const finalWrap = document.getElementById('qrBuildFinal');
  if (!modal || !status || !grid || !finalWrap) {
    throw new Error('QR generation modal is not initialized');
  }

  const steps = ['Preparing data...', 'Building QR pattern...', 'Applying security mask...', 'Waiting for database...'];
  let stepIndex = 0;
  let isReady = false;

  status.textContent = steps[stepIndex];
  grid.innerHTML = '';
  finalWrap.innerHTML = '';
  finalWrap.style.display = 'none';
  grid.style.display = 'grid';

  for (let i = 0; i < 36; i += 1) {
    const cell = document.createElement('div');
    cell.className = 'qr-build-cell';
    cell.style.setProperty('--delay', `${(i % 6) * 80 + Math.floor(i / 6) * 40}ms`);
    grid.appendChild(cell);
  }

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  updateBodyScrollLock();

  const stepTimer = setInterval(() => {
    if (isReady) return;
    stepIndex = (stepIndex + 1) % steps.length;
    status.textContent = steps[stepIndex];
  }, 1300);

  const closeNow = () => {
    clearInterval(stepTimer);
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    updateBodyScrollLock();
  };

  return {
    setStatus(text) {
      if (!isReady) status.textContent = text;
    },
    showReadyQr(payload) {
      if (isReady) return;
      isReady = true;
      clearInterval(stepTimer);
      grid.style.display = 'none';
      finalWrap.style.display = 'flex';
      finalWrap.innerHTML = '';
      createQRCodeWithFallback(finalWrap, payload);
      status.textContent = 'QR code is ready';
    },
    async closeAfter(ms) {
      await delay(ms);
      closeNow();
    },
    closeNow
  };
}

function openQrDeleteModal() {
  const modal = document.getElementById('qrDeleteModal');
  const status = document.getElementById('qrDeleteStatus');
  const stage = document.getElementById('qrDeleteStage');
  if (!modal || !status || !stage) throw new Error('QR delete modal is not initialized');

  status.textContent = 'Deleting QR...';
  stage.innerHTML = '';

  for (let i = 0; i < 100; i += 1) {
    const cell = document.createElement('div');
    cell.className = 'qr-delete-cell';
    cell.style.setProperty('--fall-delay', `${(i % 10) * 25 + Math.floor(i / 10) * 25}ms`);
    stage.appendChild(cell);
  }

  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  updateBodyScrollLock();

  requestAnimationFrame(() => {
    stage.querySelectorAll('.qr-delete-cell').forEach(cell => cell.classList.add('is-falling'));
  });

  const closeNow = () => {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    updateBodyScrollLock();
  };

  return {
    setStatus(text) {
      status.textContent = text;
    },
    async closeAfter(ms) {
      await delay(ms);
      closeNow();
    },
    closeNow
  };
}
async function toggleCamera() {
  if (cameraStream) { stopCamera(); } else { await startCamera(); }
}

async function startCamera() {
  const btn = document.getElementById('btnCamera');
  const statusEl = document.getElementById('scanStatus');

  const constraints = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
    { video: true }
  ];

  let stream = null;
  for (const c of constraints) {
    try { stream = await navigator.mediaDevices.getUserMedia(c); break; }
    catch (_) {}
  }

  if (!stream) {
    showNotif('No camera access');
    statusEl.textContent = 'Camera access denied';
    return;
  }

  cameraStream = stream;
  const video = document.getElementById('video');
  video.srcObject = stream;
  try { await video.play(); } catch (_) {}

  btn.innerHTML = 'Stop Camera';
  btn.classList.remove('btn-primary');
  btn.classList.add('btn-ghost');
  statusEl.textContent = 'Scanning...';
  statusEl.className = 'scan-status scanning';
  document.getElementById('scanOverlay').style.display = 'flex';

  if (scanInterval) clearInterval(scanInterval);
  scanInterval = setInterval(scanFrame, 150);
}

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
  const video = document.getElementById('video');
  video.srcObject = null;
  lastScanned = null;
  const btn = document.getElementById('btnCamera');
  btn.innerHTML = 'Start Camera';
  btn.classList.add('btn-primary');
  btn.classList.remove('btn-ghost');
  const statusEl = document.getElementById('scanStatus');
  statusEl.textContent = 'Camera is off';
  statusEl.className = 'scan-status';
  document.getElementById('scanOverlay').style.display = 'none';
}

function scanFrame() {
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');

  if (!video || !cameraStream) return;
  if (!video.videoWidth || !video.videoHeight) return;

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const fullData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let code = jsQR(fullData.data, fullData.width, fullData.height, { inversionAttempts: 'attemptBoth' });

  if (!code) {
    const roiSize = Math.floor(Math.min(canvas.width, canvas.height) * 0.7);
    const roiX = Math.floor((canvas.width - roiSize) / 2);
    const roiY = Math.floor((canvas.height - roiSize) / 2);
    const roiData = ctx.getImageData(roiX, roiY, roiSize, roiSize);
    code = jsQR(roiData.data, roiData.width, roiData.height, { inversionAttempts: 'attemptBoth' });
  }

  if (code && code.data) {
    const normalized = String(code.data).trim();
    if (normalized === lastScanned) return;
    lastScanned = normalized;
    handleScanResult(normalized);
  }
}

function handleScanResult(raw) {
  document.getElementById('resultEmpty').style.display = 'none';
  const rd = document.getElementById('resultData');
  rd.classList.remove('visible');
  void rd.offsetWidth;
  rd.classList.add('visible');
  document.getElementById('resultRaw').textContent = raw;

  const fields = document.getElementById('resultFields');
  fields.innerHTML = '';

  const parsed = parsePayload(raw) || parsePayload(fromUTF8BinaryString(raw));
  const statusEl = document.getElementById('scanStatus');
  statusEl.className = 'scan-status scanning';
  statusEl.textContent = 'Processing scan...';

  if (parsed) {
    const entries = [
      ['ID', parsed.uid],
      ['User ID', parsed.userId],
      ['QR ID', parsed.qrId],
      ['Created at', formatDateTime(parsed.timestamp)]
    ];
    entries.forEach(([k, v]) => {
      const div = document.createElement('div');
      div.className = 'result-field';
      div.innerHTML = `<span class="result-field-key">${k}</span><span class="result-field-val">${escapeHtml(String(v))}</span>`;
      fields.appendChild(div);
    });
    showNotif('Scanned: ' + parsed.uid);
  } else {
    const div = document.createElement('div');
    div.className = 'result-field';
    div.innerHTML = `<span class="result-field-key">Content</span><span class="result-field-val">${escapeHtml(String(raw))}</span>`;
    fields.appendChild(div);
    showNotif('QR scanned (external format)');
  }

  saveScanWithAnimatedStatus(raw, statusEl)
    .then((saved) => {
      statusEl.textContent = saved ? 'QR code scanned!' : 'Scanned (not synced)';
      statusEl.className = saved ? 'scan-status success' : 'scan-status';
    })
    .finally(() => {
      setTimeout(() => {
        if (cameraStream) {
          statusEl.textContent = 'Scanning...';
          statusEl.className = 'scan-status scanning';
        }
        lastScanned = null;
      }, 3000);
    });
}

async function saveScanWithAnimatedStatus(raw, statusEl) {
  const steps = ['Validating QR...', 'Saving scan...', 'Updating stats...', 'Finalizing...'];
  let stepIndex = 0;
  statusEl.textContent = steps[stepIndex];

  const stepTimer = setInterval(() => {
    stepIndex = (stepIndex + 1) % steps.length;
    statusEl.textContent = steps[stepIndex];
  }, 900);

  try {
    const res = await fetch(`${API_URL}/api/Scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rawContent: raw,
        scannedByUserId: CURRENT_USER_DB_ID || null
      })
    });

    if (!res.ok) return false;
    await loadScanCountFromDB();
    return true;
  } catch (_) {
    return false;
  } finally {
    clearInterval(stepTimer);
  }
}

function clearScanResult() {
  document.getElementById('resultEmpty').style.display = 'block';
  document.getElementById('resultData').classList.remove('visible');
  lastScanned = null;
  const statusEl = document.getElementById('scanStatus');
  statusEl.textContent = cameraStream ? 'Scanning...' : 'Camera is off';
  statusEl.className = cameraStream ? 'scan-status scanning' : 'scan-status';
}

function showNotif(msg) {
  const n = document.getElementById('notif');
  document.getElementById('notifText').textContent = msg;
  n.classList.remove('show');
  void n.offsetWidth;
  n.classList.add('show');
  clearTimeout(n._t);
  n._t = setTimeout(() => n.classList.remove('show'), 3000);
}

function initAuth() {
  const authOverlay = document.getElementById('authOverlay');
  const appShell = document.getElementById('appShell');
  const authForm = document.getElementById('authForm');
  const submitBtn = document.getElementById('authSubmitBtn');
  const submitText = document.getElementById('authSubmitText');
  const contactInput = document.getElementById('authContact');
  const methodInputs = document.querySelectorAll('input[name="contactType"]');
  const authError = document.getElementById('authError');
  const badge = document.querySelector('.badge');
  const rememberMe = document.getElementById('rememberMe');
  const logoutBtn = document.getElementById('logoutBtn');
  const authLoadingMessages = {
    login: ['Checking account...', 'Verifying password...', 'Creating secure session...', 'Almost ready...'],
    register: ['Creating account...', 'Saving profile...', 'Setting up your workspace...', 'Almost ready...']
  };

  let loadingTextTimer = null;
  let loadingTextIndex = 0;
  let loadingTextMode = 'login';

  const updateLoadingText = () => {
    if (!submitText) return;
    const messages = authLoadingMessages[loadingTextMode] || authLoadingMessages.login;
    submitText.classList.remove('loading-text-change');
    void submitText.offsetWidth;
    submitText.textContent = messages[loadingTextIndex];
    submitText.classList.add('loading-text-change');
    loadingTextIndex = (loadingTextIndex + 1) % messages.length;
  };

  const setLoadingTextMode = (mode) => {
    if (!authLoadingMessages[mode]) return;
    loadingTextMode = mode;
    loadingTextIndex = 0;
    updateLoadingText();
  };

  const startLoadingTextRotation = () => {
    updateLoadingText();
    loadingTextTimer = setInterval(updateLoadingText, 3000);
  };

  const stopLoadingTextRotation = () => {
    if (loadingTextTimer) {
      clearInterval(loadingTextTimer);
      loadingTextTimer = null;
    }
    loadingTextIndex = 0;
    loadingTextMode = 'login';
    if (submitText) {
      submitText.classList.remove('loading-text-change');
      submitText.textContent = 'Sign in';
    }
  };

  const setAuthLoading = (isLoading) => {
    if (!submitBtn) return;
    submitBtn.classList.toggle('is-loading', isLoading);
    submitBtn.disabled = isLoading;
    if (isLoading) startLoadingTextRotation();
    else stopLoadingTextRotation();
    submitBtn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  };

  const updateContactInput = () => {
    const method = document.querySelector('input[name="contactType"]:checked').value;
    authError.textContent = '';
    contactInput.value = '';
    if (method === 'email') {
      contactInput.type = 'email';
      contactInput.placeholder = 'example@mail.com';
      contactInput.removeAttribute('pattern');
    } else {
      contactInput.type = 'tel';
      contactInput.placeholder = '+994 50 000 00 00';
      contactInput.setAttribute('pattern', '^\\+?[0-9\\s\\-()]{7,20}$');
    }
  };

  const openAccount = (user, remember = false) => {
    CURRENT_USER_DB_ID = user.id;
    CURRENT_USER_ID = String(user.id).padStart(7, '0');
    CURRENT_USER_NAME = user.name || '';
    loadCustomCategories();
    renderCategorySelect();
    renderCustomCategoryList();
    updateCustomCategoryVisibility();
    authOverlay.classList.add('hidden');
    appShell.classList.remove('hidden');
    if (badge) badge.textContent = `USER: ${user.name}`;
    if (remember) localStorage.setItem(REMEMBERED_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(REMEMBERED_USER_KEY);
    updateBodyScrollLock();
    showNotif(`Welcome, ${user.name}`);
    loadHistoryFromDB();
    loadScanCountFromDB();
  };

  const logout = () => {
    localStorage.removeItem(REMEMBERED_USER_KEY);
    CURRENT_USER_DB_ID = null;
    CURRENT_USER_ID = '0000001';
    CURRENT_USER_NAME = '';
    customCategories = [];
    history = [];
    generatedCount = 0;
    scannedCount = 0;
    stopCamera();
    clearScanResult();
    clearQRPreview();
    renderHistory();
    updateCounters();
    renderCategorySelect();
    renderCustomCategoryList();
    updateCustomCategoryVisibility();
    authForm.reset();
    document.getElementById('contactEmail').checked = true;
    updateContactInput();
    if (rememberMe) rememberMe.checked = false;
    if (badge) badge.textContent = 'BETA v1.1';
    appShell.classList.add('hidden');
    authOverlay.classList.remove('hidden');
    updateBodyScrollLock();
    showNotif('You are logged out');
  };

  methodInputs.forEach(input => input.addEventListener('change', updateContactInput));
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
  updateContactInput();
  updateBodyScrollLock();

  try {
    const rememberedRaw = localStorage.getItem(REMEMBERED_USER_KEY);
    if (rememberedRaw) {
      const rememberedUser = JSON.parse(rememberedRaw);
      if (rememberedUser && rememberedUser.id && rememberedUser.name) {
        if (rememberMe) rememberMe.checked = true;
        openAccount(rememberedUser, true);
      }
    }
  } catch (_) {}

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    authError.textContent = '';
    const name = document.getElementById('authName').value.trim();
    const method = document.querySelector('input[name="contactType"]:checked').value;
    const contact = contactInput.value.trim();
    const password = document.getElementById('authPassword').value;

    if (!name || !contact || !password) { authError.textContent = 'Please fill in all required fields.'; return; }
    if (password.length < 8) { authError.textContent = 'The password must contain at least 8 characters.'; return; }
    if (method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) { authError.textContent = 'Please enter a valid email address.'; return; }
    if (method === 'phone' && !/^\+?[0-9\s\-()]{7,20}$/.test(contact)) { authError.textContent = 'Please enter a valid phone number.'; return; }

    setAuthLoading(true);
    try {
      let res = await fetch(`${API_URL}/api/Auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactType: method, contactValue: contact, password })
      });

      if (res.status === 401) {
        setLoadingTextMode('register');
        res = await fetch(`${API_URL}/api/Auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fullName: name, contactType: method, contactValue: contact, password })
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        authError.textContent = err.message || `Request failed (${res.status}).`;
        return;
      }

      const data = await res.json();
      const user = { id: data.id, name: data.fullName || name };
      openAccount(user, Boolean(rememberMe && rememberMe.checked));

    } catch (e) {
      authError.textContent = 'Cannot connect to server. Please try again later.';
    } finally {
      setAuthLoading(false);
    }
  });
}

function updateBodyScrollLock() {
  const authVisible = !document.getElementById('authOverlay').classList.contains('hidden');
  const confirmVisible = document.getElementById('confirmModal').classList.contains('show');
  const qrBuildVisible = document.getElementById('qrBuildModal').classList.contains('show');
  const qrDeleteVisible = document.getElementById('qrDeleteModal').classList.contains('show');
  document.body.classList.toggle('modal-open', authVisible || confirmVisible || qrBuildVisible || qrDeleteVisible);
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('en-US');
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
