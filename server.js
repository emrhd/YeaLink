const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const app = express();
const PORT = process.env.PORT || 3000;

// Password used to access the upload form. Define a variable named
// UPLOAD_PASSWORD in Railway's Environment Variables. If not defined, the
// default value below is used - MAKE SURE TO CHANGE THIS.
const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || 'change-this-password';

// A secret key is required so the directory XML isn't visible to everyone.
// Define a variable named PHONEBOOK_TOKEN in Railway, make it long and
// random (e.g. 24+ characters from a password generator). Enter the URL on
// the phones with this token:
// https://<domain>/phonebook.xml?key=<PHONEBOOK_TOKEN>
const PHONEBOOK_TOKEN = process.env.PHONEBOOK_TOKEN || null;

const DATA_DIR = path.join(__dirname, 'data');
const CSV_PATH = path.join(DATA_DIR, 'extensions.csv');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.urlencoded({ extended: true }));

// Escape special XML characters
function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Flexibly finds the name/number columns from the CSV content.
// FreePBX Bulk Handler export column names can vary by version, so we
// scan for common names (extension, name, description, cid, etc.).
function findColumn(headers, candidates) {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand);
    if (idx !== -1) return headers[idx];
  }
  // partial match
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
    throw new Error('CSV appears to be empty.');
  }

  const headers = Object.keys(records[0]);
  const extCol = findColumn(headers, ['extension', 'ext', 'number']);
  const nameCol = findColumn(headers, ['name', 'description', 'cidname']);

  if (!extCol) {
    throw new Error(
      `Number column not found. CSV headers: ${headers.join(', ')}`
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

// --- XML endpoint the Yealink phones fetch ---
app.get('/phonebook.xml', (req, res) => {
  if (PHONEBOOK_TOKEN) {
    if (req.query.key !== PHONEBOOK_TOKEN) {
      return res.status(403).type('text/plain').send('Access denied: invalid or missing key.');
    }
  }
  if (!fs.existsSync(CSV_PATH)) {
    return res
      .status(404)
      .type('text/plain')
      .send('No directory uploaded yet. Upload a CSV from / first.');
  }
  try {
    const csvBuffer = fs.readFileSync(CSV_PATH);
    const xml = csvToXml(csvBuffer);
    res.type('application/xml').send(xml);
  } catch (err) {
    res.status(500).type('text/plain').send('Error: ' + err.message);
  }
});

// --- Simple upload page ---
app.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Yealink Directory Upload</title>
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
  <h1>📞 Yealink Directory Update</h1>
  <p>Upload the CSV file you exported from FreePBX &gt; Bulk Handler &gt; Export here.</p>
  <form method="POST" action="/upload" enctype="multipart/form-data">
    <label>Password</label>
    <input type="password" name="password" required>
    <label>CSV File</label>
    <input type="file" name="csv" accept=".csv" required>
    <button type="submit">Upload and Update</button>
  </form>
</body>
</html>`);
});

app.post('/upload', upload.single('csv'), (req, res) => {
  if (req.body.password !== UPLOAD_PASSWORD) {
    return res.status(403).send('Wrong password. <a href="/">Go back</a>');
  }
  if (!req.file) {
    return res.status(400).send('No file selected. <a href="/">Go back</a>');
  }
  try {
    // convert first for validation, to catch errors before saving
    csvToXml(req.file.buffer);
    fs.writeFileSync(CSV_PATH, req.file.buffer);
    res.send(`
      <p>✅ Directory updated.</p>
      <p><a href="/phonebook.xml" target="_blank">View XML</a></p>
      <p><a href="/">Go back</a></p>
    `);
  } catch (err) {
    res.status(400).send(`❌ Error: ${err.message}<br><a href="/">Go back</a>`);
  }
});

app.listen(PORT, () => {
  console.log(`Yealink phonebook service running on port ${PORT}.`);
});
