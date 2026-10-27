import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { appError } from '@/services/errors';
import { supabase } from '@/services/supabase/client';
import { fail, ok, type Result } from '@/utils/result';

export type MediaKind = 'avatar' | 'cover';

const BUCKET: Record<MediaKind, string> = { avatar: 'avatars', cover: 'covers' };

const MAX_BYTES: Record<MediaKind, number> = {
  avatar: 6 * 1024 * 1024,
  cover: 10 * 1024 * 1024,
};

/**
 * Profiles only need a small, square avatar and a wide cover. Downscaling on the
 * device keeps uploads fast on mobile data and keeps storage costs predictable.
 */
const TARGET: Record<MediaKind, { size: number; square: boolean; compress: number }> = {
  avatar: { size: 512, square: true, compress: 0.86 },
  cover: { size: 1600, square: false, compress: 0.82 },
};

const SAFE_SEGMENT = /[^a-zA-Z0-9._-]/g;

export function mediaPublicUrl(kind: MediaKind, path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  const { data } = supabase.storage.from(BUCKET[kind]).getPublicUrl(path);
  return data.publicUrl || null;
}

async function shrink(kind: MediaKind, uri: string): Promise<string> {
  const config = TARGET[kind];
  const source = await ImageManipulator.manipulate(uri).renderAsync();

  if (!config.square) {
    const scaled = ImageManipulator.manipulate(source)
      .resize({ width: Math.min(config.size, source.width), height: null })
      .renderAsync();
    const rendered = await scaled;
    const saved = await rendered.saveAsync({ compress: config.compress, format: SaveFormat.JPEG });
    return saved.uri;
  }

  const side = Math.min(source.width, source.height);
  const square = ImageManipulator.manipulate(source)
    .crop({
      originX: Math.floor((source.width - side) / 2),
      originY: Math.floor((source.height - side) / 2),
      width: side,
      height: side,
    })
    .resize({ width: Math.min(config.size, side), height: Math.min(config.size, side) })
    .renderAsync();

  const rendered = await square;
  const saved = await rendered.saveAsync({ compress: config.compress, format: SaveFormat.JPEG });
  return saved.uri;
}

export type UploadedMedia = { path: string; url: string };

/**
 * Uploads an avatar/cover and returns the storage path that belongs in
 * `profiles.avatar_path` / `profiles.cover_path`.
 */
export async function uploadProfileMedia(input: {
  kind: MediaKind;
  userId: string;
  uri: string;
  size?: number;
  mime?: string;
}): Promise<Result<UploadedMedia>> {
  if (input.size && input.size > MAX_BYTES[input.kind]) {
    return fail(
      appError(
        'invalid_input',
        input.kind === 'avatar'
          ? 'Profil fotoğrafı 6 MB sınırını aşıyor.'
          : 'Kapak fotoğrafı 10 MB sınırını aşıyor.',
      ),
    );
  }

  let preparedUri: string;
  try {
    preparedUri = await shrink(input.kind, input.uri);
  } catch {
    return fail(appError('unknown', 'Görsel işlenemedi. Başka bir fotoğraf dene.'));
  }

  try {
    const response = await fetch(preparedUri);
    const blob = await response.arrayBuffer();
    const safeName = `${input.kind}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.jpg`.replace(SAFE_SEGMENT, '_');
    const path = `${input.userId}/${safeName}`;

    const { error } = await supabase.storage.from(BUCKET[input.kind]).upload(path, blob, {
      contentType: 'image/jpeg',
      upsert: false,
    });

    if (error) {
      const missingBucket = error.message.toLowerCase().includes('bucket not found');
      return fail(
        appError(
          'unknown',
          missingBucket
            ? 'Medya deposu hazır değil. Lütfen daha sonra tekrar dene.'
            : 'Fotoğraf yüklenemedi. Bağlantını kontrol edip tekrar dene.',
        ),
      );
    }

    const { data } = supabase.storage.from(BUCKET[input.kind]).getPublicUrl(path);
    return ok({ path, url: data.publicUrl });
  } catch {
    return fail(appError('network'));
  }
}

/** Best effort: a stale file costs storage but never blocks the user. */
export async function deleteProfileMedia(kind: MediaKind, path: string | null | undefined) {
  if (!path) {
    return;
  }
  await supabase.storage.from(BUCKET[kind]).remove([path]);
}
