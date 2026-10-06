import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createQuotaStore, QuotaStoreUnavailableError } from './quotaStore.mjs';

const moduleLocation = (() => {
  try {
    const moduleUrl = new URL(import.meta.url);
    if (moduleUrl.protocol === 'file:') {
      const modulePath = fileURLToPath(moduleUrl);
      return { directory: dirname(modulePath), path: modulePath };
    }
  } catch {
    // Vite/Vitest may expose a non-file module URL; the process working directory is the app root there.
  }
  return { directory: process.cwd(), path: null };
})();

const __dirname = moduleLocation.directory;
const distDir = join(__dirname, 'dist');
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value, fallback) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

/**
 * Number of reverse proxies in front of this server that append to X-Forwarded-For.
 * `TRUST_PROXY=true` is treated as one hop. 0 (default) ignores forwarding headers.
 */
export function readTrustedProxyHops(value) {
  if (value === 'true') return 1;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 10 ? parsed : 0;
}

export function readClientIpHeader(value) {
  const header = String(value || '')
    .trim()
    .toLowerCase();
  return /^[a-z0-9-]{1,64}$/.test(header) && header !== 'x-forwarded-for' ? header : '';
}

const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
const deepseekBaseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions';
const deepseekModel = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const configuredCorsOrigins = process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN ?? '';
const maxBodyBytes = readPositiveInteger(process.env.AI_MAX_BODY_BYTES, 128 * 1024);
const maxPromptChars = readPositiveInteger(process.env.AI_MAX_PROMPT_CHARS, 60_000);
const maxUpstreamResponseBytes = readPositiveInteger(process.env.AI_MAX_RESPONSE_BYTES, 512_000);
const upstreamTimeoutMs = readPositiveInteger(process.env.AI_TIMEOUT_MS, 45_000);
const rateLimitWindowMs = 60_000;
const rateLimitMax = readPositiveInteger(process.env.AI_RATE_LIMIT_PER_MINUTE, 10);
const globalRateLimitMax = readPositiveInteger(process.env.AI_GLOBAL_RATE_LIMIT_PER_MINUTE, rateLimitMax * 10);
const globalDailyLimit = readPositiveInteger(process.env.AI_GLOBAL_RATE_LIMIT_PER_DAY, 10_000);
const maxConcurrentRequests = readPositiveInteger(process.env.AI_MAX_CONCURRENCY, 2);
// Browsers always send Origin on cross-origin and same-origin POST requests, so a missing
// Origin means a non-browser client. Production rejects it by default.
const requireOrigin = readBoolean(process.env.AI_REQUIRE_ORIGIN, isProduction);
const clientIpOptions = {
  trustedProxyHops: readTrustedProxyHops(process.env.TRUST_PROXY),
  clientIpHeader: readClientIpHeader(process.env.CLIENT_IP_HEADER),
};
const quotaStore = createQuotaStore();
const allowedModels = new Set(
  (process.env.AI_ALLOWED_MODELS || deepseekModel)
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean)
);
let activeAIRequests = 0;

if (!allowedModels.size) allowedModels.add(deepseekModel);
if (isProduction && configuredCorsOrigins.split(',').some((origin) => origin.trim() === '*')) {
  throw new Error('CORS_ORIGIN=* is not allowed in production; configure CORS_ORIGINS explicitly.');
}

if (isProduction && process.env.AI_QUOTA_REDIS_URL && !process.env.AI_QUOTA_REDIS_TOKEN) {
  throw new Error('AI_QUOTA_REDIS_TOKEN is required when AI_QUOTA_REDIS_URL is configured in production.');
}

if (isProduction && process.env.AI_QUOTA_REDIS_URL) {
  let quotaUrl;
  try {
    quotaUrl = new URL(process.env.AI_QUOTA_REDIS_URL);
  } catch {
    throw new Error('AI_QUOTA_REDIS_URL must be a valid URL.');
  }
  if (quotaUrl.protocol !== 'https:') throw new Error('AI_QUOTA_REDIS_URL must use HTTPS in production.');
}

