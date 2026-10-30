import { appError, type AppError } from '@/services/errors';
import { rpcError } from '@/services/rpc';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

import { uploadMedia, uploadVideoWithPoster, removeMedia } from '@/features/media/media-service';
import type { PickedAsset } from '@/features/media/media-picker';

import type { CommentContentType, CommentMediaInput, CommentNode, CommentPage } from '../types';

const COMMENT_MEDIA_BUCKET = 'posts' as const;

/** Sunucudan gelen JSON'u eksiksiz istemci modeline çevirir. */
function normalizeComment(node: CommentNode): CommentNode {
  return {
    ...node,
    body: node.body ?? '',
    like_count: Math.max(0, node.like_count ?? 0),
    reply_count: Math.max(0, node.reply_count ?? 0),
    media: Array.isArray(node.media) ? node.media : [],
    replies: Array.isArray(node.replies) ? node.replies.map(normalizeComment) : [],
  };
}

export async function fetchCommentPage(input: {
  contentType: CommentContentType;
  contentId: string;
  offset?: number;
  limit?: number;
}): Promise<Result<CommentPage>> {
  const { data, error } = await supabase.rpc('comment_list', {
    p_content_type: input.contentType,
    p_content_id: input.contentId,
    p_limit: input.limit ?? 20,
    p_offset: input.offset ?? 0,
  });

  if (error) {
    return fail(rpcError(error));
  }

  const payload = (data ?? {}) as { items?: CommentNode[]; has_more?: boolean };
  return ok({
    items: (payload.items ?? []).map(normalizeComment),
    has_more: Boolean(payload.has_more),
  });
}

