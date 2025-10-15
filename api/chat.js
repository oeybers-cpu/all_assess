
```typescript
// /api/chat — Vercel Edge Function
export const config = { runtime: "edge" };

// Helper function for consistent JSON responses
function jsonResponse(obj: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}

// Validation functions
function validateMessages(messages: any[]): string | null {
  if (!Array.isArray(messages)) {
    return "Messages must be an array";
  }
  
  if (messages.length === 0) {
    return "Messages array cannot be empty";
  }
  
  if (messages.length > 100) {
    return "Too many messages (max 100)";
  }
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    if (!msg || typeof msg !== 'object') {
      return `Message at index ${i} must be an object`;
    }
    
    if (!msg.role || typeof msg.role !== 'string') {
      return `Message at index ${i} must have a 'role' string`;
    }
    
    if (!msg.content || typeof msg.content !== 'string') {
      return `Message at index ${i} must have a 'content' string`;
    }
    
    if (!['system', 'user', 'assistant'].includes(msg.role)) {
      return `Message at index ${i} has invalid role '${msg.role}'`;
    }
  }
  
  return null;
}

function validateModel(model: string): boolean {
  const validModels = [
    'gpt-4', 'gpt-4-turbo', 'gpt-4-mini', 
    'gpt-3.5-turbo', 'gpt-4o', 'gpt-4.1-mini'
  ];
  return validModels.includes(model);
}

// CORS headers for preflight and responses
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-requested-with",
};

export default async function handler(req: Request) {
  try {
    const method = req.method ?? "GET";

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders,
          "access-control-max-age": "86400",
        },
      });
    }

    // Health check
    if (method === "GET") {
      return jsonResponse({ 
        ok: true, 
        message: "Chat endpoint is operational. Use POST for requests.",
        timestamp: new Date().toISOString()
      });
    }

    // Only allow POST for main requests
    if (method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    // Validate Content-Type
    const contentType = req.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return jsonResponse({ 
        error: "Content-Type must be application/json" 
      }, 415);
    }

    // Check API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("OPENAI_API_KEY environment variable is not set");
      return jsonResponse({ 
        error: "Server configuration error" 
      }, 500);
    }

    // Parse and validate request body
    let body: any;
    try {
      body = await req.json();
    } catch (parseError) {
      return jsonResponse({ 
        error: "Invalid JSON in request body" 
      }, 400);
    }

    const {
      messages,
      model = "gpt-4-mini",
      useResponsesApi = false,
      previous_response_id,
    } = body ?? {};

    // Validate messages structure
    const messageValidationError = validateMessages(messages);
    if (messageValidationError) {
      return jsonResponse({ 
        error: `Invalid messages: ${messageValidationError}` 
      }, 400);
    }

    // Validate model
    if (!validateModel(model)) {
      return jsonResponse({ 
        error: `Unsupported model: ${model}` 
      }, 400);
    }

    // Standard Chat Completions API path
    if (!useResponsesApi) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const upstreamResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ 
            model, 
            messages,
            // Add any additional parameters you need
            stream: false 
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const responseText = await upstreamResponse.text();
        let responseData: any = null;
        
        try { 
          responseData = responseText ? JSON.parse(responseText) : null; 
        } catch (parseError) {
          console.error("Failed to parse OpenAI response:", parseError);
          return jsonResponse({ 
            error: "Invalid response from AI service" 
          }, 502);
        }

        if (!upstreamResponse.ok) {
          const errorDetail = responseData?.error?.message || responseText || `HTTP ${upstreamResponse.status}`;
          console.error("OpenAI API error:", errorDetail);
          return jsonResponse({ 
            error: `AI service error: ${errorDetail}` 
          }, 502);
        }

        return jsonResponse(responseData, 200);

      } catch (fetchError: any) {
        if (fetchError.name === 'AbortError') {
          return jsonResponse({ error: "Request timeout" }, 408);
        }
        console.error("Fetch error in Chat Completions:", fetchError);
        return jsonResponse({ error: "Network error" }, 503);
      }
    }

    // Responses API path (for reasoning models)
    try {
      // Properly format messages for Responses API
      const inputs = messages.map(msg => ({
        role: msg.role,
        content: [{ type: "text", text: msg.content }]
      }));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch("https://api.openai.com/v1/responses", {
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
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let responseData: any = null;
      
      try { 
        responseData = responseText ? JSON.parse(responseText) : null; 
      } catch (parseError) {
        console.error("Failed to parse OpenAI Responses API data:", parseError);
        return jsonResponse({ 
          error: "Invalid response from AI service" 
        }, 502);
      }

      if (!response.ok) {
        const errorDetail = responseData?.error?.message || responseText || `HTTP ${response.status}`;
        console.error("OpenAI Responses API error:", errorDetail);
        return jsonResponse({ 
          error: `AI service error: ${errorDetail}` 
        }, 502);
      }

      return jsonResponse(responseData, 200);

    } catch (fetchError: any) {
      if (fetchError.name === 'AbortError') {
        return jsonResponse({ error: "Request timeout" }, 408);
      }
      console.error("Fetch error in Responses API:", fetchError);
      return jsonResponse({ error: "Network error" }, 503);
    }

  } catch (error: any) {
    // Global error handler for unexpected errors
    console.error("Unexpected server error:", error);
    return jsonResponse({ 
      error: "Internal server error" 
    }, 500);
  }
}
