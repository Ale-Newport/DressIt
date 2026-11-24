import { toUploadProgress } from '@/api/upload';
import { greetingSubtitle, greetingTitle } from '@/lib/greeting';

describe('regressions found in the iOS simulator', () => {
  it('handles BigInt upload counters from expo-file-system without throwing', () => {
    expect(toUploadProgress(BigInt(512), BigInt(1024))).toEqual({ sent: 512, total: 1024, fraction: 0.5 });
    expect(toUploadProgress(10, 0)).toEqual({ sent: 10, total: 1, fraction: 1 });
  });

  it('splits the server greeting into a short title and the recommendation line', () => {
    const g = 'Buenas tardes, Ana. Hoy hará entre 6 y 10 °C, con lluvia a mediodía. Para universidad te recomiendo estos conjuntos.';
    expect(greetingTitle(g)).toBe('Buenas tardes, Ana.');
    expect(greetingSubtitle(g)).toBe('Para universidad te recomiendo estos conjuntos.');
    expect(greetingTitle('Hola')).toBe('Hola');
    expect(greetingSubtitle('Hola')).toBeUndefined();
    expect(greetingTitle(null)).toBeNull();
  });
});
