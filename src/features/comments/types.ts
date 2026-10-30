/** `match`: Maç Arenası yorumları; content_id = sports_fixtures.uid. */
export type CommentContentType = 'post' | 'reel' | 'match';

export type CommentMediaItem = {
  id: string;
  media_type: 'image' | 'video';
  storage_path: string;
  thumbnail_path: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sort_order: number;
};

export type CommentNode = {
  id: string;
  content_type: CommentContentType;
  content_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  like_count: number;
  liked: boolean;
  reply_count: number;
  is_mine: boolean;
  can_edit: boolean;
  can_delete: boolean;
  moderation_status: string;
  author_id: string;
  author_username: string;
  author_first_name: string | null;
  author_last_name: string | null;
  author_avatar_path: string | null;
  author_is_verified: boolean;
  media: CommentMediaItem[];
  replies: CommentNode[];
};

/** RPC'ye gönderilecek medya tanımı (yükleme tamamlandıktan sonra). */
export type CommentMediaInput = {
  media_type: 'image' | 'video';
  storage_path: string;
  thumbnail_path?: string | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
};

export type CommentPage = {
  items: CommentNode[];
  has_more: boolean;
};

export const commentQueryKeys = {
  list: (contentType: CommentContentType, contentId: string) =>
    ['comments', contentType, contentId] as const,
  replies: (contentType: CommentContentType, parentId: string) =>
    ['comments', 'replies', contentType, parentId] as const,
};
