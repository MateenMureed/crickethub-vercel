const fs = require('fs');
const path = require('path');
const azureStateStore = require('./azureStateStore');
const supabaseStateStore = require('./supabaseStateStore');
const { APP_DATA_ROOT } = require('./runtimePaths');

const DATA_ROOT = APP_DATA_ROOT;
const DB_FILE = path.join(DATA_ROOT, 'data.json');
const DB_BACKUP_FILE = path.join(DATA_ROOT, 'data.backup.json');
const DB_TMP_FILE = path.join(DATA_ROOT, 'data.tmp.json');
const SNAPSHOTS_DIR = path.join(DATA_ROOT, 'snapshots');
const SNAPSHOT_RETENTION = 24;
const SNAPSHOT_MIN_INTERVAL_MS = 10 * 60 * 1000;
const UPLOADS_DIR = path.join(DATA_ROOT, 'uploads');
let lastSnapshotAt = 0;

function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  } catch (error) {
    console.error(`Failed to create ${dirPath}:`, error.message);
  }
}

ensureDir(DATA_ROOT);
ensureDir(UPLOADS_DIR);
ensureDir(SNAPSHOTS_DIR);

const defaultData = {
  users: [], leagues: [], sponsors: [], teams: [], players: [],
  matches: [], innings: [], ball_events: [],
  batting_scores: [], bowling_scores: [], points_table: [],
  _counters: { users: 0, leagues: 0, sponsors: 0, teams: 0, players: 0, matches: 0, innings: 0, ball_events: 0, batting_scores: 0, bowling_scores: 0, points_table: 0 }
};

function normalizeDB(rawData) {
  const data = rawData && typeof rawData === 'object' ? rawData : {};
  return {
    users: Array.isArray(data.users) ? data.users : [],
    leagues: Array.isArray(data.leagues) ? data.leagues : [],
    sponsors: Array.isArray(data.sponsors) ? data.sponsors : [],
    teams: Array.isArray(data.teams) ? data.teams : [],
    players: Array.isArray(data.players) ? data.players : [],
    matches: Array.isArray(data.matches) ? data.matches : [],
    innings: Array.isArray(data.innings) ? data.innings : [],
    ball_events: Array.isArray(data.ball_events) ? data.ball_events : [],
    batting_scores: Array.isArray(data.batting_scores) ? data.batting_scores : [],
    bowling_scores: Array.isArray(data.bowling_scores) ? data.bowling_scores : [],
    points_table: Array.isArray(data.points_table) ? data.points_table : [],
    _counters: { ...defaultData._counters, ...(data._counters || {}) }
  };
}

function safeReadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function loadDB() {
  const parsedPrimary = safeReadJson(DB_FILE);
  if (parsedPrimary) return normalizeDB(parsedPrimary);

  const parsedBackup = safeReadJson(DB_BACKUP_FILE);
  if (parsedBackup) {
    const normalized = normalizeDB(parsedBackup);
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(normalized, null, 2));
    } catch (e) {
      console.error('DB restore error:', e.message);
    }
    return normalized;
  }

  const normalized = normalizeDB(defaultData);
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(normalized, null, 2));
  } catch (e) {
    console.error('DB init error:', e.message);
  }
  return normalized;
}

function saveSnapshot(payload) {
  const now = Date.now();
  if (now - lastSnapshotAt < SNAPSHOT_MIN_INTERVAL_MS) return;

  try {
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    const snapshotFile = path.join(SNAPSHOTS_DIR, `data-${stamp}.json`);
    fs.writeFileSync(snapshotFile, payload);
    lastSnapshotAt = now;

    const snapshots = fs.readdirSync(SNAPSHOTS_DIR)
      .filter((name) => name.startsWith('data-') && name.endsWith('.json'))
      .sort();

    const extraCount = snapshots.length - SNAPSHOT_RETENTION;
    if (extraCount > 0) {
      for (let i = 0; i < extraCount; i++) {
        fs.unlinkSync(path.join(SNAPSHOTS_DIR, snapshots[i]));
      }
    }
  } catch (e) {
    console.error('DB snapshot error:', e.message);
  }
}

function saveDB(data) {
  const normalized = normalizeDB(data);
  const payload = JSON.stringify(normalized, null, 2);
  fs.writeFileSync(DB_TMP_FILE, payload);

  if (fs.existsSync(DB_FILE)) {
    fs.copyFileSync(DB_FILE, DB_BACKUP_FILE);
  }

  fs.renameSync(DB_TMP_FILE, DB_FILE);
  saveSnapshot(payload);
  azureStateStore.queuePersist(normalized);
  supabaseStateStore.queuePersist(normalized);
}

function nextId(data, table) {
  data._counters[table] = (data._counters[table] || 0) + 1;
  return data._counters[table];
}

