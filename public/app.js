/* Howard's Digital — widget system (Phase 1 + Round 2 polish).
 * Every dashboard section renders as a consistent card on a flexible
 * 12-column grid (S/M/L sizes). Each card carries its own Edit button in
 * the header (rename + widget settings); the ⋯ menu keeps Move / Resize /
 * Hide / Remove; the header "Rearrange" toggle reveals the full drag toolbar.
 * Layout, titles, visibility, order, sizes, and per-section settings persist
 * in D1 via /api/sections. Device appearance prefs (TV mode, text size,
 * background) live in localStorage. No fake data: if a service is
 * unavailable or not configured, the card says so honestly.
 */

'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const dashboardEl = $('#dashboard');
const hiddenBarEl = $('#hidden-bar');
const hiddenListEl = $('#hidden-list');
const statusEl = $('#status');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[c]));
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function fmtDay(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/* ---------- Section types ----------
 * ONLY types listed here appear in the + Add Section catalog — every one
 * of them is a real, working widget. Nothing fake, nothing dead. */
const SECTION_TYPES = {
  myday:   { label: 'My Day', desc: 'Clock, date, weather, and what\u2019s next today.' },
  greeting: { label: 'Greeting', desc: 'A welcome banner with the time of day.' },
  search:   { label: 'Search', desc: 'A Google search bar.' },
  weather:  { label: 'Weather', desc: 'Current conditions. Tap for a 5-day forecast.' },
  sports:   { label: 'Sports', desc: 'Follow your teams — scores and schedules.' },
  youtube:  { label: 'YouTube', desc: 'Latest videos from channels you add.' },
  projects: { label: 'Projects', desc: 'Your HD project workspace.' },
  files:    { label: 'Files', desc: 'Upload files and share them with a link.' },
  links:    { label: 'Links', desc: 'Your own list of favorite links.' },
  notes:    { label: 'Notes', desc: 'Quick notes, saved automatically on HD.' },
  ai:         { label: 'AI', desc: 'Your AI launchers — pick which services appear inside.' },
  quicklinks: { label: 'Quick Links', desc: 'The sites you open every day — one tap away.' },
};
const TYPE_GROUPS = [
  { title: 'Essentials', types: ['myday', 'greeting', 'search', 'quicklinks'] },
  { title: 'Information', types: ['weather', 'sports'] },
  { title: 'Media', types: ['youtube'] },
  { title: 'Personal', types: ['projects', 'files', 'links', 'notes'] },
  { title: 'AI', types: ['ai'] },
];
const TYPES_WITH_SETTINGS = new Set(['weather', 'sports', 'youtube', 'links', 'ai', 'quicklinks']);
const SIZES = ['S', 'M', 'L'];
const SIZE_NAMES = { S: 'Small', M: 'Medium', L: 'Large' };

/* ---------- API ---------- */
async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = 'Something went wrong.';
    try { msg = (await res.json()).error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return res.json();
}

/* ---------- State ---------- */
let sections = [];
let dbConnected = false;

function getSection(id) {
  return sections.find(s => s.id === id);
}

function visibleSections() {
  return sections.filter(s => s.enabled).sort((a, b) => a.position - b.position);
}

function hiddenSections() {
  return sections.filter(s => !s.enabled).sort((a, b) => a.position - b.position);
}

function sectionSize(section) {
  const s = String(section.size || 'M').toUpperCase();
  return SIZES.includes(s) ? s : 'M';
}

async function saveSection(id, patch) {
  const data = await api(`/api/sections/${encodeURIComponent(id)}`, 'PUT', patch);
  const i = sections.findIndex(s => s.id === id);
  if (i >= 0) sections[i] = data.section;
  return data.section;
}

/* ---------- Device appearance prefs (localStorage; per device) ---------- */
const PREFS_KEY = 'hd-prefs-v1';
let prefs = loadPrefs();
function loadPrefs() {
  const fallback = { tvMode: false, fontSize: 'normal', background: 'aurora', glass: 96 };
  try {
    return Object.assign(fallback, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
  } catch { return fallback; }
}
function storePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
}
function applyPrefs() {
  document.body.classList.toggle('tv-mode', !!prefs.tvMode);
  document.body.classList.toggle('font-large', prefs.fontSize === 'large');
  document.body.classList.remove('bg-solid', 'bg-graphite');
  if (prefs.background === 'solid') document.body.classList.add('bg-solid');
  else if (prefs.background === 'graphite') document.body.classList.add('bg-graphite');
  const glass = Math.min(100, Math.max(35, Number(prefs.glass) || 96));
  document.documentElement.style.setProperty('--glass', (glass / 100).toFixed(2));
}

/* ---------- Loading / empty / error states ---------- */
function renderBootSkeletons(count = 6) {
  dashboardEl.innerHTML = Array.from({ length: count }, () => `
    <article class="card section-card" aria-hidden="true">
      <div class="skel-stack">
        <div class="skeleton" style="height:26px;width:52%"></div>
        <div class="skeleton" style="height:15px;width:88%"></div>
        <div class="skeleton" style="height:70px"></div>
      </div>
    </article>`).join('');
}

function showLoading(body, rows = 3) {
  body.innerHTML = `<div class="skel-stack" aria-label="Loading">${
    Array.from({ length: rows }, (_, i) =>
      `<div class="skeleton" style="height:${i === 0 ? 22 : 15}px${i > 1 ? ';width:' + (92 - i * 6) + '%' : ''}"></div>`
    ).join('')
  }</div>`;
}

function showEmpty(body, icon, text, hint) {
  body.innerHTML = `<div class="empty">
    <span class="empty-icon" aria-hidden="true">${icon}</span>
    <div>${escapeHtml(text)}</div>
    ${hint ? `<small class="muted">${escapeHtml(hint)}</small>` : ''}
  </div>`;
}

function showError(body, message, retry) {
  body.innerHTML = `<div class="error-box" role="alert">
    <p>${escapeHtml(message)}</p>
    <button type="button">Retry</button>
  </div>`;
  $('button', body).addEventListener('click', retry);
}

/* ---------- Greeting / header ---------- */
function renderGreeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('#greeting').textContent = `${part}, Harm.`;
  $('#today').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

/* ---------- Unified card shell ----------
 * Normal mode: title + subtle ⋯ menu. Edit mode (body.editing): the full
 * toolbar with drag handle, move, resize, settings, rename, hide, remove. */
function cardShell(section) {
  const size = sectionSize(section);
  const card = document.createElement('article');
  card.className = `card section-card section-${escapeHtml(section.type)} size-${size.toLowerCase()}`;
  card.dataset.sectionId = section.id;

  const head = document.createElement('div');
  head.className = 'card-head';
  head.innerHTML = `
    <div class="card-title"><span class="label">${escapeHtml(SECTION_TYPES[section.type]?.label || section.type)}</span>
    <h2>${escapeHtml(section.title)}</h2></div>
    <button type="button" class="card-edit-btn" title="Edit this widget" aria-label="Edit ${escapeHtml(section.title)}">Edit</button>
    <div class="card-menu-wrap">
      <button type="button" class="card-menu-btn" aria-haspopup="menu" aria-expanded="false"
        aria-label="Section menu" title="Section menu">⋯</button>
      <div class="card-menu" role="menu" hidden></div>
    </div>
    <div class="card-controls" role="toolbar" aria-label="Edit section">
      <button type="button" class="drag-handle" title="Drag to reorder" aria-label="Drag to reorder section">⋮⋮</button>
      <button type="button" data-act="up" title="Move up" aria-label="Move section up">▲</button>
      <button type="button" data-act="down" title="Move down" aria-label="Move section down">▼</button>
      <button type="button" data-act="rename" title="Rename" aria-label="Rename section">✏️</button>
      <div class="size-seg" role="group" aria-label="Card size">
        ${SIZES.map(s => `<button type="button" data-size="${s}" aria-pressed="${s === size}" title="${SIZE_NAMES[s]}">${s}</button>`).join('')}
      </div>
      <button type="button" data-act="hide" title="Hide" aria-label="Hide section">👁</button>
      <button type="button" data-act="remove" title="Remove" aria-label="Remove section" class="danger">✕</button>
    </div>`;

  const body = document.createElement('div');
  body.className = 'card-body';

  // Rename bar: part of every card's Edit surface (works for all types,
  // survives settings-pane re-renders because it is a sibling, not a child).
  const renameBar = document.createElement('div');
  renameBar.className = 'rename-bar';
  renameBar.hidden = true;
  renameBar.innerHTML = `
    <form class="rename-form">
      <label>Widget name <input name="title" value="${escapeHtml(section.title)}" maxlength="120" aria-label="Widget name"></label>
      <button type="submit">Save</button>
    </form>`;

  const settingsPane = document.createElement('div');
  settingsPane.className = 'settings-pane';
  settingsPane.hidden = true;

  card.append(head, renameBar, settingsPane, body);

  const menuBtn = $('.card-menu-btn', head);
  const menu = $('.card-menu', head);
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCardMenu(section, menuBtn, menu, settingsPane, renameBar, body);
  });
  $('.card-edit-btn', head).addEventListener('click', (e) => {
    e.stopPropagation();
    closeCardMenu();
    toggleSettingsPane(section, settingsPane, renameBar, body);
  });
  $('.rename-form', renameBar).addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.title.value.trim();
    if (!name || name === section.title) return;
    try {
      await saveSection(section.id, { title: name });
      render();
    } catch (err) { alert(err.message); }
  });

  head.querySelector('.card-controls').addEventListener('click', (e) => {
    const sizeBtn = e.target.closest('[data-size]');
    if (sizeBtn) { e.stopPropagation(); setSectionSize(section.id, sizeBtn.dataset.size); return; }
    onCardControl(e, section, settingsPane, renameBar, body);
  });
  return { card, body, settingsPane, renameBar };
}

