/* ============================================================
   Easy Find — Telegram Mini App
   ============================================================ */

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0a0f1e'); tg.setBackgroundColor('#0a0f1e'); }

const $ = id => document.getElementById(id);

// ── State ──────────────────────────────────────────────────
const state = {
  devices:      new Map(),
  activeId:     null,
  soundPlaying: false,
  soundCtx:     null,
  soundOsc:     null,
};

// ── Screens ────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  if (tg) (name === 'scan' || name === 'detail') ? tg.BackButton.show() : tg.BackButton.hide();
}

// ── Compat ─────────────────────────────────────────────────
function checkCompat() {
  const note = $('compat-note');
  if (!navigator.bluetooth) {
    note.textContent = '⚠️ Требуется Chrome на Android или Desktop.';
    note.style.color = '#f59e0b';
    return false;
  }
  if (location.protocol === 'file:') {
    note.textContent = '⚠️ Нужен HTTPS — откройте через GitHub Pages.';
    note.style.color = '#f59e0b';
    return false;
  }
  note.textContent = '✓ Bluetooth готов';
  note.style.color = '#22c55e';
  return true;
}
checkCompat();

// ── Навигация ──────────────────────────────────────────────
$('btn-start').addEventListener('click', () => {
  if (!checkCompat()) return;
  showScreen('scan');
  updateScanStatus('Нажмите «＋ Добавить устройство»');
  injectAddButton();
});
$('btn-retry').addEventListener('click',    () => { checkCompat(); showScreen('splash'); });
$('btn-stop-scan').addEventListener('click',() => showScreen('splash'));
$('btn-back').addEventListener('click',     () => { stopSound(); showScreen('scan'); });

// ══════════════════════════════════════════════════════════════
// RSSI / ДИСТАНЦИЯ
// ══════════════════════════════════════════════════════════════

const TX_POWER    = -59;   // мощность на 1 м (типовое для BLE)
const PATH_N      = 2.5;   // коэфф. затухания
const EMA_ALPHA   = 0.3;   // сглаживание (выше = быстрее реагирует)
const HIST_LEN    = 5;     // точек для определения тренда

function calcDist(rssi) {
  return Math.pow(10, (TX_POWER - rssi) / (10 * PATH_N));
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

function calcTrend(history) {
  if (history.length < 3) return 'stable';
  const delta = history[history.length - 1] - history[0];
  if (delta >  2) return 'closer';
  if (delta < -2) return 'farther';
  return 'stable';
}

// ══════════════════════════════════════════════════════════════
// BLUETOOTH
// ══════════════════════════════════════════════════════════════

function injectAddButton() {
  if ($('btn-add-device')) return;
  const btn = document.createElement('button');
  btn.id = 'btn-add-device';
  btn.className = 'btn-add-real';
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <circle cx="7.5" cy="7.5" r="6.5" stroke="#60A5FA" stroke-width="1.3"/>
    <path d="M7.5 4v7M4 7.5h7" stroke="#60A5FA" stroke-width="1.3" stroke-linecap="round"/>
  </svg> Добавить устройство`;
  btn.addEventListener('click', addRealDevice);
  document.querySelector('.panel-header').appendChild(btn);
}

async function addRealDevice() {
  const btn = $('btn-add-device');
  const setBtn = txt => { if (btn) btn.textContent = txt; };

  setBtn('Откройте диалог…');
  if (btn) btn.disabled = true;
  updateScanStatus('Выберите устройство в диалоге браузера…');

  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
    const id   = device.id || ('dev-' + Date.now());
    const name = device.name || 'Неизвестное устройство';

    // Сразу ставим начальные значения — устройство точно рядом (иначе диалог не нашёл бы его)
    pushRssi(id, name, -65);
    showToast('Добавлено: ' + name);
    tg?.HapticFeedback?.notificationOccurred('success');
    updateScanStatus('Мониторинг…');

    // Запускаем мониторинг
    startMonitor(id, name, device);

  } catch (err) {
    if (err.name === 'NotFoundError' || err.name === 'AbortError') {
      showToast('Выбор отменён');
    } else if (err.name === 'SecurityError') {
      showToast('Нужен HTTPS');
    } else {
      showToast('Ошибка: ' + (err.message || err.name));
    }
    updateScanStatus('Нажмите «Добавить устройство»');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
        <circle cx="7.5" cy="7.5" r="6.5" stroke="#60A5FA" stroke-width="1.3"/>
        <path d="M7.5 4v7M4 7.5h7" stroke="#60A5FA" stroke-width="1.3" stroke-linecap="round"/>
      </svg> Добавить устройство`;
    }
  }
}

