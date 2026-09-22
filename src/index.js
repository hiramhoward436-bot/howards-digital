import { getStorage } from "./storage.js";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per file (D1 blob storage)
const MAX_SETTINGS_BYTES = 32 * 1024; // 32 KB per section settings object

const SECTION_TYPES = new Set([
  "greeting", "search", "weather", "sports", "youtube",
  "projects", "files", "links", "notes",
  "ai", "quicklinks", "myday",
  "rss", "ytspotlight", "scores", "countdown",
]);

// Tiny in-memory cache (per Worker isolate — plenty for a personal
// dashboard). Entries expire by TTL; the map is capped so it can't grow
// without bound.
const memCache = new Map();
function cacheGet(key, ttlMs) {
  const e = memCache.get(key);
  if (!e || Date.now() - e.t > ttlMs) { memCache.delete(key); return null; }
  return e.v;
}
function cacheSet(key, val) {
  memCache.set(key, { v: val, t: Date.now() });
  if (memCache.size > 200) memCache.delete(memCache.keys().next().value);
}

const FETCH_UA = "Howard's Digital dashboard (Cloudflare Worker)";

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseSettings(raw) {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function sectionRow(row) {
  const size = String(row.size || "M").toUpperCase();
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    enabled: row.enabled === 1,
    position: row.position,
    size: ["S", "M", "L"].includes(size) ? size : "M",
    settings: parseSettings(row.settings),
  };
}

