// Vercel Edge Function at /api/chat
export const config = { runtime: "edge" };

/**
 * Helper function for non-streaming responses (errors, health checks, options).
 * @param {object | string | null} body - The content to return.
 * @param {number} status - The HTTP status code.
 * @param {object} extraHeaders - Additional headers to include.
 * @returns {Response}
 */
function response(body, status = 200, extraHeaders = {}) {
  // Determine content type based on body structure
  const isJson = typeof body === 'object' && body !== null;
  const content = isJson ? JSON.stringify(body) : String(body || '');
  const contentType = isJson ? "application/json" : "text/plain";

  return new Response(content, {
    status,
    headers: {
      "Content-Type": contentType,
      // Allow all origins for simplicity in this setup. Use your specific domain in production.
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders
    }
  });
}

export default async function handler(req) {
  const method = req.method || "GET";

  // --- CORS Preflight Handling ---
  if (method === "OPTIONS") {
    return response(null, 204, {
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, authorization, accept",
      "Access-Control-Allow-Origin": "*"
    });
  }

  try {
    // --- Health Check ---
    if (method === "GET") {
      return response({ ok: true, message: "Chat streaming endpoint is live. Use POST." });
    }

    // --- Input Validation ---
    if (method !== "POST") return response({ error: "Method not allowed" }, 405);
    if (!process.env.OPENAI_API_KEY) return response({ error: "OPENAI_API_KEY is not set in Vercel environment variables" }, 500);

    let payload = {};
    try { payload = await req.json(); } catch { return response({ error: "Invalid JSON body" }, 400); }

    // Validate incoming messages array
    const { messages } = payload || {};
    if (!Array.isArray(messages) || messages.length === 0) return response({ error: "messages must be a non-empty array" }, 400);

    // --- Upstream OpenAI Call Setup ---
    const chatPayload = {
      // Switched to a correct, existing model name (e.g., gpt-3.5-turbo)
      model: "gpt-3.5-turbo",
      messages: messages,
      stream: true, // <-- CRUCIAL: Enables the streaming mode
    };

    // Use a longer timeout for streaming responses
    const ctrl = AbortSignal.timeout ? { signal: AbortSignal.timeout(60000) } : {};

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(chatPayload),
      ...ctrl
    });

    // --- Error Handling (Non-Streaming) ---
    // Check for upstream HTTP errors (4xx or 5xx)
    if (!upstream.ok || !upstream.body) {
      let data = {};
      try {
        const text = await upstream.text();
        data = text ? JSON.parse(text) : { message: "Unknown upstream error." };
      } catch (e) {
        data = { message: "Error parsing OpenAI error response." };
      }

      const detail = data.error?.message || data.message || `Upstream HTTP ${upstream.status}`;
      return response({ error: `OpenAI error: ${detail}` }, 502);
    }

    // --- SUCCESSFUL STREAMING RESPONSE ---
    // Pipe the raw ReadableStream from OpenAI directly to the client.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        // Must be text/event-stream for Server-Sent Events (SSE)
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (e) {
    console.error("Fatal Handler Error:", e);
    // Use the non-streaming helper for fatal handler errors
    return response({ error: e?.message || "Unknown server error during request processing" }, 500);
  }
}