const corsOrigins = new Set(
  configuredCorsOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

if (!isProduction && !corsOrigins.size) {
  corsOrigins.add('http://localhost:3000');
  corsOrigins.add('http://127.0.0.1:3000');
}

if (isProduction && !corsOrigins.size) {
  console.warn(
    '[AI proxy] CORS_ORIGINS is empty: every browser AI request will be rejected. Add the site origin, including for same-origin deployments.'
  );
}

if (isProduction && !clientIpOptions.trustedProxyHops && !clientIpOptions.clientIpHeader) {
  console.warn(
    '[AI proxy] TRUST_PROXY/CLIENT_IP_HEADER are not set: per-IP limits use the socket peer. Behind a reverse proxy all visitors may share one bucket; see docs/deployment.md.'
  );
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'BodyTooLargeError';
  }
}

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https:",
  ].join('; '),
};

if (isProduction) {
  securityHeaders['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
}

const getCorsHeaders = (req) => {
  const origin = req.headers.origin;
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (origin && corsOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
};

const responseHeaders = (req, extra = {}) => ({
  ...securityHeaders,
  ...getCorsHeaders(req),
  ...extra,
});

const sendJson = (req, res, status, data, extra = {}) => {
  const headers = responseHeaders(req, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extra,
  });

  res.writeHead(status, headers);
  if (status === 204) {
    res.end();
    return;
  }
  res.end(JSON.stringify(data));
};

const sendError = (req, res, status, code, message, extra = {}) => {
  sendJson(req, res, status, { error: code, message }, extra);
};

const readBody = (req) =>
  new Promise((resolveBody, reject) => {
    const contentLength = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      req.resume();
      reject(new BodyTooLargeError());
      return;
    }

    let body = '';
    let bodyBytes = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > maxBodyBytes) {
        settled = true;
        req.resume();
        reject(new BodyTooLargeError());
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!settled) resolveBody(body);
    });
    req.on('error', (error) => {
      if (!settled) reject(error);
    });
  });

const normalizeIp = (value) => {
  const candidate = String(value || '')
    .trim()
    .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  return isIP(candidate) ? candidate : '';
};

const headerValue = (value) => (Array.isArray(value) ? value.join(',') : value || '');

/**
 * Derives the client address used for per-IP rate limiting.
 *
 * - Default: the TCP peer address. It cannot be spoofed, but behind a reverse proxy it is the proxy.
 * - `clientIpHeader`: a single-value header that the trusted edge overwrites (for example
 *   `cf-connecting-ip`). Only safe when production verification shows clients cannot set it.
 * - `trustedProxyHops`: reads X-Forwarded-For from the right. Each trusted proxy appends the
 *   address it received the request from, so entries left of those are client-controlled and
 *   are never used.
 */
export const resolveClientIp = (req, { trustedProxyHops = 0, clientIpHeader = '' } = {}) => {
  const socketIp = normalizeIp(req.socket?.remoteAddress) || 'unknown';
  if (clientIpHeader) {
    const fromHeader = normalizeIp(headerValue(req.headers[clientIpHeader]).split(',')[0]);
    if (fromHeader) return fromHeader;
  }
  if (trustedProxyHops > 0) {
    const chain = headerValue(req.headers['x-forwarded-for'])
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const fromChain = normalizeIp(chain[chain.length - trustedProxyHops]);
    if (fromChain) return fromChain;
  }
  return socketIp;
};

const getClientIp = (req) => resolveClientIp(req, clientIpOptions);

export const resetRateLimitState = () => {
  quotaStore.reset();
  activeAIRequests = 0;
};

const isAllowedOrigin = (req) => {
  const origin = req.headers.origin;
  if (!origin) return !requireOrigin;
  return corsOrigins.has(origin);
};

const validateUpstreamConfiguration = () => {
  let parsed;
  try {
    parsed = new URL(deepseekBaseUrl);
  } catch {
    throw new Error('DEEPSEEK_BASE_URL must be a valid URL');
  }
  if (parsed.protocol !== 'https:' && isProduction) {
    throw new Error('DEEPSEEK_BASE_URL must use HTTPS in production');
  }
};

