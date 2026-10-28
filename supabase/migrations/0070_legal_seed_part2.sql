-- =============================================================================
-- 0070 (devam): Çocuk Koruma, Veri Koruma ve KVKK Aydınlatma metinleri
-- =============================================================================

set search_path = public, extensions;

insert into public.safety_policy_versions
  (slug, version, locale, doc_type, title, summary, body_md, is_published,
   requires_acceptance, requires_reacceptance, change_summary, effective_at, published_at)
values
(
  'child-safety', 2, 'tr', 'policy',
  'Trabzone Çocuk Koruma ve Güvenliği Politikası',
  'Trabzone''un çocuk istismarı ve sömürüsüne karşı sıfır tolerans yaklaşımı, yaş güvenliği, bildirim ve müdahale süreçleri.',
  $doc$
# Trabzone Çocuk Koruma ve Güvenliği Politikası

**Sürüm:** 2.0 · **Yürürlük:** 28 Ekim 2026

Trabzone; sosyal içerik, mesajlaşma, kısa video, kullanıcı profilleri ve Marketplace özellikleri sunan bir platformdur. Çocukların korunması, platformun en yüksek öncelikli güvenlik konusudur.

## 1. Yaklaşımımız

- Çocukların cinsel istismarı ve sömürüsüne (CSAE), çocuk cinsel istismarı materyaline (CSAM) ve çocuklara yönelik her türlü zarara **sıfır tolerans** uygularız.
- Çocuk güvenliği bildirimleri normal destek kuyruğunda değil, ayrı ve öncelikli bir güvenlik iş akışında incelenir.
- Platform, yürürlükteki mevzuata ve uygulama mağazası çocuk güvenliği standartlarına uygun hareket eder.
- Çocuk güvenliği konusunda atanmış bir iletişim sorumlusu bulunur; bu sorumluya destek merkezi üzerinden ulaşılabilir.

## 2. Kesin yasaklar

Aşağıdaki içerik ve davranışlar kesinlikle yasaktır ve tespit edildiğinde derhal kaldırılır:

- Çocukların cinsel istismarı veya sömürüsü.
- CSAM üretimi, paylaşımı, depolanması, talep edilmesi veya erişime sunulması.
- Çocuklarla cinsel içerikli iletişim kurma, cinsel içerik talep etme veya çocukları buna yönlendirme.
- Grooming (çocuğu güven kazanarak cinsel veya zararlı bir ilişkiye yönlendirme).
- Çocuklara yönelik tehdit, şantaj, zorbalık ve sindirme.
- Çocuk ticareti, çocuk emeği sömürüsü ve çocukların zararına hizmet sunma.
- Çocukları istismara, şiddete veya zararlı davranışlara yönlendiren içerikler.
- Çocukların görüntülerini rızaları dışında veya uygunsuz bağlamda yayınlama.

Bu yasaklar; gönderi, hikâye, Reels, yorum, mesaj, profil, işletme içeriği ve Marketplace ilanlarının tamamı için geçerlidir.

## 3. Yaş güvenliği

- Platformu kullanma yaşı en az **13**'tür. 13 yaşından küçük kişiler hesap oluşturamaz.
- Kayıt sırasında doğum tarihi/yaş uygunluğu beyanı alınır. Şüpheli hesaplar ek doğrulamaya tabi tutulabilir.
- 18 yaşından küçük kullanıcılar için daha kapalı gizlilik varsayılanları uygulanır; mesajlaşma, arama, yorum ve konum paylaşımı yaş grubuna göre sınırlandırılabilir.
- Yaşın yanlış beyan edilmesi, hesabın kısıtlanması veya kapatılması sonucunu doğurabilir.
- Uygunsuz bir hesap tespit edildiğinde hesap askıya alınır, gerekli hallerde kapatılır ve yetkili mercilere hukuka uygun bildirim yapılır.

## 4. Mesajlaşma güvenliği

- Kullanıcılar istemedikleri kişileri engelleyebilir ve mesajlarını kısıtlayabilir.
- Taciz, tehdit veya uygunsuz mesajlar sohbet içindeki şikâyet aracıyla bildirilebilir.
- 18 yaşından küçük kullanıcıların tanımadığı yetişkinlerden gelen mesajlara ilişkin ek koruma uygulanabilir.
- Şüpheli davranış bildirimleri, mesaj içeriğiyle birlikte güvenlik ekibine iletilir; yalnızca yetkili personel inceleyebilir.
- Kullanıcılar, çocuklardan cinsel içerik veya kişisel bilgi talep eden hesapları derhal bildirmelidir.

## 5. Görsel ve video güvenliği

- Uygunsuz görsel ve videolar, otomatik kontroller ve kullanıcı bildirimleriyle tespit edilmeye çalışılır.
- CSAM şüphesi taşıyan medya derhal erişimden kaldırılır; içerik korunur ve yetkili mercilere iletilmek üzere hukuka uygun şekilde muhafaza edilir.
- Çocukların yer aldığı uygunsuz veya izinsiz görüntüler hızla kaldırılır.
- Canlı yayın veya benzeri gerçek zamanlı özellikler etkinleştirilirse çocuk güvenliği için ek önlemler uygulanır.

## 6. Marketplace ve ilan güvenliği

- Çocuk istismarını kolaylaştıran veya çocuklara yönelik hukuka aykırı hizmet sunan ilanlar yasaktır.
- Çocuklara ait ürünlerin satışında güvenlik ve mevzuat kuralları uygulanır; şüpheli ilanlar incelenir.
- Şüpheli ilanlar kaldırılır, ilgili hesaplara yaptırım uygulanır ve gerekli hallerde yetkili mercilere bildirim yapılır.
- Kullanıcılar şüpheli ilanları ilan üzerindeki şikâyet aracıyla bildirebilir.

## 7. Şikâyet ve bildirim kanalları

Her kullanıcı aşağıdaki unsurları uygun raporlama araçlarıyla bildirebilir:

- Profil
- Gönderi
- Reels videosu
- Yorum
- Mesaj
- İşletme içeriği
- Marketplace ilanı

Bildirimlerde mümkünse içerik bağlantısı, ekran görüntüsü ve olay açıklaması paylaşılmalıdır. Bildirimler gizlilik içinde incelenir; bildirimde bulunanın kimliği, hukuki bir zorunluluk olmadıkça açıklanmaz.

## 8. Acil bildirim süreci

- Çocuk güvenliği ihbarları yüksek öncelikle ele alınır.
- Hayati tehlike veya devam eden istismar şüphesinde içerik derhal kaldırılır ve delil koruma süreci başlatılır.
- Türkiye'de yetkili merciler ve ilgili kurumlarla (kolluk, savcılık, Aile ve Sosyal Hizmetler Bakanlığı'nın ilgili birimleri ve gerektiğinde uluslararası çocuk güvenliği kuruluşları) hukuka uygun bildirim yapılır.
- Acil durumlarda kullanıcıların doğrudan 112 veya kolluk birimlerine başvurması gerekir. Platformun bildirim süreci acil müdahale yerine geçmez.

