/**
 * Canonical directory-resource layout classification.
 *
 * These tests pin the single boundary that decides whether a collection lives
 * in directory-shaped LDP resources. The decision must come from the existing
 * id template contract only (explicit subjectTemplate or the id column default),
 * never from a model/type/provider identity.
 */
import { describe, expect, it } from 'vitest';
import { id, podTable, string } from '../../../../src/core/schema';
import { DocumentResourceResolver } from '../../../../src/core/resource-resolver/document-resolver';
import {
  getTableSubjectTemplate,
  isOwnDirectoryMetadataRow,
  metadataGraphIriForSubject,
  resolveDirectoryResourceMetadataLayout,
  toExplicitMetadataGraphSpec,
} from '../../../../src/core/resource-resolver/directory-layout';

const FOAF_AGENT = 'http://xmlns.com/foaf/0.1/Agent';
const ns = { prefix: 'ex', uri: 'https://example.org/' };
const podBase = 'https://pod.example/alice/';

function agentLikeTable() {
  // Mirrors the shared Models shape: base /agents/, id default "{key}/".
  return podTable('agent', {
    id: id('id').default('{key}/'),
    name: string('name').predicate('http://xmlns.com/foaf/0.1/name').notNull(),
  }, {
    base: '/agents/',
    type: FOAF_AGENT,
    namespace: ns,
    autoRegister: false,
  });
}

function ordinaryDocumentTable() {
  return podTable('note', {
    id: id('id').default('{key}.ttl'),
    title: string('title').predicate('https://schema.org/title'),
  }, {
    base: '/notes/',
    type: 'https://schema.org/Note',
    namespace: ns,
    autoRegister: false,
  });
}

describe('directory-resource layout classification', () => {
  it('reads the id column default as the storage template', () => {
    expect(getTableSubjectTemplate(agentLikeTable())).toBe('{key}/');
    expect(getTableSubjectTemplate(ordinaryDocumentTable())).toBe('{key}.ttl');
  });

  it('classifies an id-default directory layout and binds the canonical metadata namespace', () => {
    const layout = resolveDirectoryResourceMetadataLayout(
      agentLikeTable(),
      'https://pod.example/alice/agents/',
    );

    expect(layout).not.toBeNull();
    expect(layout!.subjectTemplate).toBe('{key}/');
    expect(layout!.collectionBaseIri).toBe('https://pod.example/alice/agents/');
    expect(layout!.metadataGraphPrefix).toBe('meta:https://pod.example/alice/agents/');
    expect(toExplicitMetadataGraphSpec(layout!)).toEqual({
      graphVariable: 'metadataGraph',
      namespacePrefix: 'meta:https://pod.example/alice/agents/',
    });
  });

  it('classifies an explicit subjectTemplate ending in "/"', () => {
    const table = podTable('agent_explicit', {
      id: id('id'),
      name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
    }, {
      base: '/agents/',
      type: FOAF_AGENT,
      namespace: ns,
      subjectTemplate: '{key}/',
      autoRegister: false,
    });

    const layout = resolveDirectoryResourceMetadataLayout(table, 'https://pod.example/alice/agents/');
    expect(layout?.metadataGraphPrefix).toBe('meta:https://pod.example/alice/agents/');
  });

  it('does not classify ordinary document, fragment, or exact-id layouts', () => {
    expect(resolveDirectoryResourceMetadataLayout(ordinaryDocumentTable(), `${podBase}notes/`)).toBeNull();

    const fragment = podTable('tags', {
      id: id('id').default('#{key}'),
      label: string('label').predicate('https://schema.org/name'),
    }, {
      base: '/tags.ttl',
      type: 'https://schema.org/Tag',
      namespace: ns,
      autoRegister: false,
    });
    expect(resolveDirectoryResourceMetadataLayout(fragment, `${podBase}tags.ttl`)).toBeNull();

    const exact = podTable('exact', {
      id: id('id'),
      label: string('label').predicate('https://schema.org/name'),
    }, {
      base: '/exact/',
      type: 'https://schema.org/Thing',
      namespace: ns,
      autoRegister: false,
    });
    expect(resolveDirectoryResourceMetadataLayout(exact, `${podBase}exact/`)).toBeNull();
  });

  it('exposes the same decision through the resolver boundary', () => {
    const resolver = new DocumentResourceResolver(podBase);
    const layout = resolver.resolveDirectoryMetadataLayout(
      agentLikeTable(),
      'https://pod.example/alice/agents/',
    );
    expect(layout?.metadataGraphPrefix).toBe('meta:https://pod.example/alice/agents/');
    expect(resolver.resolveDirectoryMetadataLayout(ordinaryDocumentTable(), `${podBase}notes/`)).toBeNull();
  });
});

describe('graph<->subject ownership guard', () => {
  const layout = resolveDirectoryResourceMetadataLayout(
    agentLikeTable(),
    'https://pod.example/alice/agents/',
  )!;
  const subject = 'https://pod.example/alice/agents/key-1/';

  it('accepts only the exact meta:{subject} graph', () => {
    expect(metadataGraphIriForSubject(subject)).toBe(`meta:${subject}`);
    expect(isOwnDirectoryMetadataRow(layout, `meta:${subject}`, subject)).toBe(true);
  });

  it('rejects foreign metadata about another IRI stored in the same namespace', () => {
    const foreign = 'https://pod.example/alice/agents/key-2/';
    expect(isOwnDirectoryMetadataRow(layout, `meta:${subject}`, foreign)).toBe(false);
    // A graph carrying the wrong resource's facet must never bind to this row.
    expect(isOwnDirectoryMetadataRow(layout, `meta:${foreign}`, subject)).toBe(false);
  });

  it('rejects impossible nesting and graphs outside the bounded namespace', () => {
    expect(isOwnDirectoryMetadataRow(layout, `meta:${subject}child/`, subject)).toBe(false);
    expect(isOwnDirectoryMetadataRow(layout, 'meta:https://other.example/bob/agents/key-1/', subject)).toBe(false);
    expect(isOwnDirectoryMetadataRow(layout, `meta:${subject}`, 'https://other.example/bob/agents/key-1/')).toBe(false);
    expect(isOwnDirectoryMetadataRow(layout, subject, subject)).toBe(false);
    expect(isOwnDirectoryMetadataRow(layout, undefined, subject)).toBe(false);
  });
});
