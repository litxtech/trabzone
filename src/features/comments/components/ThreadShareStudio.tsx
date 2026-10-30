import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui';
import { fetchThreadShare } from '@/features/sports/services/sports-service';
import type { ThreadShare } from '@/features/sports/types';
import { siteBase } from '@/features/share/links';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/utils/haptics';
import { unwrap } from '@/utils/result';

type Format = '9:16' | '4:5' | '1:1';
type ThemeKey = 'cinematic' | 'minimal' | 'premium';

const FORMATS: Record<Format, { w: number; h: number; label: string }> = {
  '9:16': { w: 1080, h: 1920, label: 'Hikâye 9:16' },
  '4:5': { w: 1080, h: 1350, label: 'Gönderi 4:5' },
  '1:1': { w: 1080, h: 1080, label: 'Kare 1:1' },
};

const THEMES: Record<
  ThemeKey,
  { label: string; bg: [string, string]; card: string; text: string; muted: string; accent: string; line: string }
> = {
  cinematic: {
    label: 'Cinematic Dark',
    bg: ['#05070D', '#151B2E'],
    card: 'rgba(255,255,255,0.06)',
    text: '#F5F7FB',
    muted: '#9AA4BC',
    accent: '#8FB4FF',
    line: 'rgba(255,255,255,0.12)',
  },
  minimal: {
    label: 'Minimal White',
    bg: ['#FFFFFF', '#F3F5F9'],
    card: '#FFFFFF',
    text: '#0E1424',
    muted: '#5D6880',
    accent: '#1D4ED8',
    line: 'rgba(14,20,36,0.10)',
  },
  premium: {
    label: 'Trabzone Premium',
    bg: ['#5A0F2E', '#0E3A6B'],
    card: 'rgba(255,255,255,0.10)',
    text: '#FFFFFF',
    muted: '#D7DEEF',
    accent: '#7FD1FF',
    line: 'rgba(255,255,255,0.18)',
  },
};

const PADDING = 72;