function sizeSegHtml(size) {
  return SIZES.map(s =>
    `<button type="button" data-msize="${s}" aria-pressed="${s === size}" title="${SIZE_NAMES[s]}">${s}</button>`
  ).join('');
}

function buildCardMenu(section, menu, settingsPane, renameBar, body) {
  const size = sectionSize(section);
  menu.innerHTML = `
    <button type="button" class="card-menu-item" role="menuitem" data-m="up"><span class="mi">▲</span>Move up</button>
    <button type="button" class="card-menu-item" role="menuitem" data-m="down"><span class="mi">▼</span>Move down</button>
    <div class="card-menu-sep"></div>
    <div class="card-menu-size"><span class="mi" aria-hidden="true">↔</span>
      <div class="size-seg" role="group" aria-label="Card size">${sizeSegHtml(size)}</div>
    </div>
    <div class="card-menu-sep"></div>
    <button type="button" class="card-menu-item" role="menuitem" data-m="hide"><span class="mi">👁</span>Hide</button>
    <button type="button" class="card-menu-item danger" role="menuitem" data-m="remove"><span class="mi">✕</span>Remove</button>`;
  menu.querySelectorAll('[data-m]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeCardMenu();
    sectionAction(section, btn.dataset.m, settingsPane, renameBar, body);
  }));
  menu.querySelectorAll('[data-msize]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeCardMenu();
    setSectionSize(section.id, btn.dataset.msize);
  }));
}

let openMenu = null;
function closeCardMenu() {
  if (openMenu) {
    openMenu.menu.hidden = true;
    openMenu.btn.setAttribute('aria-expanded', 'false');
    openMenu = null;
    document.removeEventListener('click', closeCardMenu);
  }
}

function toggleCardMenu(section, btn, menu, settingsPane, renameBar, body) {
  if (openMenu && openMenu.menu === menu) { closeCardMenu(); return; }
  closeCardMenu();
  buildCardMenu(section, menu, settingsPane, renameBar, body);
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  openMenu = { btn, menu };
  // Defer so this same click doesn't immediately close it.
  setTimeout(() => document.addEventListener('click', closeCardMenu), 0);
}

function toggleSettingsPane(section, settingsPane, renameBar, body) {
  const opening = settingsPane.hidden;
  settingsPane.hidden = !opening;
  renameBar.hidden = !opening;
  if (opening && !settingsPane.dataset.built) {
    settingsPane.dataset.built = '1';
    buildSettingsPane(section, settingsPane, body);
  }
}

async function setSectionSize(id, size) {
  if (!SIZES.includes(size)) return;
  try {
    await saveSection(id, { size });
    const card = dashboardEl.querySelector(`[data-section-id="${CSS.escape(id)}"]`);
    if (card) {
      card.classList.remove('size-s', 'size-m', 'size-l');
      card.classList.add(`size-${size.toLowerCase()}`);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function sectionAction(section, act, settingsPane, renameBar, body) {
  try {
    if (act === 'remove') {
      if (!confirm(`Remove "${section.title}" from your dashboard?`)) return;
      await api(`/api/sections/${encodeURIComponent(section.id)}`, 'DELETE');
      sections = sections.filter(s => s.id !== section.id);
      render();
    } else if (act === 'hide') {
      await saveSection(section.id, { enabled: false });
      render();
    } else if (act === 'rename') {
      const name = prompt('Rename section:', section.title);
      if (name && name.trim() && name.trim() !== section.title) {
        await saveSection(section.id, { title: name.trim() });
        render();
      }
    } else if (act === 'up' || act === 'down') {
      moveSection(section.id, act === 'up' ? -1 : 1);
    } else if (act === 'edit' || act === 'settings') {
      toggleSettingsPane(section, settingsPane, renameBar, body);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function onCardControl(event, section, settingsPane, renameBar, body) {
  const btn = event.target.closest('[data-act]');
  if (!btn) return;
  event.stopPropagation();
  sectionAction(section, btn.dataset.act, settingsPane, renameBar, body);
}

async function moveSection(id, dir) {
  const ordered = sections.slice().sort((a, b) => a.position - b.position);
  const vis = ordered.filter(s => s.enabled);
  const idx = vis.findIndex(s => s.id === id);
  const swapWith = idx + dir;
  if (idx < 0 || swapWith < 0 || swapWith >= vis.length) return;
  // Swap their positions within the full ordering.
  const a = vis[idx], b = vis[swapWith];
  const ai = ordered.indexOf(a), bi = ordered.indexOf(b);
  [ordered[ai], ordered[bi]] = [ordered[bi], ordered[ai]];
  try {
    await api('/api/sections/reorder', 'PUT', { order: ordered.map(s => s.id) });
    ordered.forEach((s, i) => { s.position = i; });
    sections = ordered;
    render();
  } catch (err) {
    alert(err.message);
  }
}

/* ---------- Drag to reorder (pointer-based: mouse + touch, no library) ----------
 * In Edit mode a ⋮⋮ handle sits first in each card's toolbar. Desktop: press
 * and drag. Touch: press-and-hold the handle (~350ms), then drag. A dashed
 * indicator shows the drop spot. On drop the order persists through the same
 * /api/sections/reorder endpoint the Move Up/Down buttons use.
 * The buttons stay as the reliable path for TV remotes / air mice. */

let pendingDrag = null; // press started, drag not yet begun
let dragState = null;   // active drag: { id, card, pointerId, targetIndex, lastY, scrollDir, raf }

function computeMergedOrder(allSections, draggedId, targetIndex) {
  const ordered = allSections.slice().sort((a, b) => a.position - b.position);
  const vis = ordered.filter(s => s.enabled);
  const from = vis.findIndex(s => s.id === draggedId);
  if (from < 0) return null;
  const [moved] = vis.splice(from, 1);
  const to = Math.max(0, Math.min(targetIndex, vis.length));
  vis.splice(to, 0, moved);
  // Hidden sections keep their existing slots, mirroring moveSection().
  let vi = 0;
  return ordered.map(s => (s.enabled ? vis[vi++] : s));
}

function dragIndicator() {
  let el = document.getElementById('drop-indicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'drop-indicator';
    el.className = 'drop-indicator';
    el.setAttribute('aria-hidden', 'true');
  }
  return el;
}

function beginSectionDrag(card, pointerId) {
  card.classList.add('dragging');
  document.body.classList.add('is-dragging');
  try { if (navigator.vibrate) navigator.vibrate(15); } catch { /* noop */ }
  dragState = { id: card.dataset.sectionId, card, pointerId, targetIndex: -1, lastY: 0, scrollDir: 0, raf: 0 };
}

function moveSectionDrag(clientY) {
  if (!dragState) return;
  dragState.lastY = clientY;
  const ind = dragIndicator();
  const cards = [...dashboardEl.querySelectorAll('.section-card:not(.dragging)')];
  let before = null;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (clientY < r.top + r.height / 2) { before = c; break; }
  }
  dragState.targetIndex = before ? cards.indexOf(before) : cards.length;
  if (before) before.before(ind);
  else dashboardEl.append(ind);
  autoScrollStep();
}

function autoScrollStep() {
  const st = dragState;
  if (!st) return;
  const margin = 90, speed = 16;
  const dir = st.lastY < margin ? -1 : st.lastY > window.innerHeight - margin ? 1 : 0;
  st.scrollDir = dir;
  if (dir && !st.raf) {
    const step = () => {
      if (!dragState) return;
      window.scrollBy(0, dragState.scrollDir * speed);
      moveSectionDrag(dragState.lastY);
      if (dragState) dragState.raf = requestAnimationFrame(step);
    };
    st.raf = requestAnimationFrame(step);
  } else if (!dir && st.raf) {
    cancelAnimationFrame(st.raf);
    st.raf = 0;
  }
}

function endSectionDrag(commit) {
  const st = dragState;
  dragState = null;
  pendingDrag = null;
  document.body.classList.remove('is-dragging');
  const ind = document.getElementById('drop-indicator');
  if (ind) ind.remove();
  if (!st) return;
  st.card.classList.remove('dragging');
  if (st.raf) cancelAnimationFrame(st.raf);
  if (commit && st.targetIndex >= 0) commitSectionDrop(st.id, st.targetIndex);
}

function cancelPendingDrag() {
  if (pendingDrag && pendingDrag.timer) clearTimeout(pendingDrag.timer);
  pendingDrag = null;
}

async function commitSectionDrop(draggedId, targetIndex) {
  const merged = computeMergedOrder(sections, draggedId, targetIndex);
  if (!merged) { render(); return; }
  // No-op if the order didn't actually change.
  const before = sections.slice().sort((a, b) => a.position - b.position).map(s => s.id).join(',');
  const after = merged.map(s => s.id).join(',');
  if (before === after) { render(); return; }
  try {
    await api('/api/sections/reorder', 'PUT', { order: merged.map(s => s.id) });
    merged.forEach((s, i) => { s.position = i; });
    sections = merged;
  } catch (err) {
    alert(err.message);
  }
  render();
}

function enableSectionDrag() {
  dashboardEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || dragState || pendingDrag) return;
    const card = handle.closest('.section-card');
    if (!card) return;
    e.preventDefault();
    pendingDrag = {
      card, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      immediate: (e.pointerType || 'mouse') !== 'touch',
      timer: 0, dragging: false,
    };
    try { handle.setPointerCapture(e.pointerId); } catch { /* noop */ }
    if (!pendingDrag.immediate) {
      // Touch: press-and-hold to arm the drag so normal scrolling still works.
      pendingDrag.timer = setTimeout(() => {
        if (pendingDrag && !pendingDrag.dragging) {
          pendingDrag.dragging = true;
          beginSectionDrag(pendingDrag.card, pendingDrag.pointerId);
          pendingDrag = null;
        }
      }, 350);
    }
  });

  dashboardEl.addEventListener('pointermove', (e) => {
    if (dragState && e.pointerId === dragState.pointerId) {
      moveSectionDrag(e.clientY);
      return;
    }
    if (pendingDrag && e.pointerId === pendingDrag.pointerId && !pendingDrag.dragging) {
      const dist = Math.hypot(e.clientX - pendingDrag.startX, e.clientY - pendingDrag.startY);
      if (pendingDrag.immediate) {
        if (dist > 8) {
          const { card, pointerId } = pendingDrag;
          pendingDrag = null;
          beginSectionDrag(card, pointerId);
          moveSectionDrag(e.clientY);
        }
      } else if (dist > 14) {
        // Finger wandered before the hold finished: let it scroll instead.
        cancelPendingDrag();
      }
    }
  });

  const finish = (e) => {
    if (dragState && e.pointerId === dragState.pointerId) endSectionDrag(true);
    else if (pendingDrag && e.pointerId === pendingDrag.pointerId) cancelPendingDrag();
  };
  dashboardEl.addEventListener('pointerup', finish);
  dashboardEl.addEventListener('pointercancel', finish);
}

/* ---------- Simple renderers ---------- */
function renderGreetingSection(body) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  body.innerHTML = `
    <div class="greeting-card"><h3>${escapeHtml(part)}, Harm.</h3>
    <p class="muted">${escapeHtml(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</p></div>`;
}

function renderSearchSection(body) {
  body.innerHTML = `
    <form class="searchbar" action="https://www.google.com/search" method="get" role="search">
      <input type="search" name="q" placeholder="Search Google…" aria-label="Search Google" autocomplete="off">
      <button type="submit">Search</button>
    </form>`;
}

async function renderProjectsSection(body) {
  showLoading(body, 4);
  try {
    const data = await api('/api/projects');
    const projects = data.projects || [];
    body.innerHTML = projects.length ? `
      <div class="project-list">${projects.map(p => `
        <div class="project">
          <div><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.description || 'No description')}</small></div>
          <small>${escapeHtml(p.status)}</small>
        </div>`).join('')}</div>`
      : '';
    if (!projects.length) showEmpty(body, '🗂️', 'No projects yet.');
  } catch {
    showError(body, 'Projects are unavailable right now.', () => renderProjectsSection(body));
  }
}

