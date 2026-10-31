-- =====================================================================
-- 0223 — Trabzone Konaklama Misafir Hakları Politikası
--
-- * Politika metni sürümlenmiş hukuki belge olarak yayımlanır
--   (slug: accommodation-guest-rights).
-- * Otel başvurularında işletmecinin üç zorunlu kabul beyanı tesis
--   bazında kayıt altına alınır (acc_policy_acceptances).
-- * Kabul tamamlanmadan başvuru "doğrulamaya gönder" ile ilerleyemez:
--   acc_property_missing() eksik olarak politikayı döndürür.
--
-- Not: Belge `requires_acceptance = false` ile yayımlanır. Böylece tüm
-- kullanıcılar için genel hukuki onay kapısı (legal_my_pending) tetiklenmez;
-- kabul yalnızca tesis başvurusu bağlamında, işletmeci hesabından istenir.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------
-- 1. Politika metni (sürüm 1)
-- ---------------------------------------------------------------------
insert into public.safety_policy_versions (
  slug, version, locale, doc_type, title, summary, body_md,
  is_published, requires_acceptance, requires_reacceptance,
  change_summary, published_at, effective_at
)
select
  'accommodation-guest-rights',
  1,
  'tr',
  'contract',
  'Trabzone Misafir Hakları, Eşit Konaklama ve İşletmeci Yükümlülükleri Politikası',
  'Konaklama işletmelerinin misafirlere karşı yükümlülükleri, eşit ve ayrımcılıktan uzak hizmet esasları ile zorunlu işletmeci kabul beyanı.',
  $policy$# Trabzone Konaklama — Misafir Hakları, Eşit Konaklama ve İşletmeci Yükümlülükleri Politikası

**Belge Türü:** Konaklama İşletmecisi Zorunlu Katılım ve Hizmet Politikası

**Kapsam:** Trabzone Konaklama sistemine kayıtlı oteller, pansiyonlar, apart oteller, bungalov tesisleri, villalar ve diğer yetkili konaklama işletmeleri.

**Yürürlük:** İşletmeci tarafından kabul edilmesi ve Trabzone tarafından yayımlanmasıyla yürürlüğe girer.

## MADDE 1 — AMAÇ VE KAPSAM

Trabzone Konaklama, kullanıcılarına güvenli, saygılı, şeffaf, adil ve ayrımcılıktan uzak bir konaklama deneyimi sunmayı amaçlamaktadır.

Bu politika; Trabzone platformuna katılan konaklama işletmelerinin misafirlere karşı sorumluluklarını, rezervasyon kabul esaslarını, misafir haklarını, işletmecilerin yükümlülüklerini ve ihlal durumunda uygulanabilecek yaptırımları düzenler.

Trabzone üzerinden konaklama hizmeti sunan her işletme, platforma katılmadan önce bu politikayı incelemek ve kabul etmek zorundadır.

İşletmeciler, bu politikada belirtilen yükümlülükleri yalnızca rezervasyon sırasında değil, misafirin tesise gelişinden ayrılışına kadar geçen bütün konaklama süresince yerine getirmeyi kabul eder.

Bu politika, yürürlükteki mevzuattan doğan zorunlu kimlik bildirimi, güvenlik ve diğer yasal yükümlülükleri ortadan kaldırmaz.

## MADDE 2 — AYRIMCILIK YASAĞI

Trabzone Konaklama sistemine katılan bütün tesisler, misafirlere eşit ve saygılı hizmet sunmakla yükümlüdür.

İşletmeciler ve çalışanları, yürürlükteki mevzuatla korunan kişisel özellikler nedeniyle ayrımcı davranamaz.

Özellikle medeni hâl, cinsiyet, dil, din, inanç, etnik köken, engellilik ve mevzuatın koruduğu diğer nedenlere dayanılarak misafirlerin konaklama hizmetinden yararlanması engellenemez.

Misafirlerin kişisel yaşamları hakkında gereksiz sorgulama yapılamaz.

Konaklama hizmeti, kişilerin medeni durumlarına ilişkin değerlendirmelerle sınırlandırılamaz.

**Trabzone, misafirlerine yönelik ayrımcı uygulamaları ciddi bir platform politikası ihlali olarak değerlendirir.**

