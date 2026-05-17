/*
  CricketHub DigitalOcean PostgreSQL schema
  Creates only database objects: schema, tables, constraints, indexes, triggers, and views.
  Run this inside an existing DigitalOcean Managed PostgreSQL database.
*/

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS app.users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username varchar(100) NOT NULL UNIQUE,
  password varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.leagues (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(200) NOT NULL,
  city varchar(120),
  venue varchar(200),
  organizer varchar(200),
  logo text,
  season varchar(50),
  format varchar(50) NOT NULL DEFAULT 'round-robin',
  overs_per_innings integer NOT NULL DEFAULT 20 CHECK (overs_per_innings > 0),
  status varchar(30) NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.sponsors (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_id integer NOT NULL REFERENCES app.leagues(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  logo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.teams (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_id integer NOT NULL REFERENCES app.leagues(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  logo text,
  captain_name varchar(200),
  captain_photo text,
  captain_id integer,
  squad_banner text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_teams_league_name UNIQUE (league_id, name)
);

CREATE TABLE IF NOT EXISTS app.players (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id integer NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  photo text,
  role varchar(50) NOT NULL DEFAULT 'batsman' CHECK (role IN ('batsman', 'bowler', 'all-rounder', 'all rounder', 'wicket-keeper', 'player')),
  jersey_number integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_teams_captain' AND conrelid = 'app.teams'::regclass
  ) THEN
    ALTER TABLE app.teams
      ADD CONSTRAINT fk_teams_captain FOREIGN KEY (captain_id) REFERENCES app.players(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app.matches (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_id integer NOT NULL REFERENCES app.leagues(id) ON DELETE CASCADE,
  team_a_id integer NOT NULL REFERENCES app.teams(id),
  team_b_id integer NOT NULL REFERENCES app.teams(id),
  match_number integer,
  match_date date,
  match_time time(0),
  venue varchar(200),
  status varchar(30) NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'completed', 'cancelled')),
  toss_winner_id integer REFERENCES app.teams(id),
  toss_decision varchar(10) CHECK (toss_decision IS NULL OR toss_decision IN ('bat', 'bowl')),
  result_summary text,
  winner_id integer REFERENCES app.teams(id),
  man_of_match_id integer REFERENCES app.players(id),
  overs_per_innings integer NOT NULL DEFAULT 20 CHECK (overs_per_innings > 0),
  is_super_over boolean NOT NULL DEFAULT false,
  parent_match_id integer REFERENCES app.matches(id) ON DELETE SET NULL,
  target_runs integer CHECK (target_runs IS NULL OR target_runs > 0),
  points_awarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_matches_different_teams CHECK (team_a_id <> team_b_id),
  CONSTRAINT uq_matches_league_match_number UNIQUE (league_id, match_number)
);

CREATE TABLE IF NOT EXISTS app.innings (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  match_id integer NOT NULL REFERENCES app.matches(id) ON DELETE CASCADE,
  batting_team_id integer NOT NULL REFERENCES app.teams(id),
  bowling_team_id integer NOT NULL REFERENCES app.teams(id),
  innings_number integer NOT NULL CHECK (innings_number IN (1, 2)),
  total_runs integer NOT NULL DEFAULT 0 CHECK (total_runs >= 0),
  total_wickets integer NOT NULL DEFAULT 0 CHECK (total_wickets BETWEEN 0 AND 10),
  total_overs numeric(5,1) NOT NULL DEFAULT 0 CHECK (total_overs >= 0),
  total_balls integer NOT NULL DEFAULT 0 CHECK (total_balls >= 0),
  extras_wides integer NOT NULL DEFAULT 0 CHECK (extras_wides >= 0),
  extras_noballs integer NOT NULL DEFAULT 0 CHECK (extras_noballs >= 0),
  extras_byes integer NOT NULL DEFAULT 0 CHECK (extras_byes >= 0),
  extras_legbyes integer NOT NULL DEFAULT 0 CHECK (extras_legbyes >= 0),
  is_completed boolean NOT NULL DEFAULT false,
  striker_id integer REFERENCES app.players(id),
  non_striker_id integer REFERENCES app.players(id),
  current_bowler_id integer REFERENCES app.players(id),
  last_over_bowler_id integer REFERENCES app.players(id),
  target_runs integer CHECK (target_runs IS NULL OR target_runs > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_innings_teams CHECK (batting_team_id <> bowling_team_id),
  CONSTRAINT uq_innings_match_number UNIQUE (match_id, innings_number)
);

CREATE TABLE IF NOT EXISTS app.ball_events (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  innings_id integer NOT NULL REFERENCES app.innings(id) ON DELETE CASCADE,
  over_number integer NOT NULL CHECK (over_number >= 0),
  ball_number integer NOT NULL CHECK (ball_number > 0),
  batsman_id integer NOT NULL REFERENCES app.players(id),
  bowler_id integer NOT NULL REFERENCES app.players(id),
  runs_scored integer NOT NULL DEFAULT 0 CHECK (runs_scored >= 0),
  is_boundary_four boolean NOT NULL DEFAULT false,
  is_boundary_six boolean NOT NULL DEFAULT false,
  extras_type varchar(20) CHECK (extras_type IS NULL OR extras_type IN ('wide', 'noball', 'bye', 'legbye')),
  extras_runs integer NOT NULL DEFAULT 0 CHECK (extras_runs >= 0),
  is_wicket boolean NOT NULL DEFAULT false,
  wicket_type varchar(50),
  dismissed_player_id integer REFERENCES app.players(id),
  dismissed_end varchar(20) CHECK (dismissed_end IS NULL OR dismissed_end IN ('striker', 'non-striker')),
  incoming_batsman_id integer REFERENCES app.players(id),
  total_runs integer NOT NULL DEFAULT 0 CHECK (total_runs >= 0),
  striker_before integer REFERENCES app.players(id),
  non_striker_before integer REFERENCES app.players(id),
  current_bowler_before integer REFERENCES app.players(id),
  last_over_bowler_before integer REFERENCES app.players(id),
  total_runs_before integer,
  total_wickets_before integer,
  total_balls_before integer,
  total_overs_before numeric(5,1),
  striker_after integer REFERENCES app.players(id),
  non_striker_after integer REFERENCES app.players(id),
  current_bowler_after integer REFERENCES app.players(id),
  last_over_bowler_after integer REFERENCES app.players(id),
  total_runs_after integer,
  total_wickets_after integer,
  total_balls_after integer,
  total_overs_after numeric(5,1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app.batting_scores (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  innings_id integer NOT NULL REFERENCES app.innings(id) ON DELETE CASCADE,
  player_id integer NOT NULL REFERENCES app.players(id),
  runs integer NOT NULL DEFAULT 0 CHECK (runs >= 0),
  balls_faced integer NOT NULL DEFAULT 0 CHECK (balls_faced >= 0),
  fours integer NOT NULL DEFAULT 0 CHECK (fours >= 0),
  sixes integer NOT NULL DEFAULT 0 CHECK (sixes >= 0),
  is_out boolean NOT NULL DEFAULT false,
  dismissal_type varchar(50),
  dismissal_bowler_id integer REFERENCES app.players(id),
  dismissal_fielder_id integer REFERENCES app.players(id),
  batting_order integer NOT NULL DEFAULT 0 CHECK (batting_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_batting_scores_innings_player UNIQUE (innings_id, player_id)
);

CREATE TABLE IF NOT EXISTS app.bowling_scores (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  innings_id integer NOT NULL REFERENCES app.innings(id) ON DELETE CASCADE,
  player_id integer NOT NULL REFERENCES app.players(id),
  overs_bowled numeric(5,1) NOT NULL DEFAULT 0 CHECK (overs_bowled >= 0),
  balls_bowled integer NOT NULL DEFAULT 0 CHECK (balls_bowled >= 0),
  maidens integer NOT NULL DEFAULT 0 CHECK (maidens >= 0),
  runs_conceded integer NOT NULL DEFAULT 0 CHECK (runs_conceded >= 0),
  wickets integer NOT NULL DEFAULT 0 CHECK (wickets >= 0),
  wides integer NOT NULL DEFAULT 0 CHECK (wides >= 0),
  noballs integer NOT NULL DEFAULT 0 CHECK (noballs >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bowling_scores_innings_player UNIQUE (innings_id, player_id)
);

CREATE TABLE IF NOT EXISTS app.points_table (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_id integer NOT NULL REFERENCES app.leagues(id) ON DELETE CASCADE,
  team_id integer NOT NULL REFERENCES app.teams(id) ON DELETE CASCADE,
  matches_played integer NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses integer NOT NULL DEFAULT 0 CHECK (losses >= 0),
  ties integer NOT NULL DEFAULT 0 CHECK (ties >= 0),
  no_results integer NOT NULL DEFAULT 0 CHECK (no_results >= 0),
  points integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  nrr numeric(8,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_points_league_team UNIQUE (league_id, team_id)
);

CREATE INDEX IF NOT EXISTS ix_sponsors_league_id ON app.sponsors(league_id);
CREATE INDEX IF NOT EXISTS ix_teams_league_id ON app.teams(league_id);
CREATE INDEX IF NOT EXISTS ix_players_team_id ON app.players(team_id);
CREATE INDEX IF NOT EXISTS ix_matches_league_status ON app.matches(league_id, status);
CREATE INDEX IF NOT EXISTS ix_matches_status_date ON app.matches(status, match_date, match_time);
CREATE INDEX IF NOT EXISTS ix_innings_match_id ON app.innings(match_id);
CREATE INDEX IF NOT EXISTS ix_ball_events_innings_id_id ON app.ball_events(innings_id, id);
CREATE INDEX IF NOT EXISTS ix_batting_scores_innings_id ON app.batting_scores(innings_id);
CREATE INDEX IF NOT EXISTS ix_bowling_scores_innings_id ON app.bowling_scores(innings_id);
CREATE INDEX IF NOT EXISTS ix_points_league_points ON app.points_table(league_id, points DESC, nrr DESC);

DROP TRIGGER IF EXISTS trg_users_touch_updated_at ON app.users;
CREATE TRIGGER trg_users_touch_updated_at BEFORE UPDATE ON app.users FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
DROP TRIGGER IF EXISTS trg_leagues_touch_updated_at ON app.leagues;
CREATE TRIGGER trg_leagues_touch_updated_at BEFORE UPDATE ON app.leagues FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
DROP TRIGGER IF EXISTS trg_sponsors_touch_updated_at ON app.sponsors;
CREATE TRIGGER trg_sponsors_touch_updated_at BEFORE UPDATE ON app.sponsors FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
DROP TRIGGER IF EXISTS trg_teams_touch_updated_at ON app.teams;
CREATE TRIGGER trg_teams_touch_updated_at BEFORE UPDATE ON app.teams FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
DROP TRIGGER IF EXISTS trg_players_touch_updated_at ON app.players;
CREATE TRIGGER trg_players_touch_updated_at BEFORE UPDATE ON app.players FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
DROP TRIGGER IF EXISTS trg_matches_touch_updated_at ON app.matches;
CREATE TRIGGER trg_matches_touch_updated_at BEFORE UPDATE ON app.matches FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
DROP TRIGGER IF EXISTS trg_innings_touch_updated_at ON app.innings;
CREATE TRIGGER trg_innings_touch_updated_at BEFORE UPDATE ON app.innings FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
DROP TRIGGER IF EXISTS trg_batting_scores_touch_updated_at ON app.batting_scores;
CREATE TRIGGER trg_batting_scores_touch_updated_at BEFORE UPDATE ON app.batting_scores FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
DROP TRIGGER IF EXISTS trg_bowling_scores_touch_updated_at ON app.bowling_scores;
CREATE TRIGGER trg_bowling_scores_touch_updated_at BEFORE UPDATE ON app.bowling_scores FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
DROP TRIGGER IF EXISTS trg_points_table_touch_updated_at ON app.points_table;
CREATE TRIGGER trg_points_table_touch_updated_at BEFORE UPDATE ON app.points_table FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

CREATE OR REPLACE VIEW app.v_leagues AS
SELECT
  l.*,
  COUNT(DISTINCT t.id)::integer AS team_count,
  COUNT(DISTINCT m.id)::integer AS match_count
FROM app.leagues l
LEFT JOIN app.teams t ON t.league_id = l.id
LEFT JOIN app.matches m ON m.league_id = l.id
GROUP BY l.id;

CREATE OR REPLACE VIEW app.v_matches AS
SELECT
  m.*,
  to_char(m.match_date, 'YYYY-MM-DD') AS date,
  to_char(m.match_time, 'HH24:MI') AS time,
  l.name AS league_name,
  l.season,
  ta.name AS team_a_name,
  ta.logo AS team_a_logo,
  ta.captain_name AS team_a_captain,
  ta.captain_photo AS team_a_captain_photo,
  tb.name AS team_b_name,
  tb.logo AS team_b_logo,
  tb.captain_name AS team_b_captain,
  tb.captain_photo AS team_b_captain_photo,
  mom.name AS mom_name,
  mom.photo AS mom_photo
FROM app.matches m
JOIN app.leagues l ON l.id = m.league_id
JOIN app.teams ta ON ta.id = m.team_a_id
JOIN app.teams tb ON tb.id = m.team_b_id
LEFT JOIN app.players mom ON mom.id = m.man_of_match_id;

CREATE OR REPLACE VIEW app.v_points AS
SELECT
  p.*,
  t.name,
  t.logo
FROM app.points_table p
JOIN app.teams t ON t.id = p.team_id;

CREATE OR REPLACE VIEW app.v_scorecard_batting AS
SELECT
  bs.*,
  p.name AS player_name,
  p.photo,
  p.role,
  bowler.name AS bowler_name,
  fielder.name AS fielder_name
FROM app.batting_scores bs
JOIN app.players p ON p.id = bs.player_id
LEFT JOIN app.players bowler ON bowler.id = bs.dismissal_bowler_id
LEFT JOIN app.players fielder ON fielder.id = bs.dismissal_fielder_id;

CREATE OR REPLACE VIEW app.v_scorecard_bowling AS
SELECT
  bw.*,
  p.name AS player_name,
  p.photo
FROM app.bowling_scores bw
JOIN app.players p ON p.id = bw.player_id;

CREATE OR REPLACE VIEW app.v_player_batting_totals AS
SELECT
  p.id,
  p.name,
  p.photo,
  p.role,
  t.id AS team_id,
  t.name AS team_name,
  t.logo AS team_logo,
  COALESCE(SUM(CASE WHEN m.status = 'completed' THEN bs.runs ELSE 0 END), 0)::integer AS total_runs,
  COALESCE(SUM(CASE WHEN m.status = 'completed' THEN bs.balls_faced ELSE 0 END), 0)::integer AS total_balls,
  COALESCE(SUM(CASE WHEN m.status = 'completed' THEN bs.fours ELSE 0 END), 0)::integer AS total_fours,
  COALESCE(SUM(CASE WHEN m.status = 'completed' THEN bs.sixes ELSE 0 END), 0)::integer AS total_sixes
FROM app.players p
JOIN app.teams t ON t.id = p.team_id
LEFT JOIN app.batting_scores bs ON bs.player_id = p.id
LEFT JOIN app.innings i ON i.id = bs.innings_id
LEFT JOIN app.matches m ON m.id = i.match_id
GROUP BY p.id, p.name, p.photo, p.role, t.id, t.name, t.logo;

CREATE OR REPLACE VIEW app.v_player_bowling_totals AS
SELECT
  p.id,
  p.name,
  p.photo,
  p.role,
  t.id AS team_id,
  t.name AS team_name,
  t.logo AS team_logo,
  COALESCE(SUM(CASE WHEN m.status = 'completed' THEN bw.balls_bowled ELSE 0 END), 0)::integer AS total_balls,
  COALESCE(SUM(CASE WHEN m.status = 'completed' THEN bw.runs_conceded ELSE 0 END), 0)::integer AS total_runs_conceded,
  COALESCE(SUM(CASE WHEN m.status = 'completed' THEN bw.wickets ELSE 0 END), 0)::integer AS total_wickets
FROM app.players p
JOIN app.teams t ON t.id = p.team_id
LEFT JOIN app.bowling_scores bw ON bw.player_id = p.id
LEFT JOIN app.innings i ON i.id = bw.innings_id
LEFT JOIN app.matches m ON m.id = i.match_id
GROUP BY p.id, p.name, p.photo, p.role, t.id, t.name, t.logo;
