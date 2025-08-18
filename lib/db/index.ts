import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const connectionString = process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error('POSTGRES_URL no está definido en el entorno.');
}

// Reutiliza el pool en dev/hot-reload para evitar demasiadas conexiones
const globalForPg = globalThis as unknown as { __pgPool?: Pool; __drizzleDb?: ReturnType<typeof drizzle> };

export const pool =
  globalForPg.__pgPool ||
  new Pool({
    connectionString,
    // Muchos proveedores (Neon/Supabase/Vercel Postgres) requieren SSL en prod
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  });

if (!globalForPg.__pgPool) globalForPg.__pgPool = pool;

export const db = globalForPg.__drizzleDb || drizzle(pool);
if (!globalForPg.__drizzleDb) globalForPg.__drizzleDb = db;

// Re-exporta tus tablas/esquemas
export * from '../db/schema'; // ajusta la ruta si tu schema está en otro lugar
