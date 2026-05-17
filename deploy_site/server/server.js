const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./database');
const mediaStorage = require('./mediaStorage');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;
const WEB_DIST = path.join(__dirname, '..', 'dist');
const TEAM_BANNER_DIR = path.posix.join('media', 'banners', 'team_squad');
const LEAGUE_BANNER_DIR = path.posix.join('media', 'banners', 'leagues');
const TEAMS_BANNER_DIR = path.posix.join('media', 'banners', 'teams');
const MATCHES_BANNER_DIR = path.posix.join('media', 'banners', 'matches');
const RESULTS_BANNER_DIR = path.posix.join('media', 'banners', 'results');

const defaultOrigins = [
  'http://localhost',
  'http://127.0.0.1',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost'
];
const envOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [];
const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

const allowedOriginPatterns = [/\.azurewebsites\.net$/i];

function isAllowedOrigin(origin) {
  if (!origin || origin === 'null' || allowedOrigins.includes(origin)) return true;
  try {
    const hostname = new URL(origin).hostname;
    return allowedOriginPatterns.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '80mb' }));

async function serveCloudAsset(req, res, relativePath) {
  try {
    const asset = await mediaStorage.readAsset(relativePath);
    if (!asset) {
      return res.status(404).end();
    }
    res.setHeader('Content-Type', asset.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(asset.buffer);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load media asset' });
  }
}

const localUploadsDir = mediaStorage.getLocalUploadsDir
  ? mediaStorage.getLocalUploadsDir()
  : path.join(__dirname, 'uploads');
const localMediaDir = mediaStorage.getLocalMediaDir
  ? mediaStorage.getLocalMediaDir()
  : path.join(__dirname, '..', 'media');
const fallbackMediaDir = mediaStorage.getFallbackMediaDir ? mediaStorage.getFallbackMediaDir() : null;

if (mediaStorage.isCloudEnabled()) {
  app.get('/uploads/*', (req, res) => serveCloudAsset(req, res, req.path.replace(/^\//, '')));
  app.get('/media/*', (req, res) => serveCloudAsset(req, res, req.path.replace(/^\//, '')));
} else {
  app.use('/uploads', express.static(localUploadsDir));
  app.use('/media', express.static(localMediaDir));
  if (fallbackMediaDir && fallbackMediaDir !== localMediaDir) {
    app.use('/media', express.static(fallbackMediaDir));
  }
}

const upload = multer({ storage: multer.memoryStorage() });

function fileFromRequest(reqFiles, fieldName) {
  if (Array.isArray(reqFiles)) {
    return reqFiles.find((f) => f.fieldname === fieldName) || null;
  }
  if (reqFiles && typeof reqFiles === 'object' && Array.isArray(reqFiles[fieldName])) {
    return reqFiles[fieldName][0] || null;
  }
  return null;
}

async function saveBase64ImageFromBody(req, fieldName) {
  const dataUrl = req.body?.[`${fieldName}_data`];
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const originalName = req.body?.[`${fieldName}_name`] || `${fieldName}.png`;
  return mediaStorage.saveDataUrl(dataUrl, 'uploads', originalName);
}

async function resolveUploadedImagePath(req, fieldName) {
  const file = fileFromRequest(req.files, fieldName);
  if (file) {
    return mediaStorage.saveMulterFile(file, 'uploads', file.originalname || `${fieldName}.png`);
  }
  return saveBase64ImageFromBody(req, fieldName);
}

// ===================== AUTHENTICATION =====================
app.post('/api/auth/signup', (req, res) => {
  const { username, password } = req.body;
  const result = db.createUser(username, password);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.getUser(username);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: 'mock-jwt-token-123', username });
});

// ===================== LEAGUES =====================
app.get('/api/leagues', (req, res) => res.json(db.getLeagues()));
app.get('/api/leagues/:id', (req, res) => {
  const league = db.getLeague(parseInt(req.params.id));
  if (!league) return res.status(404).json({ error: 'Not found' });
  res.json(league);
});
app.post('/api/leagues', upload.single('logo'), async (req, res) => {
  const { name, city, venue, organizer, season, format, overs_per_innings } = req.body;
  const logo = req.file ? await mediaStorage.saveMulterFile(req.file, 'uploads', req.file.originalname || 'league_logo.png') : null;
  const id = db.createLeague({ name, city, venue, organizer, logo, season, format: format || 'round-robin', overs_per_innings: parseInt(overs_per_innings) || 20 });
  res.json({ id, message: 'League created' });
});
app.put('/api/leagues/:id', upload.single('logo'), async (req, res) => {
  const { name, city, venue, organizer, season, format, overs_per_innings, status } = req.body;
  const league = db.getLeague(parseInt(req.params.id));
  if (!league) return res.status(404).json({ error: 'Not found' });
  const logo = req.file ? await mediaStorage.saveMulterFile(req.file, 'uploads', req.file.originalname || 'league_logo.png') : league.logo;
  db.updateLeague(parseInt(req.params.id), { name: name || league.name, city: city || league.city, venue: venue || league.venue, organizer: organizer || league.organizer, logo, season: season || league.season, format: format || league.format, overs_per_innings: parseInt(overs_per_innings) || league.overs_per_innings, status: status || league.status });
  res.json({ message: 'Updated' });
});
app.delete('/api/leagues/:id', (req, res) => { db.deleteLeague(parseInt(req.params.id)); res.json({ message: 'Deleted' }); });

// ===================== SPONSORS =====================
app.post('/api/leagues/:id/sponsors', upload.single('logo'), async (req, res) => {
  const logo = req.file ? await mediaStorage.saveMulterFile(req.file, 'uploads', req.file.originalname || 'sponsor_logo.png') : null;
  const id = db.addSponsor(parseInt(req.params.id), req.body.name, logo);
  res.json({ id });
});
app.delete('/api/sponsors/:id', (req, res) => { db.deleteSponsor(parseInt(req.params.id)); res.json({ message: 'Deleted' }); });

// ===================== TEAMS =====================
app.get('/api/leagues/:id/teams', (req, res) => res.json(db.getTeams(parseInt(req.params.id))));
app.get('/api/teams/:id', (req, res) => {
  const team = db.getTeam(parseInt(req.params.id));
  if (!team) return res.status(404).json({ error: 'Not found' });
  res.json(team);
});
app.post('/api/teams', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'captain_photo', maxCount: 1 }]), async (req, res) => {
  const logo = await resolveUploadedImagePath(req, 'logo');
  const captain_photo = await resolveUploadedImagePath(req, 'captain_photo');
  const id = db.createTeam({ league_id: parseInt(req.body.league_id), name: req.body.name, logo, captain_name: req.body.captain_name, captain_photo });
  res.json({ id });
});

app.post('/api/teams/bulk', upload.any(), async (req, res) => {
  try {
    const rawData = req.body?.data;
    let data = null;

    if (typeof rawData === 'string') {
      try {
        data = JSON.parse(rawData);
      } catch {
        return res.status(400).json({ error: 'Invalid team payload format' });
      }
    } else if (rawData && typeof rawData === 'object') {
      data = rawData;
    } else if (req.body && typeof req.body === 'object') {
      const parsedPlayers = typeof req.body.players === 'string'
        ? (() => {
            try {
              return JSON.parse(req.body.players);
            } catch {
              return req.body.players;
            }
          })()
        : req.body.players;

      data = {
        league_id: req.body.league_id,
        name: req.body.name,
        captain_index: req.body.captain_index,
        players: parsedPlayers
      };
    }

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Team payload is required' });
    }
    const leagueId = parseInt(data.league_id, 10);
    const teamName = String(data.name || '').trim();
    const captainIndex = parseInt(data.captain_index, 10);
    const players = data.players;
    const reqFiles = Array.isArray(req.files) ? req.files : [];

    const normalizedPlayers = Array.isArray(players)
      ? players.map((p) => ({
          ...p,
          name: String(p?.name || '').trim(),
          role: String(p?.role || 'batsman').toLowerCase()
        }))
      : [];
    const namedPlayers = normalizedPlayers.filter((p) => p.name);
    const bowlingCount = namedPlayers.filter((p) => p.role === 'bowler' || p.role === 'all-rounder' || p.role === 'all rounder').length;

    if (!teamName) {
      return res.status(400).json({ error: 'Team name is required' });
    }
    if (!Number.isInteger(leagueId) || leagueId <= 0) {
      return res.status(400).json({ error: 'League is required' });
    }
    if (namedPlayers.length !== 11) {
      return res.status(400).json({ error: 'Exactly 11 players are mandatory for squad creation' });
    }
    if (bowlingCount < 2) {
      return res.status(400).json({ error: 'At least 2 bowlers/all-rounders are mandatory in squad' });
    }
    if (!Number.isInteger(captainIndex) || captainIndex < 0 || captainIndex > 10 || !normalizedPlayers[captainIndex]?.name) {
      return res.status(400).json({ error: 'Captain must be selected from entered players' });
    }
    
    const logo = await resolveUploadedImagePath({ ...req, files: reqFiles }, 'logo');

    // Determine captain name and photo from the chosen index
    let captain_name = '';
    let captain_photo = null;
    let captain_id = null;

    if (captainIndex !== null && normalizedPlayers[captainIndex]) {
      captain_name = normalizedPlayers[captainIndex].name;
      captain_photo = await resolveUploadedImagePath({ ...req, files: reqFiles }, `player_photo_${captainIndex}`);
    }

    // 1. Create Team
    const teamId = db.createTeam({ 
      league_id: leagueId,
      name: teamName,
      logo, 
      captain_name, 
      captain_photo 
    });

    // 2. Prepare players array
    const playersArray = [];
    for (let index = 0; index < normalizedPlayers.length; index += 1) {
      const p = normalizedPlayers[index];
      const photoPath = await resolveUploadedImagePath({ ...req, files: reqFiles }, `player_photo_${index}`);
      playersArray.push({
        name: p.name,
        role: p.role || 'batsman',
        jersey_number: parseInt(p.jersey_number) || 0,
        photo: photoPath || null
      });
    }

    const validPlayers = playersArray.filter((p) => p.name);

    // 3. Create Players
    if (validPlayers.length > 0) {
      const playerIds = db.createPlayers(teamId, validPlayers);
      if (captainIndex !== null && normalizedPlayers[captainIndex]) {
        captain_id = playerIds[captainIndex] || null;
      }
    }

    if (captain_id) {
      db.updateTeam(teamId, { captain_id });
    }

    res.json({ id: teamId, message: 'Team and squad created successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create team and squad' });
  }
});

app.post('/api/banners/team-squad', async (req, res) => {
  try {
    const { teamId, teamName, imageData } = req.body || {};
    if (!teamId || !teamName || !imageData || typeof imageData !== 'string') {
      return res.status(400).json({ error: 'teamId, teamName and imageData are required' });
    }

    const safeName = teamName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    const parsedTeamId = parseInt(teamId, 10);
    const teamDirName = `team_${parsedTeamId}`;
    const fileName = `${safeName || 'team'}_squad_${Date.now()}.png`;
    const relativePath = path.posix.join(TEAM_BANNER_DIR, teamDirName, fileName);
    await mediaStorage.writeDataUrlToPath(relativePath, imageData);

    const publicPath = `/${relativePath}`;
    db.updateTeam(parsedTeamId, { squad_banner: publicPath });
    return res.json({ message: 'Team squad banner saved', path: publicPath });
  } catch (error) {
    console.error('Team banner save error:', error);
    return res.status(500).json({ error: 'Failed to save team squad banner' });
  }
});

app.post('/api/banners/save', async (req, res) => {
  try {
    const { category, fileName, imageData } = req.body || {};
    if (!category || !fileName || !imageData || typeof imageData !== 'string') {
      return res.status(400).json({ error: 'category, fileName and imageData are required' });
    }

    const categoryMap = { leagues: LEAGUE_BANNER_DIR, teams: TEAMS_BANNER_DIR, matches: MATCHES_BANNER_DIR, results: RESULTS_BANNER_DIR };

    const targetDir = categoryMap[category];
    if (!targetDir) return res.status(400).json({ error: 'Invalid banner category' });

    const safeFileName = String(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const relativePath = path.posix.join(targetDir, safeFileName);
    await mediaStorage.writeDataUrlToPath(relativePath, imageData);

    return res.json({ message: 'Banner saved', path: `/${relativePath}` });
  } catch (error) {
    console.error('Banner save error:', error);
    return res.status(500).json({ error: 'Failed to save banner' });
  }
});
app.put('/api/teams/:id', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'captain_photo', maxCount: 1 }]), async (req, res) => {
  const team = db.getTeam(parseInt(req.params.id));
  if (!team) return res.status(404).json({ error: 'Not found' });
  const uploadedLogo = await resolveUploadedImagePath(req, 'logo');
  const uploadedCaptainPhoto = await resolveUploadedImagePath(req, 'captain_photo');
  const logo = uploadedLogo || team.logo;
  const captain_photo = uploadedCaptainPhoto || team.captain_photo;
  db.updateTeam(parseInt(req.params.id), { name: req.body.name || team.name, logo, captain_name: req.body.captain_name || team.captain_name, captain_photo });
  res.json({ message: 'Updated' });
});
app.delete('/api/teams/:id', (req, res) => { db.deleteTeam(parseInt(req.params.id)); res.json({ message: 'Deleted' }); });