## 9. İçerik kaldırma ve delil koruma

- Yasa dışı çocuk istismarı içerikleri erişimden kaldırılır.
- İçerik, yetkili mercilerin incelemesi için hukuka uygun şekilde sınırlı erişimle muhafaza edilebilir.
- Delillerin bütünlüğünü korumak için erişim yalnızca yetkili güvenlik personeliyle sınırlandırılır ve tüm işlemler denetim kaydına yazılır.
- İçerik kaldırma işlemi, kullanıcıya uygulanan yaptırımdan bağımsız olarak yürütülür.

## 10. Hesap yaptırımları

İhlalin ağırlığına ve hukuki gerekliliklere göre:

- Uyarı
- İçeriğin kaldırılması
- Geçici kısıtlama
- Hesabın askıya alınması
- Kalıcı kapatma
- Yetkili mercilere bildirim

uygulanabilir. Çocuk güvenliği ihlallerinde en ağır yaptırım öncelikli olarak değerlendirilir.

## 11. Çocuk güvenliği iletişim kanalı

Çocuk güvenliği bildirimleri için ayrı ve izlenen bir kanal bulunur. Bildirimlerinizi:

- Destek Merkezi > Çocuk Güvenliği kategorisi,
- Uygulama içi şikâyet araçları,
- Güvenlik ekibi e-posta kanalı

üzerinden iletebilirsiniz. Kanal bilgileri İletişim sayfasında güncel olarak yayımlanır.

## 12. Şeffaflık ve sorumluluk