const db = {
  async initStorage() {
    if (supabaseStateStore.isEnabled()) {
      await supabaseStateStore.hydrateLocalFile(DB_FILE, normalizeDB(defaultData));
      return;
    }

    await azureStateStore.hydrateLocalFile(DB_FILE, normalizeDB(defaultData));
  },

  resolveBowlerOptions(data, innings) {
    const allPlayers = data.players.filter((p) => p.team_id === innings.bowling_team_id);
    const specialist = allPlayers.filter((p) => ['bowler', 'all-rounder', 'all rounder'].includes((p.role || '').toLowerCase()));
    const pool = specialist.length > 0 ? specialist : allPlayers;
    return pool.filter((p) => p.id !== innings.last_over_bowler_id);
  },

  resolveRemainingBatsmen(data, innings) {
    const all = data.players.filter((p) => p.team_id === innings.batting_team_id);
    const outIds = new Set(
      data.batting_scores
        .filter((b) => b.innings_id === innings.id && b.is_out)
        .map((b) => b.player_id)
    );
    return all.filter((p) => !outIds.has(p.id) && p.id !== innings.striker_id && p.id !== innings.non_striker_id);
  },

  scheduleSuperOverMatch(data, baseMatchId) {
    const baseMatch = data.matches.find((m) => m.id === baseMatchId);
    if (!baseMatch) return null;

    const existing = data.matches.find(
      (m) => m.parent_match_id === baseMatchId && m.is_super_over && m.status !== 'cancelled'
    );
    if (existing) return existing.id;

    const leagueMatchNumbers = data.matches
      .filter((m) => m.league_id === baseMatch.league_id)
      .map((m) => m.match_number || 0);
    const nextMatchNumber = (leagueMatchNumbers.length ? Math.max(...leagueMatchNumbers) : 0) + 1;

    const superMatchId = nextId(data, 'matches');
    data.matches.push({
      id: superMatchId,
      league_id: baseMatch.league_id,
      team_a_id: baseMatch.team_a_id,
      team_b_id: baseMatch.team_b_id,
      match_number: nextMatchNumber,
      date: baseMatch.date || '',
      time: '',
      venue: baseMatch.venue || '',
      status: 'upcoming',
      toss_winner_id: null,
      toss_decision: null,
      result_summary: null,
      winner_id: null,
      man_of_match_id: null,
      overs_per_innings: 1,
      is_super_over: 1,
      parent_match_id: baseMatchId
    });
    return superMatchId;
  },

  finalizeCompletedMatch(data, matchId, winnerId, resultSummary, manOfMatchId = null) {
    const match = data.matches.find((m) => m.id === matchId);
    if (!match) return { error: 'Match not found' };

    const alreadyAwarded = !!match.points_awarded;
    match.status = 'completed';
    match.winner_id = winnerId || null;
    match.result_summary = resultSummary || null;
    if (manOfMatchId) match.man_of_match_id = manOfMatchId;

    if (!alreadyAwarded && !match.is_super_over) {
      const updatePts = (teamId, won, lost, tied) => {
        const pt = data.points_table.find((p) => p.league_id === match.league_id && p.team_id === teamId);
        if (!pt) return;
        pt.matches_played += 1;
        pt.wins += won ? 1 : 0;
        pt.losses += lost ? 1 : 0;
        pt.ties += tied ? 1 : 0;
        pt.points += won ? 2 : tied ? 1 : 0;
      };

      if (winnerId) {
        const loserId = winnerId === match.team_a_id ? match.team_b_id : match.team_a_id;
        updatePts(winnerId, true, false, false);
        updatePts(loserId, false, true, false);
      } else {
        updatePts(match.team_a_id, false, false, true);
        updatePts(match.team_b_id, false, false, true);
      }

      match.points_awarded = 1;
    }

    // Recalculate NRR for league.
    if (!match.is_super_over) {
      const leagueTeamPts = data.points_table.filter((p) => p.league_id === match.league_id);
      for (const pt of leagueTeamPts) {
        const completedMatchIds = data.matches
          .filter((m) => m.league_id === match.league_id && m.status === 'completed' && !m.is_super_over)
          .map((m) => m.id);
        const batInnings = data.innings.filter((i) => completedMatchIds.includes(i.match_id) && i.batting_team_id === pt.team_id);
        const bowlInnings = data.innings.filter((i) => completedMatchIds.includes(i.match_id) && i.bowling_team_id === pt.team_id);
        const batRuns = batInnings.reduce((s, i) => s + i.total_runs, 0);
        const batBalls = batInnings.reduce((s, i) => s + i.total_balls, 0);
        const bowlRuns = bowlInnings.reduce((s, i) => s + i.total_runs, 0);
        const bowlBalls = bowlInnings.reduce((s, i) => s + i.total_balls, 0);
        if (batBalls > 0 && bowlBalls > 0) {
          pt.nrr = Math.round((((batRuns / batBalls) * 6) - ((bowlRuns / bowlBalls) * 6)) * 1000) / 1000;
        }
      }
    }

    // Auto-complete league when all matches complete.
    const remaining = data.matches.filter((m) => m.league_id === match.league_id && m.status !== 'completed').length;
    if (remaining === 0) {
      const league = data.leagues.find((l) => l.id === match.league_id);
      if (league) league.status = 'completed';
    }

    return { winner_id: match.winner_id, result_summary: match.result_summary };
  },

  // ========= USERS (Admin Auth) =========
  getUser(username) {
    const data = loadDB();
    return data.users.find(u => u.username === username);
  },
  createUser(username, password) {
    const data = loadDB();
    if (data.users.find(u => u.username === username)) return { error: 'Username exists' };
    const id = nextId(data, 'users');
    data.users.push({ id, username, password }); // Note: Plain text for simplicity, in production use bcrypt
    saveDB(data);
    return { id, message: 'User created' };
  },

  // ========= LEAGUES =========
  getLeagues() {
    const data = loadDB();
    return data.leagues.map(l => {
      const teamCount = data.teams.filter(t => t.league_id === l.id).length;
      const matchCount = data.matches.filter(m => m.league_id === l.id).length;
      return { ...l, team_count: teamCount, match_count: matchCount };
    });
  },
  getLeague(id) {
    const data = loadDB();
    const league = data.leagues.find(l => l.id === id);
    if (!league) return null;
    league.sponsors = data.sponsors.filter(s => s.league_id === id);
    return league;
  },
  createLeague(fields) {
    const data = loadDB();
    const id = nextId(data, 'leagues');
    const league = { id, ...fields, status: fields.status || 'upcoming', created_at: new Date().toISOString() };
    data.leagues.push(league);
    saveDB(data);
    return id;
  },
  updateLeague(id, fields) {
    const data = loadDB();
    const idx = data.leagues.findIndex(l => l.id === id);
    if (idx === -1) return false;
    data.leagues[idx] = { ...data.leagues[idx], ...fields };
    saveDB(data);
    return true;
  },
  deleteLeague(id) {
    const data = loadDB();
    data.leagues = data.leagues.filter(l => l.id !== id);
    data.sponsors = data.sponsors.filter(s => s.league_id !== id);
    const teamIds = data.teams.filter(t => t.league_id === id).map(t => t.id);
    data.players = data.players.filter(p => !teamIds.includes(p.team_id));
    data.teams = data.teams.filter(t => t.league_id !== id);
    const matchIds = data.matches.filter(m => m.league_id === id).map(m => m.id);
    const inningsIds = data.innings.filter(i => matchIds.includes(i.match_id)).map(i => i.id);
    data.ball_events = data.ball_events.filter(b => !inningsIds.includes(b.innings_id));
    data.batting_scores = data.batting_scores.filter(b => !inningsIds.includes(b.innings_id));
    data.bowling_scores = data.bowling_scores.filter(b => !inningsIds.includes(b.innings_id));
    data.innings = data.innings.filter(i => !matchIds.includes(i.match_id));
    data.matches = data.matches.filter(m => m.league_id !== id);
    data.points_table = data.points_table.filter(p => p.league_id !== id);
    saveDB(data);
  },

  // ========= SPONSORS =========
  addSponsor(leagueId, name, logo) {
    const data = loadDB();
    const id = nextId(data, 'sponsors');
    data.sponsors.push({ id, league_id: leagueId, name, logo });
    saveDB(data);
    return id;
  },
  deleteSponsor(id) {
    const data = loadDB();
    data.sponsors = data.sponsors.filter(s => s.id !== id);
    saveDB(data);
  },

  // ========= TEAMS =========
  getTeams(leagueId) {
    const data = loadDB();
    return data.teams.filter(t => t.league_id === leagueId).map(t => ({
      ...t, player_count: data.players.filter(p => p.team_id === t.id).length
    }));
  },
  getTeam(id) {
    const data = loadDB();
    const team = data.teams.find(t => t.id === id);
    if (!team) return null;
    team.players = data.players.filter(p => p.team_id === id).sort((a, b) => (a.jersey_number || 0) - (b.jersey_number || 0));
    return team;
  },
  createTeam(fields) {
    const data = loadDB();
    const id = nextId(data, 'teams');
    data.teams.push({ id, ...fields });
    // Add to points table
    data.points_table.push({ id: nextId(data, 'points_table'), league_id: fields.league_id, team_id: id, matches_played: 0, wins: 0, losses: 0, ties: 0, no_results: 0, points: 0, nrr: 0 });
    saveDB(data);
    return id;
  },
  updateTeam(id, fields) {
    const data = loadDB();
    const idx = data.teams.findIndex(t => t.id === id);
    if (idx === -1) return false;
    data.teams[idx] = { ...data.teams[idx], ...fields };
    saveDB(data);
    return true;
  },
  deleteTeam(id) {
    const data = loadDB();
    data.players = data.players.filter(p => p.team_id !== id);
    data.teams = data.teams.filter(t => t.id !== id);
    data.points_table = data.points_table.filter(p => p.team_id !== id);
    saveDB(data);
  },

  // ========= PLAYERS =========
  getPlayers(teamId) {
    const data = loadDB();
    return data.players.filter(p => p.team_id === teamId).sort((a, b) => (a.jersey_number || 0) - (b.jersey_number || 0));
  },
  createPlayer(fields) {
    const data = loadDB();
    const id = nextId(data, 'players');
    data.players.push({ id, ...fields });
    saveDB(data);
    return id;
  },
  createPlayers(teamId, playersArray) {
    const data = loadDB();
    const ids = [];
    for (const player of playersArray) {
      const id = nextId(data, 'players');
      data.players.push({ id, team_id: teamId, ...player });
      ids.push(id);
    }
    saveDB(data);
    return ids;
  },
  updatePlayer(id, fields) {
    const data = loadDB();
    const idx = data.players.findIndex(p => p.id === id);
    if (idx === -1) return false;
    data.players[idx] = { ...data.players[idx], ...fields };
    saveDB(data);
    return true;
  },
  deletePlayer(id) {
    const data = loadDB();
    data.players = data.players.filter(p => p.id !== id);
    saveDB(data);
  },

  // ========= MATCHES =========
  getMatches(leagueId) {
    const data = loadDB();
    return data.matches.filter(m => m.league_id === leagueId).map(m => {
      const ta = data.teams.find(t => t.id === m.team_a_id) || {};
      const tb = data.teams.find(t => t.id === m.team_b_id) || {};
      const mom = m.man_of_match_id ? data.players.find(p => p.id === m.man_of_match_id) : null;
      return { ...m, team_a_name: ta.name, team_a_logo: ta.logo, team_b_name: tb.name, team_b_logo: tb.logo, mom_name: mom?.name, mom_photo: mom?.photo };
    }).sort((a, b) => (a.match_number || 0) - (b.match_number || 0));
  },
  getAllMatches() {
    const data = loadDB();
    return data.matches.map((m) => {
      const ta = data.teams.find((t) => t.id === m.team_a_id) || {};
      const tb = data.teams.find((t) => t.id === m.team_b_id) || {};
      const league = data.leagues.find((l) => l.id === m.league_id) || {};
      return {
        ...m,
        team_a_name: ta.name,
        team_a_logo: ta.logo,
        team_b_name: tb.name,
        team_b_logo: tb.logo,
        league_name: league.name
      };
    }).sort((a, b) => (b.id || 0) - (a.id || 0));
  },
  createMatch(fields) {
    const data = loadDB();
    const leagueId = parseInt(fields.league_id, 10);
    const teamAId = parseInt(fields.team_a_id, 10);
    const teamBId = parseInt(fields.team_b_id, 10);

    const league = data.leagues.find((l) => l.id === leagueId);
    if (!league) return { error: 'League not found' };
    if (!teamAId || !teamBId || teamAId === teamBId) return { error: 'Select two different teams' };

    const teamA = data.teams.find((t) => t.id === teamAId && t.league_id === leagueId);
    const teamB = data.teams.find((t) => t.id === teamBId && t.league_id === leagueId);
    if (!teamA || !teamB) return { error: 'Teams must belong to the selected league' };

    const matchNumber = data.matches
      .filter((m) => m.league_id === leagueId)
      .reduce((max, m) => Math.max(max, m.match_number || 0), 0) + 1;

    const id = nextId(data, 'matches');
    data.matches.push({
      id,
      league_id: leagueId,
      team_a_id: teamAId,
      team_b_id: teamBId,
      match_number: matchNumber,
      date: fields.date || '',
      time: fields.time || '',
      venue: fields.venue || league.venue || '',
      status: 'upcoming',
      toss_winner_id: null,
      toss_decision: null,
      result_summary: null,
      winner_id: null,
      man_of_match_id: null,
      overs_per_innings: parseInt(fields.overs_per_innings, 10) || parseInt(league.overs_per_innings, 10) || 20,
      is_super_over: 0,
      parent_match_id: null
    });

    if (league.status === 'upcoming') league.status = 'active';
    saveDB(data);
    return { id, message: 'Match created' };
  },
  getMatch(id) {
    const data = loadDB();
    const m = data.matches.find(x => x.id === id);
    if (!m) return null;
    const ta = data.teams.find(t => t.id === m.team_a_id) || {};
    const tb = data.teams.find(t => t.id === m.team_b_id) || {};
    const mom = m.man_of_match_id ? data.players.find(p => p.id === m.man_of_match_id) : null;
    const league = data.leagues.find(l => l.id === m.league_id) || {};
    const innings = data.innings.filter(i => i.match_id === id).sort((a, b) => a.innings_number - b.innings_number);
    return {
      ...m, team_a_name: ta.name, team_a_logo: ta.logo, team_a_captain: ta.captain_name, team_a_captain_photo: ta.captain_photo,
      team_b_name: tb.name, team_b_logo: tb.logo, team_b_captain: tb.captain_name, team_b_captain_photo: tb.captain_photo,
      mom_name: mom?.name, mom_photo: mom?.photo, league_name: league.name, overs_per_innings: m.overs_per_innings || league.overs_per_innings || 20,
      innings
    };
  },
  getLiveMatches() {
    const data = loadDB();
    return data.matches.filter(m => m.status === 'live').map(m => {
      const ta = data.teams.find(t => t.id === m.team_a_id) || {};
      const tb = data.teams.find(t => t.id === m.team_b_id) || {};
      const league = data.leagues.find(l => l.id === m.league_id) || {};
      const innings = data.innings.filter(i => i.match_id === m.id).sort((a, b) => a.innings_number - b.innings_number);
      return { ...m, team_a_name: ta.name, team_a_logo: ta.logo, team_b_name: tb.name, team_b_logo: tb.logo, league_name: league.name, innings };
    });
  },
  getUpcomingMatches() {
    const data = loadDB();
    return data.matches.filter(m => m.status === 'upcoming').slice(0, 10).map(m => {
      const ta = data.teams.find(t => t.id === m.team_a_id) || {};
      const tb = data.teams.find(t => t.id === m.team_b_id) || {};
      const league = data.leagues.find(l => l.id === m.league_id) || {};
      return { ...m, team_a_name: ta.name, team_a_logo: ta.logo, team_a_captain: ta.captain_name, team_a_captain_photo: ta.captain_photo, team_b_name: tb.name, team_b_logo: tb.logo, team_b_captain: tb.captain_name, team_b_captain_photo: tb.captain_photo, league_name: league.name };
    });
  },
  getCompletedMatches() {
    const data = loadDB();
    return data.matches.filter(m => m.status === 'completed').slice(-10).reverse().map(m => {
      const ta = data.teams.find(t => t.id === m.team_a_id) || {};
      const tb = data.teams.find(t => t.id === m.team_b_id) || {};
      const mom = m.man_of_match_id ? data.players.find(p => p.id === m.man_of_match_id) : null;
      const league = data.leagues.find(l => l.id === m.league_id) || {};
      const innings = data.innings.filter(i => i.match_id === m.id).sort((a, b) => a.innings_number - b.innings_number);
      return { ...m, team_a_name: ta.name, team_a_logo: ta.logo, team_b_name: tb.name, team_b_logo: tb.logo, mom_name: mom?.name, mom_photo: mom?.photo, league_name: league.name, innings };
    });
  },
  generateFixtures(leagueId, config = {}) {
    const data = loadDB();
    const league = data.leagues.find(l => l.id === leagueId);
    if (!league) return { error: 'League not found' };
    const teams = data.teams.filter(t => t.league_id === leagueId);
    if (teams.length < 2) return { error: 'Need at least 2 teams' };

    const expectedTeams = parseInt(config.expected_teams, 10);
    if (Number.isInteger(expectedTeams) && expectedTeams > 1 && teams.length < expectedTeams) {
      return { error: `Add all ${expectedTeams} teams before generating fixtures. Currently added: ${teams.length}` };
    }

    const requiredSquadSize = parseInt(config.required_squad_size, 10);
    if (Number.isInteger(requiredSquadSize) && requiredSquadSize > 0) {
      const incompleteTeams = teams.filter((team) => data.players.filter((p) => p.team_id === team.id).length < requiredSquadSize);
      if (incompleteTeams.length > 0) {
        return {
          error: `Complete squad for all teams first (${requiredSquadSize} players each). Incomplete: ${incompleteTeams.map((t) => t.name).join(', ')}`
        };
      }
    }

    const format = String(config.format || 'round-robin').toLowerCase();
    const matchesPerPair = Math.max(1, parseInt(config.matches_per_pair, 10) || 1);
    const defaultVenue = String(config.venue || league.venue || '').trim();
    const baseDate = String(config.match_date || '').trim();
    const baseTime = String(config.match_time || '').trim();
    const gapDays = Math.max(0, parseInt(config.match_gap_days, 10) || 0);
    const perMatchOvers = Math.max(1, parseInt(config.overs_per_innings, 10) || parseInt(league.overs_per_innings, 10) || 20);

    data.matches = data.matches.filter(m => !(m.league_id === leagueId && m.status === 'upcoming'));
    let matchNum = data.matches.filter(m => m.league_id === leagueId).reduce((max, m) => Math.max(max, m.match_number || 0), 0);
    let count = 0;

    const createdIds = [];
    let scheduleIndex = 0;
    const scheduleDateForIndex = () => {
      if (!baseDate) return '';
      const dt = new Date(`${baseDate}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return baseDate;
      dt.setDate(dt.getDate() + (scheduleIndex * gapDays));
      return dt.toISOString().slice(0, 10);
    };

    const pushMatch = (teamAId, teamBId) => {
      matchNum++;
      const id = nextId(data, 'matches');
      data.matches.push({
        id,
        league_id: leagueId,
        team_a_id: teamAId,
        team_b_id: teamBId,
        match_number: matchNum,
        date: scheduleDateForIndex(),
        time: baseTime,
        venue: defaultVenue,
        status: 'upcoming',
        toss_winner_id: null,
        toss_decision: null,
        result_summary: null,
        winner_id: null,
        man_of_match_id: null,
        overs_per_innings: perMatchOvers,
        is_super_over: 0,
        parent_match_id: null
      });
      createdIds.push(id);
      scheduleIndex++;
      count++;
    };

    if (format === 'knockout') {
      if (teams.length % 2 !== 0) {
        return { error: 'Knockout generation currently requires an even number of teams' };
      }
      for (let i = 0; i < teams.length; i += 2) {
        pushMatch(teams[i].id, teams[i + 1].id);
      }
    } else {
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          for (let r = 0; r < matchesPerPair; r++) {
            pushMatch(teams[i].id, teams[j].id);
          }
        }
      }
    }

    league.status = 'active';
    saveDB(data);

    const createdMatches = data.matches
      .filter((m) => createdIds.includes(m.id))
      .map((m) => {
        const ta = data.teams.find((t) => t.id === m.team_a_id) || {};
        const tb = data.teams.find((t) => t.id === m.team_b_id) || {};
        return {
          ...m,
          team_a_name: ta.name,
          team_a_logo: ta.logo,
          team_b_name: tb.name,
          team_b_logo: tb.logo
        };
      });

    return { message: `${count} fixtures generated`, count, matches: createdMatches };
  },
  updateMatch(id, fields) {
    const data = loadDB();
    const idx = data.matches.findIndex(m => m.id === id);
    if (idx === -1) return false;
    data.matches[idx] = { ...data.matches[idx], ...fields };
    saveDB(data);
    return true;
  },

  deleteMatch(id) {
    const data = loadDB();
    const match = data.matches.find((m) => m.id === id);
    if (!match) return false;

    const inningsIds = data.innings.filter((i) => i.match_id === id).map((i) => i.id);
    data.ball_events = data.ball_events.filter((b) => !inningsIds.includes(b.innings_id));
    data.batting_scores = data.batting_scores.filter((b) => !inningsIds.includes(b.innings_id));
    data.bowling_scores = data.bowling_scores.filter((b) => !inningsIds.includes(b.innings_id));
    data.innings = data.innings.filter((i) => i.match_id !== id);
    data.matches = data.matches.filter((m) => m.id !== id);

    saveDB(data);
    return true;
  },

  deleteUpcomingFixtures(leagueId) {
    const data = loadDB();
    const upcomingIds = data.matches
      .filter((m) => m.league_id === leagueId && m.status === 'upcoming')
      .map((m) => m.id);

    if (upcomingIds.length === 0) return { count: 0 };

    data.matches = data.matches.filter((m) => !upcomingIds.includes(m.id));
    saveDB(data);
    return { count: upcomingIds.length };
  },

  // ========= SCORING =========
  startMatch(matchId, initConfig = {}, tossDecisionLegacy) {
    const data = loadDB();
    const match = data.matches.find(m => m.id === matchId);
    if (!match) return { error: 'Match not found' };

    if (match.status !== 'upcoming') {
      return { error: 'Only upcoming matches can be started' };
    }

    let battingTeamId = initConfig.batting_team_id;
    let bowlingTeamId = initConfig.bowling_team_id;
    let strikerId = initConfig.striker_id;
    let nonStrikerId = initConfig.non_striker_id;
    let bowlerId = initConfig.bowler_id;
    let needsOpeningSelection = false;

    // Backward compatibility: old start flow with toss winner + decision.
    if (!battingTeamId || !bowlingTeamId) {
      const tossWinnerId = initConfig.toss_winner_id || initConfig;
      const tossDecision = initConfig.toss_decision || tossDecisionLegacy;
      if (!tossWinnerId || !tossDecision) return { error: 'Match start configuration is required' };
      match.toss_winner_id = tossWinnerId;
      match.toss_decision = tossDecision;
      if (tossDecision === 'bat') {
        battingTeamId = tossWinnerId;
        bowlingTeamId = tossWinnerId === match.team_a_id ? match.team_b_id : match.team_a_id;
      } else {
        bowlingTeamId = tossWinnerId;
        battingTeamId = tossWinnerId === match.team_a_id ? match.team_b_id : match.team_a_id;
      }
      needsOpeningSelection = true;
      strikerId = null;
      nonStrikerId = null;
      bowlerId = null;
    }

    if (!battingTeamId || !bowlingTeamId || battingTeamId === bowlingTeamId) return { error: 'Select valid batting and bowling teams' };
    if (!needsOpeningSelection) {
      if (!strikerId || !nonStrikerId || strikerId === nonStrikerId) return { error: 'Select two different opening batsmen' };
      if (!bowlerId) return { error: 'Select opening bowler' };
    }

    if (!needsOpeningSelection) {
      const battingPlayers = data.players.filter((p) => p.team_id === battingTeamId);
      const bowlingPlayers = data.players.filter((p) => p.team_id === bowlingTeamId);
      if (!battingPlayers.find((p) => p.id === strikerId) || !battingPlayers.find((p) => p.id === nonStrikerId)) return { error: 'Opening batsmen must belong to batting team' };
      if (!bowlingPlayers.find((p) => p.id === bowlerId)) return { error: 'Opening bowler must belong to bowling team' };
    }

    match.status = 'live';
    const inningsId = nextId(data, 'innings');
    data.innings.push({ id: inningsId, match_id: matchId, batting_team_id: battingTeamId, bowling_team_id: bowlingTeamId, innings_number: 1, total_runs: 0, total_wickets: 0, total_overs: 0, total_balls: 0, extras_wides: 0, extras_noballs: 0, extras_byes: 0, extras_legbyes: 0, is_completed: 0, striker_id: strikerId || null, non_striker_id: nonStrikerId || null, current_bowler_id: bowlerId || null, last_over_bowler_id: null });
    const league = data.leagues.find(l => l.id === match.league_id);
    if (league) league.status = 'active';
    saveDB(data);
    return { innings_id: inningsId, batting_team_id: battingTeamId, bowling_team_id: bowlingTeamId, striker_id: strikerId, non_striker_id: nonStrikerId, bowler_id: bowlerId, total_runs: 0, total_wickets: 0, total_balls: 0 };
  },

  selectBowler(inningsId, bowlerId) {
    const data = loadDB();
    const innings = data.innings.find((i) => i.id === inningsId);
    if (!innings) return { error: 'Innings not found' };
    if (innings.is_completed) return { error: 'Innings already completed' };

    const options = this.resolveBowlerOptions(data, innings);
    if (!options.find((p) => p.id === bowlerId)) {
      return { error: 'Selected bowler is not allowed for this over' };
    }

    innings.current_bowler_id = bowlerId;
    saveDB(data);
    return { bowler_id: bowlerId };
  },

  initializeInnings(inningsId, initConfig = {}) {
    const data = loadDB();
    const innings = data.innings.find((i) => i.id === inningsId);
    if (!innings) return { error: 'Innings not found' };
    if (innings.is_completed) return { error: 'Innings already completed' };

    const strikerId = parseInt(initConfig.striker_id, 10);
    const nonStrikerId = parseInt(initConfig.non_striker_id, 10);
    const bowlerId = parseInt(initConfig.bowler_id, 10);

    if (!strikerId || !nonStrikerId || strikerId === nonStrikerId) {
      return { error: 'Select two different opening batsmen' };
    }
    if (!bowlerId) return { error: 'Select opening bowler' };

    const battingPlayers = data.players.filter((p) => p.team_id === innings.batting_team_id);
    const bowlingPlayers = data.players.filter((p) => p.team_id === innings.bowling_team_id);

    if (!battingPlayers.find((p) => p.id === strikerId) || !battingPlayers.find((p) => p.id === nonStrikerId)) {
      return { error: 'Opening batsmen must belong to batting team' };
    }
    if (!bowlingPlayers.find((p) => p.id === bowlerId)) {
      return { error: 'Opening bowler must belong to bowling team' };
    }

    innings.striker_id = strikerId;
    innings.non_striker_id = nonStrikerId;
    innings.current_bowler_id = bowlerId;

    saveDB(data);
    return {
      innings_id: innings.id,
      striker_id: innings.striker_id,
      non_striker_id: innings.non_striker_id,
      bowler_id: innings.current_bowler_id
    };
  },

  recordBall(inningsId, payload) {
    const data = loadDB();
    const innings = data.innings.find(i => i.id === inningsId);
    if (!innings) return { error: 'Innings not found' };
    const match = data.matches.find(m => m.id === innings.match_id);
    const league = data.leagues.find(l => l.id === match.league_id);
    const maxOvers = match?.overs_per_innings || league?.overs_per_innings || 20;

    if (innings.is_completed) return { error: 'Innings already completed' };
    if (!innings.striker_id || !innings.non_striker_id) return { error: 'Select opening batsmen before scoring' };
    if (!innings.current_bowler_id) return { error: 'Select bowler for current over' };

    const legalWickets = new Set(['bowled', 'caught', 'lbw', 'run out', 'stumped', 'hit wicket', 'retired out']);
    const strikerId = innings.striker_id;
    const nonStrikerId = innings.non_striker_id;
    const currentBowlerId = innings.current_bowler_id;

    const {
      batsman_id = strikerId,
      bowler_id = currentBowlerId,
      runs_scored = 0,
      extras_type,
      extras_runs = 0,
      is_wicket,
      wicket_type,
      dismissed_player_id,
      incoming_batsman_id,
      dismissed_end = 'striker'
    } = payload;

    if (batsman_id !== strikerId) return { error: 'Only striker can face the ball' };
    if (bowler_id !== currentBowlerId) return { error: 'Selected bowler is not active for this over' };
    if (is_wicket && wicket_type && !legalWickets.has(String(wicket_type).toLowerCase())) return { error: 'Invalid wicket type' };

    const totalRuns = runs_scored + extras_runs;
    const isLegal = !extras_type || (extras_type !== 'wide' && extras_type !== 'noball');

    const overNum = Math.floor(innings.total_balls / 6);
    const ballNum = (innings.total_balls % 6) + 1;

    const stateBefore = {
      striker_id: innings.striker_id,
      non_striker_id: innings.non_striker_id,
      current_bowler_id: innings.current_bowler_id,
      last_over_bowler_id: innings.last_over_bowler_id || null,
      total_runs: innings.total_runs,
      total_wickets: innings.total_wickets,
      total_balls: innings.total_balls,
      total_overs: innings.total_overs
    };

    const beId = nextId(data, 'ball_events');
    const ballEvent = {
      id: beId,
      innings_id: inningsId,
      over_number: overNum,
      ball_number: ballNum,
      batsman_id,
      bowler_id,
      runs_scored,
      is_boundary_four: runs_scored === 4 ? 1 : 0,
      is_boundary_six: runs_scored === 6 ? 1 : 0,
      extras_type: extras_type || null,
      extras_runs,
      is_wicket: is_wicket ? 1 : 0,
      wicket_type: wicket_type || null,
      dismissed_player_id: dismissed_player_id || null,
      dismissed_end,
      incoming_batsman_id: incoming_batsman_id || null,
      total_runs: totalRuns,
      striker_before: stateBefore.striker_id,
      non_striker_before: stateBefore.non_striker_id,
      current_bowler_before: stateBefore.current_bowler_id,
      last_over_bowler_before: stateBefore.last_over_bowler_id,
      total_runs_before: stateBefore.total_runs,
      total_wickets_before: stateBefore.total_wickets,
      total_balls_before: stateBefore.total_balls,
      total_overs_before: stateBefore.total_overs
    };
    data.ball_events.push(ballEvent);

    innings.total_balls += isLegal ? 1 : 0;
    innings.total_runs += totalRuns;
    innings.total_wickets += is_wicket ? 1 : 0;
    innings.total_overs = Math.floor(innings.total_balls / 6) + (innings.total_balls % 6) / 10;

    if (extras_type === 'wide') innings.extras_wides = (innings.extras_wides || 0) + (extras_runs || 1);
    if (extras_type === 'noball') innings.extras_noballs = (innings.extras_noballs || 0) + (extras_runs || 1);
    if (extras_type === 'bye') innings.extras_byes = (innings.extras_byes || 0) + (extras_runs || 0);
    if (extras_type === 'legbye') innings.extras_legbyes = (innings.extras_legbyes || 0) + (extras_runs || 0);

    // Update batsman score
    if (batsman_id) {
      let bs = data.batting_scores.find(b => b.innings_id === inningsId && b.player_id === batsman_id);
      if (!bs) {
        const bsId = nextId(data, 'batting_scores');
        bs = { id: bsId, innings_id: inningsId, player_id: batsman_id, runs: 0, balls_faced: 0, fours: 0, sixes: 0, is_out: 0, dismissal_type: null, dismissal_bowler_id: null, dismissal_fielder_id: null, batting_order: 0 };
        data.batting_scores.push(bs);
      }
      if (!extras_type) {
        bs.runs += runs_scored;
        bs.balls_faced += 1;
        if (runs_scored === 4) bs.fours += 1;
        if (runs_scored === 6) bs.sixes += 1;
      } else if (isLegal) {
        bs.balls_faced += 1;
      }
    }

    // Update wicket
    const dismissedPlayerId = dismissed_player_id || strikerId;
    if (is_wicket) {
      let bs = data.batting_scores.find(b => b.innings_id === inningsId && b.player_id === dismissedPlayerId);
      if (!bs) {
        const bsId = nextId(data, 'batting_scores');
        bs = { id: bsId, innings_id: inningsId, player_id: dismissedPlayerId, runs: 0, balls_faced: 0, fours: 0, sixes: 0, is_out: 0, dismissal_type: null, dismissal_bowler_id: null, dismissal_fielder_id: null, batting_order: 0 };
        data.batting_scores.push(bs);
      }
      bs.is_out = 1;
      bs.dismissal_type = wicket_type;
      bs.dismissal_bowler_id = bowler_id;
    }

    // Update bowler
    if (bowler_id) {
      let bw = data.bowling_scores.find(b => b.innings_id === inningsId && b.player_id === bowler_id);
      if (!bw) {
        const bwId = nextId(data, 'bowling_scores');
        bw = { id: bwId, innings_id: inningsId, player_id: bowler_id, overs_bowled: 0, balls_bowled: 0, maidens: 0, runs_conceded: 0, wickets: 0, wides: 0, noballs: 0 };
        data.bowling_scores.push(bw);
      }
      bw.balls_bowled += isLegal ? 1 : 0;
      bw.runs_conceded += totalRuns;
      bw.wickets += is_wicket ? 1 : 0;
      if (extras_type === 'wide') bw.wides += 1;
      if (extras_type === 'noball') bw.noballs += 1;
      bw.overs_bowled = Math.floor(bw.balls_bowled / 6) + (bw.balls_bowled % 6) / 10;
    }

    // Automatic strike rotation on odd runs from bat.
    if (!is_wicket && !extras_type && runs_scored % 2 === 1) {
      const tmp = innings.striker_id;
      innings.striker_id = innings.non_striker_id;
      innings.non_striker_id = tmp;
    }

    if (is_wicket && innings.total_wickets < 10) {
      const remaining = this.resolveRemainingBatsmen(data, innings);
      if (!incoming_batsman_id) {
        return {
          error: 'Select new batsman',
          requires_new_batsman: true,
          dismissed_player_id: dismissedPlayerId,
          remaining_batsmen: remaining
        };
      }
      if (!remaining.find((p) => p.id === incoming_batsman_id)) {
        return { error: 'Selected batsman is invalid or already dismissed' };
      }
      if (dismissed_end === 'non-striker') {
        innings.non_striker_id = incoming_batsman_id;
      } else {
        innings.striker_id = incoming_batsman_id;
      }
    }

    let needsBowler = false;
    if (isLegal && innings.total_balls > 0 && innings.total_balls % 6 === 0) {
      const tmp = innings.striker_id;
      innings.striker_id = innings.non_striker_id;
      innings.non_striker_id = tmp;
      innings.last_over_bowler_id = innings.current_bowler_id;
      innings.current_bowler_id = null;
      needsBowler = true;
    }

    let inningsComplete = false;
    if (innings.total_balls >= maxOvers * 6 || innings.total_wickets >= 10) {
      innings.is_completed = 1;
      inningsComplete = true;
    }

    let secondInningsCreated = false;
    let nextInningsId = null;
    let matchCompleted = false;

    if (inningsComplete && innings.innings_number === 1) {
      const existingSecond = data.innings.find((i) => i.match_id === match.id && i.innings_number === 2);
      if (!existingSecond) {
        const secondId = nextId(data, 'innings');
        data.innings.push({ id: secondId, match_id: match.id, batting_team_id: innings.bowling_team_id, bowling_team_id: innings.batting_team_id, innings_number: 2, total_runs: 0, total_wickets: 0, total_overs: 0, total_balls: 0, extras_wides: 0, extras_noballs: 0, extras_byes: 0, extras_legbyes: 0, is_completed: 0, striker_id: null, non_striker_id: null, current_bowler_id: null, last_over_bowler_id: null, target_runs: innings.total_runs + 1 });
        match.target_runs = innings.total_runs + 1;
        secondInningsCreated = true;
        nextInningsId = secondId;
      }
    }

    if (innings.innings_number === 2) {
      const firstInnings = data.innings.find((i) => i.match_id === match.id && i.innings_number === 1);
      const target = (firstInnings?.total_runs || 0) + 1;
      if (innings.total_runs >= target) {
        innings.is_completed = 1;
        inningsComplete = true;
      }
      if (innings.is_completed) {
        matchCompleted = true;
        let winnerId = null;
        let resultSummary = '';
        if (innings.total_runs >= target) {
          winnerId = innings.batting_team_id;
          const winnerName = data.teams.find((t) => t.id === winnerId)?.name || '';
          resultSummary = `${winnerName} won by ${10 - innings.total_wickets} wickets`;
        } else if (firstInnings && firstInnings.total_runs > innings.total_runs) {
          winnerId = firstInnings.batting_team_id;
          const winnerName = data.teams.find((t) => t.id === winnerId)?.name || '';
          resultSummary = `${winnerName} won by ${firstInnings.total_runs - innings.total_runs} runs`;
        } else {
          const superMatchId = this.scheduleSuperOverMatch(data, match.id);
          resultSummary = superMatchId ? 'Match Tied - Super Over Scheduled' : 'Match Tied';
        }
        this.finalizeCompletedMatch(data, match.id, winnerId, resultSummary);
      }
    }

    ballEvent.striker_after = innings.striker_id;
    ballEvent.non_striker_after = innings.non_striker_id;
    ballEvent.current_bowler_after = innings.current_bowler_id;
    ballEvent.last_over_bowler_after = innings.last_over_bowler_id || null;
    ballEvent.total_runs_after = innings.total_runs;
    ballEvent.total_wickets_after = innings.total_wickets;
    ballEvent.total_balls_after = innings.total_balls;
    ballEvent.total_overs_after = innings.total_overs;

    saveDB(data);
    return {
      total_runs: innings.total_runs,
      total_wickets: innings.total_wickets,
      total_balls: innings.total_balls,
      total_overs: innings.total_overs,
      innings_complete: inningsComplete,
      striker_id: innings.striker_id,
      non_striker_id: innings.non_striker_id,
      current_bowler_id: innings.current_bowler_id,
      needs_bowler_selection: needsBowler,
      second_innings_created: secondInningsCreated,
      next_innings_id: nextInningsId,
      target_runs: match.target_runs || null,
      match_completed: matchCompleted,
      result_summary: match.result_summary || null
    };
  },

  undoLastBall(inningsId) {
    const data = loadDB();
    const innings = data.innings.find((i) => i.id === inningsId);
    if (!innings) return { error: 'Innings not found' };
    const match = data.matches.find((m) => m.id === innings.match_id);
    if (!match) return { error: 'Match not found' };
    if (match.status !== 'live') return { error: 'Undo is only allowed for live matches' };
    if (innings.is_completed) return { error: 'Undo is not allowed after innings is completed' };

    if (innings.innings_number === 1) {
      const secondInnings = data.innings.find((i) => i.match_id === innings.match_id && i.innings_number === 2);
      if (secondInnings) return { error: 'Undo is not allowed after second innings has started' };
    }

    const events = data.ball_events
      .filter((b) => b.innings_id === inningsId)
      .sort((a, b) => a.id - b.id);
    if (events.length === 0) return { error: 'No ball to undo' };

    const lastEvent = events[events.length - 1];
    const prevEvent = events.length > 1 ? events[events.length - 2] : null;
    const restoreState = {
      striker_id: lastEvent.striker_before ?? prevEvent?.striker_after,
      non_striker_id: lastEvent.non_striker_before ?? prevEvent?.non_striker_after,
      current_bowler_id: lastEvent.current_bowler_before ?? prevEvent?.current_bowler_after,
      last_over_bowler_id: lastEvent.last_over_bowler_before ?? prevEvent?.last_over_bowler_after ?? null
    };

    if (!restoreState.striker_id || !restoreState.non_striker_id) {
      return { error: 'Undo unavailable for legacy ball state. Score one new ball first.' };
    }

    data.ball_events = data.ball_events.filter((b) => b.id !== lastEvent.id);

    const remainingEvents = data.ball_events
      .filter((b) => b.innings_id === inningsId)
      .sort((a, b) => a.id - b.id);

    const battingByPlayer = new Map();
    const bowlingByPlayer = new Map();
    let totalRuns = 0;
    let totalWickets = 0;
    let totalBalls = 0;
    let extrasWides = 0;
    let extrasNoBalls = 0;
    let extrasByes = 0;
    let extrasLegByes = 0;

    const ensureBatting = (playerId) => {
      if (!playerId) return null;
      if (!battingByPlayer.has(playerId)) {
        battingByPlayer.set(playerId, {
          id: nextId(data, 'batting_scores'),
          innings_id: inningsId,
          player_id: playerId,
          runs: 0,
          balls_faced: 0,
          fours: 0,
          sixes: 0,
          is_out: 0,
          dismissal_type: null,
          dismissal_bowler_id: null,
          dismissal_fielder_id: null,
          batting_order: 0
        });
      }
      return battingByPlayer.get(playerId);
    };

    const ensureBowling = (playerId) => {
      if (!playerId) return null;
      if (!bowlingByPlayer.has(playerId)) {
        bowlingByPlayer.set(playerId, {
          id: nextId(data, 'bowling_scores'),
          innings_id: inningsId,
          player_id: playerId,
          overs_bowled: 0,
          balls_bowled: 0,
          maidens: 0,
          runs_conceded: 0,
          wickets: 0,
          wides: 0,
          noballs: 0
        });
      }
      return bowlingByPlayer.get(playerId);
    };

    for (const ev of remainingEvents) {
      const runsScored = Number(ev.runs_scored || 0);
      const extrasRuns = Number(ev.extras_runs || 0);
      const ballTotal = Number(ev.total_runs ?? (runsScored + extrasRuns));
      const isWicket = !!ev.is_wicket;
      const isLegal = !ev.extras_type || (ev.extras_type !== 'wide' && ev.extras_type !== 'noball');

      totalRuns += ballTotal;
      totalWickets += isWicket ? 1 : 0;
      totalBalls += isLegal ? 1 : 0;

      if (ev.extras_type === 'wide') extrasWides += extrasRuns || 1;
      if (ev.extras_type === 'noball') extrasNoBalls += extrasRuns || 1;
      if (ev.extras_type === 'bye') extrasByes += extrasRuns || 0;
      if (ev.extras_type === 'legbye') extrasLegByes += extrasRuns || 0;

      const bat = ensureBatting(ev.batsman_id);
      if (bat) {
        if (!ev.extras_type) {
          bat.runs += runsScored;
          bat.balls_faced += 1;
          if (runsScored === 4) bat.fours += 1;
          if (runsScored === 6) bat.sixes += 1;
        } else if (isLegal) {
          bat.balls_faced += 1;
        }
      }

      if (isWicket) {
        const dismissedId = ev.dismissed_player_id || ev.batsman_id;
        const dismissed = ensureBatting(dismissedId);
        if (dismissed) {
          dismissed.is_out = 1;
          dismissed.dismissal_type = ev.wicket_type || null;
          dismissed.dismissal_bowler_id = ev.bowler_id || null;
        }
      }

      const bowl = ensureBowling(ev.bowler_id);
      if (bowl) {
        bowl.balls_bowled += isLegal ? 1 : 0;
        bowl.runs_conceded += ballTotal;
        bowl.wickets += isWicket ? 1 : 0;
        if (ev.extras_type === 'wide') bowl.wides += 1;
        if (ev.extras_type === 'noball') bowl.noballs += 1;
        bowl.overs_bowled = Math.floor(bowl.balls_bowled / 6) + (bowl.balls_bowled % 6) / 10;
      }
    }

    data.batting_scores = data.batting_scores.filter((b) => b.innings_id !== inningsId);
    data.bowling_scores = data.bowling_scores.filter((b) => b.innings_id !== inningsId);
    data.batting_scores.push(...Array.from(battingByPlayer.values()));
    data.bowling_scores.push(...Array.from(bowlingByPlayer.values()));

    innings.total_runs = totalRuns;
    innings.total_wickets = totalWickets;
    innings.total_balls = totalBalls;
    innings.total_overs = Math.floor(totalBalls / 6) + (totalBalls % 6) / 10;
    innings.extras_wides = extrasWides;
    innings.extras_noballs = extrasNoBalls;
    innings.extras_byes = extrasByes;
    innings.extras_legbyes = extrasLegByes;
    innings.striker_id = restoreState.striker_id;
    innings.non_striker_id = restoreState.non_striker_id;
    innings.current_bowler_id = restoreState.current_bowler_id || null;
    innings.last_over_bowler_id = restoreState.last_over_bowler_id || null;
    innings.is_completed = 0;

    saveDB(data);
    return {
      message: 'Last ball undone',
      total_runs: innings.total_runs,
      total_wickets: innings.total_wickets,
      total_balls: innings.total_balls,
      striker_id: innings.striker_id,
      non_striker_id: innings.non_striker_id,
      current_bowler_id: innings.current_bowler_id
    };
  },

  startSecondInnings(matchId) {
    const data = loadDB();
    const firstInnings = data.innings.find(i => i.match_id === matchId && i.innings_number === 1);
    if (!firstInnings) return { error: 'First innings not found' };
    firstInnings.is_completed = 1;
    const existing = data.innings.find((i) => i.match_id === matchId && i.innings_number === 2);
    if (existing) return { innings_id: existing.id };
    const inningsId = nextId(data, 'innings');
    data.innings.push({ id: inningsId, match_id: matchId, batting_team_id: firstInnings.bowling_team_id, bowling_team_id: firstInnings.batting_team_id, innings_number: 2, total_runs: 0, total_wickets: 0, total_overs: 0, total_balls: 0, extras_wides: 0, extras_noballs: 0, extras_byes: 0, extras_legbyes: 0, is_completed: 0, striker_id: null, non_striker_id: null, current_bowler_id: null, last_over_bowler_id: null, target_runs: firstInnings.total_runs + 1 });
    const match = data.matches.find((m) => m.id === matchId);
    if (match) match.target_runs = firstInnings.total_runs + 1;
    saveDB(data);
    return { innings_id: inningsId };
  },

  endMatch(matchId, manOfMatchId) {
    const data = loadDB();
    const match = data.matches.find(m => m.id === matchId);
    if (!match) return { error: 'Match not found' };
    const innings = data.innings.filter(i => i.match_id === matchId).sort((a, b) => a.innings_number - b.innings_number);
    if (innings.length < 2) return { error: 'Both innings required' };

    const inn1 = innings[0], inn2 = innings[1];
    inn1.is_completed = 1; inn2.is_completed = 1;

    let winnerId = null, resultSummary = '';
    if (inn2.total_runs > inn1.total_runs) {
      winnerId = inn2.batting_team_id;
      const winnerName = data.teams.find(t => t.id === winnerId)?.name || '';
      resultSummary = `${winnerName} won by ${10 - inn2.total_wickets} wickets`;
    } else if (inn1.total_runs > inn2.total_runs) {
      winnerId = inn1.batting_team_id;
      const winnerName = data.teams.find(t => t.id === winnerId)?.name || '';
      resultSummary = `${winnerName} won by ${inn1.total_runs - inn2.total_runs} runs`;
    } else {
      const superMatchId = this.scheduleSuperOverMatch(data, match.id);
      resultSummary = superMatchId ? 'Match Tied - Super Over Scheduled' : 'Match Tied';
    }

    this.finalizeCompletedMatch(data, match.id, winnerId, resultSummary, manOfMatchId || null);
    saveDB(data);
    return { result_summary: resultSummary, winner_id: winnerId };
  },

  // ========= SCORECARD =========
  getScorecard(matchId) {
    const data = loadDB();
    const innings = data.innings.filter(i => i.match_id === matchId).sort((a, b) => a.innings_number - b.innings_number);
    return innings.map(inn => {
      const batting = data.batting_scores.filter(b => b.innings_id === inn.id).map(b => {
        const player = data.players.find(p => p.id === b.player_id) || {};
        const bowler = b.dismissal_bowler_id ? data.players.find(p => p.id === b.dismissal_bowler_id) : null;
        const fielder = b.dismissal_fielder_id ? data.players.find(p => p.id === b.dismissal_fielder_id) : null;
        return { ...b, name: player.name, photo: player.photo, role: player.role, bowler_name: bowler?.name, fielder_name: fielder?.name };
      });
      const bowling = data.bowling_scores.filter(b => b.innings_id === inn.id).map(b => {
        const player = data.players.find(p => p.id === b.player_id) || {};
        return { ...b, name: player.name, photo: player.photo };
      });
      const team = data.teams.find(t => t.id === inn.batting_team_id) || {};
      return { ...inn, batting, bowling, team_name: team.name, team_logo: team.logo };
    });
  },

  getBalls(inningsId) {
    const data = loadDB();
    return data.ball_events.filter(b => b.innings_id === inningsId).map(b => {
      const bat = data.players.find(p => p.id === b.batsman_id) || {};
      const bow = data.players.find(p => p.id === b.bowler_id) || {};
      return { ...b, batsman_name: bat.name, bowler_name: bow.name };
    }).sort((a, b) => a.id - b.id);
  },

  // ========= POINTS TABLE =========
  getPoints(leagueId) {
    const data = loadDB();
    const teams = data.teams.filter((t) => t.league_id === leagueId);
    const completedMatches = data.matches.filter((m) => m.league_id === leagueId && m.status === 'completed' && !m.is_super_over);
    const completedMatchIds = completedMatches.map((m) => m.id);

    const table = teams.map((team) => ({
      league_id: leagueId,
      team_id: team.id,
      matches_played: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      no_results: 0,
      points: 0,
      nrr: 0,
      name: team.name,
      logo: team.logo,
    }));

    const rowByTeam = new Map(table.map((row) => [row.team_id, row]));

    for (const match of completedMatches) {
      const a = rowByTeam.get(match.team_a_id);
      const b = rowByTeam.get(match.team_b_id);
      if (!a || !b) continue;

      a.matches_played += 1;
      b.matches_played += 1;

      if (match.winner_id === match.team_a_id) {
        a.wins += 1;
        b.losses += 1;
        a.points += 2;
      } else if (match.winner_id === match.team_b_id) {
        b.wins += 1;
        a.losses += 1;
        b.points += 2;
      } else {
        a.ties += 1;
        b.ties += 1;
        a.points += 1;
        b.points += 1;
      }
    }

    for (const row of table) {
      const batInnings = data.innings.filter((i) => completedMatchIds.includes(i.match_id) && i.batting_team_id === row.team_id);
      const bowlInnings = data.innings.filter((i) => completedMatchIds.includes(i.match_id) && i.bowling_team_id === row.team_id);
      const batRuns = batInnings.reduce((sum, i) => sum + i.total_runs, 0);
      const batBalls = batInnings.reduce((sum, i) => sum + i.total_balls, 0);
      const bowlRuns = bowlInnings.reduce((sum, i) => sum + i.total_runs, 0);
      const bowlBalls = bowlInnings.reduce((sum, i) => sum + i.total_balls, 0);

      if (batBalls > 0 && bowlBalls > 0) {
        row.nrr = Math.round((((batRuns / batBalls) * 6) - ((bowlRuns / bowlBalls) * 6)) * 1000) / 1000;
      }
    }

    return table.sort((a, b) => b.points - a.points || b.nrr - a.nrr);
  },

  // ========= STATISTICS =========
  getBattingStats(leagueId) {
    const data = loadDB();
    const completedMatchIds = data.matches.filter(m => m.league_id === leagueId && m.status === 'completed').map(m => m.id);
    const inningsIds = data.innings.filter(i => completedMatchIds.includes(i.match_id)).map(i => i.id);
    const playerStats = {};
    data.batting_scores.filter(b => inningsIds.includes(b.innings_id)).forEach(b => {
      if (!playerStats[b.player_id]) playerStats[b.player_id] = { total_runs: 0, total_balls: 0, total_fours: 0, total_sixes: 0 };
      playerStats[b.player_id].total_runs += b.runs;
      playerStats[b.player_id].total_balls += b.balls_faced;
      playerStats[b.player_id].total_fours += b.fours;
      playerStats[b.player_id].total_sixes += b.sixes;
    });
    return Object.entries(playerStats).map(([pid, s]) => {
      const player = data.players.find(p => p.id === parseInt(pid)) || {};
      const team = data.teams.find(t => t.id === player.team_id) || {};
      return { id: parseInt(pid), name: player.name, photo: player.photo, role: player.role, team_name: team.name, team_logo: team.logo, ...s };
    }).sort((a, b) => b.total_runs - a.total_runs);
  },
  getBowlingStats(leagueId) {
    const data = loadDB();
    const completedMatchIds = data.matches.filter(m => m.league_id === leagueId && m.status === 'completed').map(m => m.id);
    const inningsIds = data.innings.filter(i => completedMatchIds.includes(i.match_id)).map(i => i.id);
    const playerStats = {};
    data.bowling_scores.filter(b => inningsIds.includes(b.innings_id)).forEach(b => {
      if (!playerStats[b.player_id]) playerStats[b.player_id] = { total_balls: 0, total_runs_conceded: 0, total_wickets: 0 };
      playerStats[b.player_id].total_balls += b.balls_bowled;
      playerStats[b.player_id].total_runs_conceded += b.runs_conceded;
      playerStats[b.player_id].total_wickets += b.wickets;
    });
    return Object.entries(playerStats).map(([pid, s]) => {
      const player = data.players.find(p => p.id === parseInt(pid)) || {};
      const team = data.teams.find(t => t.id === player.team_id) || {};
      return { id: parseInt(pid), name: player.name, photo: player.photo, role: player.role, team_name: team.name, team_logo: team.logo, ...s };
    }).sort((a, b) => b.total_wickets - a.total_wickets);
  },
  getGlobalBattingStats() {
    const data = loadDB();
    const completedMatchIds = data.matches.filter(m => m.status === 'completed').map(m => m.id);
    const inningsIds = data.innings.filter(i => completedMatchIds.includes(i.match_id)).map(i => i.id);
    const playerStats = {};
    data.batting_scores.filter(b => inningsIds.includes(b.innings_id)).forEach(b => {
      if (!playerStats[b.player_id]) playerStats[b.player_id] = { total_runs: 0, total_balls: 0, total_fours: 0, total_sixes: 0 };
      playerStats[b.player_id].total_runs += b.runs;
      playerStats[b.player_id].total_balls += b.balls_faced;
      playerStats[b.player_id].total_fours += b.fours;
      playerStats[b.player_id].total_sixes += b.sixes;
    });
    return Object.entries(playerStats).map(([pid, s]) => {
      const player = data.players.find(p => p.id === parseInt(pid)) || {};
      const team = data.teams.find(t => t.id === player.team_id) || {};
      return { id: parseInt(pid), name: player.name, photo: player.photo, team_name: team.name, team_logo: team.logo, ...s };
    }).sort((a, b) => b.total_runs - a.total_runs).slice(0, 10);
  },
  getGlobalBowlingStats() {
    const data = loadDB();
    const completedMatchIds = data.matches.filter(m => m.status === 'completed').map(m => m.id);
    const inningsIds = data.innings.filter(i => completedMatchIds.includes(i.match_id)).map(i => i.id);
    const playerStats = {};
    data.bowling_scores.filter(b => inningsIds.includes(b.innings_id)).forEach(b => {
      if (!playerStats[b.player_id]) playerStats[b.player_id] = { total_balls: 0, total_runs_conceded: 0, total_wickets: 0 };
      playerStats[b.player_id].total_balls += b.balls_bowled;
      playerStats[b.player_id].total_runs_conceded += b.runs_conceded;
      playerStats[b.player_id].total_wickets += b.wickets;
    });
    return Object.entries(playerStats).map(([pid, s]) => {
      const player = data.players.find(p => p.id === parseInt(pid)) || {};
      const team = data.teams.find(t => t.id === player.team_id) || {};
      return { id: parseInt(pid), name: player.name, photo: player.photo, team_name: team.name, team_logo: team.logo, ...s };
    }).sort((a, b) => b.total_wickets - a.total_wickets).slice(0, 10);
  },
  getPlayerStats(playerId, leagueId = null) {
    const data = loadDB();
    const player = data.players.find((p) => p.id === playerId);
    if (!player) return null;

    const team = data.teams.find((t) => t.id === player.team_id) || {};
    const leagueFilter = leagueId ? parseInt(leagueId, 10) : null;
    const matchById = new Map(data.matches.map((m) => [m.id, m]));
    const teamById = new Map(data.teams.map((t) => [t.id, t]));

    const relevantInnings = data.innings.filter((inn) => {
      const match = matchById.get(inn.match_id);
      if (!match) return false;
      if (leagueFilter && match.league_id !== leagueFilter) return false;
      return true;
    });
    const inningsById = new Map(relevantInnings.map((inn) => [inn.id, inn]));

    const battingEntries = data.batting_scores.filter(
      (b) => b.player_id === playerId && inningsById.has(b.innings_id)
    );
    const bowlingEntries = data.bowling_scores.filter(
      (b) => b.player_id === playerId && inningsById.has(b.innings_id)
    );

    const battingTotals = battingEntries.reduce(
      (acc, b) => {
        acc.runs += b.runs || 0;
        acc.balls += b.balls_faced || 0;
        acc.fours += b.fours || 0;
        acc.sixes += b.sixes || 0;
        acc.outs += b.is_out ? 1 : 0;
        acc.innings += 1;
        if ((b.runs || 0) >= 50) acc.fifties += 1;
        if ((b.runs || 0) >= 100) acc.hundreds += 1;
        if ((b.runs || 0) > acc.highest) acc.highest = b.runs || 0;
        return acc;
      },
      { runs: 0, balls: 0, fours: 0, sixes: 0, outs: 0, innings: 0, fifties: 0, hundreds: 0, highest: 0 }
    );

    const bowlingTotals = bowlingEntries.reduce(
      (acc, b) => {
        acc.balls += b.balls_bowled || 0;
        acc.runs += b.runs_conceded || 0;
        acc.wickets += b.wickets || 0;
        acc.maidens += b.maidens || 0;
        acc.innings += 1;
        const currentWickets = b.wickets || 0;
        const currentRuns = b.runs_conceded || 0;
        if (
          currentWickets > acc.bestWickets ||
          (currentWickets === acc.bestWickets && currentRuns < acc.bestRuns)
        ) {
          acc.bestWickets = currentWickets;
          acc.bestRuns = currentRuns;
        }
        return acc;
      },
      { balls: 0, runs: 0, wickets: 0, maidens: 0, innings: 0, bestWickets: 0, bestRuns: 9999 }
    );

    const matchStatsMap = new Map();

    battingEntries.forEach((entry) => {
      const inn = inningsById.get(entry.innings_id);
      if (!inn) return;
      const match = matchById.get(inn.match_id);
      if (!match) return;
      const existing = matchStatsMap.get(match.id) || {
        match_id: match.id,
        match_number: match.match_number,
        date: match.date || match.match_date || null,
        time: match.time || match.match_time || null,
        venue: match.venue || null,
        status: match.status,
        team_name: team.name || null,
        opponent_name: null,
        batting: { runs: 0, balls: 0, fours: 0, sixes: 0, out: false },
        bowling: { balls: 0, runs: 0, wickets: 0, maidens: 0 },
      };

      const opponentId = match.team_a_id === player.team_id ? match.team_b_id : match.team_a_id;
      const opponentTeam = teamById.get(opponentId) || {};
      existing.opponent_name = existing.opponent_name || opponentTeam.name || null;

      existing.batting.runs += entry.runs || 0;
      existing.batting.balls += entry.balls_faced || 0;
      existing.batting.fours += entry.fours || 0;
      existing.batting.sixes += entry.sixes || 0;
      existing.batting.out = existing.batting.out || !!entry.is_out;

      matchStatsMap.set(match.id, existing);
    });

    bowlingEntries.forEach((entry) => {
      const inn = inningsById.get(entry.innings_id);
      if (!inn) return;
      const match = matchById.get(inn.match_id);
      if (!match) return;
      const existing = matchStatsMap.get(match.id) || {
        match_id: match.id,
        match_number: match.match_number,
        date: match.date || match.match_date || null,
        time: match.time || match.match_time || null,
        venue: match.venue || null,
        status: match.status,
        team_name: team.name || null,
        opponent_name: null,
        batting: { runs: 0, balls: 0, fours: 0, sixes: 0, out: false },
        bowling: { balls: 0, runs: 0, wickets: 0, maidens: 0 },
      };

      const opponentId = match.team_a_id === player.team_id ? match.team_b_id : match.team_a_id;
      const opponentTeam = teamById.get(opponentId) || {};
      existing.opponent_name = existing.opponent_name || opponentTeam.name || null;

      existing.bowling.balls += entry.balls_bowled || 0;
      existing.bowling.runs += entry.runs_conceded || 0;
      existing.bowling.wickets += entry.wickets || 0;
      existing.bowling.maidens += entry.maidens || 0;

      matchStatsMap.set(match.id, existing);
    });

    const match_stats = Array.from(matchStatsMap.values()).sort((a, b) => {
      const dateA = new Date(`${a.date || '1970-01-01'} ${a.time || '00:00'}`).getTime();
      const dateB = new Date(`${b.date || '1970-01-01'} ${b.time || '00:00'}`).getTime();
      if (dateA !== dateB) return dateB - dateA;
      return (b.match_number || 0) - (a.match_number || 0);
    });

    return {
      player: {
        id: player.id,
        name: player.name,
        photo: player.photo,
        role: player.role,
        jersey_number: player.jersey_number,
        team_id: player.team_id,
        team_name: team.name || null,
        team_logo: team.logo || null,
      },
      totals: {
        matches: match_stats.length,
        batting: {
          innings: battingTotals.innings,
          runs: battingTotals.runs,
          balls: battingTotals.balls,
          fours: battingTotals.fours,
          sixes: battingTotals.sixes,
          outs: battingTotals.outs,
          highest: battingTotals.highest,
          fifties: battingTotals.fifties,
          hundreds: battingTotals.hundreds,
          average: battingTotals.outs > 0 ? Number((battingTotals.runs / battingTotals.outs).toFixed(2)) : battingTotals.runs,
          strike_rate: battingTotals.balls > 0 ? Number(((battingTotals.runs / battingTotals.balls) * 100).toFixed(2)) : 0,
        },
        bowling: {
          innings: bowlingTotals.innings,
          balls: bowlingTotals.balls,
          runs: bowlingTotals.runs,
          wickets: bowlingTotals.wickets,
          maidens: bowlingTotals.maidens,
          economy: bowlingTotals.balls > 0 ? Number((bowlingTotals.runs / (bowlingTotals.balls / 6)).toFixed(2)) : 0,
          average: bowlingTotals.wickets > 0 ? Number((bowlingTotals.runs / bowlingTotals.wickets).toFixed(2)) : null,
          strike_rate: bowlingTotals.wickets > 0 ? Number((bowlingTotals.balls / bowlingTotals.wickets).toFixed(2)) : null,
          best: `${bowlingTotals.bestWickets}/${bowlingTotals.bestRuns === 9999 ? 0 : bowlingTotals.bestRuns}`,
        },
      },
      match_stats,
    };
  },
  getDashboardStats() {
    const data = loadDB();
    return {
      leagues: data.leagues.length, teams: data.teams.length,
      matches: data.matches.length, players: data.players.length,
      liveMatches: data.matches.filter(m => m.status === 'live').length
    };
  }
};

module.exports = db;
