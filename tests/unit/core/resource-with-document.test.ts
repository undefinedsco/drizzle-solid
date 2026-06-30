import { describe, it, expect, vi } from 'vitest';
import { PodDatabase } from '@src/core/pod-database';
import { podTable, id, string, uri } from '@src/core/schema';

const ideaResource = podTable('ideas', {
  id: id(),
  title: string('title').predicate('https://schema.org/name'),
  document: uri('document').predicate('http://purl.org/dc/terms/source'),
}, {
  base: '/.data/ideas/',
  type: 'https://undefineds.co/models/idea#Idea',
});

type HarnessOptions = {
  insertFails?: boolean;
};

function createHarness(options: HarnessOptions = {}) {
  const writes: Array<{ url: string; init: RequestInit }> = [];
  const inserts: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    writes.push({ url: String(url), init: init ?? {} });
    return new Response('', { status: 200 });
  });
  const execute = vi.fn(async () => {
    if (options.insertFails) {
      throw new Error('metadata write failed');
    }
    return [{ success: true }];
  });
  const dialect = {
    getPodUrl: () => 'https://pod.example/alice/',
    getAuthenticatedFetch: () => fetch,
    getResolver: () => ({
      resolveSubject: (_resource: unknown, row: Record<string, unknown>) => new URL(String(row.id).replace(/^\/+/, ''), 'https://pod.example/alice/').toString(),
      parseId: (_resource: unknown, iri: string) => iri.replace('https://pod.example/alice/', ''),
      getResourceUrl: (subject: string) => subject.split('#')[0],
    }),
  };
  const session = {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserts.push(row);
        return { execute };
      },
    }),
  };
  const db = new PodDatabase(dialect as never, session as never, { ideas: ideaResource });
  return { db, fetch, writes, inserts, execute };
}

