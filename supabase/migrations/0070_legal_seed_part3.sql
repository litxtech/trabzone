-- =============================================================================
-- 0070 (devam): Topluluk Kuralları, Hesap Silme, Çerez, Marketplace, Emlak, Araç
-- =============================================================================

set search_path = public, extensions;

insert into public.safety_policy_versions
  (slug, version, locale, doc_type, title, summary, body_md, is_published,
   requires_acceptance, requires_reacceptance, change_summary, effective_at, published_at)
values
(
  'community-guidelines', 1, 'tr', 'policy',
  'Trabzone Topluluk Kuralları',
  'Trabzone''da saygılı, güvenli ve hukuka uygun bir topluluk için davranış standartları, yasaklar, moderasyon ve itiraz süreçleri.',
  $doc$
# Trabzone Topluluk Kuralları

**Sürüm:** 1.0 · **Yürürlük:** 28 Ekim 2026

Trabzone, Trabzon ve çevresindeki insanların paylaşımda bulunduğu, keşfettiği ve birbirine ulaştığı bir topluluktur. Bu kurallar, herkesin güvenli ve saygılı bir deneyim yaşaması için geçerlidir. Platformu kullanarak bu kurallara uymayı kabul edersiniz.

## 1. Saygılı iletişim

- Diğer kullanıcılara saygılı davranın. Görüş ayrılıkları hakaret veya tehdide dönüşmemelidir.
- Kişilerin kimliğine, inancına, etnik kökenine, cinsiyetine, cinsel yönelimine, engellilik durumuna veya sosyal durumuna yönelik aşağılayıcı ifadeler kullanmayın.
- Özel mesajlarda da bu kurallar geçerlidir. "Özel" olması, tacizi meşru kılmaz.

## 2. Taciz, zorbalık ve tehdit

- Taciz, ısrarlı takip, sindirme, küçük düşürme ve koordineli zorbalık yasaktır.
- Tehdit, şantaj, özel bilgi ifşasıyla baskı kurma ve intikam pornografisi yasaktır.
- Bir kullanıcı sizi rahatsız ediyorsa engelleyin ve şikâyet edin. Karşılık vermek durumu ağırlaştırabilir.

## 3. Nefret söylemi ve şiddet

- Nefret söylemi, ayrımcılık çağrısı, şiddet teşviki ve terör propagandası yasaktır.
- Şiddeti öven, özendiren veya planlayan içerikler kaldırılır.
- Kendine zarar vermeyi veya yeme bozukluğunu özendiren içerikler yasaktır.

## 4. Spam ve sahte hesaplar

- İstenmeyen toplu mesaj, yorum spamı, yapay etkileşim ve yönlendirme çiftliği yasaktır.
- Sahte hesap, çoklu hesap suistimali ve otomatik hesap oluşturma yasaktır.
- Başkası gibi davranma, kimlik taklidi ve sahte marka hesabı oluşturma yasaktır.
- Dolandırıcılık, sahte kampanya, yatırım tuzağı ve maddi menfaat amaçlı aldatma yasaktır.

## 5. Telif ve fikri mülkiyet

- Başkasına ait fotoğraf, video, müzik, metin ve tasarımları hak sahibinin izni olmadan paylaşmayın.
- Kaynağı belirtmek tek başına izin yerine geçmez.
- Hak ihlali bildirimi üzerine içerik kaldırılabilir; tekrarlayan ihlallerde hesap kısıtlanır.

## 6. Özel bilgiler ve izinsiz görüntüler

- Başkasının telefon numarası, adresi, kimlik bilgisi, finansal bilgisi veya özel yazışmasını rızası olmadan paylaşmayın.
- İzinsiz çekilmiş veya yayınlanmış fotoğraf/video paylaşmayın.
- Çocukların görüntülerini uygunsuz bağlamda veya izinsiz paylaşmayın.

## 7. Çocuk güvenliği

- Çocukların cinsel istismarı ve sömürüsüne ilişkin her türlü içerik kesinlikle yasaktır.
- Çocuklarla uygunsuz iletişim, kandırma ve cinsel içerik talebi yasaktır.
- Çocuk güvenliği bildirimleri öncelikli incelenir. Ayrıntılar için Çocuk Koruma Politikası'nı inceleyin.

## 8. Uygunsuz içerik

- Cinsel şiddet, hayvan istismarı, ağır şiddet ve yasa dışı faaliyet teşviki yasaktır.
- Yetişkinlere yönelik içerikler, platformun yaş ve görünürlük kurallarına tabidir; çocukların erişebileceği alanlarda yayınlanamaz.
- Yasa dışı ürün, madde, silah ve reçeteli ilaç satışı yasaktır.

## 9. Marketplace güvenliği

- İlanlar doğru, güncel ve satmaya yetkili olduğunuz ürünlere ilişkin olmalıdır.
- Yanıltıcı fiyat, sahte ürün, stokta olmayan ürün ve alıcıyı platform dışına yönlendirerek dolandırma yasaktır.
- Platform içi ödeme altyapısı etkin değilse Trabzone ödeme veya teslimat garantisi vermez.
- Şüpheli ilanları bildirin; ilan kaldırılabilir ve hesap hakkında yaptırım uygulanabilir.

## 10. Sahte yorum ve puanlama

- Sahte yorum, karşılıklı puan anlaşması, rakip işletmeyi kötüleme ve yorum satın alma yasaktır.
- İşletme sahipleri kendi işletmelerine sahte olumlu yorum yazamaz.
- Yorumlar deneyime dayalı olmalı; kişisel saldırı içermemelidir.

## 11. Moderasyon

- İçerikler otomatik araçlar ve yetkili ekip tarafından incelenebilir.
- İhlal halinde içerik kaldırılabilir, görünürlük azaltılabilir, uyarı verilebilir, geçici kısıtlama uygulanabilir, hesap askıya alınabilir veya kapatılabilir.
- Çocuk güvenliği ve acil tehlike bildirimleri öncelikli kuyrukta incelenir.
- Moderasyon kararları gerekçeli olarak kayıt altına alınır.

## 12. Şikâyet ve itiraz

- Her kullanıcı; profil, gönderi, Reels, yorum, mesaj, işletme içeriği ve ilanı şikâyet edebilir.
- Şikâyetlerde içerik bağlantısı ve açıklama paylaşmak incelemeyi hızlandırır.
- Yaptırıma itiraz Destek Merkezi üzerinden yapılır; itiraz yetkili ekip tarafından yeniden incelenir.
- Bildirimde bulunanın kimliği, hukuki zorunluluk olmadıkça açıklanmaz.

## 13. Yürürlük

Bu kurallar, Kullanım Koşulları'nın ayrılmaz bir parçasıdır. Kural ihlalleri Kullanım Koşulları kapsamında yaptırıma tabidir. Sorularınız için Destek Merkezi'ni kullanabilirsiniz.
$doc$,
  true, false, false, 'Topluluk Kuralları ilk kez yayımlandı.',
  '2026-10-28 00:00:00+00', now()
),
(
  'account-deletion', 1, 'tr', 'policy',
  'Trabzone Hesap ve Veri Silme Politikası',
  'Trabzone hesabının web ve mobil üzerinden nasıl silineceği, silme kapsamı, saklanan kayıtlar ve hesap dondurma farkı.',
  $doc$
# Trabzone Hesap ve Veri Silme Politikası

**Sürüm:** 1.0 · **Yürürlük:** 28 Ekim 2026

Bu politika, Trabzone hesabınızı ve verilerinizi nasıl silebileceğinizi, silme işleminin kapsamını ve yasal olarak saklanması gereken kayıtları açıklar.

## 1. Hesap silme hakkı

- Hesabınızı dilediğiniz zaman web sitesi veya mobil uygulama üzerinden silebilirsiniz.
- Silme işlemi **geri alınamaz**. Silme sonrası aynı hesapla oturum açılamaz.
- Hesap dondurma ile hesap silme farklı işlemlerdir. Dondurma yalnızca hesabı geçici olarak devre dışı bırakır; kalıcı silme yerine geçmez.

## 2. Web üzerinden silme

1. Trabzone hesabınızla giriş yapın.
2. **Hesap Silme** sayfasını açın.
3. Silinecek hesabı ve silme kapsamını inceleyin.
4. Güvenlik doğrulamasını tamamlayın.
5. **Hesabımı Kalıcı Olarak Sil** butonuna basın.
6. Son onay ekranını okuyup onaylayın.
7. Silme talebi sunucuya kaydedilir ve işlem başlatılır.
8. İşlem durumu size gösterilir.

Güvenlik doğrulaması tamamlanmadan silme işlemi başlatılmaz.

## 3. Giriş yapamayan kullanıcılar

- Uygulamaya veya hesabınıza erişemiyorsanız, web sitesindeki Hesap Silme sayfasından doğrulama talebi oluşturabilirsiniz.
- Talebin gerçek hesap sahibinden geldiğini doğrulamak için kayıtlı e-posta adresine doğrulama bağlantısı veya ek doğrulama adımları uygulanır.
- Yalnızca bir e-posta adresi yazarak başkasının hesabı silinemez.
- Doğrulama tamamlanamazsa talep reddedilir ve durum kullanıcıya bildirilir.

## 4. Mobil uygulama üzerinden silme

**Ayarlar > Hesap > Hesabımı Sil** yolunu izleyerek aynı silme akışını başlatabilirsiniz. Bu buton gerçek silme akışını başlatır; yalnızca bilgilendirme sayfasına yönlendirmez.

## 5. Silme kapsamı

Silme işlemi tamamlandığında, yasal saklama yükümlülüğü bulunmayan veriler için aşağıdaki işlemler uygulanır:

- Hesap kaydı ve profil bilgileri.
- Profil fotoğrafı ve kapak fotoğrafı.
- Gönderiler, hikâyeler ve Reels videoları.
- Kullanıcı medya dosyaları.
- Yorumlar, beğeniler ve kaydedilen içerikler.
- Takip ilişkileri, arkadaşlık talepleri, engelleme kayıtları.
- Favoriler ve kaydedilen yerler.
- Marketplace ilanları ve ilgili görseller.
- İşletme yorumları ve katkıları.
- Bildirim tercihleri ve cihaz belirteçleri.
- Aktif oturumlar sonlandırılır.
- OAuth bağlantıları kaldırılır; silinen hesap yeniden girişle otomatik oluşturulmaz.

Mesajlaşma verileri, karşı tarafın hukuki hakları ve güvenlik gereklilikleri dikkate alınarak silinir veya anonimleştirilir. Sohbetin diğer katılımcısında bulunan mesaj kopyaları, o kullanıcının hesabına ait veri olarak değerlendirilir.

## 6. Yasal olarak saklanan kayıtlar

Aşağıdaki kayıtlar, ilgili mevzuatta öngörülen süre boyunca sınırlı erişimle saklanabilir:

- Güvenlik ve denetim kayıtları.
- Şikâyet, moderasyon ve çocuk güvenliği kayıtları.
- Hukuki uyuşmazlık ve yetkili kurum taleplerine ilişkin kayıtlar.
- Yasal saklama yükümlülüğü bulunan işlem kayıtları.

Bu kayıtlar pazarlama veya profilleme amacıyla kullanılmaz; süre sonunda silinir veya anonimleştirilir.

## 7. İşlem süresi ve durum

- Silme talebi alındığında işlem kuyruğa alınır ve kullanıcıya talep numarası verilir.
- İşlem tamamlandığında kullanıcıya sonuç bildirimi gönderilir.
- İşlem başarısız olursa kullanıcıya **tamamlandı** mesajı gösterilmez; hata durumu ve yeniden deneme seçeneği sunulur.
- Silme işlemi sırasında ek doğrulama gerekebilir.

## 8. Veri talepleri ile ilişki

Hesabınızı silmeden belirli verilerinizin silinmesini, düzeltilmesini veya kopyasını talep etmek için **Veri Talepleri** sayfasını kullanabilirsiniz. Hesap silme ve veri talebi ayrı süreçlerdir.

## 9. İletişim

Silme süreciyle ilgili sorularınız için Destek Merkezi > Hesap Silme kategorisini veya support@litxtech.com adresini kullanabilirsiniz.
$doc$,
  true, false, false, 'Hesap ve Veri Silme Politikası ilk kez yayımlandı.',
  '2026-10-28 00:00:00+00', now()
),
(
  'cookies', 1, 'tr', 'policy',
  'Trabzone Çerez Politikası',
  'Trabzone web sitesinde kullanılan çerez türleri, amaçları, saklama süreleri ve çerez tercihlerinin yönetimi.',
  $doc$
# Trabzone Çerez Politikası

**Sürüm:** 1.0 · **Yürürlük:** 28 Ekim 2026

Bu politika, Trabzone web sitesinde kullanılan çerezleri ve benzeri teknolojileri açıklar. Çerez tercihlerinizi site alt bilgisindeki **Çerez Ayarları** bağlantısından istediğiniz zaman değiştirebilirsiniz.

## 1. Çerez nedir?

Çerezler, bir web sitesini ziyaret ettiğinizde tarayıcınıza kaydedilen küçük metin dosyalarıdır. Oturumun sürdürülmesi, tercihlerin hatırlanması ve güvenlik gibi amaçlarla kullanılır.

## 2. Kullandığımız çerez türleri

### Zorunlu çerezler

Siteyi çalıştırmak ve güvenliği sağlamak için gereklidir. Bu çerezler olmadan oturum açma, dil ve tema tercihi gibi temel işlevler çalışmaz. Zorunlu çerezler için onay istenmez; ancak bunlar pazarlama amacıyla kullanılmaz.

- Oturum ve kimlik doğrulama belirteçleri.
- Güvenlik ve sahtekârlık önleme kayıtları.
- Dil, tema ve çerez tercihi kayıtları.

### İşlevsel çerezler

Kullanıcı deneyimini iyileştirmek için tercihleri hatırlar. İsteğe bağlıdır ve yalnızca onayınızla etkinleşir.

### Analitik çerezler

Site kullanımını anonim veya toplu olarak ölçmek için kullanılabilir. Yalnızca onayınızla etkinleşir. Etkin olmadığında analitik amaçlı izleme yapılmaz.

### Pazarlama çerezleri

Şu anda pazarlama çerezi kullanılmamaktadır. İleride kullanılması halinde yalnızca ayrı ve açık onayınızla etkinleştirilir ve bu politika güncellenir.

## 3. Saklama süreleri

- Oturum çerezleri: tarayıcı oturumu kapandığında sona erer.
- Tercih çerezleri: en fazla 12 ay.
- Güvenlik çerezleri: güvenlik ihtiyacına göre sınırlı süre.
- Analitik çerezler (onay verilirse): sağlayıcıya göre en fazla 24 ay.

Kesin süreler, çerez sağlayıcısının yapılandırmasına göre değişebilir; güncel liste site yapılandırmasında tutulur.

## 4. Çerez tercihleri

Site ilk ziyarette üç seçenek sunar:

- **Tümünü Kabul Et:** zorunlu, işlevsel ve analitik çerezleri etkinleştirir.
- **Zorunlu Olmayanları Reddet:** yalnızca zorunlu çerezler etkin kalır.
- **Tercihleri Yönet:** her kategoriyi ayrı ayrı açar veya kapatır.

Zorunlu olmayan çerezler, onay verilmeden etkinleştirilmez. Tercihinizi daha sonra alt bilgideki **Çerez Ayarları** bağlantısından değiştirebilirsiniz.

## 5. Üçüncü taraf çerezleri

Site; harita, medya ve kimlik doğrulama gibi üçüncü taraf hizmetlerden yararlanabilir. Bu hizmetler kendi çerezlerini kullanabilir. İlgili sağlayıcının gizlilik politikası ayrıca geçerlidir.

## 6. Tarayıcı ayarları

Çerezleri tarayıcı ayarlarınızdan da silebilir veya engelleyebilirsiniz. Zorunlu çerezlerin engellenmesi halinde sitenin bazı bölümleri çalışmayabilir.

## 7. İletişim

Çerezlerle ilgili sorularınız için Destek Merkezi > Gizlilik kategorisini veya support@litxtech.com adresini kullanabilirsiniz. Bu politika, Gizlilik Politikası ve KVKK Aydınlatma Metni ile birlikte okunmalıdır.
$doc$,
  true, false, false, 'Çerez Politikası ilk kez yayımlandı.',
  '2026-10-28 00:00:00+00', now()
),
(
  'marketplace-rules', 1, 'tr', 'policy',
  'Trabzone Marketplace Kuralları',
  'Trabzone Marketplace''te ilan verme, satıcı ve alıcı yükümlülükleri, yasaklı ürünler, sipariş talepleri ve uyuşmazlık süreçleri.',
  $doc$
# Trabzone Marketplace Kuralları

**Sürüm:** 1.0 · **Yürürlük:** 28 Ekim 2026

Bu kurallar, Trabzone Marketplace üzerinde ilan veren ve alışveriş yapan kullanıcılar için geçerlidir. Kullanım Koşulları ve Topluluk Kuralları ile birlikte uygulanır.

## 1. İlan kuralları

- İlan; gerçek, güncel ve satmaya yetkili olduğunuz bir ürün veya hizmete ilişkin olmalıdır.
- Fotoğraflar ürünün kendisine ait olmalı, başka bir siteden izinsiz alınmamalıdır.
- Fiyat, durum, konum ve teslimat bilgileri doğru olmalıdır.
- Aynı ürün için mükerrer ilan oluşturmayın.
- Yasaklı ürün ve hizmetleri listelemeyin.

## 2. Satıcı yükümlülükleri

- Ürünü tarif edildiği şekilde teslim etmek.
- Alıcıyla zamanında iletişim kurmak.
- Yasal olarak gerekli bilgilendirmeleri yapmak.
- Ürünün ayıplı olması halinde ilgili mevzuattan doğan yükümlülüklere uymak.
- Platform dışına yönlendirerek alıcıyı dolandırmamak.

## 3. Alıcı yükümlülükleri

- İlanı ve satıcı bilgilerini dikkatle incelemek.
- Ödeme öncesi ürün ve satıcıyı doğrulamak.
- Platform dışı ödeme taleplerine karşı dikkatli olmak.
- Hukuka aykırı veya şüpheli ilanları bildirmek.

## 4. Yasaklı ürün ve hizmetler

- Yasa dışı maddeler, silahlar ve patlayıcılar.
- Reçeteli ilaçlar ve sağlık beyanı içeren izinsiz ürünler.
- Çalıntı mallar ve sahte ürünler.
- Canlı hayvan ticareti (mevzuatın izin verdiği istisnalar hariç).
- İnsan ticareti, çocuk istismarı veya hukuka aykırı hizmetler.
- Telif hakkı ihlali içeren dijital ürünler.
- Kişisel veri, hesap veya kimlik bilgisi satışı.

## 5. Ödeme ve teslimat

- Platform içi ödeme altyapısı etkinleştirilmediği sürece Trabzone ödeme almaz ve ödeme aracılığı yapmaz.
- Sipariş talebi, alıcı ile satıcı arasında iletişim kurulmasını sağlar; teslimat ve ödeme taraflar arasında yürütülür.
- Ödeme altyapısı etkinleştirilirse ödeme, iade, cayma ve uyuşmazlık süreçleri ayrıca duyurulur.
- Trabzone, taraflar arasındaki ticari uyuşmazlığın tarafı değildir; topluluk kuralları kapsamında işlem yapar.

## 6. Şikâyet ve moderasyon

- Şüpheli ilanlar ilan üzerindeki şikâyet aracıyla bildirilebilir.
- İhlal halinde ilan kaldırılır, hesap kısıtlanabilir veya kapatılabilir.
- Tekrarlayan ihlaller kalıcı yasakla sonuçlanabilir.
- Moderasyon kararlarına Destek Merkezi üzerinden itiraz edilebilir.

## 7. Sorumluluk

İlan içeriğinden ilan sahibi sorumludur. Trabzone, ilanların doğruluğunu garanti etmez; ancak kural ihlallerinde gerekli moderasyon işlemlerini yürütür. Kullanıcılar, alışveriş öncesi gerekli kontrolleri yapmalıdır.
$doc$,
  true, false, false, 'Marketplace Kuralları ilk kez yayımlandı.',
  '2026-10-28 00:00:00+00', now()
),
(
  'real-estate-rules', 1, 'tr', 'policy',
  'Trabzone Emlak İlan Kuralları',
  'Trabzone Emlak kategorisinde ilan verme yetkisi, doğrulama, EİDS, doğru bilgi ve moderasyon kuralları.',
  $doc$
# Trabzone Emlak İlan Kuralları

**Sürüm:** 1.0 · **Yürürlük:** 28 Ekim 2026

Bu kurallar, Trabzone Emlak kategorisinde ilan veren kullanıcılar için geçerlidir.

## 1. İlan verme yetkisi

- Yalnızca sahibi olduğunuz veya satmaya/kiralamaya yetkili olduğunuz taşınmazları listeleyin.
- Yetkili emlak danışmanı iseniz, ilan verme yetkinizi belgeleyebilmelisiniz.
- Başkasına ait ilanı izinsiz kopyalamayın.

## 2. Doğrulama

- İlan verenin kimliği ve yetkisi doğrulanabilir.
- Mevzuatın gerektirdiği hallerde Elektronik İlan Doğrulama Sistemi (EİDS) ve benzeri resmî doğrulama süreçleri uygulanır.
- Doğrulanmayan ilanlar yayınlanmayabilir veya kaldırılabilir.
- Doğrulama için istenen belgeler yalnızca bu amaçla kullanılır.

## 3. İlan içeriği

- Fiyat, konum, metrekare, oda sayısı, kat ve benzeri bilgiler doğru olmalıdır.
- Fotoğraflar taşınmaza ait olmalı ve güncel durumu yansıtmalıdır.
- "Acil", "kelepir" gibi ifadeler yanıltıcı biçimde kullanılmamalıdır.
- Aynı taşınmaz için mükerrer ilan oluşturmayın.

## 4. Yasaklı ilanlar

- Yetkisiz veya sahte ilanlar.
- Yanıltıcı fiyat ve gizli maliyetler.
- Hukuka aykırı kullanım amacı taşıyan ilanlar.
- Ayrımcılık içeren ilanlar.
- Başkasının fotoğrafını izinsiz kullanan ilanlar.

## 5. İletişim ve işlem

- Alıcı ve satıcı, işlem öncesi gerekli hukuki ve mali kontrolleri yapmalıdır.
- Trabzone, emlak işleminin tarafı veya garantörü değildir.
- Kapora ve ödeme taleplerinde dikkatli olunması önerilir.

## 6. Moderasyon

İhlal halinde ilan kaldırılır, hesap kısıtlanabilir veya kapatılabilir. Kararlara Destek Merkezi üzerinden itiraz edilebilir.
$doc$,
  true, false, false, 'Emlak İlan Kuralları ilk kez yayımlandı.',
  '2026-10-28 00:00:00+00', now()
),
(
  'vehicle-rules', 1, 'tr', 'policy',
  'Trabzone Araç İlan Kuralları',
  'Trabzone Marketplace araç kategorisinde ilan verme, belge doğrulama, doğru bilgi ve moderasyon kuralları.',
  $doc$
# Trabzone Araç İlan Kuralları

**Sürüm:** 1.0 · **Yürürlük:** 28 Ekim 2026

Bu kurallar, Trabzone Marketplace üzerinde araç ilanı veren kullanıcılar için geçerlidir.

## 1. İlan verme yetkisi

- Yalnızca sahibi olduğunuz veya satmaya yetkili olduğunuz araçları listeleyin.
- Yetkili galeri veya satıcı iseniz yetkinizi belgeleyebilmelisiniz.
- Başkasına ait ilanı izinsiz kopyalamayın.

## 2. Doğru bilgi

- Marka, model, yıl, kilometre, yakıt türü, vites ve hasar bilgisi doğru olmalıdır.
- Fotoğraflar araca ait ve güncel olmalıdır.
- Fiyat ve ödeme koşulları açıkça belirtilmelidir.
- Aynı araç için mükerrer ilan oluşturmayın.

## 3. Belgeler

- Ruhsat ve yetki belgeleri, doğrulama amacıyla istenebilir.
- Belgeler yalnızca doğrulama amacıyla kullanılır ve üçüncü kişilerle paylaşılmaz.
- Doğrulanmayan ilanlar kaldırılabilir.

## 4. Yasaklı ilanlar

- Çalıntı, hacizli veya hukuki olarak devri kısıtlı araçlar.
- Kilometre veya hasar bilgisi gizlenen araçlar.
- Sahte belge ve sahte fotoğraf kullanımı.
- Yasa dışı modifiye veya kullanım amacı taşıyan ilanlar.

## 5. İşlem ve sorumluluk

Trabzone araç satışının tarafı veya garantörü değildir. Alıcılar, işlem öncesi aracı ve belgelerini bağımsız olarak doğrulamalıdır.

## 6. Moderasyon

İhlal halinde ilan kaldırılır, hesap kısıtlanabilir veya kapatılabilir. Kararlara Destek Merkezi üzerinden itiraz edilebilir.
$doc$,
  true, false, false, 'Araç İlan Kuralları ilk kez yayımlandı.',
  '2026-10-28 00:00:00+00', now()
)
on conflict (slug, locale, version) do nothing;
