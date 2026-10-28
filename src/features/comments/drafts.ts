import type { CommentContentType } from './types';

/**
 * Yorum taslakları yorum kartı kapansa bile bellekte kalır. Kullanıcı yanlışlıkla
 * dış alana dokunduğunda yazdığı metin kaybolmaz.
 */
const drafts = new Map<string, string>();

function key(contentType: CommentContentType, contentId: string) {
  return `${contentType}:${contentId}`;
}

export function readCommentDraft(contentType: CommentContentType, contentId: string): string {
  return drafts.get(key(contentType, contentId)) ?? '';
}

export function writeCommentDraft(
  contentType: CommentContentType,
  contentId: string,
  value: string,
): void {
  if (!value) {
    drafts.delete(key(contentType, contentId));
    return;
  }
  drafts.set(key(contentType, contentId), value);
}
