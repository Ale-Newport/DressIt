import { getColorFamily } from '@dressit/shared';

/** Spanish colour name for prompts ("camel", "azul marino"). */
export function colorLabel(family: string): string {
  return getColorFamily(family)?.label.toLowerCase() ?? family;
}
