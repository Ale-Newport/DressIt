/**
 * Color science utilities used across the app, the API and the stylist engine.
 *
 * All perceptual work happens in CIELAB (D65) / LCh. Distances use CIEDE2000,
 * the current CIE recommendation for small/medium color differences.
 */

export type Lab = readonly [number, number, number];
export type Rgb = readonly [number, number, number];

export interface ColorFamilyDef {
  id: string;
  label: string;
  hex: string;
  /** Neutrals combine with almost everything (negro, blanco, gris, beige, marino, denim…). */
  neutral: boolean;
  /** Metallic accents are treated as low-weight neutrals in harmony scoring. */
  metallic?: boolean;
}

export const COLOR_FAMILIES = [
  { id: 'negro', label: 'Negro', hex: '#1a1a1a', neutral: true },
  { id: 'antracita', label: 'Gris antracita', hex: '#3c3d40', neutral: true },
  { id: 'gris', label: 'Gris', hex: '#8c8c8c', neutral: true },
  { id: 'blanco', label: 'Blanco', hex: '#f6f6f4', neutral: true },
  { id: 'crudo', label: 'Crudo', hex: '#ece3d0', neutral: true },
  { id: 'beige', label: 'Beige', hex: '#d6c2a3', neutral: true },
  { id: 'camel', label: 'Camel', hex: '#c09a6b', neutral: true },
  { id: 'marron', label: 'Marrón', hex: '#6b4528', neutral: true },
  { id: 'azul_marino', label: 'Azul marino', hex: '#1f2a44', neutral: true },
  { id: 'denim', label: 'Denim', hex: '#4b6584', neutral: true },
  { id: 'azul', label: 'Azul', hex: '#2f5ea8', neutral: false },
  { id: 'celeste', label: 'Celeste', hex: '#9cc3e6', neutral: false },
  { id: 'turquesa', label: 'Turquesa', hex: '#2bb3b1', neutral: false },
  { id: 'verde', label: 'Verde', hex: '#2e7d4f', neutral: false },
  { id: 'verde_oliva', label: 'Verde oliva', hex: '#6b6b30', neutral: false },
  { id: 'caqui', label: 'Caqui', hex: '#8f8b5e', neutral: true },
  { id: 'menta', label: 'Verde menta', hex: '#a8e0c8', neutral: false },
  { id: 'amarillo', label: 'Amarillo', hex: '#f2d13c', neutral: false },
  { id: 'mostaza', label: 'Mostaza', hex: '#c9a227', neutral: false },
  { id: 'naranja', label: 'Naranja', hex: '#e8772e', neutral: false },
  { id: 'terracota', label: 'Terracota', hex: '#b5563a', neutral: false },
  { id: 'rojo', label: 'Rojo', hex: '#c62828', neutral: false },
  { id: 'burdeos', label: 'Burdeos', hex: '#6d1a2a', neutral: false },
  { id: 'rosa', label: 'Rosa', hex: '#f1a7b8', neutral: false },
  { id: 'fucsia', label: 'Fucsia', hex: '#d6337a', neutral: false },
  { id: 'lila', label: 'Lila', hex: '#c3a6d8', neutral: false },
  { id: 'morado', label: 'Morado', hex: '#6a3d9a', neutral: false },
  { id: 'dorado', label: 'Dorado', hex: '#c9a64b', neutral: true, metallic: true },
  { id: 'plateado', label: 'Plateado', hex: '#c0c2c4', neutral: true, metallic: true },
] as const satisfies readonly ColorFamilyDef[];

export type ColorFamilyId = (typeof COLOR_FAMILIES)[number]['id'];

const FAMILY_BY_ID = new Map<string, ColorFamilyDef>(COLOR_FAMILIES.map((c) => [c.id, c]));

export function getColorFamily(id: string): ColorFamilyDef | undefined {
  return FAMILY_BY_ID.get(id);
}

