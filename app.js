/* ============================================================
   Easy Find — Telegram Mini App
   ============================================================ */

// ── Telegram WebApp ────────────────────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0a0f1e'); tg.setBackgroundColor('#0a0f1e'); }

// ── State ──────────────────────────────────────────────────
const state = {
  devices:       new Map(),   // id → DeviceEntry
  activeId:      null,
  soundPlaying:  false,
  soundCtx:      null,
  soundOsc:      null,
};

// DeviceEntry shape:
// { id, name, rssiRaw, rssiSmooth, rssiHistory[], quality, dist, trend, type, lastSeen }

// ── Screens ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  if (tg) {
    (name === 'scan' || name === 'detail') ? tg.BackButton.show() : tg.BackButton.hide();
  }
}

// ── Compat check ───────────────────────────────────────────
function checkCompat() {
  const note = $('compat-note');
  if (!navigator.bluetooth) {
    note.textContent = '⚠️ Требуется Chrome на Android или Desktop.';
    note.style.color = '#f59e0b';
    return false;
  }
  if (location.protocol === 'file:') {
    note.textContent = '⚠️ Нужен HTTPS — откройте через GitHub Pages или localhost.';
    note.style.color = '#f59e0b';
    return false;
  }
  note.textContent = '✓ Bluetooth готов';
  note.style.color = '#22c55e';
  return true;
}
checkCompat();

// ── Splash → кнопка ───────────────────────────────────────
$('btn-start').addEventListener('click', () => {
  if (!checkCompat()) return;
  showScreen('scan');
  updateScanStatus('Нажмите «＋ Добавить устройство»');
  updateAddButton();
});

$('btn-retry').addEventListener('click', () => { checkCompat(); showScreen('splash'); });
$('btn-stop-scan').addEventListener('click', () => { showScreen('splash'); });
$('btn-back').addEventListener('click', () => { stopSound(); showScreen('scan'); });

// ══════════════════════════════════════════════════════════════
// RSSI / ДИСТАНЦИЯ
// ══════════════════════════════════════════════════════════════

const EMA_ALPHA   = 0.25;   // сглаживание: меньше = плавнее, медленнее
const TX_POWER    = -59;    // типичная мощность BLE на 1 м
const PATH_LOSS_N = 2.5;    // коэф. затухания (2=открыто, 3=помещение)
const HISTORY_LEN = 6;      // точек для определения тренда

function calcDistance(rssi) {
  if (!rssi || rssi === 0) return null;
  return Math.pow(10, (TX_POWER - rssi) / (10 * PATH_LOSS_N));
}

function rssiToQuality(rssi) {
  if (!rssi) return 0;
  if (rssi >= -50)  return 100;
  if (rssi <= -100) return 0;
  return Math.round((rssi + 100) * 2);
}

function qualityColor(q) {
  if (q >= 70) return '#22c55e';
  if (q >= 40) return '#f59e0b';
  return '#ef4444';
}

// Тренд по последним N точкам RSSI (выше = ближе)
function calcTrend(history) {
  if (history.length < 3) return 'stable';
  const recent = history.slice(-3);
  const delta  = recent[recent.length - 1] - recent[0];
  if (delta >  2) return 'closer';   // RSSI растёт → ближе
  if (delta < -2) return 'farther';  // RSSI падает → дальше
  return 'stable';
}

// ══════════════════════════════════════════════════════════════
// BLUETOOTH — добавление устройства
// ══════════════════════════════════════════════════════════════

function updateAddButton() {
  let btn = $('btn-add-device');
  if (btn) return;

  btn = document.createElement('button');
  btn.id = 'btn-add-device';
  btn.className = 'btn-add-real';
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" stroke="#60A5FA" stroke-width="1.4"/>
    <path d="M8 4v8M4 8h8" stroke="#60A5FA" stroke-width="1.4" stroke-linecap="round"/>
  </svg> Добавить устройство`;
  btn.addEventListener('click', addRealDevice);
  document.querySelector('.panel-header').appendChild(btn);
}

async function addRealDevice() {
  const btn = $('btn-add-device');
  if (btn) { btn.disabled = true; btn.textContent = 'Выберите в диалоге…'; }

  updateScanStatus('Выберите устройство в диалоге браузера…');

  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
    const id     = device.id || ('dev-' + Date.now());
    const name   = device.name || 'Неизвестное устройство';

    // Инициализируем запись с нулём (устройство найдено, RSSI ещё неизвестен)
    initDevice(id, name);
    updateScanStatus('Получение сигнала…');

    // Пробуем watchAdvertisements — даёт настоящий RSSI
    if (typeof device.watchAdvertisements === 'function') {
      try {
        await device.watchAdvertisements();
        device.addEventListener('advertisementreceived', (ev) => {
          onRssiReceived(id, name, ev.rssi);
        });
        updateScanStatus('Мониторинг · обновляется в реальном времени');
        showToast(`${name} — сигнал получен`);
        tg?.HapticFeedback?.notificationOccurred('success');
        return; // watchAdvertisements работает — выходим
      } catch (e) {
        console.warn('watchAdvertisements failed, falling back to GATT poll', e);
      }
    }

    // Fallback: подключаемся по GATT и измеряем latency как прокси RSSI
    updateScanStatus('Подключение…');
    await gattPoll(id, name, device);

  } catch (err) {
    if (err.name === 'NotFoundError' || err.name === 'AbortError') {
      showToast('Выбор отменён');
    } else if (err.name === 'SecurityError') {
      showToast('Нужен HTTPS для Bluetooth');
    } else {
      showToast('Ошибка: ' + (err.message || err.name));
      console.error(err);
    }
    updateScanStatus('Нажмите «Добавить устройство»');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="7" stroke="#60A5FA" stroke-width="1.4"/>
        <path d="M8 4v8M4 8h8" stroke="#60A5FA" stroke-width="1.4" stroke-linecap="round"/>
      </svg> Добавить устройство`;
    }
  }
}

