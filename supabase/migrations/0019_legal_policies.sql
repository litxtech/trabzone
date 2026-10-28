-- 0018_legal_policies.sql
--
-- Kullanim Kosullari ve Gizlilik Politikasi metinlerini mevcut
-- safety_policy_versions tablosuna yazar. Boylece lobi, kayit ve ayarlar
-- ekranlari ayni surumlenmis kaynagi kullanir; metin guncellemesi icin
-- uygulama surumu yayinlamak gerekmez.
--
-- Not: Bu dosya yalnizca ekleme yapar (on conflict do nothing). Mevcut
-- politika kayitlari ve kullanici verileri korunur.

insert into public.safety_policy_versions
  (slug, version, title, summary, body_md, is_published, effective_at, published_at)
values
  (
    'terms',
    1,
    'Kullanım Koşulları',
    'Trabzone''u kullanırken geçerli olan temel kurallar, hesap güvenliği, topluluk standartları ve Marketplace sorumlulukları.',
    $terms$
# Trabzone Kullanım Koşulları

Bu koşullar Trabzone mobil uygulamasını ve uygulamaya bağlı hizmetleri kullanımınızı düzenler. Uygulamaya kayıt olarak veya oturum açarak bu koşulları kabul etmiş olursunuz. Koşulları kabul etmiyorsanız uygulamayı kullanmayı bırakmalısınız.

## 1. Hesap oluşturma ve yaş sınırı

- Hesap oluşturmak için doğru ve güncel bilgi vermelisiniz.
- Bir hesap yalnızca bir kişiye aittir; hesabınızı başkasına devredemezsiniz.
- 13 yaşından küçük kullanıcılar Trabzone hesabı oluşturamaz. 18 yaşından küçük kullanıcılar için uygulama daha kapalı gizlilik varsayılanları uygular ve bazı özelliklerini sınırlandırır.
- Hesabınızın şifresini ve oturum bilgilerini korumak sizin sorumluluğunuzdadır. Yetkisiz bir erişim fark ederseniz derhal şifrenizi değiştirin ve destek ekibine bildirin.

## 2. Topluluk kuralları

Trabzone''da şu içeriklere ve davranışlara izin verilmez:

- Nefret söylemi, ayrımcılık, tehdit, taciz veya zorbalık.
- Cinsel istismar, çocukların cinsel sömürüsü veya reşit olmayanları hedef alan her türlü içerik.
- Şiddeti teşvik eden, yasa dışı faaliyeti kolaylaştıran veya terör propagandası içeren paylaşımlar.
- Başkasının kimliğine bürünme, sahte hesap oluşturma, dolandırıcılık.
- İzinsiz toplanmış kişisel verilerin veya başkasına ait özel bilgilerin paylaşılması.
- Spam, yönlendirme bağlantıları, otomatik hesaplar ve platformun teknik altyapısını zorlayan davranışlar.
- Telif hakkı, marka hakkı veya diğer fikri mülkiyet haklarını ihlal eden içerikler.

Kurallara uymayan içerikleri kaldırabilir, hesapları geçici olarak kısıtlayabilir veya kalıcı olarak askıya alabiliriz. Ciddi durumlarda yetkili kurumlara bildirim yapma hakkımız saklıdır.

## 3. Paylaştığınız içerik

- Paylaştığınız fotoğraf, video, metin ve ilanların hakları size aittir.
- İçeriği paylaşarak Trabzone''a; içeriği uygulama içinde göstermek, önbelleğe almak, küçük ölçekli kopyalar üretmek ve hizmeti sunmak için gereken sınırlı, dünya çapında, ücretsiz ve devredilebilir olmayan bir kullanım lisansı vermiş olursunuz.
- Bu lisans, içeriği sildiğinizde makul teknik süre içinde sona erer; yedeklerden temizlenmesi ek süre alabilir.
- Başkasına ait içerikleri izinsiz paylaşmamalısınız.
- Hesabınızı sildiğinizde içerikleriniz hizmetten kaldırılır; yasal olarak saklamamız gereken kayıtlar (örn. moderasyon ve destek kayıtları) sınırlı süreyle tutulabilir.

## 4. Marketplace

Trabzone Marketplace üzerinden ilan veren ve ilanları inceleyen kullanıcılar arasındaki iletişimden ve anlaşmadan taraflar sorumludur.

- İlan bilgilerinin doğru, güncel ve yanıltıcı olmaktan uzak olması satıcının sorumluluğundadır.
- Yasaklı ürün, hizmet veya yasa dışı satış ilanları kaldırılır.
- Uygulama içinde ödeme altyapısı etkinleştirilmediği sürece Trabzone ödeme almaz, ödeme aracılığı yapmaz ve kargo süreçlerinin tarafı değildir. Sipariş talepleri alıcı ile satıcı arasında iletişim kurulmasını sağlar.
- Ödeme altyapısı ileride etkinleştirilirse, ödeme, iade ve uyuşmazlık süreçleri ayrıca duyurulur ve ilgili mevzuata uygun hale getirilir.
- Taraflar arasında doğan uyuşmazlıklarda Trabzone yalnızca kendi topluluk kuralları kapsamında işlem yapar; ticari uyuşmazlığın tarafı değildir.

## 5. Hizmetin kullanımı ve teknik sınırlar

- Uygulamayı tersine mühendislik yapmak, otomatik veri çekmek veya güvenlik önlemlerini aşmak amacıyla kullanamazsınız.
- Hizmet kesintisiz olmayabilir; bakım, güvenlik veya altyapı kaynaklı kesintiler yaşanabilir.
- Ücretsiz özelliklerin kapsamını, limitlerini veya sunum biçimini değiştirme hakkımız saklıdır.

## 6. Fikri mülkiyet

Trabzone adı, logosu, arayüz tasarımı ve yazılımı Trabzone''a aittir. Bu koşullar size marka ve yazılım üzerinde mülkiyet hakkı vermez.

## 7. Hesabın askıya alınması ve silinmesi

- Koşulları ihlal etmeniz halinde hesabınız uyarı almadan kısıtlanabilir veya kapatılabilir.
- Hesabınızı uygulama içindeki ayarlardan silebilirsiniz. Silme işlemi geri alınamaz.
- Hesap silindiğinde profil, gönderi, hikâye, mesaj ve ilan gibi kullanıcı içerikleri hizmetten kaldırılır.

## 8. Sorumluluğun sınırlandırılması

Hizmet "olduğu gibi" sunulur. Yürürlükteki hukukun izin verdiği ölçüde; dolaylı zararlar, veri kaybı, kâr kaybı ve üçüncü kişilerin davranışlarından doğan zararlar için sorumluluk kabul etmeyiz. Bu hüküm, tüketici mevzuatından doğan ve sözleşmeyle sınırlandırılamayan haklarınızı etkilemez.

## 9. Değişiklikler

Koşullar güncellenebilir. Önemli değişikliklerde uygulama içinde bildirim yapılır ve yeni sürümün yürürlük tarihi bu sayfada yayımlanır. Değişiklikten sonra uygulamayı kullanmaya devam etmeniz güncel koşulları kabul ettiğiniz anlamına gelir.

## 10. İletişim

Sorularınız için uygulama içindeki Yardım ve Destek ekranını kullanabilir veya support@litxtech.com adresine yazabilirsiniz.
$terms$,
    true,
    '2026-10-27 00:00:00+00',
    now()
  ),
  (
    'privacy',
    1,
    'Gizlilik Politikası',
    'Trabzone''un hangi verileri topladığı, neden işlediği, kimlerle paylaştığı ve haklarınızı nasıl kullanabileceğiniz.',
    $privacy$
# Trabzone Gizlilik Politikası

Bu politika, Trabzone uygulamasında kişisel verilerin nasıl toplandığını, kullanıldığını, saklandığını ve korunduğunu açıklar. Veri sorumlusu Trabzone''dur. Politika 6698 sayılı KVKK ve uygulanabilir olduğu ölçüde GDPR ilkeleri esas alınarak hazırlanmıştır.

## 1. Topladığımız veriler

- Hesap verileri: ad, soyad, kullanıcı adı, e-posta adresi, şifre özeti (yalnızca doğrulama için, düz metin olarak saklanmaz), hesap oluşturma tarihi.
- Profil verileri: profil fotoğrafı, kapak fotoğrafı, biyografi, şehir, ilgi alanları ve gizlilik tercihleri.
- İçerik verileri: gönderiler, gönderi medyası, yorumlar, beğeniler, kaydedilen gönderiler, hikâyeler ve hikâye görüntüleme kayıtları.
- Mesajlaşma verileri: sohbet katılımcıları, mesaj içeriği, eklentiler, gönderim/okunma durumları ve arama sinyalleri (arama başlatma, kabul, reddetme, bitiş).
- Sosyal grafik verileri: takip ilişkileri, engelleme listeleri ve gizlilik kapsamındaki görünürlük bilgileri.
- Marketplace verileri: ilanlar, ilan görselleri, favoriler, sipariş talepleri, sipariş durumu ve satıcı değerlendirmeleri.
- Destek ve güvenlik verileri: destek talepleri, ekleri, bildirimler (şikâyetler), moderasyon kararları ve denetim kayıtları.
- Teknik veriler: oturum belirteçleri, cihaz/uygulama sürümü, hata ve güvenlik günlükleri.

Uygulama; konum izni vermediğiniz sürece kesin konumunuzu toplamaz. "Yakınımda" filtresi izin verilmediğinde şehir bilgisiyle çalışır. Kamera, mikrofon ve fotoğraf erişimi yalnızca ilgili özelliği kullandığınızda ve izninizle istenir.

## 2. Verileri işleme amaçları

- Hesabınızı oluşturmak, oturumunuzu yönetmek ve kimliğinizi doğrulamak.
- Akış, keşfet, mesajlaşma ve Marketplace özelliklerini sunmak.
- Bildirimleri iletmek ve sizi ilgilendiren etkileşimleri göstermek.
- Topluluk kurallarını uygulamak, şikâyetleri incelemek ve güvenliği sağlamak.
- Kötüye kullanım, spam ve dolandırıcılığı tespit etmek.
- Yasal yükümlülükleri yerine getirmek ve uyuşmazlıkları çözmek.

İşleme; sözleşmenin ifası, hukuki yükümlülük, meşru menfaat ve gerektiğinde açık rıza hukuki sebeplerine dayanır.

## 3. Verilerin paylaşılması

Kişisel verilerinizi reklam amacıyla üçüncü taraflara satmayız. Veriler yalnızca aşağıdaki durumlarda paylaşılır:

- Hizmeti çalıştıran altyapı sağlayıcıları (veritabanı, kimlik doğrulama ve dosya depolama hizmeti). Bu sağlayıcılar verilere yalnızca hizmetin gerektirdiği ölçüde erişir.
- Yasal olarak yetkili kamu kurumlarından gelen usulüne uygun talepler.
- Hesap sahibinin açık onayıyla yapılan paylaşımlar (örn. gönderiyi paylaşma veya Marketplace ilanı üzerinden iletişim).
- Birleşme, devir veya yeniden yapılanma halinde, gizlilik yükümlülükleri korunmak kaydıyla.

Sesli/görüntülü arama medya akışı, ancak ilgili altyapı yapılandırıldığında etkinleşir. Bu durumda medya akışı uçtan uca şifreli bir RTC sağlayıcısı üzerinden iletilir ve kayıt altına alınmaz.

## 4. Saklama süreleri

- Hesap ve profil verileri, hesabınız açık olduğu sürece saklanır.
- Hesap silindiğinde profil ve kullanıcı içerikleri hizmetten kaldırılır; yedeklerden silinmesi makul teknik süre alabilir.
- Destek, şikâyet, moderasyon ve denetim kayıtları; güvenlik ve yasal yükümlülükler için gerekli süre boyunca sınırlı olarak saklanır.
- Yasal saklama yükümlülüğü bulunan kayıtlar ilgili mevzuatta öngörülen süreyle tutulur.

## 5. Haklarınız

KVKK kapsamında:

- Kişisel verilerinizin işlenip işlenmediğini öğrenme.
- İşlenmişse buna ilişkin bilgi talep etme.
- İşleme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme.
- Eksik veya yanlış işlenmiş verilerin düzeltilmesini isteme.
- Silinmesini veya yok edilmesini isteme.
- Aktarıldığı üçüncü kişileri öğrenme.
- Otomatik sistemlerle analiz sonucu aleyhinize çıkan sonuca itiraz etme.
- Zararın giderilmesini talep etme.

Talepleriniz için uygulama içindeki Yardım ve Destek ekranını kullanabilir veya support@litxtech.com adresine yazabilirsiniz. Talepler en geç 30 gün içinde yanıtlanır. Profil bilgilerinizin önemli bir kısmını uygulama içindeki profil düzenleme ekranından doğrudan güncelleyebilirsiniz.

## 6. Çocukların gizliliği

13 yaşından küçük çocuklardan bilerek veri toplamayız. Böyle bir hesap tespit edilirse hesap kapatılır ve ilgili veriler silinir. 18 yaşından küçük kullanıcılar için daha kapalı gizlilik varsayılanları uygulanır; mesajlaşma ve görünürlük ayarları yaş grubuna göre sınırlandırılır. Çocuk güvenliği endişeleri ayrı ve öncelikli bir kuyrukta incelenir.

## 7. Veri güvenliği

- Verilere erişim, satır düzeyi güvenlik (RLS) politikalarıyla kullanıcı bazında sınırlandırılır.
- Hassas işlemler yalnızca sunucu tarafındaki yetki kontrollerinden geçen fonksiyonlarla yapılır.
- Mesajlar yalnızca sohbet katılımcıları tarafından okunabilir.
- Dosya erişimi; dosya türü, boyutu ve sahipliği doğrulandıktan sonra verilir.
- Yönetici işlemleri denetim kaydına yazılır.
- Şifreler düz metin olarak saklanmaz.

Hiçbir sistem mutlak güvenlik garantisi vermez. Yetkisiz erişim şüphesinde hesabınızın şifresini değiştirip bize bildirmenizi öneririz.

## 8. Politika değişiklikleri

Bu politika güncellendiğinde sürüm numarası ve yürürlük tarihi bu sayfada yayımlanır. Önemli değişikliklerde uygulama içinde bildirim yapılır.

## 9. İletişim

Gizlilikle ilgili sorular için: support@litxtech.com
$privacy$,
    true,
    '2026-10-27 00:00:00+00',
    now()
  )
on conflict (slug, version) do nothing;
