import { DataSource } from 'typeorm';
import { resolveMigrationsDir, runMigrations } from './migration-runner';

describe('SQL migration runner', () => {
  it('finds the packaged or source SQL migrations', () => {
    expect(resolveMigrationsDir()).toBeTruthy();
  });

  it('wraps every pending migration and its ledger insert in one transaction', async () => {
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(async (sql: string) => sql.includes('SELECT name FROM migrations') ? [] : undefined),
    };
    const dataSource = { createQueryRunner: () => runner } as unknown as DataSource;

    await runMigrations(dataSource);

    expect(runner.startTransaction).toHaveBeenCalled();
    expect(runner.startTransaction).toHaveBeenCalledTimes(runner.commitTransaction.mock.calls.length);
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back a failed migration and always releases the connection', async () => {
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT name FROM migrations')) return [];
        if (sql.includes('CREATE TABLE IF NOT EXISTS seasons')) throw new Error('migration failed');
        return undefined;
      }),
    };
    const dataSource = { createQueryRunner: () => runner } as unknown as DataSource;

    await expect(runMigrations(dataSource)).rejects.toThrow('migration failed');
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
});
