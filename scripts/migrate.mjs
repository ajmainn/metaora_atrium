// Applies pending .sql migrations in filename order.
// Tracks already-applied migrations in schema_migrations.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const file = join(root, '.env');

  if (!existsSync(file)) {
    console.error('No .env found. Copy env.example to .env and set DATABASE_URL.');
    process.exit(1);
  }

  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;

    const value = m[2].trim().replace(/^["']|["']$/g, '');

    if (!(m[1] in process.env)) {
      process.env[m[1]] = value;
    }
  }
}

loadEnv();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set in .env');
  process.exit(1);
}

const dir = join(root, 'migrations');

const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});

try {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // 001_init.sql was already applied before migration tracking existed.
  await client.query(`
    INSERT INTO schema_migrations (filename)
    VALUES ('001_init.sql')
    ON CONFLICT (filename) DO NOTHING
  `);

  for (const file of files) {
    const applied = await client.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file]
    );

    if (applied.rowCount > 0) {
      console.log(`skipping ${file} (already applied)`);
      continue;
    }

    process.stdout.write(`applying ${file} ... `);

    const sql = readFileSync(join(dir, file), 'utf8');

    try {
      await client.query('BEGIN');
      await client.query(sql);

      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [file]
      );

      await client.query('COMMIT');

      console.log('ok');
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('failed');
      throw new Error(`${file}: ${err.message}`);
    }
  }

  console.log('\nMigrations complete.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}