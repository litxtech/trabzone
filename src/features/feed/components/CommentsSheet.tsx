import { CommentsSheet as PremiumCommentsSheet } from '@/features/comments/components/CommentsSheet';

/**
 * Feed gönderileri için ortak premium yorum kartı.
 * Eski çağrı imzası korunur; veri ve etkileşimler tek çekirdekten yürür.
 */
export function CommentsSheet({
  visible,
  postId,
  commentCount,
  onClose,
}: {
  visible: boolean;
  postId: string;
  commentCount: number;
  onClose: () => void;
}) {
  return (
    <PremiumCommentsSheet
      key={postId}
      visible={visible}
      contentType="post"
      contentId={postId}
      commentCount={commentCount}
      onClose={onClose}
    />
  );
}
