import { randomUUID } from 'node:crypto';
import type { AuthResponse, AuthTokens, UserDto } from '@dressit/shared';
import { sql } from 'kysely';
import type { AppContext } from '../../context.ts';
import { withUser, type Tx } from '../../db/index.ts';
import { AppError, conflict, unauthorized } from '../../lib/errors.ts';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, hashPassword, newRefreshToken, sha256, verifyPassword } from '../../lib/tokens.ts';
import { audit } from '../../lib/audit.ts';

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;
export const CURRENT_TERMS_VERSION = '2026-11';

export async function loadUser(trx: Tx, userId: string): Promise<UserDto> {
  const u = await trx.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirstOrThrow();
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    locale: u.locale,
    timezone: u.timezone,
    plan: u.plan as UserDto['plan'],
    location:
      u.location_lat !== null && u.location_lon !== null && u.location_name
        ? { name: u.location_name, lat: Number(u.location_lat), lon: Number(u.location_lon), countryCode: u.country_code }
        : null,
    onboardingCompleted: u.onboarding_completed_at !== null,
    createdAt: u.created_at.toISOString(),
  };
}

async function issueTokens(ctx: AppContext, userId: string, familyId: string, userAgent: string | undefined): Promise<AuthTokens> {
  const refresh = newRefreshToken();
  await ctx.db
    .insertInto('auth_sessions')
    .values({ user_id: userId, refresh_token_hash: refresh.hash, family_id: familyId, user_agent: userAgent?.slice(0, 200) ?? null, expires_at: new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000) })
    .execute();
  return { accessToken: await ctx.tokens.signAccess(userId), refreshToken: refresh.token, expiresIn: ACCESS_TTL_SECONDS };
}

export async function register(ctx: AppContext, input: { email: string; password: string; displayName: string }, userAgent?: string): Promise<AuthResponse> {
  const email = input.email.trim().toLowerCase();
  const exists = await ctx.db.selectFrom('auth_identities').select('id').where('provider', '=', 'password').where('subject', '=', email).executeTakeFirst();
  if (exists) throw conflict('Ya existe una cuenta con ese correo.');
  const passwordHash = await hashPassword(input.password);
  const userId = randomUUID();
  const user = await withUser(ctx.db, userId, async (trx) => {
    await trx.insertInto('users').values({ id: userId, email, display_name: input.displayName.trim() }).execute();
    await trx.insertInto('auth_identities').values({ user_id: userId, provider: 'password', subject: email, password_hash: passwordHash }).execute();
    await trx.insertInto('user_preferences').values({ user_id: userId }).execute();
    await trx.insertInto('style_profiles').values({ user_id: userId }).execute();
    await trx.insertInto('wardrobes').values({ user_id: userId, name: 'Mi armario', is_default: true }).execute();
    await trx.insertInto('wishlists').values({ user_id: userId, name: 'Lista de deseos', is_default: true }).execute();
    await trx
      .insertInto('consents')
      .values([
        { user_id: userId, kind: 'terms', granted: true, version: CURRENT_TERMS_VERSION },
        { user_id: userId, kind: 'privacy', granted: true, version: CURRENT_TERMS_VERSION },
      ])
      .execute();
    await audit(trx, userId, 'user.registered');
    return loadUser(trx, userId);
  });
  return { user, tokens: await issueTokens(ctx, userId, randomUUID(), userAgent) };
}

export async function login(ctx: AppContext, input: { email: string; password: string }, userAgent?: string): Promise<AuthResponse> {
  const email = input.email.trim().toLowerCase();
  const identity = await ctx.db.selectFrom('auth_identities').selectAll().where('provider', '=', 'password').where('subject', '=', email).executeTakeFirst();
  // Same error for unknown email and bad password (no account enumeration); hash anyway to equalise timing.
  if (!identity?.password_hash) {
    await hashPassword(input.password);
    throw unauthorized('Correo o contraseña incorrectos.');
  }
  if (identity.locked_until && identity.locked_until > new Date()) {
    throw new AppError(429, 'account_locked', 'Demasiados intentos fallidos. Inténtalo de nuevo en unos minutos.');
  }
  const ok = await verifyPassword(identity.password_hash, input.password);
  if (!ok) {
    const failed = identity.failed_attempts + 1;
    await ctx.db
      .updateTable('auth_identities')
      .set({ failed_attempts: failed, locked_until: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
      .where('id', '=', identity.id)
      .execute();
    throw unauthorized('Correo o contraseña incorrectos.');
  }
  await ctx.db.updateTable('auth_identities').set({ failed_attempts: 0, locked_until: null }).where('id', '=', identity.id).execute();
  const user = await withUser(ctx.db, identity.user_id, async (trx) => {
    await audit(trx, identity.user_id, 'user.login');
    return loadUser(trx, identity.user_id);
  });
  return { user, tokens: await issueTokens(ctx, identity.user_id, randomUUID(), userAgent) };
}

/**
 * Refresh-token rotation with reuse detection: presenting an already-rotated token
 * revokes the whole token family (likely theft).
 */
export async function refresh(ctx: AppContext, refreshToken: string, userAgent?: string): Promise<AuthTokens> {
  const hash = sha256(refreshToken);
  const session = await ctx.db.selectFrom('auth_sessions').selectAll().where('refresh_token_hash', '=', hash).executeTakeFirst();
  if (!session) throw unauthorized();
  if (session.rotated_at || session.revoked_at) {
    await ctx.db.updateTable('auth_sessions').set({ revoked_at: new Date() }).where('family_id', '=', session.family_id).where('revoked_at', 'is', null).execute();
    throw unauthorized('La sesión ya no es válida. Inicia sesión de nuevo.');
  }
  if (session.expires_at < new Date()) throw unauthorized('La sesión ha caducado. Inicia sesión de nuevo.');
  const rotated = await ctx.db
    .updateTable('auth_sessions')
    .set({ rotated_at: new Date() })
    .where('id', '=', session.id)
    .where('rotated_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  if (!rotated) throw unauthorized();
  return issueTokens(ctx, session.user_id, session.family_id, userAgent);
}

export async function logout(ctx: AppContext, refreshToken: string): Promise<void> {
  const hash = sha256(refreshToken);
  const session = await ctx.db.selectFrom('auth_sessions').select('family_id').where('refresh_token_hash', '=', hash).executeTakeFirst();
  if (session) await ctx.db.updateTable('auth_sessions').set({ revoked_at: new Date() }).where('family_id', '=', session.family_id).execute();
}

export async function verifyUserPassword(ctx: AppContext, userId: string, password: string): Promise<boolean> {
  const identity = await ctx.db.selectFrom('auth_identities').select('password_hash').where('user_id', '=', userId).where('provider', '=', 'password').executeTakeFirst();
  return identity?.password_hash ? verifyPassword(identity.password_hash, password) : false;
}

export async function purgeExpiredSessions(ctx: AppContext): Promise<void> {
  await ctx.db.deleteFrom('auth_sessions').where(sql<boolean>`expires_at < now() - interval '7 days'`).execute();
}