## MADDE 3 — BEKÂR MİSAFİRLERİN KONAKLAMA HAKKI

Trabzone Konaklama'ya kayıtlı işletmeler, yetişkin misafirlerin bekâr olmaları nedeniyle rezervasyonlarını reddedemez.

Bekâr bir kullanıcı;

- Tek başına konaklayabilir.
- Başka bir yetişkinle aynı odada konaklayabilir.
- Arkadaşlarıyla konaklayabilir.
- Yasal kapasite sınırları içerisinde grup rezervasyonu oluşturabilir.

İşletmeci, yalnızca bekâr olduğu gerekçesiyle kullanıcıya farklı fiyat uygulayamaz, ilave depozito isteyemez veya özel bir belge şartı getiremez.

Misafirin medeni durumuna dayanılarak hakaret, aşağılama, küçük düşürme veya özel hayatına ilişkin yargılayıcı ifadeler kullanılamaz.

## MADDE 4 — EVLİ OLMAYAN ÇİFTLERİN KONAKLAMASI

Trabzone Konaklama'ya katılan tesisler, birlikte konaklamak isteyen yetişkin kişiler arasında evlilik bağı bulunmasını rezervasyonun ön koşulu olarak belirleyemez.

İşletmeler aşağıdaki uygulamalarda bulunamaz:

- Birlikte konaklayacak yetişkin kişilerden evlilik cüzdanı talep etmek.
- Evlilik belgesi sunulmadığı için rezervasyonu reddetmek.
- Misafirlerin evli olup olmadığını sorgulayarak konaklama hakkını kısıtlamak.
- Evlilik bağı bulunmayan misafirlere farklı fiyat uygulamak.
- Misafirleri ayrı oda tutmaya zorlamak.
- Yalnızca medeni durumları nedeniyle ek ücret veya güvence bedeli talep etmek.
- Misafirlerin kişisel ilişkileri hakkında aşağılayıcı yorum yapmak.
- Rezervasyonu onayladıktan sonra medeni durum gerekçesiyle tesise kabulden vazgeçmek.

**Trabzone üzerinden yapılan uygun rezervasyonlarda, birlikte konaklayan yetişkin misafirlerin evli olmaması tek başına konaklamanın reddedilmesi için kabul edilebilir bir gerekçe değildir.**

Bu madde, yasal yaş, kimlik doğrulama ve güvenlikle ilgili zorunlu kuralları ortadan kaldırmaz.

## MADDE 5 — KİMLİK KONTROLÜ VE YASAL YÜKÜMLÜLÜKLER

Konaklama işletmeleri, yürürlükteki Türkiye Cumhuriyeti mevzuatının gerektirdiği kimlik tespiti ve bildirim işlemlerini yerine getirmek zorundadır.

Bu nedenle tesisler, konaklayacak kişilerden mevzuata uygun geçerli kimlik bilgilerini ve gerekli belgeleri talep edebilir.

Ancak kimlik kontrolü, misafirlerin özel hayatına müdahale etmek veya medeni durumlarını araştırmak amacıyla kullanılamaz.

İşletmeciler:

- Kimlik verilerini yalnızca hukuka uygun amaçlarla işlemelidir.
- Gereksiz kişisel veri toplamamalıdır.
- Kimlik belgesinin fotokopisini hukuki dayanak olmadan saklamamalıdır.
- Kimlik bilgilerini yetkisiz kişilerle paylaşmamalıdır.
- Konaklama kayıtlarını güvenli şekilde korumalıdır.
- Zorunlu olmayan belgeleri misafirlerden talep etmemelidir.

Kimlik doğrulaması ile evlilik durumunun ispatlanması birbirinden farklı işlemlerdir.

**Kimlik tespiti yasal bir yükümlülük olabilir; evlilik cüzdanı ise Trabzone tarafından rezervasyon koşulu olarak kabul edilmez.**

## MADDE 6 — REZERVASYONUN KABUL EDİLMESİ

Otel tarafından onaylanmış veya anında rezervasyon sistemi üzerinden kesinleşmiş bir rezervasyon, belirtilen koşullar çerçevesinde işletme tarafından yerine getirilmelidir.

