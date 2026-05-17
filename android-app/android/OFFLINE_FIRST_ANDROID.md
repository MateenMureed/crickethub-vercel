# Cricket Hub Offline-First Android Blueprint

This document describes the native Android offline-first layer added to the APK project.

## 1) Room Database Schema

Database: `CricketHubDatabase` (`cricket_hub_offline.db`)

Tables:

- `matches`
  - `id` (PK)
  - `leagueId`, `teamAId`, `teamBId`
  - `teamAName`, `teamBName`, `teamALogo`, `teamBLogo`
  - `status`, `resultSummary`
  - `startsAtEpochMs`, `serverUpdatedAtEpochMs`, `cachedAtEpochMs`

- `teams`
  - `id` (PK)
  - `name`, `shortName`, `logoUrl`
  - `cachedAtEpochMs`

- `live_scores`
  - `matchId` (PK)
  - `scoreText`, `oversText`, `wickets`
  - `strikerName`, `nonStrikerName`, `bowlerName`, `lastBallText`
  - `serverUpdatedAtEpochMs`, `cachedAtEpochMs`

- `league_table`
  - Composite PK: `leagueId`, `teamId`
  - `teamName`, `position`, `played`, `won`, `lost`, `tied`, `noResult`, `points`, `netRunRate`
  - `cachedAtEpochMs`

## 2) Repository Pattern (Offline-First)

`OfflineRepository` exposes:

- `observeHomeSnapshot(): Flow<OfflineHomeSnapshot>`
  - Combines Room flows from all cached domains.
  - UI reads from local DB first for instant render.

- `refreshAll()`
  - Fetches remote data with Retrofit.
  - Maps DTOs -> Room entities.
  - Upserts data inside Room transaction.
  - This keeps refresh smooth and avoids full UI flicker.

## 3) Sync Logic (WorkManager)

`OfflineSyncWorker`:

- Uses `CoroutineWorker`.
- Calls `OfflineRepository.refreshAll()`.
- Returns `retry()` on transient failures.

`OfflineSyncScheduler`:

- `schedulePeriodic(context)`
  - 15-minute periodic sync with `NetworkType.CONNECTED` constraint.
- `scheduleOneTimeOnAppOpen(context)`
  - Triggers background refresh when app opens.
- `syncNow(context)`
  - Manual trigger for pull-to-refresh style actions.

Bootstrapping:

- `CricketHubApp` schedules periodic work on app start.
- `MainActivity` triggers one-time app-open sync.

## 4) Compose UI Integration

Files:

- `OfflineHomeViewModel.kt`
  - Collects Room snapshot flow.
  - Observes connectivity flow.
  - Triggers silent refresh on startup and when network returns.

- `OfflineHomeScreen.kt`
  - Shows subtle offline indicator.
  - Shows cached content immediately.
  - Shows lightweight skeleton cards during first install/no-cache state.

## 5) Connectivity Handling

`ConnectivityMonitor` uses `ConnectivityManager.NetworkCallback` + `Flow` to publish online/offline state.

Behavior:

- Offline: keep showing cached Room data.
- Online: auto-trigger silent sync.

## 6) Tech Stack Added

- Room
- Retrofit + Gson
- WorkManager
- Kotlin Coroutines + Flow
- MVVM (ViewModel + Repository)
- Compose UI primitives

## 7) Notes

Current app UI is Capacitor web-based. The native offline-first layer is now scaffolded and build-wired in Android for incremental migration or plugin-bridge integration.
