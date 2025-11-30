export interface SPARQLQuery {
  type: 'SELECT' | 'INSERT' | 'DELETE' | 'UPDATE' | 'ASK';
  query: string;
  prefixes: Record<string, string>;
}

export interface ASTNode {
  type: string;
  [key: string]: any;
}
