/** A point on the photo, in 0–1 of its width/height; label 1 = "es prenda", 0 = "no es prenda". */
export type RecutPoint = [number, number, 0 | 1];

export const MAX_RECUT_POINTS = 20;

/** Converts a tap inside the displayed photo (layout pixels) into a normalised point. */
export function tapToPoint(x: number, y: number, width: number, height: number, label: 0 | 1): RecutPoint | null {
  if (width <= 0 || height <= 0) return null;
  const nx = x / width;
  const ny = y / height;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  return [Math.round(nx * 1000) / 1000, Math.round(ny * 1000) / 1000, label];
}

/** Adds a point (ignores the tap past the limit). */
export function addPoint(points: RecutPoint[], p: RecutPoint | null): RecutPoint[] {
  if (!p || points.length >= MAX_RECUT_POINTS) return points;
  return [...points, p];
}

/** The service needs at least one point on the garment. */
export const canRecut = (points: RecutPoint[]) => points.some((p) => p[2] === 1);
