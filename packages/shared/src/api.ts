/**
 * HTTP API contract between the mobile app and the DressIt API (`/v1`).
 * Every response body is JSON. Errors use {@link ApiError}.
 *
 * Conventions:
 * - Dates: ISO-8601 strings. `date` fields are local calendar dates (YYYY-MM-DD).
 * - Money: integer cents + ISO currency (always EUR in Spain today).
 * - Image URLs are short-lived signed URLs (HMAC) served by the API; never cache them > 12h.
 * - Anything that comes from a third party carries provenance (`source`, `verifiedAt`).
 *
 * Scales (unless a field says otherwise):
 * - Scores, breakdowns, `styleMatch`, `similarity`, `confidence`, `progress`, `avgScore`,
 *   `redundancy` and alternatives `delta` are 0–1 (delta can be negative).
 * - Garment/outfit `formality` is 0–100. Garment `warmth` is clothing insulation in clo (≈0–1.5).
 * - Catalog price filters (`minPrice`/`maxPrice`) are in euros; every returned amount is in cents.
 * - Date ranges (`from`/`to`) are inclusive. Lists without a cursor return at most 200 items (history: 400).
 */
import type {
  Category,
  Condition,
  Fit,
  GarmentSource,
  GarmentStatus,
  ImagePolicy,
  IntegrationStatus,
  Season,
  SpaceKind,
  StyleId,
} from './vocabulary.ts';

export interface ApiError {
  error: {
    code: string;
    /** Human readable, Spanish. Safe to show to the user. */
    message: string;
    details?: unknown;
  };
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Auth & profile
// ---------------------------------------------------------------------------

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
  /** Must be true: terms + privacy policy accepted. */
  acceptTerms: boolean;
}
export interface LoginRequest {
  email: string;
  password: string;
}
export interface AuthResponse {
  user: UserDto;
  tokens: AuthTokens;
}

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  locale: string;
  timezone: string;
  plan: 'free' | 'premium';
  location: LocationDto | null;
  onboardingCompleted: boolean;
  createdAt: string;
}

export interface LocationDto {
  name: string;
  /** Rounded to 2 decimals (~1 km). We never store precise location. */
  lat: number;
  lon: number;
  countryCode: string;
}

export interface GeoSearchResult {
  name: string;
  admin1: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lon: number;
}

export type Priority = 'comfort' | 'elegance' | 'practicality';

export interface PreferencesDto {
  preferredStyles: StyleId[];
  favoriteColors: string[];
  avoidedColors: string[];
  fitPreferences: { top?: Fit; bottom?: Fit };
  sizes: { top?: string; bottom?: string; shoes?: string; dress?: string };
  favoriteBrands: string[];
  budget: { minEur: number | null; maxEur: number | null };
  sustainability: { secondHand: boolean; prioritizeSustainable: boolean };
  usualContexts: string[];
  /** Weights sum to 1. */
  priorities: Record<Priority, number>;
  /** Typical departure and return times for daily recommendations (HH:MM). */
  dayWindow: { start: string; end: string };
  /** -2 (always warm) … +2 (always cold). Shifts the thermal model. */
  temperatureSensitivity: number;
}

export type ConsentKind =
  | 'terms'
  | 'privacy'
  | 'photo_processing'
  | 'location'
  | 'calendar'
  | 'email_import'
  | 'ai_assistant_external'
  | 'analytics'
  | 'marketing';

/** `PUT /v1/me/consents/:kind`. Terms/privacy cannot be revoked (delete the account instead). */
export interface ConsentDto {
  kind: ConsentKind;
  granted: boolean;
  version: string;
  /** null when the user has never decided on this consent (treated as not granted). */
  updatedAt: string | null;
}

