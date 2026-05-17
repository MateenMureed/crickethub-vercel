# CricketHub DigitalOcean PostgreSQL

This folder contains the DigitalOcean database-only setup for the CricketHub app schema.
It creates PostgreSQL tables/views for the remote data layer. It does not deploy the app.

## Cost Note

DigitalOcean Managed PostgreSQL is a paid resource unless you have active DigitalOcean trial/free credits. The script uses the smallest documented managed PostgreSQL size:

```powershell
db-s-1vcpu-1gb
```

DigitalOcean docs show the managed database CLI command shape:

```powershell
doctl databases create example-database --region nyc1 --size db-s-1vcpu-1gb --num-nodes 1
```

Docs:

- https://docs.digitalocean.com/reference/doctl/reference/databases/create/
- https://docs.digitalocean.com/products/databases/postgresql/how-to/create/

## Files

- `001_create_crickethub_schema.sql`: full PostgreSQL schema for the app.
- `create-managed-postgres.ps1`: creates a DigitalOcean Managed PostgreSQL cluster and a `crickethub` database.
- `apply-schema.ps1`: applies the schema to the DigitalOcean database.

## Create Database Cluster

Install and authenticate `doctl` first:

```powershell
doctl auth init
```

Create the managed PostgreSQL database:

```powershell
.\digitalocean\postgres\create-managed-postgres.ps1 -ClusterName crickethub-db -Region nyc1 -DatabaseName crickethub
```

Apply the app schema:

```powershell
.\digitalocean\postgres\apply-schema.ps1 -ClusterName crickethub-db -DatabaseName crickethub
```

## Tables

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

## Views

- `app.v_leagues`
- `app.v_matches`
- `app.v_points`
- `app.v_scorecard_batting`
- `app.v_scorecard_bowling`
- `app.v_player_batting_totals`
- `app.v_player_bowling_totals`

## APK Architecture

Do not put the PostgreSQL username/password inside the APK. The safe production path is:

```text
APK -> backend API -> DigitalOcean PostgreSQL
```

Your current app already calls API endpoints, so the database should sit behind that API. This folder prepares the remote database layer only.
