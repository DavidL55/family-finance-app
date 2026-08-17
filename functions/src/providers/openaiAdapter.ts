import OpenAI from 'openai';
import type { ProviderAdapter, GenerateTextResult } from './types';

function client() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  return new OpenAI({ apiKey });
}

// Mirrors anthropicAdapter.ts's shape exactly (task brief's own convention for these three files) —
// same client()/generateText/generateJson structure, only the SDK call and response-shape mapping
// differ, since OpenAI has a real JSON mode unlike Anthropic's prompt-embedded fallback.
export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  isConfigured: () => Boolean(process.env.OPENAI_API_KEY),
  async generateText({ systemPrompt, messages, modelId }): Promise<GenerateTextResult> {
    // m.role below is ChatMessage.role ('user'|'model', which conversation turn is speaking) —
    // not Member.role, not PermissionRole. The D2/D8 regression guard
    // (src/__tests__/aiPermissionsContract.test.ts) verifies this structurally — a `.role` read
    // off a `.map()` callback's own parameter, mapped over `messages` — not by a comment claim,
    // so this note is documentation only, not a magic string the guard reads.
    const turns = messages.map((m) => ({ role: m.role === 'model' ? ('assistant' as const) : ('user' as const), content: m.text }));
    const res = await client().chat.completions.create({
      model: modelId,
      messages: [{ role: 'system', content: systemPrompt }, ...turns],
    });
    const text = res.choices[0]?.message?.content ?? '';
    return { text, inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
  },
  async generateJson({ systemPrompt, messages, modelId, jsonSchemaHint, attachment }): Promise<GenerateTextResult> {
    // OpenAI's real JSON mode (response_format: json_object) — unlike Anthropic's prompt-embedded
    // fallback above. OpenAI requires the word "json" to appear somewhere in the prompt when this
    // mode is set, which the schema-hint instruction below already satisfies.
    // m.role below is ChatMessage.role, same non-auth field as generateText above — same
    // structurally-verified `.map()`-over-messages shape, not a comment claim.
    const turns = messages.map((m) => ({ role: m.role === 'model' ? ('assistant' as const) : ('user' as const), content: m.text }));
    // Task 7 — an image attachment (extraction's own addition) becomes a real `image_url` content
    // block on the final turn, Chat Completions' own multimodal shape (a `data:` URI, no separate
    // upload step needed). OpenAI's Chat Completions endpoint has no equivalent inline-PDF block
    // (unlike Anthropic's `document` block or Google's `inlineData`) — a PDF attachment here is
    // disclosed via a text note rather than silently dropped, since this catalog currently tags
    // OpenAI for 'chat' only (registry.ts), not 'extraction'; a future PDF-capable wiring (the
    // Files/Assistants API) would replace this note, not this comment's honesty about the gap.
    const finalContent = `החזר אך ורק JSON תקני התואם למבנה הבא, ללא markdown:\n${jsonSchemaHint}`;
    const lastTurn = attachment
      ? {
          role: 'user' as const,
          content: attachment.mimeType === 'application/pdf'
            ? [{ type: 'text' as const, text: `${finalContent}\n\n[קובץ PDF מצורף לא נתמך ישירות ב-OpenAI Chat Completions — יש להשתמש בספק אחר לחילוץ מסמכי PDF]` }]
            : [
                { type: 'image_url' as const, image_url: { url: `data:${attachment.mimeType};base64,${attachment.base64Data}` } },
                { type: 'text' as const, text: finalContent },
              ],
        }
      : { role: 'user' as const, content: finalContent };
    const res = await client().chat.completions.create({
      model: modelId,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        ...turns,
        lastTurn,
      ],
    });
    const text = res.choices[0]?.message?.content ?? '';
    return { text, inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
  },
};
