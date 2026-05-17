param(
  [Parameter(Mandatory = $true)][string]$HostedUrl
)

$ErrorActionPreference = 'Stop'

if (-not $HostedUrl.StartsWith('http')) {
  throw "HostedUrl must be a full URL (https://...)."
}

Push-Location android-app

Write-Host "Installing Android app dependencies..."
npm install

if (-not (Test-Path android)) {
  Write-Host "Adding Capacitor Android project..."
  npx cap add android
}

$sdkPath = Join-Path $env:LOCALAPPDATA "Android\Sdk"
if (Test-Path $sdkPath) {
  $sdkPathForGradle = $sdkPath.Replace('\', '/')
  Set-Content -Path "android\local.properties" -Value "sdk.dir=$sdkPathForGradle"
  $env:ANDROID_HOME = $sdkPath
  Write-Host "Android SDK configured at: $sdkPath"
}

$env:VITE_ANDROID_BACKEND_URL = $HostedUrl
$env:VITE_BACKEND_URL = $HostedUrl

Write-Host "Building web assets and syncing Capacitor..."
npm run build
npx cap sync android

Write-Host "Building debug APK..."
Push-Location android
./gradlew.bat assembleDebug
Pop-Location

$apkPath = Join-Path (Get-Location) "android\app\build\outputs\apk\debug\app-debug.apk"
if (-not (Test-Path $apkPath)) {
  throw "APK build finished but app-debug.apk was not found at $apkPath"
}
Write-Host "APK created: $apkPath"

Pop-Location
