# TabGen lisans denetimi (ürün olarak yayın için)

Tarih: 30 Ekim 2026 · Sürüm: p2.9 · Hukuki görüş değildir; yayından önce bir avukata gösterin.

Her parçanın lisansı kendi resmi sayfasından kontrol edildi (alıntılar aşağıda). Kodun neredeyse
tamamı ticari kullanıma açık (MIT, Apache, BSD). Sorun, bazı yapay zekâ modellerinin **ağırlıklarında**
(eğitilmiş "beyin" dosyaları) ve eğitildikleri verilerde.

## Özet

| Parça | Ne işe yarıyor | Durum | Yapılan / gereken |
|---|---|---|---|
| **Demucs htdemucs_6s** | şarkıyı enstrümanlara ayırma (gitar sesini ayırır) | 🔴 **engel** | Karar sizde (aşağıda) |
| S-KEY | ton bulma | 🔴 → ✅ | **Çıkarıldı.** Yerine lisanssız yöntem kondu, üstelik daha iyi |
| All-In-One | bölümler (nakarat, kıta…) | 🟠 orta | Ağırlıkların ayrı lisansı yok; Demucs'a bağımlı |
| lv-chordia | akorlar | 🟡 düşük-orta | Paket MIT, "ticari kullanım serbest" diyor; eğitim verisi belirtilmemiş |
| Beat This! | vuruş ve tempo | 🟢 düşük | "Kod ve ağırlıklar MIT" |
| Basic Pitch (Spotify) | nota bulma | 🟢 düşük | Apache-2.0 |
| TabCNN-GPFX | tel tahmini | 🟢 düşük | CC BY 4.0: isim vermek yeterli (uygulamada yapıldı) |
| alphaTab | tab gösterimi | 🟢 düşük | MPL-2.0: isim + kaynak bağlantısı (uygulamada yapıldı) |
| yt-dlp | YouTube'dan indirme | 🔴 ürüne girmez | Üründe kapalı olmalı (`TABGEN_URL_INGEST=0`) |
| IDMT veri seti | tel seçimi ayarlarını denemek için | 🟢 düşük | Sadece birkaç sayı ayarlandı; veri dağıtılmıyor |

## Kaynaklardan alıntılar

- **Demucs** (github.com/adefossez/demucs): "The license of the weights is not clear: MusDB contains
  some data that were only usable for research purpose." htdemucs_6s için: "was trained only on Meta
  internal dataset" ve "a CC-NC-BY license is likely applicable" (NC = ticari olmayan). Yazar: "I sadly
  cannot help granting a license".
- **S-KEY** (github.com/deezer/s-key): "The MIT license **does not** apply to the model weights in
  skey.pt." ve "You may use the model weights only for non-commercial research purposes."
- **Beat This!**: "The code and the published model weights are released under the MIT license."
  (Bazı eğitim verilerinin telifli olduğunu, kullanıcının değerlendirmesi gerektiğini de ekliyor.)
- **lv-chordia**: Kod MIT; SSS: "Yes, the MIT license allows commercial use." Ağırlıklar MIT paketin
  içinde geliyor; eğitim verisi adı verilmiyor.
- **All-In-One**: Depo MIT; "The models are trained on the Harmonix Set". Ağırlıklar için ayrı bir
  lisans cümlesi yok.

## Bu turda yapılanlar

1. **S-KEY çıkarıldı.** Ton artık TabGen'in çıkardığı notalardan, yayımlanmış ton profilleriyle
   (Temperley) bulunuyor. Eğitilmiş model yok, lisans sorunu yok. GuitarSet'te (60 kayıt, akor
   kontrolü dahil) tam doğru ton: S-KEY %55 → yeni yöntem **%58**.
2. **Uygulamaya lisanslar ekranı eklendi** (Ayarlar → Hakkında → Açık kaynak lisansları): her parça,
   ne işe yaradığı, lisansı ve istenen atıf.
