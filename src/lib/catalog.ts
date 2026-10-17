import type { Row } from './appsheet';
import { appSources } from './appsheet';
import { REPO_DATA_DIR, RUNTIME_DATA_DIR, readJson, readStamp } from './storage';
import type { Catalog, CatalogGroup, Product, ProductForm } from './types';

const DEFAULT_USD_RATE = 13500;

function num(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function text(value: string | undefined): string {
  return (value ?? '').trim();
}

function indexBy(rows: Row[] | null, key: string): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const row of rows ?? []) {
    const id = text(row[key]);
    if (id) map.set(id, row);
  }
  return map;
}

function usdRateFrom(reference: Row[] | null): number {
  for (const row of reference ?? []) {
    if (text(row.Type).toLowerCase().startsWith('курс')) {
      const v = num(row.Value);
      if (v > 0) return v;
    }
  }
  return DEFAULT_USD_RATE;
}

function formOf(goods: string, group: CatalogGroup): ProductForm {
  if (goods === 'Рукав') return group === 'timing' ? 'sleeve_mm' : 'sleeve_rib';
  if (goods === 'Рулон') return 'roll';
  return 'piece';
}

function cleanInfo(entries: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(entries)) {
    const val = text(v);
    if (val) out[k] = val;
  }
  return out;
}

function mapTimingBelts(rows: Row[], types: Map<string, Row>, makers: Map<string, Row>, usdRate: number): Product[] {
  return rows.map((r) => {
    const form = formOf(text(r['Goods/Sleeve']), 'timing');
    const type = text(types.get(text(r.type))?.Type);
    const manufacturer = text(makers.get(text(r.manufacturer))?.Manufacturer);
    return {
      id: `t:${text(r.id) || text(r._RowNumber)}`,
      group: 'timing' as const,
      code: text(r.mark),
      name: text(r.mark_name) || text(r.mark),
      type,
      manufacturer,
      country: text(r.Country_Origin),
      form,
      costPerUnit: num(r.Cost_per_mm),
      sleeveSize: num(r.Sleeve_width),
      defaultSize: num(r.width) || num(r.Sleeve_width),
      margin: num(r.Margin),
      netCost: num(r.Net_cost_belt),
      price: num(r.Selling_price),
      priceVat: num(r.Selling_price_VAT),
      usdRate,
      info: cleanInfo({
        'Rukav eni': r.Sleeve_width ? `${r.Sleeve_width} mm` : '',
        'Rulon eni': r.roll_width ? `${r.roll_width} mm` : '',
        'Rulon uzunligi': r.roll_length ? `${r.roll_length} mm` : '',
        Izoh: r.description,
      }),
    };
  });
}

function mapVBelts(rows: Row[], types: Map<string, Row>, makers: Map<string, Row>, usdRate: number): Product[] {
  return rows.map((r) => {
    const form = formOf(text(r['Goods/Sleeve']), 'vbelt');
    const typeRow = types.get(text(r.type));
    const type = text(typeRow?.Type);
    const manufacturer = text(makers.get(text(r.manufacturer))?.Manufacturer);
    const ribs = num(r.Ribs_qty);
    return {
      id: `v:${text(r['v-belts_id']) || text(r._RowNumber)}`,
      group: 'vbelt' as const,
      code: text(r.mark),
      name: text(r.mark_name) || text(r.mark_name_remenuz) || text(r.mark),
      type,
      manufacturer,
      country: text(r.Country_Origin),
      form,
      costPerUnit: num(r.Cost_per_rib),
      sleeveSize: ribs,
      defaultSize: ribs,
      margin: num(r.Margin),
      netCost: num(r.Net_cost_belt),
      price: num(r.Selling_price),
      priceVat: num(r.Selling_price_VAT),
      usdRate,
      info: cleanInfo({
        Uzunlik: r.Length ? `${r.Length} ${text(r.Length_standart)}`.trim() : '',
        Seriya: r.Series,
        'Dyuym o‘lchami': r.Number_inch,
        Profil: typeRow ? text(typeRow['Classic/Wedge']) : '',
        'Riblar soni': ribs ? String(ribs) : '',
        En: text(r.Belt_width) || text(typeRow?.Belt_width),
        Balandlik: text(r.Belt_height) || text(typeRow?.Belt_height),
      }),
    };
  });
}

function loadGroup(dir: string, source: { dir: string; mainTable: string; group: CatalogGroup }) {
  const main = readJson(dir, source.dir, source.mainTable);
  if (!main) return null;
  const types = indexBy(readJson(dir, source.dir, 'Types'), 'id');
  const makers = indexBy(readJson(dir, source.dir, 'Manufacturers'), 'manufacturer_id');
  const usdRate = usdRateFrom(readJson(dir, source.dir, 'Reference'));
  const products =
    source.group === 'timing'
      ? mapTimingBelts(main, types, makers, usdRate)
      : mapVBelts(main, types, makers, usdRate);
  return { products: products.filter((p) => p.code), usdRate };
}

/** Avval sync qilingan papka, bo'lmasa repo ichidagi data/ o'qiladi */
export function buildCatalog(): Catalog {
  const sources = appSources();
  const fallback = [
    { dir: 'Belts', mainTable: 'Belts', group: 'timing' as const },
    { dir: 'VBelts', mainTable: 'VBelts', group: 'vbelt' as const },
  ];
  const list = sources.length > 0
    ? sources.map((s) => ({ dir: s.dir, mainTable: s.mainTable, group: s.group }))
    : fallback;

  const products: Product[] = [];
  const counts: Record<string, number> = {};
  let usdRate = DEFAULT_USD_RATE;
  let source: 'runtime' | 'repo' = 'repo';

  for (const s of list) {
    const loaded = loadGroup(RUNTIME_DATA_DIR, s) ?? (() => {
      return loadGroup(REPO_DATA_DIR, s);
    })();
    if (RUNTIME_DATA_DIR !== REPO_DATA_DIR && readJson(RUNTIME_DATA_DIR, s.dir, s.mainTable)) {
      source = 'runtime';
    }
    if (!loaded) continue;
    products.push(...loaded.products);
    counts[s.dir] = loaded.products.length;
    if (loaded.usdRate > 0) usdRate = loaded.usdRate;
  }

  products.sort((a, b) => a.code.localeCompare(b.code, 'ru', { numeric: true }));

  return {
    products,
    usdRate,
    syncedAt: readStamp(RUNTIME_DATA_DIR) ?? readStamp(REPO_DATA_DIR),
    source,
    counts,
  };
}

let cache: { at: number; catalog: Catalog } | null = null;
const TTL_MS = 5 * 60 * 1000;

export function getCatalog(force = false): Catalog {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.catalog;
  const catalog = buildCatalog();
  cache = { at: Date.now(), catalog };
  return catalog;
}

export function invalidateCatalog(): void {
  cache = null;
}
