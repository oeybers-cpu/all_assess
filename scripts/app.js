// /api/chat — Vercel Edge Function
export const config = { runtime: "edge" };

// Configuration and Constants
const ALLOWED_MODELS = new Set(["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"]);
const MAX_MESSAGE_LENGTH = 500;
const REQUEST_TIMEOUT = 30_000;

// Utility Functions
function createResponse(obj, status = 200, extraHeaders = {}) {
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
  
  if (!Array.isArray(messages)) {
    return { error: "messages must be an array", status: 400 };
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
  
  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : "gpt-4.1-mini";
  
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
      // Add optional parameters for better response formatting
      temperature: 0.7,
      max_tokens: 1000
    }),
    signal,
  });
}

async function handleOpenAIResponse(upstream) {
  const text = await upstream.text();
  let data;
  
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!upstream.ok) {
    const detail = data?.error?.message || text || `Upstream HTTP ${upstream.status}`;
    return { error: `OpenAI error: ${detail}`, status: 502, data: null };
  }

  return { error: null, data, status: 200 };
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
  return createResponse({ 
    ok: true, 
    message: "chat endpoint is live. use POST.",
    timestamp: new Date().toISOString(),
    features: {
      allowed_models: Array.from(ALLOWED_MODELS),
      max_message_length: MAX_MESSAGE_LENGTH,
      timeout: REQUEST_TIMEOUT
    }
  });
}

// Error Handler
function handleError(error, status = 500) {
  const errorMessage = error?.message || "Unknown server error";
  console.error(`API Error (${status}):`, errorMessage);
  
  return createResponse({ 
    error: errorMessage,
    timestamp: new Date().toISOString()
  }, status);
}

// Session Management (Simple request tracking)
let requestCount = 0;

function trackRequest() {
  requestCount++;
  console.log(`API: Request #${requestCount} processed`);
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
      return createResponse({ error: "Method not allowed" }, 405);
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
    const controller = AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT) : undefined;

    // Make OpenAI request
    const upstream = await createOpenAIRequest(apiKey, model, messages, controller);
    
    // Process response
    const response = await handleOpenAIResponse(upstream);
    if (response.error) {
      return handleError(new Error(response.error), response.status);
    }

    // Track successful request
    trackRequest();

    // Return successful response
    return createResponse({
      ...response.data,
      // Add metadata similar to frontend structure
      _metadata: {
        model_used: model,
        timestamp: new Date().toISOString(),
        message_count: messages.length
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
