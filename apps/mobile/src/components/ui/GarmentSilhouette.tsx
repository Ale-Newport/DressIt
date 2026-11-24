import { type Category, getSubcategory } from '@dressit/shared';
import { View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '@/theme';

/**
 * Elegant flat silhouettes (original artwork) used when a garment has no photo.
 * Filled with the garment's colour so outfits remain readable as colour stories.
 */
type ShapeKey =
  | 'tee'
  | 'longsleeve'
  | 'shirt'
  | 'coat'
  | 'trousers'
  | 'shorts'
  | 'skirt'
  | 'dress'
  | 'jumpsuit'
  | 'sneaker'
  | 'boot'
  | 'heel'
  | 'bag'
  | 'hat'
  | 'scarf'
  | 'ring'
  | 'swim';

const SHAPES: Record<ShapeKey, { body: string; detail?: string }> = {
  tee: { body: 'M30 18 L42 14 Q50 21 58 14 L70 18 L86 32 L77 42 L70 37 L70 86 L30 86 L30 37 L23 42 L14 32 Z' },
  longsleeve: { body: 'M30 16 L42 12 Q50 19 58 12 L70 16 L82 30 L90 78 L80 80 L72 44 L72 88 L28 88 L28 44 L20 80 L10 78 L18 30 Z' },
  shirt: {
    body: 'M30 16 L42 12 L50 22 L58 12 L70 16 L82 30 L90 78 L80 80 L72 44 L72 88 L28 88 L28 44 L20 80 L10 78 L18 30 Z',
    detail: 'M42 12 L46 24 L50 22 L54 24 L58 12 M50 22 L50 88',
  },
  coat: {
    body: 'M32 10 L44 8 L50 18 L56 8 L68 10 L80 24 L88 84 L78 86 L72 42 L74 94 L26 94 L28 42 L22 86 L12 84 L20 24 Z',
    detail: 'M44 8 L47 30 L50 18 L53 30 L56 8 M50 30 L50 94',
  },
  trousers: { body: 'M30 10 L70 10 L74 92 L56 92 L50 36 L44 92 L26 92 Z', detail: 'M30 18 L70 18' },
  shorts: { body: 'M28 24 L72 24 L76 66 L54 68 L50 46 L46 68 L24 66 Z', detail: 'M28 31 L72 31' },
  skirt: { body: 'M34 16 L66 16 L80 84 Q50 90 20 84 Z', detail: 'M34 23 L66 23' },
  dress: { body: 'M38 8 L44 8 Q50 15 56 8 L62 8 L64 30 L60 38 L78 92 Q50 98 22 92 L40 38 L36 30 Z', detail: 'M40 38 L60 38' },
  jumpsuit: { body: 'M36 8 L64 8 L66 40 L70 92 L54 92 L50 54 L46 92 L30 92 L34 40 Z', detail: 'M34 40 L66 40' },
  sneaker: { body: 'M12 62 Q14 48 26 48 L40 50 Q52 56 66 58 Q86 60 88 70 L88 76 L12 76 Z', detail: 'M12 70 L88 70' },
  boot: { body: 'M30 14 L52 14 L54 58 Q78 60 84 72 L84 80 L30 80 Z', detail: 'M30 74 L84 74' },
  heel: { body: 'M14 70 Q30 46 52 56 L80 62 L82 70 L72 70 L70 84 L66 84 L64 70 Z' },
  bag: { body: 'M22 40 L78 40 L84 86 L16 86 Z', detail: 'M36 40 Q36 18 50 18 Q64 18 64 40' },
  hat: { body: 'M22 62 Q24 34 50 32 Q76 34 78 62 Z M10 62 L90 62 L90 69 L10 69 Z' },
  scarf: { body: 'M36 10 L64 10 L64 70 L74 92 L58 94 L50 74 L50 30 L36 30 Z' },
  ring: { body: 'M50 26 A24 24 0 1 1 49.9 26 Z M50 36 A14 14 0 1 0 50.1 36 Z' },
  swim: { body: 'M30 20 L40 20 Q50 34 60 20 L70 20 L68 50 Q66 70 74 84 Q50 92 26 84 Q34 70 32 50 Z' },
};

function shapeFor(category: Category | null | undefined, subcategory: string | null | undefined): ShapeKey {
  const sub = subcategory ? getSubcategory(subcategory) : undefined;
  const id = subcategory ?? '';
  switch (sub?.category ?? category) {
    case 'top':
      if (/camisa|blusa|sobrecamisa/.test(id)) return 'shirt';
      if (sub?.layer === 'mid' || /manga_larga/.test(id)) return 'longsleeve';
      return 'tee';
    case 'outerwear':
      return 'coat';
    case 'bottom':
      if (/falda/.test(id)) return 'skirt';
      if (/corto|bermuda/.test(id)) return 'shorts';
      return 'trousers';
    case 'one_piece':
      return /mono|chandal/.test(id) ? 'jumpsuit' : 'dress';
    case 'footwear':
      if (/bota|botin/.test(id)) return 'boot';
      if (/tacon|bailarina|sandalia/.test(id)) return 'heel';
      return 'sneaker';
    case 'accessory':
      if (sub?.accessorySlot === 'head') return 'hat';
      if (sub?.accessorySlot === 'neck') return 'scarf';
      if (sub?.accessorySlot === 'bag') return 'bag';
      return 'ring';
    case 'swimwear':
      return 'swim';
    default:
      return 'tee';
  }
}

export interface GarmentSilhouetteProps {
  category?: Category | null;
  subcategory?: string | null;
  color?: string | null;
  style?: ViewStyle;
  testID?: string;
}

export function GarmentSilhouette({ category, subcategory, color, style, testID }: GarmentSilhouetteProps) {
  const { colors } = useTheme();
  const shape = SHAPES[shapeFor(category, subcategory)];
  const fill = color ?? colors.lineStrong;
  return (
    <View style={[{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }, style]} testID={testID} accessible={false}>
      <Svg width="78%" height="78%" viewBox="0 0 100 100">
        <Path d={shape.body} fill={fill} fillRule="evenodd" stroke={colors.ink} strokeOpacity={0.22} strokeWidth={1.2} strokeLinejoin="round" />
        {shape.detail ? <Path d={shape.detail} fill="none" stroke={colors.ink} strokeOpacity={0.25} strokeWidth={1} strokeLinecap="round" /> : null}
      </Svg>
    </View>
  );
}

export { shapeFor as silhouetteShapeFor };
