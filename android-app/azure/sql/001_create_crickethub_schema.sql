/*
  CricketHub Azure SQL schema
  Creates only database objects: tables, constraints, indexes, and views.
  Run this inside an existing Azure SQL Database. It does not create Azure resources.
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF SCHEMA_ID(N'app') IS NULL
    EXEC(N'CREATE SCHEMA app');
GO

CREATE TABLE app.users (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_users PRIMARY KEY,
    username NVARCHAR(100) NOT NULL,
    [password] NVARCHAR(255) NOT NULL,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_users_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_users_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_users_username UNIQUE (username)
);
GO

CREATE TABLE app.leagues (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_leagues PRIMARY KEY,
    name NVARCHAR(200) NOT NULL,
    city NVARCHAR(120) NULL,
    venue NVARCHAR(200) NULL,
    organizer NVARCHAR(200) NULL,
    logo NVARCHAR(1000) NULL,
    season NVARCHAR(50) NULL,
    format NVARCHAR(50) NOT NULL CONSTRAINT df_leagues_format DEFAULT N'round-robin',
    overs_per_innings INT NOT NULL CONSTRAINT df_leagues_overs DEFAULT 20,
    status NVARCHAR(30) NOT NULL CONSTRAINT df_leagues_status DEFAULT N'upcoming',
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_leagues_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_leagues_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT ck_leagues_overs CHECK (overs_per_innings > 0),
    CONSTRAINT ck_leagues_status CHECK (status IN (N'upcoming', N'active', N'completed', N'cancelled'))
);
GO

CREATE TABLE app.sponsors (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_sponsors PRIMARY KEY,
    league_id INT NOT NULL,
    name NVARCHAR(200) NOT NULL,
    logo NVARCHAR(1000) NULL,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_sponsors_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_sponsors_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_sponsors_leagues FOREIGN KEY (league_id) REFERENCES app.leagues(id)
);
GO

CREATE TABLE app.teams (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_teams PRIMARY KEY,
    league_id INT NOT NULL,
    name NVARCHAR(200) NOT NULL,
    logo NVARCHAR(1000) NULL,
    captain_name NVARCHAR(200) NULL,
    captain_photo NVARCHAR(1000) NULL,
    captain_id INT NULL,
    squad_banner NVARCHAR(1000) NULL,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_teams_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_teams_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_teams_leagues FOREIGN KEY (league_id) REFERENCES app.leagues(id),
    CONSTRAINT uq_teams_league_name UNIQUE (league_id, name)
);
GO

CREATE TABLE app.players (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_players PRIMARY KEY,
    team_id INT NOT NULL,
    name NVARCHAR(200) NOT NULL,
    photo NVARCHAR(1000) NULL,
    role NVARCHAR(50) NOT NULL CONSTRAINT df_players_role DEFAULT N'batsman',
    jersey_number INT NULL CONSTRAINT df_players_jersey DEFAULT 0,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_players_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_players_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_players_teams FOREIGN KEY (team_id) REFERENCES app.teams(id),
    CONSTRAINT ck_players_role CHECK (role IN (N'batsman', N'bowler', N'all-rounder', N'all rounder', N'wicket-keeper', N'player'))
);
GO

ALTER TABLE app.teams
    ADD CONSTRAINT fk_teams_captain FOREIGN KEY (captain_id) REFERENCES app.players(id);
GO

CREATE TABLE app.matches (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_matches PRIMARY KEY,
    league_id INT NOT NULL,
    team_a_id INT NOT NULL,
    team_b_id INT NOT NULL,
    match_number INT NULL,
    match_date DATE NULL,
    match_time TIME(0) NULL,
    venue NVARCHAR(200) NULL,
    status NVARCHAR(30) NOT NULL CONSTRAINT df_matches_status DEFAULT N'upcoming',
    toss_winner_id INT NULL,
    toss_decision NVARCHAR(10) NULL,
    result_summary NVARCHAR(1000) NULL,
    winner_id INT NULL,
    man_of_match_id INT NULL,
    overs_per_innings INT NOT NULL CONSTRAINT df_matches_overs DEFAULT 20,
    is_super_over BIT NOT NULL CONSTRAINT df_matches_super_over DEFAULT 0,
    parent_match_id INT NULL,
    target_runs INT NULL,
    points_awarded BIT NOT NULL CONSTRAINT df_matches_points_awarded DEFAULT 0,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_matches_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_matches_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_matches_leagues FOREIGN KEY (league_id) REFERENCES app.leagues(id),
    CONSTRAINT fk_matches_team_a FOREIGN KEY (team_a_id) REFERENCES app.teams(id),
    CONSTRAINT fk_matches_team_b FOREIGN KEY (team_b_id) REFERENCES app.teams(id),
    CONSTRAINT fk_matches_toss_winner FOREIGN KEY (toss_winner_id) REFERENCES app.teams(id),
    CONSTRAINT fk_matches_winner FOREIGN KEY (winner_id) REFERENCES app.teams(id),
    CONSTRAINT fk_matches_man_of_match FOREIGN KEY (man_of_match_id) REFERENCES app.players(id),
    CONSTRAINT fk_matches_parent FOREIGN KEY (parent_match_id) REFERENCES app.matches(id),
    CONSTRAINT ck_matches_different_teams CHECK (team_a_id <> team_b_id),
    CONSTRAINT ck_matches_status CHECK (status IN (N'upcoming', N'live', N'completed', N'cancelled')),
    CONSTRAINT ck_matches_toss_decision CHECK (toss_decision IS NULL OR toss_decision IN (N'bat', N'bowl')),
    CONSTRAINT ck_matches_overs CHECK (overs_per_innings > 0),
    CONSTRAINT ck_matches_target CHECK (target_runs IS NULL OR target_runs > 0),
    CONSTRAINT uq_matches_league_match_number UNIQUE (league_id, match_number)
);
GO

CREATE TABLE app.innings (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_innings PRIMARY KEY,
    match_id INT NOT NULL,
    batting_team_id INT NOT NULL,
    bowling_team_id INT NOT NULL,
    innings_number INT NOT NULL,
    total_runs INT NOT NULL CONSTRAINT df_innings_runs DEFAULT 0,
    total_wickets INT NOT NULL CONSTRAINT df_innings_wickets DEFAULT 0,
    total_overs DECIMAL(5,1) NOT NULL CONSTRAINT df_innings_overs DEFAULT 0,
    total_balls INT NOT NULL CONSTRAINT df_innings_balls DEFAULT 0,
    extras_wides INT NOT NULL CONSTRAINT df_innings_wides DEFAULT 0,
    extras_noballs INT NOT NULL CONSTRAINT df_innings_noballs DEFAULT 0,
    extras_byes INT NOT NULL CONSTRAINT df_innings_byes DEFAULT 0,
    extras_legbyes INT NOT NULL CONSTRAINT df_innings_legbyes DEFAULT 0,
    is_completed BIT NOT NULL CONSTRAINT df_innings_completed DEFAULT 0,
    striker_id INT NULL,
    non_striker_id INT NULL,
    current_bowler_id INT NULL,
    last_over_bowler_id INT NULL,
    target_runs INT NULL,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_innings_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_innings_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_innings_matches FOREIGN KEY (match_id) REFERENCES app.matches(id),
    CONSTRAINT fk_innings_batting_team FOREIGN KEY (batting_team_id) REFERENCES app.teams(id),
    CONSTRAINT fk_innings_bowling_team FOREIGN KEY (bowling_team_id) REFERENCES app.teams(id),
    CONSTRAINT fk_innings_striker FOREIGN KEY (striker_id) REFERENCES app.players(id),
    CONSTRAINT fk_innings_non_striker FOREIGN KEY (non_striker_id) REFERENCES app.players(id),
    CONSTRAINT fk_innings_current_bowler FOREIGN KEY (current_bowler_id) REFERENCES app.players(id),
    CONSTRAINT fk_innings_last_over_bowler FOREIGN KEY (last_over_bowler_id) REFERENCES app.players(id),
    CONSTRAINT ck_innings_number CHECK (innings_number IN (1, 2)),
    CONSTRAINT ck_innings_teams CHECK (batting_team_id <> bowling_team_id),
    CONSTRAINT ck_innings_runs CHECK (total_runs >= 0),
    CONSTRAINT ck_innings_wickets CHECK (total_wickets BETWEEN 0 AND 10),
    CONSTRAINT ck_innings_balls CHECK (total_balls >= 0),
    CONSTRAINT ck_innings_extras CHECK (extras_wides >= 0 AND extras_noballs >= 0 AND extras_byes >= 0 AND extras_legbyes >= 0),
    CONSTRAINT uq_innings_match_number UNIQUE (match_id, innings_number)
);
GO

CREATE TABLE app.ball_events (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_ball_events PRIMARY KEY,
    innings_id INT NOT NULL,
    over_number INT NOT NULL,
    ball_number INT NOT NULL,
    batsman_id INT NOT NULL,
    bowler_id INT NOT NULL,
    runs_scored INT NOT NULL CONSTRAINT df_ball_events_runs DEFAULT 0,
    is_boundary_four BIT NOT NULL CONSTRAINT df_ball_events_four DEFAULT 0,
    is_boundary_six BIT NOT NULL CONSTRAINT df_ball_events_six DEFAULT 0,
    extras_type NVARCHAR(20) NULL,
    extras_runs INT NOT NULL CONSTRAINT df_ball_events_extras DEFAULT 0,
    is_wicket BIT NOT NULL CONSTRAINT df_ball_events_wicket DEFAULT 0,
    wicket_type NVARCHAR(50) NULL,
    dismissed_player_id INT NULL,
    dismissed_end NVARCHAR(20) NULL,
    incoming_batsman_id INT NULL,
    total_runs INT NOT NULL CONSTRAINT df_ball_events_total_runs DEFAULT 0,
    striker_before INT NULL,
    non_striker_before INT NULL,
    current_bowler_before INT NULL,
    last_over_bowler_before INT NULL,
    total_runs_before INT NULL,
    total_wickets_before INT NULL,
    total_balls_before INT NULL,
    total_overs_before DECIMAL(5,1) NULL,
    striker_after INT NULL,
    non_striker_after INT NULL,
    current_bowler_after INT NULL,
    last_over_bowler_after INT NULL,
    total_runs_after INT NULL,
    total_wickets_after INT NULL,
    total_balls_after INT NULL,
    total_overs_after DECIMAL(5,1) NULL,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_ball_events_created_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_ball_events_innings FOREIGN KEY (innings_id) REFERENCES app.innings(id),
    CONSTRAINT fk_ball_events_batsman FOREIGN KEY (batsman_id) REFERENCES app.players(id),
    CONSTRAINT fk_ball_events_bowler FOREIGN KEY (bowler_id) REFERENCES app.players(id),
    CONSTRAINT fk_ball_events_dismissed FOREIGN KEY (dismissed_player_id) REFERENCES app.players(id),
    CONSTRAINT fk_ball_events_incoming FOREIGN KEY (incoming_batsman_id) REFERENCES app.players(id),
    CONSTRAINT fk_ball_events_striker_before FOREIGN KEY (striker_before) REFERENCES app.players(id),
    CONSTRAINT fk_ball_events_non_striker_before FOREIGN KEY (non_striker_before) REFERENCES app.players(id),
    CONSTRAINT fk_ball_events_bowler_before FOREIGN KEY (current_bowler_before) REFERENCES app.players(id),
    CONSTRAINT fk_ball_events_last_bowler_before FOREIGN KEY (last_over_bowler_before) REFERENCES app.players(id),
    CONSTRAINT fk_ball_events_striker_after FOREIGN KEY (striker_after) REFERENCES app.players(id),
    CONSTRAINT fk_ball_events_non_striker_after FOREIGN KEY (non_striker_after) REFERENCES app.players(id),
    CONSTRAINT fk_ball_events_bowler_after FOREIGN KEY (current_bowler_after) REFERENCES app.players(id),
    CONSTRAINT fk_ball_events_last_bowler_after FOREIGN KEY (last_over_bowler_after) REFERENCES app.players(id),
    CONSTRAINT ck_ball_events_over_number CHECK (over_number >= 0),
    CONSTRAINT ck_ball_events_ball_number CHECK (ball_number > 0),
    CONSTRAINT ck_ball_events_runs CHECK (runs_scored >= 0 AND extras_runs >= 0 AND total_runs >= 0),
    CONSTRAINT ck_ball_events_extras_type CHECK (extras_type IS NULL OR extras_type IN (N'wide', N'noball', N'bye', N'legbye')),
    CONSTRAINT ck_ball_events_dismissed_end CHECK (dismissed_end IS NULL OR dismissed_end IN (N'striker', N'non-striker'))
);
GO

CREATE TABLE app.batting_scores (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_batting_scores PRIMARY KEY,
    innings_id INT NOT NULL,
    player_id INT NOT NULL,
    runs INT NOT NULL CONSTRAINT df_batting_scores_runs DEFAULT 0,
    balls_faced INT NOT NULL CONSTRAINT df_batting_scores_balls DEFAULT 0,
    fours INT NOT NULL CONSTRAINT df_batting_scores_fours DEFAULT 0,
    sixes INT NOT NULL CONSTRAINT df_batting_scores_sixes DEFAULT 0,
    is_out BIT NOT NULL CONSTRAINT df_batting_scores_out DEFAULT 0,
    dismissal_type NVARCHAR(50) NULL,
    dismissal_bowler_id INT NULL,
    dismissal_fielder_id INT NULL,
    batting_order INT NOT NULL CONSTRAINT df_batting_scores_order DEFAULT 0,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_batting_scores_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_batting_scores_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_batting_scores_innings FOREIGN KEY (innings_id) REFERENCES app.innings(id),
    CONSTRAINT fk_batting_scores_player FOREIGN KEY (player_id) REFERENCES app.players(id),
    CONSTRAINT fk_batting_scores_bowler FOREIGN KEY (dismissal_bowler_id) REFERENCES app.players(id),
    CONSTRAINT fk_batting_scores_fielder FOREIGN KEY (dismissal_fielder_id) REFERENCES app.players(id),
    CONSTRAINT ck_batting_scores_nonnegative CHECK (runs >= 0 AND balls_faced >= 0 AND fours >= 0 AND sixes >= 0 AND batting_order >= 0),
    CONSTRAINT uq_batting_scores_innings_player UNIQUE (innings_id, player_id)
);
GO

CREATE TABLE app.bowling_scores (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_bowling_scores PRIMARY KEY,
    innings_id INT NOT NULL,
    player_id INT NOT NULL,
    overs_bowled DECIMAL(5,1) NOT NULL CONSTRAINT df_bowling_scores_overs DEFAULT 0,
    balls_bowled INT NOT NULL CONSTRAINT df_bowling_scores_balls DEFAULT 0,
    maidens INT NOT NULL CONSTRAINT df_bowling_scores_maidens DEFAULT 0,
    runs_conceded INT NOT NULL CONSTRAINT df_bowling_scores_runs DEFAULT 0,
    wickets INT NOT NULL CONSTRAINT df_bowling_scores_wickets DEFAULT 0,
    wides INT NOT NULL CONSTRAINT df_bowling_scores_wides DEFAULT 0,
    noballs INT NOT NULL CONSTRAINT df_bowling_scores_noballs DEFAULT 0,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_bowling_scores_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_bowling_scores_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_bowling_scores_innings FOREIGN KEY (innings_id) REFERENCES app.innings(id),
    CONSTRAINT fk_bowling_scores_player FOREIGN KEY (player_id) REFERENCES app.players(id),
    CONSTRAINT ck_bowling_scores_nonnegative CHECK (
        overs_bowled >= 0 AND balls_bowled >= 0 AND maidens >= 0 AND
        runs_conceded >= 0 AND wickets >= 0 AND wides >= 0 AND noballs >= 0
    ),
    CONSTRAINT uq_bowling_scores_innings_player UNIQUE (innings_id, player_id)
);
GO

CREATE TABLE app.points_table (
    id INT IDENTITY(1,1) NOT NULL CONSTRAINT pk_points_table PRIMARY KEY,
    league_id INT NOT NULL,
    team_id INT NOT NULL,
    matches_played INT NOT NULL CONSTRAINT df_points_matches DEFAULT 0,
    wins INT NOT NULL CONSTRAINT df_points_wins DEFAULT 0,
    losses INT NOT NULL CONSTRAINT df_points_losses DEFAULT 0,
    ties INT NOT NULL CONSTRAINT df_points_ties DEFAULT 0,
    no_results INT NOT NULL CONSTRAINT df_points_no_results DEFAULT 0,
    points INT NOT NULL CONSTRAINT df_points_points DEFAULT 0,
    nrr DECIMAL(8,3) NOT NULL CONSTRAINT df_points_nrr DEFAULT 0,
    created_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_points_created_at DEFAULT SYSUTCDATETIME(),
    updated_at DATETIMEOFFSET(0) NOT NULL CONSTRAINT df_points_updated_at DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_points_leagues FOREIGN KEY (league_id) REFERENCES app.leagues(id),
    CONSTRAINT fk_points_teams FOREIGN KEY (team_id) REFERENCES app.teams(id),
    CONSTRAINT ck_points_nonnegative CHECK (
        matches_played >= 0 AND wins >= 0 AND losses >= 0 AND ties >= 0 AND
        no_results >= 0 AND points >= 0
    ),
    CONSTRAINT uq_points_league_team UNIQUE (league_id, team_id)
);
GO

CREATE INDEX ix_sponsors_league_id ON app.sponsors(league_id);
CREATE INDEX ix_teams_league_id ON app.teams(league_id);
CREATE INDEX ix_players_team_id ON app.players(team_id);
CREATE INDEX ix_matches_league_status ON app.matches(league_id, status);
CREATE INDEX ix_matches_status_date ON app.matches(status, match_date, match_time);
CREATE INDEX ix_innings_match_id ON app.innings(match_id);
CREATE INDEX ix_ball_events_innings_id_id ON app.ball_events(innings_id, id);
CREATE INDEX ix_batting_scores_innings_id ON app.batting_scores(innings_id);
CREATE INDEX ix_bowling_scores_innings_id ON app.bowling_scores(innings_id);
CREATE INDEX ix_points_league_points ON app.points_table(league_id, points DESC, nrr DESC);
GO

CREATE VIEW app.v_leagues AS
SELECT
    l.*,
    team_count = COUNT(DISTINCT t.id),
    match_count = COUNT(DISTINCT m.id)
FROM app.leagues l
LEFT JOIN app.teams t ON t.league_id = l.id
LEFT JOIN app.matches m ON m.league_id = l.id
GROUP BY
    l.id, l.name, l.city, l.venue, l.organizer, l.logo, l.season, l.format,
    l.overs_per_innings, l.status, l.created_at, l.updated_at;
GO

CREATE VIEW app.v_matches AS
SELECT
    m.*,
    [date] = CONVERT(CHAR(10), m.match_date, 23),
    [time] = CONVERT(CHAR(5), m.match_time, 108),
    league_name = l.name,
    season = l.season,
    team_a_name = ta.name,
    team_a_logo = ta.logo,
    team_a_captain = ta.captain_name,
    team_a_captain_photo = ta.captain_photo,
    team_b_name = tb.name,
    team_b_logo = tb.logo,
    team_b_captain = tb.captain_name,
    team_b_captain_photo = tb.captain_photo,
    mom_name = mom.name,
    mom_photo = mom.photo
FROM app.matches m
JOIN app.leagues l ON l.id = m.league_id
JOIN app.teams ta ON ta.id = m.team_a_id
JOIN app.teams tb ON tb.id = m.team_b_id
LEFT JOIN app.players mom ON mom.id = m.man_of_match_id;
GO

CREATE VIEW app.v_points AS
SELECT
    p.*,
    name = t.name,
    logo = t.logo
FROM app.points_table p
JOIN app.teams t ON t.id = p.team_id;
GO

CREATE VIEW app.v_scorecard_batting AS
SELECT
    bs.*,
    player_name = p.name,
    photo = p.photo,
    role = p.role,
    bowler_name = bowler.name,
    fielder_name = fielder.name
FROM app.batting_scores bs
JOIN app.players p ON p.id = bs.player_id
LEFT JOIN app.players bowler ON bowler.id = bs.dismissal_bowler_id
LEFT JOIN app.players fielder ON fielder.id = bs.dismissal_fielder_id;
GO

CREATE VIEW app.v_scorecard_bowling AS
SELECT
    bw.*,
    player_name = p.name,
    photo = p.photo
FROM app.bowling_scores bw
JOIN app.players p ON p.id = bw.player_id;
GO

CREATE VIEW app.v_player_batting_totals AS
SELECT
    p.id,
    p.name,
    p.photo,
    p.role,
    team_id = t.id,
    team_name = t.name,
    team_logo = t.logo,
    total_runs = COALESCE(SUM(CASE WHEN m.status = N'completed' THEN bs.runs ELSE 0 END), 0),
    total_balls = COALESCE(SUM(CASE WHEN m.status = N'completed' THEN bs.balls_faced ELSE 0 END), 0),
    total_fours = COALESCE(SUM(CASE WHEN m.status = N'completed' THEN bs.fours ELSE 0 END), 0),
    total_sixes = COALESCE(SUM(CASE WHEN m.status = N'completed' THEN bs.sixes ELSE 0 END), 0)
FROM app.players p
JOIN app.teams t ON t.id = p.team_id
LEFT JOIN app.batting_scores bs ON bs.player_id = p.id
LEFT JOIN app.innings i ON i.id = bs.innings_id
LEFT JOIN app.matches m ON m.id = i.match_id
GROUP BY p.id, p.name, p.photo, p.role, t.id, t.name, t.logo;
GO

CREATE VIEW app.v_player_bowling_totals AS
SELECT
    p.id,
    p.name,
    p.photo,
    p.role,
    team_id = t.id,
    team_name = t.name,
    team_logo = t.logo,
    total_balls = COALESCE(SUM(CASE WHEN m.status = N'completed' THEN bw.balls_bowled ELSE 0 END), 0),
    total_runs_conceded = COALESCE(SUM(CASE WHEN m.status = N'completed' THEN bw.runs_conceded ELSE 0 END), 0),
    total_wickets = COALESCE(SUM(CASE WHEN m.status = N'completed' THEN bw.wickets ELSE 0 END), 0)
FROM app.players p
JOIN app.teams t ON t.id = p.team_id
LEFT JOIN app.bowling_scores bw ON bw.player_id = p.id
LEFT JOIN app.innings i ON i.id = bw.innings_id
LEFT JOIN app.matches m ON m.id = i.match_id
GROUP BY p.id, p.name, p.photo, p.role, t.id, t.name, t.logo;
GO
