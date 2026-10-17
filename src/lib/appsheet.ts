import type { CatalogGroup } from './types';

export interface AppSource {
  group: CatalogGroup;
  /** data/ ichidagi papka nomi */
  dir: string;
  appId: string;
  accessKey: string;
  /** Asosiy jadval (Belts / VBelts) */
  mainTable: string;
  tables: string[];
}

const DEFAULT_TABLES = ['Manufacturers', 'Purchase', 'Purchase_basket', 'Reference', 'Types'];

function parseTables(main: string, raw: string | undefined): string[] {
  const extra = (raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const list = extra.length > 0 ? extra : DEFAULT_TABLES;
  return Array.from(new Set([main, ...list]));
}

/** .env dagi sozlamalardan AppSheet manbalarini yig'ish */
export function appSources(): AppSource[] {
  const sources: AppSource[] = [];

  const timingId = process.env.APPSHEET_TIMING_APP_ID;
  const timingKey = process.env.APPSHEET_TIMING_KEY;
  if (timingId && timingKey) {
    const main = process.env.APPSHEET_TIMING_TABLE || 'Belts';
    sources.push({
      group: 'timing',
      dir: 'Belts',
      appId: timingId,
      accessKey: timingKey,
      mainTable: main,
      tables: parseTables(main, process.env.APPSHEET_TIMING_TABLES),
    });
  }

  const vbeltId = process.env.APPSHEET_VBELT_APP_ID;
  const vbeltKey = process.env.APPSHEET_VBELT_KEY;
  if (vbeltId && vbeltKey) {
    const main = process.env.APPSHEET_VBELT_TABLE || 'VBelts';
    sources.push({
      group: 'vbelt',
      dir: 'VBelts',
      appId: vbeltId,
      accessKey: vbeltKey,
      mainTable: main,
      tables: parseTables(main, process.env.APPSHEET_VBELT_TABLES),
    });
  }

  return sources;
}

export type Row = Record<string, string>;

/** AppSheet API v2 — "Find" action orqali jadvalning barcha qatorlarini olish */
export async function fetchTable(source: AppSource, table: string): Promise<Row[]> {
  const url = `https://api.appsheet.com/api/v2/apps/${source.appId}/tables/${encodeURIComponent(table)}/Action`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ApplicationAccessKey: source.accessKey,
    },
    body: JSON.stringify({
      Action: 'Find',
      Properties: { Locale: 'en-US', Timezone: 'Asia/Tashkent' },
      Rows: [],
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AppSheet ${table}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }

  const text = await res.text();
  if (!text.trim()) return [];

  const data = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error(`AppSheet ${table}: kutilmagan javob formati`);
  }
  return data as Row[];
}
