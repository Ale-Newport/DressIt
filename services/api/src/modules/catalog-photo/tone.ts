/**
 * Deterministic tone fix for generated packshots of dark garments.
 *
 * Small image models (FLUX.2 klein) light their studio shots evenly and lift dark fabrics: a black
 * polo comes out mid grey. The garment's own lightness is known from the user's cutout, so the
 * generated image is darkened with a lightness curve in CIELAB, L' = 100·(L/100)^γ, chosen so the
 * lightness of the garment's body (30th percentile of L*, which ignores highlights, logos and white
 * trims) matches the reference. The curve keeps L = 100 (the white background)
 * and L = 0 fixed, is monotonic (no halos at the garment's edge) and leaves hue alone (a and b are
 * untouched). It only darkens, and only garments that are dark in the reference photo.
 */
import sharp from 'sharp';

/** Garments whose reference body lightness is above this are left alone (mid tones vary too much with the photo's light). */
export const DARK_REFERENCE_MAX_L = 42;
/** Smaller differences are within what studio lighting legitimately changes. */
export const MIN_LIGHTNESS_GAP = 6;
const MAX_GAMMA = 2.5;
const SAMPLE_SIDE = 256;

export interface ToneFix {
  image: Buffer;
  /** Body lightness (30th percentile of L*) of the garment: reference, generated before and after the fix. */
  referenceL: number;
  generatedL: number;
  correctedL: number;
  gamma: number;
}

// sRGB ↔ CIELAB (D65).
const LIN = new Float64Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const XN = 0.95047;
const ZN = 1.08883;
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const finv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
const gammaOut = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};

function toLab(r: number, g: number, b: number): [number, number, number] {
  const R = LIN[r]!, G = LIN[g]!, B = LIN[b]!;
  const fx = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN);
  const fy = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const fz = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function fromLab(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const X = XN * finv(fy + a / 500);
  const Y = finv(fy);
  const Z = ZN * finv(fy - b / 200);
  return [
    gammaOut(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z),
    gammaOut(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z),
    gammaOut(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z),
  ];
}

const BODY_PERCENTILE = 0.3;
const percentile = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.floor(p * s.length)]!;
};

/** Body lightness (30th percentile of L*) of the opaque pixels of a cutout (alpha) or of the non-background pixels of a packshot on white. */
export async function garmentLightness(image: Buffer, mode: 'alpha' | 'on-white'): Promise<number> {
  const { data, info } = await sharp(image).ensureAlpha().resize(SAMPLE_SIDE, SAMPLE_SIDE, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const Ls: number[] = [];
  for (let i = 0; i < info.width * info.height * 4; i += 4) {
    if (data[i + 3]! < 200) continue;
    const [L, a, b] = toLab(data[i]!, data[i + 1]!, data[i + 2]!);
    // On a white background: the garment is what is not near-white and neutral (soft shadows on the
    // floor are light grey and fall out too).
    if (mode === 'on-white' && L > 90 && Math.hypot(a, b) < 6) continue;
    Ls.push(L);
  }
  return percentile(Ls, BODY_PERCENTILE);
}

/**
 * Darkens a generated packshot of a dark garment back to the lightness of the reference cutout.
 * Returns null when nothing needs fixing (light garment, close enough, or no garment found).
 */
export async function fixDarkGarmentTone(referenceCutout: Buffer, generated: Buffer): Promise<ToneFix | null> {
  const referenceL = await garmentLightness(referenceCutout, 'alpha');
  if (!(referenceL <= DARK_REFERENCE_MAX_L)) return null;
  const generatedL = await garmentLightness(generated, 'on-white');
  if (!(generatedL - referenceL >= MIN_LIGHTNESS_GAP)) return null;
  const gamma = Math.min(MAX_GAMMA, Math.log(Math.max(referenceL, 1) / 100) / Math.log(generatedL / 100));
  if (!(gamma > 1)) return null;

  // Alpha, if any, is kept as it is; the output is always PNG.
  const { data, info } = await sharp(generated).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  if (ch < 3) return null;
  const out = Buffer.from(data);
  const scale = 100 ** -gamma * 100;
  for (let i = 0; i < data.length; i += ch) {
    const [L, a, b] = toLab(data[i]!, data[i + 1]!, data[i + 2]!);
    const [r, g, bl] = fromLab(scale * Math.max(L, 0) ** gamma, a, b);
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = bl;
  }
  const image = await sharp(out, { raw: { width: info.width, height: info.height, channels: ch as 3 | 4 } }).png().toBuffer();
  return { image, referenceL, generatedL, correctedL: await garmentLightness(image, 'on-white'), gamma };
}