// GATT-polling: каждые 2 сек пинг и замер latency → RSSI-прокси
async function gattPoll(id, name, device) {
  const BASE_RSSI = -65; // стартовая оценка

  let smoothed = BASE_RSSI;

  const connect = async () => {
    try {
      const t0  = performance.now();
      const srv = await device.gatt.connect();
      const lat = performance.now() - t0;

      // Грубая обратная зависимость: чем быстрее коннект, тем ближе
      // latency < 150ms ≈ -50 dBm, > 800ms ≈ -85 dBm
      const raw = Math.max(-95, Math.min(-45,
        -50 - (lat - 150) * 0.05
      ));
      onRssiReceived(id, name, raw);

      // Читаем любую характеристику для следующего замера
      try {
        const services = await srv.getPrimaryServices();
        if (services.length > 0) {
          const chars = await services[0].getCharacteristics();
          if (chars.length > 0) await chars[0].readValue();
        }
      } catch {}

      await device.gatt.disconnect();
    } catch {}

    if (state.devices.has(id)) setTimeout(connect, 2500);
  };

  updateScanStatus('GATT-мониторинг (приблизительно)');
  showToast(`${name} добавлен`);
  tg?.HapticFeedback?.notificationOccurred('success');
  await connect();
}

// ══════════════════════════════════════════════════════════════
// ОБНОВЛЕНИЕ ДАННЫХ УСТРОЙСТВА
// ══════════════════════════════════════════════════════════════

function initDevice(id, name) {
  state.devices.set(id, {
    id, name,
    rssiRaw:    null,
    rssiSmooth: null,
    rssiHistory: [],
    quality:    0,
    dist:       null,
    trend:      'stable',
    type:       guessType(name),
    lastSeen:   Date.now(),
  });
  renderDeviceList();
  renderRadarDots();
}