export async function fetchCommentReplies(input: {
  contentType: CommentContentType;
  parentId: string;
  limit?: number;
  offset?: number;
}): Promise<Result<CommentNode[]>> {
  const { data, error } = await supabase.rpc('comment_replies', {
    p_content_type: input.contentType,
    p_parent_id: input.parentId,
    p_limit: input.limit ?? 30,
    p_offset: input.offset ?? 0,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(
    (((data as { items?: CommentNode[] } | null)?.items ?? []) as CommentNode[]).map(
      normalizeComment,
    ),
  );
}

export async function addComment(input: {
  contentType: CommentContentType;
  contentId: string;
  body: string;
  parentId?: string | null;
  media?: CommentMediaInput[];
}): Promise<Result<CommentNode>> {
  const { data, error } = await supabase.rpc('comment_add', {
    p_content_type: input.contentType,
    p_content_id: input.contentId,
    p_body: input.body,
    p_parent: input.parentId ?? null,
    p_media: input.media ?? [],
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(normalizeComment(data as CommentNode));
}

export async function updateComment(input: {
  contentType: CommentContentType;
  commentId: string;
  body: string;
}): Promise<Result<CommentNode>> {
  const { data, error } = await supabase.rpc('comment_update', {
    p_content_type: input.contentType,
    p_comment_id: input.commentId,
    p_body: input.body,
  });

  if (error) {
    return fail(rpcError(error));
  }
  return ok(normalizeComment(data as CommentNode));
}

export async function deleteComment(input: {
  contentType: CommentContentType;
  commentId: string;
}): Promise<Result<string[]>> {
  const { data, error } = await supabase.rpc('comment_delete', {
    p_content_type: input.contentType,
    p_comment_id: input.commentId,
  });

  if (error) {
    return fail(rpcError(error));
  }

  const paths = ((data as { media_paths?: unknown } | null)?.media_paths ?? []) as unknown[];
  const mediaPaths = paths.filter((path): path is string => typeof path === 'string');

  if (mediaPaths.length > 0) {
    void removeMedia(COMMENT_MEDIA_BUCKET, mediaPaths);
  }
  return ok(mediaPaths);
}

export async function toggleCommentLike(input: {
  contentType: CommentContentType;
  commentId: string;
}): Promise<Result<{ liked: boolean; like_count: number }>> {
  const { data, error } = await supabase.rpc('comment_toggle_like', {
    p_content_type: input.contentType,
    p_comment_id: input.commentId,
  });

  if (error) {
    return fail(rpcError(error));
  }

  const payload = (data ?? {}) as { liked?: boolean; like_count?: number };
  return ok({
    liked: Boolean(payload.liked),
    like_count: Math.max(0, payload.like_count ?? 0),
  });
}

/**
 * Aynı anda yürütülen yükleme sayısı.
 *
 * Eklentiler sırayla yüklenirken dört fotoğraflı bir yorum, ilk dosyanın
 * bitmesini beklemeden diğerlerine hiç başlamıyordu; toplam süre dosya
 * sürelerinin toplamına eşitti. Üç paralel istek mobil bağlantıda da
 * tıkanmadan çalışır ve algılanan süreyi belirgin biçimde kısaltır.
 */
const UPLOAD_CONCURRENCY = 3;

/** Tek bir eklentiyi yükler; ilerleme 0..1 aralığında bildirilir. */
async function uploadCommentAsset(
  uploaderId: string,
  asset: PickedAsset,
  report: (ratio: number) => void,
): Promise<Result<CommentMediaInput>> {
  if (asset.mediaType === 'video') {
    const uploaded = await uploadVideoWithPoster({
      bucket: COMMENT_MEDIA_BUCKET,
      folder: uploaderId,
      uri: asset.uri,
      mime: asset.mimeType ?? 'video/mp4',
      fileName: asset.fileName,
      durationMs: asset.durationMs,
      width: asset.width,
      height: asset.height,
      fileSize: asset.fileSize,
      onProgress: (_stage, ratio) => report(ratio),
    });

    if (!uploaded.ok) {
      return fail(uploaded.error);
    }

    report(1);
    return ok({
      media_type: 'video',
      storage_path: uploaded.data.video.path,
      thumbnail_path: uploaded.data.video.thumbnailPath ?? null,
      width: uploaded.data.video.width ?? asset.width,
      height: uploaded.data.video.height ?? asset.height,
      duration_ms: uploaded.data.video.durationMs ?? asset.durationMs,
    });
  }

  const uploaded = await uploadMedia({
    bucket: COMMENT_MEDIA_BUCKET,
    folder: uploaderId,
    uri: asset.uri,
    mime: asset.mimeType,
    fileName: asset.fileName,
    width: asset.width,
    height: asset.height,
    fileSize: asset.fileSize,
    onProgress: (_stage, ratio) => report(ratio),
  });

  if (!uploaded.ok) {
    return fail(uploaded.error);
  }

  report(1);
  return ok({
    media_type: 'image',
    storage_path: uploaded.data.path,
    thumbnail_path: null,
    width: uploaded.data.width ?? asset.width,
    height: uploaded.data.height ?? asset.height,
    duration_ms: null,
  });
}

/**
 * Yorum eklentilerini gerçek depoya yükler. Fotoğraf 1600px'e, video paylaşım
 * öncesi hızlı yükleme için yeniden kodlanır. İlerleme 0..1 aralığında bildirilir.
 *
 * Eklentiler paralel yüklenir; sonuç dizisi her zaman seçim sırasını korur.
 * Video kodlaması native tarafta kendi sırasında çalışmaya devam eder, yalnızca
 * ağ aktarımı örtüşür.
 */
export async function uploadCommentAttachments(input: {
  uploaderId: string;
  assets: PickedAsset[];
  onProgress?: (ratio: number) => void;
}): Promise<Result<CommentMediaInput[]>> {
  if (!input.uploaderId) {
    return fail(appError('session_missing'));
  }

  const assets = input.assets.filter(Boolean);
  if (assets.length === 0) {
    return ok([]);
  }

  const total = assets.length;
  const results: (CommentMediaInput | null)[] = new Array(total).fill(null);
  const ratios: number[] = new Array(total).fill(0);
  let cursor = 0;
  let failure: AppError | null = null;

  const reportAll = () => {
    const sum = ratios.reduce((acc, value) => acc + value, 0);
    input.onProgress?.(Math.min(1, sum / total));
  };

  const worker = async (): Promise<void> => {
    while (!failure) {
      const index = cursor;
      cursor += 1;
      if (index >= total) {
        return;
      }
      const asset = assets[index];
      if (!asset) {
        continue;
      }

      const result = await uploadCommentAsset(input.uploaderId, asset, (ratio) => {
        const next = Math.min(1, Math.max(ratios[index] ?? 0, ratio));
        if (next === ratios[index]) {
          return;
        }
        ratios[index] = next;
        reportAll();
      });

      if (!result.ok) {
        failure = failure ?? result.error;
        return;
      }

      results[index] = result.data;
      ratios[index] = 1;
      reportAll();
    }
  };

  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, total) }, () => worker()));

  if (failure) {
    // Yarıda kalan gönderimde başarıyla yüklenmiş dosyalar depoda kalmasın.
    const uploadedPaths = results.flatMap((item) => {
      if (!item) {
        return [];
      }
      return item.thumbnail_path ? [item.storage_path, item.thumbnail_path] : [item.storage_path];
    });
    if (uploadedPaths.length > 0) {
      void removeMedia(COMMENT_MEDIA_BUCKET, uploadedPaths);
    }
    return fail(failure);
  }

  return ok(results.filter((item): item is CommentMediaInput => item !== null));
}
