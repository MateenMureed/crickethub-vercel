# Vercel + APK deployment

The repository root is the Vercel project. Vite serves the web app from `dist/`; `api/index.js` and `api/[...path].js` expose the existing Express API. Vercel Functions are designed to scale automatically with traffic [Vercel Functions](https://vercel.com/docs/functions).

## Vercel setup

1. Import this repository into Vercel. Keep the root directory as the repository root.
2. Use the Vite preset, build command `npm run build`, and output directory `dist`.
3. Connect an Upstash Redis database from Vercel Marketplace. Confirm these variables exist:
   `KV_REST_API_URL`, `KV_REST_API_TOKEN`.
4. Add `KV_STATE_KEY=crickethub:state`.
5. Add these Cloudinary variables for Production and Preview:
   `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
   Keep them server-only; never prefix them with `VITE_` or put them in the APK.
6. Deploy and test:

```text
https://your-project.vercel.app/
https://your-project.vercel.app/api/stats/dashboard
https://your-project.vercel.app/api/leagues
```

The API URLs must return JSON. Create a test record and reload it to confirm Redis persistence. New uploads should return secure Cloudinary URLs.

Vercel environment variables are encrypted and apply to new deployments [Environment Variables](https://vercel.com/docs/environment-variables).

## APK build

Create `android-app/.env.production` (this file is Git-ignored):

```env
VITE_ANDROID_BACKEND_URL=https://your-project.vercel.app/api
```

Then run:

```powershell
Set-Location android-app
npm install
npm run apk:debug
```

APK output:
`android-app/android/app/build/outputs/apk/debug/app-debug.apk`

Install it on a device and test login, live match refresh, scoring writes, and image uploads while online. The APK embeds the URL at build time, so rebuild it whenever the production domain changes.

## Updates

Push to the connected production branch to redeploy. If environment variables change, redeploy because they do not alter old deployments. Do not use the Vercel filesystem for durable data; Redis is the source of truth.
