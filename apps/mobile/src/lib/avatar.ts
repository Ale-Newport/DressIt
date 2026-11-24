import type { AvatarBackground, AvatarBaseDto, AvatarView, GenerationJobDto } from '@dressit/shared';

export const VIEW_LABEL: Record<AvatarView, string> = { frontal: 'De frente', tres_cuartos: 'Tres cuartos', perfil: 'De perfil' };
export const BACKGROUND_LABEL: Record<AvatarBackground, string> = { estudio_gris: 'Estudio gris', blanco: 'Blanco', beige: 'Beige', original: 'Tu fondo' };
export const BACKGROUND_SWATCH: Record<AvatarBackground, string | null> = { estudio_gris: '#e2dfda', blanco: '#ffffff', beige: '#ebe1d3', original: null };
export const METHOD_LABEL: Record<'sequential' | 'joint', string> = { sequential: 'Probador (prenda a prenda)', joint: 'Una sola pasada' };

export const baseLabel = (b: Pick<AvatarBaseDto, 'view' | 'background'>) => `${VIEW_LABEL[b.view]} · ${BACKGROUND_LABEL[b.background]}`;

/** "Paso 2 de 4 · Probando: vaquero, azul" (+ how many steps were reused from earlier try-ons). */
export function progressText(job: Pick<GenerationJobDto, 'status' | 'progress'>): string {
  if (job.status === 'queued') return 'En cola…';
  const p = job.progress;
  if (!p) return 'Preparando tu avatar…';
  const reused = p.reused ? ` · ${p.reused === 1 ? '1 paso reutilizado' : `${p.reused} pasos reutilizados`}` : '';
  return `Paso ${p.step} de ${p.total} · ${p.label}${reused}`;
}

/** Fraction done for a progress bar (the current step counts as half done). */
export function progressValue(job: Pick<GenerationJobDto, 'status' | 'progress'>): number {
  const p = job.progress;
  if (job.status !== 'running' || !p || !p.total) return 0;
  return Math.min(1, (p.step - 0.5) / p.total);
}
