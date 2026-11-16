export interface SPARQLQuery {
  type: 'SELECT' | 'INSERT' | 'DELETE' | 'UPDATE' | 'ASK';
  query: string;
  prefixes: Record<string, string>;
  /**
   * Set only when the metadata graph variable is part of the SELECT
   * projection. Grouped/aggregate plans keep the graph binding in WHERE (for
   * own-facet correlation) but must not project it: an ungrouped projected
   * variable is illegal SPARQL. Consumers that validate graph<->subject on
   * result rows must only run when this is set.
   */
  metadataGraphVariable?: string;
}

export interface ASTNode {
  type: string;
  [key: string]: any;
}
