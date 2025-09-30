const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const DBSOURCE = path.join(__dirname, 'data', 'lanoel.db');

let db = new sqlite3.Database(DBSOURCE, (err) => {
  if (err) {
    console.error(err.message);
    throw err;
  } else {
    console.log('✅ Connected to SQLite database.');
  }
});

// Promisified helpers
const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Initialize tables if not present
(async function init() {
  // ✅ Table users corrigée : pseudo est maintenant UNIQUE
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pseudo TEXT UNIQUE,
    email TEXT,
    password_hash TEXT,
    is_admin INTEGER DEFAULT 0
  );`);

  await run(`CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    player1_id INTEGER,
    player2_id INTEGER
  );`);

  await run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    image TEXT,
    order_index INTEGER DEFAULT 0
  );`);

  await run(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    game_id INTEGER
  );`);

  await run(`CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    team_id INTEGER,
    score INTEGER,
    points INTEGER
  );`);

  await run(`CREATE TABLE IF NOT EXISTS scoring (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER,
    place INTEGER,
    points INTEGER,
    UNIQUE(game_id, place)
  );`);

  // ✅ Crée un admin par défaut si aucun n’existe
  const admin = await get("SELECT * FROM users WHERE email = ?", ['thierrykoulba@gmail.com']);
  if (!admin) {
    const hash = await bcrypt.hash('Admin', 10);
    await run(
      "INSERT INTO users (pseudo, email, password_hash, is_admin) VALUES (?, ?, ?, 1)",
      ['Koulba', 'thierrykoulba@gmail.com', hash]
    );
    console.log('✅ Default admin created: thierrykoulba@gmail.com / Admin');
  }
})();

module.exports = { run, get, all, db };