İşletmeci;

- Rezervasyon tarihlerini,
- Oda tipini,
- Misafir sayısını,
- Konaklama ücretini,
- İptal koşullarını,
- Dahil olan hizmetleri

rezervasyon sırasında belirtilen esaslara uygun biçimde uygulamakla yükümlüdür.

İşletme, rezervasyon sonrasında kullanıcı aleyhine keyfi ve tek taraflı yeni koşullar ileri süremez.

Rezervasyonun geçerli bir nedenle yerine getirilemeyeceği durumlarda kullanıcı gecikmeden bilgilendirilmeli ve Trabzone'un uyuşmazlık süreci işletilmelidir.

## MADDE 7 — MİSAFİRİN TESİSE KABULÜ

Geçerli ve onaylı rezervasyonla tesise gelen misafirlerin giriş işlemleri makul süre içinde gerçekleştirilmelidir.

İşletmeci, misafirin girişini gereksiz yere geciktiremez.

Yasal kimlik kontrolü ve önceden açıklanmış objektif konaklama şartları dışında keyfi engeller çıkarılamaz.

Özellikle misafirin medeni durumu, kişisel yaşamı veya birlikte konaklayacağı yetişkin kişiyle ilişkisi hakkında gereksiz sorgulama yapılamaz.

Tesis personeli bütün misafirlere saygılı davranmakla yükümlüdür.

## MADDE 8 — FİYAT ŞEFFAFLIĞI VE EK ÜCRETLER

Trabzone üzerinden rezervasyon yapan kullanıcılar, rezervasyon sırasında açıkça bildirilen konaklama bedelini ve koşullarını bilme hakkına sahiptir.

İşletmeciler;

- Gizli ücret uygulayamaz.
- Medeni durum nedeniyle ek ücret alamaz.
- Açıklanmayan zorunlu hizmet bedellerini sonradan talep edemez.
- Rezervasyon onaylandıktan sonra keyfi fiyat artışı yapamaz.
- İndirimli fiyatın koşullarını gizleyemez.
- Yanıltıcı indirim oranları kullanamaz.

Kanunen zorunlu veya rezervasyon koşullarında açıkça belirtilen ücretler ayrı değerlendirilir.

Misafir, fiyat uyuşmazlığı yaşadığında Trabzone üzerinden destek talebi oluşturabilir.

## MADDE 9 — ÖZEL HAYATA SAYGI

Misafirlerin özel hayatının gizliliği temel ilkelerden biridir.

İşletmeciler ve çalışanları:

- Misafirlerin ilişkilerini sorgulayamaz.
- Özel hayatlarına ilişkin dedikodu yapamaz.
- Misafirleri diğer kişilerin önünde küçük düşüremez.
- Rezervasyon bilgilerini üçüncü kişilere açıklayamaz.
- Misafirlerin fotoğraf veya görüntülerini izinsiz yayımlayamaz.
- Odalara hukuka aykırı biçimde giremez.
- Misafir bilgilerini yetkisiz kişilere veremez.

Hukuken gerekli bildirimler ile yetkili mercilerin usulüne uygun talepleri bu hükümlerin istisnasıdır.

## MADDE 10 — GÜVENLİ KONAKLAMA

İşletmeciler, misafirlerin güvenliğini sağlamak amacıyla yürürlükteki mevzuatın ve tesisin niteliğinin gerektirdiği tedbirleri almakla yükümlüdür.

Bu kapsamda:

- Yangın güvenliği.
- Acil çıkışlar.
- Oda kilitleri.
- Temizlik ve hijyen.
- Elektrik ve tesisat güvenliği.
- Ortak alan güvenliği.
- Acil durum bilgilendirmesi.
- Gerekli personel eğitimi.

konularında yükümlülüklerini yerine getirmelidir.

Misafir güvenliği gerekçesi, ayrımcı veya keyfi uygulamaların bahanesi olarak kullanılamaz.

## MADDE 11 — SAYGILI PERSONEL DAVRANIŞI

Tesis çalışanları misafirlerle profesyonel bir iletişim kurmalıdır.

Aşağıdaki davranışlar yasaktır:

