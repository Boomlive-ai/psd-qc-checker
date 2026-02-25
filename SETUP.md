# PSD QC Checker – Setup Guide

## Prerequisites
- Node.js 18+ and npm
- A Google Cloud project (free tier is fine)

---

## 1. Install dependencies

```bash
cd psd-qc-checker
npm install
```

---

## 2. Google Cloud Console setup

### 2a. Create a project
1. Go to https://console.cloud.google.com/
2. Create a new project (or select an existing one).

### 2b. Enable APIs
In **APIs & Services → Library**, enable:
- **Google Drive API**
- **Google Picker API**

### 2c. Configure OAuth consent screen
1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** user type.
3. Fill in App name, support email, etc.
4. Under **Scopes**, add:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/drive.readonly`
5. Under **Test users**, add the Google accounts that will use the app during development.

### 2d. Create OAuth 2.0 Client ID
1. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins**: `http://localhost:3000`
4. **Authorized redirect URIs**: `http://localhost:3000/api/auth/callback/google`
5. Copy the **Client ID** and **Client Secret**.

### 2e. Create an API Key (for Google Picker)
1. Go to **APIs & Services → Credentials → Create Credentials → API key**.
2. (Optional) Restrict the key to **Google Picker API** only.
3. Copy the **API key**.

### 2f. Find your Project Number (Picker App ID)
1. Go to the Cloud Console **Dashboard**.
2. Your **Project number** is shown under Project info (it's numeric, e.g. `123456789`).

---

## 3. Configure environment variables

Copy the example file and fill in values:

```bash
cp .env.local.example .env.local
```

Fill in `.env.local`:
```
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-client-secret>
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<random-string>
NEXT_PUBLIC_GOOGLE_PICKER_API_KEY=<your-api-key>
NEXT_PUBLIC_GOOGLE_PICKER_APP_ID=<your-project-number>
```

Generate a `NEXTAUTH_SECRET`:
```bash
openssl rand -base64 32
```
Or use any secure random string generator.

---

## 4. Run the dev server

```bash
npm run dev
```

Open http://localhost:3000.

- **Local Upload**: Drag & drop PSD files or click "browse".
- **Google Drive**: Click "Connect Google", sign in, then "Pick from Drive" to select PSD files.

---

## 5. Deploy to Vercel

### 5a. Push to GitHub and import in Vercel
1. Push this repo to GitHub.
2. Go to https://vercel.com/ and import the repo.
3. Set all environment variables from `.env.local` in Vercel's project settings.

### 5b. Update environment variables for production
- Set `NEXTAUTH_URL` to your production URL (e.g. `https://psd-qc-checker.vercel.app`).

### 5c. Update Google Cloud Console
Add these to your OAuth 2.0 Client ID:
- **Authorized JavaScript origins**: `https://psd-qc-checker.vercel.app`
- **Authorized redirect URIs**: `https://psd-qc-checker.vercel.app/api/auth/callback/google`

If you use a custom domain, add that too.

---

## Validation rules summary

| Check | Requirement | Fail reason |
|-------|------------|-------------|
| Signature | First 4 bytes = `8BPS` | "Not a PSD signature" |
| File size | ≤ 200 MB | "File too large" |
| Resolution | ≥ 2.0 MP | "Resolution below 2MP" |
| Layers | ≥ 3 layers | "Less than 3 layers" |
| Preferred | ≥ 16.0 MP | Shows "16 MP+" badge (info only, not a fail) |
