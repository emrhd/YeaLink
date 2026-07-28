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
const EXTENSIONS_CSV_PATH = path.join(DATA_DIR, 'extensions.csv');
const RING_GROUPS_CSV_PATH = path.join(DATA_DIR, 'ringgroups.csv');

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
// FreePBX Bulk Handler export column names can vary by version and by
// module (Extensions vs Ring Groups), so we scan for common names.
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

// Parses a CSV buffer into a list of {name, number} entries.
// numberCandidates/nameCandidates let callers use different column-name
// guesses for Extensions vs Ring Groups exports.
function csvToEntries(csvBuffer, numberCandidates, nameCandidates, label) {
  const records = parse(csvBuffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });

  if (records.length === 0) {
    throw new Error(`${label} CSV appears to be empty.`);
  }

  const headers = Object.keys(records[0]);
  const numCol = findColumn(headers, numberCandidates);
  const nameCol = findColumn(headers, nameCandidates);

  if (!numCol) {
    throw new Error(
      `${label}: number column not found. CSV headers: ${headers.join(', ')}`
    );
  }

  return records
    .map(r => {
      const number = (r[numCol] || '').toString().trim();
      const name = nameCol ? (r[nameCol] || '').toString().trim() : number;
      if (!number) return null;
      return { name: name || number, number };
    })
    .filter(Boolean);
}

function entriesToXml(entries) {
  const body = entries
    .map(
      e =>
        `  <DirectoryEntry>\n    <Name>${escapeXml(e.name)}</Name>\n    <Telephone>${escapeXml(e.number)}</Telephone>\n  </DirectoryEntry>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<YealinkIPPhoneDirectory>\n${body}\n</YealinkIPPhoneDirectory>\n`;
}

// Builds the combined directory from whichever CSVs have been uploaded.
// At least one of the two must exist.
function buildCombinedXml() {
  const extensionsExist = fs.existsSync(EXTENSIONS_CSV_PATH);
  const ringGroupsExist = fs.existsSync(RING_GROUPS_CSV_PATH);

  if (!extensionsExist && !ringGroupsExist) {
    const err = new Error('No directory uploaded yet.');
    err.code = 'NO_DATA';
    throw err;
  }

  let entries = [];

  if (extensionsExist) {
    const buf = fs.readFileSync(EXTENSIONS_CSV_PATH);
    entries = entries.concat(
      csvToEntries(buf, ['extension', 'ext', 'number'], ['name', 'description', 'cidname'], 'Extensions')
    );
  }

  if (ringGroupsExist) {
    const buf = fs.readFileSync(RING_GROUPS_CSV_PATH);
    entries = entries.concat(
      csvToEntries(buf, ['ringgroup', 'grpnum', 'extension', 'number'], ['description', 'name'], 'Ring Groups')
    );
  }

  return entriesToXml(entries);
}

// --- XML endpoint the Yealink phones fetch ---
app.get('/phonebook.xml', (req, res) => {
  if (PHONEBOOK_TOKEN) {
    if (req.query.key !== PHONEBOOK_TOKEN) {
      return res.status(403).type('text/plain').send('Access denied: invalid or missing key.');
    }
  }
  try {
    const xml = buildCombinedXml();
    res.type('application/xml').send(xml);
  } catch (err) {
    if (err.code === 'NO_DATA') {
      return res
        .status(404)
        .type('text/plain')
        .send('No directory uploaded yet. Upload a CSV from / first.');
    }
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
  h2 { font-size: 15px; margin-top: 36px; }
  label { display: block; margin-top: 16px; font-size: 14px; font-weight: 600; }
  input[type=file], input[type=password] { display: block; margin-top: 6px; width: 100%; padding: 8px; box-sizing: border-box; }
  button { margin-top: 20px; padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
  button:hover { background: #1d4ed8; }
  hr { margin-top: 32px; border: none; border-top: 1px solid #e5e7eb; }
  .info { margin-top: 24px; padding: 12px; background: #f3f4f6; border-radius: 6px; font-size: 13px; line-height: 1.5; }
</style>
</head>
<body>
  <h1>📞 Yealink Directory Update</h1>

  <h2>Extensions</h2>
  <p>Upload the CSV from FreePBX &gt; Bulk Handler &gt; Export &gt; Extensions.</p>
  <form method="POST" action="/upload/extensions" enctype="multipart/form-data">
    <label>Password</label>
    <input type="password" name="password" required>
    <label>CSV File</label>
    <input type="file" name="csv" accept=".csv" required>
    <button type="submit">Upload Extensions</button>
  </form>

  <hr>

  <h2>Ring Groups</h2>
  <p>Upload the CSV from FreePBX &gt; Bulk Handler &gt; Export &gt; Ring Groups.</p>
  <form method="POST" action="/upload/ringgroups" enctype="multipart/form-data">
    <label>Password</label>
    <input type="password" name="password" required>
    <label>CSV File</label>
    <input type="file" name="csv" accept=".csv" required>
    <button type="submit">Upload Ring Groups</button>
  </form>
</body>
</html>`);
});

function handleUpload(csvPath, label) {
  return (req, res) => {
    if (req.body.password !== UPLOAD_PASSWORD) {
      return res.status(403).send('Wrong password. <a href="/">Go back</a>');
    }
    if (!req.file) {
      return res.status(400).send('No file selected. <a href="/">Go back</a>');
    }
    try {
      fs.writeFileSync(csvPath, req.file.buffer);
      // validate combined output so mistakes surface immediately
      buildCombinedXml();
      res.send(`
        <p>✅ ${label} updated.</p>
        <p><a href="/phonebook.xml" target="_blank">View combined XML</a></p>
        <p><a href="/">Go back</a></p>
      `);
    } catch (err) {
      res.status(400).send(`❌ Error: ${err.message}<br><a href="/">Go back</a>`);
    }
  };
}

app.post('/upload/extensions', upload.single('csv'), handleUpload(EXTENSIONS_CSV_PATH, 'Extensions'));
app.post('/upload/ringgroups', upload.single('csv'), handleUpload(RING_GROUPS_CSV_PATH, 'Ring Groups'));

app.listen(PORT, () => {
  console.log(`Yealink phonebook service running on port ${PORT}.`);
});
