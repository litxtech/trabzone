import { supabase } from './client';

/**
 * Oturumdaki kullanıcı kimliği.
 *
 * Önce yerel oturum önbelleği okunur: `getUser()` her çağrıda `/auth/v1/user`
 * ucuna ağ isteği atar ve giriş sonrası akışı gereksiz yere bekletir. Yerel
 * oturumdaki kimlik, sunucudakiyle aynıdır; yetkilendirme zaten RLS ve
 * `security definer` fonksiyonlarla sunucuda uygulanır. Önbellek boşsa (ör.
 * oturum henüz yazılmadı) sunucuya sorulur.
 */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const cached = data.session?.user?.id;
  if (cached) {
    return cached;
  }
  const { data: remote } = await supabase.auth.getUser();
  return remote.user?.id ?? null;
}
