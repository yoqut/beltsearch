import { NextResponse } from 'next/server';
import { appSources, fetchTable } from '@/lib/appsheet';
import { getCatalog, invalidateCatalog } from '@/lib/catalog';
import { RUNTIME_DATA_DIR, writeJson, writeStamp } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

let syncing = false;

export async function POST(request: Request) {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    const provided = request.headers.get('x-sync-secret');
    if (provided !== secret) {
      return NextResponse.json({ error: 'Ruxsat yo‘q' }, { status: 401 });
    }
  }

  const sources = appSources();
  if (sources.length === 0) {
    return NextResponse.json(
      { error: 'AppSheet sozlamalari topilmadi (APPSHEET_* env o‘zgaruvchilari).' },
      { status: 500 },
    );
  }

  if (syncing) {
    return NextResponse.json({ error: 'Sync allaqachon ketyapti, kuting.' }, { status: 429 });
  }
  syncing = true;

  const written: Record<string, number> = {};
  const errors: string[] = [];

  try {
    for (const source of sources) {
      const results = await Promise.all(
        source.tables.map(async (table) => {
          try {
            return { table, rows: await fetchTable(source, table) };
          } catch (error) {
            errors.push(`${source.dir}/${table}: ${error instanceof Error ? error.message : error}`);
            return { table, rows: null };
          }
        }),
      );

      for (const { table, rows } of results) {
        if (!rows || rows.length === 0) continue;
        try {
          writeJson(RUNTIME_DATA_DIR, source.dir, table, rows);
          written[`${source.dir}/${table}`] = rows.length;
        } catch (error) {
          errors.push(`${source.dir}/${table} yozilmadi: ${error instanceof Error ? error.message : error}`);
        }
      }
    }

    const syncedAt = new Date().toISOString();
    try {
      writeStamp(RUNTIME_DATA_DIR, syncedAt);
    } catch {
      /* /tmp yozilmasa ham katalog yangilanadi */
    }

    invalidateCatalog();
    const catalog = getCatalog(true);

    return NextResponse.json({
      ok: errors.length === 0,
      syncedAt: catalog.syncedAt ?? syncedAt,
      written,
      errors,
      catalog,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync xatosi', errors },
      { status: 500 },
    );
  } finally {
    syncing = false;
  }
}