/* ---------- Weather ---------- */
const WX_CODE = {
  0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Light showers', 81: 'Showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Storm w/ hail', 99: 'Storm w/ hail',
};
const wxEmoji = (code) => {
  if (code === 0 || code === 1) return '☀️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
};

function weatherUrl(lat, lon) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=6`;
}

async function renderWeatherSection(section, body) {
  showLoading(body, 4);
  const s = section.settings || {};
  let lat = Number(s.lat), lon = Number(s.lon), label = s.location || '';

  if (s.useGeolocation && navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 });
      });
      lat = Number(pos.coords.latitude.toFixed(2));
      lon = Number(pos.coords.longitude.toFixed(2));
      label = 'your location';
    } catch { /* fall through to configured location */ }
  }
  if (!isFinite(lat) || !isFinite(lon)) { lat = 38.04; lon = -84.50; label = label || 'Lexington, KY'; }

  try {
    const resp = await fetch(weatherUrl(lat, lon));
    if (!resp.ok) throw new Error(`weather HTTP ${resp.status}`);
    const data = await resp.json();
    const cur = data.current || {};
    const code = cur.weather_code;
    const hi = Math.round(data.daily.temperature_2m_max[0]);
    const lo = Math.round(data.daily.temperature_2m_min[0]);
    const precip = data.daily.precipitation_probability_max?.[0];
    const wind = Math.round(cur.wind_speed_10m);
    const days = data.daily.time.map((t, i) => ({
      date: t, code: data.daily.weather_code[i],
      hi: Math.round(data.daily.temperature_2m_max[i]),
      lo: Math.round(data.daily.temperature_2m_min[i]),
      precip: data.daily.precipitation_probability_max?.[i],
    }));

    body.innerHTML = `
      <button type="button" class="wx-main" data-expand>
        <div class="wx-temp">${wxEmoji(code)} ${Math.round(cur.temperature_2m)}°F</div>
        <div class="wx-desc">${escapeHtml(WX_CODE[code] || '—')}</div>
        <div class="muted">H ${hi}° / L ${lo}°${precip != null ? ` • 💧 ${precip}%` : ''} • 💨 ${wind} mph</div>
        <div class="muted">${escapeHtml(label)} — tap for 5-day forecast</div>
      </button>
      <div class="wx-forecast" hidden>
        <div class="forecast-grid">${days.slice(1, 6).map((d, i) => `
          <div class="forecast-day">
            <strong>${i === 0 ? 'Tomorrow' : escapeHtml(fmtDay(d.date).split(',')[0])}</strong>
            <div class="forecast-emoji">${wxEmoji(d.code)}</div>
            <div>${d.hi}° / ${d.lo}°</div>
            <div class="muted">${escapeHtml(WX_CODE[d.code] || '')}</div>
            ${d.precip != null ? `<div class="muted">💧 ${d.precip}%</div>` : ''}
          </div>`).join('')}</div>
      </div>`;
    const main = $('[data-expand]', body);
    const fc = $('.wx-forecast', body);
    main.addEventListener('click', () => { fc.hidden = !fc.hidden; });
  } catch {
    showError(body, 'Weather is temporarily unavailable.', () => renderWeatherSection(section, body));
  }
}

function buildWeatherSettings(section, pane, body) {
  const s = section.settings || {};
  pane.innerHTML = `
    <form class="settings-form">
      <label>Location name <input name="location" value="${escapeHtml(s.location || 'Lexington, KY')}"></label>
      <div class="form-row">
        <label>Latitude <input name="lat" type="number" step="0.01" value="${escapeHtml(s.lat ?? 38.04)}"></label>
        <label>Longitude <input name="lon" type="number" step="0.01" value="${escapeHtml(s.lon ?? -84.50)}"></label>
      </div>
      <label class="check"><input name="useGeolocation" type="checkbox" ${s.useGeolocation ? 'checked' : ''}> Use my phone's location when allowed</label>
      <button type="submit">Save</button>
    </form>`;
  $('form', pane).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const val = (n) => f.querySelector(`[name="${n}"]`).value;
    const next = {
      location: val('location').trim() || 'Lexington, KY',
      lat: parseFloat(val('lat')), lon: parseFloat(val('lon')),
      useGeolocation: f.querySelector('[name="useGeolocation"]').checked,
    };
    if (!isFinite(next.lat) || !isFinite(next.lon)) { alert('Enter a valid latitude and longitude.'); return; }
    await saveSection(section.id, { settings: next });
    pane.hidden = true;
    renderWeatherSection(getSection(section.id), body);
  });
}

/* ---------- Sports (ESPN, no key needed) ---------- */
const SPORT_PATHS = {
  'football/college-football': 'College Football',
  'basketball/mens-college-basketball': "Men's College Basketball",
  'football/nfl': 'NFL',
  'basketball/nba': 'NBA',
};
const TEAM_PRESETS = [
  { teamId: '96', sport: 'football/college-football', label: 'Kentucky Football' },
  { teamId: '96', sport: 'basketball/mens-college-basketball', label: 'Kentucky Basketball' },
  { teamId: '6', sport: 'football/nfl', label: 'Cincinnati Bengals' },
];

async function espnTeamInfo(sport, teamId) {
  const d = await (await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/${sport}/teams/${teamId}`
  )).json();
  const team = d.team || {};
  const record = team.record?.items?.[0]?.summary || '';
  const next = team.nextEvent?.[0] || null;
  return { name: team.displayName || '', record, next };
}

