const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const app = express();
const PORT = process.env.PORT || 3000;

// Panele girerken kullanılacak şifre. Railway'de Environment Variables kısmından
// UPLOAD_PASSWORD adında bir değişken tanımlayın. Tanımlamazsanız varsayılan
// aşağıdaki değer kullanılır - MUTLAKA DEĞİŞTİRİN.
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || 'degistir-bu-sifreyi';

// Rehber XML'ini herkesin görmemesi için gizli bir anahtar (token) gerekiyor.
// Railway'de PHONEBOOK_TOKEN adında bir değişken tanımlayın, uzun ve rastgele olsun
// (örn. bir şifre üreticiyle 24+ karakter). Telefonlara URL'yi bu tokenla girin:
// https://<domain>/phonebook.xml?key=<PHONEBOOK_TOKEN>
const PHONEBOOK_TOKEN = process.env.PHONEBOOK_TOKEN || null;

const DATA_DIR = path.join(__dirname, 'data');
const CSV_PATH = path.join(DATA_DIR, 'extensions.csv');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.urlencoded({ extended: true }));

// XML özel karakter escape
function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// CSV içeriğinden isim/numara sütunlarını esnek şekilde bulur.
// FreePBX Bulk Handler export sütun isimleri sürüme göre değişebilir,
// bu yüzden yaygın adları (extension, ext, name, description, cid) tarıyoruz.
function findColumn(headers, candidates) {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand);
    if (idx !== -1) return headers[idx];
  }
  // kısmi eşleşme
  for (const cand of candidates) {
    const idx = lower.findIndex(h => h.includes(cand));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function csvToXml(csvBuffer) {
  const records = parse(csvBuffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  if (records.length === 0) {
    throw new Error('CSV boş görünüyor.');
  }

  const headers = Object.keys(records[0]);
  const extCol = findColumn(headers, ['extension', 'ext', 'dahili', 'number']);
  const nameCol = findColumn(headers, ['name', 'description', 'ad', 'isim', 'cidname']);

  if (!extCol) {
    throw new Error(
      `Numara sütunu bulunamadı. CSV başlıkları: ${headers.join(', ')}`
    );
  }

  const entries = records
    .map(r => {
      const number = (r[extCol] || '').toString().trim();
      const name = nameCol ? (r[nameCol] || '').toString().trim() : number;
      if (!number) return null;
      return `  <DirectoryEntry>\n    <Name>${escapeXml(name || number)}</Name>\n    <Telephone>${escapeXml(number)}</Telephone>\n  </DirectoryEntry>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<YealinkIPPhoneDirectory>\n${entries}\n</YealinkIPPhoneDirectory>\n`;
}

// --- Yealink telefonların çektiği XML endpoint ---
app.get('/phonebook.xml', (req, res) => {
  if (PHONEBOOK_TOKEN) {
    if (req.query.key !== PHONEBOOK_TOKEN) {
      return res.status(403).type('text/plain').send('Erişim reddedildi: geçersiz veya eksik anahtar.');
    }
  }
  if (!fs.existsSync(CSV_PATH)) {
    return res
      .status(404)
      .type('text/plain')
      .send('Henüz rehber yüklenmedi. Önce / adresinden CSV yükleyin.');
  }
  try {
    const csvBuffer = fs.readFileSync(CSV_PATH);
    const xml = csvToXml(csvBuffer);
    res.type('application/xml').send(xml);
  } catch (err) {
    res.status(500).type('text/plain').send('Hata: ' + err.message);
  }
});

// --- Basit yükleme sayfası ---
app.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<title>Yealink Rehber Yükleme</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 60px auto; padding: 0 20px; color: #222; }
  h1 { font-size: 20px; }
  label { display: block; margin-top: 16px; font-size: 14px; font-weight: 600; }
  input[type=file], input[type=password] { display: block; margin-top: 6px; width: 100%; padding: 8px; box-sizing: border-box; }
  button { margin-top: 20px; padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
  button:hover { background: #1d4ed8; }
  .info { margin-top: 24px; padding: 12px; background: #f3f4f6; border-radius: 6px; font-size: 13px; line-height: 1.5; }
  code { background: #e5e7eb; padding: 2px 4px; border-radius: 3px; }
</style>
</head>
<body>
  <h1>📞 Yealink Rehber Güncelleme</h1>
  <p>FreePBX &gt; Bulk Handler &gt; Export'tan indirdiğiniz CSV dosyasını buradan yükleyin.</p>
  <form method="POST" action="/upload" enctype="multipart/form-data">
    <label>Şifre</label>
    <input type="password" name="password" required>
    <label>CSV Dosyası</label>
    <input type="file" name="csv" accept=".csv" required>
    <button type="submit">Yükle ve Güncelle</button>
  </form>
</body>
</html>`);
});

app.post('/upload', upload.single('csv'), (req, res) => {
  if (req.body.password !== UPLOAD_PASSWORD) {
    return res.status(403).send('Şifre yanlış. <a href="/">Geri dön</a>');
  }
  if (!req.file) {
    return res.status(400).send('Dosya seçilmedi. <a href="/">Geri dön</a>');
  }
  try {
    // önce doğrulama amaçlı çevirip hata var mı bakıyoruz
    csvToXml(req.file.buffer);
    fs.writeFileSync(CSV_PATH, req.file.buffer);
    res.send(`
      <p>✅ Rehber güncellendi.</p>
      <p><a href="/phonebook.xml" target="_blank">XML'i görüntüle</a></p>
      <p><a href="/">Geri dön</a></p>
    `);
  } catch (err) {
    res.status(400).send(`❌ Hata: ${err.message}<br><a href="/">Geri dön</a>`);
  }
});

app.listen(PORT, () => {
  console.log(`Yealink phonebook servisi ${PORT} portunda çalışıyor.`);
});
