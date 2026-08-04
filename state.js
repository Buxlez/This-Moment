const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function createRepository(dbPath = path.join(__dirname, 'data', 'this-moment.sqlite')) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_input TEXT NOT NULL,
      environment_json TEXT NOT NULL,
      intent TEXT NOT NULL,
      direction_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      warning TEXT,
      tts_status TEXT NOT NULL DEFAULT 'idle',
      tts_url TEXT,
      tts_error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS card_tracks (
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      provider_track_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      cover_url TEXT,
      duration_ms INTEGER,
      accent TEXT,
      PRIMARY KEY (card_id, position)
    );
    CREATE TABLE IF NOT EXISTS play_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      card_id TEXT,
      provider_track_id TEXT,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cards_session_created ON cards(session_id, created_at DESC);
  `);

  const upsertSession = db.prepare(`
    INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `);
  const insertTurn = db.prepare(`
    INSERT OR REPLACE INTO turns
      (id, session_id, user_input, environment_json, intent, direction_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCard = db.prepare(`
    INSERT OR REPLACE INTO cards
      (id, session_id, turn_id, title, description, provider, status, warning, tts_status, tts_url, tts_error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const clearTracks = db.prepare('DELETE FROM card_tracks WHERE card_id = ?');
  const insertTrack = db.prepare(`
    INSERT INTO card_tracks
      (card_id, position, provider_track_id, provider, title, artist, album, cover_url, duration_ms, accent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveCardTransaction = db.transaction(card => {
    const createdAt = card.createdAt || new Date().toISOString();
    upsertSession.run(card.sessionId, createdAt, createdAt);
    insertTurn.run(
      card.turnId,
      card.sessionId,
      card.userInput || '',
      JSON.stringify(card.environment || {}),
      card.intent,
      JSON.stringify(card.direction || {}),
      createdAt,
    );
    insertCard.run(
      card.id,
      card.sessionId,
      card.turnId,
      card.title,
      card.description,
      card.provider,
      card.status || 'ready',
      card.warning || null,
      card.ttsStatus || 'idle',
      card.ttsUrl || null,
      card.ttsError || null,
      createdAt,
    );
    clearTracks.run(card.id);
    card.tracks.forEach((track, index) => {
      insertTrack.run(
        card.id,
        index,
        String(track.id),
        track.provider || card.provider,
        track.title,
        track.artist,
        track.album || '',
        track.coverUrl || null,
        track.durationMs || null,
        track.accent || null,
      );
    });
  });

  const cardQuery = `
    SELECT c.*, t.user_input, t.environment_json, t.intent, t.direction_json
    FROM cards c JOIN turns t ON t.id = c.turn_id
  `;
  const trackStatement = db.prepare('SELECT * FROM card_tracks WHERE card_id = ? ORDER BY position ASC');

  function hydrateCard(row) {
    if (!row) return null;
    return {
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      title: row.title,
      description: row.description,
      provider: row.provider,
      status: row.status,
      warning: row.warning,
      ttsStatus: row.tts_status,
      ttsUrl: row.tts_url,
      ttsError: row.tts_error,
      environment: parseJson(row.environment_json, {}),
      direction: parseJson(row.direction_json, {}),
      userInput: row.user_input,
      intent: row.intent,
      createdAt: row.created_at,
      tracks: trackStatement.all(row.id).map(track => ({
        id: track.provider_track_id,
        provider: track.provider,
        title: track.title,
        artist: track.artist,
        album: track.album,
        coverUrl: track.cover_url,
        durationMs: track.duration_ms,
        accent: track.accent,
      })),
    };
  }

  return {
    saveCard(card) { saveCardTransaction(card); return this.getCard(card.id); },
    listCards(sessionId, limit = 20) {
      return db.prepare(`${cardQuery} WHERE c.session_id = ? ORDER BY c.created_at DESC LIMIT ?`)
        .all(sessionId, Number(limit)).map(hydrateCard);
    },
    getCard(cardId) {
      return hydrateCard(db.prepare(`${cardQuery} WHERE c.id = ?`).get(cardId));
    },
    updateTts(cardId, { status, url = null, error = null }) {
      db.prepare('UPDATE cards SET tts_status = ?, tts_url = ?, tts_error = ? WHERE id = ?')
        .run(status, url, error, cardId);
      return this.getCard(cardId);
    },
    recordPlayEvent({ sessionId, cardId = null, trackId = null, type }) {
      db.prepare(`INSERT INTO play_events
        (session_id, card_id, provider_track_id, event_type, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run(sessionId, cardId, trackId, type, new Date().toISOString());
    },
    close() { db.close(); },
    db,
  };
}

module.exports = { createRepository };