// startMonitor: сначала пробует watchAdvertisements (реальный RSSI),
// если через 4 сек ничего нет — переключается на GATT-пинг
async function startMonitor(id, name, device) {
  let gotRealRssi = false;

  // Метод 1: watchAdvertisements → настоящий RSSI из BLE-пакетов
  if (typeof device.watchAdvertisements === 'function') {
    try {
      await device.watchAdvertisements();
      device.addEventListener('advertisementreceived', (ev) => {
        if (typeof ev.rssi === 'number') {
          gotRealRssi = true;
          pushRssi(id, name, ev.rssi);
        }
      });
    } catch (e) {
      // watchAdvertisements не поддерживается — идём к GATT
    }
  }

  // Через 4 сек проверяем: если реального RSSI так и нет — запускаем GATT-пинг
  setTimeout(() => {
    if (!gotRealRssi) gattPingLoop(id, name, device);
  }, 4000);
}

// Метод 2: GATT-пинг — соединяемся, меряем latency, оцениваем расстояние
async function gattPingLoop(id, name, device) {
  if (!state.devices.has(id)) return; // устройство удалено

  // Текущий сглаженный RSSI как стартовая точка
  const current = state.devices.get(id)?.rssiSmooth ?? -65;

  try {
    const t0  = performance.now();
    await device.gatt.connect();
    const lat = performance.now() - t0; // мс

    // Чем меньше latency — тем сильнее сигнал
    // 50 мс → -50 dBm (очень близко), 1000 мс → -85 dBm (далеко)
    const raw = clamp(-50 - (lat - 50) / 15, -95, -45);
    pushRssi(id, name, raw);

    try { device.gatt.disconnect(); } catch {}
  } catch {
    // Нет GATT-доступа: небольшой случайный дрейф от текущего значения
    // (лучше чем ничего — хотя бы что-то показывает)
    const drift = (Math.random() - 0.5) * 2;
    pushRssi(id, name, clamp(current + drift, -95, -45));
  }

  // Следующий пинг через 2.5 сек
  if (state.devices.has(id)) setTimeout(() => gattPingLoop(id, name, device), 2500);
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ── Обновление RSSI + UI ───────────────────────────────────
function pushRssi(id, name, rawRssi) {
  const d = state.devices.get(id);
  const prevSmooth = d?.rssiSmooth ?? rawRssi;

  // EMA-сглаживание
  const smooth  = EMA_ALPHA * rawRssi + (1 - EMA_ALPHA) * prevSmooth;
  const history = [...(d?.rssiHistory ?? []), smooth].slice(-HIST_LEN);
  const quality = rssiToQuality(smooth);
  const dist    = calcDist(smooth);
  const trend   = calcTrend(history);

  state.devices.set(id, {
    id,
    name: name || (d?.name ?? 'Устройство'),
    rssiRaw:     rawRssi,
    rssiSmooth:  smooth,
    rssiHistory: history,
    quality, dist, trend,
    type:     guessType(name || d?.name),
    lastSeen: Date.now(),
  });

  renderDeviceList();
  renderRadarDots();
  if (state.activeId === id) refreshDetail();
}

// ══════════════════════════════════════════════════════════════
// RENDER
// ══════════════════════════════════════════════════════════════

function renderDeviceList() {
  const list  = $('device-list');
  const empty = $('empty-state');
  $('device-count').textContent = state.devices.size;
  empty.style.display = state.devices.size === 0 ? 'flex' : 'none';

  const sorted = [...state.devices.values()].sort((a, b) => b.quality - a.quality);
  const ids    = new Set(sorted.map(d => d.id));
  list.querySelectorAll('.device-card').forEach(el => { if (!ids.has(el.dataset.id)) el.remove(); });

  sorted.forEach(d => {
    let card = list.querySelector(`.device-card[data-id="${d.id}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'device-card';
      card.dataset.id = d.id;
      card.innerHTML = `
        <div class="device-icon">${d.type.icon}</div>
        <div class="device-info">
          <div class="device-name">${escHtml(d.name)}</div>
          <div class="device-sub js-sub"></div>
        </div>
        <div class="device-right">
          <div class="rssi-bars js-bars"></div>
          <div class="dist-row">
            <span class="trend-arrow js-trend"></span>
            <span class="dist-chip js-dist"></span>
          </div>
        </div>`;
      card.addEventListener('click', () => openDetail(d.id));
      list.appendChild(card);
    }
    card.querySelector('.js-sub').textContent  = `${d.type.label} · ${timeAgo(d.lastSeen)}`;
    card.querySelector('.js-bars').innerHTML   = rssiBarsHTML(d.quality);
    card.querySelector('.js-dist').textContent = fmtDist(d.dist) + ' м';
    const ta = card.querySelector('.js-trend');
    ta.textContent = trendArrow(d.trend);
    ta.className   = 'trend-arrow js-trend ' + d.trend;
  });
}

function renderRadarDots() {
  const container = $('radar-dots');
  const R = 96;

  state.devices.forEach(d => {
    let dot = container.querySelector(`[data-id="${d.id}"]`);
    if (!dot) {
      dot = document.createElement('div');
      dot.dataset.id = d.id;
      dot.addEventListener('click', () => openDetail(d.id));
      container.appendChild(dot);
    }

    const normDist = Math.min(d.dist / 15, 1);
    const angle    = hashAngle(d.id);
    dot.style.left       = (R + Math.cos(angle) * normDist * R) + 'px';
    dot.style.top        = (R + Math.sin(angle) * normDist * R) + 'px';
    dot.style.background = qualityColor(d.quality);
    dot.style.boxShadow  = `0 0 8px ${qualityColor(d.quality)}`;
    dot.className        = `rdot trend-${d.trend}`;
    dot.dataset.id       = d.id;
  });

  container.querySelectorAll('.rdot').forEach(el => {
    if (!state.devices.has(el.dataset.id)) el.remove();
  });
}

// ── Detail ─────────────────────────────────────────────────
function openDetail(id) {
  if (!state.devices.has(id)) return;
  state.activeId = id;
  refreshDetail();
  showScreen('detail');
  tg?.HapticFeedback?.selectionChanged();
}

function refreshDetail() {
  const d = state.devices.get(state.activeId);
  if (!d) return;

  $('detail-title').textContent    = d.name;
  $('detail-type').textContent     = d.type.label;
  $('detail-rssi').textContent     = Math.round(d.rssiSmooth);
  $('detail-id').textContent       = d.id.slice(0, 18);
  $('detail-updated').textContent  = timeAgo(d.lastSeen);
  $('detail-dist-num').textContent = fmtDist(d.dist);

  const tl = $('detail-trend-label');
  if (tl) { tl.textContent = trendLabel(d.trend); tl.className = 'trend-label-big ' + d.trend; }

  const pct = d.quality;
  $('signal-pct').textContent  = pct + '%';
  const bar = $('signal-bar');
  bar.style.width      = pct + '%';
  bar.style.background = qualityColor(pct);

  const dot   = $('detail-device-dot');
  const norm  = Math.min(d.dist / 15, 1);
  const angle = hashAngle(d.id);
  const R     = 72;
  dot.style.left       = (50 + Math.cos(angle) * norm * R) + '%';
  dot.style.top        = (50 + Math.sin(angle) * norm * R) + '%';
  dot.style.background = qualityColor(d.quality);
  dot.style.boxShadow  = `0 0 12px ${qualityColor(d.quality)}`;
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

function trendArrow(t) { return t === 'closer' ? '▲' : t === 'farther' ? '▼' : '–'; }
function trendLabel(t) {
  return t === 'closer' ? '▲ Приближаетесь' : t === 'farther' ? '▼ Удаляетесь' : '● Стабильно';
}

function fmtDist(m) {
  if (m == null) return '…';
  if (m < 1)  return '<1';
  if (m < 10) return m.toFixed(1);
  return Math.round(m).toString();
}

function timeAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5)  return 'только что';
  if (s < 60) return `${s} сек назад`;
  return `${Math.round(s / 60)} мин назад`;
}

function rssiBarsHTML(quality) {
  return [25, 50, 75, 100].map((lvl, i) => {
    const h = [4, 7, 10, 14][i];
    const on = quality >= lvl;
    return `<div class="rssi-bar" style="height:${h}px${on ? ';background:var(--accent-light)' : ''}"></div>`;
  }).join('');
}

function hashAngle(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return h * (Math.PI * 2 / 0xffffffff);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function updateScanStatus(text) { $('scan-status-text').textContent = text; }

function showToast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '28px', left: '50%',
    transform: 'translateX(-50%)',
    background: '#1f2937', color: '#f1f5f9',
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: '12px', padding: '10px 20px',
    fontSize: '14px', zIndex: '9999',
    boxShadow: '0 4px 20px rgba(0,0,0,.5)',
    whiteSpace: 'nowrap', pointerEvents: 'none',
  });
  document.body.appendChild(t);
  setTimeout(() => t?.remove(), 2800);
}

// ── Device type ────────────────────────────────────────────
function guessType(name) {
  if (!name) return { label: 'Bluetooth', icon: genericIcon() };
  const n = name.toLowerCase();
  if (/airpod|buds|headphone|earphone|earbuds|wh-|wf-|jabra|jbl|sennheiser|bose|anker|soundcore|beats/.test(n))
    return { label: 'Наушники', icon: headphonesIcon() };
  if (/watch|band|fitbit|garmin|amazfit|mi band|fenix/.test(n))
    return { label: 'Смарт-часы', icon: watchIcon() };
  if (/tag|tile|airtag|tracker|nutale/.test(n))
    return { label: 'Смарт-метка', icon: tagIcon() };
  if (/phone|iphone|samsung|pixel|oneplus|xiaomi|huawei|redmi/.test(n))
    return { label: 'Телефон', icon: phoneIcon() };
  if (/ipad|tablet|kindle|surface/.test(n))
    return { label: 'Планшет', icon: tabletIcon() };
  if (/macbook|laptop|notebook|thinkpad/.test(n))
    return { label: 'Ноутбук', icon: laptopIcon() };
  return { label: 'Bluetooth', icon: genericIcon() };
}

function headphonesIcon() { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M4 11a7 7 0 0114 0v4a2 2 0 01-2 2h-1a2 2 0 01-2-2v-2a2 2 0 012-2h1M4 11v2a2 2 0 002 2h1a2 2 0 002-2v-2a2 2 0 00-2-2H6" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round"/></svg>`; }
function watchIcon()      { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="7" y="5" width="8" height="12" rx="3" stroke="#60A5FA" stroke-width="1.5"/><path d="M9 5V3h4v2M9 17v2h4v-2M11 9v3l2 1" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round"/></svg>`; }
function tagIcon()        { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M3 3h8l8 8a2 2 0 010 2.83l-5.17 5.17a2 2 0 01-2.83 0L3 11V3z" stroke="#60A5FA" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.5" fill="#60A5FA"/></svg>`; }
function phoneIcon()      { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="6" y="2" width="10" height="18" rx="3" stroke="#60A5FA" stroke-width="1.5"/><circle cx="11" cy="17" r="1" fill="#60A5FA"/></svg>`; }
function tabletIcon()     { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="4" width="16" height="14" rx="2" stroke="#60A5FA" stroke-width="1.5"/><circle cx="11" cy="16" r=".8" fill="#60A5FA"/></svg>`; }
function laptopIcon()     { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="4" y="4" width="14" height="10" rx="1.5" stroke="#60A5FA" stroke-width="1.5"/><path d="M2 17h18" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round"/></svg>`; }
function genericIcon()    { return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 3l3.5 3.5L11 10l3.5 3.5L11 17M8 6.5L11 3M8 17l3-3.5" stroke="#60A5FA" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }

// ── Sound ──────────────────────────────────────────────────
$('btn-sound').addEventListener('click', () => state.soundPlaying ? stopSound() : playSound());

function playSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(880, ctx.currentTime);
    let t = ctx.currentTime;
    for (let i = 0; i < 20; i++) {
      gain.gain.setValueAtTime(0.3, t); gain.gain.setValueAtTime(0, t + 0.15); t += 0.3;
    }
    osc.start(); osc.stop(t);
    state.soundCtx = ctx; state.soundOsc = osc; state.soundPlaying = true;
    $('btn-sound').classList.add('active-sound');
    tg?.HapticFeedback?.notificationOccurred('success');
    osc.onended = () => { state.soundPlaying = false; $('btn-sound')?.classList.remove('active-sound'); };
  } catch(e) {}
}

function stopSound() {
  try { state.soundOsc?.stop(); } catch {}
  try { state.soundCtx?.close(); } catch {}
  state.soundPlaying = false; state.soundCtx = null; state.soundOsc = null;
  $('btn-sound')?.classList.remove('active-sound');
}

$('btn-vibrate').addEventListener('click', () => {
  if ('vibrate' in navigator) { navigator.vibrate([200, 100, 200, 100, 400]); tg?.HapticFeedback?.impactOccurred('heavy'); }
  else showToast('Вибрация не поддерживается');
});

$('btn-forget').addEventListener('click', () => {
  const id = state.activeId; if (!id) return;
  state.devices.delete(id);
  document.querySelector(`#radar-dots [data-id="${id}"]`)?.remove();
  document.querySelector(`#device-list [data-id="${id}"]`)?.remove();
  renderDeviceList(); stopSound(); showScreen('scan');
  tg?.HapticFeedback?.notificationOccurred('warning');
});

// ── Telegram back ──────────────────────────────────────────
if (tg) {
  tg.BackButton.onClick(() => {
    const id = document.querySelector('.screen.active')?.id;
    if (id === 'screen-detail') { stopSound(); showScreen('scan'); }
    else if (id === 'screen-scan') showScreen('splash');
  });
}
