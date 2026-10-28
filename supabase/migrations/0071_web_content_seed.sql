-- =============================================================================
-- 0071: Web sitesi içerik varsayılanları ve e-posta şablonları
-- =============================================================================

set search_path = public, extensions;

insert into public.website_settings (key, value) values
  ('brand', jsonb_build_object(
    'name', 'Trabzone',
    'tagline', 'Bir Şehirden Daha Fazlası.',
    'support_email', 'support@litxtech.com'
  )),
  ('hero', jsonb_build_object(
    'eyebrow', 'TRABZON''UN DİJİTAL MERKEZİ',
    'title', 'TRABZONE',
    'slogan', 'Bir Şehirden Daha Fazlası. Birlikte Daha Güçlüyüz.',
    'description', 'Paylaş, keşfet, yeni insanlarla tanış ve Trabzon''un dijital dünyasına katıl.',
    'primary_cta', 'Hemen Katıl',
    'secondary_cta', 'Giriş Yap',
    'tertiary_cta', 'Uygulamayı Keşfet'
  )),
  ('nav', jsonb_build_object(
    'items', jsonb_build_array(
      jsonb_build_object('label', 'Ana Sayfa', 'href', '/'),
      jsonb_build_object('label', 'Keşfet', 'href', '/explore'),
      jsonb_build_object('label', 'Reels', 'href', '/reels'),
      jsonb_build_object('label', 'Marketplace', 'href', '/marketplace'),
      jsonb_build_object('label', 'Emlak', 'href', '/real-estate'),
      jsonb_build_object('label', 'İşletmeler', 'href', '/businesses'),
      jsonb_build_object('label', 'Harita', 'href', '/map'),
      jsonb_build_object('label', 'Hakkımızda', 'href', '/about'),
      jsonb_build_object('label', 'Destek', 'href', '/support')
    )
  )),
  ('apps', jsonb_build_object(
    'ios_url', null,
    'android_url', null,
    'status', 'coming_soon',
    'note', 'Mağaza bağlantıları yayınlandığında bu alandan yönetilir.'
  )),
  ('social', jsonb_build_object(
    'instagram', null,
    'x', null,
    'youtube', null,
    'tiktok', null
  )),
  ('support', jsonb_build_object(
    'live_chat_enabled', true,
    'hours_label', 'Destek saatleri hafta içi 09:00–18:00 (TSİ)',
    'response_note', 'Mesajınız destek ekibine iletilir; ekip çevrimiçi olduğunda yanıtlanır.'
  )),
  ('legal', jsonb_build_object(
    'operator_name', 'Trabzone',
    'operator_note', 'İşletmeci unvanı ve tebligat adresi hukuk danışmanı onayıyla yayımlanacaktır.',
    'terms_version', '2.0',
    'privacy_version', '2.0',
    'last_updated', '2026-10-28'
  ))
on conflict (key) do nothing;

