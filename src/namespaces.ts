// 从 @inrupt/vocab-common-rdf 导入标准 RDF 词汇表
import { 
  VCARD as VCARD_VOCAB,
  FOAF as FOAF_VOCAB,
  LDP as LDP_VOCAB,
  SCHEMA_INRUPT as SCHEMA_VOCAB
} from '@inrupt/vocab-common-rdf';

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

// 重新导出标准命名空间
export const VCARD = VCARD_VOCAB;
export const FOAF = FOAF_VOCAB;
export const LDP = LDP_VOCAB;
export const SCHEMA = SCHEMA_VOCAB;
