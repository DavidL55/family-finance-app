import Anthropic from '@anthropic-ai/sdk';
import type { ProviderAdapter, GenerateTextResult } from './types';

function client() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  return new Anthropic({ apiKey });
}

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  async generateText({ systemPrompt, messages, modelId }): Promise<GenerateTextResult> {
    // m.role below is ChatMessage.role ('user'|'model', which conversation turn is speaking) —
    // not Member.role, not PermissionRole. See src/__tests__/aiPermissionsContract.test.ts's file
    // header for the two-hatch rationale (`token` vs `not-auth-role`).
    const anthropicTurns = messages.map((m) => ({ role: m.role === 'model' ? ('assistant' as const) : ('user' as const), content: m.text })); // role-guard-allow: not-auth-role
    const res = await client().messages.create({
      model: modelId,
      max_tokens: 1024,
      system: systemPrompt,
      messages: anthropicTurns,
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return { text, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  },
  async generateJson(req): Promise<GenerateTextResult> {
    // Anthropic has no native JSON mode as of this catalog — the schema hint is appended to the
    // LAST (current-turn) message, the same prompt-embedded technique src/utils/FileProcessor.ts's
    // existing Gemini prompt already uses today. Earlier turns in `messages` pass through unmodified.
    const messages = [...req.messages];
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = {
      ...last,
      text: `${last.text}\n\nהחזר אך ורק JSON תקני התואם למבנה הבא, ללא markdown:\n${req.jsonSchemaHint}`,
    };
    return anthropicAdapter.generateText({ ...req, messages });
  },
};
