// /api/chat — Vercel Edge Function
export const config = { runtime: "edge" };

// Configuration and Constants
const ALLOWED_MODELS = new Set(["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"]); // Corrected model names
const MAX_MESSAGE_LENGTH = 500;
const REQUEST_TIMEOUT = 60_000; // Increased timeout for streaming

// Utility Functions
function createJsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}

function validateRequest(payload) {
  const { messages, model: requestedModel } = payload || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: "messages must be a non-empty array", status: 400 };
  }

  // Validate message content length
  for (const message of messages) {
    if (message.content && message.content.length > MAX_MESSAGE_LENGTH) {
      return {
        error: `Message content exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
        status: 400
      };
    }
  }

  // Use requested model if allowed, otherwise default to a safe model
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : "gpt-3.5-turbo";

  return { messages, model, error: null };
}

function createOpenAIRequest(apiKey, model, messages, signal) {
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true, // <-- CRITICAL: Enables token streaming
      temperature: 0.7,
      max_tokens: 1000
    }),
    signal,
  });
}

// CORS Handler
function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, GET, OPTIONS, DELETE",
      "access-control-allow-headers": "content-type, authorization, x-requested-with",
      "access-control-max-age": "86400",
    },
  });
}

// Health Check Handler
function handleHealthCheck() {
  return createJsonResponse({
    ok: true,
    message: "chat endpoint is live and supports streaming. use POST.",
    timestamp: new Date().toISOString(),
    features: {
      allowed_models: Array.from(ALLOWED_MODELS),
      max_message_length: MAX_MESSAGE_LENGTH,
      timeout: REQUEST_TIMEOUT
    }
  });
}

// Error Handler (for internal handler errors or non-streaming upstream errors)
function handleError(error, status = 500) {
  const errorMessage = error?.message || "Unknown server error";
  console.error(`API Error (${status}):`, errorMessage);

  return createJsonResponse({
    error: errorMessage,
    timestamp: new Date().toISOString()
  }, status);
}

// Main Request Handler
export default async function handler(req) {
  const method = req.method || "GET";

  try {
    // CORS preflight
    if (method === "OPTIONS") {
      return handleCORS();
    }

    // Health check
    if (method === "GET") {
      return handleHealthCheck();
    }

    // Only allow POST for chat requests
    if (method !== "POST") {
      return createJsonResponse({ error: "Method not allowed" }, 405);
    }

    // API Key validation
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return handleError(new Error("OPENAI_API_KEY is not set"), 500);
    }

    // Payload parsing
    let payload = {};
    try {
      payload = await req.json();
    } catch {
      return handleError(new Error("Invalid JSON body"), 400);
    }

    // Request validation
    const validation = validateRequest(payload);
    if (validation.error) {
      return handleError(new Error(validation.error), validation.status);
    }

    const { messages, model } = validation;

    // Create abort controller for timeout
    const controller = AbortSignal.timeout(REQUEST_TIMEOUT);

    // Make OpenAI request
    const upstream = await createOpenAIRequest(apiKey, model, messages, controller);

    // --- NON-STREAMING UPSTREAM ERROR CHECK ---
    if (!upstream.ok || !upstream.body) {
      let text = "";
      try {
        text = await upstream.text();
      } catch (e) {
        // Ignored. Can happen if stream is closed quickly.
      }

      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null; // Can't parse the error text
      }

      const detail = data?.error?.message || text || `Upstream HTTP ${upstream.status}`;
      // Return a 502 error with the detail from the OpenAI response
      return handleError(new Error(`OpenAI error: ${detail}`), 502);
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

  } catch (error) {
    // Handle timeout and other errors
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return handleError(new Error("Request timeout"), 408);
    }

    return handleError(error);
  }
}
