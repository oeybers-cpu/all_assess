// /api/chat  — Vercel Edge Function
export const config = { runtime: "edge" };

function json(obj: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}

export default async function handler(req: Request) {
  try {
    const method = req.method ?? "GET";

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, GET, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
          "access-control-max-age": "86400",
        },
      });
    }

    // simple health check
    if (method === "GET") return json({ ok: true, message: "chat endpoint is live. use POST." });

    if (method !== "POST") return json({ error: "Method not allowed" }, 405);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not set" }, 500);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const {
      messages,
      model = "gpt-4.1-mini",
      // Optional flags for future use
      useResponsesApi = false,
      previous_response_id,
    } = body ?? {};

    if (!Array.isArray(messages)) {
      return json({ error: "messages must be an array of Chat Completions-style messages" }, 400);
    }

    // Default path: Chat Completions (simple, stable)
    if (!useResponsesApi) {
      const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, messages }),
        // optional timeout on Edge
        signal: AbortSignal.timeout ? AbortSignal.timeout(30_000) : undefined,
      });

      const text = await upstream.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch {}

      if (!upstream.ok) {
        const detail = data?.error?.message || text || `Upstream HTTP ${upstream.status}`;
        return json({ error: `OpenAI error: ${detail}` }, 502);
      }
      return json(data, 200);
    }

    // Optional path: Responses API (for reasoning models / agentic flows)
    // Note: This does NOT run a Workflow. It just uses the newer endpoint.
    // If you want to run your Agent workflow in-product, use the ChatKit session endpoint below.
    const inputs = [
      { role: "user", content: [{ type: "text", text: JSON.stringify(messages) }] },
    ];

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: inputs,
        ...(previous_response_id ? { previous_response_id } : {}),
      }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(30_000) : undefined,
    });

    const text = await resp.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch {}

    if (!resp.ok) {
      const detail = data?.error?.message || text || `Upstream HTTP ${resp.status}`;
      return json({ error: `OpenAI error: ${detail}` }, 502);
    }
    return json(data, 200);
  } catch (e: any) {
    return json({ error: e?.message || "Unknown server error" }, 500);
  }
}
