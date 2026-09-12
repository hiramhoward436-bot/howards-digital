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
        storage: { r2: Boolean(env.HD_FILES), database: Boolean(env.HD_DB) },
      }, 200, corsHeaders);
    }

    if (url.pathname === "/api/projects" && request.method === "GET") {
      if (!env.HD_DB) return json({ projects: [] }, 200, corsHeaders);
      const result = await env.HD_DB.prepare(
        "SELECT project_id, name, description, status, created_at, updated_at FROM projects ORDER BY updated_at DESC"
      ).all();
      return json({ projects: result.results || [] }, 200, corsHeaders);
    }

    return new Response(null, { status: 404, headers: corsHeaders });
  },
};
