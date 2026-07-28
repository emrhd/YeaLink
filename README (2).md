# Yealink Directory Service (Railway)

Provides a centralized directory for Yealink T48S phones from FreePBX, without
SSH or API access — just **Bulk Handler CSV exports** for Extensions and
Ring Groups.

## How it works

1. In the FreePBX panel: **Admin > Bulk Handler > Export > Extensions** to
   download the extensions CSV, and **Export > Ring Groups** for the ring
   groups CSV.
2. Go to this app's web page (`/`) and upload each CSV in its own section,
   using the password.
3. The app merges both files and serves a combined Yealink XML directory
   continuously at `/phonebook.xml`.
4. On each phone, enter this URL once under **Directory > Remote Phone
   Book > URL**.
5. When either list changes, just re-upload that one CSV — you never need
   to touch the phones again.

You can upload just Extensions, just Ring Groups, or both — whatever you
upload is combined into the directory.

## Deploying to Railway

1. Push this folder to a GitHub repository (or deploy directly with the
   Railway CLI).
2. On [railway.app](https://railway.app), choose **New Project > Deploy
   from GitHub repo**.
3. Select this repo — Railway will auto-detect `package.json` and deploy it
   as a Node.js app.
4. In the project's **Variables** tab, add:
   ```
   UPLOAD_PASSWORD=choose-a-strong-password
   PHONEBOOK_TOKEN=choose-a-long-random-key
   ```
   `PHONEBOOK_TOKEN` is **important** — without it, `/phonebook.xml` is
   public, and anyone who has the link can see your name/extension list.
   Choose an unpredictable value (24+ mixed characters, for example).
5. Once deployed, Railway gives you a URL, e.g.:
   ```
   https://yealink-phonebook-production.up.railway.app
   ```
6. Go to that address and upload your CSV(s). The directory is served
   (with the token) at:
   ```
   https://yealink-phonebook-production.up.railway.app/phonebook.xml?key=YOUR_PHONEBOOK_TOKEN
   ```
   Requests without `key=`, or with the wrong value, get a **403 Access
   denied** response.

## IMPORTANT: add a persistent disk (Volume)

Railway containers can reset their file system on restart. To avoid losing
the uploaded CSVs, create a **Volume** in the project settings and mount it
at `/app/data` (Settings > Volumes > New Volume, Mount Path: `/app/data`).
It works without this too, you'll just need to re-upload the CSV(s) after
every deploy/restart.

## Introducing the URL to phones (T48S)

Once per phone:
1. Open the phone's web interface (`http://<phone-ip>`, default admin/admin)
2. **Directory > Remote Phone Book** tab
3. **Remote URL**: `https://your-railway-address.up.railway.app/phonebook.xml?key=YOUR_PHONEBOOK_TOKEN`
4. **Display Name**: e.g. "Company Directory"
5. Confirm

To make the directory searchable while dialing (not just via the Directory
menu), also go to **Directory > Setting > Search Source List In Dialing**
and move "Remote Phone Book" into the enabled list.

## About the CSV formats

The script automatically looks for columns matching these common names:

**Extensions CSV**
- Number: `extension`, `ext`, `number`
- Name: `name`, `description`, `cidname`

**Ring Groups CSV**
- Number: `ringgroup`, `grpnum`, `extension`, `number`
- Name: `description`, `name`

If your FreePBX Bulk Handler export uses different exact column names and
the script can't match them, the upload page shows which headers it
couldn't find in the error message — then just add the relevant column name
to the `findColumn` candidates for that CSV in `server.js`.

## Testing locally

```bash
npm install
npm start
# go to http://localhost:3000
```

## Security notes

- Make sure to change `UPLOAD_PASSWORD` — don't use the default value.
- Make sure to define `PHONEBOOK_TOKEN`. Without it, anyone with the
  `/phonebook.xml` link can view your live name/extension list.
- Don't share the token with anyone; only use it when configuring phones.
  If you rotate the token, update it in Railway Variables and re-enter the
  new Remote URL on every phone.
- Don't include the Secret/Password column when exporting from FreePBX —
  the script doesn't read it, but you don't want it sitting in the file
  either way.
