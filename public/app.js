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
 * of them is a real, working widget. Nothing fake, nothing dead.
 * tags drive the catalog filter chips; keywords feed catalog search;
 * hot marks the new/exciting ones for the 🔥 Hot filter. */
const SECTION_TYPES = {
  myday:   { label: 'My Day', desc: 'Clock, date, weather, and what\u2019s next today.', tags: ['Essentials'], keywords: 'clock today agenda calendar schedule', hot: false },
  greeting: { label: 'Greeting', desc: 'A welcome banner with the time of day.', tags: ['Essentials'], keywords: 'welcome hello banner', hot: false },
  search:   { label: 'Search', desc: 'A Google search bar.', tags: ['Essentials'], keywords: 'google find lookup', hot: false },
  weather:  { label: 'Weather', desc: 'Current conditions. Tap for a 5-day forecast.', tags: ['Information'], keywords: 'forecast temperature rain', hot: false },
  sports:   { label: 'Sports', desc: 'Follow your teams — scores and schedules.', tags: ['Information'], keywords: 'teams games nfl mlb nba nhl', hot: false },
  youtube:  { label: 'YouTube', desc: 'Latest videos from channels you add.', tags: ['Media'], keywords: 'videos channels subscriptions', hot: false },
  projects: { label: 'Projects', desc: 'Your HD project workspace.', tags: ['Personal'], keywords: 'workspace tasks', hot: false },
  files:    { label: 'Files', desc: 'Upload files and share them with a link.', tags: ['Personal'], keywords: 'upload documents share storage', hot: false },
  links:    { label: 'Links', desc: 'Your own list of favorite links.', tags: ['Personal'], keywords: 'bookmarks favorites urls', hot: false },
  notes:    { label: 'Notes', desc: 'Quick notes, saved automatically on HD.', tags: ['Personal'], keywords: 'notepad memo write', hot: false },
  ai:         { label: 'AI', desc: 'Your AI launchers — pick which services appear inside.', tags: ['Essentials'], keywords: 'chatgpt Muse grok assistant launchers', hot: false },
  quicklinks: { label: 'Quick Links', desc: 'The sites you open every day — one tap away.', tags: ['Essentials'], keywords: 'shortcuts sites daily', hot: false },
  rss:        { label: 'RSS Feed', desc: 'Headlines from any RSS or Atom feed.', tags: ['Information'], keywords: 'news headlines blog feed reader', hot: true },
  ytspotlight:{ label: 'Video Spotlight', desc: 'A channel\u2019s latest video, playing in the card.', tags: ['Media'], keywords: 'youtube video player watch latest', hot: true },
  scores:     { label: 'Live Scores', desc: 'Live scores: NFL, MLB, NBA, NHL.', tags: ['Information'], keywords: 'games live sports nfl mlb nba nhl results', hot: true },
  countdown:  { label: 'Countdown', desc: 'Count down to a big day.', tags: ['Personal'], keywords: 'timer days until event', hot: false },
  verse:      { label: 'Verse of the Day', desc: 'A KJV verse every day, picked for you.', tags: ['Faith'], keywords: 'bible scripture kjv daily devotional god', hot: true },
  checklist:  { label: 'Checklist', desc: 'Prayer lists, reminders, to-dos — check things off.', tags: ['Productivity'], keywords: 'prayer reminder todo tasks list check off', hot: false },
  radio:      { label: 'Radio', desc: 'Play a live radio stream right on your dashboard.', tags: ['Entertainment'], keywords: 'stream station music listen audio live', hot: true },
  alerts:     { label: 'Weather Alerts', desc: 'Active NOAA weather alerts for your area.', tags: ['Information'], keywords: 'noaa warnings watch advisory storm severe', hot: false },
  photos:     { label: 'Photos', desc: 'Your pictures, rotating on a timer.', tags: ['Entertainment'], keywords: 'pictures slideshow images family gallery', hot: true },
  callbuttons:{ label: 'Tap to Call', desc: 'Big one-tap buttons for the people you call most.', tags: ['Productivity'], keywords: 'phone dial contacts call number', hot: false },
  standings:  { label: 'Standings', desc: 'League standings: NFL, MLB, NBA, NHL.', tags: ['Information'], keywords: 'table wins losses nfl mlb nba nhl records', hot: false },
  stocks:     { label: 'Stocks', desc: 'Watch your tickers with daily change.', tags: ['Information'], keywords: 'shares market price ticker portfolio investing', hot: false },
  monthcal:   { label: 'Month Calendar', desc: 'The month at a glance, with your events dotted.', tags: ['Productivity'], keywords: 'calendar month events days agenda schedule', hot: false },
  quote:      { label: 'Quote of the Day', desc: 'A fresh bit of inspiration every morning.', tags: ['Faith'], keywords: 'inspiration wisdom daily saying encouragement', hot: false },
};
const TYPE_GROUPS = [
  { title: 'Essentials', types: ['myday', 'greeting', 'search', 'quicklinks'] },
  { title: 'Information', types: ['weather', 'sports', 'rss', 'scores', 'standings', 'stocks', 'alerts'] },
  { title: 'Media', types: ['youtube', 'ytspotlight', 'radio', 'photos'] },
  { title: 'Faith', types: ['verse', 'quote'] },
  { title: 'Productivity', types: ['checklist', 'callbuttons', 'monthcal'] },
  { title: 'Personal', types: ['projects', 'files', 'links', 'notes', 'countdown'] },
  { title: 'AI', types: ['ai'] },
];
const TYPES_WITH_SETTINGS = new Set(['weather', 'sports', 'youtube', 'links', 'ai', 'quicklinks', 'rss', 'ytspotlight', 'scores', 'countdown', 'radio', 'alerts', 'photos', 'callbuttons', 'standings', 'stocks']);
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

/* ---------- RSS feed (fetched server-side; no CORS issues) ---------- */
async function renderRssSection(section, body) {
  const s = section.settings || {};
  const feedUrl = (s.feedUrl || '').trim();
  if (!feedUrl) {
    showEmpty(body, '📰', 'No feed yet.', 'Tap Edit on this card to add an RSS or Atom feed URL.');
    return;
  }
  const count = Math.min(20, Math.max(1, Number(s.count) || 8));
  showLoading(body, 4);
  let data;
  try {
    const res = await fetch(`/api/rss?url=${encodeURIComponent(feedUrl)}`);
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Feed unavailable.');
  } catch (err) {
    showError(body, err.message || "Couldn't load that feed right now.", () => renderRssSection(section, body));
    return;
  }
  const items = (data.items || []).slice(0, count);
  body.innerHTML = `
    <div class="rss-list">
      ${items.map((it) => {
        const d = it.pubDate ? new Date(it.pubDate) : null;
        const date = d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
        return `<a class="rss-item" href="${escapeHtml(it.link || '#')}" target="_blank" rel="noopener">
          <strong>${escapeHtml(it.title || 'Untitled')}</strong>${date ? `<small class="muted">${escapeHtml(date)}</small>` : ''}
        </a>`;
      }).join('') || '<div class="empty">This feed has no stories right now.</div>'}
    </div>`;
}