// ===================== PLAYERS =====================
app.get('/api/teams/:id/players', (req, res) => res.json(db.getPlayers(parseInt(req.params.id))));
app.post('/api/players', upload.single('photo'), async (req, res) => {
  const photo = req.file
    ? await mediaStorage.saveMulterFile(req.file, 'uploads', req.file.originalname || 'player_photo.png')
    : (await saveBase64ImageFromBody(req, 'photo'));
  const id = db.createPlayer({ team_id: parseInt(req.body.team_id), name: req.body.name, photo, role: req.body.role || 'batsman', jersey_number: parseInt(req.body.jersey_number) || 0 });
  res.json({ id });
});
app.put('/api/players/:id', upload.single('photo'), async (req, res) => {
  const photoPath = req.file
    ? await mediaStorage.saveMulterFile(req.file, 'uploads', req.file.originalname || 'player_photo.png')
    : await saveBase64ImageFromBody(req, 'photo');

  const updates = {};
  if (typeof req.body.name === 'string' && req.body.name.trim()) updates.name = req.body.name;
  if (typeof req.body.role === 'string' && req.body.role.trim()) updates.role = req.body.role;
  if (req.body.jersey_number !== undefined && req.body.jersey_number !== null && req.body.jersey_number !== '') {
    const jerseyNumber = parseInt(req.body.jersey_number, 10);
    if (!Number.isNaN(jerseyNumber)) updates.jersey_number = jerseyNumber;
  }
  if (photoPath) updates.photo = photoPath;

  const updated = db.updatePlayer(parseInt(req.params.id), updates);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Updated' });
});
app.get('/api/players/:id/stats', (req, res) => {
  const playerId = parseInt(req.params.id, 10);
  if (!playerId) return res.status(400).json({ error: 'Invalid player id' });
  const stats = db.getPlayerStats(playerId, req.query.league_id || null);
  if (!stats) return res.status(404).json({ error: 'Player not found' });
  return res.json(stats);
});
app.delete('/api/players/:id', (req, res) => { db.deletePlayer(parseInt(req.params.id)); res.json({ message: 'Deleted' }); });

