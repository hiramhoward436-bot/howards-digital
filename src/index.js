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
]);

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
            return new Response(request.method === "HEAD" ? null : data, {
              headers: {
                "content-type": mime,
                "content-disposition": disposition,
                "content-length": String(data.byteLength),
                "cache-control": "public, max-age=31536000, immutable",
                "access-control-allow-origin": "*",
              },
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
  }[type] || "Section";
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
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}
