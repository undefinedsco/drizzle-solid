type NamespaceLike = Record<string, unknown> & {
  NAMESPACE?: string;
  namespace?: string;
  uri?: string;
};

const ABSOLUTE_IRI = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

const cloneNamespace = <T extends Record<string, unknown>>(base: T): T => {
  const prototype = Object.getPrototypeOf(base) ?? Object.prototype;
  return Object.assign(Object.create(prototype), base);
};

const resolveNamespaceUri = (base: NamespaceLike, override?: string): string | undefined => {
  if (override) return override;
  return base.NAMESPACE || base.namespace || base.uri;
};

const buildTermValue = (namespaceUri: string | undefined, term: string): string => {
  if (!namespaceUri || ABSOLUTE_IRI.test(term)) {
    return term;
  }
  return `${namespaceUri}${term}`;
};

export function extendNamespace<
  TBase extends Record<string, unknown>,
  TExtras extends Record<string, string>
>(
  base: TBase,
  extras: TExtras,
  options?: { namespace?: string }
): TBase & TExtras {
  const extended = cloneNamespace(base);
  const namespaceUri = resolveNamespaceUri(base as NamespaceLike, options?.namespace);

  for (const [key, localName] of Object.entries(extras)) {
    Object.defineProperty(extended, key, {
      value: buildTermValue(namespaceUri, localName),
      enumerable: true,
      configurable: false,
      writable: false
    });
  }

  return extended as TBase & TExtras;
}
