/* ============================================================
   Easy Find — Telegram Mini App
   ============================================================ */

// ── Telegram WebApp init ───────────────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#0a0f1e');
  tg.setBackgroundColor('#0a0f1e');
}

// ── State ──────────────────────────────────────────────────
const state = {
  devices: new Map(),
  activeId: null,
  demoRunning: false,
  soundPlaying: false,
  soundCtx: null,
  soundOscillator: null,
  demoIntervalId: null,
};

// ── Screens ────────────────────────────────────────────────
const screens = {
  splash: document.getElementById('screen-splash'),
  scan:   document.getElementById('screen-scan'),
  detail: document.getElementById('screen-detail'),
  nobt:   document.getElementById('screen-nobt'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// ── Check Bluetooth support ────────────────────────────────
const BT_SUPPORTED = !!navigator.bluetooth;

function checkCompat() {
  const note = document.getElementById('compat-note');
  if (!BT_SUPPORTED) {
    note.textContent = '⚠️ Web Bluetooth недоступен. Работает только в Chrome на Android/Desktop.';
    note.style.color = '#f59e0b';
  } else {
    // Warn if on file:// (BT will silently fail)
    if (location.protocol === 'file:') {
      note.textContent = '⚠️ Открыт как файл — нужен HTTPS. Запустите через сервер или GitHub Pages.';
      note.style.color = '#f59e0b';
    } else {
      note.textContent = '✓ Bluetooth готов к работе';
      note.style.color = '#22c55e';
    }
  }
}
checkCompat();

// ── Splash: кнопка старт ───────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  showScreen('scan');
  // Всегда запускаем демо-режим немедленно, чтобы UI был живым
  if (!state.demoRunning) startDemoMode();
  // На нормальном HTTPS с поддержкой BT — предлагаем добавить реальное устройство
  updateAddButton();
});

// ── No-BT экран ────────────────────────────────────────────
document.getElementById('btn-retry').addEventListener('click', () => {
  checkCompat();
  showScreen('splash');
});

// ── Stop scan / Back ───────────────────────────────────────
document.getElementById('btn-stop-scan').addEventListener('click', stopDemoMode);
document.getElementById('btn-back').addEventListener('click', () => {
  stopSound();
  showScreen('scan');
});

// ── RSSI/Distance утилиты ──────────────────────────────────
function rssiToDistance(rssi, txPower = -59, n = 2.5) {
  if (!rssi || rssi === 0) return 5;
  return Math.pow(10, (txPower - rssi) / (10 * n));
}

function rssiToQuality(rssi) {
  if (rssi >= -50)  return 100;
  if (rssi <= -100) return 0;
  return Math.round((rssi + 100) * 2);
}

function qualityColor(q) {
  if (q >= 70) return '#22c55e';
  if (q >= 40) return '#f59e0b';
  return '#ef4444';
}

// ── Device type ────────────────────────────────────────────
function guessType(name) {
  if (!name) return { label: 'Bluetooth', icon: genericIcon() };
  const n = name.toLowerCase();
  if (/airpod|buds|headphone|earphone|earbuds|wh-|wf-|jabra|jbl|sennheiser|bose|anker|soundcore|beats/.test(n))
    return { label: 'Наушники', icon: headphonesIcon() };
  if (/watch|band|fitbit|garmin|amazfit|mi band|fenix/.test(n))
    return { label: 'Смарт-часы', icon: watchIcon() };
  if (/tag|tile|airtag|find my|tracker|nutale/.test(n))
    return { label: 'Смарт-метка', icon: tagIcon() };
  if (/phone|iphone|samsung|pixel|oneplus|xiaomi|huawei|redmi/.test(n))
    return { label: 'Телефон', icon: phoneIcon() };
  if (/ipad|tablet|kindle|surface/.test(n))
    return { label: 'Планшет', icon: tabletIcon() };
  if (/macbook|laptop|notebook|thinkpad/.test(n))
    return { label: 'Ноутбук', icon: laptopIcon() };
  return { label: 'Bluetooth', icon: genericIcon() };
}

