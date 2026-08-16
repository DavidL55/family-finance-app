import { describe, expect, it } from 'vitest';
import { violatesPlainLanguage, BANNED_JARGON, MAX_SENTENCE_WORDS } from '../utils/plainLanguage';

describe('violatesPlainLanguage', () => {
  it('flags a banned-jargon word', () => {
    expect(violatesPlainLanguage(`המונח ${BANNED_JARGON[0]} מופיע כאן.`).length).toBeGreaterThan(0);
  });
  it('flags a sentence longer than MAX_SENTENCE_WORDS', () => {
    const longSentence = Array.from({ length: MAX_SENTENCE_WORDS + 5 }, () => 'מילה').join(' ') + '.';
    expect(violatesPlainLanguage(longSentence).length).toBeGreaterThan(0);
  });
  it('returns no violations for a short, jargon-free sentence', () => {
    expect(violatesPlainLanguage('סכום ההכנסות החודש, לפני הוצאות.')).toEqual([]);
  });
});
