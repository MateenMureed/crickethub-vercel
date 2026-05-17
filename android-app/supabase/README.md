# CricketHub Supabase Free Database Setup

Supabase is the best free fit for this app because it gives you hosted PostgreSQL. Your CricketHub schema is relational: leagues, teams, players, matches, innings, balls, scorecards, and points tables.

## Important APK Rule

Do not put the Supabase database password inside the APK.

Use this shape:

```text
APK -> backend API -> Supabase PostgreSQL
```

The APK can call your existing API URL. The backend should connect to Supabase using the database connection string or Supabase service role key.

## Step 1: Create Free Supabase Project

1. Go to https://supabase.com
2. Sign in or create an account.
3. Click **New project**.
4. Choose your organization.
5. Set project name: `crickethub`
6. Set a strong database password.
7. Choose the nearest region.
8. Create project.

Wait until the project is ready.

## Step 2: Run The Schema

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Click **New query**.
4. Open this local file:

```text
supabase/001_create_crickethub_schema.sql
```

5. Copy all SQL.
6. Paste into Supabase SQL Editor.
7. Click **Run**.

This creates:

- `app.remote_state`
- `app.users`
- `app.leagues`
- `app.sponsors`
- `app.teams`
- `app.players`
- `app.matches`
- `app.innings`
- `app.ball_events`
- `app.batting_scores`
- `app.bowling_scores`
- `app.points_table`

It also creates views:

- `app.v_leagues`
- `app.v_matches`
- `app.v_points`
- `app.v_scorecard_batting`
- `app.v_scorecard_bowling`
- `app.v_player_batting_totals`
- `app.v_player_bowling_totals`

## Step 3: Check Tables

In Supabase:

1. Go to **Table Editor**.
2. Change schema from `public` to `app`.
3. Confirm the CricketHub tables are visible.

## Step 4: Get Backend Connection String

1. Go to **Project Settings**.
2. Open **Database**.
3. Open **Connection string** or **Connect**.
4. Copy the PostgreSQL connection string.

It looks like:

```text
postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
```

For backend hosting, use environment variables:

```env
DATABASE_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
SUPABASE_STATE_ID=state-default
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

Keep `SUPABASE_SERVICE_ROLE_KEY` only on the backend. Never put it in the APK.

## Step 5: Make APK Use Remote Data

Your APK already reads API URLs like:

```env
VITE_ANDROID_BACKEND_URL=https://your-backend.example.com/api
```

So the final shape is:

```text
APK calls VITE_ANDROID_BACKEND_URL
Backend reads/writes Supabase PostgreSQL
Supabase stores all CricketHub tables
```

The backend in `deploy_site/server/database.js` now uses Supabase automatically when `DATABASE_URL` or `SUPABASE_DB_URL` is set. It stores the existing app API state in `app.remote_state`, so the APK can keep using the same backend endpoints.

## Official Supabase Docs

- SQL Editor/database docs: https://supabase.com/docs/guides/database
- Connection strings: https://supabase.com/docs/reference/postgres/connection-strings
