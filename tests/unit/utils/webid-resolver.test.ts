import { describe, expect, it, vi } from 'vitest';
import { WebIdResolver } from '../../../src/utils/webid-resolver';

describe('WebIdResolver', () => {
  it('prefers pim:storage and normalizes a trailing slash', async () => {
    const resolver = new WebIdResolver();
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(`
        @prefix pim: <http://www.w3.org/ns/pim/space#>.
        @prefix solid: <http://www.w3.org/ns/solid/terms#>.

        <https://alice.example/profile/card#me>
          pim:storage <https://alice.example/storage>;
          solid:pod <https://alice.example/pod/> .
      `, {
        status: 200,
        headers: { 'content-type': 'text/turtle' }
      })
    );

    const storage = await resolver.resolveStorage('https://alice.example/profile/card#me', fetchFn as any);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(storage).toBe('https://alice.example/storage/');
  });
});
