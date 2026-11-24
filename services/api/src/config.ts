import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3000),
  API_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  DATABASE_ADMIN_URL: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  IMAGE_URL_SECRET: z.string().min(32, 'IMAGE_URL_SECRET debe tener al menos 32 caracteres'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('eu-south-2'),
  S3_BUCKET: z.string().default('dressit-images'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  VISION_SERVICE_URL: z.string().default('http://localhost:8001'),
  VISION_TIMEOUT_MS: z.coerce.number().default(120_000),
  // Image generation (catalogue packshots, avatar renders) through a ComfyUI server. Empty = disabled.
  IMAGEGEN_COMFY_URL: z.string().optional(),
  IMAGEGEN_TIMEOUT_MS: z.coerce.number().default(15 * 60_000),
  /** Workflow reported as the garment-photo model in GET /v1/generation/status (the catalogue packshot). */
  IMAGEGEN_STUDIO_WORKFLOW: z.string().default('packshot'),
  IMAGEGEN_AVATAR_WORKFLOW: z.string().default('avatar'),
  // Dedicated try-on service (services/tryon). Empty = only the joint (generative) method.
  TRYON_SERVICE_URL: z.string().optional(),
  TRYON_STEPS: z.coerce.number().int().min(4).max(50).default(20),
  TRYON_TIMEOUT_MS: z.coerce.number().default(10 * 60_000),
  /** Default try-on method when both are available (chosen from the benchmark in docs/probador-virtual.md). */
  AVATAR_METHOD: z.enum(['sequential', 'joint']).default('sequential'),
  // Gate on the worn garments (Sapiens2 regions vs the real garment): calibrated in docs/probador-virtual.md.
  TRYON_MIN_SIMILARITY: z.coerce.number().default(0.6),
  TRYON_MAX_DELTA_E: z.coerce.number().default(15),
  // Avatar renders: minimum mean similarity of the outfit's garments found in the render. Only a
  // filter for gross failures: on worn garments the detector is too weak to judge details (a good
  // and a wrong render both scored ~0.66 on 2026-11-24); the user judges the result next to the outfit.
  IMAGEGEN_AVATAR_MIN_SIMILARITY: z.coerce.number().default(0.5),
  // --- Catalogue photo (docs/foto-catalogo.md): reverse image search first, generative packshot second.
  /** Start the catalogue photo of every new detection automatically (false: only on request). */
  CATALOG_PHOTO_AUTO: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === 'true' || v === '1'),
  /** Which photo variants are searched: the garment crop, the whole photo, or both. */
  CATALOG_SEARCH_QUERIES: z.string().default('crop,full'),
  /** Google Lens through SerpApi (https://serpapi.com/google-lens-api). */
  SERPAPI_API_KEY: z.string().optional(),
  SERPAPI_COUNTRY: z.string().default('es'),
  SERPAPI_HL: z.string().default('es'),
  SERPAPI_COST_CENTS: z.coerce.number().default(2.5),
  /** Google Cloud Vision Web Detection (https://docs.cloud.google.com/vision/docs/detecting-web). */
  GOOGLE_CLOUD_VISION_API_KEY: z.string().optional(),
  GOOGLE_CLOUD_VISION_COST_CENTS: z.coerce.number().default(0.35),
  /** Lykdat Global Search (https://apidocs.lykdat.com/). */
  LYKDAT_API_KEY: z.string().optional(),
  LYKDAT_COST_CENTS: z.coerce.number().default(1.67),
  /** Verified-match thresholds (FashionSigLIP similarity with the user's garment). */
  OFFICIAL_PHOTO_EXACT_SIMILARITY: z.coerce.number().default(0.86),
  OFFICIAL_PHOTO_POSSIBLE_SIMILARITY: z.coerce.number().default(0.78),
  /** Store photos found on the web (not in a licensed feed): link_preview = shown to the owner by
   *  reference from the store (never copied, with attribution); none = only used to identify the product. */
  OFFICIAL_PHOTO_WEB_IMAGES: z.enum(['link_preview', 'none']).default('link_preview'),
  /** Generators in order of preference; the first configured is primary, the next ones fallbacks. */
  PACKSHOT_PROVIDERS: z.string().default('fashn,fal,comfy'),
  /** FASHN Agent Images (https://docs.fashn.ai/api-reference/agent-images). */
  FASHN_API_KEY: z.string().optional(),
  FASHN_GENERATION_MODE: z.enum(['fast', 'balanced', 'quality']).default('balanced'),
  FASHN_RESOLUTION: z.enum(['1k', '2k', '3k', '4k']).default('1k'),
  FASHN_CENTS_PER_CREDIT: z.coerce.number().default(7.5),
  /** fal.ai queue API with Qwen-Image-Edit-2511 (https://fal.ai/models/fal-ai/qwen-image-edit-2511). */
  FAL_KEY: z.string().optional(),
  FAL_PACKSHOT_MODEL: z.string().default('fal-ai/qwen-image-edit-2511'),
  FAL_COST_CENTS: z.coerce.number().default(3.5),
  /** ComfyUI workflow (IMAGEGEN_COMFY_URL) for the local/self-hosted packshot. */
  IMAGEGEN_PACKSHOT_WORKFLOW: z.string().default('packshot'),
  PACKSHOT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  PACKSHOT_TIMEOUT_MS: z.coerce.number().default(15 * 60_000),
  /** Cost control: per-user daily limits and a monthly budget (cents) for all paid providers together. */
  CATALOG_DAILY_SEARCHES_PER_USER: z.coerce.number().int().default(40),
  CATALOG_DAILY_GENERATIONS_PER_USER: z.coerce.number().int().default(20),
  CATALOG_MONTHLY_BUDGET_CENTS: z.coerce.number().default(5000),
  CATALOG_SEARCH_CACHE_DAYS: z.coerce.number().int().default(30),
  CATALOG_PHOTO_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  OPEN_METEO_API_KEY: z.string().optional(),
  LINK_IMPORT_USER_AGENT: z.string().default('DressItLinkPreview/0.1 (+https://github.com/Ale-Newport/DressIt)'),
  LINK_IMPORT_TIMEOUT_MS: z.coerce.number().default(10_000),
  LINK_IMPORT_MAX_BYTES: z.coerce.number().default(3_000_000),
  PRICE_FRESHNESS_HOURS: z.coerce.number().default(24),
  AWIN_PUBLISHER_ID: z.string().optional(),
  AWIN_PRODUCTDATA_API_KEY: z.string().optional(),
  AWIN_FEED_URLS: z.string().optional(),
  AWIN_API_TOKEN: z.string().optional(),
  AWIN_ADVERTISERS: z.string().optional(),
  AWIN_FEED_LOCALE: z.string().regex(/^[a-z]{2}_[A-Z]{2}$/).default('es_ES'),
  RAKUTEN_CLIENT_ID: z.string().optional(),
  RAKUTEN_CLIENT_SECRET: z.string().optional(),
  RAKUTEN_ACCOUNT_ID: z.string().optional(),
  RAKUTEN_ADVERTISERS: z.string().optional(),
  TRADEDOUBLER_PRODUCTS_TOKEN: z.string().optional(),
  TRADEDOUBLER_FEEDS: z.string().optional(),
  CJ_PERSONAL_ACCESS_TOKEN: z.string().optional(),
  CJ_COMPANY_ID: z.string().optional(),
  CJ_WEBSITE_ID: z.string().optional(),
  CJ_ADVERTISERS: z.string().optional(),
  EBAY_CLIENT_ID: z.string().optional(),
  EBAY_CLIENT_SECRET: z.string().optional(),
  EBAY_MARKETPLACE_ID: z.string().default('EBAY_ES'),
  EBAY_EPN_CAMPAIGN_ID: z.string().optional(),
  INDITEX_CLIENT_ID: z.string().optional(),
  INDITEX_CLIENT_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ASSISTANT_LLM_MODEL: z.string().default('claude-sonnet-5-5'),
  /** Test-only: allow fetching from private addresses (fixture servers on localhost). */
  LINK_IMPORT_ALLOW_PRIVATE: bool,
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.LINK_IMPORT_ALLOW_PRIVATE) {
    throw new Error('LINK_IMPORT_ALLOW_PRIVATE no puede activarse en producción');
  }
  return parsed.data;
}
