# CricketHub Azure SQL Schema

This folder contains a database-only Azure SQL schema for the CricketHub APK/backend data model.
It does not deploy the app and does not create any Azure resources.

## Important

Azure cannot host a database without an Azure account/subscription, even if the database is on a free tier. A hosted Azure SQL Database is still an Azure resource.

This repo now has the schema ready. When you later have access to a free Azure SQL Database, run:

```powershell
sqlcmd -S <server>.database.windows.net -d <database> -U <admin-user> -P <password> -i .\azure\sql\001_create_crickethub_schema.sql
```

If you use Azure Portal Query Editor, open `001_create_crickethub_schema.sql`, paste it into the editor, and run it against your empty database.

## Tables Created

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

## Views Created

- `app.v_leagues`
- `app.v_matches`
- `app.v_points`
- `app.v_scorecard_batting`
- `app.v_scorecard_bowling`
- `app.v_player_batting_totals`
- `app.v_player_bowling_totals`

## APK Note

An APK should not connect directly to Azure SQL with database credentials. The safe pattern is:

APK -> backend API -> Azure SQL

The current app already calls an API URL, so this schema is for the remote API database layer.
