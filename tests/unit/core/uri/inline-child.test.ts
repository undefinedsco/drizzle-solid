import { describe, expect, it } from 'vitest';
import { buildInlineChildUri } from '../../../../src/core/uri/resolver';

describe('inline child identity', () => {
  const document = 'https://pod.example/tasks/index.ttl';

  it('keeps document-subject identities compatible', () => {
    expect(buildInlineChildUri(document, 'metadata', 0)).toBe(`${document}#metadata-1`);
  });

  it('isolates two levels of descendants under different subject fragments', () => {
    const first = buildInlineChildUri(`${document}#first`, 'metadata', 0);
    const second = buildInlineChildUri(`${document}#second`, 'metadata', 0);
    expect(first).not.toBe(second);
    expect(buildInlineChildUri(first, 'execution', 0)).not.toBe(buildInlineChildUri(second, 'execution', 0));
  });

  it('escapes separators in parent fragments and column names to avoid aliasing', () => {
    expect(buildInlineChildUri(`${document}#a/b`, 'metadata', 0))
      .not.toBe(buildInlineChildUri(`${document}#a`, 'b/metadata', 0));
  });
});
