import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

// Use the same SQLite file as before
const db = new Database('porthub.sqlite');

// ---------------- Schema bootstrap (kept) ----------------
db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  discord_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  user_type TEXT NOT NULL CHECK(user_type IN ('PORTER','CUSTOMER')),
  rsi_handle TEXT,
  bio TEXT,
  language TEXT,
  specialty TEXT,
  rsi_code TEXT,
  rsi_verified INTEGER DEFAULT 0,
  avg_rating REAL DEFAULT 0,
  likes_count INTEGER DEFAULT 0,
  dislikes_count INTEGER DEFAULT 0,
  completed_jobs INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  job_number TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  porter_id TEXT,
  location TEXT,
  payment_auec INTEGER,
  description TEXT,
  date_needed TEXT,
  status TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(customer_id) REFERENCES users(id),
  FOREIGN KEY(porter_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  reviewer_user_id TEXT NOT NULL,
  reviewed_user_id TEXT NOT NULL,
  stars INTEGER NOT NULL,
  text TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(job_id) REFERENCES jobs(id),
  FOREIGN KEY(reviewer_user_id) REFERENCES users(id),
  FOREIGN KEY(reviewed_user_id) REFERENCES users(id)
);
`);

function ensureColumn(table, column, definition) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!info.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'likes_count', 'INTEGER DEFAULT 0');
ensureColumn('users', 'dislikes_count', 'INTEGER DEFAULT 0');
ensureColumn('jobs', 'completion_customer_message_id', 'TEXT');
ensureColumn('jobs', 'completion_porter_message_id', 'TEXT');

// ---------------- USER QUERIES ----------------

export function upsertUser({ discordId, username, userType, rsiHandle, bio, language, specialty }) {
  const get = db.prepare(`SELECT * FROM users WHERE discord_id = ?`);
  const row = get.get(discordId);
  if (row) {
    const stmt = db.prepare(`
      UPDATE users SET username=?, user_type=?, rsi_handle=?, bio=?, language=?, specialty=?
      WHERE discord_id=?
    `);
    stmt.run(username, userType, rsiHandle || null, bio || null, language || null, specialty || null, discordId);
    return get.get(discordId);
  } else {
    const id = nanoid();
    const stmt = db.prepare(`
      INSERT INTO users (id, discord_id, username, user_type, rsi_handle, bio, language, specialty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, discordId, username, userType, rsiHandle || null, bio || null, language || null, specialty || null);
    return get.get(discordId);
  }
}

export function getUserByDiscord(discordId) {
  const stmt = db.prepare(`SELECT * FROM users WHERE discord_id = ?`);
  return stmt.get(discordId);
}

export function getUserById(id) {
  const stmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
  return stmt.get(id);
}

// Backwards-compatible delete
export function deleteUserByDiscord(discordId) {
  const stmt = db.prepare(`DELETE FROM users WHERE discord_id = ?`);
  return stmt.run(discordId).changes > 0;
}

// NEW: Canonical delete by discordId (used by index.js)
export function deleteUser({ discordId }) {
  const stmt = db.prepare(`DELETE FROM users WHERE discord_id = ?`);
  return stmt.run(discordId).changes > 0;
}

export function setUserVerification({ discordId, rsiCode, verified }) {
  const stmt = db.prepare(`UPDATE users SET rsi_code=?, rsi_verified=? WHERE discord_id=?`);
  stmt.run(rsiCode || null, verified ? 1 : 0, discordId);
}

// Backwards-compatible role switch
export function switchUserRole(discordId, newRole) {
  const stmt = db.prepare(`UPDATE users SET user_type = ? WHERE discord_id = ?`);
  stmt.run(newRole, discordId);
}

// NEW: Canonical role update (used by index.js)
export function updateUserType({ discordId, userType }) {
  const stmt = db.prepare(`UPDATE users SET user_type = ? WHERE discord_id = ?`);
  stmt.run(userType, discordId);
}

// Backwards-compatible profile update
export function updateUserProfile(discordId, { rsiHandle, bio, language, specialty }) {
  const stmt = db.prepare(`
    UPDATE users SET
      rsi_handle = COALESCE(?, rsi_handle),
      bio = COALESCE(?, bio),
      language = COALESCE(?, language),
      specialty = COALESCE(?, specialty)
    WHERE discord_id = ?
  `);
  stmt.run(rsiHandle, bio, language, specialty, discordId);
}

// NEW: Canonical bio-only update (used by index.js)
export function updateUserBio({ discordId, bio }) {
  const stmt = db.prepare(`UPDATE users SET bio = ? WHERE discord_id = ?`);
  stmt.run(bio || null, discordId);
}

// ---------------- JOB QUERIES ----------------

