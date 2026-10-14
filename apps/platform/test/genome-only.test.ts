import { env } from 'cloudflare:workers';
import { afterEach, expect, it } from 'vitest';
import type { ImportSystemResponse, ModelBundle } from '../shared/api';
import { setArtifactsOverride } from '../worker/artifacts/client';
import { clearGenomeMemo } from '../worker/artifacts/genome-source';
import { systemStub } from '../worker/service';
import { genomeFiles, genomeFor } from './fixtures/genome';
import { FakeArtifacts } from './helpers/fake-artifacts';
import { ADMIN, call } from './helpers/flows';

afterEach(() => { setArtifactsOverride(undefined); clearGenomeMemo(); });
it('imports and opens a Genome-only Thing without creating a source artifact or app repository', async () => {
  const id = `system.genomeonly${crypto.randomUUID().replaceAll('-', '')}`;
  const repo = `genome-${id.slice(7)}`;
  const files = { ...genomeFor(id),
    'thing.webapp/node.yaml': 'id: thing.webapp\nkind: thing\nfields:\n  name: App idea\n  description: Genome first\n',
  };
  const ns = new FakeArtifacts();
  ns.create(repo).commit(files, 'Genome only'); setArtifactsOverride(ns);
  const imported = await call<ImportSystemResponse>('POST', '/systems/import', { systemId: id, genomeRepo: repo, review: false }, ADMIN);
  expect(imported.status, JSON.stringify(imported.json)).toBe(201);
  expect(imported.json.appCommit).toBeNull();
  const state = await systemStub(env, id).state();
  expect(state?.manifest?.artifacts).toEqual({});
  expect(state?.appSource).toBeNull();
  const model = await call<ModelBundle>('GET', `/systems/${id}/model`);
  expect(model.status).toBe(200);
  const source = await call('GET', `/systems/${id}/files?scope=app&ref=head`);
  expect(source.status).toBe(404);
  const appWork = await call('POST', `/systems/${id}/evolutions/evolution.1/realizations`, {target:'app'}, ADMIN);
  expect(appWork.status).toBe(409);
  const repeated = await call<ImportSystemResponse>('POST', '/systems/import', { systemId: id, genomeRepo: repo, review: false }, ADMIN);
  expect(repeated.status).toBe(201);
  expect(repeated.json.head).toBe(imported.json.head);
});
