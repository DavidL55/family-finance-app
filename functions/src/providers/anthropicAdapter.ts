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
    // not Member.role, not PermissionRole. The D2/D8 regression guard
    // (src/__tests__/aiPermissionsContract.test.ts) verifies this structurally — a `.role` read
    // off a `.map()` callback's own parameter, mapped over `messages` — not by a comment claim,
    // so this note is documentation only, not a magic string the guard reads.
    const anthropicTurns = messages.map((m) => ({ role: m.role === 'model' ? ('assistant' as const) : ('user' as const), content: m.text }));
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
    const lastText = `${req.messages[req.messages.length - 1].text}\n\nהחזר אך ורק JSON תקני התואם למבנה הבא, ללא markdown:\n${req.jsonSchemaHint}`;

    // Task 7 — a document attachment (extraction's own addition) needs a real Anthropic content
    // BLOCK, not plain text, so it bypasses generateText's plain-string mapping entirely for the
    // last turn: Claude's messages API takes `type: 'image'` (base64 source) for image mimeTypes
    // and `type: 'document'` for application/pdf — the same two shapes
    // src/utils/FileProcessor.ts's retired client-side call sent Gemini as inlineData, adapted to
    // Anthropic's own block vocabulary.
    if (req.attachment) {
      const earlierTurns = req.messages.slice(0, -1).map((m) => ({
        role: m.role === 'model' ? ('assistant' as const) : ('user' as const), content: m.text,
      }));
      const isPdf = req.attachment.mimeType === 'application/pdf';
      const attachmentBlock = isPdf
        ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: req.attachment.base64Data } }
        : { type: 'image' as const, source: { type: 'base64' as const, media_type: req.attachment.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: req.attachment.base64Data } };
      const res = await client().messages.create({
        model: req.modelId,
        max_tokens: 4096,
        system: req.systemPrompt,
        messages: [...earlierTurns, { role: 'user' as const, content: [attachmentBlock, { type: 'text' as const, text: lastText }] }],
      });
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
      return { text, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    }

    const messages = [...req.messages];
    const last = messages[messages.length - 1];
    messages[messages.length - 1] = { ...last, text: lastText };
    return anthropicAdapter.generateText({ ...req, messages });
  },
};
