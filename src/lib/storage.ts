import fs from 'node:fs';
import path from 'node:path';
import type { Row } from './appsheet';

/** Repo ichidagi (git bilan birga deploy qilinadigan) ma'lumotlar */
export const REPO_DATA_DIR = path.join(process.cwd(), 'data');

/**
 * Sync bosilganda yoziladigan papka.
 * Vercelda faqat /tmp yoziladigan bo'lgani uchun u yerda /tmp ishlatiladi,
 * lokalda esa to'g'ridan-to'g'ri repo ichidagi data/ yangilanadi.
 */
export const RUNTIME_DATA_DIR = process.env.VERCEL ? '/tmp/hub-data' : REPO_DATA_DIR;

export function readJson(dir: string, group: string, table: string): Row[] | null {
  const file = path.join(dir, group, `${table}.json`);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as Row[]) : null;
  } catch {
    return null;
  }
}

export function writeJson(dir: string, group: string, table: string, rows: Row[]): void {
  const target = path.join(dir, group);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, `${table}.json`), JSON.stringify(rows, null, 2), 'utf-8');
}

const STAMP = 'synced-at.json';

export function readStamp(dir: string): string | null {
  try {
    const file = path.join(dir, STAMP);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8')).syncedAt ?? null;
  } catch {
    return null;
  }
}

export function writeStamp(dir: string, syncedAt: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, STAMP), JSON.stringify({ syncedAt }, null, 2), 'utf-8');
}
