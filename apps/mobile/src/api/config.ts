import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

const DEFAULT_PORT = 3000;

/**
 * Resolves the API base URL.
 *
 * 1. `EXPO_PUBLIC_API_URL` always wins (e.g. `http://192.168.1.20:3000`).
 * 2. Physical device in development: the Mac's LAN IP taken from the Metro
 *    host (`hostUri`), port 3000 — the API must listen on 0.0.0.0.
 * 3. iOS Simulator: `http://localhost:3000`.
 * 4. Android emulator: `http://10.0.2.2:3000` (host loopback alias).
 */
export function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv && fromEnv.trim()) return stripTrailingSlash(fromEnv.trim());

  const hostUri: string | undefined =
    Constants.expoConfig?.hostUri ?? (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost;
  const metroHost = hostUri?.split(':')[0];
  if (Device.isDevice && metroHost && !isLoopback(metroHost)) {
    return `http://${metroHost}:${DEFAULT_PORT}`;
  }
  if (Platform.OS === 'android') return `http://10.0.2.2:${DEFAULT_PORT}`;
  return `http://localhost:${DEFAULT_PORT}`;
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export const API_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 120_000;
