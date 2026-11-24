/** End-to-end latency of key endpoints against a running API. Usage: node scripts/latency.ts <email> <password> */
const B = process.env.API_URL ?? 'http://localhost:3000';
const [email, password] = process.argv.slice(2);
const login = (await (await fetch(`${B}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()) as { tokens: { accessToken: string } };
const h = { authorization: `Bearer ${login.tokens.accessToken}`, 'content-type': 'application/json' };
async function measure(name: string, n: number, fn: () => Promise<Response>) {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const r = await fn();
    await r.arrayBuffer();
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const q = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!.toFixed(0);
  console.log(`| ${name} | ${n} | ${q(0.5)} | ${q(0.95)} |`);
}
console.log('| Endpoint | Peticiones | p50 (ms) | p95 (ms) |\n|---|---|---|---|');
await measure('POST /v1/outfits/recommendations (4 conjuntos, tiempo en caché)', 30, () => fetch(`${B}/v1/outfits/recommendations`, { method: 'POST', headers: h, body: JSON.stringify({ count: 4 }) }));
await measure('GET /v1/garments', 50, () => fetch(`${B}/v1/garments`, { headers: h }));
await measure('GET /v1/home', 30, () => fetch(`${B}/v1/home`, { headers: h }));
await measure('GET /v1/wardrobe/stats', 20, () => fetch(`${B}/v1/wardrobe/stats`, { headers: h }));
await measure('GET /v1/shopping/gaps', 10, () => fetch(`${B}/v1/shopping/gaps`, { headers: h }));
