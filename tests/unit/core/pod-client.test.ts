import { describe, expect, it, vi } from 'vitest';
import { podTable, solidSchema, string } from '../../../src';
import { PodClient, PodCollection, PodEntity } from '../../../src/pod';
import { UriResolverImpl } from '../../../src/core/uri';

const Posts = podTable('Post', {
  id: string('id').primaryKey(),
  title: string('title').predicate('http://schema.org/headline'),
}, {
  base: 'https://pod.example/data/posts/',
  subjectTemplate: '{id}.ttl',
  type: 'http://schema.org/Article',
});

const ProfileSchema = solidSchema({
  id: string('id').primaryKey(),
  name: string('name').predicate('http://xmlns.com/foaf/0.1/name'),
}, {
  type: 'http://xmlns.com/foaf/0.1/Person',
  subjectTemplate: '#{id}',
});

describe('PodEntity', () => {
  it('delegates exact-target operations to the IRI API', async () => {
    const db = {
      findByIri: vi.fn().mockResolvedValue({ '@id': 'https://pod.example/data/posts/post-1.ttl', id: 'post-1' }),
      updateByIri: vi.fn().mockResolvedValue({ '@id': 'https://pod.example/data/posts/post-1.ttl', id: 'post-1', title: 'Updated' }),
      deleteByIri: vi.fn().mockResolvedValue(true),
      subscribeByIri: vi.fn().mockResolvedValue(() => undefined),
    } as any;

    const entity = new PodEntity(db, Posts, 'https://pod.example/data/posts/post-1.ttl');

    await expect(entity.get()).resolves.toMatchObject({ id: 'post-1' });
    await expect(entity.update({ title: 'Updated' } as any)).resolves.toMatchObject({ title: 'Updated' });
    await expect(entity.delete()).resolves.toBe(true);
    await expect(entity.subscribe({ onUpdate: vi.fn() } as any)).resolves.toBeTypeOf('function');

    expect(db.findByIri).toHaveBeenCalledWith(Posts, 'https://pod.example/data/posts/post-1.ttl');
    expect(db.updateByIri).toHaveBeenCalledWith(Posts, 'https://pod.example/data/posts/post-1.ttl', { title: 'Updated' });
    expect(db.deleteByIri).toHaveBeenCalledWith(Posts, 'https://pod.example/data/posts/post-1.ttl');
    expect(db.subscribeByIri).toHaveBeenCalledWith(Posts, 'https://pod.example/data/posts/post-1.ttl', { onUpdate: expect.any(Function) });
    expect(entity.documentUrl).toBe('https://pod.example/data/posts/post-1.ttl');
    expect(entity.fragment).toBe(null);
  });
});

describe('PodCollection', () => {
  it('generates stable IRIs through the table subject template', () => {
    const db = {
      getDialect: () => ({
        getUriResolver: () => new UriResolverImpl('https://pod.example/'),
      }),
    } as any;

    const collection = new PodCollection(db, Posts);
    expect(collection.iriFor({ id: 'post-1', title: 'Hello' } as any)).toBe('https://pod.example/data/posts/post-1.ttl');
  });

  it('uses returning() for create()', async () => {
    const returning = vi.fn().mockResolvedValue([
      { '@id': 'https://pod.example/data/posts/post-1.ttl', id: 'post-1', title: 'Hello' },
    ]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });

    const collection = new PodCollection({ insert } as any, Posts);
    const created = await collection.create({ id: 'post-1', title: 'Hello' } as any);

    expect(insert).toHaveBeenCalledWith(Posts);
    expect(values).toHaveBeenCalledWith({ id: 'post-1', title: 'Hello' });
    expect(returning).toHaveBeenCalledWith();
    expect(created).toMatchObject({ id: 'post-1', title: 'Hello' });
  });

  it('delegates collection subscriptions to db.subscribe()', async () => {
    const subscription = { active: true, channel: 'streaming-http', topic: 'https://pod.example/data/posts/', unsubscribe: vi.fn() };
    const subscribe = vi.fn().mockResolvedValue(subscription);
    const collection = new PodCollection({ subscribe } as any, Posts);

    await expect(collection.subscribe({ onUpdate: vi.fn() })).resolves.toBe(subscription as any);
    expect(subscribe).toHaveBeenCalledWith(Posts, { onUpdate: expect.any(Function) });
  });
});

describe('PodClient', () => {
  it('exposes the compatibility query facade', () => {
    const query = { posts: { findMany: vi.fn() } };
    const client = new PodClient({ query } as any);

    expect(client.query).toBe(query);
  });

  it('binds reusable schema through db.createTable()', () => {
    const table = { config: { base: 'https://pod.example/profile/card' } };
    const createTable = vi.fn().mockReturnValue(table);
    const client = new PodClient({ createTable } as any);

    const bound = client.bind(ProfileSchema, {
      base: 'https://pod.example/profile/card',
      subjectTemplate: '#{id}',
    });

    expect(createTable).toHaveBeenCalledWith(ProfileSchema, {
      base: 'https://pod.example/profile/card',
      subjectTemplate: '#{id}',
    });
    expect(bound).toBe(table);
  });

  it('delegates discovery table materialization to db.locationToTable()', async () => {
    const location = {
      container: 'https://pod.example/data/people/',
      source: 'typeindex',
      shapes: [],
    };
    const table = { config: { base: location.container } };
    const locationToTable = vi.fn().mockResolvedValue(table);
    const client = new PodClient({ locationToTable } as any);

    await expect(client.locationToTable(location as any, { appId: 'https://app.example/#id' })).resolves.toBe(table as any);
    expect(locationToTable).toHaveBeenCalledWith(location, { appId: 'https://app.example/#id' });
  });

  it('returns the last federated errors from db', () => {
    const errors = [{ code: 'timeout', message: 'timed out', path: ['friends', 'posts'] }];
    const client = new PodClient({ getLastFederatedErrors: vi.fn().mockReturnValue(errors) } as any);

    expect(client.getLastFederatedErrors()).toBe(errors as any);
  });
});
