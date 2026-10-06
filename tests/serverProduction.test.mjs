import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The v1 production posture: NODE_ENV=production, an explicit allowlist, and the site AI left disabled
// even though a key happens to be present (SITE_AI_ENABLED is not "true").
process.env.NODE_ENV = 'production';
process.env.CORS_ORIGINS = 'https://anime.example';
process.env.DEEPSEEK_API_KEY = 'present-but-not-enabled';
delete process.env.SITE_AI_ENABLED;
delete process.env.AI_REQUIRE_ORIGIN;

const originalFetch = globalThis.fetch;
const upstreamCalls = [];
const { createAppServer } = await import('../server.mjs');
let server;
let address;
let staticRoot;

const request = (path, options = {}) =>
  new Promise((resolve, reject) => {
    const clientRequest = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );
    clientRequest.on('error', reject);
    clientRequest.end(options.body || '');
  });

const postPrompt = (headers) =>
  request('/api/deepseek/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ prompt: 'my whole archive with private notes' }),
  });

beforeAll(async () => {
  globalThis.fetch = async (url, init) => {
    upstreamCalls.push({ url, init });
    return new Response('{}', { status: 200 });
  };
  staticRoot = await mkdtemp(join(tmpdir(), 'anime-horizon-prod-'));
  await writeFile(join(staticRoot, 'index.html'), '<!doctype html><title>app</title>');
  await mkdir(join(staticRoot, 'assets'));
  await writeFile(join(staticRoot, 'assets', 'index-abcdef12.js'), 'console.log(1)');
  server = createAppServer({ staticRoot });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  address = server.address();
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await rm(staticRoot, { recursive: true, force: true });
});

describe('production AI boundary (v1: site AI disabled)', () => {
  it('requires an Origin header in production by default', async () => {
    const response = await postPrompt({});
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error).toBe('ORIGIN_REQUIRED');
  });

  it('rejects origins outside CORS_ORIGINS without granting CORS', async () => {
    const response = await postPrompt({ Origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error).toBe('CORS_FORBIDDEN');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('fails closed for the allowed origin: 503, no upstream call, no configuration details', async () => {
    const before = upstreamCalls.length;
    const response = await postPrompt({ Origin: 'https://anime.example' });
    const body = JSON.parse(response.body);

    expect(response.status).toBe(503);
    expect(body.error).toBe('AI_NOT_CONFIGURED');
    expect(response.body).not.toMatch(/DEEPSEEK|SITE_AI|key|present-but-not-enabled/i);
    expect(response.headers['access-control-allow-origin']).toBe('https://anime.example');
    expect(upstreamCalls).toHaveLength(before);
  });

  it('reports the site AI as disabled on the public status endpoint', async () => {
    const response = await request('/api/deepseek/status', { headers: { Origin: 'https://anime.example' } });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ siteAI: 'disabled' });
    expect((await request('/api/deepseek/status', { method: 'POST' })).status).toBe(405);
  });
});

describe('production static serving', () => {
  it('sends HSTS and the security headers', async () => {
    const response = await request('/');
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it.each([
    '/',
    '/my-anime',
    '/journey',
    '/journey/taste',
    '/journey/recall',
    '/settings',
    '/archive',
    '/no-such-page',
  ])('serves the app shell for %s', async (path) => {
    const response = await request(path);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<title>app</title>');
  });

  it('returns real 404s for missing assets and unknown API paths, and never serves files outside the root', async () => {
    expect((await request('/assets/index-abcdef12.js')).headers['cache-control']).toContain('immutable');
    expect((await request('/assets/missing.js')).status).toBe(404);
    expect((await request('/data/anime-2024.json')).status).toBe(404);
    expect((await request('/api/unknown')).status).toBe(404);
    const traversal = await request('/%2e%2e/package.json');
    expect(traversal.status).toBe(404);
    expect(traversal.body).not.toContain('"devDependencies"');
  });
});

describe('production configuration checks', () => {
  it('refuses to start with CORS_ORIGINS=*', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./server.mjs')"], {
      cwd: join(import.meta.dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production', CORS_ORIGINS: '*', PORT: '0' },
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('CORS_ORIGIN=* is not allowed in production');
  });
});