/** Basit sözcük kaydırma; SVG metni otomatik satır kırmaz. */
function wrap(text: string, fontSize: number, width: number, maxLines: number): { lines: string[]; truncated: boolean } {
  const perLine = Math.max(8, Math.floor(width / (fontSize * 0.54)));
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > perLine ? `${word.slice(0, perLine - 1)}…` : word;
    if (lines.length >= maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  const truncated = lines.length >= maxLines && lines.join(' ').length < text.replace(/\s+/g, ' ').trim().length;
  if (truncated) {
    const last = lines[maxLines - 1] ?? '';
    lines[maxLines - 1] = `${last.slice(0, Math.max(0, perLine - 1)).trimEnd()}…`;
  }
  return { lines: lines.slice(0, maxLines), truncated };
}

function authorName(author: ThreadShare['items'][number]['author']): string {
  if (!author) return 'Trabzone kullanıcısı';
  return (
    author.display_name?.trim() ||
    `${author.first_name ?? ''} ${author.last_name ?? ''}`.trim() ||
    author.username
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('tr-TR') ?? '')
    .join('');
}

type Laid = {
  id: string;
  name: string;
  username: string | null;
  verified: boolean;
  lines: string[];
  isRoot: boolean;
  likes: number;
  y: number;
  height: number;
};

function layout(share: ThreadShare, count: number, format: Format) {
  const { w, h } = FORMATS[format];
  const textWidth = w - PADDING * 2 - 120;
  const fontSize = format === '1:1' ? 34 : 38;
  const lineHeight = fontSize * 1.32;
  const items = share.items.slice(0, 1 + count);
  const headerHeight = 230;
  const footerHeight = 150;
  const available = h - headerHeight - footerHeight;
  const maxLines = format === '9:16' ? 7 : format === '4:5' ? 5 : 4;

  let y = headerHeight;
  const laid: Laid[] = [];
  let truncated = false;
  for (const item of items) {
    const name = authorName(item.author);
    const { lines, truncated: cut } = wrap(item.body, fontSize, textWidth - (item.is_root ? 0 : 60), maxLines);
    const height = 92 + lines.length * lineHeight + 34;
    if (y + height > headerHeight + available) break;
    truncated ||= cut;
    laid.push({
      id: item.id,
      name,
      username: item.author?.username ?? null,
      verified: Boolean(item.author?.is_verified),
      lines,
      isRoot: item.is_root,
      likes: item.like_count,
      y,
      height,
    });
    y += height + 22;
  }
  return { laid, fontSize, lineHeight, truncated, shown: laid.length };
}

function ShareCard({
  share,
  count,
  format,
  themeKey,
  svgRef,
  displayWidth,
}: {
  share: ThreadShare;
  count: number;
  format: Format;
  themeKey: ThemeKey;
  svgRef?: React.RefObject<Svg | null>;
  displayWidth: number;
}) {
  const { w, h } = FORMATS[format];
  const t = THEMES[themeKey];
  const { laid, fontSize, lineHeight } = useMemo(() => layout(share, count, format), [share, count, format]);
  const displayHeight = (displayWidth * h) / w;
  const host = siteBase().replace(/^https?:\/\//, '');

  return (
    <Svg ref={svgRef} width={displayWidth} height={displayHeight} viewBox={`0 0 ${w} ${h}`}>
      <Defs>
        <LinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={t.bg[0]} />
          <Stop offset="1" stopColor={t.bg[1]} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={w} height={h} fill="url(#bg)" />
      <SvgText x={PADDING} y={110} fill={t.accent} fontSize={30} fontWeight="700" letterSpacing={4}>
        {share.context.kind === 'match' ? 'MAÇ KONUŞMASI' : 'TRABZONE KONUŞMASI'}
      </SvgText>
      <SvgText x={PADDING} y={168} fill={t.text} fontSize={46} fontWeight="800">
        {share.context.title.slice(0, 40)}
      </SvgText>
      {share.context.subtitle ? (
        <SvgText x={PADDING} y={206} fill={t.muted} fontSize={28}>
          {share.context.subtitle.slice(0, 50)}
        </SvgText>
      ) : null}

      {laid.map((item) => {
        const indent = item.isRoot ? 0 : 60;
        const x = PADDING + indent;
        const width = w - PADDING * 2 - indent;
        return (
          <Rect
            key={`card-${item.id}`}
            x={x}
            y={item.y}
            width={width}
            height={item.height}
            rx={34}
            fill={t.card}
            stroke={t.line}
            strokeWidth={2}
          />
        );
      })}
      {laid.map((item) => {
        const indent = item.isRoot ? 0 : 60;
        const x = PADDING + indent + 32;
        return (
          <Circle key={`av-${item.id}`} cx={x + 30} cy={item.y + 62} r={30} fill={t.accent} opacity={0.9} />
        );
      })}
      {laid.map((item) => {
        const indent = item.isRoot ? 0 : 60;
        const x = PADDING + indent + 32;
        return (
          <SvgText
            key={`ini-${item.id}`}
            x={x + 30}
            y={item.y + 73}
            fill={themeKey === 'minimal' ? '#FFFFFF' : '#0B1020'}
            fontSize={26}
            fontWeight="800"
            textAnchor="middle"
          >
            {initials(item.name) || '•'}
          </SvgText>
        );
      })}
      {laid.map((item) => {
        const indent = item.isRoot ? 0 : 60;
        const x = PADDING + indent + 108;
        return (
          <SvgText key={`name-${item.id}`} x={x} y={item.y + 58} fill={t.text} fontSize={30} fontWeight="700">
            {`${item.name.slice(0, 26)}${item.verified ? ' ✓' : ''}`}
          </SvgText>
        );
      })}
      {laid.map((item) => {
        const indent = item.isRoot ? 0 : 60;
        const x = PADDING + indent + 108;
        return item.username ? (
          <SvgText key={`user-${item.id}`} x={x} y={item.y + 94} fill={t.muted} fontSize={24}>
            {`@${item.username}${item.likes > 0 ? `  ·  ${item.likes} beğeni` : ''}`}
          </SvgText>
        ) : null;
      })}
      {laid.flatMap((item) => {
        const indent = item.isRoot ? 0 : 60;
        const x = PADDING + indent + 32;
        return item.lines.map((line, index) => (
          <SvgText
            key={`l-${item.id}-${index}`}
            x={x}
            y={item.y + 92 + 34 + index * lineHeight + fontSize * 0.2}
            fill={t.text}
            fontSize={fontSize}
          >
            {line}
          </SvgText>
        ));
      })}

      <Rect x={PADDING} y={h - 128} width={w - PADDING * 2} height={2} fill={t.line} />
      <SvgText x={PADDING} y={h - 70} fill={t.text} fontSize={34} fontWeight="800">
        Trabzone
      </SvgText>
      <SvgText x={w - PADDING} y={h - 70} fill={t.muted} fontSize={26} textAnchor="end">
        {host}
      </SvgText>
    </Svg>
  );
}

async function shareImage(base64: string, fileName: string): Promise<'shared' | 'failed'> {
  if (Platform.OS === 'web') {
    try {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const file = new File([blob], fileName, { type: 'image/png' });
      const nav = globalThis.navigator as Navigator & { canShare?: (data: unknown) => boolean };
      if (nav?.canShare?.({ files: [file] })) {
        await nav.share({ files: [file] } as ShareData);
        return 'shared';
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return 'shared';
    } catch (error) {
      return (error as { name?: string })?.name === 'AbortError' ? 'shared' : 'failed';
    }
  }
  try {
    const [FileSystem, Sharing] = await Promise.all([import('expo-file-system/legacy'), import('expo-sharing')]);
    const directory = FileSystem.cacheDirectory;
    if (!directory) return 'failed';
    const target = `${directory}${fileName}`;
    await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });
    if (!(await Sharing.isAvailableAsync())) return 'failed';
    await Sharing.shareAsync(target, { mimeType: 'image/png', dialogTitle: 'Konuşmayı paylaş', UTI: 'public.png' });
    return 'shared';
  } catch {
    return 'failed';
  }
}

/**
 * Konuşma paylaşım stüdyosu. Yalnızca herkese açık içerikteki gerçek yorumlar
 * sunucudan (`comment_thread_share`) okunur; metin ve sıra değiştirilemez,
 * kullanıcı yalnızca kaç yanıtın dahil edileceğini seçer.
 */
export function ThreadShareStudio({
  visible,
  contentType,
  commentId,
  onClose,
}: {
  visible: boolean;
  contentType: 'post' | 'reel' | 'match';
  commentId: string | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [format, setFormat] = useState<Format>('4:5');
  const [themeKey, setThemeKey] = useState<ThemeKey>('premium');
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const svgRef = useRef<Svg | null>(null);

  const query = useQuery({
    queryKey: ['comments', 'thread-share', contentType, commentId],
    queryFn: () => unwrap(fetchThreadShare(contentType, commentId as string, 8)),
    enabled: visible && Boolean(commentId),
    staleTime: 30_000,
    retry: false,
  });

  const share = query.data ?? null;
  const replies = Math.max(0, (share?.items.length ?? 1) - 1);
  const effectiveCount = Math.min(count, replies);
  const meta = useMemo(
    () => (share ? layout(share, effectiveCount, format) : null),
    [share, effectiveCount, format],
  );

  const previewWidth = Math.min(width - 40, ((height - insets.top - 320) * FORMATS[format].w) / FORMATS[format].h, 420);

  const exportImage = () => {
    if (!svgRef.current || !share) return;
    setBusy(true);
    setMessage(null);
    const { w, h } = FORMATS[format];
    svgRef.current.toDataURL(
      (base64: string) => {
        void shareImage(base64, `trabzone-konusma-${format.replace(':', 'x')}.png`).then((outcome) => {
          setBusy(false);
          if (outcome === 'shared') {
            haptics.success();
          } else {
            setMessage('Görsel paylaşılamadı. Tekrar dene.');
          }
        });
      },
      { width: w, height: h },
    );
  };

  const chip = (active: boolean) => [
    styles.chip,
    {
      backgroundColor: active ? theme.colors.primary : theme.colors.surfaceMuted,
      borderColor: active ? theme.colors.primary : theme.colors.border,
    },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.root, { backgroundColor: theme.colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Kapat">
            <Ionicons name="close" size={24} color={theme.colors.text} />
          </Pressable>
          <AppText variant="h2">Konuşmayı paylaş</AppText>
          <View style={{ width: 24 }} />
        </View>

        {query.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        ) : query.isError || !share ? (
          <View style={styles.center}>
            <Ionicons name="lock-closed-outline" size={28} color={theme.colors.textSecondary} />
            <AppText variant="body" color="textSecondary" align="center">
              Bu konuşma paylaşılamaz. Yalnızca herkese açık içerikteki görünür yorumlar paylaşılabilir.
            </AppText>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
            <View style={styles.preview}>
              <ShareCard
                share={share}
                count={effectiveCount}
                format={format}
                themeKey={themeKey}
                svgRef={svgRef}
                displayWidth={Math.max(200, previewWidth)}
              />
            </View>
            {meta && meta.shown < 1 + effectiveCount ? (
              <AppText variant="caption" color="textTertiary" align="center">
                Bu formatta {meta.shown - 1} yanıt sığıyor; kalan yanıtlar görsele eklenmedi.
              </AppText>
            ) : null}
            {meta?.truncated ? (
              <AppText variant="caption" color="textTertiary" align="center">
                Uzun yorumlar “…” ile kısaltıldı; metin değiştirilmedi.
              </AppText>
            ) : null}

            <AppText variant="caption" color="textSecondary" style={styles.label}>
              Format
            </AppText>
            <View style={styles.row}>
              {(Object.keys(FORMATS) as Format[]).map((key) => (
                <Pressable key={key} onPress={() => setFormat(key)} style={chip(format === key)} accessibilityRole="button">
                  <AppText variant="caption" style={{ color: format === key ? '#fff' : theme.colors.text }}>
                    {FORMATS[key].label}
                  </AppText>
                </Pressable>
              ))}
            </View>

            <AppText variant="caption" color="textSecondary" style={styles.label}>
              Tema
            </AppText>
            <View style={styles.row}>
              {(Object.keys(THEMES) as ThemeKey[]).map((key) => (
                <Pressable key={key} onPress={() => setThemeKey(key)} style={chip(themeKey === key)} accessibilityRole="button">
                  <AppText variant="caption" style={{ color: themeKey === key ? '#fff' : theme.colors.text }}>
                    {THEMES[key].label}
                  </AppText>
                </Pressable>
              ))}
            </View>

            {replies > 0 ? (
              <>
                <AppText variant="caption" color="textSecondary" style={styles.label}>
                  Dahil edilecek yanıt (sırayla)
                </AppText>
                <View style={styles.row}>
                  {Array.from({ length: replies + 1 }, (_, index) => index).map((value) => (
                    <Pressable key={value} onPress={() => setCount(value)} style={chip(effectiveCount === value)}>
                      <AppText variant="caption" style={{ color: effectiveCount === value ? '#fff' : theme.colors.text }}>
                        {value === 0 ? 'Yalnız yorum' : `${value}`}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {message ? (
              <AppText variant="caption" color="danger" align="center">
                {message}
              </AppText>
            ) : null}

            <Pressable
              onPress={exportImage}
              disabled={busy}
              style={[styles.cta, { backgroundColor: theme.colors.primary, opacity: busy ? 0.6 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Görseli paylaş"
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="share-social" size={18} color="#fff" />}
              <AppText variant="bodyStrong" style={{ color: '#fff' }}>
                Görseli paylaş
              </AppText>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  body: { paddingHorizontal: 20, gap: 10 },
  preview: { alignItems: 'center', paddingVertical: 8 },
  label: { marginTop: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  cta: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
});