const handleDeepSeek = async (req, res) => {
  if (!isAllowedOrigin(req)) {
    if (!req.headers.origin) sendError(req, res, 403, 'ORIGIN_REQUIRED', 'An allowed Origin header is required.');
    else sendError(req, res, 403, 'CORS_FORBIDDEN', 'Origin is not allowed.');
    return;
  }

  if (req.method === 'OPTIONS') {
    sendJson(req, res, 204, {});
    return;
  }

  if (req.method !== 'POST') {
    sendError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    return;
  }

  if (!deepseekApiKey) {
    sendError(req, res, 503, 'AI_NOT_CONFIGURED', 'AI service is not configured.');
    return;
  }

  try {
    const clientQuota = await quotaStore.consume({
      scope: `client:${getClientIp(req)}`,
      limit: rateLimitMax,
      windowMs: rateLimitWindowMs,
    });
    if (!clientQuota.allowed) {
      sendError(req, res, 429, 'RATE_LIMITED', 'Too many AI requests. Try again later.', {
        'Retry-After': String(clientQuota.retryAfter),
      });
      return;
    }
    const globalQuota = await quotaStore.consume({
      scope: 'global-minute',
      limit: globalRateLimitMax,
      windowMs: rateLimitWindowMs,
    });
    const dailyQuota = await quotaStore.consume({
      scope: 'global-day',
      limit: globalDailyLimit,
      windowMs: 24 * 60 * 60 * 1000,
    });
    const exceededQuota = [globalQuota, dailyQuota].find((quota) => !quota.allowed);
    if (exceededQuota) {
      sendError(req, res, 429, 'AI_QUOTA_EXCEEDED', 'Shared AI quota is exhausted. Try again later.', {
        'Retry-After': String(exceededQuota.retryAfter),
      });
      return;
    }
  } catch (error) {
    if (error instanceof QuotaStoreUnavailableError) {
      sendError(req, res, 503, 'AI_QUOTA_UNAVAILABLE', 'AI quota service is temporarily unavailable.');
      return;
    }
    throw error;
  }

  if (activeAIRequests >= maxConcurrentRequests) {
    sendError(req, res, 429, 'CONCURRENCY_LIMITED', 'AI service is busy. Try again shortly.', {
      'Retry-After': '5',
    });
    return;
  }

  activeAIRequests += 1;
  try {
    const raw = await readBody(req);
    let payload;
    try {
      payload = JSON.parse(raw || '{}');
    } catch {
      sendError(req, res, 400, 'INVALID_JSON', 'Request body must be valid JSON.');
      return;
    }

    const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
    if (!prompt) {
      sendError(req, res, 400, 'PROMPT_REQUIRED', 'Prompt is required.');
      return;
    }
    if (prompt.length > maxPromptChars) {
      sendError(req, res, 413, 'PROMPT_TOO_LARGE', 'Prompt is too long.');
      return;
    }

    validateUpstreamConfiguration();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
    timeout.unref?.();

    let upstream;
    try {
      upstream = await fetch(deepseekBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${deepseekApiKey}`,
        },
        body: JSON.stringify({
          model: [...allowedModels][0],
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 10_000,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        sendError(req, res, 504, 'AI_TIMEOUT', 'AI service timed out.');
        return;
      }
      console.error('[AI proxy] upstream request failed', error?.name || 'unknown error');
      sendError(req, res, 502, 'AI_UPSTREAM_UNAVAILABLE', 'AI service is temporarily unavailable.');
      return;
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      if (upstream.status === 429) {
        sendError(req, res, 429, 'AI_UPSTREAM_RATE_LIMITED', 'AI service is rate limited.', {
          'Retry-After': upstream.headers.get('Retry-After') || '30',
        });
        return;
      }
      console.warn(`[AI proxy] upstream responded with ${upstream.status}`);
      const upstreamErrorCode =
        upstream.status === 401 || upstream.status === 403
          ? 'AI_UPSTREAM_AUTH'
          : upstream.status === 402
            ? 'AI_UPSTREAM_BALANCE'
            : upstream.status === 400 || upstream.status === 404 || upstream.status === 422
              ? 'AI_UPSTREAM_INVALID_REQUEST'
              : 'AI_UPSTREAM_ERROR';
      sendError(req, res, 502, upstreamErrorCode, 'AI service returned an error.');
      return;
    }

    const upstreamBody = await upstream.arrayBuffer();
    if (upstreamBody.byteLength > maxUpstreamResponseBytes) {
      sendError(req, res, 502, 'AI_RESPONSE_TOO_LARGE', 'AI service returned an oversized response.');
      return;
    }

    res.writeHead(
      200,
      responseHeaders(req, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
    );
    res.end(Buffer.from(upstreamBody));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      sendError(req, res, 413, 'REQUEST_TOO_LARGE', 'Request body is too large.');
      return;
    }
    console.error('[AI proxy] request failed', error?.name || 'unknown error');
    if (!res.headersSent) sendError(req, res, 500, 'AI_PROXY_ERROR', 'AI proxy failed.');
  } finally {
    activeAIRequests -= 1;
  }
};

const fileExists = (filePath) => {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const getCacheControl = (requestPath, ext) => {
  if (ext === '.html') return 'no-cache';
  if (requestPath.startsWith('/data/')) return 'public, max-age=300, must-revalidate';
  if (['.js', '.css'].includes(ext) && /[-._][A-Za-z0-9]{8,}\.(?:js|css)$/.test(requestPath)) {
    return 'public, max-age=31536000, immutable';
  }
  if (['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico'].includes(ext)) {
    return 'public, max-age=2592000, must-revalidate';
  }
  return 'public, max-age=3600, must-revalidate';
};

const getStaticFile = (requestPath, staticRoot) => {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return { error: 'INVALID_PATH' };
  }

  const resolvedStaticRoot = resolve(staticRoot);
  const relativePath = normalize(decodedPath).replace(/^[/\\]+/, '');
  const candidate = resolve(resolvedStaticRoot, relativePath || 'index.html');
  if (!candidate.startsWith(`${resolvedStaticRoot}/`) && candidate !== resolvedStaticRoot) {
    return { error: 'INVALID_PATH' };
  }
  if (fileExists(candidate)) return { filePath: candidate, requestPath: decodedPath };

  const requestedExt = extname(decodedPath);
  if (requestedExt || decodedPath.startsWith('/data/')) return { error: 'NOT_FOUND' };

  const indexPath = join(resolvedStaticRoot, 'index.html');
  return fileExists(indexPath) ? { filePath: indexPath, requestPath: '/index.html' } : { error: 'NOT_FOUND' };
};

const serveStatic = (req, res, staticRoot) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const result = getStaticFile(url.pathname, staticRoot);
  if (result.error === 'INVALID_PATH') {
    sendError(req, res, 400, 'INVALID_PATH', 'Invalid path.');
    return;
  }
  if (result.error === 'NOT_FOUND' || !result.filePath) {
    sendError(req, res, 404, 'NOT_FOUND', 'Not found.');
    return;
  }

  const ext = extname(result.filePath);
  res.writeHead(
    200,
    responseHeaders(req, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': getCacheControl(result.requestPath, ext),
    })
  );

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(result.filePath);
  stream.on('error', (error) => {
    console.error(`[static] stream failed: ${error?.code || 'unknown error'}`);
    if (res.headersSent) res.destroy();
    else sendError(req, res, 500, 'STATIC_READ_FAILED', 'Unable to read resource.');
  });
  stream.pipe(res);
};

export const createAppServer = ({ staticRoot = distDir } = {}) =>
  createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (requestUrl.pathname === '/api/deepseek/chat') {
        await handleDeepSeek(req, res);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendError(req, res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
        return;
      }
      serveStatic(req, res, staticRoot);
    } catch (error) {
      console.error('[server] request failed', error?.name || 'unknown error');
      if (!res.headersSent) sendError(req, res, 500, 'INTERNAL_ERROR', 'Internal server error.');
      else res.destroy();
    }
  });

const isMainModule =
  moduleLocation.path && process.argv[1] && resolve(process.argv[1]) === resolve(moduleLocation.path);

if (isMainModule) {
  const server = createAppServer();
  server.listen(port, () => {
    console.log(`Anime Horizon listening on ${port}`);
  });
}