- Hakaret.
- Tehdit.
- Taciz.
- Aşağılama.
- Ayrımcı söylem.
- Medeni durum sorgulaması yoluyla baskı.
- Keyfi hizmet reddi.
- Misafiri başka misafirlerin önünde küçük düşürme.

Tesis işletmecisi, çalışanlarının bu politika konusunda bilgilendirilmesinden sorumludur.

## MADDE 12 — TESİS KURALLARININ UYGULANMASI

İşletmeler, hukuka uygun ve objektif tesis kuralları belirleyebilir.

Örneğin:

- Sigara kullanımı.
- Gürültü.
- Evcil hayvan kabulü.
- Giriş ve çıkış saatleri.
- Oda kapasitesi.
- Ortak alan kullanımı.
- Güvenlik ve yangın tedbirleri.

Ancak bu kurallar açıkça belirtilmeli, ilgili mevzuata uygun olmalı ve ayrımcı biçimde uygulanmamalıdır.

Tesis kuralları, misafirlerin medeni durumları nedeniyle dışlanmasını meşrulaştırmak amacıyla kullanılamaz.

## MADDE 13 — REZERVASYONUN REDDİ

İşletmeci, rezervasyonu yalnızca meşru, objektif ve hukuka uygun nedenlerle reddedebilir.

Örneğin:

- Gerçek müsaitlik bulunmaması.
- Zorunlu kimlik doğrulamasının yapılamaması.
- Yaş ve çocuk güvenliğiyle ilgili hukuki gereklilikler.
- Ciddi ve somut güvenlik riski.
- Mücbir sebep.
- Önceden bildirilmiş, objektif ve hukuka uygun kapasite veya rezervasyon koşullarının karşılanmaması.

Bu nedenler ayrımcı davranışları gizlemek için kullanılamaz.

İşletme rezervasyonu reddederse gerekçe sistem üzerinde kayıt altına alınmalıdır.

Trabzone, ret gerekçesini inceleme hakkını saklı tutar.

## MADDE 14 — MİSAFİR ŞİKÂYET HAKKI

Trabzone üzerinden rezervasyon yapan her kullanıcı, konaklama sırasında yaşadığı sorunları platforma bildirebilir.

Şikâyet nedenleri arasında:

- Evlilik cüzdanı talep edilmesi.
- Bekâr olduğu için reddedilme.
- Medeni durum nedeniyle ayrımcılık.
- Haksız ek ücret.
- Rezervasyonun keyfi iptali.
- Odaya kabul edilmeme.
- Personel tarafından hakaret.
- Güvenlik sorunu.
- Gizlilik ihlali.
- Yanıltıcı fiyat.
- Sunulmayan hizmet.
- Diğer konaklama sorunları.

bulunur.

Şikâyetler yetkili Trabzone personeli tarafından değerlendirilir.

Kullanıcının şikâyet oluşturması nedeniyle işletmeci misafire baskı uygulayamaz.

## MADDE 15 — ACİL DESTEK VE MİSAFİRİN KORUNMASI

Misafirin onaylanmış rezervasyonuna rağmen hukuka veya bu politikaya aykırı şekilde tesise kabul edilmediği iddia edildiğinde Trabzone destek sistemi üzerinden öncelikli inceleme başlatılabilir.

Trabzone, olayın niteliğine göre:

- İşletmeden açıklama isteyebilir.
- Rezervasyon kayıtlarını inceleyebilir.
- Kullanıcıyla iletişime geçebilir.
- Alternatif konaklama seçenekleri sunabilir.
- Rezervasyonun iptal ve iade koşullarını değerlendirebilir.
- İşletmeye yaptırım uygulayabilir.

Alternatif tesis sağlama veya fiyat farkını karşılama gibi mali yükümlülükler, ilgili sözleşme ve koşullarda açıkça taahhüt edildiği ölçüde geçerlidir.

Bu politika tek başına sınırsız ödeme veya konaklama garantisi oluşturmaz.

## MADDE 16 — İŞLETMECİ YAPTIRIMLARI

Trabzone, bu politikayı ihlal eden işletmelere ihlalin ağırlığına göre aşağıdaki yaptırımları uygulayabilir:

