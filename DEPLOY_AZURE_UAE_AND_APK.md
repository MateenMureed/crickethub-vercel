# CricketHub: GitHub + Azure UAE + APK Deployment

## 1. Create GitHub repository and push code
Run from project root:

```powershell
pwsh .\scripts\setup-github.ps1 -RepoName crickethub-league -Visibility public
```

## 2. Azure login (CLI)
```powershell
az login
```

## 3. Deploy website + API + Azure Cosmos DB in UAE region
This deploys in `uaenorth` by default.

```powershell
pwsh .\scripts\azure-deploy-uae.ps1 `
  -ResourceGroup rg-crickethub-uae `
  -WebAppName cricket-hub `
  -CosmosAccountName crickethubuaecosmos
```

### Android-only backend (separate from website)
Use a separate Web App + Cosmos account + app scope for Android:

```powershell
.\scripts\azure-deploy-uae.ps1 `
  -ResourceGroup rg-cricket-android-uae `
  -WebAppName cricket-android `
  -CosmosAccountName cricketandroidcosmos `
  -AppScope android
```

After deployment, your website and API will be available at:
- `https://<WebAppName>.azurewebsites.net`

## 4. Build Android APK using the hosted Azure website/API
Use the same deployed URL so APK and website use the same Azure DB through backend API.

```powershell
pwsh .\scripts\build-android-apk.ps1 -HostedUrl https://cricket-hub.azurewebsites.net
```

For Android-only backend:

```powershell
.\scripts\build-android-apk.ps1 -HostedUrl https://cricket-android.azurewebsites.net
```

APK output path:
- `android-app/android/app/build/outputs/apk/debug/app-debug.apk`

## Notes
- Ensure Android SDK + Java are installed before APK build.
- For release APK/AAB, open `android-app/android` in Android Studio and build signed artifact.
- App Service `ALLOWED_ORIGINS` is set to your Azure site URL in the deploy script.
- Cosmos DB is used as cloud state store via environment settings.
