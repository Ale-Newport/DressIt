import { type DeviceIntent, OCCASIONS, SUBCATEGORIES } from '@dressit/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * On-device Apple Intelligence (Foundation Models) and Vision helpers, from the local native
 * module `modules/dressit-intelligence`. Everything runs on the phone; nothing is sent to Apple or
 * to us beyond what the app already sends. On Android, in tests or when Apple Intelligence is off,
 * the native module is missing or reports it is unavailable and every helper returns `null`, so
 * callers simply keep the server-only behaviour.
 */

export type ModelAvailability = 'available' | 'deviceNotEligible' | 'appleIntelligenceNotEnabled' | 'modelNotReady' | 'unavailable' | 'unsupportedOS';

export interface IntelligenceStatus {
  model: ModelAvailability;
  /** The model accepts images (iOS 27+). */
  vision: boolean;
  spanish: boolean;
  /** Vision subject lifting (iOS 17+). */
  subjectLifting: boolean;
}

interface NativeIntelligence {
  getStatus(): IntelligenceStatus & { osVersion: string };
  extractIntent(text: string, occasions: string[], subcategories: string[], today: string): Promise<DeviceIntent>;
  describeGarment(uri: string, typeLabel: string | null): Promise<{ name: string; summary: string; model: string }>;
  summarize(facts: string, style: string): Promise<string>;
  liftSubject(uri: string): Promise<{ uri: string; width: number; height: number }>;
}

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<NativeIntelligence>('DressItIntelligence') : null;

const UNAVAILABLE: IntelligenceStatus = { model: 'unsupportedOS', vision: false, spanish: false, subjectLifting: false };

export function intelligenceStatus(): IntelligenceStatus {
  if (!native) return UNAVAILABLE;
  try {
    const { model, vision, spanish, subjectLifting } = native.getStatus();
    return { model, vision, spanish, subjectLifting };
  } catch {
    return UNAVAILABLE;
  }
}

/** Why the on-device model can't be used, in Spanish, or null when it can. */
export function unavailableReason(status: IntelligenceStatus): string | null {
  if (status.model === 'available') return status.spanish ? null : 'Apple Intelligence no admite español en este iPhone.';
  switch (status.model) {
    case 'appleIntelligenceNotEnabled':
      return 'Activa Apple Intelligence en Ajustes para usarla.';
    case 'modelNotReady':
      return 'El modelo de Apple Intelligence todavía se está descargando.';
    case 'deviceNotEligible':
      return 'Este iPhone no es compatible con Apple Intelligence.';
    default:
      return 'Necesita un iPhone compatible con Apple Intelligence (iOS 26 o posterior).';
  }
}

// ---------------------------------------------------------------------------
// User preference (on by default when available; stored on the device)
// ---------------------------------------------------------------------------

const PREF_KEY = 'dressit.onDeviceAI';
let prefCache: boolean | null = null;

export async function onDeviceAIEnabled(): Promise<boolean> {
  if (prefCache === null) prefCache = (await AsyncStorage.getItem(PREF_KEY).catch(() => null)) !== 'off';
  return prefCache;
}

export async function setOnDeviceAIEnabled(on: boolean): Promise<void> {
  prefCache = on;
  await AsyncStorage.setItem(PREF_KEY, on ? 'on' : 'off');
}

async function ready(): Promise<NativeIntelligence | null> {
  if (!native || !(await onDeviceAIEnabled())) return null;
  const s = intelligenceStatus();
  return s.model === 'available' && s.spanish ? native : null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const OCCASION_IDS = OCCASIONS.map((o) => o.id);
const SUBCATEGORY_IDS = SUBCATEGORIES.map((s) => s.id);
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "martes 24 de noviembre de 2026" — context for relative days. */
export function todayPhrase(now = new Date()): string {
  return `${DAY_NAMES[now.getDay()]} ${now.getDate()} de ${MONTH_NAMES[now.getMonth()]} de ${now.getFullYear()}`;
}

/**
 * Reads an assistant request with the on-device model. Returns null when unavailable, disabled,
 * slow (> 8 s) or failing: the server then relies on its own rules alone.
 */
export async function readAssistantRequest(text: string): Promise<DeviceIntent | null> {
  const m = await ready();
  if (!m) return null;
  try {
    return await withTimeout(m.extractIntent(text, OCCASION_IDS, SUBCATEGORY_IDS, todayPhrase()), 8000);
  } catch {
    return null;
  }
}

/** A short Spanish name and one-sentence description of a garment photo (iOS 27+). */
export async function describeGarmentPhoto(uri: string, typeLabel: string | null): Promise<{ name: string; summary: string } | null> {
  const m = await ready();
  if (!m || !intelligenceStatus().vision) return null;
  try {
    return await withTimeout(m.describeGarment(uri, typeLabel), 20000);
  } catch {
    return null;
  }
}

/** One or two sentences written from the given facts only. */
export async function summarizeFacts(facts: string, style = 'Máximo dos frases.'): Promise<string | null> {
  const m = await ready();
  if (!m) return null;
  try {
    const out = await withTimeout(m.summarize(facts, style), 12000);
    return out?.trim() || null;
  } catch {
    return null;
  }
}

/** Instant background removal with Apple's Vision (preview only; the server makes the final cutout). */
export async function liftSubjectPreview(uri: string): Promise<{ uri: string; width: number; height: number } | null> {
  if (!native || !intelligenceStatus().subjectLifting) return null;
  try {
    return await withTimeout(native.liftSubject(uri), 5000);
  } catch {
    return null;
  }
}