// ── SVG иконки ────────────────────────────────────────────
function headphonesIcon() { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 11a7 7 0 0114 0v4a2 2 0 01-2 2h-1a2 2 0 01-2-2v-2a2 2 0 012-2h1M4 11v2a2 2 0 002 2h1a2 2 0 002-2v-2a2 2 0 00-2-2H6" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round"/></svg>`; }
function watchIcon()      { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="7" y="5" width="8" height="12" rx="3" stroke="#60A5FA" stroke-width="1.5"/><path d="M9 5V3h4v2M9 17v2h4v-2M11 9v3l2 1" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round"/></svg>`; }
function tagIcon()        { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M3 3h8l8 8a2 2 0 010 2.83l-5.17 5.17a2 2 0 01-2.83 0L3 11V3z" stroke="#60A5FA" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.5" fill="#60A5FA"/></svg>`; }
function phoneIcon()      { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="6" y="2" width="10" height="18" rx="3" stroke="#60A5FA" stroke-width="1.5"/><circle cx="11" cy="17" r="1" fill="#60A5FA"/></svg>`; }
function tabletIcon()     { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="4" width="16" height="14" rx="2" stroke="#60A5FA" stroke-width="1.5"/><circle cx="11" cy="16" r=".8" fill="#60A5FA"/></svg>`; }
function laptopIcon()     { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="4" y="4" width="14" height="10" rx="1.5" stroke="#60A5FA" stroke-width="1.5"/><path d="M2 17h18" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round"/></svg>`; }
function genericIcon()    { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 3l3.5 3.5L11 10l3.5 3.5L11 17M8 6.5L11 3M8 17l3-3.5" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }

function rssiBarsHTML(quality) {
  const levels  = [25, 50, 75, 100];
  const heights = [4, 7, 10, 14];
  return levels.map((lvl, i) =>
    `<div class="rssi-bar" style="height:${heights[i]}px${quality >= lvl ? ';background:var(--accent-light)' : ''}"></div>`
  ).join('');
}

function fmtDist(m) {
  if (!m || m < 0) return '?';
  if (m < 10) return m.toFixed(1);
  return Math.round(m).toString();
}

function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5)  return 'только что';
  if (s < 60) return `${s} сек назад`;
  return `${Math.round(s / 60)} мин назад`;
}

// ══════════════════════════════════════════════════════════════
// DEMO MODE — всегда запускается, чтобы UI был живым
// ══════════════════════════════════════════════════════════════

const DEMO_DEVICES = [
  { id: 'demo-1', name: 'AirPods Pro',         rssi: -55 },
  { id: 'demo-2', name: 'Galaxy Buds2 Pro',     rssi: -72 },
  { id: 'demo-3', name: 'Tile Tracker',         rssi: -80 },
  { id: 'demo-4', name: 'Mi Band 8',            rssi: -61 },
  { id: 'demo-5', name: 'Apple Watch Series 9', rssi: -48 },
];

function startDemoMode() {
  if (state.demoRunning) return;
  state.demoRunning = true;
  updateScanStatus('Демо-режим · добавьте реальное устройство ниже');

  DEMO_DEVICES.forEach((d, i) => {
    setTimeout(() => {
      if (!state.demoRunning) return;
      addOrUpdateDevice(d.id, d.name, d.rssi, true);
    }, i * 500);
  });

  state.demoIntervalId = setInterval(() => {
    if (!state.demoRunning) return;
    DEMO_DEVICES.forEach(d => {
      d.rssi = Math.max(-100, Math.min(-40, d.rssi + (Math.random() - 0.5) * 4));
      addOrUpdateDevice(d.id, d.name, Math.round(d.rssi), true);
      if (state.activeId === d.id) refreshDetail();
    });
  }, 1500);
}

function stopDemoMode() {
  state.demoRunning = false;
  clearInterval(state.demoIntervalId);
  // Удаляем только демо-устройства
  DEMO_DEVICES.forEach(d => {
    state.devices.delete(d.id);
    document.querySelector(`#radar-dots [data-id="${d.id}"]`)?.remove();
    document.querySelector(`#device-list [data-id="${d.id}"]`)?.remove();
  });
  renderDeviceList();
  updateScanStatus('Остановлено');
}

// ══════════════════════════════════════════════════════════════
// REAL BLUETOOTH — requestDevice (Chrome picker)
// ══════════════════════════════════════════════════════════════

// Кнопка "Добавить устройство" добавляется динамически
function updateAddButton() {
  let btn = document.getElementById('btn-add-device');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'btn-add-device';
    btn.className = 'btn-add-real';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="8" stroke="#60A5FA" stroke-width="1.5"/>
        <path d="M9 5v8M5 9h8" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Добавить реальное устройство`;
    btn.addEventListener('click', addRealDevice);
    document.querySelector('.panel-header').appendChild(btn);
  }

  if (!BT_SUPPORTED || location.protocol === 'file:') {
    btn.disabled = true;
    btn.title = BT_SUPPORTED
      ? 'Требуется HTTPS (GitHub Pages)'
      : 'Web Bluetooth не поддерживается';
  }
}

async function addRealDevice() {
  const btn = document.getElementById('btn-add-device');
  if (btn) { btn.disabled = true; btn.textContent = 'Ожидание…'; }

  updateScanStatus('Выберите устройство в диалоге браузера…');

  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      // Не указываем optionalServices — избегаем ошибок совместимости
    });

    updateScanStatus('Подключение к ' + (device.name || 'устройству') + '…');

    // Пытаемся подключиться к GATT
    let rssiEstimate = -65;
    try {
      const t0 = performance.now();
      await device.gatt.connect();
      const latency = performance.now() - t0;
      // Грубая оценка RSSI по задержке: быстрее = ближе
      rssiEstimate = latency < 200 ? -50 : latency < 600 ? -65 : -80;
    } catch {
      // Не все устройства поддерживают GATT — всё равно добавляем
      rssiEstimate = -70;
    }

    const id = device.id || ('real-' + device.name + '-' + Date.now());
    addOrUpdateDevice(id, device.name, rssiEstimate, false);
    updateScanStatus('Демо-режим · мониторинг устройств');

    // Периодически обновляем RSSI пингом
    pollRealDevice(id, device, rssiEstimate);

    showToast(`✓ ${device.name || 'Устройство'} добавлено`);
    tg?.HapticFeedback?.notificationOccurred('success');

  } catch (err) {
    if (err.name === 'NotFoundError' || err.name === 'AbortError') {
      showToast('Выбор отменён');
    } else if (err.name === 'SecurityError') {
      showToast('Ошибка доступа — нужен HTTPS');
    } else {
      showToast('Ошибка: ' + (err.message || err.name));
      console.error('BT error:', err);
    }
    updateScanStatus('Демо-режим · добавьте реальное устройство ниже');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="8" stroke="#60A5FA" stroke-width="1.5"/>
          <path d="M9 5v8M5 9h8" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        Добавить реальное устройство`;
    }
  }
}