function buildRssSettings(section, pane, body) {
  const s = section.settings || {};
  pane.innerHTML = `
    <form class="settings-form" id="rss-form">
      <label>Feed URL
        <input name="feedUrl" type="url" inputmode="url" placeholder="https://example.com/feed.xml" value="${escapeHtml(s.feedUrl || '')}" required>
      </label>
      <label>Title override (optional)
        <input name="titleOverride" placeholder="Leave blank to use the feed's own title" value="${escapeHtml(s.titleOverride || '')}">
      </label>
      <label>Stories to show
        <select name="count">
          ${[5, 8, 12, 15, 20].map(n => `<option value="${n}" ${(Number(s.count) || 8) === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>
      <button type="submit">Save</button>
      <p class="muted">Any public RSS or Atom feed works — news sites, blogs, podcasts, even YouTube channels.</p>
    </form>`;
  $('#rss-form', pane).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const patch = {
      feedUrl: f.feedUrl.value.trim(),
      titleOverride: f.titleOverride.value.trim(),
      count: Number(f.count.value) || 8,
    };
    if (!/^https?:\/\//i.test(patch.feedUrl)) { alert('The feed URL should start with http:// or https://'); return; }
    await saveSection(section.id, { settings: patch });
    renderRssSection(getSection(section.id), body);
  });
}

/* ---------- Video spotlight: latest video from a channel, playing ---------- */
function extractVideoId(input) {
  const v = (input || '').trim();
  const m = v.match(/[?&]v=([A-Za-z0-9_-]{11})/) || v.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)
    || v.match(/\/embed\/([A-Za-z0-9_-]{11})/) || v.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}

async function renderSpotlightSection(section, body) {
  const s = section.settings || {};
  const videoUrl = (s.videoUrl || '').trim();
  const channel = (s.channel || '').trim();
  let videoId = extractVideoId(videoUrl);
  let title = '';
  if (!videoId) {
    if (!channel) {
      showEmpty(body, '🎬', 'No channel yet.', 'Tap Edit on this card to pick a YouTube channel or paste a video.');
      return;
    }
    showLoading(body, 2);
    try {
      const res = await fetch(`/api/yt-latest?channel=${encodeURIComponent(channel)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Channel unavailable.');
      videoId = data.videoId;
      title = data.title || '';
    } catch (err) {
      showError(body, err.message || "Couldn't load that channel right now.", () => renderSpotlightSection(section, body));
      return;
    }
  }
  const embed = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&rel=0`;
  body.innerHTML = `
    <div class="spot-embed"><iframe src="${escapeHtml(embed)}" title="${escapeHtml(title || 'Video')}"
      allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>
    ${title ? `<p class="spot-title">${escapeHtml(title)}</p>` : ''}
    <button type="button" class="spot-expand">⛶ Expand</button>`;
  $('.spot-expand', body).addEventListener('click', () => openSpotlightModal(videoId, title));
}

function openSpotlightModal(videoId, title) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal spot-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title || 'Video')}">
      <div class="modal-head"><h2>${escapeHtml(title || 'Video')}</h2>
      <button type="button" data-close aria-label="Close">✕</button></div>
      <div class="spot-embed"><iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(videoId)}?autoplay=1&rel=0"
        title="${escapeHtml(title || 'Video')}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
    </div>`;
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  const btn = backdrop.querySelector('[data-close]');
  if (btn) btn.focus();
}

function buildSpotlightSettings(section, pane, body) {
  const s = section.settings || {};
  pane.innerHTML = `
    <form class="settings-form" id="spot-form">
      <label>YouTube channel
        <input name="channel" placeholder="@handle, channel URL, or UC… ID" value="${escapeHtml(s.channel || '')}">
      </label>
      <label>Single video override (optional)
        <input name="videoUrl" type="url" inputmode="url" placeholder="Paste a YouTube video URL to pin it" value="${escapeHtml(s.videoUrl || '')}">
      </label>
      <button type="submit">Save</button>
      <p class="muted">Plays the channel's latest video automatically — muted until you tap, that's a browser rule, not ours. The override pins one video instead.</p>
    </form>`;
  $('#spot-form', pane).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const patch = { channel: f.channel.value.trim(), videoUrl: f.videoUrl.value.trim() };
    if (!patch.channel && !patch.videoUrl) { alert('Add a channel or a video URL.'); return; }
    await saveSection(section.id, { settings: patch });
    renderSpotlightSection(getSection(section.id), body);
  });
}

/* ---------- Live scores (ESPN scoreboard; no key) ---------- */
const SCORE_LEAGUES = { nfl: 'NFL', mlb: 'MLB', nba: 'NBA', nhl: 'NHL' };

