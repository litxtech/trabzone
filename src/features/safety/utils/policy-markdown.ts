/**
 * Politika metinleri `safety_policy_versions.body_md` alaninda Markdown
 * olarak saklanir. Tam bir Markdown motoru eklemek yerine baslik, paragraf ve
 * madde isaretleri icin sade bir cozumleyici kullaniyoruz; boylece bagimlilik
 * eklemeden tum politika ekranlarinda tutarli bir gorunum elde ediyoruz.
 *
 * Desteklenen sozdizimi:
 * - `## Baslik` / `### Alt baslik`
 * - `- madde` veya `* madde`
 * - `**kalin**` (vurgulu metin olarak cizilir)
 * - `# Belge basligi` (baslik ekranda gosterildigi icin atlanir)
 */
export type PolicySection = { title: string | null; paragraphs: string[] };

function stripInline(value: string): string {
  return value.replace(/\*\*/g, '').trim();
}

export function parsePolicyMarkdown(markdown: string): PolicySection[] {
  if (!markdown.trim()) {
    return [];
  }

  const sections: PolicySection[] = [];
  let current: PolicySection = { title: null, paragraphs: [] };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }
    if (line.startsWith('### ')) {
      if (current.paragraphs.length > 0 || current.title) {
        sections.push(current);
      }
      current = { title: stripInline(line.slice(4)), paragraphs: [] };
      continue;
    }
    if (line.startsWith('## ')) {
      if (current.paragraphs.length > 0 || current.title) {
        sections.push(current);
      }
      current = { title: stripInline(line.slice(3)), paragraphs: [] };
      continue;
    }
    if (line.startsWith('# ')) {
      continue;
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      current.paragraphs.push(`- ${line.slice(2)}`);
      continue;
    }
    current.paragraphs.push(line);
  }

  if (current.paragraphs.length > 0 || current.title) {
    sections.push(current);
  }
  return sections;
}
