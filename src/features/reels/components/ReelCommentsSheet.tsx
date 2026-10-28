import { CommentsSheet } from '@/features/comments/components/CommentsSheet';

/**
 * Reels yorumları da feed ile aynı premium kartı kullanır. Reels oynatıcısı
 * modal açıldığında unmount edilmez; video arka planda devam eder.
 */
export function ReelCommentsSheet({
  visible,
  reelId,
  commentCount,
  onClose,
}: {
  visible: boolean;
  reelId: string;
  commentCount: number;
  onClose: () => void;
}) {
  return (
    <CommentsSheet
      key={reelId}
      visible={visible}
      contentType="reel"
      contentId={reelId}
      commentCount={commentCount}
      onClose={onClose}
    />
  );
}