function scheduleUrl(sport, teamId) {
  return `https://site.api.espn.com/apis/site/v2/sports/${sport}/teams/${teamId}/schedule`;
}

async function renderSportsSection(section, body) {
  const teams = (section.settings && section.settings.teams) || [];
  if (!teams.length) {
    showEmpty(body, '🏈', 'No teams yet.', 'Tap Edit on this card to follow a team.');
    return;
  }
  showLoading(body, 4);
  const blocks = await Promise.all(teams.map(async (t, i) => {
    try {
      const info = await espnTeamInfo(t.sport, t.teamId);
      const next = info.next;
      return { i, t, info, ok: true };
    } catch {
      return { i, t, ok: false };
    }
  }));
  if (blocks.every(b => !b.ok)) {
    showError(body, 'Scores are temporarily unavailable.', () => renderSportsSection(section, body));
    return;
  }
  body.innerHTML = blocks.map(b => {
    if (!b.ok) return `<div class="team-block"><strong>${escapeHtml(b.t.label)}</strong><p class="muted">Scores are temporarily unavailable.</p></div>`;
    const n = b.info.next;
    return `
      <div class="team-block">
        <button type="button" class="team-main" data-team="${b.i}">
          <strong>${escapeHtml(b.t.label)}</strong>
          ${n ? `<div>${escapeHtml(n.name || '')}</div><div class="muted">${escapeHtml(fmtDateTime(n.date))}</div>`
              : '<div class="muted">No upcoming game listed</div>'}
          ${b.info.record ? `<div class="muted">Record: ${escapeHtml(b.info.record)}</div>` : ''}
          <div class="muted expand-hint">tap for schedule</div>
        </button>
        <div class="team-detail" hidden><div class="empty">Loading…</div></div>
      </div>`;
  }).join('');

  body.querySelectorAll('[data-team]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const detail = btn.parentElement.querySelector('.team-detail');
      const wasHidden = detail.hidden;
      detail.hidden = !wasHidden;
      if (!wasHidden || detail.dataset.loaded) return;
      detail.dataset.loaded = '1';
      const b = blocks[Number(btn.dataset.team)];
      try {
        const d = await (await fetch(scheduleUrl(b.t.sport, b.t.teamId))).json();
        const events = (d.events || []).slice(0, 8);
        detail.innerHTML = events.length ? events.map(ev => {
          const comp = ev.competitions?.[0];
          const comps = (comp?.competitors || []).map(c => ({
            abbr: c.team?.abbreviation || '', score: c.score, winner: c.winner,
            home: c.homeAway === 'home',
          }));
          const played = comps.some(c => c.score !== undefined && c.score !== '');
          const scoreLine = played
            ? comps.map(c => `${escapeHtml(c.abbr)} ${escapeHtml(c.score)}${c.winner ? ' ✓' : ''}`).join(' — ')
            : 'upcoming';
          return `<div class="schedule-row">
              <div><strong>${escapeHtml(fmtDateTime(ev.date))}</strong><br><small>${escapeHtml(ev.name || '')}</small></div>
              <div class="score">${scoreLine}</div>
            </div>`;
        }).join('') : '<div class="empty">No games listed.</div>';
      } catch {
        detail.innerHTML = '<div class="empty">Schedule is temporarily unavailable.</div>';
      }
    });
  });
}

