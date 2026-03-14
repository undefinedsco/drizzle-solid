import { describe, expect, it, vi } from 'vitest';
import { SparqlStrategy } from '../../../src/core/execution/sparql-strategy';
import { ASTToSPARQLConverter } from '../../../src/core/ast-to-sparql';
import { podTable, id, string, uri } from '../../../src/core/schema';
import { UriResolverImpl } from '../../../src/core/uri';

describe('SparqlStrategy document-mode sidecar select', () => {
  it('routes sidecar selects through the executor without forcing GRAPH ?g', async () => {
    const podUrl = 'http://localhost/test/';
    const fetchMock = vi.fn();
    const executeQueryWithSource = vi.fn().mockResolvedValue([]);

    const converter = new ASTToSPARQLConverter(podUrl, undefined, new UriResolverImpl(podUrl));
    const strategy = new SparqlStrategy({
      sparqlExecutor: {
        executeQueryWithSource,
      } as any,
      sparqlConverter: converter,
      sessionFetch: fetchMock as any,
      podUrl,
      uriResolver: new UriResolverImpl(podUrl),
    });

    const chatTable = podTable('chats', {
      id: id('id'),
      title: string('title').notNull(),
      participants: uri('participants').array().predicate('http://www.w3.org/2005/01/wf/flow-1.0#participant'),
    }, {
      base: '/.data/chat/',
      type: 'http://www.w3.org/ns/pim/meeting#LongChat',
      namespace: { uri: 'https://undefineds.co/ns#' },
      subjectTemplate: '{id}/index.ttl#this',
      sparqlEndpoint: '/.data/chat/-/sparql',
    });

    const plan: any = {
      baseTable: chatTable,
      _simpleSelectOptions: {
        table: chatTable,
        where: undefined,
      },
    };

    await strategy.executeSelect(plan, `${podUrl}.data/chat/`, `${podUrl}.data/chat/-/sparql`);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(executeQueryWithSource).toHaveBeenCalledTimes(1);
    const [query, sourceUrl] = executeQueryWithSource.mock.calls[0];
    expect(sourceUrl).toBe(`${podUrl}.data/chat/-/sparql`);
    expect(String(query.query)).not.toContain('GRAPH ?g');
    expect(String(query.query)).toContain('flow-1.0#participant');
  });
});