- Yazılı uyarı.
- İhlalin düzeltilmesini isteme.
- İşletme profilini geçici incelemeye alma.
- Yeni rezervasyon kabulünü geçici durdurma.
- Kampanyaları askıya alma.
- İşletmenin görünürlüğünü kısıtlama.
- Tesisin platformdaki faaliyetini askıya alma.
- İşletmeyle yapılan sözleşmeyi haklı nedenle sona erdirme.
- Gerekli durumlarda yetkili mercilere hukuka uygun bildirimde bulunma.

Ağır güvenlik ihlallerinde veya ciddi ayrımcılık iddialarında acil koruma tedbirleri uygulanabilir.

İşletmeciye, hukuki ve sözleşmesel koşullara uygun biçimde açıklama ve itiraz imkânı tanınır.

## MADDE 17 — TEKRARLANAN İHLALLER

Aynı işletmenin sürekli olarak misafirleri medeni durumları nedeniyle reddetmesi, evlilik belgesi talep etmesi veya rezervasyonlara keyfi engeller çıkarması ağır politika ihlali olarak değerlendirilir.

Tekrarlanan ihlallerde Trabzone, işletmenin platformdaki rezervasyon faaliyetlerini durdurabilir veya sözleşmesini sona erdirebilir.

İşletmenin geçmiş rezervasyon kayıtları ve finansal yükümlülükleri ilgili saklama ve sözleşme hükümleri çerçevesinde korunur.

## MADDE 18 — MİSAFİRİN SORUMLULUKLARI

Misafirler de konaklama sırasında hukuka ve tesisin geçerli kurallarına uygun hareket etmekle yükümlüdür.

Misafir:

- Doğru rezervasyon bilgisi vermelidir.
- Gerekli yasal kimlik doğrulamasını tamamlamalıdır.
- Oda kapasitesine uymalıdır.
- Diğer misafirlere ve personele saygılı davranmalıdır.
- Tesisin güvenlik kurallarını ihlal etmemelidir.
- Hukuka aykırı faaliyette bulunmamalıdır.
- Rezervasyonun geçerli ödeme koşullarını yerine getirmelidir.

Bu sorumluluklar, işletmeye ayrımcılık yapma veya misafirin özel hayatını gereksiz sorgulama yetkisi vermez.

## MADDE 19 — KİŞİSEL VERİLERİN KORUNMASI

Konaklama sırasında elde edilen kişisel veriler, KVKK ve ilgili mevzuata uygun işlenmelidir.

İşletmeciler, misafir verilerini yalnızca hukuka uygun amaçlarla kullanabilir.

Misafirin medeni durumuna ilişkin gereksiz bilgiler toplanamaz.

Misafirlerin rezervasyon, iletişim ve kimlik bilgileri yetkisiz personel tarafından görüntülenemez.

Trabzone ve tesis işletmecisinin veri sorumluluğu ve veri işleyen rolleri, somut veri işleme faaliyetlerine göre belirlenir.

## MADDE 20 — POLİTİKANIN BAĞLAYICILIĞI

Bu politika, Trabzone Konaklama İşletmeci Sözleşmesi'nin ayrılmaz bir parçası olarak uygulanır.

Platforma katılan işletmeciler, bu politikayı kabul ederek belirtilen yükümlülüklere uymayı taahhüt eder.

Politika hükümleri; misafirlerin yürürlükteki mevzuattan doğan haklarını sınırlandıracak biçimde yorumlanamaz.

Bu politikanın herhangi bir hükmünün emredici mevzuatla çelişmesi hâlinde ilgili mevzuat uygulanır.

## MADDE 21 — GÜNCELLEMELER

Trabzone, mevzuat değişiklikleri, kullanıcı güvenliği ihtiyaçları ve platform faaliyetleri doğrultusunda politikayı güncelleyebilir.

Esaslı değişiklikler işletmecilere bildirilir.

Yeniden kabul gerektiren değişikliklerde işletmeciden güncel politika sürümünü kabul etmesi istenir.

Önceki kabul kayıtları ve politika sürümleri sistemde saklanır.

## MADDE 22 — İŞLETMECİNİN AÇIK TAAHHÜDÜ

Trabzone Konaklama'ya katılan işletmeci;

