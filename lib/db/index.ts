import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const connectionString = process.env.POSTGRES_URL; // 👈 tu var real
if (!connectionString) {
  throw new Error('POSTGRES_URL no está definido en el entorno.');
}

export const pool = new Pool({
  connectionString,
  // Si tu proveedor requiere SSL en producción, activamos SSL flexible:
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool);

// Re-exporta tablas
export * from './schema';
