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
    // not Member.role, not PermissionRole. See src/__tests__/aiPermissionsContract.test.ts's file
    // header for the two-hatch rationale (`token` vs `not-auth-role`).
    const turns = messages.map((m) => ({ role: m.role === 'model' ? ('assistant' as const) : ('user' as const), content: m.text })); // role-guard-allow: not-auth-role
    const res = await client().chat.completions.create({
      model: modelId,
      messages: [{ role: 'system', content: systemPrompt }, ...turns],
    });
    const text = res.choices[0]?.message?.content ?? '';
    return { text, inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
  },
  async generateJson({ systemPrompt, messages, modelId, jsonSchemaHint }): Promise<GenerateTextResult> {
    // OpenAI's real JSON mode (response_format: json_object) — unlike Anthropic's prompt-embedded
    // fallback above. OpenAI requires the word "json" to appear somewhere in the prompt when this
    // mode is set, which the schema-hint instruction below already satisfies.
    // m.role below is ChatMessage.role, same non-auth field as generateText above.
    const turns = messages.map((m) => ({ role: m.role === 'model' ? ('assistant' as const) : ('user' as const), content: m.text })); // role-guard-allow: not-auth-role
    const res = await client().chat.completions.create({
      model: modelId,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        ...turns,
        { role: 'user', content: `החזר אך ורק JSON תקני התואם למבנה הבא, ללא markdown:\n${jsonSchemaHint}` },
      ],
    });
    const text = res.choices[0]?.message?.content ?? '';
    return { text, inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
  },
};
