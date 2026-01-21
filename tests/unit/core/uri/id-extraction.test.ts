import { describe, it, expect } from 'vitest';
import { podTable, string } from '../../../../src/core/schema';
import { UriResolverImpl } from '../../../../src/core/uri';

const ns = { prefix: 'test', uri: 'https://test.example/' };

describe('UriResolver ID extraction', () => {
  it('should extract ID from document mode URI with custom template', () => {
    const Chat = podTable('Chat', {
      id: string('id').primaryKey().predicate('https://test.example/id'),
      title: string('title').predicate('https://test.example/title'),
    }, {
      base: '/.data/chat/',
      type: 'http://www.w3.org/ns/pim/meeting#LongChat',
      namespace: ns,
      subjectTemplate: '{id}/index.ttl#this',
    });

    const resolver = new UriResolverImpl('http://localhost:4020/pod');
    const uri = 'http://localhost:4020/pod/.data/chat/chat_abc123/index.ttl#this';
    
    const parsed = resolver.parseSubject(uri, Chat);
    console.log('Parsed:', parsed);
    
    expect(parsed?.id).toBe('chat_abc123');
  });

  it('should extract ID from fragment mode URI', () => {
    const Tags = podTable('Tags', {
      id: string('id').primaryKey().predicate('https://test.example/id'),
      name: string('name').predicate('https://test.example/name'),
    }, {
      base: '/.data/tags.ttl',
      type: 'https://schema.org/Tag',
      namespace: ns,
      subjectTemplate: '#{id}',
    });

    const resolver = new UriResolverImpl('http://localhost:4020/pod');
    const uri = 'http://localhost:4020/pod/.data/tags.ttl#tag-456';
    
    const parsed = resolver.parseSubject(uri, Tags);
    console.log('Parsed:', parsed);
    
    expect(parsed?.id).toBe('tag-456');
  });

  it('should extract ID from simple document mode URI with default template', () => {
    const Items = podTable('Items', {
      id: string('id').primaryKey().predicate('https://test.example/id'),
      name: string('name').predicate('https://test.example/name'),
    }, {
      base: '/.data/items/',
      type: 'https://schema.org/Thing',
      namespace: ns,
      // default template: {id}.ttl (no fragment)
    });

    const resolver = new UriResolverImpl('http://localhost:4020/pod');
    const uri = 'http://localhost:4020/pod/.data/items/item-789.ttl';

    const parsed = resolver.parseSubject(uri, Items);
    console.log('Parsed:', parsed);

    expect(parsed?.id).toBe('item-789');
  });

  it('should extract ID from URI with different host but same path structure', () => {
    const Chat = podTable('Chat', {
      id: string('id').primaryKey().predicate('https://test.example/id'),
      title: string('title').predicate('https://test.example/title'),
    }, {
      base: '/.data/chat/',
      type: 'http://www.w3.org/ns/pim/meeting#LongChat',
      namespace: ns,
      subjectTemplate: '{id}/index.ttl#this',
    });

    // Resolver initialized with localhost:4020
    const resolver = new UriResolverImpl('http://localhost:4020/pod');
    // But URI comes from a different host (e.g., from SPARQL query results)
    const uri = 'http://example.com/pod/.data/chat/chat-xyz/index.ttl#this';

    const parsed = resolver.parseSubject(uri, Chat);
    console.log('Parsed (cross-host):', parsed);

    // Should still extract 'chat-xyz' by matching the path structure
    expect(parsed?.id).toBe('chat-xyz');
  });

  it('should extract ID with fixed fragment #this', () => {
    const Profile = podTable('Profile', {
      id: string('id').primaryKey().predicate('https://test.example/id'),
      name: string('name').predicate('https://test.example/name'),
    }, {
      base: '/.data/profiles/',
      type: 'https://schema.org/Person',
      namespace: ns,
      subjectTemplate: '{id}/card#this',
    });

    const resolver = new UriResolverImpl('http://localhost:4020/pod');
    const uri = 'http://localhost:4020/pod/.data/profiles/user-123/card#this';

    const parsed = resolver.parseSubject(uri, Profile);
    console.log('Parsed (fixed fragment):', parsed);

    expect(parsed?.id).toBe('user-123');
    expect(parsed?.fragment).toBe('this');
  });

  it('should extract ID with fixed fragment #me', () => {
    const WebId = podTable('WebId', {
      id: string('id').primaryKey().predicate('https://test.example/id'),
      name: string('name').predicate('https://test.example/name'),
    }, {
      base: '/.data/webid/',
      type: 'https://schema.org/Person',
      namespace: ns,
      subjectTemplate: '{id}/profile/card#me',
    });

    const resolver = new UriResolverImpl('http://localhost:4020/pod');
    const uri = 'http://localhost:4020/pod/.data/webid/alice/profile/card#me';

    const parsed = resolver.parseSubject(uri, WebId);
    console.log('Parsed (fixed fragment #me):', parsed);

    expect(parsed?.id).toBe('alice');
    expect(parsed?.fragment).toBe('me');
  });

  it('should handle nested path with fixed fragment', () => {
    const Document = podTable('Document', {
      id: string('id').primaryKey().predicate('https://test.example/id'),
      title: string('title').predicate('https://test.example/title'),
    }, {
      base: '/.data/docs/',
      type: 'https://schema.org/Document',
      namespace: ns,
      subjectTemplate: '{id}/metadata/index.ttl#this',
    });

    const resolver = new UriResolverImpl('http://localhost:4020/pod');
    const uri = 'http://localhost:4020/pod/.data/docs/doc-2024-01/metadata/index.ttl#this';

    const parsed = resolver.parseSubject(uri, Document);
    console.log('Parsed (nested path):', parsed);

    expect(parsed?.id).toBe('doc-2024-01');
    expect(parsed?.fragment).toBe('this');
  });
});