function parseSize(value) {
  if (value === undefined) return null;
  const size = String(value).toUpperCase();
  return ["S", "M", "L"].includes(size) ? size : null;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        app: env.APP_NAME || "Howard's Digital",
        version: env.APP_VERSION || "0.1.0",
        storage: {
          r2: Boolean(env.HD_FILES),
          database: Boolean(env.HD_DB),
          fileUploads: Boolean(env.HD_DB), // D1 blob storage, no card needed
          fileBackend: "d1-blobs",
        },
      }, 200, corsHeaders);
    }

    if (url.pathname === "/api/projects" && request.method === "GET") {
      if (!env.HD_DB) return json({ projects: [] }, 200, corsHeaders);
      const result = await env.HD_DB.prepare(
        "SELECT project_id, name, description, status, created_at, updated_at FROM projects ORDER BY updated_at DESC"
      ).all();
      return json({ projects: result.results || [] }, 200, corsHeaders);
    }

    // ---- Dashboard sections ----

    if (url.pathname === "/api/sections" && request.method === "GET") {
      if (!env.HD_DB) return json({ sections: [], db: false }, 200, corsHeaders);
      const result = await env.HD_DB.prepare(
        "SELECT id, type, title, enabled, position, size, settings FROM sections ORDER BY position ASC, created_at ASC"
      ).all();
      return json({ sections: (result.results || []).map(sectionRow), db: true }, 200, corsHeaders);
    }

    if (url.pathname === "/api/sections" && request.method === "POST") {
      if (!env.HD_DB) return json({ error: "Database not connected." }, 503, corsHeaders);
      const body = await readJsonBody(request);
      if (!body || typeof body !== "object") return json({ error: "Invalid request." }, 400, corsHeaders);
      const type = String(body.type || "");
      if (!SECTION_TYPES.has(type)) return json({ error: "Unknown section type." }, 400, corsHeaders);
      const size = parseSize(body.size) || "M";
      const settingsStr = JSON.stringify(body.settings || {});
      if (settingsStr.length > MAX_SETTINGS_BYTES) {
        return json({ error: "Section settings are too large." }, 413, corsHeaders);
      }
      const id = `sec-${randomToken().slice(0, 12)}`;
      const title = String(body.title || defaultTitleFor(type));
      const now = new Date().toISOString();
      const posRow = await env.HD_DB.prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS nextPos FROM sections"
      ).first();
      await env.HD_DB.prepare(
        `INSERT INTO sections (id, type, title, enabled, position, size, settings, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`
      ).bind(id, type, title, posRow ? posRow.nextPos : 0, size, settingsStr, now, now).run();
      const row = await env.HD_DB.prepare(
        "SELECT id, type, title, enabled, position, size, settings FROM sections WHERE id = ?"
      ).bind(id).first();
      return json({ section: sectionRow(row) }, 201, corsHeaders);
    }

    // Reorder must be matched before the /:id route below.
    if (url.pathname === "/api/sections/reorder" && request.method === "PUT") {
      if (!env.HD_DB) return json({ error: "Database not connected." }, 503, corsHeaders);
      const body = await readJsonBody(request);
      if (!body || !Array.isArray(body.order)) {
        return json({ error: "Send { order: [sectionId, ...] }." }, 400, corsHeaders);
      }
      const stmts = body.order.map((id, i) =>
        env.HD_DB.prepare("UPDATE sections SET position = ?, updated_at = ? WHERE id = ?")
          .bind(i, new Date().toISOString(), String(id))
      );
      if (stmts.length) await env.HD_DB.batch(stmts);
      return json({ ok: true }, 200, corsHeaders);
    }

    const sectionMatch = url.pathname.match(/^\/api\/sections\/([A-Za-z0-9_-]+)$/);
    if (sectionMatch && (request.method === "PUT" || request.method === "DELETE")) {
      if (!env.HD_DB) return json({ error: "Database not connected." }, 503, corsHeaders);
      const id = sectionMatch[1];
      const existing = await env.HD_DB.prepare(
        "SELECT id, type FROM sections WHERE id = ?"
      ).bind(id).first();
      if (!existing) return json({ error: "Section not found." }, 404, corsHeaders);

      if (request.method === "DELETE") {
        await env.HD_DB.prepare("DELETE FROM sections WHERE id = ?").bind(id).run();
        return json({ ok: true }, 200, corsHeaders);
      }

      const body = await readJsonBody(request);
      if (!body || typeof body !== "object") return json({ error: "Invalid request." }, 400, corsHeaders);
      const updates = [];
      const binds = [];
      if (body.title !== undefined) { updates.push("title = ?"); binds.push(String(body.title).slice(0, 120)); }
      if (body.enabled !== undefined) { updates.push("enabled = ?"); binds.push(body.enabled ? 1 : 0); }
      if (body.size !== undefined) {
        const size = parseSize(body.size);
        if (!size) return json({ error: "Invalid size. Use S, M, or L." }, 400, corsHeaders);
        updates.push("size = ?"); binds.push(size);
      }
      if (body.settings !== undefined) {
        const settingsStr = JSON.stringify(body.settings || {});
        if (settingsStr.length > MAX_SETTINGS_BYTES) {
          return json({ error: "Section settings are too large." }, 413, corsHeaders);
        }
        updates.push("settings = ?");
        binds.push(settingsStr);
      }
      if (updates.length) {
        updates.push("updated_at = ?");
        binds.push(new Date().toISOString(), id);
        await env.HD_DB.prepare(`UPDATE sections SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
      }
      const row = await env.HD_DB.prepare(
        "SELECT id, type, title, enabled, position, size, settings FROM sections WHERE id = ?"
      ).bind(id).first();
      return json({ section: sectionRow(row) }, 200, corsHeaders);
    }

    // ---- "My Day" data: today's cached calendar events ----
    // Primary source: the My Day widget's own section settings
    // (settings.dayEvents = {date, events}), written by a scheduled job that
    // reads the user's paired iPhone calendar and PUTs to
    // /api/sections/sec-myday — no extra credentials needed. Falls back to
    // the day_cache table (older sync path). Empty = empty list = the widget
    // says "Nothing on the calendar today." Nothing here is ever invented.

    if (url.pathname === "/api/today" && request.method === "GET") {
      const today = new Date().toISOString().slice(0, 10);
      if (!env.HD_DB) return json({ date: today, events: [] }, 200, corsHeaders);
      let date = today;
      let events = [];
      let fromSettings = false;
      const sanitize = (list) =>
        (Array.isArray(list) ? list : [])
          .filter((e) => e && typeof e === "object")
          .map((e) => ({
            title: String(e.title || "").slice(0, 120),
            time: String(e.time || "").slice(0, 40),
          }))
          .filter((e) => e.title);
      try {
        const sec = await env.HD_DB.prepare(
          "SELECT settings FROM sections WHERE id = 'sec-myday'"
        ).first();
        if (sec && typeof sec.settings === "string") {
          const s = JSON.parse(sec.settings || "{}");
          if (s && typeof s === "object" && s.dayEvents && typeof s.dayEvents === "object") {
            fromSettings = true;
            if (typeof s.dayEvents.date === "string" && s.dayEvents.date) date = s.dayEvents.date;
            events = sanitize(s.dayEvents.events);
          }
        }
      } catch { /* fall through to day_cache */ }
      if (!fromSettings) {
        try {
          const row = await env.HD_DB.prepare(
            "SELECT date, events FROM day_cache WHERE id = 1"
          ).first();
          if (row) {
            if (typeof row.date === "string" && row.date) date = row.date;
            try {
              events = sanitize(JSON.parse(row.events || "[]"));
            } catch { /* malformed cache: treat as empty */ }
          }
        } catch {
          // Table missing on older DBs: return the honest empty state.
          events = [];
        }
      }
      return json({ date, events }, 200, corsHeaders);
    }

    // ---- YouTube channel RSS proxy (no API key needed) ----
    // Fetches a channel's public RSS feed server-side and returns the latest
    // videos as JSON. Used by the YouTube dashboard section.

    if (url.pathname === "/api/youtube/rss" && request.method === "GET") {
      const channelId = (url.searchParams.get("channel_id") || "").trim();
      if (!/^UC[A-Za-z0-9_-]{20,}$/.test(channelId)) {
        return json({ error: "Invalid channel ID. It should start with 'UC'." }, 400, corsHeaders);
      }
      try {
        const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
        const resp = await fetch(feedUrl, {
          headers: { "user-agent": "Howard's Digital dashboard (Cloudflare Worker)" },
        });
        if (!resp.ok) throw new Error(`feed HTTP ${resp.status}`);
        const xml = await resp.text();
        return json(parseYouTubeFeed(xml, channelId), 200, corsHeaders);
      } catch (e) {
        return json({ error: "Could not load that channel's videos right now." }, 502, corsHeaders);
      }
    }

    // ---- RSS / Atom feed proxy (no API key needed) ----
    // Fetches any public feed server-side (the browser can't — CORS) and
    // returns slim JSON. Used by the RSS dashboard section.

    if (url.pathname === "/api/rss" && request.method === "GET") {
      const feedUrl = (url.searchParams.get("url") || "").trim();
      if (!/^https?:\/\//i.test(feedUrl) || feedUrl.length > 500) {
        return json({ error: "That doesn't look like a feed URL — it should start with http:// or https://" }, 400, corsHeaders);
      }
      const key = "rss:" + feedUrl;
      const hit = cacheGet(key, 15 * 60 * 1000);
      if (hit) return json(hit, 200, corsHeaders);
      try {
        const resp = await fetch(feedUrl, {
          headers: {
            "user-agent": FETCH_UA,
            "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml",
          },
        });
        if (!resp.ok) throw new Error(`feed HTTP ${resp.status}`);
        const xml = await resp.text();
        if (xml.length > 2_000_000) throw new Error("feed too large");
        const data = parseGenericFeed(xml);
        if (!data.items.length) throw new Error("no items found");
        cacheSet(key, data);
        return json(data, 200, corsHeaders);
      } catch (e) {
        return json({ error: "Couldn't fetch that feed. Check the URL — it must be a public RSS or Atom feed." }, 502, corsHeaders);
      }
    }

    // ---- YouTube spotlight: latest video from a channel ----
    // Accepts a channel ID (UC…), a channel URL, an @handle, /c/ or /user/
    // name. Handles are resolved server-side by reading the channel page.
    // Uses YouTube's free per-channel RSS — no API key.

    if (url.pathname === "/api/yt-latest" && request.method === "GET") {
      const input = (url.searchParams.get("channel") || "").trim();
      if (!input) {
        return json({ error: "Send ?channel= with a channel ID, @handle, or channel URL." }, 400, corsHeaders);
      }
      try {
        const channelId = await resolveYouTubeChannelId(input);
        if (!channelId) throw new Error("resolve failed");
        const key = "ytlatest:" + channelId;
        const hit = cacheGet(key, 15 * 60 * 1000);
        if (hit) return json(hit, 200, corsHeaders);
        const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
        const resp = await fetch(feedUrl, { headers: { "user-agent": FETCH_UA } });
        if (!resp.ok) throw new Error(`feed HTTP ${resp.status}`);
        const parsed = parseYouTubeFeed(await resp.text(), channelId);
        const v = parsed.videos[0];
        if (!v) throw new Error("no videos");
        const out = {
          channelId,
          channelTitle: parsed.channelTitle,
          videoId: v.videoId,
          title: v.title,
          published: v.published,
          url: v.url,
        };
        cacheSet(key, out);
        return json(out, 200, corsHeaders);
      } catch (e) {
        return json({ error: "Couldn't find that YouTube channel. Try the channel ID (starts with UC) or a full channel URL." }, 502, corsHeaders);
      }
    }

    // ---- Live scores (ESPN's free scoreboard API — no key needed) ----
    // Slimmed server-side; cached 2 minutes. Status is one of
    // live / final / scheduled.

    if (url.pathname === "/api/scores" && request.method === "GET") {
      const league = (url.searchParams.get("league") || "nfl").toLowerCase();
      const sportPath = ESPN_PATHS[league];
      if (!sportPath) {
        return json({ error: "Unknown league. Use nfl, mlb, nba, or nhl." }, 400, corsHeaders);
      }
      const key = "scores:" + league;
      const hit = cacheGet(key, 2 * 60 * 1000);
      if (hit) return json(hit, 200, corsHeaders);
      try {
        const resp = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard`,
          { headers: { "user-agent": FETCH_UA } }
        );
        if (!resp.ok) throw new Error(`espn HTTP ${resp.status}`);
        const data = await resp.json();
        const games = (data.events || []).map((ev) => {
          const comp = (ev.competitions || [])[0] || {};
          const teams = comp.competitors || [];
          const home = teams.find((t) => t.homeAway === "home") || {};
          const away = teams.find((t) => t.homeAway === "away") || {};
          const st = ev.status || {};
          const state = st.type ? st.type.state : "";
          return {
            home: espnTeamName(home),
            away: espnTeamName(away),
            homeAbbr: espnTeamAbbr(home),
            awayAbbr: espnTeamAbbr(away),
            homeScore: home.score != null ? String(home.score) : "",
            awayScore: away.score != null ? String(away.score) : "",
            status: state === "in" ? "live" : state === "post" ? "final" : "scheduled",
            clock: st.displayClock || "",
            period: st.period ? String(st.period) : "",
            date: ev.date || "",
          };
        });
        const out = { league, games };
        cacheSet(key, out);
        return json(out, 200, corsHeaders);
      } catch (e) {
        return json({ error: "Scores are unavailable right now." }, 502, corsHeaders);
      }
    }

    // ---- File uploads (stored as blobs via the storage backend) ----

    if (url.pathname === "/api/files" && request.method === "POST") {
      if (!env.HD_DB) return json({ error: "Database not connected." }, 503, corsHeaders);
      let file = null;
      try {
        const form = await request.formData();
        const entry = form.get("file");
        if (entry && typeof entry !== "string") file = entry;
      } catch {
        return json({ error: "Could not read the upload." }, 400, corsHeaders);
      }
      if (!file) return json({ error: "No file was uploaded." }, 400, corsHeaders);
      if (file.size === 0) return json({ error: "That file is empty." }, 400, corsHeaders);
      if (file.size > MAX_UPLOAD_BYTES) {
        return json({ error: "That file is over the 10 MB limit." }, 413, corsHeaders);
      }
      const fileId = crypto.randomUUID();
      const token = randomToken();
      const now = new Date().toISOString();
      const bytes = await file.arrayBuffer();
      await env.HD_DB.prepare(
        `INSERT INTO files (file_id, project_id, filename, size_bytes, content_type, storage_key, share_token, created_at, updated_at)
         VALUES (?, 'project-hd', ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        fileId,
        file.name || "upload",
        file.size,
        file.type || "application/octet-stream",
        `d1:${fileId}`,
        token,
        now,
        now
      ).run();
      // Metadata row first: file_contents.file_id references files(file_id).
      await getStorage(env).put(fileId, bytes);
      // Share URL carries the original filename: AI readers (ChatGPT, Grok)
      // key off the filename in the URL to recognize the file type.
      // The /f/:token route ignores everything after the token, so old
      // bare-token links keep working.
      return json({
        id: fileId,
        filename: file.name || "upload",
        size: file.size,
        type: file.type || "application/octet-stream",
        url: `${url.origin}/f/${token}/${encodeURIComponent(file.name || "upload")}`,
      }, 201, corsHeaders);
    }

    if (url.pathname === "/api/files" && request.method === "GET") {
      if (!env.HD_DB) return json({ files: [] }, 200, corsHeaders);
      const result = await env.HD_DB.prepare(
        `SELECT file_id, filename, size_bytes, content_type, share_token, created_at
         FROM files ORDER BY created_at DESC LIMIT 100`
      ).all();
      const files = (result.results || []).map((f) => ({
        id: f.file_id,
        filename: f.filename,
        size: f.size_bytes,
        type: f.content_type,
        created_at: f.created_at,
        url: f.share_token ? `${url.origin}/f/${f.share_token}/${encodeURIComponent(f.filename || "file")}` : null,
      }));
      return json({ files }, 200, corsHeaders);
    }

    const deleteMatch = url.pathname.match(/^\/api\/files\/([A-Za-z0-9-]+)$/);
    if (deleteMatch && request.method === "DELETE") {
      if (!env.HD_DB) return json({ error: "Database not connected." }, 503, corsHeaders);
      const fileId = deleteMatch[1];
      await getStorage(env).delete(fileId);
      await env.HD_DB.prepare("DELETE FROM files WHERE file_id = ?").bind(fileId).run();
      return json({ ok: true }, 200, corsHeaders);
    }

    // Public share link: /f/:token (GET and HEAD — AI fetchers often
    // probe with HEAD first; add CORS so other AIs can fetch directly)
    if (url.pathname.startsWith("/f/") && (request.method === "GET" || request.method === "HEAD")) {
      const token = url.pathname.slice(3).split("/")[0];
      if (env.HD_DB && token) {
        const row = await env.HD_DB.prepare(
          "SELECT file_id, filename, content_type FROM files WHERE share_token = ?"
        ).bind(token).first();
        if (row) {
          const data = await getStorage(env).get(row.file_id);
          if (data) {
            const filename = row.filename || "file";
            const mime = row.content_type || "application/octet-stream";
            // Previewable types open in the browser; everything else
            // downloads as an attachment with the original filename.
            const previewable =
              /^(image|text|audio|video)\//.test(mime) || mime === "application/pdf";
            const asciiName = filename.replace(/["\\]/g, "_");
            const disposition = previewable
              ? `inline; filename*=UTF-8''${encodeURIComponent(filename)}`
              : `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
            const total = data.byteLength;
            const fileHeaders = {
              "content-type": mime,
              "content-disposition": disposition,
              "cache-control": "public, max-age=31536000, immutable",
              "access-control-allow-origin": "*",
              "accept-ranges": "bytes",
            };
            // Honor byte-range requests like a plain file host: some
            // fetchers resume or probe with Range.
            if (request.method === "GET") {
              const rm = /^bytes=(\d*)-(\d*)$/.exec(
                (request.headers.get("range") || "").trim()
              );
              if (rm && (rm[1] !== "" || rm[2] !== "")) {
                let start, end;
                if (rm[1] === "") {
                  // Suffix range: last N bytes.
                  start = Math.max(0, total - parseInt(rm[2], 10));
                  end = total - 1;
                } else {
                  start = parseInt(rm[1], 10);
                  end = rm[2] === "" ? total - 1 : parseInt(rm[2], 10);
                }
                if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= total) {
                  return new Response("Range not satisfiable", {
                    status: 416,
                    headers: { ...fileHeaders, "content-range": `bytes */${total}` },
                  });
                }
                end = Math.min(end, total - 1);
                const slice = data.slice(start, end + 1);
                return new Response(slice, {
                  status: 206,
                  headers: {
                    ...fileHeaders,
                    "content-range": `bytes ${start}-${end}/${total}`,
                    "content-length": String(slice.byteLength),
                  },
                });
              }
            }
            return new Response(request.method === "HEAD" ? null : data, {
              headers: { ...fileHeaders, "content-length": String(total) },
            });
          }
        }
      }
      return new Response("Not found", { status: 404 });
    }

    return new Response(null, { status: 404, headers: corsHeaders });
  },
};

