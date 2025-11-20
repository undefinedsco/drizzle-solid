import { describe, it, expect } from 'vitest';
import { extendNamespace } from '@src/utils/namespace';

const BASE_NAMESPACE = {
  PREFIX: 'schema',
  NAMESPACE: 'https://schema.org/',
  Person: 'https://schema.org/Person'
};

describe('extendNamespace', () => {
  it('preserves base properties and adds new ones using namespace', () => {
    const extended = extendNamespace(BASE_NAMESPACE, {
      profileFavorite: 'profile#favorite'
    });

    expect(extended.Person).toBe(BASE_NAMESPACE.Person);
    expect(extended.profileFavorite).toBe('https://schema.org/profile#favorite');
  });

  it('allows overriding namespace and absolute IRIs', () => {
    const extended = extendNamespace(
      BASE_NAMESPACE,
      {
        absolute: 'https://linq.dev/foo',
        short: 'foo'
      },
      { namespace: 'https://linq.dev/ns/' }
    );

    expect(extended.absolute).toBe('https://linq.dev/foo');
    expect(extended.short).toBe('https://linq.dev/ns/foo');
  });

  it('does not mutate the original namespace object', () => {
    const snapshot = { ...BASE_NAMESPACE };
    extendNamespace(BASE_NAMESPACE, { custom: 'Custom' });
    expect(BASE_NAMESPACE).toEqual(snapshot);
  });

});