async function renderScoresSection(section, body) {
  const league = ((section.settings || {}).league || 'nfl').toLowerCase();
  showLoading(body, 3);
  const load = async () => {
    try {
      const res = await fetch(`/api/scores?league=${encodeURIComponent(league)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scores unavailable.');
      paintScores(body, data);
    } catch (err) {
      showError(body, err.message || 'Scores are unavailable right now.', load);
    }
  };
  await load();
  // Refresh every 3 minutes while this card is on the page.
  const timer = setInterval(() => {
    if (body.isConnected) load();
    else clearInterval(timer);
  }, 180000);
  liveTimers.push(timer);
}

function paintScores(body, data) {
  const games = data.games || [];
  if (!games.length) {
    showEmpty(body, '🏟️', 'No games right now.', 'Check back during the season — scores appear automatically.');
    return;
  }
  body.innerHTML = `<div class="score-list">${games.map((g) => {
    const live = g.status === 'live';
    const d = g.date ? new Date(g.date) : null;
    const sched = d && !isNaN(d)
      ? d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    const when = live ? [g.clock, g.period ? `Q${g.period}` : ''].filter(Boolean).join(' • ')
      : g.status === 'final' ? 'Final' : sched;
    const teams = `${escapeHtml(g.awayAbbr || g.away)} <span class="vs">@</span> ${escapeHtml(g.homeAbbr || g.home)}`;
    const nums = (g.awayScore !== '' || g.homeScore !== '') ? `${escapeHtml(g.awayScore)} – ${escapeHtml(g.homeScore)}` : '';
    return `<div class="score-game${live ? ' is-live' : ''}">
      <div class="score-teams"><strong>${teams}</strong><br><small class="muted">${escapeHtml(g.away)} at ${escapeHtml(g.home)}</small></div>
      <div class="score-right">
        ${nums ? `<span class="score-nums">${nums}</span>` : ''}
        ${live ? '<span class="live-pill">LIVE</span>' : ''}
        ${when ? `<small class="muted score-when">${escapeHtml(when)}</small>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

function buildScoresSettings(section, pane, body) {
  const league = ((section.settings || {}).league || 'nfl').toLowerCase();
  pane.innerHTML = `
    <form class="settings-form" id="scores-form">
      <label>League
        <select name="league">
          ${Object.entries(SCORE_LEAGUES).map(([v, l]) => `<option value="${v}" ${league === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      <button type="submit">Save</button>
      <p class="muted">Scores refresh themselves every few minutes while the page is open.</p>
    </form>`;
  $('#scores-form', pane).addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSection(section.id, { settings: { league: e.target.league.value } });
    renderScoresSection(getSection(section.id), body);
  });
}

/* ---------- Countdown (pure frontend) ---------- */
function renderCountdownSection(section, body) {
  const s = section.settings || {};
  if (!s.target) {
    showEmpty(body, '⏳', 'No countdown yet.', 'Tap Edit on this card to pick a date.');
    return;
  }
  body.innerHTML = `
    <div class="countdown">
      <div class="countdown-big" data-cd>--</div>
      ${s.label ? `<div class="muted">${escapeHtml(s.label)}</div>` : ''}
    </div>`;
  const el = body.querySelector('[data-cd]');
  const target = new Date(s.target).getTime();
  if (isNaN(target)) {
    el.textContent = 'That date didn’t parse — edit the card and pick it again.';
    return;
  }
  const tick = () => {
    if (!el.isConnected) { clearInterval(timer); return; }
    const diff = target - Date.now();
    if (diff <= 0) { el.textContent = "It's here! 🎉"; clearInterval(timer); return; }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor(diff / 3600000) % 24;
    const m = Math.floor(diff / 60000) % 60;
    const sec = Math.floor(diff / 1000) % 60;
    el.textContent = `${d}d ${h}h ${m}m ${sec}s`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  liveTimers.push(timer);
}

function buildCountdownSettings(section, pane, body) {
  const s = section.settings || {};
  pane.innerHTML = `
    <form class="settings-form" id="cd-form">
      <label>Label
        <input name="label" placeholder="e.g. Christmas, Opening Day" value="${escapeHtml(s.label || '')}">
      </label>
      <label>Count down to
        <input name="target" type="datetime-local" value="${escapeHtml(s.target || '')}" required>
      </label>
      <button type="submit">Save</button>
    </form>`;
  $('#cd-form', pane).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    await saveSection(section.id, { settings: { label: f.label.value.trim(), target: f.target.value } });
    renderCountdownSection(getSection(section.id), body);
  });
}

/* ---------- Widget batch 2: daily content data ----------
 * KJV verses are public domain. Both lists rotate by day-of-year so every
 * morning brings a fresh one, cycling monthly. */
const DAILY_VERSES = [
  ['John 3:16', 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'],
  ['Philippians 4:13', 'I can do all things through Christ which strengtheneth me.'],
  ['Romans 8:28', 'And we know that all things work together for good to them that love God, to them who are the called according to his purpose.'],
  ['Psalm 23:1', 'The LORD is my shepherd; I shall not want.'],
  ['Proverbs 3:5', 'Trust in the LORD with all thine heart; and lean not unto thine own understanding.'],
  ['Jeremiah 29:11', 'For I know the thoughts that I think toward you, saith the LORD, thoughts of peace, and not of evil, to give you an expected end.'],
  ['Isaiah 41:10', 'Fear thou not; for I am with thee: be not dismayed; for I am thy God: I will strengthen thee; yea, I will help thee.'],
  ['Romans 10:9', 'That if thou shalt confess with thy mouth the Lord Jesus, and shalt believe in thine heart that God hath raised him from the dead, thou shalt be saved.'],
  ['Psalm 46:1', 'God is our refuge and strength, a very present help in trouble.'],
  ['Matthew 11:28', 'Come unto me, all ye that labour and are heavy laden, and I will give you rest.'],
  ['John 14:6', 'Jesus saith unto him, I am the way, the truth, and the life: no man cometh unto the Father, but by me.'],
  ['Romans 6:23', 'For the wages of sin is death; but the gift of God is eternal life through Jesus Christ our Lord.'],
  ['1 John 1:9', 'If we confess our sins, he is faithful and just to forgive us our sins, and to cleanse us from all unrighteousness.'],
  ['Philippians 4:6', 'Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.'],
  ['Joshua 1:9', 'Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.'],
  ['Psalm 118:24', 'This is the day which the LORD hath made; we will rejoice and be glad in it.'],
  ['2 Timothy 1:7', 'For God hath not given us the spirit of fear; but of power, and of love, and of a sound mind.'],
  ['Hebrews 11:1', 'Now faith is the substance of things hoped for, the evidence of things not seen.'],
  ['Romans 5:8', 'But God commendeth his love toward us, in that, while we were yet sinners, Christ died for us.'],
  ['Ephesians 2:8', 'For by grace are ye saved through faith; and that not of yourselves: it is the gift of God.'],
  ['Psalm 91:1', 'He that dwelleth in the secret place of the most High shall abide under the shadow of the Almighty.'],
  ['Isaiah 40:31', 'But they that wait upon the LORD shall renew their strength; they shall mount up with wings as eagles.'],
  ['Matthew 6:33', 'But seek ye first the kingdom of God, and his righteousness; and all these things shall be added unto you.'],
  ['John 8:12', 'I am the light of the world: he that followeth me shall not walk in darkness, but shall have the light of life.'],
  ['Psalm 119:105', 'Thy word is a lamp unto my feet, and a light unto my path.'],
  ['Romans 12:2', 'And be not conformed to this world: but be ye transformed by the renewing of your mind.'],
  ['Micah 6:8', 'He hath shewed thee, O man, what is good; and what doth the LORD require of thee, but to do justly, and to love mercy, and to walk humbly with thy God?'],
  ['Psalm 37:4', 'Delight thyself also in the LORD; and he shall give thee the desires of thine heart.'],
  ['James 1:5', 'If any of you lack wisdom, let him ask of God, that giveth to all men liberally, and upbraideth not; and it shall be given him.'],
  ['Luke 24:32', 'And they said one to another, Did not our heart burn within us, while he talked with us by the way, and while he opened to us the scriptures?'],
  ['Revelation 22:21', 'The grace of our Lord Jesus Christ be with you all. Amen.'],
];
const DAILY_QUOTES = [
  ['The best way out is always through.', 'Robert Frost'],
  ['What you do today can improve all your tomorrows.', 'Ralph Marston'],
  ['It always seems impossible until it\u2019s done.', 'Nelson Mandela'],
  ['Kindness is a language which the deaf can hear and the blind can see.', 'Mark Twain'],
  ['The only way to do great work is to love what you do.', 'Steve Jobs'],
  ['Believe you can and you\u2019re halfway there.', 'Theodore Roosevelt'],
  ['A journey of a thousand miles begins with a single step.', 'Lao Tzu'],
  ['Don\u2019t watch the clock; do what it does. Keep going.', 'Sam Levenson'],
  ['The future belongs to those who believe in the beauty of their dreams.', 'Eleanor Roosevelt'],
  ['Hardships often prepare ordinary people for an extraordinary destiny.', 'C.S. Lewis'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['What lies behind us and what lies before us are tiny matters compared to what lies within us.', 'Ralph Waldo Emerson'],
  ['Action is the foundational key to all success.', 'Pablo Picasso'],
  ['The secret of getting ahead is getting started.', 'Mark Twain'],
  ['You are braver than you believe, stronger than you seem, and smarter than you think.', 'A.A. Milne'],
  ['Keep your face always toward the sunshine \u2014 and shadows will fall behind you.', 'Walt Whitman'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['Success is not final, failure is not fatal: it is the courage to continue that counts.', 'Winston Churchill'],
  ['In the middle of difficulty lies opportunity.', 'Albert Einstein'],
  ['Light tomorrow with today.', 'Elizabeth Barrett Browning'],
  ['The best time to plant a tree was twenty years ago. The second best time is now.', 'Proverb'],
  ['Nothing is impossible. The word itself says \u201cI\u2019m possible!\u201d', 'Audrey Hepburn'],
  ['You miss 100% of the shots you don\u2019t take.', 'Wayne Gretzky'],
  ['Whether you think you can or you think you can\u2019t, you\u2019re right.', 'Henry Ford'],
  ['Perseverance is not a long race; it is many short races one after the other.', 'Walter Elliot'],
  ['The only limit to our realization of tomorrow is our doubts of today.', 'Franklin D. Roosevelt'],
  ['Do not wait to strike till the iron is hot; but make it hot by striking.', 'W.B. Yeats'],
  ['Character cannot be developed in ease and quiet.', 'Helen Keller'],
  ['Hope is the thing with feathers that perches in the soul.', 'Emily Dickinson'],
  ['A winner is a dreamer who never gives up.', 'Nelson Mandela'],
  ['Start where you are. Use what you have. Do what you can.', 'Arthur Ashe'],
];
function dayOfYearIndex(len) {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const day = Math.floor((now - start) / 86400000);
  return day % len;
}

/* ---------- Verse of the Day (pure frontend) ---------- */
function renderVerseSection(section, body) {
  const [ref, text] = DAILY_VERSES[dayOfYearIndex(DAILY_VERSES.length)];
  body.innerHTML = `
    <figure class="verse-card">
      <blockquote>\u201C${escapeHtml(text)}\u201D</blockquote>
      <figcaption>— ${escapeHtml(ref)} <span class="muted">KJV</span></figcaption>
      <p class="muted verse-note">A new verse every morning.</p>
    </figure>`;
}

/* ---------- Checklist (items live in the section's D1 settings) ---------- */
function renderChecklistSection(section, body) {
  const s = section.settings || {};
  const items = (Array.isArray(s.items) ? s.items : [])
    .filter((i) => i && typeof i.text === 'string')
    .slice(0, 100)
    .map((i, n) => ({ id: String(i.id || `it-${n}-${Date.now()}`), text: i.text.slice(0, 200), done: !!i.done }));
  // Open items first; checked ones sink to the bottom.
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  body.innerHTML = `
    <div class="check-list">
      ${[...open, ...done].map((i) => `
        <div class="check-row${i.done ? ' is-done' : ''}">
          <button type="button" class="check-box" data-toggle="${escapeHtml(i.id)}" aria-label="${i.done ? 'Uncheck' : 'Check off'} ${escapeHtml(i.text)}">${i.done ? '✓' : ''}</button>
          <span class="check-text">${escapeHtml(i.text)}</span>
          <button type="button" class="check-del" data-del="${escapeHtml(i.id)}" aria-label="Remove ${escapeHtml(i.text)}">✕</button>
        </div>`).join('') || '<div class="empty">Nothing on the list yet — add your first item below.</div>'}
    </div>
    <form class="check-add">
      <input name="text" placeholder="Add an item…" maxlength="200" aria-label="New checklist item" required>
      <button type="submit">Add</button>
    </form>`;
  const persist = async (next) => {
    await saveSection(section.id, { settings: { items: next } });
    renderChecklistSection(getSection(section.id), body);
  };
  body.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.toggle;
    await persist(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  }));
  body.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.del;
    await persist(items.filter((i) => i.id !== id));
  }));
  $('.check-add', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    await persist([...items, { id: `it-${Date.now()}`, text, done: false }]);
  });
}

/* ---------- Radio stream player ---------- */
function renderRadioSection(section, body) {
  const s = section.settings || {};
  const name = (s.name || '').trim();
  const url = (s.streamUrl || '').trim();
  if (!url) {
    showEmpty(body, '📻', 'No station yet.', 'Tap Edit on this card to add a station name and stream URL.');
    return;
  }
  body.innerHTML = `
    <div class="radio-card">
      <button type="button" class="radio-bigplay" data-play aria-label="Play ${escapeHtml(name || 'station')}">▶</button>
      <div class="radio-meta">
        <strong>${escapeHtml(name || 'Radio')}</strong><br>
        <small class="muted" data-status>Tap play to listen</small>
      </div>
      <audio data-audio preload="none" src="${escapeHtml(url)}"></audio>
    </div>`;
  const audio = $('[data-audio]', body);
  const btn = $('[data-play]', body);
  const status = $('[data-status]', body);
  btn.addEventListener('click', async () => {
    try {
      if (audio.paused) { await audio.play(); btn.textContent = '⏸'; status.textContent = 'Playing…'; }
      else { audio.pause(); btn.textContent = '▶'; status.textContent = 'Paused'; }
    } catch { status.textContent = 'That stream wouldn\u2019t play — check the URL.'; }
  });
  audio.addEventListener('error', () => { btn.textContent = '▶'; status.textContent = 'That stream wouldn\u2019t play — check the URL.'; });
}

function buildRadioSettings(section, pane, body) {
  const s = section.settings || {};
  pane.innerHTML = `
    <form class="settings-form" id="radio-form">
      <label>Station name
        <input name="name" placeholder="e.g. K-LOVE, local station" value="${escapeHtml(s.name || '')}" required>
      </label>
      <label>Stream URL (https)
        <input name="streamUrl" type="url" inputmode="url" placeholder="https://…/stream.mp3" value="${escapeHtml(s.streamUrl || '')}" required>
      </label>
      <button type="submit">Save</button>
      <p class="muted">Use the station\u2019s direct stream address (often ends in .mp3 or /stream). Add the widget again for each station you want.</p>
    </form>`;
  $('#radio-form', pane).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const streamUrl = f.streamUrl.value.trim();
    if (!/^https:\/\//i.test(streamUrl)) { alert('The stream URL should start with https://'); return; }
    await saveSection(section.id, { settings: { name: f.name.value.trim(), streamUrl } });
    renderRadioSection(getSection(section.id), body);
  });
}

/* ---------- NOAA weather alerts (fetched server-side) ---------- */
function defaultAlertCoords() {
  // Prefer the Weather section's configured location; fall back to Lexington, KY.
  const wx = sections.find((x) => x.type === 'weather');
  const s = (wx && wx.settings) || {};
  const lat = Number(s.lat), lon = Number(s.lon);
  if (isFinite(lat) && isFinite(lon)) return { lat, lon, label: s.location || '' };
  return { lat: 38.04, lon: -84.50, label: 'Lexington, KY' };
}

async function renderAlertsSection(section, body) {
  const s = section.settings || {};
  const lat = isFinite(Number(s.lat)) ? Number(s.lat) : null;
  const lon = isFinite(Number(s.lon)) ? Number(s.lon) : null;
  if (lat == null || lon == null) {
    showEmpty(body, '🌤️', 'No location set.', 'Tap Edit on this card to set the location for alerts.');
    return;
  }
  showLoading(body, 2);
  const load = async () => {
    try {
      const res = await fetch(`/api/alerts?lat=${lat}&lon=${lon}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Alerts unavailable.');
      paintAlerts(body, data.alerts || []);
    } catch (err) {
      showError(body, err.message || 'Alerts are unavailable right now.', load);
    }
  };
  await load();
  // Alerts change slowly; refresh every 15 minutes while visible.
  const timer = setInterval(() => { if (body.isConnected) load(); else clearInterval(timer); }, 900000);
  liveTimers.push(timer);
}

function paintAlerts(body, alerts) {
  if (!alerts.length) {
    body.innerHTML = '<div class="alerts-calm"><span class="alerts-sun">🌤️</span><p><strong>All clear.</strong><br><small class="muted">No active weather alerts for your area.</small></p></div>';
    return;
  }
  body.innerHTML = `<div class="alert-list">${alerts.map((a) => {
    const exp = a.expires ? new Date(a.expires) : null;
    const expStr = exp && !isNaN(exp) ? exp.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    return `<div class="alert-item">
      <span class="alert-badge">${escapeHtml(a.severity || 'Alert')}</span>
      <div><strong>${escapeHtml(a.headline)}</strong>
      ${a.areas ? `<br><small class="muted">${escapeHtml(a.areas)}</small>` : ''}
      ${expStr ? `<br><small class="muted">Until ${escapeHtml(expStr)}</small>` : ''}</div>
    </div>`;
  }).join('')}</div>`;
}

function buildAlertsSettings(section, pane, body) {
  const s = section.settings || {};
  const d = defaultAlertCoords();
  const lat = s.lat !== undefined && s.lat !== '' ? s.lat : d.lat;
  const lon = s.lon !== undefined && s.lon !== '' ? s.lon : d.lon;
  pane.innerHTML = `
    <form class="settings-form" id="alerts-form">
      <label>Latitude
        <input name="lat" inputmode="decimal" placeholder="38.04" value="${escapeHtml(String(lat))}" required>
      </label>
      <label>Longitude
        <input name="lon" inputmode="decimal" placeholder="-84.50" value="${escapeHtml(String(lon))}" required>
      </label>
      <button type="submit">Save</button>
      <p class="muted">Prefilled from your Weather section${d.label ? ` (${escapeHtml(d.label)})` : ''}. Alerts come from the National Weather Service and refresh every 15 minutes.</p>
    </form>`;
  $('#alerts-form', pane).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const nlat = Number(f.lat.value), nlon = Number(f.lon.value);
    if (!isFinite(nlat) || !isFinite(nlon) || Math.abs(nlat) > 90 || Math.abs(nlon) > 180) {
      alert('Those coordinates don\u2019t look right — check the numbers.');
      return;
    }
    await saveSection(section.id, { settings: { lat: nlat, lon: nlon } });
    renderAlertsSection(getSection(section.id), body);
  });
}

/* ---------- Photos: crossfading slideshow ---------- */
function renderPhotosSection(section, body) {
  const s = section.settings || {};
  const urls = String(s.urls || '').split('\n').map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)).slice(0, 20);
  const seconds = Math.min(300, Math.max(5, Number(s.seconds) || 30));
  if (!urls.length) {
    showEmpty(body, '🖼️', 'No photos yet.', 'Tap Edit on this card to add image URLs, one per line.');
    return;
  }
  let idx = 0;
  let playing = true;
  body.innerHTML = `
    <div class="photo-frame" data-frame role="button" tabindex="0" aria-label="Photo slideshow — tap for next photo">
      ${urls.map((u, i) => `<img data-slide="${i}" src="${escapeHtml(u)}" alt="" loading="${i ? 'lazy' : 'eager'}" class="${i ? '' : 'is-active'}">`).join('')}
      <button type="button" class="photo-toggle" data-toggle aria-label="Pause slideshow">⏸</button>
      <span class="photo-count" data-count>1 / ${urls.length}</span>
    </div>`;
  const frame = $('[data-frame]', body);
  const slides = [...body.querySelectorAll('[data-slide]')];
  const toggle = $('[data-toggle]', body);
  const count = $('[data-count]', body);
  const show = (n) => {
    idx = (n + urls.length) % urls.length;
    slides.forEach((img, i) => img.classList.toggle('is-active', i === idx));
    count.textContent = `${idx + 1} / ${urls.length}`;
  };
  const advance = () => show(idx + 1);
  frame.addEventListener('click', (e) => {
    if (e.target === toggle) return; // handled below
    advance();
  });
  frame.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(); } });
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    playing = !playing;
    toggle.textContent = playing ? '⏸' : '▶';
    toggle.setAttribute('aria-label', playing ? 'Pause slideshow' : 'Resume slideshow');
  });
  const timer = setInterval(() => {
    if (!frame.isConnected) { clearInterval(timer); return; }
    if (playing && urls.length > 1) advance();
  }, seconds * 1000);
  liveTimers.push(timer);
}

