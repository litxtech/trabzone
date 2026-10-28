/**
 * Haber kategorileri için premium renk paletleri.
 *
 * Görseli olmayan haber kartlarında boş gri kutu yerine Trabzone'nun kurumsal
 * görsel diliyle uyumlu, kategoriye özgü bir gradyan kullanılır.
 */
export type NewsCategoryPalette = {
  gradient: [string, string];
  accent: string;
  soft: string;
  onGradient: string;
};

const PALETTES: Record<string, NewsCategoryPalette> = {
  'son-dakika': {
    gradient: ['#0F2D6B', '#1E5BD6'],
    accent: '#1E5BD6',
    soft: '#E7EFFF',
    onGradient: '#FFFFFF',
  },
  'trabzon-gundem': {
    gradient: ['#0B2A5B', '#2E6BE6'],
    accent: '#2E6BE6',
    soft: '#E9F1FF',
    onGradient: '#FFFFFF',
  },
  trabzonspor: {
    gradient: ['#5A1220', '#B01E36'],
    accent: '#B01E36',
    soft: '#FDECEF',
    onGradient: '#FFFFFF',
  },
  spor: {
    gradient: ['#123C34', '#1E7A63'],
    accent: '#1E7A63',
    soft: '#E7F7F1',
    onGradient: '#FFFFFF',
  },
  ekonomi: {
    gradient: ['#3B2A08', '#9A6B12'],
    accent: '#9A6B12',
    soft: '#FBF2DC',
    onGradient: '#FFFFFF',
  },
  belediye: {
    gradient: ['#122A4C', '#2B4F86'],
    accent: '#2B4F86',
    soft: '#EAF0F9',
    onGradient: '#FFFFFF',
  },
  belediyeler: {
    gradient: ['#122A4C', '#2B4F86'],
    accent: '#2B4F86',
    soft: '#EAF0F9',
    onGradient: '#FFFFFF',
  },
  'ilce-haberleri': {
    gradient: ['#1E2A4F', '#4A5FA8'],
    accent: '#4A5FA8',
    soft: '#EEF1FB',
    onGradient: '#FFFFFF',
  },
  tarim: {
    gradient: ['#1C3A16', '#4F8B2E'],
    accent: '#4F8B2E',
    soft: '#EEF8E7',
    onGradient: '#FFFFFF',
  },
  turizm: {
    gradient: ['#0B3A4A', '#1E8FA8'],
    accent: '#1E8FA8',
    soft: '#E6F7FA',
    onGradient: '#FFFFFF',
  },
  yasam: {
    gradient: ['#2B1B4D', '#6B4BC4'],
    accent: '#6B4BC4',
    soft: '#F1ECFC',
    onGradient: '#FFFFFF',
  },
  kultur: {
    gradient: ['#3A1436', '#8A2E7A'],
    accent: '#8A2E7A',
    soft: '#FBEAF6',
    onGradient: '#FFFFFF',
  },
  teknoloji: {
    gradient: ['#0A2540', '#2563EB'],
    accent: '#2563EB',
    soft: '#E8F0FF',
    onGradient: '#FFFFFF',
  },
  'default': {
    gradient: ['#101A38', '#3557C9'],
    accent: '#3557C9',
    soft: '#EAF0FF',
    onGradient: '#FFFFFF',
  },
};

export function newsCategoryPalette(slug: string | null | undefined): NewsCategoryPalette {
  if (!slug) return PALETTES['default']!;
  return PALETTES[slug] ?? PALETTES['default']!;
}

export function newsFormatLabel(format: string | null | undefined): string | null {
  if (format === 'short') return 'Kısa haber';
  if (format === 'standard') return 'Haber';
  if (format === 'extended') return 'Kapsamlı haber';
  return null;
}