function buildSportsSettings(section, pane, body) {
  const render = () => {
    const teams = (getSection(section.id).settings?.teams) || [];
    pane.innerHTML = `
      <div class="settings-list">${teams.map((t, i) => `
        <div class="settings-row">
          <div><strong>${escapeHtml(t.label)}</strong><br><small>${escapeHtml(SPORT_PATHS[t.sport] || t.sport)} • team ${escapeHtml(t.teamId)}</small></div>
          <button type="button" data-rm="${i}" class="danger">Remove</button>
        </div>`).join('') || '<div class="empty">No teams yet.</div>'}</div>
      <div class="label" style="margin:14px 0 8px">Quick add</div>
      <div class="preset-row">${TEAM_PRESETS.map((p, i) => `
        <button type="button" data-preset="${i}">＋ ${escapeHtml(p.label)}</button>`).join('')}</div>
      <form class="settings-form" id="team-add-form" style="margin-top:14px">
        <div class="label">Add by team ID</div>
        <label>Sport
          <select name="sport">${Object.entries(SPORT_PATHS).map(([v, l]) =>
            `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join('')}</select>
        </label>
        <div class="form-row">
          <label>ESPN team ID <input name="teamId" inputmode="numeric" placeholder="e.g. 96" required></label>
          <label>Label <input name="label" placeholder="e.g. Kentucky Football" required></label>
        </div>
        <button type="submit">Add team</button>
        <p class="muted">The team ID is the number ESPN uses in its team pages.</p>
      </form>`;

    pane.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', async () => {
      const next = teams.filter((_, i) => i !== Number(btn.dataset.rm));
      await saveSection(section.id, { settings: { teams: next } });
      render();
      renderSportsSection(getSection(section.id), body);
    }));
    pane.querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', async () => {
      const p = TEAM_PRESETS[Number(btn.dataset.preset)];
      if (teams.some(t => t.teamId === p.teamId && t.sport === p.sport)) { alert('That team is already followed.'); return; }
      await saveSection(section.id, { settings: { teams: [...teams, p] } });
      render();
      renderSportsSection(getSection(section.id), body);
    }));
    $('#team-add-form', pane).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const val = (n) => f.querySelector(`[name="${n}"]`).value;
      const entry = {
        teamId: val('teamId').trim(), sport: val('sport'), label: val('label').trim(),
      };
      if (!/^\d+$/.test(entry.teamId)) { alert('Team ID should be a number.'); return; }
      await saveSection(section.id, { settings: { teams: [...teams, entry] } });
      render();
      renderSportsSection(getSection(section.id), body);
    });
  };
  render();
}

/* ---------- YouTube (public channel RSS via the Worker; no API key) ---------- */
function extractChannelId(input) {
  const v = input.trim();
  let m = v.match(/UC[A-Za-z0-9_-]{22}/);
  if (m) return m[0];
  return null;
}

async function renderYouTubeSection(section, body) {
  const channels = (section.settings && section.settings.channels) || [];
  if (!channels.length) {
    showEmpty(body, '📺', 'No channels yet.', 'Tap Edit on this card to add one. YouTube sign-in is coming later.');
    return;
  }
  showLoading(body, 4);
  const results = await Promise.all(channels.map(async (ch) => {
    try {
      const d = await (await fetch(`/api/youtube/rss?channel_id=${encodeURIComponent(ch.channelId)}`)).json();
      if (d.error) throw new Error(d.error);
      return { ch, ok: true, title: d.channelTitle, videos: d.videos || [] };
    } catch {
      return { ch, ok: false };
    }
  }));
  if (results.every(r => !r.ok)) {
    showError(body, "Couldn't load these channels right now.", () => renderYouTubeSection(section, body));
    return;
  }
  body.innerHTML = results.map((r, i) => `
    <div class="yt-channel">
      <button type="button" class="yt-head" data-yt="${i}">
        <strong>${escapeHtml(r.title || r.ch.name || r.ch.channelId)}</strong>
        ${r.ok && r.videos.length
          ? `<span class="muted">${r.videos.length} latest • tap to ${r.videos.length > 3 ? 'expand' : 'open'}</span>`
          : `<span class="muted">${r.ok ? 'No recent videos' : "Couldn't load this channel right now"}</span>`}
      </button>
      ${r.ok ? `<div class="yt-videos" ${r.videos.length > 3 ? 'hidden' : ''}>${r.videos.slice(0, 3).map(ytCard).join('')}</div>
      <div class="yt-more" hidden>${r.videos.slice(3).map(ytCard).join('')}</div>
      ${r.videos.length > 3 ? `<button type="button" class="link-btn" data-yt-more="${i}">Show more</button>` : ''}` : ''}
    </div>`).join('');

  function ytCard(v) {
    const date = v.published ? new Date(v.published).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    return `<a class="yt-video" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">
      <img src="${escapeHtml(v.thumbnail)}" alt="" loading="lazy">
      <div><strong>${escapeHtml(v.title)}</strong><br><small class="muted">${escapeHtml(date)}</small></div>
    </a>`;
  }

  body.querySelectorAll('[data-yt]').forEach(btn => btn.addEventListener('click', () => {
    const wrap = btn.parentElement;
    const vids = wrap.querySelector('.yt-videos');
    const more = wrap.querySelector('.yt-more');
    if (more && more.children.length) {
      const opening = more.hidden;
      more.hidden = !opening;
      vids.hidden = false;
      const moreBtn = wrap.querySelector('[data-yt-more]');
      if (moreBtn) moreBtn.textContent = opening ? 'Show less' : 'Show more';
    }
  }));
  body.querySelectorAll('[data-yt-more]').forEach(btn => btn.addEventListener('click', () => {
    const wrap = btn.parentElement;
    const more = wrap.querySelector('.yt-more');
    more.hidden = !more.hidden;
    btn.textContent = more.hidden ? 'Show more' : 'Show less';
  }));
}

function buildYouTubeSettings(section, pane, body) {
  const render = () => {
    const channels = (getSection(section.id).settings?.channels) || [];
    pane.innerHTML = `
      <div class="settings-list">${channels.map((c, i) => `
        <div class="settings-row">
          <div><strong>${escapeHtml(c.name || c.channelId)}</strong><br><small>${escapeHtml(c.channelId)}</small></div>
          <button type="button" data-rm="${i}" class="danger">Remove</button>
        </div>`).join('') || '<div class="empty">No channels yet.</div>'}</div>
      <form class="settings-form" id="yt-add-form" style="margin-top:14px">
        <div class="label">Add channel</div>
        <label>Channel URL or channel ID
          <input name="channel" placeholder="youtube.com/channel/UC… or UC…" required>
        </label>
        <button type="submit">Add channel</button>
        <p class="muted">Paste a channel page URL (the part with /channel/UC…) or the channel ID itself (starts with “UC”). Handles like @name can't be looked up yet.</p>
      </form>
      <p class="muted" style="margin-top:12px">🔌 <strong>Connect YouTube</strong> (sign in to import your subscriptions) is coming later — not configured yet.</p>`;
    pane.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', async () => {
      const next = channels.filter((_, i) => i !== Number(btn.dataset.rm));
      await saveSection(section.id, { settings: { channels: next } });
      render();
      renderYouTubeSection(getSection(section.id), body);
    }));
    $('#yt-add-form', pane).addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = e.target.channel.value;
      const id = extractChannelId(raw);
      if (!id) { alert('That doesn\'t look like a channel URL or ID. The channel ID starts with "UC".'); return; }
      if (channels.some(c => c.channelId === id)) { alert('That channel is already added.'); return; }
      let name = id;
      try {
        const d = await (await fetch(`/api/youtube/rss?channel_id=${encodeURIComponent(id)}`)).json();
        if (!d.error) name = d.channelTitle || id;
      } catch { /* keep the ID as the name */ }
      await saveSection(section.id, { settings: { channels: [...channels, { channelId: id, name }] } });
      render();
      renderYouTubeSection(getSection(section.id), body);
    });
  };
  render();
}

/* ---------- Files (D1 blob storage) ---------- */
async function renderFilesSection(section, body) {
  body.innerHTML = `
    <p class="muted" style="margin-bottom:14px">Upload images or documents, then copy the link to share.</p>
    <form class="upload-form">
      <input type="file" aria-label="Choose a file to upload">
      <button type="submit">Upload</button>
    </form>
    <p class="upload-status muted"></p>
    <div class="file-list"></div>`;

  const form = $('form', body);
  const input = $('input[type=file]', body);
  const status = $('.upload-status', body);
  const list = $('.file-list', body);

  async function loadFiles() {
    showLoading(list, 3);
    try {
      const data = await api('/api/files');
      const files = data.files || [];
      if (!files.length) { showEmpty(list, '📁', 'No files yet.', 'Upload one above — the share link is copied automatically.'); return; }
      list.innerHTML = files.map(f => `
        <div class="file-row">
          <div><strong>${escapeHtml(f.filename)}</strong><br><small>${fmtSize(f.size)} • ${escapeHtml(new Date(f.created_at).toLocaleDateString())}</small></div>
          <div class="file-actions">
            ${f.url ? `<a class="file-open" href="${escapeHtml(f.url)}" target="_blank" rel="noopener">Open</a>` : ''}
            ${f.url ? `<button type="button" data-copy="${escapeHtml(f.url)}">Copy link</button>` : ''}
            <button type="button" data-del="${escapeHtml(f.id)}" class="danger">Delete</button>
          </div>
        </div>`).join('');
    } catch {
      showError(list, 'Files are unavailable right now.', loadFiles);
    }
  }

  list.addEventListener('click', async (event) => {
    const copyBtn = event.target.closest('[data-copy]');
    const delBtn = event.target.closest('[data-del]');
    if (copyBtn) {
      try {
        await navigator.clipboard.writeText(copyBtn.dataset.copy);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1500);
      } catch { prompt('Copy this link:', copyBtn.dataset.copy); }
    }
    if (delBtn && confirm('Delete this file?')) {
      await fetch('/api/files/' + encodeURIComponent(delBtn.dataset.del), { method: 'DELETE' });
      loadFiles();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = input.files[0];
    if (!file) { status.textContent = 'Choose a file first.'; return; }
    if (file.size > 10 * 1024 * 1024) { status.textContent = 'That file is over the 10 MB limit.'; return; }
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    status.textContent = 'Uploading…';
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/files', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      input.value = '';
      try {
        await navigator.clipboard.writeText(data.url);
        status.textContent = 'Uploaded! Link copied — paste it anywhere.';
      } catch { status.textContent = 'Uploaded! Copy the link from the list below.'; }
      loadFiles();
    } catch (err) {
      status.textContent = err.message;
    }
    btn.disabled = false;
  });

  loadFiles();
}

/* ---------- Links ---------- */
function renderLinksSection(section, body) {
  const links = (section.settings && section.settings.links) || [];
  if (!links.length) {
    showEmpty(body, '🔗', 'No links yet.', 'Tap Edit on this card to add some.');
    return;
  }
  body.innerHTML = `
    <div class="link-list">${links.map(l => `
      <a class="listen-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">
        <strong>${escapeHtml(l.title)}</strong><span>${escapeHtml(l.subtitle || '')}</span>
      </a>`).join('')}</div>`;
}

function buildLinksSettings(section, pane, body) {
  const render = () => {
    const links = (getSection(section.id).settings?.links) || [];
    pane.innerHTML = `
      <div class="settings-list">${links.map((l, i) => `
        <div class="settings-row link-edit">
          <div class="link-fields">
            <input data-f="title" data-i="${i}" value="${escapeHtml(l.title)}" placeholder="Title" aria-label="Link title">
            <input data-f="url" data-i="${i}" value="${escapeHtml(l.url)}" placeholder="https://…" aria-label="Link URL">
            <input data-f="subtitle" data-i="${i}" value="${escapeHtml(l.subtitle || '')}" placeholder="Subtitle (optional)" aria-label="Link subtitle">
          </div>
          <button type="button" data-rm="${i}" class="danger">Remove</button>
        </div>`).join('')}</div>
      <div class="form-row" style="margin-top:12px">
        <button type="button" id="link-add">＋ Add link</button>
        <button type="button" id="link-save">Save links</button>
      </div>`;
    $('#link-add', pane).addEventListener('click', () => {
      saveSection(section.id, { settings: { links: [...links, { title: 'New link', url: 'https://', subtitle: '' }] } })
        .then(() => { render(); renderLinksSection(getSection(section.id), body); });
    });
    pane.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', async () => {
      const next = links.filter((_, i) => i !== Number(btn.dataset.rm));
      await saveSection(section.id, { settings: { links: next } });
      render();
      renderLinksSection(getSection(section.id), body);
    }));
    $('#link-save', pane).addEventListener('click', async () => {
      const next = links.map((l, i) => ({
        title: pane.querySelector(`[data-f="title"][data-i="${i}"]`).value.trim() || 'Link',
        url: pane.querySelector(`[data-f="url"][data-i="${i}"]`).value.trim(),
        subtitle: pane.querySelector(`[data-f="subtitle"][data-i="${i}"]`).value.trim(),
      }));
      await saveSection(section.id, { settings: { links: next } });
      renderLinksSection(getSection(section.id), body);
      alert('Links saved.');
    });
  };
  render();
}

/* ---------- Notes ---------- */
function renderNotesSection(section, body) {
  const content = (section.settings && section.settings.content) || '';
  body.innerHTML = `
    <textarea class="notes-area" aria-label="Notes" placeholder="Write a note…">${escapeHtml(content)}</textarea>
    <div class="form-row" style="margin-top:10px">
      <button type="button" class="notes-save">Save note</button>
      <span class="muted notes-hint"></span>
    </div>`;
  const area = $('.notes-area', body);
  const hint = $('.notes-hint', body);
  $('.notes-save', body).addEventListener('click', async () => {
    try {
      await saveSection(section.id, { settings: { content: area.value } });
      hint.textContent = 'Saved ✓';
      setTimeout(() => { hint.textContent = ''; }, 2000);
    } catch (err) {
      hint.textContent = err.message;
    }
  });
}

/* ---------- AI widget + Quick Launch (real services, no fake AI) ----------
 * One "AI" widget holds the user's picked services. The selection, order,
 * and default live in the section's settings ({services:[{id,name,url}],
 * defaultId}) and persist through the normal sections API. The catalog below
 * is the picker source; adding an entry here makes a new service pickable. */
const AI_CATALOG = {
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com' },
  claude:  { name: 'Claude',  url: 'https://claude.ai' },
  grok:    { name: 'Grok',    url: 'https://grok.com' },
  gemini:  { name: 'Gemini',  url: 'https://gemini.google.com' },
};
const AI_CATALOG_ORDER = ['chatgpt', 'claude', 'grok', 'gemini'];

function aiConfig(settings) {
  const s = (settings && typeof settings === 'object') ? settings : {};
  const services = [];
  const seen = new Set();
  for (const raw of (Array.isArray(s.services) ? s.services : [])) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String(raw.id || '').trim();
    const url = String(raw.url || '').trim();
    const name = String(raw.name || '').trim();
    if (!id || !url || !/^https:\/\//i.test(url) || seen.has(id)) continue;
    seen.add(id);
    services.push({ id, name: name || id, url });
  }
  const defaultId = services.some(x => x.id === s.defaultId) ? s.defaultId
    : (services.length ? services[0].id : '');
  return { services, defaultId };
}

function renderAiSection(section, body) {
  const cfg = aiConfig(section.settings);
  if (!cfg.services.length) {
    showEmpty(body, '🤖', 'No AI services selected yet.',
      'Tap Edit on this card to pick which AIs appear here.');
    return;
  }
  const byId = new Map(cfg.services.map(s => [s.id, s]));
  let current = byId.get(cfg.defaultId) || cfg.services[0];
  body.innerHTML = `
    <div class="ai-widget">
      <p class="ai-cta">Ask anything.</p>
      <div class="ai-chips" role="group" aria-label="Choose an AI service">
        ${cfg.services.map(s => `<button type="button" class="ai-chip${s.id === current.id ? ' active' : ''}"
          data-ai="${escapeHtml(s.id)}" aria-pressed="${s.id === current.id}">${escapeHtml(s.name)}</button>`).join('')}
      </div>
      <a class="ai-open" data-ai-open href="${escapeHtml(current.url)}" target="_blank" rel="noopener">Open ${escapeHtml(current.name)} ↗</a>
      <p class="muted">Opens the real ${escapeHtml(current.name)} in a new tab — your own account, nothing faked.</p>
    </div>`;
  const openBtn = body.querySelector('[data-ai-open]');
  const muted = body.querySelector('.ai-widget .muted');
  body.querySelectorAll('.ai-chip').forEach(chip => chip.addEventListener('click', () => {
    const svc = byId.get(chip.dataset.ai);
    if (!svc) return;
    current = svc;
    body.querySelectorAll('.ai-chip').forEach(c => {
      const on = c.dataset.ai === svc.id;
      c.classList.toggle('active', on);
      c.setAttribute('aria-pressed', String(on));
    });
    openBtn.href = svc.url;
    openBtn.textContent = `Open ${svc.name} ↗`;
    muted.textContent = `Opens the real ${svc.name} in a new tab — your own account, nothing faked.`;
  }));
}

/* Edit pane for the AI widget: tick services, reorder, pick a default, add a custom one. */
function buildAiSettings(section, pane, body) {
  const render = () => {
    const cfg = aiConfig(getSection(section.id).settings);
    const inWidget = new Set(cfg.services.map(s => s.id));
    const catalogIds = [...AI_CATALOG_ORDER,
      ...cfg.services.filter(s => !AI_CATALOG[s.id]).map(s => s.id)];
    pane.innerHTML = `
      <div class="set-group">
        <h3>AI services</h3>
        <p class="muted">Tick the ones you want inside this widget.</p>
        <div class="ai-pick">${catalogIds.map(id => {
          const known = AI_CATALOG[id] || cfg.services.find(s => s.id === id) || { name: id, url: '' };
          const on = inWidget.has(id);
          return `<label class="ai-pick-row">
            <input type="checkbox" data-ai-pick="${escapeHtml(id)}"${on ? ' checked' : ''}>
            <span class="ai-pick-name">${escapeHtml(known.name)}</span>
            <span class="muted">${escapeHtml(known.url)}</span>
          </label>`;
        }).join('')}</div>
      </div>
      <div class="set-group">
        <h3>Order &amp; default</h3>
        <div class="settings-list">${cfg.services.map((s, i) => `
          <div class="settings-row">
            <span class="link-fields"><strong>${escapeHtml(s.name)}</strong></span>
            <button type="button" data-ai-up="${i}"${i === 0 ? ' disabled' : ''} aria-label="Move ${escapeHtml(s.name)} up">▲</button>
            <button type="button" data-ai-down="${i}"${i === cfg.services.length - 1 ? ' disabled' : ''} aria-label="Move ${escapeHtml(s.name)} down">▼</button>
          </div>`).join('') || '<p class="muted">Nothing selected yet — tick a service above.</p>'}</div>
        ${cfg.services.length ? `
        <div class="form-row" style="margin-top:10px">
          <label>Default AI
            <select id="ai-default">${cfg.services.map(s =>
              `<option value="${escapeHtml(s.id)}"${s.id === cfg.defaultId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
          </label>
        </div>` : ''}
      </div>
      <div class="set-group">
        <h3>Add your own</h3>
        <div class="form-row">
          <input id="ai-custom-name" placeholder="Name (e.g. Perplexity)" aria-label="Custom AI name">
          <input id="ai-custom-url" placeholder="https://…" aria-label="Custom AI address" inputmode="url">
          <button type="button" id="ai-custom-add">Add</button>
        </div>
        <p class="muted ai-add-hint" aria-live="polite"></p>
      </div>`;

    const resync = async (next) => {
      await saveSection(section.id, { settings: next });
      const fresh = getSection(section.id);
      renderAiSection(fresh, body);
      render();
    };

    pane.querySelectorAll('[data-ai-pick]').forEach(cb => cb.addEventListener('change', async () => {
      const id = cb.dataset.aiPick;
      const cur = aiConfig(getSection(section.id).settings);
      let services;
      if (cb.checked) {
        const entry = AI_CATALOG[id] || cur.services.find(s => s.id === id);
        if (!entry) return;
        services = [...cur.services, { id, name: entry.name, url: entry.url }];
      } else {
        services = cur.services.filter(s => s.id !== id);
      }
      await resync({ services, defaultId: cur.defaultId });
    }));

    const move = (i, dir) => async () => {
      const cur = aiConfig(getSection(section.id).settings);
      const j = i + dir;
      if (j < 0 || j >= cur.services.length) return;
      const services = [...cur.services];
      [services[i], services[j]] = [services[j], services[i]];
      await resync({ services, defaultId: cur.defaultId });
    };
    pane.querySelectorAll('[data-ai-up]').forEach(b => b.addEventListener('click', move(Number(b.dataset.aiUp), -1)));
    pane.querySelectorAll('[data-ai-down]').forEach(b => b.addEventListener('click', move(Number(b.dataset.aiDown), 1)));

    const defSel = $('#ai-default', pane);
    if (defSel) defSel.addEventListener('change', async (e) => {
      const cur = aiConfig(getSection(section.id).settings);
      await saveSection(section.id, { settings: { services: cur.services, defaultId: e.target.value } });
      renderAiSection(getSection(section.id), body);
    });

    $('#ai-custom-add', pane).addEventListener('click', async () => {
      const name = $('#ai-custom-name', pane).value.trim();
      const url = $('#ai-custom-url', pane).value.trim();
      const hint = $('.ai-add-hint', pane);
      if (!name) { hint.textContent = 'Give it a name first.'; return; }
      if (!/^https:\/\//i.test(url)) { hint.textContent = 'The address needs to start with https://'; return; }
      const cur = aiConfig(getSection(section.id).settings);
      const id = 'custom-' + Date.now().toString(36);
      await resync({ services: [...cur.services, { id, name, url }], defaultId: cur.defaultId });
    });
  };
  render();
}

/* ---------- Quick Links (user-managed external bookmarks) ----------
 * Each entry is {name, url}. Only https:// URLs are kept; anything else
 * (including javascript:) is dropped on read and rejected on save. */
function cleanHttpUrl(raw) {
  const v = String(raw || '').trim();
  if (!/^https:\/\//i.test(v)) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

function quickLinksConfig(settings) {
  const s = (settings && typeof settings === 'object') ? settings : {};
  const out = [];
  const seen = new Set();
  for (const raw of (Array.isArray(s.links) ? s.links : [])) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.name || '').trim();
    const url = cleanHttpUrl(raw.url);
    if (!name || !url) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: name.slice(0, 60), url });
  }
  return out;
}

