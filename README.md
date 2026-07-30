# Yealink + Zoiper Directory Service (Railway)

Provides a centralized directory to both Yealink T48S phones and Zoiper
softphones from FreePBX — no SSH or API access required, just manual
CSV/Excel uploads.

## How it works

1. Export **Extensions** from FreePBX (Admin > Bulk Handler > Export >
   Extensions) as CSV.
2. Prepare **Ring Groups** as a CSV or Excel file yourself (FreePBX's Bulk
   Handler doesn't export this module in this installation) — just two
   columns: `Ring Group` and `Description`.
3. Go to this app's web page (`/`) and upload either or both files, using
   one password.
4. The app merges them and serves the combined directory continuously at:
   - `/phonebook.xml` — Yealink format
   - `/phonebook-zoiper.xml` — Zoiper format
5. On each phone/softphone, enter the relevant URL once. When the
   directory changes, just re-upload the changed file — nothing to touch
   on the devices.

Uploading only one of the two files updates only that list; the other one
is left untouched.

## Deploying to Railway

1. Push this folder to a GitHub repository.
2. On [railway.app](https://railway.app), **New Project > Deploy from
   GitHub repo**, select this repo.
3. In **Variables**, add:
   ```
   UPLOAD_PASSWORD=choose-a-strong-password
   PHONEBOOK_TOKEN=choose-a-long-random-key
   ```
4. In **Settings > Volumes**, add a volume mounted at `/app/data` so
   uploaded files survive restarts.
5. Once deployed, go to the Railway-provided URL and upload your files.

## URLs to use

**Yealink (T48S)** — Directory > Remote Phone Book > Remote URL:
```
https://your-railway-address.up.railway.app/phonebook.xml?key=YOUR_PHONEBOOK_TOKEN
```
Also add it under Directory > Setting > Search Source List In Dialing so
it's searchable while dialing, not just from the Directory menu.

**Zoiper** — Settings > Contacts > Add > XML > Local path/URL (requires
Zoiper Premium):
```
https://your-railway-address.up.railway.app/phonebook-zoiper.xml?key=YOUR_PHONEBOOK_TOKEN
```
Leave Authentication as "Don't use" — the token is already in the URL.

Requests without `key=`, or with the wrong value, get a **403 Access
denied**.

## Security

- Change `UPLOAD_PASSWORD` from the default.
- Always define `PHONEBOOK_TOKEN` — without it the directory is public.
- Rate limiting is built in: 10 upload attempts / 15 min, 300 directory
  fetches / 15 min per IP, to slow down password/token guessing.
- Don't export the Secret/Password column from FreePBX.

## File formats accepted

Both CSV and Excel (.xlsx/.xls) work for either upload — detected
automatically from file content, not the file extension.

**Extensions** — number column: `extension`/`ext`/`number`; name column:
`name`/`description`/`cidname`.

**Ring Groups** — number column: `ring group`/`ringgroup`/`grpnum`/
`extension`/`number`; name column: `description`/`name`.

If a file's headers don't match, the upload page shows exactly which
headers it found so the column list in `server.js` (`findColumn` calls)
can be extended.

## Testing locally

```bash
npm install
npm start
# http://localhost:3000
```
