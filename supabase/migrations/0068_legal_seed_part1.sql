-- =============================================================================
-- 0070: Hukuki belge sürümleri (Türkçe)
-- =============================================================================
-- Yeni sürümler EKLENİR; önceki sürümler silinmez ve değiştirilmez.
-- Metinler Trabzone'un gerçek özelliklerini yansıtacak şekilde hazırlanmıştır.
-- Şirket unvanı, tebligat adresi ve ticari kayıt bilgileri yayın öncesinde
-- hukuk danışmanı tarafından doğrulanmalıdır (bkz. son rapor).
-- =============================================================================

set search_path = public, extensions;

insert into public.safety_policy_versions
  (slug, version, locale, doc_type, title, summary, body_md, is_published,
   requires_acceptance, requires_reacceptance, change_summary, effective_at, published_at)
values
(
  'terms', 2, 'tr', 'contract',
  'Trabzone Kullanım Koşulları',
  'Trabzone platformunun kullanımına ilişkin haklar, yükümlülükler, topluluk standartları, Marketplace ve emlak kuralları ile uyuşmazlık çözümü.',
  $doc$
# Trabzone Kullanım Koşulları

**Sürüm:** 2.0 · **Yürürlük:** 28 Ekim 2026

Bu Kullanım Koşulları ("Koşullar"), Trabzone mobil uygulamaları, web sitesi ve bunlara bağlı dijital hizmetlerin ("Platform") kullanımını düzenler. Platformu kullanmadan önce bu Koşulları okumanız gerekir. Hesap oluşturarak, oturum açarak veya Platformu kullanmaya devam ederek bu Koşulları kabul etmiş olursunuz.

## 1. Taraflar, tanımlar ve kapsam

- **Trabzone:** Platformun markası ve dijital hizmetlerinin bütünüdür.
- **Hizmet Sağlayıcı:** Platformu işleten ve bu Koşullar kapsamında hizmet sunan taraftır. İşletmeci unvanı, tebligat adresi ve ticari kayıt bilgileri Platformun iletişim sayfasında ve yasal bildirimlerde yayımlanır.
- **Kullanıcı:** Platforma kayıt olan veya Platformu kullanan gerçek kişidir.
- **İçerik:** Metin, fotoğraf, video, ses, yorum, mesaj, ilan, işletme bilgisi, konum ve benzeri her türlü veri ve paylaşımdır.

Koşullar; sosyal akış, hikâyeler, Reels, mesajlaşma, sesli/görüntülü arama (etkin olduğu ölçüde), Marketplace, emlak ve araç ilanları, harita, işletme keşfi ve destek hizmetlerini kapsar. Bir özellik henüz etkin değilse bu Koşullar o özelliğe ilişkin bir taahhüt doğurmaz.

## 2. Hesap oluşturma ve hesap güvenliği

- Hesap oluştururken doğru, güncel ve size ait bilgiler vermelisiniz. Başkasının kimlik bilgilerini kullanamazsınız.
- Bir hesap yalnızca bir kişiye aittir. Hesabınızı başkasına devredemez, satamaz veya kiralayamazsınız.
- Şifrenizin, doğrulama kodlarınızın ve oturum bilgilerinizin gizliliğinden siz sorumlusunuz. Yetkisiz erişim fark ettiğinizde şifrenizi değiştirmeli ve destek ekibine bildirmelisiniz.
- Hesap kurtarma süreçlerinde kimliğinizi doğrulamak için makul ek kontroller uygulanabilir. Doğrulama tamamlanmadan hesap üzerinde değişiklik yapılmaz.
- Hesabınızı dilediğiniz zaman kapatabilir veya silebilirsiniz. Hesap silme, hesap dondurma ile aynı şey değildir; ayrıntılar Hesap ve Veri Silme Politikasında açıklanır.

## 3. Yaş ve uygunluk

- Platformu kullanmak için **en az 13 yaşında** olmanız gerekir. 13 yaşından küçük kişiler hesap oluşturamaz.
- 18 yaşından küçük kullanıcılar için daha kapalı gizlilik varsayılanları uygulanır. Mesajlaşma, arama, yorum ve konum paylaşımı gibi özellikler yaş grubuna göre sınırlandırılabilir.
- Yaşınızı yanlış beyan etmeniz halinde hesabınız kısıtlanabilir veya kapatılabilir. Gerekli hallerde veli onayı istenebilir.
- Platform, yürürlükteki mevzuata ve uygulama mağazası kurallarına uygun olarak yaş doğrulama ve çocuk güvenliği tedbirleri uygular.

## 4. Hizmetin kapsamı ve kullanım koşulları

- Platform; kullanıcıların profil oluşturmasına, içerik paylaşmasına, birbirini takip etmesine, mesajlaşmasına, keşfetmesine, harita ve işletmeleri görüntülemesine, ilan vermesine ve destek almasına imkân tanır.
- Bazı özellikler cihaz, ülke, yaş grubu, hesap durumu veya teknik yapılandırma nedeniyle kullanılamayabilir. Bir özelliğin sunulması, her zaman ve her cihazda sunulacağı anlamına gelmez.
- Platformu yalnızca hukuka uygun amaçlarla ve bu Koşullara uygun olarak kullanmalısınız.
- Platformun teknik altyapısını aşırı yükleyen, otomatik veri çeken, güvenlik önlemlerini aşmaya çalışan veya diğer kullanıcıların deneyimini bozan davranışlar yasaktır.

## 5. Kullanıcı içerikleri ve kullanım izni

- Paylaştığınız içeriklerin hakları size aittir. Trabzone, içerikleriniz üzerinde mülkiyet hakkı iddia etmez.
- İçerik paylaştığınızda Trabzone'a; içeriği Platform içinde göstermek, önbelleğe almak, küçük ölçekli kopyalar üretmek, güvenlik ve moderasyon incelemesi yapmak ve hizmeti sunmak için gereken **sınırlı, dünya çapında, ücretsiz, münhasır olmayan ve devredilemez** bir kullanım izni vermiş olursunuz.
- Bu izin, içeriği sildiğinizde makul teknik süre içinde sona erer. Yedeklerden ve güvenlik kayıtlarından tamamen kaldırılması ek süre alabilir.
- Başkasına ait telif hakkı, marka, kişilik hakkı veya özel hayatı ihlal eden içerik paylaşamazsınız. İzinsiz fotoğraf veya video yayınlayamazsınız.
- İçeriğiniz hakkında geçerli bir şikâyet veya hukuki talep alındığında içerik geçici olarak kaldırılabilir ve inceleme yapılır.
- Başkasının kişisel verilerini, iletişim bilgilerini veya özel hayatına ilişkin bilgileri rızası olmadan paylaşamazsınız.

## 6. Yasaklı davranışlar

Aşağıdaki davranışlar kesinlikle yasaktır:

- Dolandırıcılık, sahte kampanya, yanıltıcı satış ve maddi menfaat sağlamaya yönelik aldatıcı davranışlar.
- Spam, istenmeyen toplu mesaj, otomatik hesap ve yönlendirme bağlantıları.
- Sahte hesap oluşturma, kimlik taklidi, başkası gibi davranma.
- Taciz, zorbalık, tehdit, sindirme ve ısrarlı istenmeyen iletişim.
- Nefret söylemi, ayrımcılık, şiddet çağrısı ve terör propagandası.
- Çocukların cinsel istismarı ve sömürüsü, çocuklara yönelik uygunsuz iletişim veya kandırma (grooming).
- İzinsiz kişisel veri paylaşımı, özel bilgilerin ifşası, intikam pornografisi.
- Telif hakkı, marka hakkı ve diğer fikri mülkiyet haklarının ihlali.
- Yasa dışı ürün, hizmet, madde veya silah satışı; reçeteli ilaç ve benzeri kısıtlı ürünlerin izinsiz satışı.
- Platformun güvenlik sistemlerini, moderasyon araçlarını veya erişim kontrollerini kötüye kullanma.
- Başka bir kullanıcının hesabına izinsiz erişme veya erişmeye çalışma.

## 7. Marketplace kuralları

- İlan veren kullanıcı, ilanın doğru, güncel, kendisine ait veya satmaya yetkili olduğu bir ürün/hizmete ilişkin olmasından sorumludur.
- Platform içi ödeme altyapısı etkinleştirilmediği sürece Trabzone ödeme almaz, ödeme aracılığı yapmaz, kargo veya teslimat sürecinin tarafı değildir. Sipariş talepleri alıcı ile satıcı arasında iletişim kurulmasını sağlar.
- Ödeme altyapısı ileride etkinleştirilirse ödeme, iade, cayma ve uyuşmazlık süreçleri ayrıca duyurulur ve ilgili mevzuata uygun hale getirilir.
- Yasaklı ürün ve hizmetler, yanıltıcı fiyatlandırma, sahte ilan ve stokta olmayan ürün satışı yasaktır. Bu ilanlar kaldırılır ve hesap hakkında yaptırım uygulanabilir.
- Alıcı; ilanı, satıcıyı ve ürün koşullarını değerlendirmekle sorumludur. Taraflar arasındaki ticari uyuşmazlığın tarafı Trabzone değildir; Trabzone yalnızca topluluk kuralları kapsamında işlem yapar.

## 8. Emlak ve araç ilanları

- Emlak ve araç ilanı veren kullanıcı, ilan verme yetkisini ve beyan ettiği bilgilerin doğruluğunu garanti eder.
- Mevzuatın gerektirdiği hallerde ilan verenin kimliği, yetki belgesi ve ilan verme yetkisi doğrulanabilir. Doğrulanmayan ilanlar yayınlanmayabilir veya kaldırılabilir.
- Elektronik İlan Doğrulama Sistemi (EİDS) ve benzeri resmî doğrulama gereklilikleri, ilgili mevzuatın yürürlüğe girmesi halinde uygulanır.
- Yanıltıcı, mükerrer, başkasına ait veya yetkisiz emlak/araç ilanları kaldırılır.
- İlanlarda yer alan fiyat, konum, metrekare, model yılı ve benzeri bilgilerin doğruluğu ilan sahibinin sorumluluğundadır.

## 9. Harita, işletmeler ve konum

- Harita ve işletme bilgileri bilgilendirme amaçlıdır; doğruluğu garanti edilmez. İşletme sahipleri profillerini sahiplenebilir ve güncelleyebilir.
- İşletme profillerine yüklenen fotoğraf, video ve açıklamalar ilgili hak sahiplerinin izniyle yüklenmelidir.
- Kullanıcı yorumları kişisel görüşlerdir. Sahte yorum, karşılıklı puanlama anlaşması ve ticari manipülasyon yasaktır.
- Konum paylaşımı yalnızca kullanıcının açık izniyle ve seçtiği kapsamda çalışır. Konum verileri üçüncü kişilerle reklam amacıyla paylaşılmaz.

## 10. Moderasyon ve yaptırımlar

- İçerikler otomatik araçlar ve yetkili moderasyon ekibi tarafından incelenebilir.
- İhlal halinde içerik kaldırılabilir, görünürlük azaltılabilir, uyarı verilebilir, geçici kısıtlama uygulanabilir, hesap askıya alınabilir veya kalıcı olarak kapatılabilir.
- Çocuk güvenliği, şiddet ve acil tehlike içeren bildirimler öncelikli kuyrukta incelenir. Gerekli hallerde yetkili kamu kurumlarına hukuka uygun bildirim yapılır.
- Kullanıcı, kendisine uygulanan yaptırıma karşı destek merkezi üzerinden itiraz edebilir. İtirazlar yetkili ekip tarafından yeniden incelenir.
- Moderasyon kararları ve gerekçeleri, güvenlik ve hukuki yükümlülükler kapsamında sınırlı süreyle saklanır.

## 11. Fikri mülkiyet

Trabzone adı, logosu, arayüz tasarımı, yazılımı ve marka unsurları Trabzone'a aittir. Bu Koşullar size marka, yazılım veya tasarım üzerinde mülkiyet hakkı vermez. İzinsiz kopyalama, tersine mühendislik, çoğaltma ve ticari kullanım yasaktır.

## 12. Hizmet değişiklikleri ve kesintiler

- Platform bakım, güncelleme, güvenlik veya altyapı nedenleriyle geçici olarak kullanılamayabilir.
- Özellikler eklenebilir, değiştirilebilir veya kaldırılabilir. Kullanıcı haklarını önemli ölçüde etkileyen değişikliklerde makul bildirim yapılır.
- Planlı bakım çalışmaları mümkün olduğunda önceden duyurulur.

## 13. Sorumluluk

- Platform "mevcut haliyle" sunulur. Kesintisiz, hatasız veya her cihazda eksiksiz çalışacağı garanti edilmez.
- Yürürlükteki hukukun izin verdiği ölçüde Trabzone; dolaylı zararlar, kâr kaybı, veri kaybı ve üçüncü kişilerin davranışlarından doğan zararlar için sorumlu tutulamaz.
- Bu hüküm, tüketici mevzuatından doğan ve sözleşmeyle sınırlandırılamayan haklarınızı etkilemez.
- Kullanıcıların birbirleriyle veya üçüncü kişilerle kurduğu iletişim ve yaptığı işlemlerden doğan uyuşmazlıklarda Trabzone, kendi topluluk kuralları kapsamında hareket eder; ticari uyuşmazlığın tarafı değildir.

## 14. Hesap silme ve fesih

- Hesabınızı web sitesi veya uygulama üzerinden silebilirsiniz. Silme işlemi geri alınamaz.
- Hesap silindiğinde profil, gönderi, hikâye, Reels, yorum, beğeni, takip ilişkileri, ilanlar ve kullanıcı medyası hizmetten kaldırılır; yasal olarak saklanması gereken kayıtlar sınırlı süreyle tutulur.
- Koşulları ağır şekilde ihlal eden hesaplar, yasal yükümlülükler ve güvenlik gerekleri çerçevesinde kapatılabilir.

## 15. Uygulanacak hukuk ve uyuşmazlık

Bu Koşullar Türkiye Cumhuriyeti hukukuna tabidir. Uyuşmazlıklarda Türkiye'deki yetkili mahkemeler ve icra daireleri yetkilidir. Tüketici işlemlerinde tüketicinin yerleşim yerindeki tüketici hakem heyetleri ve tüketici mahkemelerinin yetkisi saklıdır. Kullanıcının vazgeçilemeyen yasal hakları korunur.

## 16. Değişiklikler ve iletişim

- Koşullar güncellenebilir. Yeni sürüm, sürüm numarası ve yürürlük tarihiyle birlikte yayımlanır.
- Hukuken yeniden kabul gerektiren değişikliklerde kullanıcıya bildirim yapılır ve yeni metin onayı istenir.
- Sorularınız için Destek Merkezi'ni kullanabilir veya support@litxtech.com adresine yazabilirsiniz.
$doc$,
  true, true, false, 'Kullanım Koşulları kapsamlı olarak yenilendi.',
  '2026-10-28 00:00:00+00', now()
),
(
  'privacy', 2, 'tr', 'policy',
  'Trabzone Gizlilik Politikası',
  'Trabzone''un hangi kişisel verileri hangi amaçlarla topladığı, kimlerle paylaştığı, ne kadar süre sakladığı ve kullanıcıların hakları.',
  $doc$
# Trabzone Gizlilik Politikası

**Sürüm:** 2.0 · **Yürürlük:** 28 Ekim 2026

Bu Gizlilik Politikası, Trabzone platformunda kişisel verilerin nasıl toplandığını, kullanıldığını, paylaşıldığını, saklandığını ve korunduğunu açıklar. Veri sorumlusu Trabzone'dur. Kişisel verilerin işlenmesine ilişkin yasal bilgilendirme için ayrıca KVKK Aydınlatma Metni'ni incelemeniz gerekir. Bu politika bir açık rıza metni değildir.

## 1. Topladığımız bilgiler

- **Hesap bilgileri:** ad, soyad, kullanıcı adı, e-posta adresi, şifre özeti (düz metin olarak saklanmaz), hesap oluşturma tarihi, doğrulama durumu.
- **Profil bilgileri:** profil fotoğrafı, kapak fotoğrafı, biyografi, şehir, ilgi alanları ve gizlilik tercihleri.
- **Kullanıcı içerikleri:** gönderiler, gönderi medyası, yorumlar, beğeniler, kaydedilen içerikler, hikâyeler, Reels videoları ve görüntüleme kayıtları.
- **Mesajlaşma verileri:** sohbet katılımcıları, mesaj içeriği, ekler, gönderim/okunma durumları. Mesajlar yalnızca sohbet katılımcıları ve yetkili moderasyon ekibi tarafından, yalnızca bir şikâyet veya güvenlik incelemesi kapsamında görülebilir.
- **Arama verileri:** sesli/görüntülü aramanın etkin olduğu durumlarda arama başlatma, kabul, reddetme ve bitiş kayıtları. Arama medyası kayıt altına alınmaz.
- **Sosyal grafik verileri:** takip ilişkileri, arkadaşlık talepleri, engelleme ve sessize alma listeleri.
- **Marketplace verileri:** ilanlar, ilan görselleri, favoriler, sipariş talepleri, sipariş durumu ve satıcı değerlendirmeleri.
- **Harita ve işletme verileri:** konum izni verildiğinde yaklaşık/kesin konum, harita tercihleri, kaydedilen yerler, işletme yorumları ve sahiplenme talepleri.
- **Destek ve güvenlik verileri:** destek talepleri, canlı destek mesajları, ekler, şikâyetler, moderasyon kararları ve denetim kayıtları.
- **Teknik veriler:** oturum belirteçleri, cihaz/uygulama sürümü, platform bilgisi, hata ve güvenlik günlükleri, IP adresi kaynaklı güvenlik kayıtları.
- **Bildirim tercihleri:** push ve e-posta bildirim tercihleri, izin durumları.

Konum izni vermediğiniz sürece kesin konumunuz toplanmaz. "Yakınımda" özelliği izin verilmediğinde şehir bilgisiyle çalışabilir. Kamera, mikrofon ve galeri erişimi yalnızca ilgili özelliği kullandığınızda ve izninizle istenir.

## 2. Verileri toplama yöntemleri

- Doğrudan sizin verdiğiniz bilgiler (kayıt formu, profil düzenleme, ilan oluşturma, destek talebi).
- Platformu kullanırken oluşan işlem kayıtları (içerik paylaşımı, etkileşimler, oturum ve güvenlik olayları).
- Cihaz izinleri (kamera, mikrofon, galeri, konum, bildirim).
- Seçtiğiniz üçüncü taraf giriş hizmetleri (Apple veya Google ile giriş yaptığınızda sağlayıcıdan gelen kimlik ve e-posta bilgileri).
- Altyapı sağlayıcılarının teknik kayıtları (barındırma, kimlik doğrulama, medya dağıtımı).

## 3. İşleme amaçları ve hukuki sebepler

- Hesap oluşturmak, oturum yönetmek ve kimliği doğrulamak.
- Sosyal akış, keşfet, mesajlaşma, arama, harita, işletme ve Marketplace hizmetlerini sunmak.
- İçerik ve hesap güvenliğini sağlamak, şikâyetleri incelemek, moderasyon uygulamak.
- Çocuk güvenliği ve yaş uygunluğu tedbirlerini uygulamak.
- Destek taleplerini yanıtlamak ve kullanıcı deneyimini iyileştirmek.
- Yasal yükümlülükleri yerine getirmek, yetkili kurum taleplerini yanıtlamak ve uyuşmazlıkları çözmek.
- Açık rızanız varsa pazarlama iletişimi göndermek ve isteğe bağlı analitik/personalizasyon faaliyetleri yürütmek.

İşleme; sözleşmenin kurulması/ifası, hukuki yükümlülük, meşru menfaat ve gerektiğinde açık rıza hukuki sebeplerine dayanır. Pazarlama iletileri yalnızca ayrı ve isteğe bağlı rızanızla gönderilir; rızanızı her zaman geri alabilirsiniz. Rızanın reddedilmesi temel hesap hizmetlerini engellemez.

## 4. Verilerin paylaşılması

Kişisel verilerinizi reklam amacıyla üçüncü taraflara satmayız. Veriler yalnızca şu durumlarda paylaşılır:

- **Altyapı sağlayıcıları:** veritabanı, kimlik doğrulama ve dosya depolama (Supabase), herkese açık medya dağıtımı (Cloudflare R2), sesli/görüntülü arama altyapısı (LiveKit), harita altyapısı (Mapbox) ve mobil bildirim altyapısı (Expo). Sağlayıcılar verilere yalnızca hizmetin gerektirdiği ölçüde erişir.
- **Yetkili kamu kurumları:** usulüne uygun hukuki talep halinde, talep edilen kapsamla sınırlı olarak.
- **Açıkça herkese görünür yaptığınız içerikler:** profiliniz, gönderileriniz, ilanlarınız ve yorumlarınız, gizlilik ayarlarınıza göre diğer kullanıcılarca görülebilir.
- **Hukuki halefiyet:** birleşme, devir veya yeniden yapılanma halinde, gizlilik yükümlülükleri korunmak kaydıyla.
- **Açık rızanız:** bunların dışında bir paylaşım için ayrıca açık rızanız alınır.

Destek ve moderasyon kayıtlarına erişim, rol bazlı yetkilendirme ve denetim kaydı ile sınırlandırılır.

## 5. Saklama

- Hesap ve profil verileri, hesabınız açık olduğu sürece saklanır.
- Hesap silindiğinde profil, içerik ve medya hizmetten kaldırılır; yedeklerden ve güvenlik kayıtlarından silinmesi makul teknik süre alabilir.
- Destek, şikâyet, moderasyon ve denetim kayıtları; güvenlik ve yasal yükümlülükler için gerekli süre boyunca sınırlı olarak saklanır.
- Yasal saklama yükümlülüğü bulunan kayıtlar ilgili mevzuatta öngörülen süreyle tutulur; süre sonunda silinir veya anonimleştirilir.
- Saklama süresi belirlenirken verinin niteliği, işleme amacı, yasal yükümlülükler ve olası uyuşmazlık riski dikkate alınır.

## 6. Kullanıcı kontrolleri ve haklarınız

- Profil gizliliğinizi, mesaj ve yorum izinlerinizi ayarlardan yönetebilirsiniz.
- Konum, kamera, mikrofon ve bildirim izinlerini cihaz ayarlarından değiştirebilirsiniz.
- Kullanıcıları engelleyebilir, içeriklerinizi silebilir ve hesabınızı kapatabilirsiniz.
- Verilerinize erişme, düzeltme, silme, işlemeye itiraz etme ve rızalarınızı geri alma taleplerinizi Veri Talepleri sayfasından iletebilirsiniz.
- KVKK kapsamındaki başvurularınızı KVKK Aydınlatma Metni'nde açıklanan yöntemlerle yapabilirsiniz.

## 7. Veri güvenliği

- Bağlantılar TLS ile şifrelenir.
- Verilere erişim, satır düzeyi güvenlik (RLS) politikalarıyla kullanıcı bazında sınırlandırılır.
- Hassas işlemler yalnızca sunucu tarafındaki yetki kontrollerinden geçen fonksiyonlarla yapılır.
- Mesajlar yalnızca sohbet katılımcıları tarafından okunabilir.
- Dosya erişimi; dosya türü, boyutu ve sahipliği doğrulandıktan sonra verilir.
- Yönetici işlemleri denetim kaydına yazılır; yönetici oturumları ayrıca izlenir.
- Şifreler düz metin olarak saklanmaz.

Hiçbir sistem mutlak güvenlik garantisi vermez. Yetkisiz erişim şüphesinde şifrenizi değiştirip bize bildirmenizi öneririz.

## 8. Çocukların gizliliği

13 yaşından küçük çocuklardan bilerek veri toplamayız. Böyle bir hesap tespit edilirse hesap kapatılır ve ilgili veriler silinir. 18 yaşından küçük kullanıcılar için daha kapalı gizlilik varsayılanları uygulanır; mesajlaşma, arama, yorum ve görünürlük ayarları yaş grubuna göre sınırlandırılır. Çocuk güvenliği endişeleri ayrı ve öncelikli kuyrukta incelenir. Ayrıntılar için Çocuk Koruma Politikası'nı inceleyin.

## 9. Uluslararası veri aktarımı

Altyapı sağlayıcılarının veri merkezleri Türkiye dışında bulunabilir. Bu durumda kişisel veriler, KVKK'nın yurt dışına aktarım hükümlerine ve ilgili mevzuata uygun güvenceler (uygun güvence, standart sözleşme veya açık rıza gibi) sağlanarak aktarılır. Aktarımın kapsamı ve güvenceleri, kullanılan hizmetlere göre güncellenir.

## 10. Üçüncü taraf hizmetler

Platform; Apple ve Google ile giriş, harita, medya dağıtımı, arama altyapısı ve bildirim hizmetleri gibi üçüncü taraf hizmetlerden yararlanabilir. Bu hizmetlerin kendi gizlilik politikaları bulunur. Bir üçüncü taraf hizmeti kullanmadan önce ilgili sağlayıcının politikasını incelemenizi öneririz.

## 11. Politika değişiklikleri

Bu politika güncellendiğinde sürüm numarası ve yürürlük tarihi bu sayfada yayımlanır. Önemli değişikliklerde Platform içinde bildirim yapılır. Yeni sürüm, önceki sürümlerin yerini alır; geçmiş sürümler arşivde korunur.

## 12. İletişim

Gizlilikle ilgili sorular ve talepler için Destek Merkezi'ni kullanabilir veya support@litxtech.com adresine yazabilirsiniz. KVKK başvuruları için ayrı kanal ve yöntem KVKK Aydınlatma Metni'nde belirtilmiştir.
$doc$,
  true, false, false, 'Gizlilik Politikası güncellendi ve veri kategorileri ayrıntılandırıldı.',
  '2026-10-28 00:00:00+00', now()
)
on conflict (slug, locale, version) do nothing;