function renderQuickLinksSection(section, body) {
  const links = quickLinksConfig(section.settings);
  if (!links.length) {
    body.innerHTML = `<div class="empty">
      <span class="empty-icon" aria-hidden="true">🔖</span>
      <div>Add your first link — the sites you open every day, one tap away.</div>
      <button type="button" data-ql-add>Add a link</button>
    </div>`;
    body.querySelector('[data-ql-add]').addEventListener('click', () => {
      const card = body.closest('.section-card');
      toggleSettingsPane(section, $('.settings-pane', card), $('.rename-bar', card), body);
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return;
  }
  body.innerHTML = `<div class="quick-launch">${links.map(l => `
    <a class="ql-btn" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.name)}</a>`).join('')}</div>`;
}

function buildQuickLinksSettings(section, pane, body) {
  const render = () => {
    const raw = (getSection(section.id).settings?.links) || [];
    const rows = raw.map(r => ({ name: String(r?.name || ''), url: String(r?.url || '') }));
    pane.innerHTML = `
      <p class="muted" style="margin-top:0">Each link opens in a new tab. Addresses must start with https://</p>
      <div class="settings-list">${rows.map((r, i) => `
        <div class="settings-row link-edit">
          <div class="link-fields">
            <input data-f="name" data-i="${i}" value="${escapeHtml(r.name)}" placeholder="Name (e.g. Bank)" aria-label="Link name">
            <input data-f="url" data-i="${i}" value="${escapeHtml(r.url)}" placeholder="https://…" inputmode="url" aria-label="Link address">
          </div>
          <button type="button" data-rm="${i}" class="danger">Remove</button>
        </div>`).join('') || '<div class="empty">No links yet — add your first below.</div>'}</div>
      <div class="form-row" style="margin-top:12px">
        <button type="button" id="qlink-add">＋ Add link</button>
        <button type="button" id="qlink-save">Save links</button>
      </div>
      <p class="muted qlink-hint" aria-live="polite"></p>`;
    $('#qlink-add', pane).addEventListener('click', async () => {
      await saveSection(section.id, { settings: { links: [...rows, { name: '', url: 'https://' }] } });
      render();
    });
    pane.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', async () => {
      const next = rows.filter((_, i) => i !== Number(btn.dataset.rm));
      await saveSection(section.id, { settings: { links: next } });
      render();
      renderQuickLinksSection(getSection(section.id), body);
    }));
    $('#qlink-save', pane).addEventListener('click', async () => {
      const hint = $('.qlink-hint', pane);
      const next = [];
      let skipped = 0;
      rows.forEach((_, i) => {
        const name = pane.querySelector(`[data-f="name"][data-i="${i}"]`).value.trim();
        const urlRaw = pane.querySelector(`[data-f="url"][data-i="${i}"]`).value;
        const url = cleanHttpUrl(urlRaw);
        if (!name && !urlRaw.trim()) return; // untouched blank row
        if (!name || !url) { skipped++; return; }
        next.push({ name: name.slice(0, 60), url });
      });
      await saveSection(section.id, { settings: { links: next } });
      renderQuickLinksSection(getSection(section.id), body);
      render();
      hint.textContent = skipped
        ? `Saved. Skipped ${skipped} — ${skipped === 1 ? 'it needs' : 'they need'} a name and an https:// address.`
        : 'Links saved.';
    });
  };
  render();
}

