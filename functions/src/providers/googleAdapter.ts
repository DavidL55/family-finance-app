import { GoogleGenAI } from '@google/genai';
import type { ProviderAdapter, GenerateTextResult } from './types';

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  return new GoogleGenAI({ apiKey });
}

// Reuses @google/genai exactly as src/utils/FileProcessor.ts's existing (client-side, retired in
// Task 7) analyzeDocument already calls it — same models.generateContent shape, same response.text
// getter, same usageMetadata fields — just imported from the Node entrypoint instead of '/web'.
export const googleAdapter: ProviderAdapter = {
  id: 'google',
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
  async generateText({ systemPrompt, messages, modelId }): Promise<GenerateTextResult> {
    // m.role below is ChatMessage.role ('user'|'model', which conversation turn is speaking) —
    // not Member.role, not PermissionRole. The D2/D8 regression guard
    // (src/__tests__/aiPermissionsContract.test.ts) verifies this structurally — a `.role` read
    // off a `.map()` callback's own parameter, mapped over `messages` — not by a comment claim,
    // so this note is documentation only, not a magic string the guard reads.
    const contents = messages.map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] }));
    const res = await client().models.generateContent({
      model: modelId,
      contents,
      config: { systemInstruction: systemPrompt },
    });
    const text = res.text ?? '';
    return {
      text,
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },
  async generateJson({ systemPrompt, messages, modelId, jsonSchemaHint }): Promise<GenerateTextResult> {
    // Google's real structured-output mode (responseMimeType: 'application/json') — the shared
    // ProviderAdapter contract only carries jsonSchemaHint as a prompt-embedded string (not a
    // structured Type.OBJECT schema), so, like OpenAI's json_object mode above, the hint is
    // embedded in the final turn's text rather than passed as a typed responseSchema.
    // m.role below is ChatMessage.role, same non-auth field as generateText above — same
    // structurally-verified `.map()`-over-messages shape, not a comment claim.
    const contents = messages.map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] }));
    const last = contents[contents.length - 1];
    if (last) {
      last.parts = [{ text: `${last.parts[0].text}\n\nהחזר אך ורק JSON תקני התואם למבנה הבא, ללא markdown:\n${jsonSchemaHint}` }];
    }
    const res = await client().models.generateContent({
      model: modelId,
      contents,
      config: { systemInstruction: systemPrompt, responseMimeType: 'application/json' },
    });
    const text = res.text ?? '';
    return {
      text,
      inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },
};