**Misafirlerin medeni durumları nedeniyle ayrımcılığa uğramayacağını, yetişkin misafirlerden evlilik cüzdanı talep edilmeyeceğini, bekâr veya evli olmayan kişilerin yalnızca bu gerekçelerle konaklamasının engellenmeyeceğini, geçerli rezervasyonların hukuka uygun şekilde yerine getirileceğini ve bütün misafirlere saygılı davranılacağını kabul ve taahhüt eder.**

İşletmeci, bu yükümlülüklerin çalışanları tarafından da uygulanmasını sağlamakla sorumludur.

## ZORUNLU İŞLETMECİ KABUL BEYANI

- Trabzone Misafir Hakları, Eşit Konaklama ve İşletmeci Yükümlülükleri Politikası'nı okudum ve kabul ediyorum.
- Yetişkin misafirlerden evlilik cüzdanı talep etmeyeceğimi; bekâr olmaları veya aralarında evlilik bağı bulunmaması nedeniyle rezervasyonlarını reddetmeyeceğimi kabul ediyorum.
- Yasal kimlik bildirimi ve güvenlik yükümlülüklerine uyarak bütün misafirlere eşit, saygılı ve ayrımcılıktan uzak hizmet sunacağımı taahhüt ediyorum.

**Bu zorunlu sözleşme kabulleri tamamlanmadan tesis başvurusu gönderilemez.**$policy$,
  true,
  false,
  false,
  'İlk yayın: misafir hakları, eşit konaklama ve işletmeci kabul beyanı.',
  now(),
  now()
where not exists (
  select 1 from public.safety_policy_versions v
  where v.slug = 'accommodation-guest-rights'
    and v.locale = 'tr'
    and v.version = 1
);

-- ---------------------------------------------------------------------
-- 2. Tesis bazlı işletmeci kabul kayıtları
-- ---------------------------------------------------------------------
create table if not exists public.acc_policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.acc_properties (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  policy_slug text not null,
  policy_version integer not null,
  content_hash text,
  accepted_terms boolean not null default false,
  accepted_no_marriage_certificate boolean not null default false,
  accepted_equal_service boolean not null default false,
  source text not null default 'mobile_application',
  user_agent text,
  accepted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acc_policy_acceptances_flags_check check (
    accepted_terms
    and accepted_no_marriage_certificate
    and accepted_equal_service
  ),
  constraint acc_policy_acceptances_slug_format check (policy_slug ~ '^[a-z0-9-]{3,64}$'),
  unique (property_id, policy_slug, policy_version)
);

create index if not exists acc_policy_acceptances_property_idx
  on public.acc_policy_acceptances (property_id, policy_slug, policy_version desc);

alter table public.acc_policy_acceptances enable row level security;
drop policy if exists acc_policy_acceptances_read on public.acc_policy_acceptances;
create policy acc_policy_acceptances_read on public.acc_policy_acceptances
  for select to authenticated
  using (public.acc_can(property_id, 'read'));

grant select on public.acc_policy_acceptances to authenticated;

-- ---------------------------------------------------------------------
-- 3. Yürürlükteki politika ve kabul durumu
-- ---------------------------------------------------------------------
create or replace function public.acc_policy_consent(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'read');
  v_doc public.safety_policy_versions%rowtype;
  v_acc public.acc_policy_acceptances%rowtype;
begin
  select * into v_doc
  from public.safety_policy_versions
  where slug = 'accommodation-guest-rights'
    and locale = 'tr'
    and is_published
    and archived_at is null
  order by version desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'available', false,
      'slug', 'accommodation-guest-rights',
      'version', 0,
      'title', null,
      'accepted', false,
      'accepted_at', null,
      'accepted_by', null,
      'items', jsonb_build_object(
        'terms', false,
        'no_marriage_certificate', false,
        'equal_service', false
      )
    );
  end if;

  select * into v_acc
  from public.acc_policy_acceptances a
  where a.property_id = p_property_id
    and a.policy_slug = v_doc.slug
    and a.policy_version = v_doc.version
  order by a.accepted_at desc
  limit 1;

  return jsonb_build_object(
    'available', true,
    'slug', v_doc.slug,
    'version', v_doc.version,
    'title', v_doc.title,
    'summary', v_doc.summary,
    'content_hash', v_doc.content_hash,
    'effective_at', v_doc.effective_at,
    'accepted', v_acc.id is not null,
    'accepted_at', v_acc.accepted_at,
    'accepted_by', v_acc.user_id,
    'items', jsonb_build_object(
      'terms', coalesce(v_acc.accepted_terms, false),
      'no_marriage_certificate', coalesce(v_acc.accepted_no_marriage_certificate, false),
      'equal_service', coalesce(v_acc.accepted_equal_service, false)
    )
  );