export function isNeutralFamily(id: string): boolean {
  return FAMILY_BY_ID.get(id)?.neutral ?? false;
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Color hex inválido: ${hex}`);
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab([r, g, b]: Rgb): Lab {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  // sRGB D65 -> XYZ
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X);
  const fy = f(Y);
  const fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToLab(hex: string): Lab {
  return rgbToLab(hexToRgb(hex));
}

export interface Lch {
  L: number;
  C: number;
  /** Hue angle in degrees [0, 360). */
  h: number;
}

export function labToLch([L, a, b]: Lab): Lch {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

/** CIEDE2000 color difference (Sharma, Wu, Dalal 2005 reference implementation). */
export function deltaE2000(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hp = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * rad) +
    0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) -
    0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/** Map an arbitrary color to the nearest named family (used by vision + imports). */
export function nearestColorFamily(hexOrLab: string | Lab): { family: ColorFamilyId; distance: number } {
  const lab = typeof hexOrLab === 'string' ? hexToLab(hexOrLab) : hexOrLab;
  let best: { family: ColorFamilyId; distance: number } = { family: 'gris', distance: Number.POSITIVE_INFINITY };
  for (const fam of COLOR_FAMILIES) {
    if ('metallic' in fam && fam.metallic) continue; // metallics are only assigned explicitly
    const d = deltaE2000(lab, hexToLab(fam.hex));
    if (d < best.distance) best = { family: fam.id, distance: d };
  }
  return best;
}

/** Spanish color words found in retailer titles / user text → family. */
const COLOR_WORDS: ReadonlyArray<[RegExp, ColorFamilyId]> = [
  [/\bnegr[oa]s?\b|\bblack\b/i, 'negro'],
  [/\bantracita\b|\bcharcoal\b/i, 'antracita'],
  [/\bgris(es)?\b|\bgrey\b|\bgray\b|\bmarengo\b/i, 'gris'],
  [/\bblanc[oa]s?\b|\bwhite\b/i, 'blanco'],
  [/\bcrudo\b|\becru\b|\bmarfil\b|\bivory\b|\bhueso\b/i, 'crudo'],
  [/\bbeige\b|\bpiedra\b|\barena\b|\bsand\b|\bstone\b|\btaupe\b|\bvis[oó]n\b/i, 'beige'],
  [/\bcamel\b|\bcaramelo\b|\btostado\b/i, 'camel'],
  [/\bmarr[oó]n(es)?\b|\bchocolate\b|\bbrown\b|\bcoñac\b|\btabaco\b/i, 'marron'],
  [/\bazul marino\b|\bmarino\b|\bnavy\b/i, 'azul_marino'],
  [/\bceleste\b|\bazul claro\b|\bcielo\b|\blight blue\b/i, 'celeste'],
  [/\bdenim\b|\bindigo\b|índigo\b/i, 'denim'],
  [/\bazul(es)?\b|\bblue\b|\bklein\b|\bcobalto\b/i, 'azul'],
  [/\bturquesa\b|\bturquoise\b|\bteal\b|\bpetr[oó]leo\b/i, 'turquesa'],
  [/\bverde oliva\b|\boliva\b|\bolive\b/i, 'verde_oliva'],
  [/\bcaqui\b|\bkaki\b|\bkhaki\b/i, 'caqui'],
  [/\bmenta\b|\bmint\b|\bverde agua\b/i, 'menta'],
  [/\bverdes?\b|\bgreen\b|\bbotella\b/i, 'verde'],
  [/\bmostaza\b|\bmustard\b|\bocre\b/i, 'mostaza'],
  [/\bamarill[oa]s?\b|\byellow\b|\blim[oó]n\b/i, 'amarillo'],
  [/\bnaranja\b|\borange\b|\bcoral\b/i, 'naranja'],
  [/\bterracota\b|\bteja\b|\boxido\b|\bóxido\b|\brust\b|\bcaldera\b/i, 'terracota'],
  [/\bburdeos\b|\bgranate\b|\bburgundy\b|\bvino\b|\bberenjena\b/i, 'burdeos'],
  [/\brojo\b|\broja\b|\bred\b/i, 'rojo'],
  [/\bfucsia\b|\bfuchsia\b|\bmagenta\b/i, 'fucsia'],
  [/\brosa\b|\bpink\b|\bmaquillaje\b|\bnude\b|\bpalo de rosa\b/i, 'rosa'],
  [/\blila\b|\blavanda\b|\blilac\b|\bmalva\b/i, 'lila'],
  [/\bmorad[oa]\b|\bpurple\b|\bviolet[ae]?\b/i, 'morado'],
  [/\bdorad[oa]\b|\bgold\b|\boro\b/i, 'dorado'],
  [/\bplatead[oa]\b|\bsilver\b|\bplata\b/i, 'plateado'],
];

export function colorFamilyFromText(text: string | null | undefined): ColorFamilyId | null {
  if (!text) return null;
  for (const [re, fam] of COLOR_WORDS) if (re.test(text)) return fam;
  return null;
}
