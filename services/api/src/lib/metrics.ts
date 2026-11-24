import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'dressit_' });

export const httpDuration = new client.Histogram({
  name: 'dressit_http_request_duration_seconds',
  help: 'Duración de peticiones HTTP',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const externalCalls = new client.Histogram({
  name: 'dressit_external_call_duration_seconds',
  help: 'Llamadas a dependencias externas (visión, meteorología, comercios)',
  labelNames: ['service', 'outcome'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 120],
  registers: [registry],
});

export const engineDuration = new client.Histogram({
  name: 'dressit_engine_duration_seconds',
  help: 'Tiempo del motor de recomendación',
  labelNames: ['operation'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

/** Cost accounting: units of paid/limited resources consumed (LLM tokens, paid API calls…). */
export const costUnits = new client.Counter({
  name: 'dressit_cost_units_total',
  help: 'Unidades de coste consumidas (tokens LLM, llamadas a APIs con cuota)',
  labelNames: ['provider', 'unit'] as const,
  registers: [registry],
});

export const businessEvents = new client.Counter({
  name: 'dressit_events_total',
  help: 'Eventos de negocio (prendas añadidas, outfits aceptados, importaciones…)',
  labelNames: ['event', 'outcome'] as const,
  registers: [registry],
});

export async function timed<T>(service: string, fn: () => Promise<T>): Promise<T> {
  const end = externalCalls.startTimer({ service });
  try {
    const r = await fn();
    end({ outcome: 'ok' });
    return r;
  } catch (e) {
    end({ outcome: 'error' });
    throw e;
  }
}
