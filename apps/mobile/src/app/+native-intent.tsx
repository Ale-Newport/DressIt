import { getShareExtensionKey } from 'expo-share-intent';

/**
 * Incoming system links. The share extension (iOS) / share intent (Android)
 * opens `dressit://dataUrl=dressitShareKey…`; we route it to the share screen,
 * which reads the payload from `useShareIntentContext()`.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/share-intent';
    return path;
  } catch {
    return '/';
  }
}
