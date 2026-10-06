import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.DEEPSEEK_API_KEY = 'test-server-key';
process.env.SITE_AI_ENABLED = 'true';
process.env.CORS_ORIGINS = 'http://allowed.example';
process.env.AI_RATE_LIMIT_PER_MINUTE = '100';
process.env.AI_REQUIRE_ORIGIN = 'true';

const originalFetch = globalThis.fetch;
const upstreamCalls = [];
const { createAppServer, readClientIpHeader, readTrustedProxyHops, resolveClientIp } = await import('../server.mjs');
let server;
let address;
let staticRoot;

const request = (path, options = {}) =>
  new Promise((resolve, reject) => {
    const requestOptions = {
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method: options.method || 'POST',
      headers: options.headers || {},
    };
    const clientRequest = http.request(requestOptions, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
    });
    clientRequest.on('error', reject);
    clientRequest.end(options.body || '');
  });

beforeAll(async () => {
  globalThis.fetch = async (url, init) => {
    upstreamCalls.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  staticRoot = await mkdtemp(join(tmpdir(), 'anime-horizon-server-'));
  await writeFile(join(staticRoot, 'index.html'), '<!doctype html><html></html>');
  server = createAppServer({ staticRoot });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  address = server.address();
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await rm(staticRoot, { recursive: true, force: true });
});

describe('AI proxy boundary', () => {
  it('rejects an origin outside the configured allowlist', async () => {
    const response = await request('/api/deepseek/chat', {
      headers: { Origin: 'http://blocked.example' },
    });

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error).toBe('CORS_FORBIDDEN');
  });

  it('rejects requests without an Origin header when an origin is required (production default)', async () => {
    const before = upstreamCalls.length;
    const response = await request('/api/deepseek/chat', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'write me a poem' }),
    });

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error).toBe('ORIGIN_REQUIRED');
    expect(upstreamCalls).toHaveLength(before);
  });

  it('rejects malformed JSON without calling the upstream', async () => {
    const before = upstreamCalls.length;
    const response = await request('/api/deepseek/chat', {
      headers: {
        Origin: 'http://allowed.example',
        'Content-Type': 'application/json',
      },
      body: '{',
    });

    expect(response.status).toBe(400);
    expect(upstreamCalls).toHaveLength(before);
  });

  it('does not allow the request body to override the server model', async () => {
    const response = await request('/api/deepseek/chat', {
      headers: {
        Origin: 'http://allowed.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'hello', model: 'expensive-user-selected-model' }),
    });

    expect(response.status).toBe(200);
    const upstreamBody = JSON.parse(upstreamCalls.at(-1).init.body);
    expect(upstreamBody.model).toBe('deepseek-v4-flash');
  });

  it('rejects oversized bodies and prompts before calling the upstream', async () => {
    const before = upstreamCalls.length;
    const headers = { Origin: 'http://allowed.example', 'Content-Type': 'application/json' };
    const tooBig = await request('/api/deepseek/chat', {
      headers,
      body: JSON.stringify({ prompt: 'x'.repeat(140 * 1024) }),
    });
    expect(tooBig.status).toBe(413);
    expect(JSON.parse(tooBig.body).error).toBe('REQUEST_TOO_LARGE');
    const longPrompt = await request('/api/deepseek/chat', {
      headers,
      body: JSON.stringify({ prompt: 'x'.repeat(60_001) }),
    });
    expect(longPrompt.status).toBe(413);
    expect(JSON.parse(longPrompt.body).error).toBe('PROMPT_TOO_LARGE');
    expect(upstreamCalls).toHaveLength(before);
  });

  it('maps upstream failures to coded errors without echoing the upstream body', async () => {
    const previous = globalThis.fetch;
    globalThis.fetch = async () => new Response('secret upstream detail sk-123', { status: 500 });
    try {
      const response = await request('/api/deepseek/chat', {
        headers: { Origin: 'http://allowed.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'hello' }),
      });
      expect(response.status).toBe(502);
      expect(JSON.parse(response.body).error).toBe('AI_UPSTREAM_ERROR');
      expect(response.body).not.toContain('secret upstream detail');
    } finally {
      globalThis.fetch = previous;
    }
  });

  it('caps output tokens and reports the site AI as enabled when explicitly configured', async () => {
    await request('/api/deepseek/chat', {
      headers: { Origin: 'http://allowed.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    expect(JSON.parse(upstreamCalls.at(-1).init.body).max_tokens).toBe(4000);
    const status = await request('/api/deepseek/status', { method: 'GET' });
    expect(JSON.parse(status.body)).toEqual({ siteAI: 'enabled' });
  });

  it('serves HEAD requests without a response body', async () => {
    const response = await request('/', { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(response.body).toBe('');
  });
});

describe('client IP derivation for rate limiting', () => {
  const req = (headers = {}, remoteAddress = '10.0.0.5') => ({ headers, socket: { remoteAddress } });

  it('uses the socket peer by default and ignores client-supplied forwarding headers', () => {
    const spoofed = req({ 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.10' });

    expect(resolveClientIp(spoofed)).toBe('10.0.0.5');
  });

  it('reads X-Forwarded-For from the right so client-prepended entries cannot choose the bucket', () => {
    // The client sent "X-Forwarded-For: 203.0.113.9"; the trusted proxy appended the real peer.
    const forwarded = req({ 'x-forwarded-for': '203.0.113.9, 198.51.100.7' });

    expect(resolveClientIp(forwarded, { trustedProxyHops: 1 })).toBe('198.51.100.7');
    expect(resolveClientIp(forwarded, { trustedProxyHops: 2 })).toBe('203.0.113.9');
  });

  it('falls back to the socket peer when the forwarding chain is shorter than the trusted hops or invalid', () => {
    expect(resolveClientIp(req({ 'x-forwarded-for': '198.51.100.7' }), { trustedProxyHops: 2 })).toBe('10.0.0.5');
    expect(resolveClientIp(req({ 'x-forwarded-for': 'not-an-ip' }), { trustedProxyHops: 1 })).toBe('10.0.0.5');
    expect(resolveClientIp(req({}), { trustedProxyHops: 1 })).toBe('10.0.0.5');
  });

  it('uses an explicitly configured single-value edge header only when it holds a valid IP', () => {
    expect(resolveClientIp(req({ 'cf-connecting-ip': '198.51.100.20' }), { clientIpHeader: 'cf-connecting-ip' })).toBe(
      '198.51.100.20'
    );
    expect(resolveClientIp(req({ 'cf-connecting-ip': 'garbage' }), { clientIpHeader: 'cf-connecting-ip' })).toBe(
      '10.0.0.5'
    );
  });

  it('normalizes IPv4-mapped IPv6 socket addresses', () => {
    expect(resolveClientIp(req({}, '::ffff:192.0.2.1'))).toBe('192.0.2.1');
  });

  it('parses proxy configuration conservatively', () => {
    expect(readTrustedProxyHops(undefined)).toBe(0);
    expect(readTrustedProxyHops('true')).toBe(1);
    expect(readTrustedProxyHops('2')).toBe(2);
    expect(readTrustedProxyHops('-1')).toBe(0);
    expect(readTrustedProxyHops('yes')).toBe(0);
    expect(readClientIpHeader('CF-Connecting-IP')).toBe('cf-connecting-ip');
    expect(readClientIpHeader('x-forwarded-for')).toBe('');
    expect(readClientIpHeader('bad header')).toBe('');
  });
});
