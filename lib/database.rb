require 'fileutils'
require 'securerandom'
require 'time'
require 'sqlite3'

class Database
  def initialize(path)
    @path = File.expand_path(path)
    FileUtils.mkdir_p(File.dirname(@path))
    migrate!
  end

  def with_connection
    db = SQLite3::Database.new(@path)
    db.results_as_hash = true
    db.busy_timeout = 5_000
    db.execute('PRAGMA foreign_keys = ON')
    yield db
  ensure
    db&.close
  end

  def create_account(id:, name:, email:, salt:, password_hash:)
    now = timestamp
    with_connection do |db|
      db.transaction do
        db.execute(
          'INSERT INTO users (id, name, email, password_salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, name, email, salt, password_hash, now, now]
        )
        db.execute('INSERT INTO settings (user_id, theme, reminder_enabled, reminder_date, updated_at) VALUES (?, ?, ?, ?, ?)', [id, 'system', 0, nil, now])
      end
      user_for(db, id)
    end
  end

  def user_by_email(email)
    with_connection { |db| db.get_first_row('SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email]) }
  end

  def user_by_id(id)
    with_connection { |db| user_for(db, id) }
  end

  def create_session(user_id:, token_hash:, csrf_token:, expires_at:)
    with_connection do |db|
      db.execute(
        'INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        [token_hash, user_id, csrf_token, expires_at, timestamp]
      )
    end
  end

  def session_by_hash(token_hash)
    with_connection { |db| db.get_first_row('SELECT * FROM sessions WHERE token_hash = ?', [token_hash]) }
  end

  def delete_session(token_hash)
    with_connection { |db| db.execute('DELETE FROM sessions WHERE token_hash = ?', [token_hash]) }
  end

  def delete_user_sessions(user_id)
    with_connection { |db| db.execute('DELETE FROM sessions WHERE user_id = ?', [user_id]) }
  end

  def gardens_for(user_id)
    with_connection do |db|
      db.execute('SELECT * FROM gardens WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC', [user_id]).map { |row| garden_json(row) }
    end
  end

  def create_garden(user_id, attributes)
    id = SecureRandom.uuid
    now = timestamp
    with_connection do |db|
      db.execute(
        'INSERT INTO gardens (id, user_id, flower, place, sunlight, notes, target_date, planted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, user_id, attributes[:flower], attributes[:place], attributes[:sunlight], attributes[:notes], attributes[:target_date], attributes[:planted] ? 1 : 0, now, now]
      )
      garden_json(db.get_first_row('SELECT * FROM gardens WHERE id = ? AND user_id = ?', [id, user_id]))
    end
  end

  def update_garden(user_id, id, attributes)
    id = id.to_s.dup.force_encoding(Encoding::UTF_8)
    user_id = user_id.to_s.dup.force_encoding(Encoding::UTF_8)
    allowed = {
      flower: 'flower',
      place: 'place',
      sunlight: 'sunlight',
      notes: 'notes',
      target_date: 'target_date',
      planted: 'planted'
    }
    return nil if attributes.empty? || (attributes.keys - allowed.keys).any?

    values = []
    assignments = attributes.map do |key, value|
      values << (key == :planted ? (value ? 1 : 0) : value)
      "#{allowed.fetch(key)} = ?"
    end
    values << timestamp
    values.concat([id, user_id])
    with_connection do |db|
      db.execute("UPDATE gardens SET #{assignments.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?", values)
      row = db.get_first_row('SELECT * FROM gardens WHERE id = ? AND user_id = ?', [id, user_id])
      row && garden_json(row)
    end
  end

  def delete_garden(user_id, id)
    id = id.to_s.dup.force_encoding(Encoding::UTF_8)
    user_id = user_id.to_s.dup.force_encoding(Encoding::UTF_8)
    with_connection do |db|
      db.execute('DELETE FROM gardens WHERE id = ? AND user_id = ?', [id, user_id])
      db.changes.positive?
    end
  end

  def settings_for(user_id)
    with_connection { |db| settings_json(db.get_first_row('SELECT * FROM settings WHERE user_id = ?', [user_id])) }
  end

  def update_settings(user_id, settings)
    now = timestamp
    with_connection do |db|
      db.execute(
        'INSERT INTO settings (user_id, theme, reminder_enabled, reminder_date, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, reminder_enabled = excluded.reminder_enabled, reminder_date = excluded.reminder_date, updated_at = excluded.updated_at',
        [user_id, settings[:theme], settings[:reminder_enabled] ? 1 : 0, settings[:reminder_date], now]
      )
      settings_json(db.get_first_row('SELECT * FROM settings WHERE user_id = ?', [user_id]))
    end
  end

  def update_profile(user_id, name, email)
    with_connection do |db|
      db.execute('UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?', [name, email, timestamp, user_id])
      user_for(db, user_id)
    end
  end

  def update_password(user_id, salt, password_hash)
    with_connection do |db|
      db.transaction do
        db.execute('UPDATE users SET password_salt = ?, password_hash = ?, updated_at = ? WHERE id = ?', [salt, password_hash, timestamp, user_id])
        db.execute('DELETE FROM sessions WHERE user_id = ?', [user_id])
      end
    end
  end

  def delete_account(user_id)
    with_connection { |db| db.execute('DELETE FROM users WHERE id = ?', [user_id]) }
  end

  def timestamp
    Time.now.utc.iso8601
  end

  private

  def migrate!
    with_connection do |db|
      db.execute_batch(<<~SQL)
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL COLLATE NOCASE UNIQUE,
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          csrf_token TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
        CREATE TABLE IF NOT EXISTS gardens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          flower TEXT NOT NULL,
          place TEXT NOT NULL,
          sunlight TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          target_date TEXT,
          planted INTEGER NOT NULL DEFAULT 0 CHECK(planted IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS gardens_owner_updated_idx ON gardens(user_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS settings (
          user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN ('system', 'light', 'dark')),
          reminder_enabled INTEGER NOT NULL DEFAULT 0 CHECK(reminder_enabled IN (0, 1)),
          reminder_date TEXT,
          updated_at TEXT NOT NULL
        );
      SQL
    end
  end

  def user_for(db, id)
    row = db.get_first_row('SELECT id, name, email, password_salt, password_hash, created_at FROM users WHERE id = ?', [id])
    row
  end

  def garden_json(row)
    return nil unless row
    {
      id: row['id'],
      flower: row['flower'],
      place: row['place'],
      sunlight: row['sunlight'],
      notes: row['notes'],
      targetDate: row['target_date'],
      planted: row['planted'].to_i == 1,
      createdAt: row['created_at'],
      updatedAt: row['updated_at']
    }
  end

  def settings_json(row)
    row ||= {}
    {
      theme: row['theme'] || 'system',
      reminderEnabled: row['reminder_enabled'].to_i == 1,
      reminderDate: row['reminder_date'],
      updatedAt: row['updated_at']
    }
  end
end