// ===================== MATCHES =====================
app.get('/api/leagues/:id/matches', (req, res) => res.json(db.getMatches(parseInt(req.params.id))));
app.get('/api/matches', (req, res) => res.json(db.getAllMatches()));
app.get('/api/matches/:id', (req, res) => {
  const match = db.getMatch(parseInt(req.params.id));
  if (!match) return res.status(404).json({ error: 'Not found' });
  res.json(match);
});
app.get('/api/matches/live/all', (req, res) => res.json(db.getLiveMatches()));
app.get('/api/matches/upcoming/all', (req, res) => res.json(db.getUpcomingMatches()));
app.get('/api/matches/completed/all', (req, res) => res.json(db.getCompletedMatches()));
app.post('/api/matches', (req, res) => {
  const result = db.createMatch(req.body || {});
  if (result.error) return res.status(400).json(result);
  res.json(result);
});
app.post('/api/leagues/:id/generate-fixtures', (req, res) => {
  const result = db.generateFixtures(parseInt(req.params.id), req.body || {});
  if (result.error) return res.status(400).json(result);
  res.json(result);
});
app.put('/api/matches/:id', (req, res) => {
  db.updateMatch(parseInt(req.params.id), req.body);
  res.json({ message: 'Updated' });
});
app.delete('/api/matches/:id', (req, res) => {
  const deleted = db.deleteMatch(parseInt(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'Match not found' });
  res.json({ message: 'Fixture deleted' });
});
app.delete('/api/leagues/:id/fixtures/upcoming', (req, res) => {
  const result = db.deleteUpcomingFixtures(parseInt(req.params.id));
  res.json({ message: `${result.count} upcoming fixtures deleted`, count: result.count });
});