insert into public.website_sections (key, title, subtitle, body, payload, sort_order, is_published) values
  ('social', 'Sosyal Dünyanı Keşfet',
   'Trabzon''un nabzı tek akışta.',
   'Fotoğraf ve video paylaş, hikâyelerini anlat, yorumlarla sohbete katıl. Profilini oluştur, ilgi alanlarına göre insanları takip et ve şehrin gündemini kaçırma.',
   '{"items":["Gönderi ve hikâye paylaşımı","Yorum, beğeni ve kaydetme","Profil ve takip sistemi","Keşfet akışı"]}'::jsonb,
   10, true),
  ('reels', 'Her An Bir Hikâye.',
   'Dikey video deneyimi Trabzone''da.',
   'Kısa videoları kaydırarak keşfet; beğen, yorumla ve paylaş. Videolar sessiz başlar, ses kontrolü sende.',
   '{"items":["Dikey tam ekran oynatma","Beğeni, yorum ve paylaşım","Keşfet ve öneri akışı","Sessiz başlangıç"]}'::jsonb,
   20, true),
  ('marketplace', 'Trabzon''da Aradığın Her Şey.',
   'Al, sat, keşfet.',
   'İkinci el ürünlerden araçlara, emlakten yerel hizmetlere kadar şehrin pazar yeri. İlan ver, favorine ekle ve satıcıyla güvenle iletişime geç.',
   '{"items":["Alışveriş ve ikinci el","Emlak ilanları","Araç ilanları","İşletme ve hizmetler","Haritada keşfet"]}'::jsonb,
   30, true),
  ('map', 'Trabzon''u Yeniden Keşfet.',
   'Şehrin her köşesi haritada.',
   'Restoranlar, oteller, kafeler, işletmeler, kiralık evler ve gezilecek yerler. Yakınındaki fırsatları gör, yol tarifi al ve yerini kaydet.',
   '{"items":["Restoran ve kafeler","Otel ve konaklama","Kiralık ve satılık","Gezilecek yerler"],"preview_note":"Harita görünümü önizlemedir."}'::jsonb,
   40, true),
  ('messaging', 'Bağlantıda Kal.',
   'Gerçek zamanlı, güvenli iletişim.',
   'Birebir mesajlaş, fotoğraf ve video paylaş. İstemediğin kişileri engelle, bildirimlerini yönet ve sohbetlerini kontrol altında tut.',
   '{"items":["Birebir mesajlaşma","Medya paylaşımı","Gerçek zamanlı iletim","Engelleme ve gizlilik"]}'::jsonb,
   50, true),
  ('security', 'Güvenli Bir Topluluk.',
   'Güvenlik bir özellik değil, önceliktir.',
   'Şikâyet et, engelle, içerik moderasyonunu gör. Çocuk güvenliği ve gizlilik tercihleri senin kontrolünde.',
   '{"items":["Kullanıcı ve içerik şikâyeti","Engelleme ve sessize alma","Moderasyon ve itiraz","Çocuk güvenliği","Gizlilik tercihleri"]}'::jsonb,
   60, true),
  ('cta', 'Şehrin dijital dünyasına katıl.',
   'Trabzone hesabınla her yerde aynı deneyim.',
   'Web''de keşfet, uygulamada paylaş. Tek hesap, tek topluluk.',
   '{"primary_label":"Hemen Katıl","primary_href":"/register","secondary_label":"Giriş Yap","secondary_href":"/login"}'::jsonb,
   70, true)
on conflict (key) do nothing;