function buildPhotosSettings(section, pane, body) {
  const s = section.settings || {};
  pane.innerHTML = `
    <form class="settings-form" id="photos-form">
      <label>Image URLs (one per line)
        <textarea name="urls" rows="5" placeholder="https://…/photo1.jpg&#10;https://…/photo2.jpg">${escapeHtml(s.urls || '')}</textarea>
      </label>
      <label>Change photo every
        <select name="seconds">
          ${[10, 15, 30, 60, 120].map((n) => `<option value="${n}" ${(Number(s.seconds) || 30) === n ? 'selected' : ''}>${n} seconds</option>`).join('')}
        </select>
      </label>
      <button type="submit">Save</button>
      <p class="muted">Link to pictures already online (from your Files share links, for example). Tap the photo to jump ahead; the corner button pauses.</p>
    </form>`;
  $('#photos-form', pane).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    await saveSection(section.id, { settings: { urls: f.urls.value, seconds: Number(f.seconds.value) || 30 } });
    renderPhotosSection(getSection(section.id), body);
  });
}

/* ---------- Tap-to-Call buttons ---------- */
function renderCallButtonsSection(section, body) {
  const s = section.settings || {};
  const rows = (Array.isArray(s.contacts) ? s.contacts : [])
    .filter((c) => c && (c.name || c.phone))
    .slice(0, 20)
    .map((c) => ({ name: String(c.name || '').slice(0, 60), phone: String(c.phone || '').slice(0, 30) }));
  if (!rows.length) {
    showEmpty(body, '📞', 'Nobody on speed-dial yet.', 'Tap Edit on this card to add the people you call most.');
    return;
  }
  body.innerHTML = `<div class="call-grid">${rows.map((c) => {
    const tel = c.phone.replace(/[^+\d]/g, '');
    return `<a class="call-btn" href="tel:${escapeHtml(tel)}">
      <span class="call-icon">📞</span>
      <span class="call-name">${escapeHtml(c.name || c.phone)}</span>
      ${c.name ? `<small class="muted">${escapeHtml(c.phone)}</small>` : ''}
    </a>`;
  }).join('')}</div>`;
}

