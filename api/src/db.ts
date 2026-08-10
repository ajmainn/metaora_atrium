import path from 'node:path';
import { config } from 'dotenv';
import { Pool, PoolClient, QueryResultRow } from 'pg';

config({ path: path.resolve(__dirname, '..', '..', '.env') });

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(text, params as any[]);
  return result.rows;
}

type TransactionOptions = {
  isolationLevel?: 'serializable';
};

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (options.isolationLevel) {
      await client.query(`set transaction isolation level ${options.isolationLevel}`);
    }
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}
