const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const rateLimit = require('express-rate-limit');

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
const EXTENSIONS_DATA_PATH = path.join(DATA_DIR, 'extensions.data');
const RING_GROUPS_DATA_PATH = path.join(DATA_DIR, 'ringgroups.data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.urlencoded({ extended: true }));

// Brute-force protection: limits repeated password/token guessing from a
// single IP. After hitting the limit, that IP gets a 429 response until the
// window resets - it does not lock out other users.

// Upload form: password guessing protection. 10 attempts per 15 minutes.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many upload attempts. Please wait 15 minutes and try again.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Directory XML: token guessing protection. Generous limit since real
// phones poll this regularly, but still blocks rapid brute-force attempts.
const phonebookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Too many requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Escape special XML characters
function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Parses either a .csv or .xlsx buffer into an array of row objects
// (each object keyed by column header), regardless of format. Detected by
// content, not filename, so it still works correctly after the file has
// been saved to disk under a fixed name.
function bufferToRecords(buffer) {
  // .xlsx files are zip archives, which always start with the bytes 'PK'.
  const isZip = buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isZip) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  }
  return parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
}

// Flexibly finds the name/number columns from the CSV content.
// FreePBX Bulk Handler export column names can vary by version and by
// module (Extensions vs Ring Groups), so we scan for common names.
function findColumn(headers, candidates) {
  const lower = headers.map(h => h.toLowerCase().trim());
  const normalized = lower.map(h => h.replace(/\s+/g, ''));

  for (const cand of candidates) {
    const idx = lower.indexOf(cand);
    if (idx !== -1) return headers[idx];
  }
  // exact match ignoring spaces (e.g. "Ring Group" vs "ringgroup")
  for (const cand of candidates) {
    const idx = normalized.indexOf(cand.replace(/\s+/g, ''));
    if (idx !== -1) return headers[idx];
  }
  // partial match
  for (const cand of candidates) {
    const idx = lower.findIndex(h => h.includes(cand));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

// Parses a CSV or XLSX buffer into a list of {name, number} entries.
// numberCandidates/nameCandidates let callers use different column-name
// guesses for Extensions vs Ring Groups exports.
function fileToEntries(fileBuffer, numberCandidates, nameCandidates, label) {
  const records = bufferToRecords(fileBuffer);

  if (records.length === 0) {
    throw new Error(`${label} file appears to be empty.`);
  }

  const headers = Object.keys(records[0]);
  const numCol = findColumn(headers, numberCandidates);
  const nameCol = findColumn(headers, nameCandidates);

  if (!numCol) {
    throw new Error(
      `${label}: number column not found. File headers: ${headers.join(', ')}`
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

function entriesToYealinkXml(entries) {
  const body = entries
    .map(
      e =>
        `  <DirectoryEntry>\n    <Name>${escapeXml(e.name)}</Name>\n    <Telephone>${escapeXml(e.number)}</Telephone>\n  </DirectoryEntry>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<YealinkIPPhoneDirectory>\n${body}\n</YealinkIPPhoneDirectory>\n`;
}

// Zoiper5's official "XML Contact Service" schema (Contacts/Contact/Name +
// Phone with Type=Work|Home, PhoneType=Phone|Cell|Pager|IPPhone|Mail|Fax|
// Custom, and the actual number in <Phone>). If Zoiper reports an error
// importing this, share the exact message and we'll adjust field names.
function entriesToZoiperXml(entries) {
  const body = entries
    .map((e, i) => {
      const id = i + 1;
      return `  <Contact id="${id}">\n    <Name>\n      <First>${escapeXml(e.name)}</First>\n      <Display>${escapeXml(e.name)}</Display>\n    </Name>\n    <Phone>\n      <Type>Work</Type>\n      <PhoneType>IPPhone</PhoneType>\n      <Phone>${escapeXml(e.number)}</Phone>\n    </Phone>\n  </Contact>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<Contacts>\n${body}\n</Contacts>\n`;
}

// Builds the combined list of {name, number} entries from whichever files
// have been uploaded. At least one of the two must exist.
function buildEntries() {
  const extensionsExist = fs.existsSync(EXTENSIONS_DATA_PATH);
  const ringGroupsExist = fs.existsSync(RING_GROUPS_DATA_PATH);

  if (!extensionsExist && !ringGroupsExist) {
    const err = new Error('No directory uploaded yet.');
    err.code = 'NO_DATA';
    throw err;
  }

  let entries = [];

  if (extensionsExist) {
    const buf = fs.readFileSync(EXTENSIONS_DATA_PATH);
    entries = entries.concat(
      fileToEntries(buf, ['extension', 'ext', 'number'], ['name', 'description', 'cidname'], 'Extensions')
    );
  }

  if (ringGroupsExist) {
    const buf = fs.readFileSync(RING_GROUPS_DATA_PATH);
    entries = entries.concat(
      fileToEntries(buf, ['ring group', 'ringgroup', 'grpnum', 'extension', 'number'], ['description', 'name'], 'Ring Groups')
    );
  }

  return entries;
}

// --- XML endpoint the Yealink phones fetch ---
app.get('/phonebook.xml', phonebookLimiter, (req, res) => {
  if (PHONEBOOK_TOKEN) {
    if (req.query.key !== PHONEBOOK_TOKEN) {
      return res.status(403).type('text/plain').send('Access denied: invalid or missing key.');
    }
  }
  try {
    const xml = entriesToYealinkXml(buildEntries());
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

// --- Same data, in the generic AddressBook/Contact format some softphones
// (e.g. Zoiper) expect. Use this URL in Zoiper's XML Contacts service. ---
app.get('/phonebook-zoiper.xml', phonebookLimiter, (req, res) => {
  if (PHONEBOOK_TOKEN) {
    if (req.query.key !== PHONEBOOK_TOKEN) {
      return res.status(403).type('text/plain').send('Access denied: invalid or missing key.');
    }
  }
  try {
    const xml = entriesToZoiperXml(buildEntries());
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
  h2 { font-size: 15px; margin-top: 28px; margin-bottom: 4px; }
  label { display: block; margin-top: 16px; font-size: 14px; font-weight: 600; }
  input[type=file], input[type=password] { display: block; margin-top: 6px; width: 100%; padding: 8px; box-sizing: border-box; }
  button { margin-top: 24px; padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
  button:hover { background: #1d4ed8; }
  .note { font-size: 12px; color: #6b7280; margin-top: 4px; }
</style>
</head>
<body>
  <h1>📞 Yealink Directory Update</h1>
  <p>Upload either file, or both. Whichever you upload replaces only that
  list — the other one stays as-is.</p>

  <form method="POST" action="/upload" enctype="multipart/form-data">
    <label>Password</label>
    <input type="password" name="password" required>

    <h2>Extensions (CSV or Excel)</h2>
    <input type="file" name="extensions_csv" accept=".csv,.xlsx,.xls">

    <h2>Ring Groups (CSV or Excel)</h2>
    <input type="file" name="ringgroups_csv" accept=".csv,.xlsx,.xls">

    <button type="submit">Upload</button>
  </form>
</body>
</html>`);
});

app.post(
  '/upload',
  uploadLimiter,
  upload.fields([
    { name: 'extensions_csv', maxCount: 1 },
    { name: 'ringgroups_csv', maxCount: 1 },
  ]),
  (req, res) => {
    if (req.body.password !== UPLOAD_PASSWORD) {
      return res.status(403).send('Wrong password. <a href="/">Go back</a>');
    }

    const extFile = req.files?.extensions_csv?.[0];
    const ringFile = req.files?.ringgroups_csv?.[0];

    if (!extFile && !ringFile) {
      return res.status(400).send('No file selected. <a href="/">Go back</a>');
    }

    const updated = [];
    try {
      if (extFile) {
        fs.writeFileSync(EXTENSIONS_DATA_PATH, extFile.buffer);
        updated.push('Extensions');
      }
      if (ringFile) {
        fs.writeFileSync(RING_GROUPS_DATA_PATH, ringFile.buffer);
        updated.push('Ring Groups');
      }
      // validate combined output so mistakes surface immediately
      buildEntries();
      res.send(`
        <p>✅ ${updated.join(' and ')} updated.</p>
        <p><a href="/phonebook.xml" target="_blank">View combined XML</a></p>
        <p><a href="/">Go back</a></p>
      `);
    } catch (err) {
      res.status(400).send(`❌ Error: ${err.message}<br><a href="/">Go back</a>`);
    }
  }
);

app.listen(PORT, () => {
  console.log(`Yealink phonebook service running on port ${PORT}.`);
});
