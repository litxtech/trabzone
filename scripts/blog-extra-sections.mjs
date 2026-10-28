// Blog yazılarını derinleştiren ek bölümler.
//
// `blog-seed-data.mjs` bu bölümleri her yazının "Sık sorulan sorular"
// başlığından hemen önce gövdesine ekler. Böylece içerik hem daha uzun hem
// de arama niyetine daha kapsamlı cevap verir. Yeni bir yazı eklerken burada
// karşılık gelen bir anahtar olmak zorunda değildir.

export const BLOG_EXTRA_SECTIONS = {
  'trabzon-2-gunde-ne-yapilir': `
## Bütçe, konaklama ve mevsim alternatifi

İki günlük bir Trabzon planında bütçenin büyük kısmını ulaşım ve konaklama belirler. Merkezde kalmak, Sümela ve Uzungöl'e göre günlük hayata daha yakın bir deneyim sunar; buna karşılık yaylada konaklamak doğayı sabahın erken saatlerinde görme şansı verir. Aynı tatilde bir gece merkez, bir gece Uzungöl çevresi şeklinde bölünmüş konaklama, iki farklı Trabzon'u görmek isteyenler için mantıklı bir denge.

Bütçe kalemlerini planlarken şu sırayı izleyin:

- **Ulaşım:** Havalimanı-transfer, günlük dolmuş ve gerekiyorsa kiralık araç. Sümela ve Uzungöl gibi noktalarda toplu taşıma saatleri sınırlı olduğu için dönüş saatini önceden netleştirin.
- **Konaklama:** Merkezde iki kişilik odalar, yaylada ahşap bungalovlar ve apart seçenekleri farklı fiyat aralıklarında. Bayram ve yaz hafta sonlarında fiyatlar belirgin şekilde yükselir.
- **Yemek:** Günde iki ana öğün ve bir çay molası gerçekçi bir varsayım. Turistik sahil noktaları yerine ara sokak esnaf lokantaları bütçeyi rahatlatır.
- **Giriş ücretleri:** Müze ve ören yerlerinin ücretleri yıla göre değişir; sabit bir rakam yazmak yerine güncel bilgiyi ziyaretten önce kontrol edin.

## Yağmur planı

Trabzon'da yağmur, tatilin iptal sebebi değil; planın bir parçası. İki günlük rotanın esnek olması için açık hava duraklarını sabaha, kapalı mekânları öğleden sonraya yerleştirin. Sümela yolu olumsuz hava koşullarında kapanabilir; bu durumda Maçka çevresinde kısa yürüyüşler, Ortahisar'da Bedesten ve çarşı, kahve molaları ve sahil hattı iyi bir yedek program oluşturur.

Yağmurlu günde ayakkabı seçimi, şemsiyeden daha önemli. Islak taş merdivenler ve toprak yayla yolları kaygan olur; tabanı dişli, su geçirmez ayakkabı hem güvenlik hem konfor sağlar.

## İki gün yetmezse

Üçüncü gün eklemek isterseniz rotayı doğuya doğru genişletmek yerine tek bir bölgede derinleşmek daha verimli. Örneğin üçüncü günü yalnızca Uzungöl ve çevresindeki yayla yürüyüşlerine ayırmak, yol yerine doğada zaman geçirmenizi sağlar. Alternatif olarak Maçka, Altındere ve Sümela hattını sakin bir tempoda gezmek; hem tarih hem doğa isteyenler için dengeli bir final olur.

## Sık sorulan sorular`,

  'uzungol-gezi-rehberi-mevsimler-ulasim-konaklama': `
## Uzungöl'de yürüyüş ve fotoğraf

Uzungöl'ün merkez gölü kısa bir turla gezilir; asıl deneyim çevredeki yürüyüş yollarında başlar. Göl çevresindeki düzenli parkur, sabah erken saatlerde sakin olur. Daha uzun yürümek isteyenler için çevre köylere ve yaylalara giden toprak yollar var; bu yollarda patika durumu mevsime göre değişebilir.

Fotoğraf için en verimli zamanlar sabahın ilk ışıkları ve gün batımına yakın saatler. Göl yüzeyi rüzgârsız sabahlarda daha net yansıma verir. Öğle saatlerinde kontrast sertleşir; bu saatleri gölge, ahşap ev detayları ve orman içi kareler için kullanabilirsiniz.

- **Sabah:** Sis ve yansıma için göl kıyısı; kalabalıktan önce yürüyüş.
- **Öğle:** Gölge ve detay fotoğrafçılığı; kafe molası.
- **Akşam:** Dağ silüeti ve sıcak ışık; dönüş yolunu hava kararmadan planlayın.

## Kalabalık ve sürdürülebilirlik

Uzungöl, yaz aylarında ve hafta sonlarında yoğunlaşan bir destinasyon. Kalabalıktan kaçınmak için hafta içi, sabah erken saatler ve bayram dışı dönemler daha rahat. Göl kıyısında çöp bırakmamak, yüksek sesle müzik çalmamak ve yerel işletmelerin su kaynağını gereksiz tüketmemek, bölgenin asıl değerini korur.

Konaklama seçerken göl manzarası kadar ısıtma, nem ve ulaşım koşullarına bakın. Ahşap yapılar güzel ama kışın yalıtım farkı büyük olabilir. Otoparkı olan tesisler, araçla gelenler için ciddi bir avantaj.

## Dönüş planı

Uzungöl'den Trabzon merkezine dönüş, tek bir yol üzerinden yapılır. Pazar günleri ve tatil dönüşlerinde trafik artabilir. Dönüş saatini hava kararmadan önceye almak, hem yol güvenliği hem de manzara açısından avantaj sağlar. Dolmuşla dönecekseniz son sefer saatini sabahleyin teyit edin; akşam saatlerinde araç bulmak zorlaşabilir.

## Sık sorulan sorular`,

  'sumela-manastiri-ziyaret-rehberi': `
## Ziyaret görgü kuralları ve inanç turizmi

Sümela Manastırı yalnızca bir fotoğraf noktası değil; yüzyıllardır süren bir inanç ve kültür mirası. Ziyaret sırasında sessizliği korumak, ibadet edenlere ve rehberli gruplara alan bırakmak, duvarlara ve fresklere dokunmamak temel nezaket kuralları. Kıyafet konusunda omuz ve dizleri örten rahat kıyafetler hem saygı hem de dağ havasına uyum açısından pratiktir.

Manastırın bulunduğu yamaçta zemin engebeli ve merdivenler dik. Yaşlılar, küçük çocuklar ve hareket kısıtı olan ziyaretçiler için tempoyu düşürmek, gerekiyorsa seyir teraslarında mola vermek gerekir. Fotoğraf çekerken yürüyüş yolunu kapatmamaya özen gösterin.

## Maçka ve Altındere çevresi

Sümela'ya giden yol, Maçka ilçesinden geçer. Zamanınız varsa Maçka merkezinde kısa bir mola verip yerel kahvaltı ve yöresel ürünlere bakabilirsiniz. Altındere Vadisi, manastır dışında da yürüyüş ve doğa gözlemi için uygun; ancak patika koşulları mevsime göre değişir.

- **Kısa program:** Maçka–Altındere–Sümela; yarım gün.
- **Rahat program:** Maçka'da kahvaltı, vadide kısa yürüyüş, manastır ziyareti; tam gün.
- **Yağmurlu program:** Manastır ziyaretini kısa tutup Maçka'da kapalı mekân molası.

## Sümela sonrası dönüş

Dönüşte sahile inmek yerine Maçka üzerinden Trabzon merkezine gitmek genellikle daha öngörülebilir. Hafta sonu ve yaz aylarında yol kalabalık olabilir; yakıt ve mola planını buna göre yapın. Toplu taşımayla geldiyseniz dönüş saatlerini önceden öğrenin; manastır çevresinde taksi bulmak her zaman mümkün olmayabilir.

Manastırın açılış saatleri ve ziyaret koşulları dönemsel olarak değişebiliyor. Yola çıkmadan önce resmî duyuruları kontrol etmek, boş bir kapıyla karşılaşma riskini azaltır.

## Sık sorulan sorular`,

  'trabzon-yaylalari-rehberi': `
## Yaylada gece ve konaklama

Yayla gezisini günübirlik yapmak mümkün olsa da asıl fark, geceyi yaylada geçirmekte. Akşam serinliği, yıldızlar ve sabah sisi şehirde bulunmayan bir deneyim sunar. Ancak konaklama seçenekleri sınırlı ve konfor beklentisi şehir otellerinden farklı. Battaniye, ısıtma ve sıcak su koşullarını önceden sorun.

Yayla evlerinde nem ve gece soğuğu belirgin olur. Kat kat giyinmek, yedek çorap ve küçük bir el feneri bulundurmak işe yarar. Elektrik kesintisi olabileceğini hesaba katın; powerbank ve nakit para yanınızda olsun.

## Hava, giyim ve güvenlik

Yaylada hava, sahile göre çok daha hızlı değişir. Güneşli başlayan gün öğleden sonra sis ve yağmura dönebilir. Yağmurluk, rüzgâr kesici ve kaymayan ayakkabı temel ekipman. Sis bastığında patikadan çıkmayın; görüş düşükken kestirme yollar tehlikeli olabilir.

- Yola çıkmadan hava durumunu ve yol durumunu kontrol edin.
- Telefon çekmeyen bölgeler için önceden rota paylaşın.
- Hayvan otlatılan alanlarda çitlere ve köpeklere dikkat edin.
- Çöpünüzü yanınızda götürün; yaylada düzenli toplama hizmeti olmayabilir.

## Doğa koruma ve yerel yaşam

Yaylalar, yılın büyük bölümünde yerel üreticilerin çalışma alanı. Özel mülk, ekili arazi ve hayvan barınaklarına izinsiz girmeyin. Yerel ürün satın almak, bölge ekonomisine doğrudan katkı sağlar; ancak pazarlıkta ölçülü olun. Fotoğraf için insanları ve hayvanları rahatsız etmeyin.

Yayla şenlikleri döneminde kalabalık ve trafik artar. Konaklama ve ulaşımı erken planlamak, şenlik deneyimini daha keyifli hale getirir.

## Sık sorulan sorular`,

  'trabzon-kahvaltisi-kuymak-rehberi': `
## Evde kuymak: malzeme ve kıvam

Kuymak, malzemesi az ama tekniği belirleyici bir yemek. Temel malzemeler tereyağı, mısır unu ve peynir. Peynir seçimi, tuz dengesini doğrudan etkiler; çok tuzlu bir peynir kullanıyorsanız ek tuz eklemeyin. Mısır ununu azar azar ekleyip sürekli karıştırmak topaklanmayı önler.

Kıvam için şu sırayı deneyin:

1. Tereyağını düşük ateşte eritin; yanmasına izin vermeyin.
2. Mısır ununu ekleyip kokusu çıkana kadar kavurun.
3. Su veya sütü kontrollü ekleyin; sürekli karıştırın.
4. Peyniri ekleyip kıvam alana kadar karıştırın.
5. Ocaktan aldıktan sonra kısa süre dinlendirin; kuymak toparlanır.

Kuymak soğudukça sertleşir. Servisi sıcak yapın; artan kısmı tekrar ısıtırken az miktarda su veya süt eklemek kıvamı düzeltir.

## Kahvaltı sonrası kısa rota

Ağır bir Trabzon kahvaltısı sonrası hemen uzun bir yürüyüşe çıkmak yerine hafif bir başlangıç iyi olur. Meydan'dan sahil hattına inmek, Ganita çevresinde yürümek ve ardından Ortahisar'ın ara sokaklarına geçmek dengeli bir program. Kahvaltıyı geç yaptıysanız öğle yemeğini hafif tutun.

## Çay ve servis kültürü

Trabzon'da çay, kahvaltının ayrılmaz parçası. İnce belli bardakta sıcak çay servisi yaygın; ikram edilen çayı reddetmek yerine az içmek daha nazik bir tercih. Bazı kahvaltı salonlarında sabit menü, bazılarında açık büfe uygulanır. Menüyü ve fiyatı girmeden önce sormak, sürprizleri önler.

## Sık sorulan sorular`,

  'trabzon-hamsi-kulturu-hamsili-pilav': `
## Hamsili pilavda kıvam ve sıralama

Hamsili pilav, hamsinin tuzu ve kokusuyla pirincin dengesine dayanır. Pirinci önceden yıkayıp nişastasını almak, tane tane bir sonuç için önemli. Hamsileri temizleyip suyunu iyice kurulayın; ıslak balık, pilava fazla nem verir. Tuzda bekletme süresi balığın boyuna göre değişir; aşırı tuz pilavı kurtarmak zorlaşır.

Katmanlama sırasında pirinci çok sıkıştırmayın. Üzerine ağırlık koyup kısık ateşte pişirmek, pilavın dağılmadan toparlanmasını sağlar. Piştikten sonra 10-15 dakika dinlendirin; servis sırasında dağılma azalır.

## Mevsim ve sürdürülebilirlik

Hamsi, Karadeniz'in mevsimsel balığı. Sonbahar ve kış aylarında daha yağlı ve lezzetli olur; yaz aylarında bulmak ve aynı lezzeti yakalamak zorlaşır. Küçük boy balıkların avlanması ve satışıyla ilgili kurallar bölgeden bölgeye değişebilir; satın alırken boyut ve tazelik kontrolü yapın.

- Gözleri berrak, solungaçları kırmızı, vücudu diri olan balığı seçin.
- Ağır balık kokusu tazelik kaybına işaret eder.
- Aşırı küçük balıkları almamak, stokların sürekliliği için önemli.

## Hamsi alırken ve saklarken

Hamsiyi aldıktan sonra mümkünse aynı gün temizleyip pişirin. Bekletecekseniz temizleyip kurulayın, buzdolabında kapalı kapta kısa süre saklayın. Dondurucuya koyacaksanız porsiyonlayın; çözündükten sonra tekrar dondurmayın. Yerel pazarlarda fiyat ve tazelik farkı büyük olabilir; acele etmeden bakın.

## Sık sorulan sorular`,

  'trabzon-kahve-mekanlari-rehberi': `
## Çalışma için kahve seçimi

Trabzon'da kahve mekânı seçerken yalnızca atmosfere değil, priz, internet ve masa düzenine bakın. Meydan çevresindeki kafeler ulaşım açısından pratik; Ortahisar'ın ara sokakları daha sakin. Sabah saatlerinde daha geniş masa bulmak kolay, öğleden sonra kalabalık artar.

Uzun süre kalacaksanız siparişinizi belirli aralıklarla yenilemek ve yoğun saatlerde masayı uzun süre tutmamak, hem işletme hem diğer müşteriler için nezaket. Gürültü seviyesi toplantı için uygun değilse kulaklık ve kısa görüşmelerle idare edin.

## Yerel ritim ve akşam

Trabzon'da kahve kültürü, çay kültürüyle iç içe. Sabah işe gidenlerin kısa kahve molası, öğleden sonra öğrenci ve serbest çalışanların daha uzun oturması, akşam ise sahil hattında yürüyüş öncesi kısa bir mola şeklinde ilerliyor. Akşam saatlerinde sahildeki mekânlar daha canlı; sakin bir çalışma ortamı arıyorsanız merkezdeki ara sokakları deneyin.

## Bütçe ve pratiklik

Fiyatlar mekâna ve semte göre değişir. Turistik sahil hattında fiyatlar daha yüksek olabilir; birkaç sokak içeride benzer kalitede daha uygun seçenekler bulunur. Nakit ve kart kabulü konusunda girmeden önce kontrol etmek, küçük işletmelerde işe yarar. Otopark sorunu olan bölgelerde toplu taşıma veya yürüyüş daha pratik.

## Sık sorulan sorular`,

  'ortahisar-gezilecek-yerler': `
## Müzeler ve sanat durakları

Ortahisar rotasını müzelerle zenginleştirmek için günün ortasında bir kapalı mekân molası planlayın. Trabzon Müzesi ve çevredeki tarihî yapılar, şehrin çok katmanlı geçmişini anlamak için iyi bir başlangıç. Giriş saatleri ve ücretler dönemsel olarak değişebiliyor; ziyaretten önce güncel bilgiyi kontrol edin.

Sanat galerileri ve küçük sergi alanları çoğu zaman yerel sanatçıların işlerine ev sahipliği yapar. Çarşı içinde rastlayabileceğiniz atölyelerde bakır işçiliği ve el sanatları süreçlerini görmek, alışverişten daha kalıcı bir deneyim bırakır.

## Akşam yürüyüşü

Gün batımına doğru sahil hattına inmek, Ortahisar'ın tarihî dokusundan modern şehir hayatına geçiş yapmak gibi. Ganita çevresinde yürüyüş, deniz havası ve açık alan sunar. Yaz aylarında kalabalık, kışın rüzgâr belirgin; buna göre giyinin. Akşam yemeği için sahil yerine ara sokaklardaki esnaf lokantalarını denemek, hem daha sakin hem daha uygun olabilir.

## Çocuklu ve hareket kısıtlı ziyaret

Kale çevresi ve eski çarşı sokaklarında kaldırımlar dar, zemin engebeli. Bebek arabasıyla gezmek zorlaşabilir; taşıyıcı ya da kanguru daha pratik. Hareket kısıtı olan ziyaretçiler için sahil hattı ve Meydan çevresi daha erişilebilir. Merdivenli noktalarda mola verecek gölge alanları önceden belirleyin.

## Sık sorulan sorular`,

  'akcaabat-kofte-ve-sahil-rehberi': `
## Köfte dışında Akçaabat

Akçaabat denince akla köfte geliyor; ancak ilçede farklı lezzetler de var. Sahil boyunca uzanan balıkçı lokantaları, mevsimine göre hamsi ve yerel balık çeşitleri sunar. Merkezdeki fırınlarda taze ekmek ve yöresel hamur işleri bulunur. Kahvaltı için muhlama ve çay kombinasyonu, güne iyi bir başlangıç.

Köfte sipariş ederken porsiyon ve yanında gelenleri sormak, gereksiz kalabalık sofrayı önler. Öğle saatlerinde yerel esnafın yoğun olduğu yerler genelde daha taze ve hızlı hizmet verir.

## Sahil ve gün batımı

Akçaabat sahil hattı, yürüyüş ve bisiklet için uygun. Gün batımı saatlerinde deniz manzarası belirginleşir; fotoğraf için ışık güzel ama rüzgâr da artabilir. Sahil parklarında oturup çay içmek, şehir merkezinden gelenler için kısa bir kaçamak etkisi yaratır.

## Ulaşım ve dönüş

Trabzon merkezinden Akçaabat'a dolmuş ve otobüsle gitmek kolay; sahil yolu üzerindeki durakları kullanabilirsiniz. Akşam dönüşünde son dolmuş saatini teyit edin. Araçla gelenler için sahil çevresinde otopark bulmak yaz aylarında zorlaşabilir; biraz içerideki sokakları deneyin.

## Sık sorulan sorular`,

  'trabzon-toplu-tasima-ve-ulasim-rehberi': `
## Kart, bilet ve ücretler

Trabzon'da toplu taşımada ödeme yöntemi ve ücretler dönemsel olarak değişebiliyor. Dolmuşlarda nakit, bazı hatlarda kart kullanımı yaygın; yine de yanınızda küçük banknot bulundurmak işe yarar. Öğrenci ve indirimli tarifeler için geçerli kimlik koşullarını önceden öğrenin.

Bilet veya kart uygulaması şehirden şehre farklılık gösterdiği için internetten yapılan yorumlara değil, durakta ve araçta yazan güncel bilgiye güvenin.

## Gece ve hafta sonu

Gece saatlerinde toplu taşıma sıklığı azalır. Havalimanına veya otogara gece gidecekseniz taksi alternatifini önceden planlayın. Hafta sonu ve bayramlarda sahile giden hatlar kalabalık olabilir; kalabalık saatlerden kaçınmak için sabah erken veya akşamüstü geç saatleri seçin.

## Dolmuş adabı ve pratik bilgiler

Dolmuşlar genelde belirli güzergâhlarda çalışır; binmeden önce gideceğiniz yeri söyleyip teyit edin. İneceğiniz durağı şoföre erken bildirmek, gereksiz gecikmeyi önler. Yoğun saatlerde ayakta yolculuk olabilir; alışveriş poşetleri ve bagaj için yer planlayın.

- Havalimanı–merkez hattında trafik yoğunluğunu hesaba katın.
- Otogar ve terminal bağlantılarında aktarma noktalarını önceden öğrenin.
- Kısa mesafelerde yürüyüş, dolmuştan daha hızlı olabilir.

## Sık sorulan sorular`,

  'trabzon-havalimani-sehir-merkezi-ulasim': `
## Gece varışı ve ilk 60 dakika

Gece geç saatte Trabzon Havalimanı'na iniyorsanız önce bagajınızı alın, ardından taksi ve toplu taşıma seçeneklerini değerlendirin. Toplu taşıma saatleri gece boyunca sınırlı olduğu için taksi veya önceden ayarlanmış transfer daha güvenli olabilir. Taksiye binmeden önce tahmini ücreti ve ödeme yöntemini konuşun.

Havalimanı çıkışında kart, nakit ve iletişim ihtiyaçlarınızı kontrol edin. Telefon şarjı düşükse terminalde kısa bir mola vermek, yola çıkmadan önce işinizi kolaylaştırır.

## Bagaj ve bekleme

Uçuş sonrası bagaj alanı ve çıkış kapısı kalabalık olabilir. Büyük bagajla toplu taşıma kullanacaksanız yoğun saatleri atlamak rahatlık sağlar. Havalimanında beklemeniz gerekiyorsa kafe ve oturma alanlarını kullanabilir, dışarı çıkmadan önce hava durumunu kontrol edebilirsiniz.

## Havalimanından doğrudan çevreye

Merkeze uğramadan doğrudan Akçaabat, Yomra veya Maçka yönüne gitmek mümkün; ancak aktarma sayısı ve süre artar. Bu durumda kiralık araç veya transfer daha verimli olabilir. Dönüş uçuşunuz sabah erken saatteyse bir gece önceden havalimanına yakın konaklamak, trafik riskini azaltır.

## Sık sorulan sorular`,

  'trabzon-kiralik-daire-rehberi': `
## Sözleşmede bakılacak maddeler

Kiralık daire sözleşmesi imzalamadan önce yalnızca aylık kira değil, tüm yükümlülükleri okuyun. Depozito miktarı, ne zaman ve hangi koşullarda iade edileceği, aidat, yakıt ve demirbaş sorumluluğu açıkça yazılı olmalı. Sözlü vaatler yerine sözleşmeye ek madde koymak, ileride yaşanabilecek anlaşmazlıkları azaltır.

- Kira artışının hangi endekse göre yapılacağı.
- Depozitonun hangi hesaba ve ne zaman yatırılacağı.
- Eşyalı dairede demirbaş listesi ve hasar sorumluluğu.
- Aidat, ısınma ve ortak giderlerin kimin ödeyeceği.
- Erken tahliye ve sözleşme feshi koşulları.

## Eşyalı mı eşyasız mı

Eşyalı daireler kısa süreli taşınanlar için pratik; ancak depozito ve hasar riski daha yüksek. Eşyasız dairede mobilya maliyeti ve taşıma süresi hesaplanmalı. Kiralarken beyaz eşyanın çalışır durumda olduğunu denenmiş görmek, sonradan çıkacak masrafları önler.

## Komşuluk ve apartman yaşamı

Trabzon'da apartman yaşamı yaygın; ses, otopark ve ortak alan kullanımı konusunda komşuluk ilişkileri önemli. Taşınmadan önce binanın yönetim kurallarını, otopark düzenini ve ısıtma sistemini sorun. Merkezde park sorunu, yeni binalarda aidat yüksekliği sık karşılaşılan konular.

## Sık sorulan sorular`,

  'trabzon-ev-satin-alma-rehberi': `
## Tapu ve imar kontrolü

Ev satın alırken tapu kaydı, imar durumu ve yapı ruhsatı ayrı ayrı kontrol edilmeli. Tapuda ipotek, haciz veya intifa hakkı olup olmadığını öğrenin. İmar durumu, gelecekte komşu parsellerde yapılabilecekleri ve mevcut yapının ruhsatla uyumunu gösterir. Kat mülkiyeti kurulmuş mu, ortak alanlar tapuda nasıl tanımlanmış, bunları netleştirin.

Eski binalarda ruhsat ve iskân durumu ayrıca önemli. İskânı olmayan yapıların kredi ve sigorta süreçlerinde sorun çıkabileceğini unutmayın.

## Kredi, ekspertiz ve gizli maliyetler

Konut kredisi kullanacaksanız bankanın ekspertiz değeri ile satış fiyatı arasındaki farkı önceden hesaplayın. Peşinat, tapu harcı, döner sermaye, sigorta ve taşınma masrafları toplam bütçenin önemli bir kısmını oluşturur. Aidat borcu, vergi borcu ve elektrik-su abonelik borçları için satıcıdan yazılı bilgi isteyin.

## Eski bina riskleri

Trabzon'da nem, yağış ve eğimli arazi, bina yapısını etkileyen faktörler. Bodrum katlarda su alma, çatı yalıtımı, dış cephe çatlakları ve istinat duvarı durumu kontrol edilmeli. Deprem yönetmeliğine uygunluk ve zemin etüdü bilgisi, özellikle eski yapılarda önemli. Gerekirse bağımsız bir inşaat mühendisinden görüş alın.

## Sık sorulan sorular`,

  'ktu-ogrenci-yasami-trabzon': `
## Aylık bütçe tablosu

Öğrenci bütçesi, konaklama tercihine göre büyük ölçüde değişir. Yurt, öğrenci evi ve aile yanı konaklama farklı sabit giderler yaratır. Aşağıdaki kalemleri kendi durumunuza göre doldurun:

- **Konaklama:** Yurt aidatı veya kira + aidat.
- **Ulaşım:** Kampüs–şehir merkezi arası günlük veya haftalık yolculuk.
- **Yemek:** Kampüs yemekhanesi, evde yemek ve dışarıda yeme dengesi.
- **İnternet ve telefon:** Sabit internet, mobil hat ve abonelikler.
- **Kitap, kırtasiye ve dijital araçlar:** Dönem başında artan giderler.
- **Sosyal ve kişisel:** Kahve, sinema, spor ve küçük acil durum payı.

Bütçeyi aylık değil dönemlik planlamak, dönem başındaki toplu harcamaları görmeyi kolaylaştırır.

## Kampüs dışı sosyal hayat

KTÜ çevresi öğrenci nüfusuyla canlı; ancak şehir merkezi ve sahil hattı farklı bir deneyim sunar. Hafta içi kampüs, hafta sonu Ortahisar ve sahil dengeli bir rutin oluşturabilir. Öğrenci kulüpleri, spor tesisleri ve kütüphane, sosyal çevre kurmanın en kolay yolları.

## İlk hafta kontrol listesi

Kayıt ve ders seçimi dışında banka hesabı, ulaşım kartı, yurt yerleşimi ve sağlık hizmetlerine erişim ilk haftanın işleri. Kampüs içi yönlendirmeleri takip edin, danışmanınızla tanışın ve ders programınızı oturtun. Şehirde alışveriş için merkezdeki semt pazarlarını ve zincir marketleri karşılaştırın.

## Sık sorulan sorular`,

  'trabzon-is-kurma-rehberi': `
## Yerel tedarik ve ortaklık

Trabzon'da iş kurarken yerel tedarik ağı kurmak, hem maliyet hem güven açısından avantaj. Üretici, toptancı ve lojistik sağlayıcılarla yüz yüze görüşmek, küçük hacimli işletmelerde esneklik sağlar. Ortaklık kuracaksanız sermaye, emek ve kar paylaşımını yazılı hale getirin; sözlü anlaşmalar kısa sürede sorun üretebilir.

## Fiyatlandırma ve nakit akışı

Fiyatı belirlerken yalnızca malzeme maliyetini değil; kira, personel, elektrik, muhasebe, pazarlama ve kendinize ayırdığınız emeği de hesaba katın. Küçük işletmelerde sık yapılan hata, ilk müşteriyi kazanmak için fiyatı çok düşük tutup sonra zam yapmakta zorlanmaktır. Başlangıçta indirim yerine paket veya ek hizmet sunmak, fiyat algısını korur.

Nakit akışını haftalık takip edin. Tahsilat süresi uzun müşteriler için vadeli satışta sınır koyun; tedarikçiye ödeme tarihi ile müşteriden tahsilat tarihini eşleştirin. İlk üç ay için en az iki aylık sabit gideri karşılayacak bir yedek fon ayırmak, beklenmeyen duraklamalarda işi ayakta tutar.

## Sık sorulan sorular`,

  'trabzon-uzaktan-calisma-rehberi': `
## İnternet yedeği

Uzaktan çalışan için tek internet hattı yeterli değil. Ev interneti dışında mobil hotspot, ikinci bir operatör veya yakındaki güvenilir bir kafe yedek plan olmalı. Online toplantı öncesinde bağlantıyı test edin; yüksek çözünürlüklü görüntü yerine ses önceliği vermek kesintiyi azaltır.

Elektrik kesintisi ihtimaline karşı dizüstü bilgisayarın şarjını dolu tutun ve powerbank bulundurun. Önemli dosyaları bulutta ve yerel yedekte saklayın.

## Kış aylarında düzen

Trabzon'un kışı yağışlı ve nemli. Evde çalışırken ısıtma, havalandırma ve nem dengesi konforu belirler. Sabah gün ışığından yararlanmak için masayı pencereye yakın kurmak, gün içi ritmi korur. Kısa yürüyüş molaları, kapalı havada odaklanmayı kolaylaştırır.

## Toplantı saatleri ve şehir hayatı

Trabzon, Türkiye saatiyle çalışır; farklı ülkelerle çalışıyorsanız toplantı saatlerini buna göre planlayın. Öğle saatlerinde kafe ve lokantalar kalabalıklaşır; önemli görüşmeleri sabah saatlerine almak daha sakin bir ortam sağlar. Sahil hattı akşam yürüyüşü için iyi bir seçenek.

## Sık sorulan sorular`,

  'trabzon-doga-yuruyusu-rotalari': `
## Parkur seçimi ve harita

Doğa yürüyüşünde en önemli karar, deneyim seviyesine uygun parkur seçimi. Kolay rotalar için işaretli yollar ve kısa mesafeler; orta ve zorlu rotalar için yükseklik kazanımı, zemin ve hava koşulları belirleyici. Yola çıkmadan önce güncel harita, patika durumu ve hava tahminini kontrol edin. Telefon uygulaması faydalı ama pil tüketir; yedek powerbank ve mümkünse basılı harita taşıyın.

## Acil durum çantası

- Su ve yüksek enerjili atıştırmalık.
- Yağmurluk, yedek kat ve ısı yalıtımlı giysi.
- İlk yardım seti, düdük ve el feneri.
- Güneş kremi, şapka ve sinek kovucu.
- Tam şarjlı telefon ve powerbank.

Çantanızı hafif tutun ama suyu eksik etmeyin. Yayla havası serin olsa bile yürüyüş sırasında sıvı kaybı olur.

## Rehber ve izin

Kalabalık gruplarla ve uzun rotalarda yerel rehber kullanmak güvenliği artırır. Özel arazilerden geçen patikalar için izin gerekebilir; tabelalara ve yerel uyarılara uyun. Hayvan otlatılan alanlarda köpek bulunabilir; gruptan ayrılmayın.

## Sık sorulan sorular`,

  'trabzon-aileyle-gezilecek-yerler': `
## Çocukla müze ve doğa

Çocuklu gezilerde tek bir uzun müze yerine kısa duraklar ve aralarda hareket alanı planlamak daha verimli. Ortahisar'daki tarihî noktaları kısa tutup sahil parkında mola vermek, çocuğun enerjisini dengelemenin kolay yolu. Doğa yürüyüşlerinde mesafeyi kısa tutun, patika yerine geniş ve düz yolları seçin.

## Yağmurlu plan B

Trabzon'da yağmur sık; kapalı mekân yedeği olmadan yola çıkmayın. Müze, kütüphane, alışveriş merkezi ve kafe molaları çocuklu aileler için güvenli seçenekler. Yanınıza yedek kıyafet ve küçük bir oyuncak almak, beklemeleri kolaylaştırır.

## Yemek ve mola

Çocuklu aileler için menüde tanıdık seçenekler bulunması önemli. Kuymak, köfte, pilav ve çorba genelde kabul gören lezzetler. Acı ve ağır baharatlı yemekleri denemeyi çocuklara bırakın. Öğün saatlerini çocuğun uyku düzenine göre ayarlamak, günün geri kalanını rahatlatır.

## Bebek ve küçük çocukla lojistik

Bebek arabasıyla Trabzon'un eski sokakları zorlu olabilir; kanguru veya taşıyıcı daha pratik. Yanınıza yedek kıyafet, ıslak mendil, atıştırmalık ve küçük bir oyuncak alın. Uzun yolculuklarda her 1,5-2 saatte mola vermek, hem çocuk hem sürücü için güvenli. Konaklama seçerken asansör, park yeri ve kahvaltı saatleri gibi ayrıntılar günlük konforu belirler.

## Sık sorulan sorular`,

  'trabzon-yagmurlu-gun-rehberi': `
## Kapalı mekân rotası

Yağmurlu günde rotayı kapalı mekânlar etrafında kurun. Ortahisar'da müze ve tarihî yapılar, Meydan çevresinde kafe ve kitapçılar, alışveriş merkezleri ve sahil yakınındaki kapalı alanlar iyi seçenekler. Duraklar arasında uzun yürüyüşler yerine kısa geçişler planlayın; şemsiye ve yağmurluk yanınızda olsun.

## Sıcak içecek ve fotoğraf

Yağmurlu hava, şehir fotoğrafçılığı için ilginç yansımalar ve ıslak taş dokular sunar. Kameranızı ve telefonunuzu sudan koruyun; çekim aralarında silerek lensi temiz tutun. Sıcak bir çay molası, ıslanmanın yorgunluğunu dengeler.

## Güvenlik ve ulaşım

Islak zeminlerde merdiven ve yokuşlarda dikkatli olun. Araç kullanıyorsanız hızı düşürün, takip mesafesini artırın ve ani frenlerden kaçının. Toplu taşımada gecikme olabileceğini hesaba katın; önemli randevular için erken çıkın.

## Yağmurlu günde yemek ve alışveriş

Yağmurlu hava, sıcak bir çorba veya fırından yeni çıkmış ekmekle yapılan basit bir öğün için iyi bahane. Merkezdeki esnaf lokantaları ve pastaneler, turistik noktalara göre daha sakin olabilir. Alışveriş için kapalı çarşı ve mağazaları tercih edin; ıslak poşetleri taşımak zorlaşacağı için ağır alışverişi gün sonuna bırakın.

## Sık sorulan sorular`,

  'trabzon-yoresel-urunler-rehberi': `
## Etiket ve tazelik

Yöresel ürün alırken etiket bilgisi ve tazelik kontrolü önemli. Tereyağı ve peynirde üretim tarihi, saklama koşulu ve içerik listesine bakın. Fındıkta hasat yılı ve kabuk durumu; balda ise menşe ve şeker ilavesi bilgisi ayırt edici. Açıkta satılan ürünlerde hijyen koşullarını gözlemleyin.

## Saklama ve hediye

Tereyağı ve peynir gibi ürünler sıcakta hızla bozulur. Uzun yolculuklarda soğutucu çanta kullanın; uçağa götürecekseniz sıvı ve gıda kurallarını önceden kontrol edin. Hediye paketi yaptırırken ürünün hava almasını engelleyen kapalı ambalajlardan kaçının.

## Doğrudan üretici

Köy pazarları ve üretici stantları, hem taze hem de hikâyesi olan ürün bulmak için iyi adresler. Fiyatı ve menşeyi sormak normal; ancak pazarlıkta ölçülü olun. Üreticinin adını ve iletişimini almak, sonraki alışverişlerde güven oluşturur.

## Sık sorulan sorular`,

  'trabzon-ikinci-el-alisveris-rehberi': `
## Güvenli buluşma ve ödeme

İkinci el alışverişte buluşma yeri ve ödeme yöntemi riski belirler. Kalabalık, aydınlık ve kamusal alanlarda buluşun; mümkünse gündüz saatlerini seçin. Kapora talebine karşı temkinli olun, ürünü görmeden ödeme yapmayın. Kapıda ödeme veya güvenli platform ödeme yöntemleri tercih edilmeli.

## Kategori kontrol listesi

- **Elektronik:** Açılış, şarj, ekran, batarya ve garanti durumu.
- **Mobilya:** Taşıma maliyeti, vida ve yüzey durumu.
- **Bisiklet:** Kadro çatlağı, fren ve vites ayarı.
- **Ev aletleri:** Çalışırken dinleme, filtre ve garanti belgesi.

## Pazarlık ve iletişim

Pazarlık, ikinci el kültürünün parçası; ancak ürünü kötülemek yerine piyasa fiyatını konuşmak daha yapıcı. Satıcıya soruları önceden yazılı sorun, fotoğraf isteyin. Anlaşma sonrası mesajları saklayın.

## Sık sorulan sorular`,

  'trabzon-arac-kiralama-ve-arac-sahibi-olma': `
## Sigorta ve hasar

Araç kiralarken sigorta kapsamını dikkatle okuyun. Temel sigorta, lastik, cam ve alt takım hasarlarını kapsamayabilir. Depozito bloke tutarı, hasar anında izlenecek yol ve yol yardım numarası sözleşmede net olsun. Teslim almadan önce aracın dört tarafını fotoğraflayın; mevcut çizik ve hasarları tutanağa yazdırın.

## Yayla yolları

Yayla yolları dar, eğimli ve virajlı olabilir. Kiralık araçla yüksek yaylalara çıkacaksanız motor hacmi ve fren durumu önemli. Sis, yağmur ve gece sürüşünden mümkün olduğunca kaçının. Yol kenarında hayvan ve traktör olabileceğini unutmayın.

## Yakıt ve otopark

Teslim alırken yakıt seviyesini ve iade koşulunu netleştirin. Şehir merkezinde otopark ücretli ve sınırlı olabilir; konakladığınız tesisin otoparkı olup olmadığını önceden sorun. Uzun süreli parklarda güvenli kapalı otoparkları değerlendirin.

## Uzun yol ve dönüş

Trabzon'dan çevre illere veya yaylalara uzun yol yapacaksanız aracın bakım durumunu ve lastiklerini kontrol edin. Yol boyunca mola yerlerini önceden belirlemek, yorgunluk riskini azaltır. Dönüşte trafik ve hava koşullarını takip edin; uçuş veya otobüs saatine çok yakın plan yapmayın. Kiralık aracı teslim ederken fotoğraf ve yakıt tutanağını tamamlamak, sonradan doğabilecek anlaşmazlıkları önler.

## Sık sorulan sorular`,

  'trabzon-spor-ve-outdoor-rehberi': `
## Koşu rotaları

Trabzon'da koşu için en erişilebilir güzergâh sahil hattı. Sabah erken saatlerde serinlik ve sakinlik avantaj; akşam saatlerinde kalabalık artabilir. Eğimli sokaklarda koşmak isteyenler için Ortahisar çevresi alternatif, ancak trafik ve kaldırım durumuna dikkat edin. Koşu öncesi ısınma ve sonrası esneme, eğimli zeminde önemli.

## Bisiklet ve güvenlik

Sahil yolu bisiklet için uygun bölümler sunsa da her güzergâh ayrılmış şerit değil. Kask, aydınlatma ve görünür kıyafet temel güvenlik ekipmanı. Yoğun trafikte ana yoldan kaçının, alternatif sokakları tercih edin. Bisikleti park ederken güvenli kilit kullanın.

## Doğa sporları

Yayla yürüyüşleri, doğa koşusu ve kamp için ekipman ve deneyim seviyesi belirleyici. Rehbersiz uzun rotalara çıkmayın; hava değişimini hesaba katın. Spor sonrası sahil hattında yürüyüş ve esneme, toparlanmayı kolaylaştırır.

## Antrenman planı ve toparlanma

Haftada üç gün yürüyüş veya koşu, iki gün kuvvet çalışması ve bir gün aktif dinlenme, şehirde sürdürülebilir bir plan. Eğimli zeminde antrenman yapıyorsanız mesafeyi kademeli artırın. Spor sonrası su, protein ve uyku toparlanmanın temel parçaları. Yağmurlu günlerde kapalı spor salonu veya evde kısa kuvvet rutini alternatif olabilir.

## Sık sorulan sorular`,

  'trabzon-festival-ve-etkinlik-takvimi': `
## Şenlik adabı

Yayla şenlikleri, yerel toplulukların buluşma alanı. Etkinliğe katılırken alanı kirletmemek, yerel satıcılara saygı göstermek ve izinsiz fotoğraf çekmemek temel nezaket. Horon halkasına katılmak isteyip istemediğinizi sorarak hareket etmek, hem eğlenceli hem saygılı bir deneyim sağlar.

## Alternatif kültür rotası

Şenlik dönemi dışında da Trabzon'da kültür sanat etkinlikleri bulunur. Üniversite etkinlikleri, tiyatro ve sergiler için yerel duyuruları takip edin. Ortahisar'daki tarihî mekânlar ve sahil hattı, etkinlik öncesi veya sonrası kısa bir şehir turu için uygun.

## Takvim takibi

Festival tarihleri her yıl değişebilir. Belediye duyuruları, yerel basın ve sosyal medya hesapları en güncel kaynaklar. Seyahat planınızı kesin tarihe göre yapmadan önce birkaç kaynaktan teyit edin. Konaklama ve ulaşımı erken ayarlamak, şenlik döneminde fiyat ve yer bulma stresini azaltır.

## Festival bütçesi ve konaklama

Şenlik döneminde yayla çevresinde konaklama fiyatları artabilir ve seçenek azalır. Merkezde kalıp günübirlik gitmek, bütçe açısından daha esnek olabilir. Yol, yemek ve etkinlik harcamaları için küçük bir nakit payı ayırın; bazı yerel satıcılarda kart bulunmayabilir. Dönüş saatini geceye bırakmamak, kalabalık ve yorgunlukla uğraşmamak için iyi bir karar.

## Çocuklu ve yaşlı ziyaretçiler

Şenlik alanları kalabalık ve sesli olabilir. Çocuklarla gidiyorsanız buluşma noktası belirleyin, iletişim bilgisi taşıyın ve kalabalıkta el ele yürüyün. Yaşlı ziyaretçiler için oturma alanı, gölge ve tuvalet noktalarını önceden öğrenmek günü kolaylaştırır. Yüksek rakımlı yaylalarda hava serinleyebileceği için yedek giysi alın.

## Sık sorulan sorular`,

  'trabzon-fotograf-noktalari': `
## Ekipman ve ayar

Trabzon'da fotoğraf için geniş açı kadar telefoto da işe yarar; şehir silüeti, kale detayları ve yayla manzaraları farklı odak uzunlukları ister. Sabah ve akşam ışığı için ND filtre, yağmurlu havada lens koruyucu ve yedek batarya taşıyın. Telefonla çekim yapıyorsanız HDR ve gece modunu manuel kontrol edin.

## İzin ve etik

İnsan fotoğrafı çekerken izin isteyin; özellikle çocuklar ve ibadet alanlarında hassasiyet gösterin. Özel mülk, tarla ve hayvan barınaklarına izinsiz girmeyin. Dron kullanımı yasak veya sınırlı olabilir; uçuş öncesi güncel kuralları kontrol edin.

## Yedekleme ve paylaşım

Gün sonunda fotoğrafları iki ayrı yere yedekleyin: bulut ve taşınabilir disk. Seyahat boyunca kartı biçimlendirmeden önce yedeği doğrulayın. Paylaşırken konum ve kişisel bilgileri gözden geçirin.

## Rota ve zamanlama

Bir günde tüm noktaları çekmeye çalışmak yerine iki bölgeye odaklanın. Sabah şehir merkezi ve kale, akşam sahil veya Boztepe gibi bir manzara noktası; ertesi gün yayla ve Uzungöl. Işık saatlerini önceden not edin, ulaşım sürelerini hesaba katın. Ekipmanı her durakta taşımak yerine güvenli bir araçta bırakmak, yürüyüşü hafifletir.

## Sık sorulan sorular`,
};
