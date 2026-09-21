/* Howard's Digital — customizable dashboard.
 * The dashboard shell loads first; each section card fetches its own live
 * data independently. Layout, titles, visibility, order, and per-section
 * settings persist in D1 via /api/sections. No fake data: if a service is
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

/* ---------- Section types ---------- */
const SECTION_TYPES = {
  greeting: { label: 'Greeting', desc: 'A welcome banner with the time of day.' },
  search:   { label: 'Search', desc: 'A Google search bar.' },
  weather:  { label: 'Weather', desc: 'Current conditions. Tap for a 5-day forecast.' },
  sports:   { label: 'Sports', desc: 'Follow your teams — scores and schedules.' },
  youtube:  { label: 'YouTube', desc: 'Latest videos from channels you add.' },
  projects: { label: 'Projects', desc: 'Your HD project workspace.' },
  files:    { label: 'Files', desc: 'Upload files and share them with a link.' },
  links:    { label: 'Links', desc: 'Your own list of favorite links.' },
  notes:    { label: 'Notes', desc: 'Quick notes, saved automatically on HD.' },
  chatgpt:  { label: 'ChatGPT', desc: 'Ask anything — opens the real ChatGPT.' },
  claude:   { label: 'Claude', desc: 'Open Claude in a new tab.' },
  grok:     { label: 'Grok', desc: 'Open Grok in a new tab.' },
  quicklaunch: { label: 'Quick Launch', desc: 'A compact row of shortcuts near the top.' },
};
const TYPES_WITH_SETTINGS = new Set(['weather', 'sports', 'youtube', 'links', 'notes']);

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

