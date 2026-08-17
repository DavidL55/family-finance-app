// Task 6 (Stage 6) — thin httpsCallable wrapper over listAiModels/aiChat. No provider key of any
// kind lives here — that is the whole point of routing through Cloud Functions (D1/D10). This
// file only proves the wrapper calls the right callable with the right shape and unwraps `.data`.
import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(), getFunctions: vi.fn() }));
vi.mock('../services/firebase', () => ({ functions: {} }));

import { httpsCallable } from 'firebase/functions';
import { listAiModels, sendChatMessage } from '../services/aiClient';

describe('aiClient (thin httpsCallable wrapper, no key of any kind in this file — that is the whole point)', () => {
  it('listAiModels calls the listAiModels callable and unwraps .data.models', async () => {
    const mockCallable = vi.fn(async () => ({ data: { models: [{ modelId: 'mock-standard' }] } }));
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    const models = await listAiModels('chat');
    expect(mockCallable).toHaveBeenCalledWith({ action: 'chat' });
    expect(models).toEqual([{ modelId: 'mock-standard' }]);
  });

  it('sendChatMessage calls the aiChat callable, including full history AND filterScope, and unwraps .data', async () => {
    const mockCallable = vi.fn(async () => ({ data: { text: 'שלום', providerId: 'mock', modelId: 'mock-standard', costILS: 0 } }));
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    const filterScope = { memberIds: ['omer-levy'], period: { month: '08', year: '2026' } };
    const res = await sendChatMessage({ sessionId: 's1', message: 'שלום', modelId: 'mock-standard', history: [{ role: 'user', text: 'קודם' }], filterScope });
    expect(mockCallable).toHaveBeenCalledWith(expect.objectContaining({ history: [{ role: 'user', text: 'קודם' }], filterScope }));
    expect(res.text).toBe('שלום');
  });

  it('surfaces a resource-exhausted HttpsError (the cost-gate refusal, D4) as a distinguishable error, not a generic failure', async () => {
    const mockCallable = vi.fn(async () => { throw { code: 'functions/resource-exhausted', message: 'נדרש אישור' }; });
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    await expect(sendChatMessage({ sessionId: 's1', message: 'שלום', modelId: 'claude-opus-5', history: [], filterScope: { memberIds: null, period: { month: '08', year: '2026' } } }))
      .rejects.toMatchObject({ code: 'functions/resource-exhausted' });
  });

  it('surfaces a provider-failure HttpsError (429/timeout/context-overflow, D14) the same distinguishable way as a cost-gate refusal', async () => {
    // NOTE: the brief's own snippet for this test used the regex /עומס/ (ayin-vav-mem-samech,
    // "load"). The actual, already-shipped, already-reviewed copy in
    // functions/src/providers/providerErrors.ts's rate-limited COPY_HE entry is 'עמוס'
    // (ayin-mem-vav-samech, "busy") — a different letter order, confirmed byte-for-byte via the
    // real source file, not assumed. Corrected here to match production, same class of
    // inherited-fixture fix as Task 3's monthKey() DST-boundary correction.
    const mockCallable = vi.fn(async () => { throw { code: 'functions/resource-exhausted', message: 'ספק ה-AI עמוס כרגע — נסה שוב בעוד רגע.' }; });
    (httpsCallable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockCallable);
    await expect(sendChatMessage({ sessionId: 's1', message: 'שלום', modelId: 'mock-standard', history: [], filterScope: { memberIds: null, period: { month: '08', year: '2026' } } }))
      .rejects.toMatchObject({ message: expect.stringMatching(/עמוס/) });
  });
});
