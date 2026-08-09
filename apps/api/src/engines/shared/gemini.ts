/**
 * Shared Gemini generate helper for AgentOps chat / fleet narration.
 * Failures are logged; callers should fall back to templates.
 */

const FALLBACK_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-2.0-flash',
] as const;

export type GeminiGenerateOpts = {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
};

function modelCandidates(preferred: string): string[] {
  const out: string[] = [];
  for (const model of [preferred, ...FALLBACK_MODELS]) {
    const trimmed = model.trim();
    if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  opts: GeminiGenerateOpts,
): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly status: number; readonly detail: string }> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: opts.temperature ?? 0.4,
            maxOutputTokens: opts.maxOutputTokens ?? 900,
          },
        }),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      readonly error?: { readonly message?: string };
      readonly candidates?: Array<{
        readonly finishReason?: string;
        readonly content?: { readonly parts?: Array<{ readonly text?: string }> };
      }>;
    };
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        detail: body.error?.message ?? `HTTP ${response.status}`,
      };
    }
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text && text.length > 0) return { ok: true, text };
    return {
      ok: false,
      status: response.status,
      detail: `empty_response finish=${body.candidates?.[0]?.finishReason ?? 'none'}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      detail: error instanceof Error ? error.message : 'fetch_failed',
    };
  }
}

export async function geminiGenerate(
  prompt: string,
  opts: GeminiGenerateOpts = {},
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    console.warn('[gemini] GEMINI_API_KEY is unset — using template fallback');
    return null;
  }

  const preferred = process.env.GEMINI_MODEL?.trim() || 'gemini-flash-lite-latest';
  const models = modelCandidates(preferred);
  const errors: string[] = [];

  for (const model of models) {
    const result = await callGemini(apiKey, model, prompt, opts);
    if (result.ok) {
      if (model !== preferred) {
        console.warn(`[gemini] primary model ${preferred} failed; used ${model}`);
      }
      return result.text;
    }
    errors.push(`${model}: ${result.status} ${result.detail}`);
    // Only continue on quota / not-found / empty; stop on auth errors
    if (result.status === 401 || result.status === 403) break;
  }

  console.warn(`[gemini] all models failed — using template fallback :: ${errors.join(' | ')}`);
  return null;
}