export interface StyleProfileDto {
  feedbackCount: number;
  topStyles: Array<{ style: StyleId; weight: number }>;
  topColors: Array<{ family: string; weight: number }>;
  /** Learned ranking weights (for transparency screens). */
  rankingWeights: Record<string, number>;
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Wardrobe
// ---------------------------------------------------------------------------

export interface ColorDto {
  hex: string;
  family: string;
  /** Share of the garment surface 0–1. */
  share: number;
}

export interface ImageRefDto {
  id: string;
  /** Signed URL; variant chosen by the API (cutout preferred). */
  url: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  /** True when the background was removed (transparent PNG). */
  isCutout: boolean;
  license: 'user_owned' | 'retailer_licensed' | 'retailer_link_preview';
  attribution: string | null;
}

export interface GarmentDto {
  id: string;
  name: string;
  category: Category;
  subcategory: string;
  brand: string | null;
  colors: ColorDto[];
  primaryColor: string | null;
  pattern: string | null;
  materials: string[];
  styles: StyleId[];
  seasons: Season[];
  occasions: string[];
  formality: number;
  warmth: number;
  waterproof: boolean;
  fit: Fit | null;
  size: string | null;
  condition: Condition | null;
  status: GarmentStatus;
  favorite: boolean;
  spaceId: string | null;
  tags: string[];
  image: ImageRefDto | null;
  source: GarmentSource;
  sourceUrl: string | null;
  isDemo: boolean;
  wearCount: number;
  lastWornOn: string | null;
  purchaseDate: string | null;
  purchasePrice: MoneyDto | null;
  /** purchasePrice / max(wearCount, 1); null without a price. */
  costPerWear: MoneyDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface MoneyDto {
  cents: number;
  currency: string;
}

export interface GarmentAttributeDto {
  attribute: string;
  value: unknown;
  /** 0–1 for model predictions; 1 for user-entered values. */
  confidence: number;
  source: string;
  isCurrent: boolean;
  createdAt: string;
}

export interface GarmentDetailDto extends GarmentDto {
  notes: string | null;
  model: string | null;
  images: ImageRefDto[];
  attributes: GarmentAttributeDto[];
  availabilityHistory: Array<{ status: GarmentStatus; startedAt: string; endedAt: string | null; note: string | null }>;
  wearHistory: Array<{ wornOn: string; outfitId: string | null }>;
  compatibleCount: number | null;
}

export interface GarmentWriteDto {
  name?: string;
  category?: Category;
  subcategory?: string;
  brand?: string | null;
  model?: string | null;
  colors?: Array<{ hex: string; share?: number }>;
  pattern?: string | null;
  materials?: string[];
  styles?: StyleId[];
  seasons?: Season[];
  occasions?: string[];
  formality?: number;
  warmth?: number;
  waterproof?: boolean;
  fit?: Fit | null;
  size?: string | null;
  condition?: Condition | null;
  favorite?: boolean;
  spaceId?: string | null;
  tags?: string[];
  notes?: string | null;
  purchaseDate?: string | null;
  purchasePriceCents?: number | null;
  imageId?: string | null;
}

export interface GarmentListQuery {
  /** Full-text search (Spanish, accent-insensitive) over name, brand, type, colour, materials and notes. */
  q?: string;
  /** Default `all` = every status except `retired`. */
  status?: GarmentStatus | 'all';
  category?: Category;
  subcategory?: string;
  /** Colour family id (e.g. `azul_marino`), not a hex. */
  color?: string;
  /** Case-insensitive substring. */
  brand?: string;
  style?: StyleId;
  season?: Season;
  material?: string;
  occasion?: string;
  favorite?: boolean;
  /** Tag name (case-insensitive), not id. */
  tag?: string;
  spaceId?: string;
  usage?: 'new' | 'unused' | 'rarely_used' | 'most_used';
  sort?: 'recent' | 'oldest' | 'least_worn' | 'most_worn' | 'cost_per_wear' | 'name';
  cursor?: string;
  limit?: number;
}

export interface BulkGarmentUpdate {
  ids: string[];
  patch: {
    status?: GarmentStatus;
    spaceId?: string | null;
    favorite?: boolean;
    addTags?: string[];
    removeTags?: string[];
    seasons?: Season[];
    styles?: StyleId[];
  };
}

export interface StatusChangeRequest {
  status: GarmentStatus;
  note?: string;
  lentTo?: string;
}

export interface SpaceDto {
  id: string;
  name: string;
  kind: SpaceKind;
  position: number;
  garmentCount: number;
}

export interface WardrobeStatsDto {
  totalGarments: number;
  byCategory: Array<{ key: string; count: number }>;
  byColor: Array<{ key: string; count: number }>;
  byStyle: Array<{ key: string; count: number }>;
  byStatus: Array<{ key: string; count: number }>;
  bySeason: Array<{ key: string; count: number }>;
  totalValue: MoneyDto | null;
  avgCostPerWear: MoneyDto | null;
  neverWorn: GarmentDto[];
  mostWorn: GarmentDto[];
  leastWorn: GarmentDto[];
  overRepresented: Array<{ subcategory: string; colorFamily: string | null; count: number; message: string }>;
  duplicateGroups: Array<{ garmentIds: string[]; reason: string; score: number }>;
  outfitsWornLast30Days: number;
}

// ---------------------------------------------------------------------------
// Capture & imports
// ---------------------------------------------------------------------------

export type UploadKind = 'garment_photo' | 'receipt' | 'label' | 'screenshot' | 'inspiration' | 'visual_search';

export interface UploadResponse {
  imageId: string;
  /** Exact-duplicate of an existing upload (same SHA-256). */
  duplicateOfImageId: string | null;
}

export interface PhotoImportRequest {
  /** 1–50 images from `POST /v1/uploads` (kind `garment_photo`). */
  imageIds: string[];
  /** 'multi' = detect several garments per photo (flat lays, outfit photos). */
  mode: 'single' | 'multi';
  source: 'camera' | 'gallery' | 'batch';
}

export type ImportJobStatus = 'queued' | 'processing' | 'needs_review' | 'completed' | 'failed' | 'cancelled';

export interface PredictedField<T> {
  value: T;
  confidence: number;
  alternatives?: Array<{ value: T; confidence: number }>;
}

export interface DetectionDto {
  id: string;
  imageId: string;
  cutout: ImageRefDto | null;
  bbox: [number, number, number, number] | null;
  state: 'pending' | 'accepted' | 'rejected' | 'merged';
  garmentId: string | null;
  predicted: {
    category?: PredictedField<Category>;
    subcategory?: PredictedField<string>;
    colors?: ColorDto[];
    pattern?: PredictedField<string>;
    materials?: PredictedField<string[]>;
    styles?: PredictedField<StyleId[]>;
    seasons?: PredictedField<Season[]>;
    formality?: PredictedField<number>;
    warmth?: PredictedField<number>;
    fit?: PredictedField<Fit>;
    brand?: PredictedField<string>;
  };
  duplicate: { garmentId: string; score: number; kind: 'exact_photo' | 'near_photo' | 'similar_garment' } | null;
  warnings: string[];
}

export interface ImportJobDto {
  id: string;
  kind: 'image_analysis' | 'link_import' | 'receipt_parse';
  status: ImportJobStatus;
  progress: number;
  total: number;
  processed: number;
  detections: DetectionDto[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Overrides are merged field by field over the model's predictions (a field you send replaces the
 * prediction; omitted fields keep it). `accept-all` accepts only confident, non-duplicate detections
 * without overrides and leaves the rest pending for review.
 */
export interface AcceptDetectionRequest {
  overrides?: GarmentWriteDto;
}

// --- Link import -----------------------------------------------------------

export type FieldSource = 'json_ld' | 'microdata' | 'open_graph' | 'meta' | 'url' | 'page_capture' | 'feed' | 'api' | 'user' | 'inferred';

export interface ProvenancedField<T> {
  value: T;
  /** True only when read from the retailer's own page/feed/API at `verifiedAt`. */
  verified: boolean;
  source: FieldSource;
}

export interface ImportedProductDto {
  id: string;
  retailer: RetailerSummaryDto | null;
  url: string;
  canonicalUrl: string | null;
  externalId: string | null;
  title: ProvenancedField<string> | null;
  brand: ProvenancedField<string> | null;
  description: ProvenancedField<string> | null;
  category: ProvenancedField<Category> | null;
  subcategory: ProvenancedField<string> | null;
  colorName: ProvenancedField<string> | null;
  colorFamily: ProvenancedField<string> | null;
  price: ProvenancedField<MoneyDto> | null;
  originalPrice: ProvenancedField<MoneyDto> | null;
  availability: ProvenancedField<'in_stock' | 'out_of_stock' | 'preorder' | 'unknown'> | null;
  sizes: ProvenancedField<string[]> | null;
  variants: Array<{ id: string | null; color: string | null; size: string | null; sku: string | null; gtin: string | null; available: boolean | null }>;
  /** Only populated when the retailer's image policy allows displaying them. */
  images: ImageRefDto[];
  imagePolicy: ImagePolicy;
  fetchStatus: 'resolved' | 'partial' | 'blocked' | 'unsupported_domain' | 'not_product' | 'error';
  fetchMessage: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface LinkImportRequest {
  url: string;
}

/** Structured data captured on-device from a page the user is viewing (in-app browser / share extension). */
/**
 * The retailer is resolved from the URL host; a JSON-LD `url` pointing to another site is ignored.
 * Captured fields are marked `source: 'page_capture'` (read from the page on the user's device).
 */
export interface PageCaptureRequest {
  url: string;
  /** Raw JSON-LD blocks found in the page (strings, max 20, each ≤ 200 KB). */
  jsonLd: string[];
  /** <meta property/name> pairs (og:*, product:*, twitter:*). */
  meta: Record<string, string>;
  /**
   * schema.org microdata: first value per itemprop (`content` attribute, else `src`/`href`,
   * else trimmed text ≤ 300 chars). Some stores (e.g. Mango) publish microdata instead of JSON-LD.
   * Keys: name, brand, price, priceCurrency, availability, color, sku, gtin13, image, size.
   */
  microdata?: Record<string, string>;
  title: string | null;
  capturedAt: string;
}

export interface LinkToWardrobeRequest {
  size?: string | null;
  colorName?: string | null;
  /** User photo (preferred when retailer images are not licensed). */
  imageId?: string | null;
  purchaseDate?: string | null;
  purchasePriceCents?: number | null;
  overrides?: GarmentWriteDto;
}

/**
 * There is no separate EAN endpoint: send the code as text (`"EAN 8436533720011"`, source `label`);
 * valid EAN-8/13 codes are matched against licensed catalog variants.
 */
export interface ReceiptTextImportRequest {
  /** Text recognised on-device (OCR) or pasted/shared from an e-mail. May be empty when `imageId` is sent (server-side OCR). */
  text?: string;
  imageId?: string | null;
  source: 'receipt' | 'screenshot' | 'email' | 'label' | 'retailer_export';
}

export interface ReceiptImportResult {
  retailer: RetailerSummaryDto | null;
  orderRef: string | null;
  purchaseDate: string | null;
  lines: Array<{
    description: string;
    reference: string | null;
    ean: string | null;
    size: string | null;
    colorName: string | null;
    priceCents: number | null;
    productUrl: string | null;
    /** Matched licensed catalog product, if any (by EAN/reference). */
    catalogProductId: string | null;
  }>;
  productUrls: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Weather & context
// ---------------------------------------------------------------------------

export interface HourlyWeatherDto {
  time: string;
  temperature: number;
  apparentTemperature: number;
  precipitationProbability: number;
  precipitation: number;
  windSpeed: number;
  humidity: number;
  uvIndex: number;
  weatherCode: number;
}

export interface DayWeatherDto {
  date: string;
  locationName: string;
  timezone: string;
  provider: string;
  fetchedAt: string;
  /** Window used for the recommendation (user's departure → return). */
  window: { start: string; end: string };
  tempMin: number;
  tempMax: number;
  apparentMin: number;
  apparentMax: number;
  /** Temperature at departure and at return (window bounds). */
  tempAtStart: number;
  tempAtEnd: number;
  precipitationProbabilityMax: number;
  precipitationSum: number;
  /** Local times `YYYY-MM-DDTHH:MM` (hour starts, inclusive) in `timezone`. */
  rainPeriods: Array<{ from: string; to: string; maxProbability: number }>;
  windMax: number;
  humidityAvg: number;
  uvMax: number;
  summary: string;
  hourly: HourlyWeatherDto[];
  stale: boolean;
}

// ---------------------------------------------------------------------------
// Outfits & recommendations
// ---------------------------------------------------------------------------

export type OutfitSlot = 'base' | 'mid' | 'outer' | 'bottom' | 'one_piece' | 'footwear' | `accessory:${string}`;

export interface OutfitItemDto {
  slot: OutfitSlot;
  garment: GarmentDto | null;
  /** When simulating a purchase, the candidate product sits here instead of a garment. */
  candidateProduct: ProductSummaryDto | null;
}

export interface ScoreBreakdownDto {
  total: number;
  color: number;
  style: number;
  formality: number;
  weather: number;
  material: number;
  silhouette: number;
  personal: number;
  rotation: number;
}

export interface OutfitDto {
  id: string;
  name: string | null;
  items: OutfitItemDto[];
  occasion: string | null;
  score: number;
  breakdown: ScoreBreakdownDto;
  /** Short Spanish sentences, most important first. */
  explanation: string[];
  weatherNote: string | null;
  formality: number;
  styleMatch: number;
  isExploration: boolean;
  isSaved: boolean;
  isFavorite: boolean;
  status: 'suggested' | 'saved' | 'accepted' | 'rejected' | 'worn';
  source: 'generated' | 'manual' | 'assistant' | 'simulation' | 'trip';
  /** Flat-lay layout (normalised 0–1 coordinates) computed server-side. */
  layout: Array<{ slot: OutfitSlot; x: number; y: number; w: number; h: number; z: number }>;
  createdAt: string;
}

export interface RecommendationRequest {
  date?: string;
  occasion?: string;
  eventId?: string;
  count?: number;
  adjustments?: {
    formality?: -1 | 0 | 1;
    warmth?: -1 | 0 | 1;
    elegance?: 0 | 1;
  };
  mustInclude?: string[];
  exclude?: string[];
  excludeSubcategories?: string[];
  /** Overrides user's default day window. */
  dayWindow?: { start: string; end: string };
  indoorShare?: number;
  seed?: number;
}

export interface RecommendationResponse {
  requestId: string;
  greeting: string;
  weather: DayWeatherDto | null;
  weatherError: string | null;
  occasion: { id: string; label: string };
  outfits: OutfitDto[];
  /** Why fewer outfits than requested could be generated, if so. */
  warnings: string[];
}

export interface AlternativesResponse {
  slot: OutfitSlot;
  current: GarmentDto | null;
  alternatives: Array<{ garment: GarmentDto; score: number; delta: number; reason: string }>;
}

export interface SwapRequest {
  slot: OutfitSlot;
  /** null removes the item from an optional slot (outer/mid/accessory). */
  garmentId: string | null;
}

export type FeedbackAction = 'accept' | 'reject' | 'save' | 'unsave' | 'favorite' | 'unfavorite' | 'rate';

export interface FeedbackRequest {
  action: FeedbackAction;
  /** 1–5 when action = rate. */
  rating?: number;
  reasons?: Array<'colores' | 'formalidad' | 'abrigo' | 'estilo' | 'comodidad' | 'repetido' | 'otro'>;
}

export interface WearRequest {
  date: string;
}

export interface ManualOutfitRequest {
  name?: string;
  occasion?: string;
  items: Array<{ slot: OutfitSlot; garmentId: string }>;
}

export interface UsageHistoryDto {
  id: string;
  wornOn: string;
  outfit: OutfitDto | null;
  garments: GarmentDto[];
  occasion: string | null;
}

// ---------------------------------------------------------------------------
// Calendar & planner & trips
// ---------------------------------------------------------------------------

export interface CalendarEventDto {
  id: string;
  source: 'manual' | 'device' | 'google' | 'outlook';
  title: string;
  occasion: string | null;
  startsAt: string;
  endsAt: string | null;
  isOutdoor: boolean | null;
  locationName: string | null;
}

export interface CalendarEventWrite {
  title: string;
  occasion?: string | null;
  startsAt: string;
  endsAt?: string | null;
  isOutdoor?: boolean | null;
  locationName?: string | null;
}

export interface DeviceCalendarSyncRequest {
  /** Only the minimum fields; descriptions/attendees are never sent. */
  events: Array<{ externalId: string; title: string; startsAt: string; endsAt: string | null; allDay: boolean; locationName: string | null }>;
  rangeStart: string;
  rangeEnd: string;
}

export interface PlanDto {
  id: string;
  date: string;
  position: number;
  outfit: OutfitDto;
  event: CalendarEventDto | null;
  note: string | null;
}

export interface PlannerDayDto {
  date: string;
  plans: PlanDto[];
  events: CalendarEventDto[];
  conflicts: Array<{ planId: string; garmentId: string; kind: 'unavailable' | 'worn_recently' | 'planned_twice'; message: string }>;
}

export interface PlanWrite {
  date: string;
  outfitId: string;
  eventId?: string | null;
  note?: string | null;
  position?: number;
}

/** Days that already have a plan are kept and skipped; garments used earlier in the week are avoided. */
export interface SuggestWeekRequest {
  from: string;
  days: number;
  occasions?: Record<string, string>;
}

/**
 * `activities` accepts occasion ids (e.g. `paseo`, `cena`, `actividad_deportiva`) or free Spanish text,
 * which is classified into an occasion. `destinationName` is a display label (use /v1/geo/search).
 */
export interface TripRequest {
  destinationName: string;
  lat: number;
  lon: number;
  startDate: string;
  endDate: string;
  activities: string[];
  luggage: 'mochila' | 'cabina' | 'mediana' | 'grande';
}

export interface TripDto {
  id: string;
  destinationName: string;
  startDate: string;
  endDate: string;
  activities: string[];
  luggage: TripRequest['luggage'];
  maxItems: number;
  weatherSummary: string | null;
  weatherAvailable: boolean;
  capsule: GarmentDto[];
  packingList: Array<{ garment: GarmentDto; quantity: number; packed: boolean }>;
  extras: string[];
  days: Array<{ date: string; occasion: string; outfit: OutfitDto | null; weather: string | null }>;
  warnings: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Retail, catalog, shopping
// ---------------------------------------------------------------------------

export interface RetailerSummaryDto {
  id: string;
  name: string;
  group: string | null;
}

export interface RetailerIntegrationDto {
  retailer: RetailerSummaryDto;
  domains: string[];
  status: IntegrationStatus;
  capabilities: {
    linkImport: boolean;
    pageCapture: boolean;
    catalogSearch: boolean;
    prices: boolean;
    availability: boolean;
    images: boolean;
    affiliateLinks: boolean;
    visualSearch: boolean;
  };
  imagePolicy: ImagePolicy;
  provider: string;
  notes: string;
  requires: string | null;
  lastCheckedAt: string | null;
  lastCheckResult: string | null;
}

export interface ProductSummaryDto {
  id: string;
  kind: 'catalog' | 'imported';
  retailer: RetailerSummaryDto;
  brand: string | null;
  title: string;
  category: Category | null;
  subcategory: string | null;
  colorName: string | null;
  colorFamily: string | null;
  price: MoneyDto | null;
  originalPrice: MoneyDto | null;
  discountPercent: number | null;
  sizes: Array<{ label: string; available: boolean | null }>;
  availability: 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown';
  image: ImageRefDto | null;
  productUrl: string;
  /** When price/availability were last verified at the source. */
  verifiedAt: string | null;
  /** Data older than the freshness window is flagged: never present it as current. */
  isStale: boolean;
  isSponsored: boolean;
  isAffiliate: boolean;
}

export interface CatalogSearchQuery {
  q?: string;
  retailer?: string;
  brand?: string;
  category?: Category;
  subcategory?: string;
  color?: string;
  style?: StyleId;
  size?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'discount';
  cursor?: string;
  limit?: number;
}

export type ShoppingSection =
  | 'para_ti'
  | 'completa_armario'
  | 'combina_favoritos'
  | 'novedades'
  | 'versatiles'
  | 'ofertas_marcas'
  | 'bajo_presupuesto';

export interface ShoppingRecommendationDto {
  product: ProductSummaryDto;
  score: number;
  newOutfits: number;
  redundancy: number;
  reasons: string[];
  breakdown: Record<string, number>;
}

export interface ShoppingSectionDto {
  section: ShoppingSection;
  title: string;
  items: ShoppingRecommendationDto[];
  emptyReason: string | null;
}

export interface WardrobeGapDto {
  key: string;
  label: string;
  subcategory: string;
  colorFamily: string;
  newOutfits: number;
  partners: number;
  reason: string;
  matchingProducts: ProductSummaryDto[];
}

export interface SimulationRequest {
  product: { kind: 'catalog' | 'imported'; id: string };
  occasion?: string;
  limit?: number;
}

/**
 * Simulated outfits are stored with `source: 'simulation'` (retention 7 days) so they can be opened
 * and saved; the product is never added to the wardrobe until the user confirms ownership.
 */
export interface SimulationResponse {
  product: ProductSummaryDto;
  inferred: { category: Category; subcategory: string; colorFamily: string | null; confidence: number; warnings: string[] };
  outfits: OutfitDto[];
  baseline: { outfitCount: number; avgScore: number };
  withProduct: { outfitCount: number; newOutfits: number; avgScore: number };
  partners: GarmentDto[];
  similarOwned: Array<{ garment: GarmentDto; similarity: number; reason: string }>;
  utility: { score: number; label: 'alta' | 'media' | 'baja' | 'redundante'; explanation: string };
}

export interface VisualSearchRequest {
  imageId: string;
  category?: Category;
  limit?: number;
}

export interface VisualSearchResponse {
  results: Array<{ product: ProductSummaryDto; similarity: number; match: 'similar' | 'exact' }>;
  searchedProducts: number;
  sources: string[];
  message: string | null;
}

export interface WishlistItemDto {
  id: string;
  product: ProductSummaryDto;
  note: string | null;
  createdAt: string;
}

export interface OutboundLinkResponse {
  url: string;
  isAffiliate: boolean;
  disclosure: string | null;
}

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------

export interface AssistantMessageRequest {
  conversationId?: string;
  text: string;
}

export type AssistantCard =
  | { type: 'outfits'; outfits: OutfitDto[] }
  | { type: 'garments'; garments: GarmentDto[] }
  | { type: 'products'; products: ProductSummaryDto[]; emptyReason: string | null }
  | { type: 'weather'; weather: DayWeatherDto }
  | { type: 'trip'; trip: TripDto }
  | { type: 'gaps'; gaps: WardrobeGapDto[] };

export interface AssistantMessageResponse {
  conversationId: string;
  reply: string;
  cards: AssistantCard[];
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  engine: 'rules' | 'llm';
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

export interface HomeResponse {
  greeting: string;
  weather: DayWeatherDto | null;
  weatherError: string | null;
  suggestedOccasion: { id: string; label: string; fromEventId: string | null };
  upcomingEvents: CalendarEventDto[];
  todayPlan: PlanDto | null;
  pendingReviewCount: number;
  garmentCount: number;
}
