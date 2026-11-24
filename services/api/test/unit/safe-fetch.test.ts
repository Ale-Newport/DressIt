import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchBlockedError, isPublicAddress, parseRobots, robotsAllows, safeFetch, validateUrl } from '../../src/lib/safe-fetch.ts';

describe('SSRF protection', () => {
  it('classifies addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::a00:1']) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ['8.8.8.8', '151.101.1.1', '2a00:1450:4003:80e::200e']) expect(isPublicAddress(ip), ip).toBe(true);
  });
  it('rejects dangerous URLs before any network access', () => {
    const bad = ['file:///etc/passwd', 'ftp://example.com/x', 'http://localhost/', 'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]/', 'http://user:pass@example.com/', 'http://example.com:8080/', 'http://metadata.google.internal/', 'http://printer.local/'];
    for (const u of bad) expect(() => validateUrl(u), u).toThrow(FetchBlockedError);
    expect(validateUrl('https://www.zara.com/es/es/x.html#frag').toString()).toBe('https://www.zara.com/es/es/x.html');
  });
  it('blocks hostnames that resolve to private addresses (DNS check at connect time)', async () => {
    // localtest.me style names are not needed: "localhost." with a trailing dot bypasses the name regex but resolves to loopback.
    await expect(safeFetch('http://localhost./', { userAgent: 'test', timeoutMs: 3000, maxBytes: 1000, respectRobots: false })).rejects.toMatchObject({ reason: expect.stringMatching(/private_address|invalid_url|network/) });
  });
});

describe('robots.txt', () => {
  const txt = `User-agent: *\nDisallow: /checkout\nDisallow: /*.json$\nAllow: /checkout/help\n\nUser-agent: DressItLinkPreview\nDisallow: /private\n`;
  it('uses the specific group for our agent', () => {
    const rules = parseRobots(txt, 'DressItLinkPreview');
    expect(robotsAllows(rules, '/private/x')).toBe(false);
    expect(robotsAllows(rules, '/checkout')).toBe(true);
  });
  it('falls back to * with longest-match precedence', () => {
    const rules = parseRobots(txt, 'OtherBot');
    expect(robotsAllows(rules, '/checkout/cart')).toBe(false);
    expect(robotsAllows(rules, '/checkout/help')).toBe(true);
    expect(robotsAllows(rules, '/data.json')).toBe(false);
    expect(robotsAllows(rules, '/data.json?x=1')).toBe(true);
    expect(robotsAllows(rules, '/es/producto.html')).toBe(true);
  });
});

describe('safeFetch against a local fixture server', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/robots.txt') return res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow: /no-bots\n');
      if (req.url === '/redirect-private') return res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
      if (req.url === '/big') return res.writeHead(200, { 'content-type': 'text/html' }).end('x'.repeat(50_000));
      if (req.url === '/binary') return res.writeHead(200, { 'content-type': 'application/octet-stream' }).end('x');
      if (req.url === '/slow') return setTimeout(() => res.writeHead(200, { 'content-type': 'text/html' }).end('ok'), 3000);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<html><title>ok</title></html>');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  const opts = { userAgent: 'DressItLinkPreview/test', timeoutMs: 1500, maxBytes: 10_000, allowPrivate: true };

  it('fetches allowed pages', async () => {
    const r = await safeFetch(`${base}/page`, opts);
    expect(r.status).toBe(200);
    expect(r.body).toContain('ok');
  });
  it('refuses private targets when not explicitly allowed', async () => {
    await expect(safeFetch(`${base}/page`, { ...opts, allowPrivate: false })).rejects.toMatchObject({ reason: 'invalid_url' });
  });
  it('re-validates redirects (no redirect to cloud metadata)', async () => {
    await expect(safeFetch(`${base}/redirect-private`, { ...opts, allowPrivate: false })).rejects.toBeInstanceOf(FetchBlockedError);
  });
  it('honours robots.txt', async () => {
    await expect(safeFetch(`${base}/no-bots`, opts)).rejects.toMatchObject({ reason: 'robots_disallowed' });
  });
  it('enforces size, content-type and timeout limits', async () => {
    await expect(safeFetch(`${base}/big`, opts)).rejects.toMatchObject({ reason: 'too_large' });
    await expect(safeFetch(`${base}/binary`, opts)).rejects.toMatchObject({ reason: 'bad_content_type' });
    await expect(safeFetch(`${base}/slow`, opts)).rejects.toMatchObject({ reason: 'timeout' });
  });
});
