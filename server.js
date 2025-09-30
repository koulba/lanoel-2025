const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const flash = require('connect-flash');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const db = require('./db');

const app = express();
const upload = multer({ dest: 'public/uploads/' });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'lanoel-secret', resave: false, saveUninitialized: true }));
app.use(flash());

// --- MIDDLEWARE AUTH ---
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.is_admin) return next();
  req.flash('error', 'Veuillez vous connecter en tant qu\'admin.');
  res.redirect('/login');
}

// --- ROUTE INDEX ---
app.get('/', async (req, res) => {
  const games = await db.all(`
    SELECT g.*, 
           (SELECT COUNT(*) FROM votes v WHERE v.game_id = g.id) AS votes_count
    FROM games g
    ORDER BY votes_count DESC
  `);

  const leaderboard = await db.all(`
    SELECT t.id, t.name, COALESCE(SUM(r.points),0) as total_points
    FROM teams t
    LEFT JOIN results r ON r.team_id = t.id
    GROUP BY t.id
    ORDER BY total_points DESC
  `);

  let votesCount = 0;
  if (req.session.user) {
    const rows = await db.all("SELECT game_id FROM votes WHERE user_id = ?", [req.session.user.id]);
    votesCount = rows.length;
  }

  res.render('index', {
    user: req.session.user,
    games,
    leaderboard,
    votesCount,
    messages: req.flash()
  });
});

// --- AUTH ---
app.get('/login', (req, res) => {
  res.render('login', { messages: req.flash() });
});