// ===================== SCORING =====================
app.post('/api/matches/:id/start', (req, res) => {
  const result = db.startMatch(parseInt(req.params.id), req.body);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});
app.post('/api/innings/:id/ball', (req, res) => {
  const result = db.recordBall(parseInt(req.params.id), req.body);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});
app.delete('/api/innings/:id/ball/last', (req, res) => {
  const result = db.undoLastBall(parseInt(req.params.id));
  if (result.error) return res.status(400).json(result);
  res.json(result);
});
app.post('/api/innings/:id/select-bowler', (req, res) => {
  const result = db.selectBowler(parseInt(req.params.id), parseInt(req.body.bowler_id));
  if (result.error) return res.status(400).json(result);
  res.json(result);
});
app.post('/api/innings/:id/initialize', (req, res) => {
  const result = db.initializeInnings(parseInt(req.params.id), req.body);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});
app.post('/api/matches/:id/second-innings', (req, res) => {
  const result = db.startSecondInnings(parseInt(req.params.id));
  if (result.error) return res.status(400).json(result);
  res.json(result);
});
app.post('/api/matches/:id/end', (req, res) => {
  const result = db.endMatch(parseInt(req.params.id), req.body.man_of_match_id ? parseInt(req.body.man_of_match_id) : null);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});
