export type Namespace<TTerms extends Record<string, string> = Record<string, string>> = ((term: string) => string) & {
  prefix: string;
  uri: string;
  term: (name: string) => string;
} & { [K in keyof TTerms]: string };

export function namespace<TTerms extends Record<string, string>>(
  prefix: string,
  uri: string,
  terms?: TTerms
): Namespace<TTerms> {
  const term = (name: string) => `${uri}${name}`;

  const builder = ((name: string) => term(name)) as Namespace<TTerms>;
  builder.prefix = prefix;
  builder.uri = uri;
  builder.term = term;

  if (terms) {
    (Object.entries(terms) as Array<[keyof TTerms, string]>).forEach(([key, value]) => {
      Object.defineProperty(builder, key, {
        value: term(value),
        enumerable: true,
        configurable: false,
        writable: false
      });
    });
  }

  return builder;
}

export const VCARD = namespace('vcard', 'http://www.w3.org/2006/vcard/ns#', {
  fn: 'fn',
  givenName: 'given-name',
  familyName: 'family-name',
  hasPhoto: 'hasPhoto',
  note: 'note',
  region: 'region',
  gender: 'gender',
  email: 'hasEmail'
} as const);

export const FOAF = namespace('foaf', 'http://xmlns.com/foaf/0.1/', {
  nick: 'nick',
  name: 'name',
  homepage: 'homepage',
  img: 'img',
  person: 'Person',
  Person: 'Person'
} as const);

export const LDP = namespace('ldp', 'http://www.w3.org/ns/ldp#', {
  inbox: 'inbox'
} as const);

export const SCHEMA = namespace('schema', 'https://schema.org/', {
  name: 'name',
  email: 'email',
  url: 'url',
  description: 'description'
} as const);