describe('resource with document operations', () => {
  it('dryRunResourceWithDocument plans metadata and file writes without mutating Pod', async () => {
    const { db, fetch, inserts } = createHarness();

    const plan = await db.dryRunResourceWithDocument(ideaResource, {
      row: {
        id: '.data/ideas/capture-demo.ttl#this',
        title: 'Capture demo',
      },
      document: {
        path: 'projects/linx-cli/ideas/capture-demo.md',
        content: '# Capture demo\n',
        contentType: 'text/markdown',
      },
    });

    expect(plan.ok).toBe(true);
    expect(plan.resourceId).toBe('.data/ideas/capture-demo.ttl#this');
    expect(plan.resourceIri).toBe('https://pod.example/alice/.data/ideas/capture-demo.ttl#this');
    expect(plan.fileWrites).toEqual([
      {
        relationField: 'document',
        url: 'https://pod.example/alice/projects/linx-cli/ideas/capture-demo.md',
        contentType: 'text/markdown',
      },
    ]);
    expect(plan.row.document).toBe('https://pod.example/alice/projects/linx-cli/ideas/capture-demo.md');
    expect(fetch).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it('upsertResourceWithDocument writes the file before metadata and returns the dry-run plan', async () => {
    const { db, fetch, inserts } = createHarness();

    const result = await db.upsertResourceWithDocument(ideaResource, {
      row: {
        id: '.data/ideas/capture-demo.ttl#this',
        title: 'Capture demo',
      },
      document: {
        path: 'projects/linx-cli/ideas/capture-demo.md',
        content: '# Capture demo\n',
        contentType: 'text/markdown',
      },
    });

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://pod.example/alice/projects/linx-cli/ideas/capture-demo.md',
      expect.objectContaining({ method: 'PUT', headers: expect.objectContaining({ 'content-type': 'text/markdown' }) }),
    );
    expect(inserts).toEqual([
      expect.objectContaining({
        id: '.data/ideas/capture-demo.ttl#this',
        title: 'Capture demo',
        document: 'https://pod.example/alice/projects/linx-cli/ideas/capture-demo.md',
      }),
    ]);
  });

  it('upsertResourceWithDocument deletes a written file when metadata write fails', async () => {
    const { db, fetch } = createHarness({ insertFails: true });

    await expect(db.upsertResourceWithDocument(ideaResource, {
      row: {
        id: '.data/ideas/capture-demo.ttl#this',
        title: 'Capture demo',
      },
      document: {
        path: 'projects/linx-cli/ideas/capture-demo.md',
        content: '# Capture demo\n',
        contentType: 'text/markdown',
      },
    })).rejects.toThrow('metadata write failed');

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://pod.example/alice/projects/linx-cli/ideas/capture-demo.md',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://pod.example/alice/projects/linx-cli/ideas/capture-demo.md',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });


  it('moveDocumentAndRelink writes the new file, relinks metadata, then removes the old file', async () => {
    const { db, fetch } = createHarness();
    const updateById = vi.fn(async () => ({ id: '.data/ideas/capture-demo.ttl#this' }));
    (db as unknown as { updateById: typeof updateById }).updateById = updateById;

    const result = await db.moveDocumentAndRelink(ideaResource, {
      id: '.data/ideas/capture-demo.ttl#this',
      fromPath: 'projects/linx-cli/ideas/old.md',
      toPath: 'projects/linx-cli/ideas/new.md',
      content: '# New\n',
      contentType: 'text/markdown',
    });

    expect(result.toUrl).toBe('https://pod.example/alice/projects/linx-cli/ideas/new.md');
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://pod.example/alice/projects/linx-cli/ideas/new.md',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(updateById).toHaveBeenCalledWith(ideaResource, '.data/ideas/capture-demo.ttl#this', {
      document: 'https://pod.example/alice/projects/linx-cli/ideas/new.md',
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://pod.example/alice/projects/linx-cli/ideas/old.md',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('moveDocumentAndRelink deletes the new file when metadata relink fails', async () => {
    const { db, fetch } = createHarness();
    const updateById = vi.fn(async () => { throw new Error('relink failed'); });
    (db as unknown as { updateById: typeof updateById }).updateById = updateById;

    await expect(db.moveDocumentAndRelink(ideaResource, {
      id: '.data/ideas/capture-demo.ttl#this',
      toPath: 'projects/linx-cli/ideas/new.md',
      content: '# New\n',
    })).rejects.toThrow('relink failed');

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://pod.example/alice/projects/linx-cli/ideas/new.md',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://pod.example/alice/projects/linx-cli/ideas/new.md',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('deleteResourceWithDocument removes metadata before deleting the linked file', async () => {
    const { db, fetch } = createHarness();
    const findById = vi.fn(async () => ({
      id: '.data/ideas/capture-demo.ttl#this',
      document: 'https://pod.example/alice/projects/linx-cli/ideas/capture-demo.md',
    }));
    const deleteById = vi.fn(async () => true);
    (db as unknown as { findById: typeof findById; deleteById: typeof deleteById }).findById = findById;
    (db as unknown as { deleteById: typeof deleteById }).deleteById = deleteById;

    const result = await db.deleteResourceWithDocument(ideaResource, {
      id: '.data/ideas/capture-demo.ttl#this',
    });

    expect(result).toEqual({
      deleted: true,
      fileUrl: 'https://pod.example/alice/projects/linx-cli/ideas/capture-demo.md',
    });
    expect(deleteById).toHaveBeenCalledWith(ideaResource, '.data/ideas/capture-demo.ttl#this');
    expect(fetch).toHaveBeenCalledWith(
      'https://pod.example/alice/projects/linx-cli/ideas/capture-demo.md',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('dryRunResourceWithDocument rejects duplicate resource/document path expansion', async () => {
    const { db } = createHarness();

    await expect(db.dryRunResourceWithDocument(ideaResource, {
      row: {
        id: 'projects/linx-cli/ideas/projects/linx-cli/ideas/capture-demo.ttl#this',
        title: 'Capture demo',
      },
      document: {
        path: 'projects/linx-cli/ideas/projects/linx-cli/ideas/capture-demo.md',
        content: '# Capture demo\n',
      },
    })).rejects.toThrow('duplicate path composition');
  });
});