app.get('/api/matches/:id/scorecard', (req, res) => res.json(db.getScorecard(parseInt(req.params.id))));
app.get('/api/innings/:id/balls', (req, res) => res.json(db.getBalls(parseInt(req.params.id))));

// ===================== POINTS & STATS =====================
app.get('/api/leagues/:id/points', (req, res) => res.json(db.getPoints(parseInt(req.params.id))));
app.get('/api/leagues/:id/stats/batting', (req, res) => res.json(db.getBattingStats(parseInt(req.params.id))));
app.get('/api/leagues/:id/stats/bowling', (req, res) => res.json(db.getBowlingStats(parseInt(req.params.id))));
app.get('/api/stats/global/batting', (req, res) => res.json(db.getGlobalBattingStats()));
app.get('/api/stats/global/bowling', (req, res) => res.json(db.getGlobalBowlingStats()));
app.get('/api/stats/dashboard', (req, res) => res.json(db.getDashboardStats()));

if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get(/^\/(?!api|uploads|media).*/, (req, res) => {
    res.sendFile(path.join(WEB_DIST, 'index.html'));
  });
}

function logInitFailure(label, error) {
  const message = error?.message || String(error);
  console.error(`${label} init failed: ${message}`);
}

async function startServer() {
  app.listen(PORT, () => console.log(`CricketHub API running on http://localhost:${PORT}`));

  Promise.allSettled([mediaStorage.init(), db.initStorage()])
    .then((results) => {
      if (results[0].status === 'rejected') logInitFailure('Media storage', results[0].reason);
      if (results[1].status === 'rejected') logInitFailure('DB', results[1].reason);
    })
    .catch((error) => {
      console.error('Background init failed:', error?.message || String(error));
    });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});