function buildCallButtonsSettings(section, pane, body) {
  const s = section.settings || {};
  const rows = (Array.isArray(s.contacts) ? s.contacts : []).slice(0, 20);
  const draw = () => {
    pane.innerHTML = `
      <div class="settings-list">${rows.map((c, i) => `
        <div class="settings-row">
          <div><strong>${escapeHtml(c.name || c.phone || '—')}</strong><br><small>${escapeHtml(c.phone || '')}</small></div>
          <button type="button" data-rm="${i}" class="danger">Remove</button>
        </div>`).join('') || '<div class="empty">No contacts yet.</div>'}</div>
      <form class="settings-form" id="call-add-form" style="margin-top:14px">
        <div class="label">Add contact</div>
        <label>Name
          <input name="name" placeholder="e.g. Mom" maxlength="60">
        </label>
        <label>Phone number
          <input name="phone" type="tel" inputmode="tel" placeholder="(606) 555-0123" required>
        </label>
        <button type="submit">Add contact</button>
      </form>`;
    pane.querySelectorAll('[data-rm]').forEach((btn) => btn.addEventListener('click', async () => {
      rows.splice(Number(btn.dataset.rm), 1);
      await saveSection(section.id, { settings: { contacts: rows } });
      draw();
      renderCallButtonsSection(getSection(section.id), body);
    }));
    $('#call-add-form', pane).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const phone = f.phone.value.trim();
      if (!phone) return;
      rows.push({ name: f.name.value.trim(), phone });
      await saveSection(section.id, { settings: { contacts: rows } });
      draw();
      renderCallButtonsSection(getSection(section.id), body);
    });
  };
  draw();
}