app.post('/login', async (req, res) => {
  const { pseudo, password } = req.body;

  if (!pseudo || !password) {
    req.flash('error', 'Tous les champs sont requis.');
    return res.redirect('/login');
  }

  // 🔑 Recherche par pseudo (et plus par email)
  const user = await db.get("SELECT * FROM users WHERE pseudo = ?", [pseudo]);
  if (!user) {
    req.flash('error', 'Pseudo ou mot de passe incorrect.');
    return res.redirect('/login');
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    req.flash('error', 'Pseudo ou mot de passe incorrect.');
    return res.redirect('/login');
  }

  req.session.user = {
    id: user.id,
    pseudo: user.pseudo,
    is_admin: user.is_admin
  };

  res.redirect(user.is_admin ? '/admin' : '/');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- REGISTER ---
app.get('/register', (req, res) => {
  res.render('register', { messages: req.flash() });
});

app.post('/register', async (req, res) => {
  const { pseudo, password } = req.body;

  if (!pseudo || !password) {
    req.flash('error', 'Tous les champs sont requis.');
    return res.redirect('/register');
  }

  const existing = await db.get("SELECT * FROM users WHERE pseudo = ?", [pseudo]);
  if (existing) {
    req.flash('error', 'Ce pseudo est déjà pris.');
    return res.redirect('/register');
  }

  const password_hash = await bcrypt.hash(password, 10);

  const result = await db.run(
    "INSERT INTO users (pseudo, email, password_hash, is_admin) VALUES (?,?,?,?)",
    [pseudo, null, password_hash, 0]
  );

  req.session.user = { id: result.lastID, pseudo, is_admin: 0 };
  req.flash('success', 'Compte créé avec succès !');
  res.redirect('/');
});

// --- ADMIN ---
app.get('/admin', requireAdmin, async (req, res) => {
  const games = await db.all("SELECT * FROM games ORDER BY order_index ASC");
  const teams = await db.all("SELECT * FROM teams");
  const results = await db.all(`
    SELECT r.*, g.name as game_name, t.name as team_name
    FROM results r
    LEFT JOIN games g ON g.id = r.game_id
    LEFT JOIN teams t ON t.id = r.team_id
    ORDER BY r.id DESC
  `);

  let resultToEdit = null;
  if (req.query.editResult) {
    resultToEdit = await db.get("SELECT * FROM results WHERE id = ?", [req.query.editResult]);
  }

  res.render('admin', {
    user: req.session.user,
    games,
    teams,
    results,
    resultToEdit,
    messages: req.flash()
  });
});

// --- CRUD GAMES ---
app.post('/admin/games', requireAdmin, upload.single('image'), async (req, res) => {
  const { name, description, order_index } = req.body;
  const image = req.file ? '/public/uploads/' + req.file.filename : null;
  await db.run(
    "INSERT INTO games (name, description, image, order_index) VALUES (?,?,?,?)",
    [name, description || '', image, order_index || 0]
  );
  req.flash('success', 'Game added');
  res.redirect('/admin');
});

app.post('/admin/games/:id/update', requireAdmin, upload.single('image'), async (req, res) => {
  const { name, description, order_index } = req.body;
  let query = "UPDATE games SET name=?, description=?, order_index=? WHERE id=?";
  let params = [name, description, order_index, req.params.id];
  if (req.file) {
    query = "UPDATE games SET name=?, description=?, order_index=?, image=? WHERE id=?";
    params = [name, description, order_index, '/public/uploads/' + req.file.filename, req.params.id];
  }
  await db.run(query, params);
  req.flash('success', 'Game updated');
  res.redirect('/admin');
});

app.post('/admin/games/:id/delete', requireAdmin, async (req, res) => {
  await db.run("DELETE FROM games WHERE id = ?", [req.params.id]);
  req.flash('success', 'Game deleted');
  res.redirect('/admin');
});

// --- CRUD TEAMS ---
app.post('/admin/teams', requireAdmin, async (req, res) => {
  const { name, player1_id, player2_id } = req.body;
  await db.run(
    "INSERT INTO teams (name, player1_id, player2_id) VALUES (?,?,?)",
    [name, player1_id || null, player2_id || null]
  );
  req.flash('success', 'Team added');
  res.redirect('/admin');
});

app.post('/admin/teams/:id/update', requireAdmin, async (req, res) => {
  const { name, player1_id, player2_id } = req.body;
  await db.run(
    "UPDATE teams SET name=?, player1_id=?, player2_id=? WHERE id=?",
    [name, player1_id || null, player2_id || null, req.params.id]
  );
  req.flash('success', 'Team updated');
  res.redirect('/admin');
});

app.post('/admin/teams/:id/delete', requireAdmin, async (req, res) => {
  await db.run("DELETE FROM teams WHERE id = ?", [req.params.id]);
  req.flash('success', 'Team deleted');
  res.redirect('/admin');
});

// --- CRUD RESULTS ---
app.post('/admin/results', requireAdmin, async (req, res) => {
  const { game_id, team_id, score, points } = req.body;
  await db.run(
    "INSERT INTO results (game_id, team_id, score, points) VALUES (?,?,?,?)",
    [game_id, team_id, score || 0, points || 0]
  );
  req.flash('success', 'Result recorded');
  res.redirect('/admin');
});

app.post('/admin/results/:id/update', requireAdmin, async (req, res) => {
  const { game_id, team_id, score, points } = req.body;
  await db.run(
    "UPDATE results SET game_id=?, team_id=?, score=?, points=? WHERE id=?",
    [game_id, team_id, score || 0, points || 0, req.params.id]
  );
  req.flash('success', 'Result updated');
  res.redirect('/admin');
});

app.post('/admin/results/:id/delete', requireAdmin, async (req, res) => {
  await db.run("DELETE FROM results WHERE id = ?", [req.params.id]);
  req.flash('success', 'Result deleted');
  res.redirect('/admin');
});

// --- PAGE VOTE ---
app.get('/vote', async (req, res) => {
  if (!req.session.user) {
    req.flash('error', 'Veuillez vous connecter pour voter.');
    return res.redirect('/login');
  }

  const games = await db.all("SELECT * FROM games ORDER BY order_index ASC");
  const rows = await db.all("SELECT game_id FROM votes WHERE user_id = ?", [req.session.user.id]);
  const userVotes = rows.map(r => r.game_id);
  const votesCount = userVotes.length;

  res.render('vote', {
    user: req.session.user,
    games,
    userVotes,
    votesCount
  });
});

app.post('/vote/:gameId', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');

  const userId = req.session.user.id;
  const gameId = parseInt(req.params.gameId);
  const votes = await db.all("SELECT * FROM votes WHERE user_id = ?", [userId]);
  const already = votes.find(v => v.game_id === gameId);

  if (already) {
    await db.run("DELETE FROM votes WHERE user_id = ? AND game_id = ?", [userId, gameId]);
  } else {
    if (votes.length < 8) {
      await db.run("INSERT INTO votes (user_id, game_id) VALUES (?,?)", [userId, gameId]);
    }
  }
  res.redirect('/vote');
});

// --- SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('✅ Server listening on port ' + PORT));
