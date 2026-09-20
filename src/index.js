import { AwsClient } from "aws4fetch";

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

const text = (value) => String(value || "").replace(/[^a-zA-Z0-9._ -]/g, "_").trim();

function storageConfig(env) {
  return {
    // Gozunga's AWS-SDK example uses the S3 service endpoint on port 6780.
    endpoint: env.GOZUNGA_ENDPOINT || "https://cloud.fsd1.gozunga.com:6780",
    bucket: env.GOZUNGA_BUCKET || "",
    accessKeyId: env.GOZUNGA_ACCESS_KEY || "",
    secretAccessKey: env.GOZUNGA_SECRET_KEY || "",
    region: env.GOZUNGA_REGION || "SiouxFalls",
  };
}

function storageReady(env) {
  const s = storageConfig(env);
  return Boolean(s.bucket && s.accessKeyId && s.secretAccessKey);
}

async function storageRequest(env, method, key, body, headers = {}) {
  const s = storageConfig(env);
  if (!storageReady(env)) throw new Error("Gozunga storage credentials are not configured.");

  const url = `${s.endpoint}/${encodeURIComponent(s.bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const client = new AwsClient({
    accessKeyId: s.accessKeyId,
    secretAccessKey: s.secretAccessKey,
    service: "s3",
    region: s.region,
  });

  return client.fetch(url, { method, headers, body });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname === "/api/health") {
      const storage = storageConfig(env);
      return json({
        ok: true,
        app: env.APP_NAME || "Howard's Digital",
        version: env.APP_VERSION || "0.2.0",
        storage: {
          provider: env.STORAGE_PROVIDER || "Gozunga",
          configured: storageReady(env),
          endpoint: storage.endpoint,
          region: storage.region,
          database: Boolean(env.HD_DB),
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

    if (url.pathname === "/api/files" && request.method === "GET") {
      if (!env.HD_DB) return json({ files: [] }, 200, corsHeaders);
      const projectId = url.searchParams.get("project_id") || "project-hd";
      const result = await env.HD_DB.prepare(
        "SELECT file_id, project_id, folder_id, filename, size_bytes, content_type, version, created_at, updated_at FROM files WHERE project_id = ? ORDER BY updated_at DESC"
      ).bind(projectId).all();
      return json({ files: result.results || [] }, 200, corsHeaders);
    }

    if (url.pathname === "/api/upload" && request.method === "POST") {
      if (!storageReady(env)) return json({ ok: false, error: "Storage is not configured yet." }, 503, corsHeaders);
      if (!env.HD_DB) return json({ ok: false, error: "Database is not configured." }, 503, corsHeaders);

      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return json({ ok: false, error: "Choose a file first." }, 400, corsHeaders);

      const projectId = text(form.get("project_id") || "project-hd") || "project-hd";
      const fileId = crypto.randomUUID();
      const safeName = text(file.name) || "upload";
      const storageKey = `${projectId}/${fileId}/${safeName}`;

      const response = await storageRequest(env, "PUT", storageKey, file.stream(), {
        "content-type": file.type || "application/octet-stream",
        "content-length": String(file.size),
      });

      if (!response.ok) {
        const detail = await response.text();
        return json({ ok: false, error: `Storage upload failed (${response.status}).`, detail: detail.slice(0, 500) }, 502, corsHeaders);
      }

      await env.HD_DB.prepare(
        "INSERT INTO files (file_id, project_id, filename, size_bytes, content_type, storage_key) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(fileId, projectId, safeName, file.size, file.type || "application/octet-stream", storageKey).run();

      return json({
        ok: true,
        file: {
          file_id: fileId,
          project_id: projectId,
          filename: safeName,
          size_bytes: file.size,
          content_type: file.type || "application/octet-stream"
        }
      }, 201, corsHeaders);
    }

    if (url.pathname.startsWith("/api/files/") && request.method === "GET") {
      const fileId = url.pathname.split("/").pop();
      if (!env.HD_DB) return json({ ok: false, error: "Database is not configured." }, 503, corsHeaders);

      const row = await env.HD_DB.prepare(
        "SELECT filename, content_type, storage_key FROM files WHERE file_id = ?"
      ).bind(fileId).first();

      if (!row) return json({ ok: false, error: "File not found." }, 404, corsHeaders);

      const response = await storageRequest(env, "GET", row.storage_key);
      if (!response.ok) return json({ ok: false, error: "File could not be retrieved." }, 502, corsHeaders);

      const headers = new Headers(corsHeaders);
      headers.set("content-type", row.content_type || "application/octet-stream");
      headers.set("content-disposition", `attachment; filename="${row.filename.replace(/"/g, "")}"`);
      return new Response(response.body, { status: 200, headers });
    }

    return new Response(null, { status: 404, headers: corsHeaders });
  },
};
