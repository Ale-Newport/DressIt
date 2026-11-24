/**
 * Exports the domain vocabulary to JSON so the Python vision service uses
 * exactly the same ids. Run: node packages/shared/scripts/export-vocabulary.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLOR_FAMILIES } from '../src/colors.ts';
import { MATERIALS, PATTERNS, SEASONS, STYLES, SUBCATEGORIES, CATEGORIES, FITS } from '../src/vocabulary.ts';

const out = {
  generatedBy: 'packages/shared/scripts/export-vocabulary.ts',
  categories: CATEGORIES,
  subcategories: SUBCATEGORIES.map((s) => ({
    id: s.id,
    label: s.label,
    category: s.category,
    layer: s.layer,
    clo: s.clo,
    formality: s.formality,
    styles: s.styles,
  })),
  colorFamilies: COLOR_FAMILIES,
  patterns: PATTERNS,
  materials: MATERIALS.map((m) => ({ id: m.id, label: m.label })),
  styles: STYLES,
  seasons: SEASONS,
  fits: FITS,
};
const target = resolve(import.meta.dirname, '../../../services/vision/app/vocabulary.json');
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log(`Vocabulario exportado a ${target}`);
