/**
 * Profiles a ComfyUI workflow node by node (websocket `executing` events) to see where the time goes.
 *
 *   node scripts/imagegen-profile.ts <workflow> <photo.jpg> <out.png> [subcategory] [colour] [WxH] [runs]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { getSubcategory } from '@dressit/shared';
import { ComfyClient, fillWorkflow, loadWorkflow } from '../src/modules/imagegen/comfy.ts';
import { buildPackshotPrompt } from '../src/modules/catalog-photo/prompt.ts';

const [workflowName = 'packshot', src, out, subcategory = 'camiseta', family, size = '896x1120', runsArg = '2'] = process.argv.slice(2);
const url = process.env.IMAGEGEN_COMFY_URL || 'http://127.0.0.1:8188';
const [W, H] = size.split('x').map(Number);
const client = new ComfyClient(url);
const category = getSubcategory(subcategory)?.category ?? 'top';
const prompt = buildPackshotPrompt({ category, subcategory, colors: family ? [{ family, share: 1 }] : [], pattern: null, materials: [], text: null, brand: null });
const photo = await sharp(readFileSync(src!)).rotate().jpeg({ quality: 92 }).toBuffer();

for (let run = 1; run <= Number(runsArg); run++) {
  const name = await client.uploadImage(photo, `prof_${randomUUID()}.jpg`);
  const wf = fillWorkflow(loadWorkflow(workflowName), { INPUT_IMAGE: name, PROMPT: prompt.prompt, SEED: 42 + run, WIDTH: W!, HEIGHT: H! });
  const clientId = randomUUID();
  const ws = new WebSocket(`${url.replace(/^http/, 'ws')}/ws?clientId=${clientId}`);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const t0 = performance.now();
  let last = t0;
  let lastNode = 'queue';
  const times: Record<string, number> = {};
  const done = new Promise<void>((resolve, reject) => {
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      const msg = JSON.parse(ev.data) as { type: string; data: { node?: string | null; prompt_id?: string } };
      if (msg.type === 'executing' || msg.type === 'execution_success') {
        const now = performance.now();
        times[lastNode] = (times[lastNode] ?? 0) + (now - last);
        last = now;
        const node = msg.data.node;
        if (msg.type === 'execution_success' || node == null) return resolve();
        lastNode = `${node}:${wf[node]?.class_type}`;
      } else if (msg.type === 'execution_error') reject(new Error(JSON.stringify(msg.data).slice(0, 500)));
    });
  });
  const res = await fetch(`${url}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: clientId }) });
  const { prompt_id } = (await res.json()) as { prompt_id: string };
  await done;
  ws.close();
  const total = (performance.now() - t0) / 1000;
  console.log(`\n${workflowName} ${W}x${H} run ${run}: ${total.toFixed(1)} s`);
  for (const [k, v] of Object.entries(times).sort((a, b) => b[1] - a[1])) if (v > 200) console.log(`  ${(v / 1000).toFixed(1).padStart(6)} s  ${k}`);
  const hist = (await (await fetch(`${url}/history/${prompt_id}`)).json()) as Record<string, { outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }> }>;
  const img = Object.values(hist[prompt_id]!.outputs).flatMap((o) => o.images ?? [])[0]!;
  const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
  writeFileSync(out!.replace(/(\.\w+)$/, `-${run}$1`), Buffer.from(await (await fetch(`${url}/view?${q}`)).arrayBuffer()));
}