-- E-posta şablonları: yalnızca gerçekten gönderilen işlem e-postaları.
-- Kimlik doğrulama e-postaları Supabase Auth tarafından yönetilir.
insert into public.email_templates (key, locale, subject, body_html, body_text) values
  ('support_received', 'tr',
   'Trabzone destek talebin alındı — {{reference}}',
   '<div style="font-family:Arial,sans-serif;background:#0b1220;padding:32px"><div style="max-width:560px;margin:auto;background:#111c33;border-radius:16px;padding:28px;color:#e7eefc"><h1 style="color:#7aa2ff;margin:0 0 12px">Trabzone</h1><p>Merhaba {{name}},</p><p>Destek talebin alındı. Referans numaran: <strong>{{reference}}</strong></p><p>{{summary}}</p><p>Durumunu destek merkezinden takip edebilirsin.</p><p style="color:#93a4c3;font-size:12px">Trabzone · Destek Merkezi</p></div></div>',
   'Merhaba {{name}}, destek talebin alındı. Referans: {{reference}}'),
  ('support_reply', 'tr',
   'Trabzone destek yanıtı — {{reference}}',
   '<div style="font-family:Arial,sans-serif;background:#0b1220;padding:32px"><div style="max-width:560px;margin:auto;background:#111c33;border-radius:16px;padding:28px;color:#e7eefc"><h1 style="color:#7aa2ff;margin:0 0 12px">Trabzone</h1><p>Merhaba {{name}},</p><p>Destek talebine yanıt verildi.</p><blockquote style="border-left:3px solid #7aa2ff;padding-left:12px;color:#c7d4ee">{{reply}}</blockquote><p>Referans: <strong>{{reference}}</strong></p></div></div>',
   'Merhaba {{name}}, destek talebine yanıt verildi. Referans: {{reference}}'),
  ('data_request_received', 'tr',
   'Trabzone veri talebin alındı — {{reference}}',
   '<div style="font-family:Arial,sans-serif;background:#0b1220;padding:32px"><div style="max-width:560px;margin:auto;background:#111c33;border-radius:16px;padding:28px;color:#e7eefc"><h1 style="color:#7aa2ff;margin:0 0 12px">Trabzone</h1><p>Merhaba {{name}},</p><p>Kişisel veri talebin alındı. Referans: <strong>{{reference}}</strong></p><p>Talebin yetkili ekip tarafından incelenecek. Durumu veri talepleri sayfasından takip edebilirsin.</p></div></div>',
   'Veri talebin alındı. Referans: {{reference}}'),
  ('data_request_reply', 'tr',
   'Trabzone veri talebin yanıtlandı — {{reference}}',
   '<div style="font-family:Arial,sans-serif;background:#0b1220;padding:32px"><div style="max-width:560px;margin:auto;background:#111c33;border-radius:16px;padding:28px;color:#e7eefc"><h1 style="color:#7aa2ff;margin:0 0 12px">Trabzone</h1><p>Merhaba {{name}},</p><p>Veri talebin yanıtlandı.</p><blockquote style="border-left:3px solid #7aa2ff;padding-left:12px;color:#c7d4ee">{{reply}}</blockquote><p>Referans: <strong>{{reference}}</strong></p></div></div>',
   'Veri talebin yanıtlandı. Referans: {{reference}}'),
  ('deletion_received', 'tr',
   'Trabzone hesap silme talebin alındı',
   '<div style="font-family:Arial,sans-serif;background:#0b1220;padding:32px"><div style="max-width:560px;margin:auto;background:#111c33;border-radius:16px;padding:28px;color:#e7eefc"><h1 style="color:#7aa2ff;margin:0 0 12px">Trabzone</h1><p>Merhaba {{name}},</p><p>Hesap silme talebin kaydedildi. Referans: <strong>{{reference}}</strong></p><p>İşlem tamamlandığında ayrıca bilgilendirileceksin.</p></div></div>',
   'Hesap silme talebin kaydedildi. Referans: {{reference}}'),
  ('deletion_completed', 'tr',
   'Trabzone hesabın silindi',
   '<div style="font-family:Arial,sans-serif;background:#0b1220;padding:32px"><div style="max-width:560px;margin:auto;background:#111c33;border-radius:16px;padding:28px;color:#e7eefc"><h1 style="color:#7aa2ff;margin:0 0 12px">Trabzone</h1><p>Hesabın ve ilişkili verilerin silindi.</p><p>Referans: <strong>{{reference}}</strong></p><p style="color:#93a4c3;font-size:12px">Yasal saklama yükümlülüğü bulunan kayıtlar sınırlı olarak tutulabilir.</p></div></div>',
   'Hesabın silindi. Referans: {{reference}}'),
  ('legal_update', 'tr',
   'Trabzone {{document}} güncellendi',
   '<div style="font-family:Arial,sans-serif;background:#0b1220;padding:32px"><div style="max-width:560px;margin:auto;background:#111c33;border-radius:16px;padding:28px;color:#e7eefc"><h1 style="color:#7aa2ff;margin:0 0 12px">Trabzone</h1><p>Merhaba {{name}},</p><p><strong>{{document}}</strong> güncellendi. Yeni sürüm: {{version}}.</p><p><a href="{{url}}" style="color:#7aa2ff">Yeni metni incele</a></p></div></div>',
   '{{document}} güncellendi. Yeni sürüm: {{version}} — {{url}}'),
  ('child_safety_received', 'tr',
   'Trabzone çocuk güvenliği bildirimin alındı',
   '<div style="font-family:Arial,sans-serif;background:#0b1220;padding:32px"><div style="max-width:560px;margin:auto;background:#111c33;border-radius:16px;padding:28px;color:#e7eefc"><h1 style="color:#7aa2ff;margin:0 0 12px">Trabzone</h1><p>Bildirimin öncelikli güvenlik kuyruğuna alındı.</p><p>Referans: <strong>{{reference}}</strong></p><p>Acil bir durum varsa lütfen doğrudan 112''yi ara.</p></div></div>',
   'Çocuk güvenliği bildirimin alındı. Referans: {{reference}}')
on conflict (key, locale) do nothing;