/* ---------- Sports standings (fetched server-side) ---------- */
async function renderStandingsSection(section, body) {
  const league = ((section.settings || {}).league || 'nfl').toLowerCase();
  showLoading(body, 4);
  try {
    const res = await fetch(`/api/standings?league=${encodeURIComponent(league)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Standings unavailable.');
    paintStandings(body, data.rows || [], SCORE_LEAGUES[league] || league.toUpperCase());
  } catch (err) {
    showError(body, err.message || 'Standings are unavailable right now.', () => renderStandingsSection(section, body));
  }
}

function paintStandings(body, rows, leagueLabel) {
  if (!rows.length) {
    showEmpty(body, '🏟️', 'No standings right now.', 'Offseason? Standings appear automatically when the season starts.');
    return;
  }
  // Group rows by division/conference, preserving ESPN's order.
  const groups = [];
  for (const r of rows) {
    let g = groups.find((x) => x.name === r.group);
    if (!g) { g = { name: r.group, rows: [] }; groups.push(g); }
    g.rows.push(r);
  }
  body.innerHTML = `<div class="standings">${groups.map((g) => `
    ${g.name ? `<div class="standings-group">${escapeHtml(g.name)}</div>` : ''}
    <table class="standings-table">
      <thead><tr><th>Team</th><th>W</th><th>L</th>${g.rows.some((r) => r.t) ? '<th>T</th>' : ''}</tr></thead>
      <tbody>${g.rows.map((r) => `
        <tr><td><strong>${escapeHtml(r.abbr || r.team)}</strong> <span class="muted">${escapeHtml(r.abbr ? r.team : '')}</span></td>
        <td>${escapeHtml(r.w)}</td><td>${escapeHtml(r.l)}</td>${g.rows.some((x) => x.t) ? `<td>${escapeHtml(r.t)}</td>` : ''}</tr>`).join('')}
      </tbody>
    </table>`).join('')}
    <p class="muted" style="margin:8px 0 0">${escapeHtml(leagueLabel)} • updated every 30 minutes</p>
  </div>`;
}

function buildStandingsSettings(section, pane, body) {
  const league = ((section.settings || {}).league || 'nfl').toLowerCase();
  pane.innerHTML = `
    <form class="settings-form" id="standings-form">
      <label>League
        <select name="league">
          ${Object.entries(SCORE_LEAGUES).map(([v, l]) => `<option value="${v}" ${league === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </label>
      <button type="submit">Save</button>
      <p class="muted">Add the widget again for a second league — each card keeps its own league.</p>
    </form>`;
  $('#standings-form', pane).addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveSection(section.id, { settings: { league: e.target.league.value } });
    renderStandingsSection(getSection(section.id), body);
  });
}

/* ---------- Stocks (fetched server-side) ---------- */
async function renderStocksSection(section, body) {
  const s = section.settings || {};
  const symbols = String(s.symbols || '').trim();
  if (!symbols) {
    showEmpty(body, '📈', 'No tickers yet.', 'Tap Edit on this card to add symbols like AAPL, MSFT.');
    return;
  }
  showLoading(body, 3);
  const load = async () => {
    try {
      const res = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Quotes unavailable.');
      paintStocks(body, data);
    } catch (err) {
      showError(body, err.message || 'Quotes are unavailable right now.', load);
    }
  };
  await load();
  // Refresh every 5 minutes while visible.
  const timer = setInterval(() => { if (body.isConnected) load(); else clearInterval(timer); }, 300000);
  liveTimers.push(timer);
}

function paintStocks(body, data) {
  const quotes = data.quotes || [];
  const errors = data.errors || [];
  body.innerHTML = `
    <div class="stock-list">
      ${quotes.map((q) => {
        const up = q.changePct >= 0;
        return `<div class="stock-row">
          <strong>${escapeHtml(q.symbol)}</strong>
          <span class="stock-price">$${escapeHtml(String(q.price))}</span>
          <span class="stock-chg ${up ? 'is-up' : 'is-down'}">${up ? '▲' : '▼'} ${escapeHtml(String(Math.abs(q.changePct)))}%</span>
        </div>`;
      }).join('') || '<div class="empty">No quotes came back — check your symbols.</div>'}
    </div>
    ${errors.length ? `<p class="muted">Couldn\u2019t look up: ${escapeHtml(errors.join(', '))}</p>` : ''}`;
}

function buildStocksSettings(section, pane, body) {
  const s = section.settings || {};
  pane.innerHTML = `
    <form class="settings-form" id="stocks-form">
      <label>Symbols (comma-separated)
        <input name="symbols" placeholder="AAPL, MSFT, BRK.B" value="${escapeHtml(s.symbols || '')}" required>
      </label>
      <button type="submit">Save</button>
      <p class="muted">Up to 10 US tickers. Prices refresh every 5 minutes while the page is open.</p>
    </form>`;
  $('#stocks-form', pane).addEventListener('submit', async (e) => {
    e.preventDefault();
    const symbols = e.target.symbols.value.trim();
    if (!/^[A-Za-z0-9.,\s]{1,80}$/.test(symbols)) { alert('Use letters, numbers, dots, and commas only.'); return; }
    await saveSection(section.id, { settings: { symbols } });
    renderStocksSection(getSection(section.id), body);
  });
}

/* ---------- Month calendar (reads the My Day section's cached events) ---------- */
function myDayEvents() {
  const sec = sections.find((x) => x.type === 'myday');
  const de = sec && sec.settings && sec.settings.dayEvents;
  if (!de || typeof de !== 'object' || typeof de.date !== 'string') return { date: '', events: [] };
  const events = (Array.isArray(de.events) ? de.events : [])
    .filter((e) => e && e.title)
    .map((e) => ({ title: String(e.title).slice(0, 120), time: String(e.time || '').slice(0, 40) }));
  return { date: de.date, events };
}

function renderMonthCalSection(section, body) {
  const today = new Date();
  let viewY = today.getFullYear(), viewM = today.getMonth();
  let selected = null; // 'YYYY-MM-DD'
  const pad = (n) => String(n).padStart(2, '0');
  const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

  const draw = () => {
    const { date: evDate, events } = myDayEvents();
    const first = new Date(viewY, viewM, 1);
    const startDay = first.getDay();
    const daysIn = new Date(viewY, viewM + 1, 0).getDate();
    const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const todayKey = key(today.getFullYear(), today.getMonth(), today.getDate());
    let cells = '';
    for (let i = 0; i < startDay; i++) cells += '<span class="mcal-blank"></span>';
    for (let d = 1; d <= daysIn; d++) {
      const k = key(viewY, viewM, d);
      const cls = ['mcal-day'];
      if (k === todayKey) cls.push('is-today');
      if (k === evDate && events.length) cls.push('has-events');
      if (k === selected) cls.push('is-selected');
      cells += `<button type="button" class="${cls.join(' ')}" data-day="${k}">${d}${k === evDate && events.length ? '<span class="mcal-dot"></span>' : ''}</button>`;
    }
    const selEvents = selected === evDate ? events : [];
    const sp = selected.split('-').map(Number);
    const selLabel = new Date(sp[0], sp[1] - 1, sp[2])
      .toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    body.innerHTML = `
      <div class="mcal">
        <div class="mcal-head">
          <button type="button" data-nav="-1" aria-label="Previous month">‹</button>
          <strong>${escapeHtml(monthName)}</strong>
          <button type="button" data-nav="1" aria-label="Next month">›</button>
        </div>
        <div class="mcal-dow">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<span>${d}</span>`).join('')}</div>
        <div class="mcal-grid">${cells}</div>
        ${selected ? `<div class="mcal-events">
          <strong>${escapeHtml(selLabel)}</strong>
          ${selEvents.length ? `<ul>${selEvents.map((e) => `<li>${escapeHtml(e.time ? e.time + ' — ' : '')}${escapeHtml(e.title)}</li>`).join('')}</ul>`
            : '<p class="muted">No events saved for this day.</p>'}
        </div>` : ''}
      </div>`;
    body.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
      const n = new Date(viewY, viewM + Number(b.dataset.nav), 1);
      viewY = n.getFullYear(); viewM = n.getMonth();
      draw();
    }));
    body.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
      selected = selected === b.dataset.day ? null : b.dataset.day;
      draw();
    }));
  };
  draw();
}

/* ---------- Quote of the Day (pure frontend) ---------- */
function renderQuoteSection(section, body) {
  const [text, author] = DAILY_QUOTES[dayOfYearIndex(DAILY_QUOTES.length)];
  body.innerHTML = `
    <figure class="quote-card">
      <blockquote>\u201C${escapeHtml(text)}\u201D</blockquote>
      <figcaption>— ${escapeHtml(author)}</figcaption>
      <p class="muted verse-note">A new quote every morning.</p>
    </figure>`;
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
    rss: buildRssSettings,
    ytspotlight: buildSpotlightSettings,
    scores: buildScoresSettings,
    countdown: buildCountdownSettings,
    radio: buildRadioSettings,
    alerts: buildAlertsSettings,
    photos: buildPhotosSettings,
    callbuttons: buildCallButtonsSettings,
    standings: buildStandingsSettings,
    stocks: buildStocksSettings,
  };
  if (builders[section.type]) builders[section.type](section, pane, body);
  else pane.innerHTML = '<div class="empty">No settings for this section.</div>';
}

/* ---------- Add Section (searchable catalog with filter chips) ---------- */
let catalogQuery = '';
let catalogFilter = 'all'; // 'all' | 'hot' | a TYPE_GROUPS title

function catalogMatches(type, meta, q) {
  if (!q) return true;
  const hay = `${meta.label} ${meta.desc} ${meta.keywords || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function catalogChips() {
  const groups = TYPE_GROUPS.map((g) => g.title);
  const chips = [
    { id: 'all', label: 'All' },
    { id: 'hot', label: '🔥 Hot' },
    ...groups.map((t) => ({ id: t, label: t })),
  ];
  return `<div class="catalog-chips" role="group" aria-label="Filter widgets">${chips.map((c) => `
    <button type="button" class="catalog-chip${catalogFilter === c.id ? ' is-active' : ''}"
      data-chip="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`).join('')}</div>`;
}

function renderCatalog() {
  const picker = $('#type-picker');
  const refocus = !!(document.activeElement && document.activeElement.id === 'catalog-search');
  const q = catalogQuery.trim();
  let html = `
    <input id="catalog-search" class="catalog-search" type="search" placeholder="Search widgets…" value="${escapeHtml(catalogQuery)}" aria-label="Search widgets">
    ${catalogChips()}`;
  const groups = catalogFilter === 'hot'
    ? [{ title: '🔥 Hot right now', types: Object.keys(SECTION_TYPES).filter((t) => SECTION_TYPES[t].hot) }]
    : TYPE_GROUPS.filter((g) => catalogFilter === 'all' || g.title === catalogFilter);
  const anyVisible = groups.some((g) => g.types.some((t) => catalogMatches(t, SECTION_TYPES[t], q)));
  html += groups.map((group) => {
    const types = group.types.filter((t) => catalogMatches(t, SECTION_TYPES[t], q));
    if (!types.length) return '';
    return `
    <div class="type-group">
      <p class="type-group-title">${escapeHtml(group.title)}</p>
      <div class="type-picker">
        ${types.map((type) => {
          const meta = SECTION_TYPES[type];
          return `<button type="button" class="type-card" data-type="${escapeHtml(type)}">
            <strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(meta.desc)}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
  if (!anyVisible) html += '<div class="empty">No widgets match that search.</div>';
  picker.innerHTML = html;

  const search = $('#catalog-search', picker);
  search.addEventListener('input', () => { catalogQuery = search.value; renderCatalog(); });
  // Keep focus where the user is typing across re-renders — but don't steal
  // it (and pop the mobile keyboard) when the modal first opens.
  if (refocus) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }

  picker.querySelectorAll('[data-chip]').forEach((btn) => btn.addEventListener('click', () => {
    catalogFilter = btn.dataset.chip;
    renderCatalog();
  }));
  picker.querySelectorAll('[data-type]').forEach((btn) => btn.addEventListener('click', async () => {
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
}

function openAddModal() {
  catalogQuery = '';
  catalogFilter = 'all';
  renderCatalog();
  $('#add-modal').hidden = false;
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
  rss: renderRssSection,
  ytspotlight: renderSpotlightSection,
  scores: renderScoresSection,
  countdown: renderCountdownSection,
  verse: renderVerseSection,
  checklist: renderChecklistSection,
  radio: renderRadioSection,
  alerts: renderAlertsSection,
  photos: renderPhotosSection,
  callbuttons: renderCallButtonsSection,
  standings: renderStandingsSection,
  stocks: renderStocksSection,
  monthcal: renderMonthCalSection,
  quote: renderQuoteSection,
};

/* ---------- Masonry layout: small cards stack beside tall ones ----------
 * The dashboard grid uses a small row unit (12px) + dense flow; each card
 * is measured after render and spans as many rows as it needs. Re-runs
 * after content loads (MutationObserver), on resize, and after fonts. */
let masonryQueued = false;
function layoutMasonry() {
  masonryQueued = false;
  const dash = dashboardEl;
  if (!dash) return;
  const cards = dash.querySelectorAll('.section-card');
  if (!cards.length) return;
  const cs = getComputedStyle(dash);
  const rowH = parseFloat(cs.getPropertyValue('grid-auto-rows')) || 12;
  const gap = parseFloat(cs.getPropertyValue('row-gap')) || 0;
  cards.forEach((card) => {
    card.style.gridRowEnd = '';
    const h = card.offsetHeight;
    const span = Math.max(1, Math.ceil((h + gap) / (rowH + gap)));
    card.style.gridRowEnd = `span ${span}`;
  });
}
function scheduleMasonry() {
  if (masonryQueued) return;
  masonryQueued = true;
  requestAnimationFrame(() => setTimeout(layoutMasonry, 60));
}

/* ---------- Live section timers (scores refresh, countdown tick) ----------
 * Cleared on every render() so stale intervals never pile up. */
let liveTimers = [];
function clearLiveTimers() {
  liveTimers.forEach((t) => clearInterval(t));
  liveTimers = [];
}

function render() {
  closeCardMenu();
  if (myDayTimer) { clearInterval(myDayTimer); myDayTimer = 0; }
  clearLiveTimers();
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
  layoutMasonry();
}

/* ---------- Boot ---------- */
async function boot() {
  applyPrefs();
  renderGreeting();
  enableSectionDrag();
  renderBootSkeletons();

  // Masonry re-stacks whenever card content changes, images load, the
  // window resizes, or fonts arrive.
  const dashObserver = new MutationObserver(scheduleMasonry);
  dashObserver.observe(dashboardEl, { childList: true, subtree: true });
  dashboardEl.addEventListener('load', scheduleMasonry, true);
  window.addEventListener('resize', scheduleMasonry);
  window.addEventListener('load', scheduleMasonry);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleMasonry);

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