function onRssiReceived(id, name, rawRssi) {
  const d = state.devices.get(id);
  if (!d) return;

  // EMA-сглаживание
  const smooth = d.rssiSmooth === null
    ? rawRssi
    : EMA_ALPHA * rawRssi + (1 - EMA_ALPHA) * d.rssiSmooth;

  // История для тренда
  const history = [...d.rssiHistory, smooth].slice(-HISTORY_LEN);

  const quality = rssiToQuality(smooth);
  const dist    = calcDistance(smooth);
  const trend   = calcTrend(history);

  state.devices.set(id, {
    ...d,
    rssiRaw:    rawRssi,
    rssiSmooth: smooth,
    rssiHistory: history,
    quality, dist, trend,
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
  const count = $('device-count');

  count.textContent = state.devices.size;
  empty.style.display = state.devices.size === 0 ? 'flex' : 'none';

  const sorted = [...state.devices.values()].sort((a, b) => b.quality - a.quality);
  const ids    = new Set(sorted.map(d => d.id));

  list.querySelectorAll('.device-card').forEach(el => {
    if (!ids.has(el.dataset.id)) el.remove();
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
    card.querySelector('.js-dist').textContent = d.dist !== null ? fmtDist(d.dist) + ' м' : '…';
    card.querySelector('.js-trend').textContent = trendArrow(d.trend);
    card.querySelector('.js-trend').className   = 'trend-arrow js-trend ' + d.trend;
  });
}

// Радар: устройство — точка, расстояние от центра = dist
function renderRadarDots() {
  const container = $('radar-dots');
  const R = 96; // радиус радара в px

  state.devices.forEach(d => {
    let dot = container.querySelector(`[data-id="${d.id}"]`);
    if (!dot) {
      dot = document.createElement('div');
      dot.className = 'rdot';
      dot.dataset.id = d.id;
      dot.addEventListener('click', () => openDetail(d.id));
      container.appendChild(dot);
    }

    // Нормируем dist: 0 м → центр, 15+ м → край
    const normDist = d.dist !== null ? Math.min(d.dist / 15, 1) : 0.5;
    const angle    = hashAngle(d.id);
    const px = Math.cos(angle) * normDist * R;
    const py = Math.sin(angle) * normDist * R;

    dot.style.left = (R + px) + 'px';
    dot.style.top  = (R + py) + 'px';

    // Цвет точки по качеству сигнала
    const col = qualityColor(d.quality);
    dot.style.background  = col;
    dot.style.boxShadow   = `0 0 8px ${col}`;

    // Тренд — CSS-класс
    dot.className = `rdot trend-${d.trend}`;
    dot.dataset.id = d.id;
  });

  container.querySelectorAll('.rdot').forEach(el => {
    if (!state.devices.has(el.dataset.id)) el.remove();
  });
}

// ══════════════════════════════════════════════════════════════
// DETAIL SCREEN
// ══════════════════════════════════════════════════════════════

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

  $('detail-title').textContent   = d.name;
  $('detail-type').textContent    = d.type.label;
  $('detail-rssi').textContent    = d.rssiSmooth !== null ? Math.round(d.rssiSmooth) : '…';
  $('detail-id').textContent      = d.id.slice(0, 18);
  $('detail-updated').textContent = timeAgo(d.lastSeen);

  const distStr = d.dist !== null ? fmtDist(d.dist) : '…';
  $('detail-dist-num').textContent = distStr;

  // Тренд — крупная подпись
  const trendEl = $('detail-trend-label');
  if (trendEl) {
    trendEl.textContent  = trendLabel(d.trend);
    trendEl.className    = 'trend-label-big ' + d.trend;
  }

  // Signal bar
  const pct = d.quality;
  $('signal-pct').textContent  = pct + '%';
  const bar = $('signal-bar');
  bar.style.width      = pct + '%';
  bar.style.background = qualityColor(pct);

  // Dot на мини-радаре
  const dot    = $('detail-device-dot');
  const norm   = d.dist !== null ? Math.min(d.dist / 15, 1) : 0.5;
  const angle  = hashAngle(d.id);
  const R      = 72;
  dot.style.left = (50 + Math.cos(angle) * norm * R) + '%';
  dot.style.top  = (50 + Math.sin(angle) * norm * R) + '%';
  dot.style.background = qualityColor(d.quality);
  dot.style.boxShadow  = `0 0 10px ${qualityColor(d.quality)}`;
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

function trendArrow(trend) {
  if (trend === 'closer')  return '▲';
  if (trend === 'farther') return '▼';
  return '–';
}

function trendLabel(trend) {
  if (trend === 'closer')  return '▲ Приближаетесь';
  if (trend === 'farther') return '▼ Удаляетесь';
  return '● Стабильно';
}

function fmtDist(m) {
  if (m === null || m === undefined) return '…';
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

function rssiToQuality(rssi) {
  if (!rssi) return 0;
  if (rssi >= -50)  return 100;
  if (rssi <= -100) return 0;
  return Math.round((rssi + 100) * 2);
}

function rssiBarsHTML(quality) {
  const levels  = [25, 50, 75, 100];
  const heights = [4, 7, 10, 14];
  return levels.map((lvl, i) =>
    `<div class="rssi-bar" style="height:${heights[i]}px${quality >= lvl ? ';background:var(--accent-light)' : ''}"></div>`
  ).join('');
}

function hashAngle(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return h * (Math.PI * 2 / 0xffffffff);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
    background:#1f2937;color:#f1f5f9;border:1px solid rgba(255,255,255,.1);
    border-radius:12px;padding:10px 20px;font-size:14px;z-index:9999;
    box-shadow:0 4px 20px rgba(0,0,0,.5);white-space:nowrap;pointer-events:none;`;
  document.body.appendChild(t);
  setTimeout(() => t?.remove(), 2800);
}

function updateScanStatus(text) {
  $('scan-status-text').textContent = text;
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
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    let t = ctx.currentTime;
    for (let i = 0; i < 20; i++) {
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.setValueAtTime(0,   t + 0.15);
      t += 0.3;
    }
    osc.start(); osc.stop(t);
    state.soundCtx = ctx; state.soundOsc = osc; state.soundPlaying = true;
    $('btn-sound').classList.add('active-sound');
    tg?.HapticFeedback?.notificationOccurred('success');
    osc.onended = () => { state.soundPlaying = false; $('btn-sound')?.classList.remove('active-sound'); };
  } catch(e) { console.warn(e); }
}

function stopSound() {
  try { state.soundOsc?.stop(); } catch {}
  try { state.soundCtx?.close(); } catch {}
  state.soundPlaying = false; state.soundCtx = null; state.soundOsc = null;
  $('btn-sound')?.classList.remove('active-sound');
}

// ── Vibrate ────────────────────────────────────────────────
$('btn-vibrate').addEventListener('click', () => {
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200, 100, 400]);
    tg?.HapticFeedback?.impactOccurred('heavy');
  } else {
    showToast('Вибрация не поддерживается');
  }
});

// ── Forget device ──────────────────────────────────────────
$('btn-forget').addEventListener('click', () => {
  const id = state.activeId;
  if (!id) return;
  state.devices.delete(id);
  document.querySelector(`#radar-dots [data-id="${id}"]`)?.remove();
  document.querySelector(`#device-list [data-id="${id}"]`)?.remove();
  renderDeviceList();
  stopSound();
  showScreen('scan');
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
