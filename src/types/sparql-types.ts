// SPARQL query types for Solid Pod operations

export interface SPARQLQuery {
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CONSTRUCT' | 'ASK' | 'DESCRIBE' | 'UNKNOWN';
  query: string;
  prefixes?: Record<string, string>;
}

export interface SPARQLBinding {
  [variable: string]: SPARQLTerm;
}

export interface SPARQLTerm {
  type: 'uri' | 'literal' | 'bnode';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
}

export interface SPARQLResults {
  head: {
    vars: string[];
  };
  results: {
    bindings: SPARQLBinding[];
  };
}

export interface SPARQLUpdateResult {
  success: boolean;
  message?: string;
}