// Vercel Edge Function at /api/chat
export const config = { runtime: "edge" };

function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...extraHeaders }
  });
}

export default async function handler(req) {
  try {
    const method = req.method || "GET";

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, GET, OPTIONS",
          "access-control-allow-headers": "content-type, authorization"
        }
      });
    }

    // Health check in browser
    if (method === "GET") {
      return json({ ok: true, message: "chat endpoint is live. use POST." });
    }

    if (method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (!process.env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not set" }, 500);

    let payload = {};
    try { payload = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
    const { messages } = payload || {};
    if (!Array.isArray(messages)) return json({ error: "messages must be an array" }, 400);

    const ctrl = AbortSignal.timeout ? { signal: AbortSignal.timeout(30000) } : {};
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: "gpt-4.1-mini", messages }),
      ...ctrl
    });

    const text = await upstream.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch {}
    if (!upstream.ok) {
      const detail = data?.error?.message || text || `Upstream HTTP ${upstream.status}`;
      return json({ error: `OpenAI error: ${detail}` }, 502);
    }

    return json(data, 200);
  } catch (e) {
    return json({ error: e?.message || "Unknown server error" }, 500);
  }
}
