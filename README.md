# Yealink Rehber Servisi (Railway)

FreePBX'ten SSH/API olmadan, sadece **Bulk Handler CSV export** ile Yealink T48S telefonlara
merkezi rehber sağlar.

## Nasıl çalışır

1. FreePBX panelinde **Admin > Bulk Handler > Export > Extensions** ile CSV indirirsiniz.
2. Bu uygulamanın web sayfasına (`/`) gidip CSV'yi şifreyle yüklersiniz.
3. Uygulama CSV'yi Yealink XML formatına çevirip `/phonebook.xml` adresinde sürekli sunar.
4. Telefonlarda **Directory > Remote Phone Book > URL** alanına bu adresi bir kez girersiniz.
5. Rehber değiştiğinde sadece 2. adımı tekrarlarsınız — telefonlara tekrar dokunmazsınız.

## Railway'e deploy etme

1. Bu klasörü bir GitHub reposuna push edin (veya Railway CLI ile doğrudan deploy edin).
2. [railway.app](https://railway.app) üzerinde **New Project > Deploy from GitHub repo** seçin.
3. Bu repoyu seçin, Railway otomatik olarak `package.json`'ı algılayıp Node.js olarak
   deploy eder.
4. Railway proje ayarlarında **Variables** sekmesine gidip şunu ekleyin:
   ```
   UPLOAD_PASSWORD=guclu-bir-sifre-belirleyin
   ```
5. Deploy tamamlandığında Railway size bir URL verir, örneğin:
   ```
   https://yealink-phonebook-production.up.railway.app
   ```
6. Bu adrese gidip CSV'nizi yükleyin. Rehber şu adreste yayınlanır:
   ```
   https://yealink-phonebook-production.up.railway.app/phonebook.xml
   ```

## ÖNEMLİ: Kalıcı disk (Volume) ekleyin

Railway'de container'lar yeniden başladığında dosya sistemi sıfırlanabilir. Yüklediğiniz
CSV'nin kaybolmaması için Railway proje ayarlarında bir **Volume** oluşturup
`/app/data` klasörüne bağlayın (Settings > Volumes > New Volume, Mount Path: `/app/data`).
Bu olmadan da çalışır, sadece her deploy/restart sonrası CSV'yi tekrar yüklemeniz gerekir.

## Telefonlara URL'yi tanıtma (T48S)

Her telefonda bir kez:
1. Telefonun web arayüzüne girin (`http://<telefon-ip>`, varsayılan admin/admin)
2. **Directory > Remote Phone Book** sekmesi
3. **Remote URL**: `https://sizin-railway-adresiniz.up.railway.app/phonebook.xml`
4. **Display Name**: örn. "Şirket Rehberi"
5. Confirm

## CSV formatı hakkında

Script, CSV başlıklarında otomatik olarak şu isimlere benzer sütunları arar:
- Numara için: `extension`, `ext`, `number`, `dahili`
- İsim için: `name`, `description`, `cidname`, `isim`, `ad`

FreePBX Bulk Handler export'unuzun tam sütun adları farklıysa ve script eşleştiremezse,
yükleme sayfası hangi başlıkları bulamadığını hata mesajında gösterir — o zaman
`server.js` içindeki `findColumn` çağrılarına ilgili sütun adını eklemeniz yeterli.

## Yerelde test etme

```bash
npm install
npm start
# http://localhost:3000 adresine gidin
```

## Güvenlik notu

- `UPLOAD_PASSWORD`'ü mutlaka değiştirin, varsayılan değeri kullanmayın.
- `/phonebook.xml` endpoint'i herkese açıktır (telefonlar kimlik doğrulama göndermez).
  İçinde sadece isim + dahili numara olduğu için genelde kabul edilebilir bir risktir,
  ama isterseniz Railway'de bu path için ayrı bir erişim kısıtlaması ekleyebilirsiniz.