function defaultTitleFor(type) {
  return {
    greeting: "Welcome", search: "Search", weather: "Weather",
    sports: "My Teams", youtube: "YouTube", projects: "Projects",
    files: "Files", links: "Links", notes: "Notes",
    ai: "AI", quicklinks: "Quick Links", myday: "My Day",
    rss: "Feed", ytspotlight: "Spotlight", scores: "Scores",
    countdown: "Countdown",
  }[type] || "Section";
}

const ESPN_PATHS = {
  nfl: "football/nfl",
  mlb: "baseball/mlb",
  nba: "basketball/nba",
  nhl: "hockey/nhl",
};

function espnTeamName(c) {
  const t = c.team || {};
  return t.shortDisplayName || t.displayName || t.abbreviation || "Team";
}
function espnTeamAbbr(c) {
  return ((c.team || {}).abbreviation || "").toString();
}

// Best-effort channel ID resolution: raw UC… IDs (or ones embedded in a
// URL) pass straight through; @handles, /c/ names and /user/ names are
// resolved by reading the channel page's embedded JSON.
async function resolveYouTubeChannelId(input) {
  const direct = input.match(/UC[A-Za-z0-9_-]{22}/);
  if (direct) return direct[0];
  let path = input.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch { return null; }
  } else if (!path.startsWith("/") && !path.startsWith("@")) {
    path = "/@" + path;
  }
  if (!path.startsWith("/")) path = "/" + path;
  try {
    const resp = await fetch(`https://www.youtube.com${path}`, {
      headers: {
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    // Desktop pages embed "channelId":"UC…"; mobile pages use
    // "browseId":"UC…" or channel_id=UC….
    const patterns = [
      /"channelId":"(UC[A-Za-z0-9_-]{22})"/,
      /"browseId":"(UC[A-Za-z0-9_-]{22})"/,
      /channel_id=(UC[A-Za-z0-9_-]{22})/,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

// Minimal generic feed parsing: handles RSS 2.0 (<item>) and Atom
// (<entry>). Returns { title, items: [{title, link, pubDate}] }.
function parseGenericFeed(xml) {
  const isAtom = /<feed[\s>]/.test(xml);
  const items = [];
  const pick = (src, re, idx = 1) => {
    const m = src.match(re);
    return m ? decodeXml(m[idx] || "").trim() : "";
  };
  if (isAtom) {
    const feedTitle = pick(xml, /<feed[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/);
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    let m;
    while ((m = entryRe.exec(xml)) !== null && items.length < 20) {
      const e = m[1];
      const alt = e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"[^>]*>/);
      const any = e.match(/<link[^>]*href="([^"]+)"[^>]*>/);
      items.push({
        title: stripTags(pick(e, /<title[^>]*>([\s\S]*?)<\/title>/)) || "Untitled",
        link: decodeXml((alt && alt[1]) || (any && any[1]) || pick(e, /<link>([^<]+)<\/link>/)).trim(),
        pubDate: pick(e, /<(published|updated)>([^<]+)<\/\1>/, 2),
      });
    }
    return { title: stripTags(feedTitle), items };
  }
  const chM = xml.match(/<channel>([\s\S]*?)<\/channel>/);
  const channel = chM ? chM[1] : xml;
  const feedTitle = pick(channel, /<title[^>]*>([\s\S]*?)<\/title>/);
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 20) {
    const e = m[1];
    const hrefM = e.match(/<link[^>]*href="([^"]+)"/);
    items.push({
      title: stripTags(pick(e, /<title[^>]*>([\s\S]*?)<\/title>/)) || "Untitled",
      link: (hrefM ? decodeXml(hrefM[1]) : pick(e, /<link>([^<]+)<\/link>/)).trim(),
      pubDate: pick(e, /<pubDate>([^<]+)<\/pubDate>/) || pick(e, /<dc:date>([^<]+)<\/dc:date>/),
    });
  }
  return { title: stripTags(feedTitle), items };
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "").trim();
}

// Minimal XML parsing for a YouTube channel RSS feed. Pulls the fields the
// dashboard needs: video id, title, publish date, thumbnail, and watch URL.
function parseYouTubeFeed(xml, channelId) {
  const videos = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null && videos.length < 12) {
    const entry = m[1];
    const pick = (re) => {
      const hit = entry.match(re);
      return hit ? decodeXml(hit[1]) : "";
    };
    const videoId = pick(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!videoId) continue;
    videos.push({
      videoId,
      title: pick(/<title>([\s\S]*?)<\/title>/) || "Untitled video",
      published: pick(/<published>([^<]+)<\/published>/),
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }
  const channelTitle = (xml.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
  return {
    channelId,
    channelTitle: channelTitle ? decodeXml(channelTitle) : channelId,
    videos,
  };
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : _; })
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