/* ---------- My Day (clock, date, weather one-liner, what's next) ----------
 * The weather one-liner reuses the Weather widget's own settings/location
 * and the same forecast source. "Up next" reads GET /api/today, which is
 * fed by a scheduled job from the user's paired calendar — if it's empty,
 * the widget says so honestly. Nothing here is ever invented. */
let myDayTimer = 0;

function renderMyDaySection(section, body) {
  body.innerHTML = `
    <div class="myday">
      <div class="myday-clock" data-clock>--:--</div>
      <div class="myday-meta">
        <div class="myday-date" data-date></div>
        <div class="myday-line muted" data-wx>Checking weather…</div>
        <div class="myday-next" data-next>Checking your calendar…</div>
      </div>
    </div>`;
  const tick = () => {
    const el = body.querySelector('[data-clock]');
    if (el) el.textContent = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };
  tick();
  if (myDayTimer) clearInterval(myDayTimer);
  myDayTimer = setInterval(tick, 15000);
  const dateEl = body.querySelector('[data-date]');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  loadMyDayWeather(body);
  loadMyDayNext(body);
}

async function loadMyDayWeather(body) {
  const el = body.querySelector('[data-wx]');
  if (!el) return;
  const wxSection = sections.find(s => s.type === 'weather' && s.enabled);
  const s = (wxSection && wxSection.settings) || {};
  let lat = Number(s.lat), lon = Number(s.lon);
  if (!isFinite(lat) || !isFinite(lon)) { lat = 38.04; lon = -84.50; }
  try {
    const resp = await fetch(weatherUrl(lat, lon));
    if (!resp.ok) throw new Error(`weather HTTP ${resp.status}`);
    const data = await resp.json();
    const cur = data.current || {};
    const hi = Math.round(data.daily.temperature_2m_max[0]);
    const lo = Math.round(data.daily.temperature_2m_min[0]);
    const label = s.location || 'Lexington, KY';
    el.textContent = `${wxEmoji(cur.weather_code)} ${Math.round(cur.temperature_2m)}°F ${WX_CODE[cur.weather_code] || ''} — H ${hi}° / L ${lo}° • ${label}`;
  } catch {
    el.textContent = 'Weather is unavailable right now.';
  }
}

async function loadMyDayNext(body) {
  const el = body.querySelector('[data-next]');
  if (!el) return;
  try {
    const res = await fetch('/api/today');
    if (!res.ok) throw new Error('today unavailable');
    const data = await res.json();
    const events = Array.isArray(data.events) ? data.events : [];
    if (!events.length) {
      el.innerHTML = '<span class="muted">Nothing on the calendar today.</span>';
      return;
    }
    const first = events[0];
    const rest = events.length - 1;
    el.innerHTML = `<strong>Up next:</strong> ${escapeHtml(first.title)}${first.time ? ` <span class="muted">${escapeHtml(first.time)}</span>` : ''}${rest > 0 ? ` <span class="muted">(+${rest} more)</span>` : ''}`;
  } catch {
    el.innerHTML = '<span class="muted">Calendar is unavailable right now.</span>';
  }
}

/* ---------- Settings dispatcher ---------- */
function buildSettingsPane(section, pane, body) {
  const builders = {
    weather: buildWeatherSettings,
    sports: buildSportsSettings,
    youtube: buildYouTubeSettings,
    links: buildLinksSettings,
    ai: buildAiSettings,
    quicklinks: buildQuickLinksSettings,
  };
  if (builders[section.type]) builders[section.type](section, pane, body);
  else pane.innerHTML = '<div class="empty">No settings for this section.</div>';
}