3. **Akor modeli için yedek hazır:** model kullanmayan bir akor bulucu (`template`). Ama GuitarSet'te
   %57'de kalıyor (lv-chordia %75), bu yüzden varsayılan olmadı.
4. Lisans tablosu (`THIRD_PARTY_LICENSES.md`) düzeltildi: S-KEY eskiden yanlışlıkla "MIT" yazıyordu.

## Karar gereken: enstrüman ayırma (Demucs)

Gitar sesini şarkıdan ayıran model ticari kullanıma büyük ihtimalle kapalı ve yazarı izin veremeyeceğini
söylüyor. Ticari izinli, gitarı ayrı ayıran hazır açık bir model de yok (Spleeter'da gitar kanalı yok,
modellerinin lisansı da açıkça yazmıyor). Seçenekler:

1. **Ticari ayırma servisi/SDK lisanslamak** (ör. AudioShake, Music.AI/Moises, LALAL.AI).
   En hızlı yol; maliyeti var, bazıları sesi sunucuya gönderir.
2. **Kendi ayırma modelimizi eğitmek**, ticari kullanıma açık verilerle (ör. Slakh2100, CC BY 4.0;
   üstüne gerçek gitar kayıtları). Haftalar + güçlü GPU ister; ilk sürüm kalitesi bugünküne yetişmeyebilir.
3. **İlk sürümü ayırmasız çıkarmak:** "Kendi çaldığını tab'a çevir". Kullanıcı gitarını mikrofonla ya
   da dosya olarak yükler; ayırmaya gerek yok. Bugünkü kodla mümkün. Hazır şarkılardan tab çıkarma,
   1. veya 2. seçenek hazır olunca gelir.

Öneri: **3 ile başlayıp 1'i paralel araştırmak**. Avukatla birlikte All-In-One (bölümler) ve lv-chordia
(akorlar) için de görüş alınmalı; ikisi de ayırmasız modda daha az önemli (bölümler kısa kayıtlarda
gerekmiyor).

## Ücretli ayırma servisleri (ilk araştırma, 30 Ekim 2026)

Fiyatların hiçbiri resmi olarak yayımlanmamış; aşağıdakiler resmi sayfalar ve üçüncü taraf
incelemelerden. Kesin fiyat için firmalarla görüşmek gerekiyor.

| Servis | Gitar kanalı | Nerede çalışıyor | Fiyat | Not |
|---|---|---|---|---|
| **AudioShake** | Gitar ve akustik gitar modelleri var | **Cihazda** (SDK: iOS, macOS, Android, Windows) ve bulut | Teklif usulü (info@audioshake.ai) | Plak şirketlerinin kullandığı; cihazda çalıştığı için ses telefondan çıkmaz. SDK'da gitar modelinin olduğu ayrıca teyit edilmeli |
| **Music.AI (Moises)** | Tüm gitarlar, akustik, elektro, **lead / rhythm** ayrı | Bulut API | Dakika başı (music.ai/pricing) | Lead/rhythm ayrımı bizim çok gitarlı tab özelliğine çok uyar; ses sunucuya gider |
| **LALAL.AI** | Elektro ve akustik gitar | Bulut API | Kurumsal paketler (ör. 5000 dk ≈ 300 $, doğrulanmadı) | Ses sunucuya gider |

**Öneri:** Önce **AudioShake**'ten cihazda çalışan SDK için teklif istemek (gizlilik + iPhone'da
tek başına çalışma hedefimize uygun). Bulut seçeneği olarak Music.AI'nin lead/rhythm ayrımı ilginç.
Bu görüşmeleri siz başlatmalısınız; teknik entegrasyon için Demucs'un yerine başka bir ayırıcı
takabileceğimiz yapı (`stages/separate.py`) hazır.

Kaynaklar: developer.audioshake.ai/sdk/overview · audioshake.ai/audioshake-models/guitar-separation ·
music.ai/pricing (üçüncü taraf özetleri) · LALAL.AI incelemeleri (stemsplit.io, capterra.com)