end;
$$;

revoke all on function public.acc_policy_consent(uuid) from public, anon;
grant execute on function public.acc_policy_consent(uuid) to authenticated, service_role;

comment on function public.acc_policy_consent(uuid) is
  'Tesisin yürürlükteki Trabzone Misafir Hakları Politikası sürümünü kabul edip etmediğini döndürür.';

-- ---------------------------------------------------------------------
-- 4. Zorunlu kabul beyanının kaydı
-- ---------------------------------------------------------------------
create or replace function public.acc_policy_accept(
  p_property_id uuid,
  p_flags jsonb default '{}'::jsonb,
  p_user_agent text default null,
  p_source text default 'mobile_application'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.acc_require(p_property_id, 'property');
  v_doc public.safety_policy_versions%rowtype;
  v_terms boolean := coalesce((p_flags ->> 'terms')::boolean, false);
  v_no_marriage boolean := coalesce((p_flags ->> 'no_marriage_certificate')::boolean, false);
  v_equal boolean := coalesce((p_flags ->> 'equal_service')::boolean, false);
  v_source text := coalesce(nullif(btrim(p_source), ''), 'mobile_application');
begin
  if v_source not in ('mobile_application', 'web_application') then
    raise exception 'invalid_source' using errcode = '22023';
  end if;

  select * into v_doc
  from public.safety_policy_versions
  where slug = 'accommodation-guest-rights'
    and locale = 'tr'
    and is_published
    and archived_at is null
  order by version desc
  limit 1;

  if not found then
    raise exception 'policy_not_published' using errcode = 'P0002';
  end if;

  if not (v_terms and v_no_marriage and v_equal) then
    raise exception 'policy_acceptance_incomplete' using errcode = '22023';
  end if;

  insert into public.acc_policy_acceptances (
    property_id, user_id, policy_slug, policy_version, content_hash,
    accepted_terms, accepted_no_marriage_certificate, accepted_equal_service,
    source, user_agent
  )
  values (
    p_property_id, v_uid, v_doc.slug, v_doc.version, v_doc.content_hash,
    true, true, true,
    v_source, left(p_user_agent, 400)
  )
  on conflict (property_id, policy_slug, policy_version) do update
    set user_id = excluded.user_id,
        content_hash = excluded.content_hash,
        accepted_terms = true,
        accepted_no_marriage_certificate = true,
        accepted_equal_service = true,
        source = excluded.source,
        user_agent = excluded.user_agent,
        accepted_at = now(),
        updated_at = now();

  return jsonb_build_object(
    'property_id', p_property_id,
    'slug', v_doc.slug,
    'version', v_doc.version,
    'content_hash', v_doc.content_hash,
    'accepted', true,
    'accepted_at', now()
  );
end;
$$;

revoke all on function public.acc_policy_accept(uuid, jsonb, text, text) from public, anon;
grant execute on function public.acc_policy_accept(uuid, jsonb, text, text) to authenticated, service_role;

comment on function public.acc_policy_accept(uuid, jsonb, text, text) is
  'İşletmecinin üç zorunlu kabul beyanını tesis için kaydeder. Üçü de true olmadan kayıt oluşmaz.';

-- ---------------------------------------------------------------------
-- 5. Eksik bilgi kontrolüne politika kabulünü ekle
--    (doğrulamaya gönderme, eksik varsa zaten engellenir)
-- ---------------------------------------------------------------------
create or replace function public.acc_property_missing(p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.acc_properties%rowtype;
  v_missing text[] := '{}'::text[];
  v_room_types int;
  v_rooms int;
  v_plans int;
  v_policy_version int;
begin
  select * into p from public.acc_properties where id = p_property_id;
  if not found then
    raise exception 'property_not_found' using errcode = 'P0002';
  end if;

  if length(btrim(coalesce(p.name, ''))) < 3 then
    v_missing := array_append(v_missing, 'Tesis adı en az 3 karakter olmalı');
  end if;
  if length(btrim(coalesce(p.description, ''))) < 40 then
    v_missing := array_append(v_missing, 'Tesis açıklaması en az 40 karakter olmalı');
  end if;
  if p.district_id is null and nullif(btrim(coalesce(p.district, '')), '') is null then
    v_missing := array_append(v_missing, 'İlçe seçilmeli');
  end if;
  if nullif(btrim(coalesce(p.address, '')), '') is null then
    v_missing := array_append(v_missing, 'Açık adres girilmeli');
  end if;
  if p.lat is null or p.lng is null then
    v_missing := array_append(v_missing, 'Harita konumu seçilmeli');
  end if;
  if nullif(btrim(coalesce(p.phone, '')), '') is null then
    v_missing := array_append(v_missing, 'Tesis telefonu girilmeli');
  end if;
  if nullif(btrim(coalesce(p.email, '')), '') is null then
    v_missing := array_append(v_missing, 'Tesis e-postası girilmeli');
  end if;
  if nullif(btrim(coalesce(p.contact_name, '')), '') is null then
    v_missing := array_append(v_missing, 'Yetkili adı girilmeli');
  end if;
  if p.tax_number is null and p.documents_required then
    v_missing := array_append(v_missing, 'Vergi numarası ve fatura bilgileri girilmeli');
  end if;
  if (p.policies ? 'cancellation') is false then
    v_missing := array_append(v_missing, 'İptal politikası tanımlanmalı');
  end if;

  select count(*) into v_room_types from public.acc_room_types
   where property_id = p_property_id and active;
  select count(*) into v_rooms from public.acc_rooms
   where property_id = p_property_id and active;
  select count(*) into v_plans from public.acc_rate_plans
   where property_id = p_property_id and active;

  if v_room_types = 0 then
    v_missing := array_append(v_missing, 'En az bir oda tipi eklenmeli');
  end if;
  if v_rooms = 0 then
    v_missing := array_append(v_missing, 'En az bir fiziksel oda eklenmeli');
  end if;
  if v_plans = 0 then
    v_missing := array_append(v_missing, 'En az bir fiyat planı eklenmeli');
  end if;
  if p.documents_required and not exists (
    select 1 from public.acc_property_documents d
    where d.property_id = p_property_id and d.status in ('pending', 'approved')
  ) then
    v_missing := array_append(v_missing, 'İşletme belgesi yüklenmeli');
  end if;
  if not exists (
    select 1 from public.acc_property_media m
    where m.property_id = p_property_id and m.kind = 'image' and m.status = 'approved'
  ) then
    v_missing := array_append(v_missing, 'En az bir tesis fotoğrafı eklenmeli');
  end if;

  -- Zorunlu işletmeci kabul beyanı: yayındaki politika sürümü için kayıt yoksa
  -- başvuru doğrulamaya gönderilemez. Yayında olan tesislerden yeniden onay
  -- istenmez; kontrol yalnızca başvuru aşamasındaki tesisler için çalışır.
  if p.status in ('draft', 'rejected') then
    select v.version into v_policy_version
    from public.safety_policy_versions v
    where v.slug = 'accommodation-guest-rights'
      and v.locale = 'tr'
      and v.is_published
      and v.archived_at is null
    order by v.version desc
    limit 1;

    if v_policy_version is not null and not exists (
      select 1 from public.acc_policy_acceptances a
      where a.property_id = p_property_id
        and a.policy_slug = 'accommodation-guest-rights'
        and a.policy_version = v_policy_version
    ) then
      v_missing := array_append(v_missing, 'Misafir hakları politikası onayı tamamlanmalı');
    end if;
  end if;

  return to_jsonb(v_missing);
end;
$$;

grant execute on function public.acc_property_missing(uuid) to authenticated, service_role;

comment on function public.acc_property_missing(uuid) is
  'Tesisin doğrulama için eksik alanlarını döndürür; zorunlu misafir hakları politikası kabulünü de kapsar.';