/* ---------- Add Section (grouped catalog, only real widgets) ---------- */
function openAddModal() {
  const modal = $('#add-modal');
  const picker = $('#type-picker');
  picker.innerHTML = TYPE_GROUPS.map(group => `
    <div class="type-group">
      <p class="type-group-title">${escapeHtml(group.title)}</p>
      <div class="type-picker">
        ${group.types.map(type => {
          const meta = SECTION_TYPES[type];
          return `<button type="button" class="type-card" data-type="${escapeHtml(type)}">
            <strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(meta.desc)}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`).join('');
  picker.querySelectorAll('[data-type]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    const type = btn.dataset.type;
    try {
      const data = await api('/api/sections', 'POST', { type });
      sections.push(data.section);
      closeAddModal();
      render();
      // Widgets that need configuration open their settings right away.
      if (TYPES_WITH_SETTINGS.has(type)) {
        const card = dashboardEl.querySelector(`[data-section-id="${CSS.escape(data.section.id)}"]`);
        if (card) {
          const pane = $('.settings-pane', card);
          toggleSettingsPane(data.section, pane, $('.rename-bar', card), $('.card-body', card));
          card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
    }
  }));
  modal.hidden = false;
}
function closeAddModal() { $('#add-modal').hidden = true; }

/* ---------- Settings center ----------
 * One coherent place for dashboard-wide settings. Categories are data, so
 * Accounts / Notifications / Data can slot in later without restructuring. */
const SETTING_CATS = [
  { id: 'dashboard', label: 'Dashboard', icon: '🧭' },
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'accounts', label: 'Accounts', icon: '🔑', soon: true },
  { id: 'notifications', label: 'Notifications', icon: '🔔', soon: true },
  { id: 'data', label: 'Data', icon: '💾', soon: true },
];
let settingsCat = 'dashboard';

function openSettings() {
  settingsCat = 'dashboard';
  renderSettingsNav();
  renderSettingsContent();
  $('#settings-modal').hidden = false;
}
function closeSettings() { $('#settings-modal').hidden = true; }

function renderSettingsNav() {
  const nav = $('#settings-nav');
  nav.innerHTML = SETTING_CATS.map(c => `
    <button type="button" data-cat="${c.id}" ${c.soon ? 'disabled' : ''}
      ${c.id === settingsCat ? 'aria-current="true"' : ''}
      aria-label="${escapeHtml(c.label)}${c.soon ? ' (coming later)' : ''}">
      <span>${c.icon} ${escapeHtml(c.label)}</span>
      ${c.soon ? '<span class="soon">Later</span>' : ''}
    </button>`).join('');
  nav.querySelectorAll('[data-cat]').forEach(btn => btn.addEventListener('click', () => {
    settingsCat = btn.dataset.cat;
    renderSettingsNav();
    renderSettingsContent();
  }));
}

function renderSettingsContent() {
  const el = $('#settings-content');
  if (settingsCat === 'dashboard') renderSettingsDashboard(el);
  else if (settingsCat === 'appearance') renderSettingsAppearance(el);
}

function renderSettingsDashboard(el) {
  const ordered = sections.slice().sort((a, b) => a.position - b.position);
  el.innerHTML = `
    <h3>Dashboard</h3>
    <p class="muted" style="margin:0">Reorder and show or hide your sections. Changes save right away.</p>
    <div class="order-list">
      ${ordered.map(s => `
        <div class="order-row ${s.enabled ? '' : 'is-hidden'}">
          <div class="ord-title"><strong>${escapeHtml(s.title)}</strong><br>
            <small>${escapeHtml(SECTION_TYPES[s.type]?.label || s.type)} • ${SIZE_NAMES[sectionSize(s)]}${s.enabled ? '' : ' • hidden'}</small></div>
          <button type="button" data-ord="up" data-id="${escapeHtml(s.id)}" aria-label="Move ${escapeHtml(s.title)} up">▲</button>
          <button type="button" data-ord="down" data-id="${escapeHtml(s.id)}" aria-label="Move ${escapeHtml(s.title)} down">▼</button>
          <button type="button" data-ord="toggle" data-id="${escapeHtml(s.id)}">${s.enabled ? 'Hide' : 'Show'}</button>
        </div>`).join('') || '<div class="empty">No sections yet.</div>'}
    </div>
    <div class="form-row">
      <button type="button" id="show-all-sections">Show all hidden sections</button>
    </div>`;
  el.querySelectorAll('[data-ord]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    const ord = btn.dataset.ord;
    try {
      if (ord === 'toggle') {
        const s = getSection(id);
        await saveSection(id, { enabled: !s.enabled });
      } else {
        await moveSectionSilent(id, ord === 'up' ? -1 : 1);
      }
      renderSettingsDashboard(el);
      render();
    } catch (err) { alert(err.message); }
  }));
  $('#show-all-sections', el).addEventListener('click', async () => {
    try {
      await Promise.all(hiddenSections().map(s => saveSection(s.id, { enabled: true })));
      renderSettingsDashboard(el);
      render();
    } catch (err) { alert(err.message); }
  });
}

async function moveSectionSilent(id, dir) {
  const ordered = sections.slice().sort((a, b) => a.position - b.position);
  const idx = ordered.findIndex(s => s.id === id);
  const swapWith = idx + dir;
  if (idx < 0 || swapWith < 0 || swapWith >= ordered.length) return;
  [ordered[idx], ordered[swapWith]] = [ordered[swapWith], ordered[idx]];
  await api('/api/sections/reorder', 'PUT', { order: ordered.map(s => s.id) });
  ordered.forEach((s, i) => { s.position = i; });
  sections = ordered;
}

function renderSettingsAppearance(el) {
  const glassVal = Math.min(100, Math.max(35, Number(prefs.glass) || 96));
  el.innerHTML = `
    <h3>Appearance</h3>
    <p class="muted" style="margin:0">These are saved on this device.</p>
    <div class="pref-row">
      <div><strong>Theme</strong><br><small>Black / Silver — the Howard's Digital look</small></div>
      <span class="label" style="border:1px solid rgba(199,206,219,.3);border-radius:999px;padding:8px 16px">Current</span>
    </div>
    <div class="pref-row">
      <div><strong>TV mode</strong><br><small>Bigger text and targets, fewer columns, stronger focus — for the big screen</small></div>
      <label class="switch"><input type="checkbox" id="pref-tv" ${prefs.tvMode ? 'checked' : ''} aria-label="TV mode"><span class="track"></span></label>
    </div>
    <div class="pref-row">
      <div><strong>Text size</strong><br><small>Normal or Large</small></div>
      <select id="pref-font" aria-label="Text size">
        <option value="normal" ${prefs.fontSize !== 'large' ? 'selected' : ''}>Normal</option>
        <option value="large" ${prefs.fontSize === 'large' ? 'selected' : ''}>Large</option>
      </select>
    </div>
    <div class="pref-row">
      <div><strong>Background</strong><br><small>The page backdrop behind your cards</small></div>
      <select id="pref-bg" aria-label="Background">
        <option value="aurora" ${prefs.background === 'aurora' ? 'selected' : ''}>Aurora (default)</option>
        <option value="solid" ${prefs.background === 'solid' ? 'selected' : ''}>Solid black</option>
        <option value="graphite" ${prefs.background === 'graphite' ? 'selected' : ''}>Graphite</option>
      </select>
    </div>
    <div class="pref-row">
      <div><strong>Glass</strong><br><small>How see-through your cards are — slide it till it looks right</small></div>
      <div style="display:flex;align-items:center;gap:12px;flex:1 1 220px;min-width:200px">
        <input type="range" id="pref-glass" min="35" max="100" step="1" value="${glassVal}" aria-label="Card transparency">
        <span class="glass-val" id="pref-glass-val">${glassVal}%</span>
      </div>
    </div>`;
  $('#pref-tv', el).addEventListener('change', (e) => {
    prefs.tvMode = e.target.checked; storePrefs(); applyPrefs();
  });
  $('#pref-font', el).addEventListener('change', (e) => {
    prefs.fontSize = e.target.value; storePrefs(); applyPrefs();
  });
  $('#pref-bg', el).addEventListener('change', (e) => {
    prefs.background = e.target.value; storePrefs(); applyPrefs();
  });
  const glassInput = $('#pref-glass', el), glassLabel = $('#pref-glass-val', el);
  glassInput.addEventListener('input', () => {
    prefs.glass = Number(glassInput.value);
    glassLabel.textContent = `${glassInput.value}%`;
    storePrefs(); applyPrefs();
  });
}

/* ---------- Edit mode ---------- */
function setEditMode(on) {
  document.body.classList.toggle('editing', on);
  const btn = $('#edit-toggle');
  btn.setAttribute('aria-pressed', String(on));
  btn.textContent = on ? '✓ Done' : '⇄ Rearrange';
  if (!on) closeCardMenu();
}

/* ---------- Render ---------- */
const RENDERERS = {
  greeting: (s, b) => renderGreetingSection(b),
  search: (s, b) => renderSearchSection(b),
  weather: renderWeatherSection,
  sports: renderSportsSection,
  youtube: renderYouTubeSection,
  projects: (s, b) => renderProjectsSection(b),
  files: renderFilesSection,
  links: renderLinksSection,
  notes: renderNotesSection,
  ai: renderAiSection,
  quicklinks: renderQuickLinksSection,
  myday: renderMyDaySection,
};

function render() {
  closeCardMenu();
  if (myDayTimer) { clearInterval(myDayTimer); myDayTimer = 0; }
  renderGreeting();
  dashboardEl.innerHTML = '';
  const vis = visibleSections();
  if (!vis.length) {
    showEmpty(dashboardEl, '🏠', 'Your dashboard is empty.', 'Tap ＋ Add Section to build it.');
  }
  for (const section of vis) {
    const { card, body, settingsPane } = cardShell(section);
    dashboardEl.appendChild(card);
    try {
      RENDERERS[section.type](section, body);
    } catch {
      showError(body, 'This section had trouble loading.', () => {
        try { RENDERERS[section.type](section, body); } catch { /* stays in error state */ }
      });
    }
  }
  // Hidden sections strip
  const hidden = hiddenSections();
  hiddenBarEl.hidden = !hidden.length;
  hiddenListEl.innerHTML = hidden.map(s => `
    <span class="hidden-chip"><strong>${escapeHtml(s.title)}</strong>
    <button type="button" data-show="${escapeHtml(s.id)}">Show</button></span>`).join('');
  hiddenListEl.querySelectorAll('[data-show]').forEach(btn => btn.addEventListener('click', async () => {
    await saveSection(btn.dataset.show, { enabled: true });
    render();
  }));
}

/* ---------- Boot ---------- */
async function boot() {
  applyPrefs();
  renderGreeting();
  enableSectionDrag();
  renderBootSkeletons();

  $('#add-section-btn').addEventListener('click', openAddModal);
  $('#add-modal-close').addEventListener('click', closeAddModal);
  $('#add-modal').addEventListener('click', (e) => { if (e.target.id === 'add-modal') closeAddModal(); });
  $('#edit-toggle').addEventListener('click', () => setEditMode(!document.body.classList.contains('editing')));
  $('#settings-btn').addEventListener('click', openSettings);
  $('#settings-close').addEventListener('click', closeSettings);
  $('#settings-modal').addEventListener('click', (e) => { if (e.target.id === 'settings-modal') closeSettings(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#settings-modal').hidden) closeSettings();
      else if (!$('#add-modal').hidden) closeAddModal();
      else closeCardMenu();
    }
  });

  try {
    const data = await api('/api/sections');
    sections = data.sections || [];
    dbConnected = data.db !== false;
    statusEl.textContent = dbConnected ? 'Connected' : 'Build mode';
  } catch {
    sections = [];
    statusEl.textContent = 'Build mode';
  }
  render();
}

boot();
