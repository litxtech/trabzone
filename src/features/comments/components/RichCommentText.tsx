import { useMemo } from 'react';
import { StyleSheet, Text, type TextStyle } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { openSafeLink, tokenizeComment } from '../links';

type Props = {
  body: string;
  /** Yorum sahibi kendi metnini düzenlerken bağlantı açılmasın. */
  interactive?: boolean;
  muted?: boolean;
  style?: TextStyle;
};

/**
 * Yorum metnini güvenli biçimde işler:
 * - Yalnızca http(s) adresleri tıklanabilir.
 * - Uzun adresler zero-width space ile satır sonundan bölünür; kart taşmaz.
 * - Etiket metni orijinal adrestir; kopyalanan değer bozulmaz.
 */
export function RichCommentText({ body, interactive = true, muted, style }: Props) {
  const { theme } = useTheme();
  const tokens = useMemo(() => tokenizeComment(body), [body]);

  return (
    <Text
      style={[
        styles.text,
        { color: muted ? theme.colors.textSecondary : theme.colors.text },
        style,
      ]}
      accessibilityLabel={body}
    >
      {tokens.map((token, index) => {
        if (token.type === 'text') {
          return <Text key={`t-${index}`}>{token.value}</Text>;
        }
        return (
          <Text
            key={`l-${index}`}
            suppressHighlighting
            onPress={
              interactive
                ? () => {
                    void openSafeLink(token.href);
                  }
                : undefined
            }
            style={[styles.link, { color: theme.colors.primaryDeep }]}
          >
            {token.value.replaceAll('/', '/\u200B')}
          </Text>
        );
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 14.5, lineHeight: 20.5, flexShrink: 1 },
  link: { textDecorationLine: 'underline' },
});
