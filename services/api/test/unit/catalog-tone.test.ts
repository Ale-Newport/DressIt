/**
 * Tone fix for generated packshots of dark garments, on synthetic images: a grey "garment" square on
 * a white canvas stands for the generated photo, an opaque square on transparency for the cutout.
 */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { fixDarkGarmentTone, garmentLightness } from '../../src/modules/catalog-photo/tone.ts';

const grey = (v: number) => ({ r: v, g: v, b: v });

/** Cutout: a square of the given colour on a transparent background. */
async function cutout(rgb: { r: number; g: number; b: number }) {
  const square = await sharp({ create: { width: 120, height: 120, channels: 4, background: { ...rgb, alpha: 1 } } }).png().toBuffer();
  return sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: square, left: 40, top: 40 }])
    .png()
    .toBuffer();
}

/** Generated packshot: the garment square on a white background, optionally with a white logo. */
async function packshot(rgb: { r: number; g: number; b: number }, alpha = false) {
  const square = await sharp({ create: { width: 160, height: 200, channels: 3, background: rgb } }).png().toBuffer();
  const logo = await sharp({ create: { width: 30, height: 20, channels: 3, background: grey(250) } }).png().toBuffer();
  return sharp({ create: { width: 320, height: 400, channels: alpha ? 4 : 3, background: alpha ? { r: 255, g: 255, b: 255, alpha: 1 } : grey(255) } })
    .composite([{ input: square, left: 80, top: 100 }, { input: logo, left: 150, top: 150 }])
    .png()
    .toBuffer();
}

const pixel = async (img: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [...data.subarray(i, i + 3)];
};

describe('dark garment tone fix', () => {
  it('darkens a black garment that came out grey back to the photo, keeping the white background', async () => {
    const ref = await cutout(grey(60)); // L* ≈ 25
    const gen = await packshot(grey(170)); // L* ≈ 70: the "grey polo"
    const fix = await fixDarkGarmentTone(ref, gen);
    expect(fix).not.toBeNull();
    expect(fix!.referenceL).toBeCloseTo(25.4, 0);
    expect(fix!.generatedL).toBeCloseTo(69.6, 0);
    expect(fix!.gamma).toBe(2.5); // capped
    expect(fix!.correctedL).toBeLessThan(42);
    expect(await pixel(fix!.image, 5, 5)).toEqual([255, 255, 255]); // background stays white
    const [logo] = await pixel(fix!.image, 160, 155);
    expect(logo).toBeGreaterThan(225); // white details stay light
  });

  it('matches the reference exactly when the gap is within the curve’s range', async () => {
    const fix = await fixDarkGarmentTone(await cutout(grey(90)), await packshot(grey(130)));
    expect(fix).not.toBeNull();
    expect(fix!.gamma).toBeLessThan(2.5);
    expect(Math.abs(fix!.correctedL - fix!.referenceL)).toBeLessThan(1);
  });

  it('keeps hue: a navy garment stays blue', async () => {
    const fix = await fixDarkGarmentTone(await cutout({ r: 30, g: 45, b: 110 }), await packshot({ r: 90, g: 120, b: 200 }));
    expect(fix).not.toBeNull();
    const [r, g, b] = await pixel(fix!.image, 100, 120);
    expect(b).toBeGreaterThan(r! + 40);
    expect(b).toBeGreaterThan(g! + 20);
  });

  it('leaves light and mid-tone garments alone, even if the photo was darker', async () => {
    expect(await fixDarkGarmentTone(await cutout(grey(120)), await packshot(grey(210)))).toBeNull();
    expect(await fixDarkGarmentTone(await cutout(grey(235)), await packshot(grey(220)))).toBeNull();
  });

  it('never lightens, and ignores small differences', async () => {
    expect(await fixDarkGarmentTone(await cutout(grey(70)), await packshot(grey(40)))).toBeNull();
    expect(await fixDarkGarmentTone(await cutout(grey(60)), await packshot(grey(68)))).toBeNull();
  });

  it('keeps the alpha channel of a transparent output', async () => {
    const fix = await fixDarkGarmentTone(await cutout(grey(60)), await packshot(grey(170), true));
    expect((await sharp(fix!.image).metadata()).channels).toBe(4);
  });

  it('measures the garment, not the white background or soft floor shadow', async () => {
    expect(await garmentLightness(await packshot(grey(170)), 'on-white')).toBeCloseTo(69.6, 0);
  });
});