export function createJob({ category, customerId, location, payment, description, dateNeeded }) {
  const id = nanoid();
  const jobNumber = `JOB-${Math.floor(1000 + Math.random() * 9000)}`;
  const stmt = db.prepare(`
    INSERT INTO jobs (id, job_number, category, customer_id, location, payment_auec, description, date_needed, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
  `);
  stmt.run(id, jobNumber, category, customerId, location || null, payment || 0, description || null, dateNeeded || null);
  return getJobByNumber(jobNumber);
}

// Backwards-compatible (kept)
export function getJobByNumber(jobNumber) {
  const stmt = db.prepare(`
    SELECT j.*, c.username as customer_username, p.username as porter_username
    FROM jobs j
    JOIN users c ON c.id = j.customer_id
    LEFT JOIN users p ON p.id = j.porter_id
    WHERE j.job_number = ?
  `);
  return stmt.get(jobNumber);
}

// NEW: Full job fetch (used by index.js)
export function getJobFull(jobNumber) {
  const stmt = db.prepare(`
    SELECT
      j.*,
      c.username AS customer_username,
      p.username AS porter_username
    FROM jobs j
    JOIN users c ON c.id = j.customer_id
    LEFT JOIN users p ON p.id = j.porter_id
    WHERE j.job_number = ?
  `);
  return stmt.get(jobNumber);
}

export function setJobCompletionMessages({ jobNumber, customerMessageId, porterMessageId }) {
  const stmt = db.prepare(`
    UPDATE jobs
    SET completion_customer_message_id = ?,
        completion_porter_message_id = ?
    WHERE job_number = ?
  `);
  stmt.run(customerMessageId ?? null, porterMessageId ?? null, jobNumber);
}

export function clearJobCompletionMessages(jobNumber) {
  const stmt = db.prepare(`
    UPDATE jobs
    SET completion_customer_message_id = NULL,
        completion_porter_message_id = NULL
    WHERE job_number = ?
  `);
  stmt.run(jobNumber);
}

export function listOpenJobs({ page, pageSize }) {
  const offset = (page - 1) * pageSize;
  const stmt = db.prepare(`
    SELECT j.job_number, j.category, j.payment_auec, u.username as customer_username
    FROM jobs j
    JOIN users u ON u.id = j.customer_id
    WHERE j.status = 'OPEN'
    ORDER BY j.created_at DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(pageSize, offset);
}

export function countOpenJobs() {
  const stmt = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status='OPEN'`);
  return stmt.get()?.c || 0;
}

export function assignJob(jobNumber, porterId) {
  const stmt = db.prepare(`
    UPDATE jobs SET porter_id=?, status='PENDING_APPROVAL' WHERE job_number=? AND status='OPEN'
  `);
  return stmt.run(porterId, jobNumber).changes > 0;
}

export function setJobPorter(jobNumber, porterId) {
  const stmt = db.prepare(`UPDATE jobs SET porter_id=? WHERE job_number=?`);
  stmt.run(porterId, jobNumber);
}

export function setJobStatus(jobNumber, status) {
  const stmt = db.prepare(`UPDATE jobs SET status=? WHERE job_number=?`);
  stmt.run(status, jobNumber);
}

// ---------------- FEEDBACK ----------------

export function addFeedback({ jobId, reviewerId, reviewedId, liked }) {
  const id = nanoid();
  const stmt = db.prepare(`
    INSERT INTO reviews (id, job_id, reviewer_user_id, reviewed_user_id, stars, text)
    VALUES (?, ?, ?, ?, ?, NULL)
  `);
  stmt.run(id, jobId, reviewerId, reviewedId, liked ? 1 : 0);
}

export function refreshUserFeedback(reviewedUserId) {
  const statsStmt = db.prepare(`
    SELECT
      COALESCE(SUM(stars), 0) AS likes,
      COUNT(*) AS total
    FROM reviews
    WHERE reviewed_user_id = ?
  `);
  const { likes = 0, total = 0 } = statsStmt.get(reviewedUserId) || {};
  const dislikes = total - likes;

  const update = db.prepare(`UPDATE users SET likes_count=?, dislikes_count=? WHERE id=?`);
  update.run(likes, dislikes, reviewedUserId);

  return { likes, dislikes, total };
}

const existingFeedbackOwners = db.prepare(`SELECT DISTINCT reviewed_user_id AS id FROM reviews`).all();
for (const row of existingFeedbackOwners) {
  if (row?.id) {
    refreshUserFeedback(row.id);
  }
}

export function incrementCompletedJobs(userId) {
  const stmt = db.prepare(`UPDATE users SET completed_jobs = completed_jobs + 1 WHERE id=?`);
  stmt.run(userId);
}
