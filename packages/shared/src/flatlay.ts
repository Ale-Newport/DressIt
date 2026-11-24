/**
 * Flat-lay composition shared by the server (stored layouts) and the app (live canvas).
 *
 * Pieces keep their real-world proportions: each subcategory has a typical laid-flat height in
 * centimetres (small accessories get a readability boost) and the cutout's real aspect ratio is used
 * when known. The canvas is split into a main column (the outermost upper garment over the bottom,
 * or a one-piece) and a side column (inner layers, accessories, shoes) packed in rows without
 * overlaps. Within a column every piece shares one scale, found by bisection as the largest that
 * fits; the side column never uses a larger scale than the main one.
 */

export interface FlatLayPiece {
  /** Stable key, returned unchanged (e.g. the outfit slot). */
  key: string;
  /** Outfit slot: base | mid | outer | bottom | one_piece | footwear | accessory:<kind>. */
  slot: string;
  category?: string | null;
  subcategory?: string | null;
  /** Width ÷ height of the (trimmed) cutout, when known. */
  aspect?: number | null;
}

export interface FlatLayBox {
  key: string;
  slot: string;
  /** Normalised 0–1 canvas coordinates (x, w in canvas widths; y, h in canvas heights). */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface FlatLayOptions {
  /** Canvas width ÷ height (default 4:5). */
  canvasAspect?: number;
  /** Outer margin, as a fraction of the canvas height (same visual size horizontally). */
  margin?: number;
  /** Gap between pieces, as a fraction of the canvas height. */
  gap?: number;
}

/** Typical laid-flat height (cm) of each subcategory, as photographed. */
const HEIGHT_CM: Record<string, number> = {
  // outerwear
  abrigo: 100, gabardina: 105, parka: 85, plumifero: 72, chaqueta: 66, americana: 75, bomber: 62,
  cazadora_vaquera: 60, chaqueta_cuero: 62, chaqueta_deportiva: 66, impermeable: 78, chaleco_acolchado: 62,
  // mid layers
  jersey: 64, jersey_grueso: 66, cardigan: 62, sudadera: 66, sobrecamisa: 76, chaleco_punto: 58,
  // base layers
  camiseta: 70, camiseta_manga_larga: 70, camiseta_tecnica: 68, camisa: 78, camisa_manga_corta: 74,
  blusa: 66, polo: 70, top: 46, body: 62,
  // bottoms
  vaquero: 104, pantalon: 104, chino: 102, pantalon_vestir: 106, jogger: 100, leggings: 96, falda: 52,
  falda_larga: 92, pantalon_corto: 50, bermuda: 56, pantalon_deportivo_corto: 46,
  // one-pieces
  vestido: 100, vestido_fiesta: 120, vestido_punto: 100, mono: 140, traje_chandal: 130,
  // footwear (a pair, seen from above)
  zapatillas: 30, zapatillas_lona: 30, zapatillas_running: 31, botas: 44, botines: 32, tacones: 28,
  sandalias: 26, bailarinas: 26, mocasines: 29, alpargatas: 28, zapatos: 30,
  // accessories
  bolso: 32, mochila: 44, bufanda: 62, panuelo: 32, gorro: 24, gorra: 20, sombrero: 22, cinturon: 14,
  gafas_sol: 8, reloj: 9, joyeria: 8, guantes: 24, corbata: 58, paraguas: 70,
  // swimwear
  bikini: 40, banador: 46,
};

const CATEGORY_HEIGHT_CM: Record<string, number> = {
  outerwear: 72, top: 68, bottom: 100, one_piece: 105, footwear: 30, accessory: 26, swimwear: 44,
};

const SLOT_HEIGHT_CM: Record<string, number> = { outer: 72, mid: 64, base: 68, bottom: 100, one_piece: 105, footwear: 30 };

/** Width ÷ height used when the cutout size is unknown. */
const DEFAULT_ASPECT: Record<string, number> = { outer: 0.85, mid: 0.95, base: 0.95, bottom: 0.48, one_piece: 0.6, footwear: 1.25 };
const ACCESSORY_ASPECT: Record<string, number> = { bufanda: 0.55, corbata: 0.25, paraguas: 0.3, bolso: 1.1, mochila: 0.8, cinturon: 1.6, gafas_sol: 2.2 };

const UPPER_ORDER = ['outer', 'mid', 'base'] as const;

/** Real-world height in cm, with a readability boost for small pieces (a ring would vanish). */
export function flatLayHeightCm(piece: Pick<FlatLayPiece, 'slot' | 'category' | 'subcategory'>): number {
  const raw =
    (piece.subcategory ? HEIGHT_CM[piece.subcategory] : undefined) ??
    (piece.category ? CATEGORY_HEIGHT_CM[piece.category] : undefined) ??
    SLOT_HEIGHT_CM[piece.slot] ??
    (piece.slot.startsWith('accessory:') ? CATEGORY_HEIGHT_CM.accessory! : 60);
  // Below ~34 cm pieces are enlarged progressively (a 9 cm watch is drawn like ~19 cm).
  return raw >= 34 ? raw : 34 * Math.pow(raw / 34, 0.55);
}

function aspectOf(piece: FlatLayPiece): number {
  const a = piece.aspect;
  if (a && Number.isFinite(a) && a > 0) return Math.min(6, Math.max(1 / 6, a));
  if (piece.slot.startsWith('accessory:')) return (piece.subcategory ? ACCESSORY_ASPECT[piece.subcategory] : undefined) ?? 1;
  return DEFAULT_ASPECT[piece.slot] ?? 0.9;
}

interface Sized {
  piece: FlatLayPiece;
  cm: number;
  aspect: number;
}

interface Placed extends Sized {
  w: number;
  h: number;
}

/** Sizes at scale `s` (canvas heights per cm), capped to the column width. */
function sizeAt(items: Sized[], s: number, colW: number, canvasAspect: number): Placed[] {
  return items.map((it) => {
    let h = it.cm * s;
    let w = (h * it.aspect) / canvasAspect;
    if (w > colW) {
      w = colW;
      h = (w * canvasAspect) / it.aspect;
    }
    return { ...it, w, h };
  });
}

/** Greedy rows: pieces share a row while their widths (plus gaps) fit the column. */
function packRows(items: Placed[], colW: number, gapX: number): Placed[][] {
  const rows: Placed[][] = [];
  let row: Placed[] = [];
  let width = 0;
  for (const it of items) {
    const next = row.length ? width + gapX + it.w : it.w;
    if (row.length && next > colW + 1e-9) {
      rows.push(row);
      row = [it];
      width = it.w;
    } else {
      row.push(it);
      width = next;
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

function columnHeight(rows: Placed[][], gap: number): number {
  if (!rows.length) return 0;
  return rows.reduce((sum, r) => sum + Math.max(...r.map((i) => i.h)), 0) + gap * (rows.length - 1);
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function composeFlatLay(pieces: FlatLayPiece[], options: FlatLayOptions = {}): FlatLayBox[] {
  if (!pieces.length) return [];
  const canvasAspect = options.canvasAspect && options.canvasAspect > 0 ? options.canvasAspect : 0.8;
  const margin = options.margin ?? 0.05;
  const gap = options.gap ?? 0.03;
  // Horizontal sizes are in canvas widths: convert margins/gaps so they look the same on both axes.
  const marginX = margin / canvasAspect;
  const gapX = gap / canvasAspect;
  const sized = (p: FlatLayPiece): Sized => ({ piece: p, cm: flatLayHeightCm(p), aspect: aspectOf(p) });

  const bySlot = (slot: string) => pieces.find((p) => p.slot === slot);
  const onePiece = bySlot('one_piece');
  const uppers = UPPER_ORDER.map(bySlot).filter((p): p is FlatLayPiece => !!p);
  const bottom = bySlot('bottom');
  const main: FlatLayPiece[] = [];
  if (onePiece) main.push(onePiece);
  else {
    if (uppers[0]) main.push(uppers[0]);
    if (bottom) main.push(bottom);
  }
  const inMain = new Set(main);
  const footwear = pieces.filter((p) => p.slot === 'footwear');
  const accessories = pieces.filter((p) => p.slot.startsWith('accessory:'));
  const others = pieces.filter((p) => !inMain.has(p) && !footwear.includes(p) && !accessories.includes(p));
  // Side column: remaining layers (outermost first), accessories, then shoes at the bottom.
  const side = [...others, ...accessories, ...footwear];

  const usableW = 1 - 2 * marginX;
  const usableH = 1 - 2 * margin;
  const twoColumns = main.length > 0 && side.length > 0;
  const mainW = twoColumns ? (usableW - gapX) * 0.58 : usableW;
  const sideW = twoColumns ? usableW - gapX - mainW : usableW;
  const mainItems = (main.length ? main : side).map(sized);
  const sideItems = (main.length ? side : []).map(sized);

  const mainRowsAt = (s: number) => packRows(sizeAt(mainItems, s, mainW, canvasAspect), main.length ? 0 : mainW, gapX);
  const sideRowsAt = (s: number) => packRows(sizeAt(sideItems, s, sideW, canvasAspect), sideW, gapX);
  /** Largest scale at which a column fits the canvas height (heights grow monotonically with s). */
  const fitScale = (rowsAt: (s: number) => Placed[][], cap: number) => {
    let lo = 0;
    let hi = cap;
    if (columnHeight(rowsAt(hi), gap) <= usableH) return hi;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (columnHeight(rowsAt(mid), gap) <= usableH) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  // The main column fills the height; the side column uses the same scale when it fits, or shrinks
  // on its own (never drawn larger than the main pieces), so one busy column doesn't shrink both.
  const mainScale = fitScale(mainRowsAt, 0.05); // 1 cm = 5 % of the canvas is beyond anything that fits
  const sideScale = sideItems.length ? fitScale(sideRowsAt, mainScale) : mainScale;
  const mainRows = mainRowsAt(mainScale);
  const sideRows = sideRowsAt(sideScale);

  const boxes: FlatLayBox[] = [];
  const placeColumn = (rows: Placed[][], x0: number, colW: number, zBase: number) => {
    const total = columnHeight(rows, gap);
    let y = margin + (usableH - total) / 2;
    rows.forEach((row) => {
      const rowH = Math.max(...row.map((i) => i.h));
      const rowW = row.reduce((sum, i) => sum + i.w, 0) + gapX * (row.length - 1);
      let x = x0 + (colW - rowW) / 2;
      for (const it of row) {
        boxes.push({ key: it.piece.key, slot: it.piece.slot, x: round(x), y: round(y + (rowH - it.h) / 2), w: round(it.w), h: round(it.h), z: zBase + boxes.length });
        x += it.w + gapX;
      }
      y += rowH + gap;
    });
  };
  placeColumn(mainRows, marginX, mainW, 1);
  placeColumn(sideRows, marginX + mainW + gapX, sideW, 10);
  return boxes;
}