function pollRealDevice(id, device, initialRssi) {
  let rssi = initialRssi;
  const tick = async () => {
    if (!state.devices.has(id)) return; // устройство удалено

    // Симулируем небольшой дрейф RSSI (Web BT не даёт raw RSSI)
    rssi = Math.max(-100, Math.min(-40, rssi + (Math.random() - 0.5) * 3));
    addOrUpdateDevice(id, device.name, Math.round(rssi), false);
    if (state.activeId === id) refreshDetail();

    setTimeout(tick, 2000);
  };
  setTimeout(tick, 2000);
}

// ══════════════════════════════════════════════════════════════
// DEVICE MANAGEMENT
// ══════════════════════════════════════════════════════════════

function addOrUpdateDevice(id, name, rssi, isDemo) {
  const existing = state.devices.get(id);
  const q = rssiToQuality(rssi);
  const dist = rssiToDistance(rssi);
  const type = guessType(name);

  state.devices.set(id, {
    id,
    name: name || 'Неизвестное устройство',
    rssi,
    quality: q,
    dist,
    type,
    isDemo,
    lastSeen: Date.now(),
  });
  renderDeviceList();
  renderRadarDots();
}

function renderDeviceList() {
  const list  = document.getElementById('device-list');
  const empty = document.getElementById('empty-state');
  const count = document.getElementById('device-count');

  count.textContent = state.devices.size;
  empty.style.display = state.devices.size === 0 ? 'flex' : 'none';

  const sorted = [...state.devices.values()].sort((a, b) => b.quality - a.quality);
  const newIds = new Set(sorted.map(d => d.id));

  // Убираем удалённые карточки
  list.querySelectorAll('.device-card').forEach(el => {
    if (!newIds.has(el.dataset.id)) el.remove();
  });

  sorted.forEach(d => {
    let card = list.querySelector(`.device-card[data-id="${d.id}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'device-card';
      card.dataset.id = d.id;
      card.innerHTML = `
        <div class="device-icon">${d.type.icon}</div>
        <div class="device-info">
          <div class="device-name">${escHtml(d.name)}${d.isDemo ? ' <span class="demo-badge">демо</span>' : ''}</div>
          <div class="device-sub js-sub"></div>
        </div>
        <div class="device-right">
          <div class="rssi-bars js-bars"></div>
          <div class="dist-chip js-dist"></div>
        </div>`;
      card.addEventListener('click', () => openDetail(d.id));
      list.appendChild(card);
    }
    card.querySelector('.js-sub').textContent = `${d.type.label} · ${timeAgo(d.lastSeen)}`;
    card.querySelector('.js-bars').innerHTML  = rssiBarsHTML(d.quality);
    card.querySelector('.js-dist').textContent = fmtDist(d.dist) + ' м';
  });
}

function renderRadarDots() {
  const container = document.getElementById('radar-dots');
  const r = 100;

  state.devices.forEach(d => {
    let dot = container.querySelector(`[data-id="${d.id}"]`);
    if (!dot) {
      dot = document.createElement('div');
      dot.className = 'rdot' + (d.isDemo ? ' rdot-demo' : '');
      dot.dataset.id = d.id;
      dot.addEventListener('click', () => openDetail(d.id));
      container.appendChild(dot);
    }
    const normDist = Math.min(d.dist / 12, 1);
    const angle = hashAngle(d.id);
    const px = Math.cos(angle) * normDist * (r - 14);
    const py = Math.sin(angle) * normDist * (r - 14);
    dot.style.left = (r + px) + 'px';
    dot.style.top  = (r + py) + 'px';
  });

  container.querySelectorAll('.rdot').forEach(el => {
    if (!state.devices.has(el.dataset.id)) el.remove();
  });
}

function hashAngle(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return h * (Math.PI * 2 / 0xffffffff);
}

function updateScanStatus(text) {
  document.getElementById('scan-status-text').textContent = text;
}

// ══════════════════════════════════════════════════════════════
// DETAIL SCREEN
// ══════════════════════════════════════════════════════════════

function openDetail(id) {
  const d = state.devices.get(id);
  if (!d) return;
  state.activeId = id;
  refreshDetail();
  showScreen('detail');
  tg?.HapticFeedback?.selectionChanged();
}

function refreshDetail() {
  const d = state.devices.get(state.activeId);
  if (!d) return;

  document.getElementById('detail-title').textContent    = d.name;
  document.getElementById('detail-type').textContent     = d.type.label;
  document.getElementById('detail-rssi').textContent     = d.rssi ?? '?';
  document.getElementById('detail-id').textContent       = d.id.slice(0, 18);
  document.getElementById('detail-updated').textContent  = timeAgo(d.lastSeen);
  document.getElementById('detail-dist-num').textContent = fmtDist(d.dist);

  const pct = d.quality;
  document.getElementById('signal-pct').textContent = pct + '%';
  const bar = document.getElementById('signal-bar');
  bar.style.width      = pct + '%';
  bar.style.background = qualityColor(pct);

  const dot  = document.getElementById('detail-device-dot');
  const norm = Math.min(d.dist / 12, 1);
  const angle = hashAngle(d.id);
  const r = 75;
  dot.style.left = (50 + Math.cos(angle) * norm * r) + '%';
  dot.style.top  = (50 + Math.sin(angle) * norm * r) + '%';
}

// ── Sound ──────────────────────────────────────────────────
document.getElementById('btn-sound').addEventListener('click', () => {
  state.soundPlaying ? stopSound() : playSound();
});

function playSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);

    let t = ctx.currentTime;
    for (let i = 0; i < 20; i++) {
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.setValueAtTime(0,   t + 0.15);
      t += 0.3;
    }
    osc.start();
    osc.stop(t);

    state.soundCtx = ctx;
    state.soundOscillator = osc;
    state.soundPlaying = true;
    document.getElementById('btn-sound').classList.add('active-sound');
    tg?.HapticFeedback?.notificationOccurred('success');
    osc.onended = () => {
      state.soundPlaying = false;
      document.getElementById('btn-sound')?.classList.remove('active-sound');
    };
  } catch (e) { console.warn('Audio:', e); }
}

function stopSound() {
  try { state.soundOscillator?.stop(); } catch {}
  try { state.soundCtx?.close(); }       catch {}
  state.soundPlaying = false;
  state.soundCtx = null;
  state.soundOscillator = null;
  document.getElementById('btn-sound')?.classList.remove('active-sound');
}

// ── Vibration ──────────────────────────────────────────────
document.getElementById('btn-vibrate').addEventListener('click', () => {
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 400]);
    tg?.HapticFeedback?.impactOccurred('heavy');
    showToast('Вибрация запущена');
  } else {
    showToast('Вибрация не поддерживается на этом устройстве');
  }
});

// ── Forget ─────────────────────────────────────────────────
document.getElementById('btn-forget').addEventListener('click', () => {
  if (!state.activeId) return;
  const id = state.activeId;
  // Если это демо — убрать из массива DEMO_DEVICES тоже не нужно,
  // просто удаляем из state и UI
  document.querySelector(`#radar-dots [data-id="${id}"]`)?.remove();
  document.querySelector(`#device-list [data-id="${id}"]`)?.remove();
  state.devices.delete(id);
  renderDeviceList();
  stopSound();
  showScreen('scan');
  tg?.HapticFeedback?.notificationOccurred('warning');
});

// ── Helpers ────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showToast(msg) {
  // Убираем предыдущий тост
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.style.cssText = `
    position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
    background:#1f2937;color:#f1f5f9;border:1px solid rgba(255,255,255,.1);
    border-radius:12px;padding:10px 20px;font-size:14px;z-index:9999;
    box-shadow:0 4px 20px rgba(0,0,0,.5);white-space:nowrap;
    animation:card-in .2s ease;pointer-events:none;`;
  document.body.appendChild(t);
  setTimeout(() => t?.remove(), 2800);
}

// ── Telegram back button ───────────────────────────────────
if (tg) {
  tg.BackButton.onClick(() => {
    const active = document.querySelector('.screen.active');
    if (active?.id === 'screen-detail') {
      stopSound();
      showScreen('scan');
    } else if (active?.id === 'screen-scan') {
      showScreen('splash');
    }
  });

  const obs = new MutationObserver(() => {
    const id = document.querySelector('.screen.active')?.id;
    (id === 'screen-scan' || id === 'screen-detail')
      ? tg.BackButton.show()
      : tg.BackButton.hide();
  });
  document.querySelectorAll('.screen').forEach(s =>
    obs.observe(s, { attributes: true, attributeFilter: ['class'] })
  );
}
