import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

export function resolveMigrationsDir(): string | null {
  const candidates = [
    __dirname,
    path.join(__dirname, 'migrations'),
    path.resolve(process.cwd(), 'dist', 'migrations'),
    path.resolve(process.cwd(), 'src', 'migrations'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const sqlFiles = fs.readdirSync(candidate).filter((file) => file.endsWith('.sql'));
    if (sqlFiles.length > 0) {
      return candidate;
    }
  }

  return null;
}

export async function runMigrations(dataSource: DataSource): Promise<void> {
  const migrationsDir = resolveMigrationsDir();
  if (!migrationsDir) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('No SQL migrations directory found');
    }
    console.log('[Migrations] No migrations directory found, skipping outside production');
    return;
  }

  const queryRunner = dataSource.createQueryRunner();
  try {
    await queryRunner.connect();

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        name varchar PRIMARY KEY,
        "executedAt" timestamp NOT NULL DEFAULT NOW()
      )
    `);

    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const existing = await queryRunner.query(
        `SELECT name FROM migrations WHERE name = $1`,
        [file],
      );

      if (existing.length > 0) {
        console.log(`[Migrations] Skipping already executed: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      console.log(`[Migrations] Running: ${file}`);

      await queryRunner.startTransaction();
      try {
        await queryRunner.query(sql);
        await queryRunner.query(
          `INSERT INTO migrations (name) VALUES ($1)`,
          [file],
        );
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      }

      console.log(`[Migrations] Completed: ${file}`);
    }
  } finally {
    await queryRunner.release();
  }
}
