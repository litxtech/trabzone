import { Ionicons } from '@expo/vector-icons';
import { useMemo, type ReactNode } from 'react';
import { Image, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

type Block =
  | { type: 'heading'; level: 2 | 3 | 4; text: string; id: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; lines: string[] }
  | { type: 'code'; text: string }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'hr' }
  | { type: 'image'; src: string; alt: string };

function slugify(value: string): string {
  return (
    value
      .toLocaleLowerCase('tr-TR')
      .replace(/ı/g, 'i')
      .replace(/ş/g, 's')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'bolum'
  );
}

function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const used = new Set<string>();
  let index = 0;

  while (index < lines.length) {
    const line = (lines[index] ?? '').trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (line.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      const text = (heading[2] ?? '').trim();
      const base = slugify(text);
      let id = base;
      let counter = 2;
      while (used.has(id)) {
        id = `${base}-${counter}`;
        counter += 1;
      }
      used.add(id);
      blocks.push({
        type: 'heading',
        level: (heading[1] ?? '##').length as 2 | 3 | 4,
        text,
        id,
      });
      index += 1;
      continue;
    }

    if (/^---+$/.test(line)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      /^\|?\s*:?-{3,}/.test((lines[index + 1] ?? '').trim())
    ) {
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? '').trim().includes('|')) {
        rows.push(
          (lines[index] ?? '')
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => cell.trim()),
        );
        index += 1;
      }
      rows.splice(1, 1);
      const [header, ...body] = rows;
      blocks.push({ type: 'table', header: header ?? [], rows: body });
      continue;
    }

    if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const ordered = /^\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim();
        const match = ordered ? current.match(/^\d+[.)]\s+(.+)$/) : current.match(/^[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(match[1] ?? '');
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (line.startsWith('>')) {
      const quoted: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('>')) {
        quoted.push((lines[index] ?? '').trim().replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', lines: quoted });
      continue;
    }

    const image = line.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/);
    if (image) {
      blocks.push({ type: 'image', alt: image[1] ?? '', src: image[2] ?? '' });
      index += 1;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length) {
      const next = (lines[index] ?? '').trim();
      if (
        !next ||
        next.startsWith('#') ||
        next.startsWith('```') ||
        next.startsWith('>') ||
        /^[-*+]\s+/.test(next) ||
        /^\d+[.)]\s+/.test(next) ||
        /^---+$/.test(next) ||
        next.includes('|')
      ) {
        break;
      }
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

/** `**kalın**`, `*eğik*`, `` `kod` `` ve [bağlantı](url) biçimlerini işler. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const id = `${keyPrefix}-${key}`;
    key += 1;

    if (token.startsWith('**')) {
      nodes.push(
        <AppText key={id} variant="bodyStrong">
          {token.slice(2, -2)}
        </AppText>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <AppText key={id} variant="body" style={styles.inlineCode}>
          {token.slice(1, -1)}
        </AppText>,
      );
    } else if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        nodes.push(
          <AppText
            key={id}
            variant="body"
            color="primary"
            style={styles.link}
            onPress={() => {
              const href = link[2] ?? '';
              if (/^https?:\/\//i.test(href)) {
                void Linking.openURL(href);
              }
            }}
          >
            {link[1]}
          </AppText>,
        );
      }
    } else {
      nodes.push(
        <AppText key={id} variant="body" style={styles.italic}>
          {token.slice(1, -1)}
        </AppText>,
      );
    }
    last = match.index + token.length;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function extractHeadings(markdown: string): { id: string; text: string }[] {
  return parse(markdown)
    .filter((block): block is Extract<Block, { type: 'heading' }> => block.type === 'heading')
    .filter((heading) => heading.level === 2)
    .slice(0, 14)
    .map((heading) => ({ id: heading.id, text: heading.text }));
}

export function MarkdownView({ markdown }: { markdown: string }) {
  const { theme } = useTheme();
  const blocks = useMemo(() => parse(markdown), [markdown]);

  return (
    <View style={styles.root}>
      {blocks.map((block, blockIndex) => {
        const key = `block-${blockIndex}`;

        if (block.type === 'heading') {
          const variant = block.level === 2 ? 'h2' : block.level === 3 ? 'h3' : 'title';
          return (
            <View key={key} nativeID={Platform.OS === 'web' ? block.id : undefined} style={styles.heading}>
              <AppText variant={variant}>{renderInline(block.text, key)}</AppText>
            </View>
          );
        }

        if (block.type === 'paragraph') {
          return (
            <AppText key={key} variant="body" color="textSecondary" style={styles.paragraph}>
              {renderInline(block.text, key)}
            </AppText>
          );
        }

        if (block.type === 'list') {
          return (
            <View key={key} style={styles.list}>
              {block.items.map((item, itemIndex) => (
                <View key={`${key}-${itemIndex}`} style={styles.listRow}>
                  <AppText variant="body" color="textTertiary" style={styles.bullet}>
                    {block.ordered ? `${itemIndex + 1}.` : '•'}
                  </AppText>
                  <AppText variant="body" color="textSecondary" style={styles.flex}>
                    {renderInline(item, `${key}-${itemIndex}`)}
                  </AppText>
                </View>
              ))}
            </View>
          );
        }

        if (block.type === 'quote') {
          return (
            <View
              key={key}
              style={[
                styles.quote,
                { borderLeftColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
              ]}
            >
              {block.lines.map((line, lineIndex) => (
                <AppText key={`${key}-${lineIndex}`} variant="body" color="textSecondary">
                  {renderInline(line, `${key}-${lineIndex}`)}
                </AppText>
              ))}
            </View>
          );
        }

        if (block.type === 'code') {
          return (
            <ScrollView key={key} horizontal style={styles.codeScroll}>
              <View style={[styles.code, { backgroundColor: theme.colors.surfaceInverse }]}>
                <AppText variant="caption" color={theme.scheme === 'dark' ? '#E6EDF7' : '#E6EDF7'}>
                  {block.text}
                </AppText>
              </View>
            </ScrollView>
          );
        }

        if (block.type === 'table') {
          return (
            <ScrollView key={key} horizontal style={styles.tableScroll}>
              <View style={[styles.table, { borderColor: theme.colors.border }]}>
                <View style={[styles.tableRow, { backgroundColor: theme.colors.surfaceMuted }]}>
                  {block.header.map((cell, cellIndex) => (
                    <View key={`${key}-h-${cellIndex}`} style={[styles.tableCell, { borderColor: theme.colors.border }]}>
                      <AppText variant="label">{renderInline(cell, `${key}-h-${cellIndex}`)}</AppText>
                    </View>
                  ))}
                </View>
                {block.rows.map((row, rowIndex) => (
                  <View key={`${key}-r-${rowIndex}`} style={styles.tableRow}>
                    {block.header.map((_, cellIndex) => (
                      <View
                        key={`${key}-r-${rowIndex}-${cellIndex}`}
                        style={[styles.tableCell, { borderColor: theme.colors.border }]}
                      >
                        <AppText variant="caption" color="textSecondary">
                          {renderInline(row[cellIndex] ?? '', `${key}-r-${rowIndex}-${cellIndex}`)}
                        </AppText>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
          );
        }

        if (block.type === 'image') {
          return (
            <Image
              key={key}
              source={{ uri: block.src }}
              accessibilityLabel={block.alt}
              style={styles.image}
              resizeMode="cover"
            />
          );
        }

        return (
          <View key={key} style={[styles.hr, { backgroundColor: theme.colors.divider }]}>
            <Ionicons name="ellipsis-horizontal" size={16} color={theme.colors.textTertiary} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 2 },
  heading: { marginTop: 26, marginBottom: 10 },
  paragraph: { marginBottom: 14, lineHeight: 26 },
  flex: { flex: 1 },
  list: { marginBottom: 14, gap: 8 },
  listRow: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  bullet: { width: 20, lineHeight: 24 },
  quote: { borderLeftWidth: 4, padding: 14, marginBottom: 16, gap: 6 },
  codeScroll: { marginBottom: 16 },
  code: { padding: 14, borderRadius: 12, minWidth: 280 },
  tableScroll: { marginBottom: 18 },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  tableRow: { flexDirection: 'row' },
  tableCell: {
    minWidth: 120,
    maxWidth: 240,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  image: { width: '100%', height: 220, borderRadius: 14, marginBottom: 16 },
  hr: { height: 1, alignItems: 'center', justifyContent: 'center', marginVertical: 20 },
  inlineCode: {
    backgroundColor: 'rgba(65,105,245,0.12)',
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  link: { textDecorationLine: 'underline' },
  italic: { fontStyle: 'italic' },
});