- Çocuk güvenliği süreçleri düzenli olarak gözden geçirilir.
- Yetkili personel, çocuk güvenliği ve veri gizliliği konusunda eğitim alır.
- Kullanıcılar, hangi durumlarda nasıl başvuru yapacaklarını bu politika ve Destek Merkezi üzerinden öğrenebilir.
- Bu politika, uygulama mağazalarının çocuk güvenliği standartlarıyla uyumlu şekilde uygulanır; yalnızca yayımlanmış bir metin olarak bırakılmaz.
$doc$,
  true, false, false, 'Çocuk Koruma Politikası kapsamlı olarak yenilendi.',
  '2026-10-28 00:00:00+00', now()
),
(
  'data-protection', 1, 'tr', 'policy',
  'Trabzone Veri Koruma Politikası',
  'Trabzone''un teknik ve idari veri güvenliği tedbirleri, erişim kontrolü, veri yaşam döngüsü, saklama-imha ve güvenlik olayı yönetimi.',
  $doc$
# Trabzone Veri Koruma Politikası

**Sürüm:** 1.0 · **Yürürlük:** 28 Ekim 2026

Bu politika, Trabzone'un kişisel verileri korumak için uyguladığı teknik ve idari tedbirleri açıklar. Gizlilik Politikası hangi verilerin işlendiğini ve amaçlarını; bu politika ise verilerin nasıl korunduğunu ele alır.

## 1. Kapsam ve sorumluluk

- Politika; Trabzone'un sahip olduğu veya işlediği tüm kişisel verileri, destek kayıtlarını, medya dosyalarını ve sistem günlüklerini kapsar.
- Veri korumadan sorumlu kişi ve yedekleri belirlenmiştir. Veri koruma başvuruları ayrı bir kanal üzerinden yönetilir.
- Tüm çalışanlar ve yetkili personel gizlilik yükümlülüğü altındadır.

## 2. Teknik ve idari güvenlik tedbirleri

- Tüm istemci-sunucu iletişimi TLS ile şifrelenir.
- Kimlik doğrulama Supabase Auth üzerinden yürütülür; şifreler güvenli karma algoritmalarıyla saklanır.
- Veritabanı erişimi satır düzeyi güvenlik (RLS) politikalarıyla kullanıcı ve rol bazında sınırlandırılır.
- Hassas işlemler yalnızca sunucu tarafında çalışan güvenlik tanımlı fonksiyonlarla yapılır; istemci tarafı yetki kontrolüne güvenilmez.
- Yönetici işlemleri denetim kaydına yazılır; kritik işlemlerde ikinci doğrulama uygulanabilir.
- Dosya yüklemelerinde tür, boyut ve sahiplik doğrulanır; medya erişimi imzalı bağlantılarla sınırlandırılır.
- Hata mesajları, kullanıcıya gereksiz sistem bilgisi sızdırmayacak şekilde üretilir.
- Geliştirme, test ve üretim ortamları birbirinden ayrılır; üretim anahtarları istemciye gönderilmez.
- Bağımlılıklar ve altyapı düzenli olarak güncellenir; güvenlik açıkları izlenir.
- Kayıtlar ve yedekler erişim kontrollü ortamlarda tutulur; yedeklerin bütünlüğü test edilir.

## 3. Erişim kontrolü

- **Kullanıcılar:** yalnızca kendi verilerine ve kendilerine açık içeriklere erişir.
- **Destek personeli:** yalnızca yetkilendirildiği destek taleplerine ve sohbetlere erişir; her erişim kayıt altına alınır.
- **Moderatörler:** içerik inceleme yetkisiyle sınırlıdır; kullanıcı şifrelerine erişemez.
- **Yöneticiler:** rol bazlı yetkilere sahiptir; kritik yetkiler ayrı ayrı atanır (hukuk, veri talepleri, destek, içerik).
- **Altyapı sağlayıcıları:** yalnızca hizmetin gerektirdiği ölçüde, sözleşmesel gizlilik yükümlülükleri altında erişir.
- Yetki verilmesi ve kaldırılması kayıt altına alınır; kullanılmayan hesaplar kapatılır.

## 4. Veri yaşam döngüsü

1. **Toplama:** yalnızca belirli, meşru ve gerekli veriler toplanır.
2. **İşleme:** amaçla sınırlı, ölçülü ve doğru veri ilkesine uyulur.
3. **Saklama:** veri türüne göre saklama süresi belirlenir.
4. **Güncelleme:** kullanıcıların düzeltme talepleri işlenir.
5. **Arşivleme:** yalnızca hukuki veya güvenlik gerekliliği olan kayıtlar sınırlı erişimle arşivlenir.
6. **Silme:** süre sonunda veya talep üzerine silinir.
7. **Anonimleştirme:** silme yerine anonimleştirme uygulanan hallerde geri döndürülemez hale getirilir.

## 5. Saklama ve imha

- Hesap ve profil verileri hesap açık olduğu sürece tutulur.
- Medya dosyaları, içerik silindiğinde hizmetten kaldırılır ve makul süre içinde depolamadan silinir.
- Destek ve şikâyet kayıtları, çözümden sonra güvenlik ve uyuşmazlık için gerekli süreyle tutulur.
- Denetim kayıtları erişim kontrolü altında saklanır ve süresi dolduğunda imha edilir.
- Yasal saklama yükümlülüğü bulunan kayıtlar ilgili süre boyunca tutulur; bu kayıtlar pazarlama veya profilleme amacıyla kullanılmaz.
- İmha yöntemleri: kalıcı silme, üzerine yazma, anonimleştirme ve güvenli ortamdan kaldırma.

## 6. Veri işleyenler

Trabzone; veritabanı ve kimlik doğrulama (Supabase), medya dağıtımı (Cloudflare R2), sesli/görüntülü arama (LiveKit), harita (Mapbox), bildirim (Expo) ve barındırma hizmetlerinden yararlanır. Veri işleyenlerle gizlilik ve veri koruma yükümlülükleri düzenlenir; veriler yalnızca hizmet kapsamında işlenir.

## 7. Güvenlik olayları

- Olay tespit edildiğinde etki alanı sınırlandırılır ve erişim gerekli hallerde kesilir.
- Olayın kapsamı, etkilenen veri türleri ve kişi sayısı değerlendirilir.
- KVKK ve ilgili mevzuatın gerektirdiği bildirimler, öngörülen süreler içinde yapılır.
- Etkilenen kullanıcılara, mevzuatın gerektirdiği hallerde açık ve anlaşılır bildirim yapılır.
- Kök neden analizi yapılır, düzeltici ve önleyici tedbirler uygulanır ve olay kaydı tutulur.
- Olay kayıtları, tekrarını önlemek için erişim kontrollü şekilde saklanır.

## 8. Kullanıcı hakları

Kullanıcılar; verilerine erişme, düzeltme, silme, işlemeye itiraz etme, rızalarını geri alma ve mevzuatın tanıdığı diğer hakları kullanma hakkına sahiptir. Talepler Veri Talepleri sayfasından veya KVKK Aydınlatma Metni'nde belirtilen kanaldan iletilir. Kimlik doğrulaması yapılmadan başkasının hesabına ilişkin talepler işleme alınmaz.

## 9. Uluslararası aktarım

Yurt dışında veri merkezi bulunan hizmet sağlayıcılar kullanıldığında aktarım, KVKK'nın yurt dışına aktarım hükümlerine uygun güvenceler sağlanarak yapılır. Aktarımın hukuki dayanağı ve güvenceler, kullanılan hizmete göre belgelenir.

## 10. İletişim

Veri koruma soruları ve başvuruları için Destek Merkezi > Gizlilik kategorisini veya support@litxtech.com adresini kullanabilirsiniz.
$doc$,
  true, false, false, 'Veri Koruma Politikası ilk kez yayımlandı.',
  '2026-10-28 00:00:00+00', now()
),
(
  'kvkk', 1, 'tr', 'disclosure',
  'Trabzone KVKK Aydınlatma Metni',
  '6698 sayılı KVKK kapsamında veri sorumlusu, işleme amaçları, veri kategorileri, hukuki sebepler, aktarım ve ilgili kişi haklarına ilişkin aydınlatma.',
  $doc$
# Trabzone KVKK Aydınlatma Metni

**Sürüm:** 1.0 · **Yürürlük:** 28 Ekim 2026

Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında **aydınlatma** amacıyla hazırlanmıştır. Bir sözleşme kabulü veya açık rıza metni değildir. Açık rıza gerektiren işlemler için ayrı rıza beyanları kullanılır.

## 1. Veri sorumlusunun kimliği

Veri sorumlusu Trabzone'dur. İşletmeci unvanı, tebligat adresi ve ticari kayıt bilgileri, Platformun İletişim sayfasında ve yasal bildirimlerde yayımlanır. Veri koruma başvuruları için ayrı iletişim kanalı aşağıda belirtilmiştir.

## 2. İşlenen kişisel veri kategorileri

- **Kimlik ve iletişim:** ad, soyad, kullanıcı adı, e-posta adresi.
- **Hesap güvenliği:** şifre özeti, oturum bilgileri, doğrulama durumu, güvenlik günlükleri.
- **Profil:** profil fotoğrafı, kapak fotoğrafı, biyografi, şehir, ilgi alanları.
- **İçerik:** gönderiler, yorumlar, beğeniler, hikâyeler, Reels videoları, mesajlar ve ekler.
- **İşlem güvenliği:** IP kaynaklı güvenlik kayıtları, cihaz/uygulama bilgisi, hata kayıtları.
- **Müşteri işlem:** Marketplace ilanları, sipariş talepleri, favoriler, işletme yorumları, destek talepleri.
- **Konum:** yalnızca izin verildiğinde konum bilgisi.
- **Görsel/işitsel kayıt:** kullanıcının yüklediği fotoğraf, video ve ses içerikleri.
- **Talep ve şikâyet:** destek, şikâyet, itiraz ve veri talebi kayıtları.

Özel nitelikli kişisel veriler (sağlık, din, etnik köken, biyometrik veri vb.) hedeflenerek toplanmaz. Kullanıcıların bu tür verileri paylaşmaması önerilir.

## 3. Kişisel verilerin işlenme amaçları

- Üyelik ve hesap yönetimi, kimlik doğrulama, oturum güvenliği.
- Sosyal akış, mesajlaşma, arama, harita, işletme ve Marketplace hizmetlerinin sunulması.
- İçerik moderasyonu, güvenlik, şikâyet ve çocuk güvenliği süreçleri.
- Destek taleplerinin yanıtlanması ve kullanıcı memnuniyetinin ölçülmesi.
- Yasal yükümlülüklerin yerine getirilmesi, yetkili kurum taleplerinin yanıtlanması.
- Açık rıza varsa pazarlama iletişimi ve isteğe bağlı analitik faaliyetler.

## 4. Toplama yöntemleri

Veriler; kayıt ve profil formları, uygulama içi kullanım, cihaz izinleri, destek ve şikâyet formları, üçüncü taraf giriş hizmetleri (Apple/Google) ve altyapı sağlayıcılarının teknik kayıtları aracılığıyla elektronik ortamda toplanır.

## 5. Hukuki sebepler

Veriler; KVKK m.5/2 kapsamında sözleşmenin kurulması veya ifası, hukuki yükümlülük, bir hakkın tesisi/kullanılması/korunması ve meşru menfaat sebeplerine; açık rıza gerektiren işlemlerde ise ayrıca açık rızaya dayanılarak işlenir. Pazarlama iletileri için ayrı ve isteğe bağlı rıza alınır; rızanın reddedilmesi temel hizmetlerden yararlanmayı engellemez.

## 6. Alıcı grupları ve aktarım amaçları

- Altyapı ve barındırma sağlayıcıları (veritabanı, kimlik doğrulama, medya, arama, harita, bildirim).
- Yetkili kamu kurumları ve adli merciler, usulüne uygun talep halinde.
- Hukuki danışmanlar ve denetim hizmetleri, gerektiği ölçüde.
- Kullanıcının açıkça herkese görünür yaptığı içerikler bakımından diğer kullanıcılar.

Yurt dışında veri merkezi bulunan hizmet sağlayıcılar kullanıldığında aktarım, KVKK m.9 kapsamında uygun güvenceler sağlanarak yapılır.

## 7. İlgili kişi hakları

KVKK m.11 kapsamında:

- Kişisel verilerin işlenip işlenmediğini öğrenme.
- İşlenmişse buna ilişkin bilgi talep etme.
- İşleme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme.
- Yurt içinde/yurt dışında aktarıldığı üçüncü kişileri bilme.
- Eksik veya yanlış işlenmiş verilerin düzeltilmesini isteme.
- KVKK m.7 kapsamında silinmesini veya yok edilmesini isteme.
- Düzeltme/silme işlemlerinin aktarıldığı üçüncü kişilere bildirilmesini isteme.
- Münhasıran otomatik sistemlerle analiz sonucu aleyhinize çıkan sonuca itiraz etme.
- Kanuna aykırı işleme nedeniyle zarara uğramanız halinde zararın giderilmesini talep etme.

## 8. Başvuru yöntemi

Başvurularınızı:

- **Veri Talepleri** sayfasından (oturum açmış kullanıcılar için),
- **Destek Merkezi > Gizlilik** kategorisinden,
- Yazılı olarak veri sorumlusunun tebligat adresine

iletebilirsiniz. Başvuruda adınız, iletişim bilginiz ve talebiniz açıkça yer almalıdır. Kimliğinizi doğrulamak için makul ek bilgi istenebilir. Başvurular, mevzuatta öngörülen süre içinde yanıtlanır; sürenin kısalması için mümkün olan en kısa sürede işlem yapılır.

## 9. Güncellemeler

Bu metin güncellendiğinde sürüm numarası ve yürürlük tarihi yayımlanır; önceki sürümler arşivde korunur. Güncel metin her zaman bu sayfada yer alır.
$doc$,
  true, false, false, 'KVKK Aydınlatma Metni ilk kez yayımlandı.',
  '2026-10-28 00:00:00+00', now()
)
on conflict (slug, locale, version) do nothing;