async function saveSection(id, patch) {
  const data = await api(`/api/sections/${encodeURIComponent(id)}`, 'PUT', patch);
  const i = sections.findIndex(s => s.id === id);
  if (i >= 0) sections[i] = data.section;
  return data.section;
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

/* ---------- Card shell ---------- */
function cardShell(section) {
  const card = document.createElement('article');
  card.className = `card section-card section-${escapeHtml(section.type)}`;
  card.dataset.sectionId = section.id;

  const head = document.createElement('div');
  head.className = 'card-head';
  head.innerHTML = `
    <div class="card-title"><span class="label">${escapeHtml(SECTION_TYPES[section.type]?.label || section.type)}</span>
    <h2>${escapeHtml(section.title)}</h2></div>
    <div class="card-controls" role="toolbar" aria-label="Section controls">
      <button type="button" data-act="up" title="Move up" aria-label="Move section up">▲</button>
      <button type="button" data-act="down" title="Move down" aria-label="Move section down">▼</button>
      ${TYPES_WITH_SETTINGS.has(section.type) ? '<button type="button" data-act="settings" title="Settings" aria-label="Section settings">⚙</button>' : ''}
      <button type="button" data-act="rename" title="Rename" aria-label="Rename section">✏️</button>
      <button type="button" data-act="hide" title="Hide" aria-label="Hide section">👁</button>
      <button type="button" data-act="remove" title="Remove" aria-label="Remove section" class="danger">✕</button>
    </div>`;

  const body = document.createElement('div');
  body.className = 'card-body';

  const settingsPane = document.createElement('div');
  settingsPane.className = 'settings-pane';
  settingsPane.hidden = true;

  card.append(head, settingsPane, body);
  head.querySelector('.card-controls').addEventListener('click', (e) => onCardControl(e, section, settingsPane, body));
  return { card, body, settingsPane };
}

async function onCardControl(event, section, settingsPane, body) {
  const btn = event.target.closest('[data-act]');
  if (!btn) return;
  event.stopPropagation();
  const act = btn.dataset.act;
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
    } else if (act === 'settings') {
      settingsPane.hidden = !settingsPane.hidden;
      if (!settingsPane.hidden && !settingsPane.dataset.built) {
        settingsPane.dataset.built = '1';
        buildSettingsPane(section, settingsPane, body);
      }
    }
  } catch (err) {
    alert(err.message);
  }
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
  body.innerHTML = '<div class="empty">Loading projects…</div>';
  try {
    const data = await api('/api/projects');
    const projects = data.projects || [];
    body.innerHTML = projects.length ? `
      <div class="project-list">${projects.map(p => `
        <div class="project">
          <div><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.description || 'No description')}</small></div>
          <small>${escapeHtml(p.status)}</small>
        </div>`).join('')}</div>` : '<div class="empty">No projects yet.</div>';
  } catch {
    body.innerHTML = '<div class="empty">Projects are unavailable right now.</div>';
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
  body.innerHTML = '<div class="empty">Loading weather…</div>';
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
    const data = await (await fetch(weatherUrl(lat, lon))).json();
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
    body.innerHTML = '<div class="empty">Weather is temporarily unavailable.</div>';
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
    body.innerHTML = '<div class="empty">No teams yet — tap ⚙ to follow a team.</div>';
    return;
  }
  body.innerHTML = '<div class="empty">Loading scores…</div>';
  const blocks = await Promise.all(teams.map(async (t, i) => {
    try {
      const info = await espnTeamInfo(t.sport, t.teamId);
      const next = info.next;
      return { i, t, info, ok: true };
    } catch {
      return { i, t, ok: false };
    }
  }));
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
    body.innerHTML = `<div class="empty">No channels yet — tap ⚙ to add one.<br>
      <small class="muted">YouTube sign-in is coming later; for now add channels by URL or channel ID.</small></div>`;
    return;
  }
  body.innerHTML = '<div class="empty">Loading videos…</div>';
  const results = await Promise.all(channels.map(async (ch) => {
    try {
      const d = await (await fetch(`/api/youtube/rss?channel_id=${encodeURIComponent(ch.channelId)}`)).json();
      if (d.error) throw new Error(d.error);
      return { ch, ok: true, title: d.channelTitle, videos: d.videos || [] };
    } catch {
      return { ch, ok: false };
    }
  }));
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
    <div class="file-list"><div class="empty">Loading files…</div></div>`;

  const form = $('form', body);
  const input = $('input[type=file]', body);
  const status = $('.upload-status', body);
  const list = $('.file-list', body);

  async function loadFiles() {
    try {
      const data = await api('/api/files');
      const files = data.files || [];
      list.innerHTML = files.length ? files.map(f => `
        <div class="file-row">
          <div><strong>${escapeHtml(f.filename)}</strong><br><small>${fmtSize(f.size)} • ${escapeHtml(new Date(f.created_at).toLocaleDateString())}</small></div>
          <div class="file-actions">
            ${f.url ? `<a class="file-open" href="${escapeHtml(f.url)}" target="_blank" rel="noopener">Open</a>` : ''}
            ${f.url ? `<button type="button" data-copy="${escapeHtml(f.url)}">Copy link</button>` : ''}
            <button type="button" data-del="${escapeHtml(f.id)}" class="danger">Delete</button>
          </div>
        </div>`).join('') : '<div class="empty">No files yet.</div>';
    } catch {
      list.innerHTML = '<div class="empty">Files are unavailable right now.</div>';
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
  body.innerHTML = links.length ? `
    <div class="link-list">${links.map(l => `
      <a class="listen-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">
        <strong>${escapeHtml(l.title)}</strong><span>${escapeHtml(l.subtitle || '')}</span>
      </a>`).join('')}</div>`
    : '<div class="empty">No links yet — tap ⚙ to add some.</div>';
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

/* ---------- AI launchers + Quick Launch (real services, no fake AI) ---------- */
const AI_SITES = {
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com', cta: 'Ask anything.' },
  claude:  { name: 'Claude',  url: 'https://claude.ai',   cta: 'Start a conversation.' },
  grok:    { name: 'Grok',    url: 'https://grok.com',     cta: 'Ask Grok anything.' },
};

function renderAiLauncher(body, type) {
  const site = AI_SITES[type];
  if (!site) { body.innerHTML = '<div class="empty">This launcher is unavailable.</div>'; return; }
  body.innerHTML = `
    <div class="ai-launcher">
      <p class="ai-cta">${escapeHtml(site.cta)}</p>
      <a class="ai-open" href="${site.url}" target="_blank" rel="noopener">Open ${escapeHtml(site.name)} ↗</a>
      <p class="muted">Opens the real ${escapeHtml(site.name)} in a new tab — your own account, nothing faked.</p>
    </div>`;
}

function renderQuickLaunch(body) {
  const cards = [...dashboardEl.querySelectorAll('.section-card')];
  const cardForType = (t) => cards.find(c => c.classList.contains(`section-${t}`));
  const scrollInto = (card) => { if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  // Chase: prefer a section whose title mentions Chase (e.g. "Chase Adventures");
  // otherwise fall back to the Projects card; omit the button if neither exists.
  const chaseCard = cards.find(c => /chase/i.test(c.querySelector('.card-title h2')?.textContent || ''));
  const items = [
    { label: 'ChatGPT', href: AI_SITES.chatgpt.url, external: true },
    { label: 'Claude', href: AI_SITES.claude.url, external: true },
    { label: 'Grok', href: AI_SITES.grok.url, external: true },
  ];
  if (cardForType('files')) items.push({ label: 'Files', action: () => scrollInto(cardForType('files')) });
  if (chaseCard || cardForType('projects')) {
    items.push({ label: 'Chase', action: () => scrollInto(chaseCard || cardForType('projects')) });
  }
  if (cardForType('youtube')) items.push({ label: 'YouTube', action: () => scrollInto(cardForType('youtube')) });

  body.innerHTML = `<div class="quick-launch">${items.map((it, i) =>
    it.external
      ? `<a class="ql-btn" href="${it.href}" target="_blank" rel="noopener">${escapeHtml(it.label)}</a>`
      : `<button type="button" class="ql-btn" data-ql="${i}">${escapeHtml(it.label)}</button>`
  ).join('')}</div>`;
  body.querySelectorAll('[data-ql]').forEach(btn =>
    btn.addEventListener('click', () => items[Number(btn.dataset.ql)].action()));
}

/* ---------- Settings dispatcher ---------- */
function buildSettingsPane(section, pane, body) {
  const builders = {
    weather: buildWeatherSettings,
    sports: buildSportsSettings,
    youtube: buildYouTubeSettings,
    links: buildLinksSettings,
  };
  if (builders[section.type]) builders[section.type](section, pane, body);
  else pane.innerHTML = '<div class="empty">No settings for this section.</div>';
}

/* ---------- Add Section modal ---------- */
function openAddModal() {
  const modal = $('#add-modal');
  const picker = $('#type-picker');
  picker.innerHTML = Object.entries(SECTION_TYPES).map(([type, meta]) => `
    <button type="button" class="type-card" data-type="${escapeHtml(type)}">
      <strong>${escapeHtml(meta.label)}</strong><span>${escapeHtml(meta.desc)}</span>
    </button>`).join('');
  picker.querySelectorAll('[data-type]').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const data = await api('/api/sections', 'POST', { type: btn.dataset.type });
      sections.push(data.section);
      closeAddModal();
      render();
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
    }
  }));
  modal.hidden = false;
}
function closeAddModal() { $('#add-modal').hidden = true; }

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
  chatgpt: (s, b) => renderAiLauncher(b, 'chatgpt'),
  claude: (s, b) => renderAiLauncher(b, 'claude'),
  grok: (s, b) => renderAiLauncher(b, 'grok'),
  quicklaunch: (s, b) => renderQuickLaunch(b),
};

function render() {
  renderGreeting();
  dashboardEl.innerHTML = '';
  const vis = visibleSections();
  if (!vis.length) {
    dashboardEl.innerHTML = '<div class="empty">Your dashboard is empty — tap ＋ Add Section to build it.</div>';
  }
  for (const section of vis) {
    const { card, body, settingsPane } = cardShell(section);
    dashboardEl.appendChild(card);
    try {
      RENDERERS[section.type](section, body);
    } catch {
      body.innerHTML = '<div class="empty">This section had trouble loading.</div>';
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
  renderGreeting();
  $('#add-section-btn').addEventListener('click', openAddModal);
  $('#add-modal-close').addEventListener('click', closeAddModal);
  $('#add-modal').addEventListener('click', (e) => { if (e.target.id === 'add-modal') closeAddModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAddModal(); });

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
