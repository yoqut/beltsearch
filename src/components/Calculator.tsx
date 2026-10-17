'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  VAT_RATE,
  formatSom,
  isVariable,
  lineTotals,
  sizeUnit,
  unitPrice,
} from '@/lib/pricing';
import type { CartLine, Catalog, Product } from '@/lib/types';

const CART_KEY = 'remen-cart-v1';
const PAGE_SIZE = 80;

type GroupFilter = 'all' | 'timing' | 'vbelt';

function formBadge(p: Product): { label: string; cls: string } | null {
  if (p.form === 'sleeve_mm') return { label: 'rukav / mm', cls: 'badge sleeve' };
  if (p.form === 'sleeve_rib') return { label: 'rukav / rib', cls: 'badge sleeve' };
  if (p.form === 'roll') return { label: 'rulon', cls: 'badge roll' };
  return null;
}

/** Rukavni kesishda ishlatiladigan standart riblar soni */
const RIB_PRESETS = [3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 24];

/** "A 500" va "a500" bir xil topilishi uchun belgilar olib tashlanadi */
function squash(value: string): string {
  return value.toLowerCase().replace(/[\s\-_.,/()]+/g, '');
}

function haystack(p: Product): string {
  return `${p.code} ${p.name} ${p.type} ${p.manufacturer} ${p.country}`.toLowerCase();
}

export default function Calculator() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<GroupFilter>('all');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [globalDiscount, setGlobalDiscount] = useState(0);
  const [showCost, setShowCost] = useState(false);
  const [typesOpen, setTypesOpen] = useState(true);
  const [sizeMenuFor, setSizeMenuFor] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // --- katalogni yuklash ---------------------------------------------------
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/catalog', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Katalog yuklanmadi');
      setCatalog(data as Catalog);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Katalog yuklanmadi');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // --- savatni saqlash / tiklash ------------------------------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved.lines)) setLines(saved.lines);
      if (typeof saved.globalDiscount === 'number') setGlobalDiscount(saved.globalDiscount);
    } catch {
      /* saqlangan savat buzilgan bo'lsa e'tiborsiz qoldiramiz */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ lines, globalDiscount }));
    } catch {
      /* localStorage mavjud bo'lmasligi mumkin */
    }
  }, [lines, globalDiscount]);

  // Xabarlar o'zi so'nadi: oddiy xabar tez, xato uzoqroq turadi
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 12000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!sizeMenuFor) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest('.combo')) setSizeMenuFor(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [sizeMenuFor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (e.key === 'Escape') setSizeMenuFor(null);
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // --- sync ----------------------------------------------------------------
  const sync = async () => {
    setSyncing(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Sync bajarilmadi');
      if (data.catalog) setCatalog(data.catalog as Catalog);
      const written: Record<string, number> = data.written ?? {};
      const tables = Object.keys(written).length;
      const rowCount = Object.values(written).reduce((a, b) => a + Number(b), 0);
      setNotice(`Yangilandi: ${tables} ta jadval, ${rowCount} ta qator.`);
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        setError(data.errors.join('; '));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync bajarilmadi');
    } finally {
      setSyncing(false);
    }
  };

  // --- qidiruv -------------------------------------------------------------
  const products = useMemo(() => catalog?.products ?? [], [catalog]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  /** Joriy guruhdagi tiplar (kategoriyalar) va ularda nechta mahsulot borligi */
  const types = useMemo(() => {
    const pool = group === 'all' ? products : products.filter((p) => p.group === group);
    const counts = new Map<string, number>();
    for (const p of pool) {
      if (!p.type) continue;
      counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru', { numeric: true }));
  }, [products, group]);

  // Guruh almashganda tanlangan kategoriya yo'q bo'lib qolishi mumkin
  useEffect(() => {
    if (typeFilter && !types.some(([t]) => t === typeFilter)) setTypeFilter(null);
  }, [types, typeFilter]);

  /** Standart kengliklar (mm) — AppSheetdagi mavjud o'lchamlardan yig'iladi */
  const mmPresets = useMemo(() => {
    const set = new Set<number>();
    for (const p of products) {
      if (p.form === 'sleeve_mm' && p.defaultSize > 0) set.add(p.defaultSize);
    }
    return [...set].sort((a, b) => a - b).filter((w) => w <= 200);
  }, [products]);

  const sizeOptions = (product: Product): number[] => {
    const base = product.form === 'sleeve_rib' ? RIB_PRESETS : mmPresets;
    const max = product.sleeveSize || Infinity;
    return base.filter((v) => v <= max);
  };

  const results = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let pool = group === 'all' ? products : products.filter((p) => p.group === group);
    if (typeFilter) pool = pool.filter((p) => p.type === typeFilter);
    if (tokens.length === 0) return pool;
    const squashed = tokens.map(squash).filter(Boolean);
    const scored: { p: Product; score: number }[] = [];
    for (const p of pool) {
      const hay = haystack(p);
      const flat = squash(hay);
      if (!tokens.every((t, i) => hay.includes(t) || flat.includes(squashed[i]))) continue;
      const code = p.code.toLowerCase();
      const flatCode = squash(code);
      const joined = tokens.join(' ');
      const flatQuery = squashed.join('');
      scored.push({
        p,
        score:
          code === joined || flatCode === flatQuery
            ? 0
            : flatCode.startsWith(squashed[0])
              ? 1
              : 2,
      });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.map((s) => s.p);
  }, [products, query, group, typeFilter]);

  // Ro'yxat uzun bo'lgani uchun scroll qilgan sayin qo'shimcha qism chiziladi
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [query, group, typeFilter]);

  const visibleResults = useMemo(
    () => results.slice(0, visibleCount),
    [results, visibleCount],
  );

  const onResultsScroll = () => {
    const el = resultsRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160) {
      setVisibleCount((c) => (c >= results.length ? c : c + PAGE_SIZE));
    }
  };

  // --- savat amallari ------------------------------------------------------
  const addProduct = (p: Product) => {
    const size = isVariable(p) ? p.defaultSize || p.sleeveSize : 0;
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id && l.size === size);
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      const lineId = `${p.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return [...prev, { lineId, productId: p.id, size, qty: 1, discount: 0 }];
    });
  };

  const patchLine = (lineId: string, patch: Partial<CartLine>) => {
    setLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));
  };

  const removeLine = (lineId: string) => setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  const clearCart = () => setLines([]);

  // --- hisob-kitob ---------------------------------------------------------
  const rows = useMemo(
    () =>
      lines
        .map((line) => {
          const product = byId.get(line.productId);
          if (!product) return null;
          return { line, product, totals: lineTotals(product, line.size, line.qty, line.discount) };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    [lines, byId],
  );

  const summary = useMemo(() => {
    const gross = rows.reduce((s, r) => s + r.totals.gross, 0);
    const lineDiscount = rows.reduce((s, r) => s + r.totals.discountAmount, 0);
    const afterLine = gross - lineDiscount;
    const gd = Math.min(Math.max(globalDiscount || 0, 0), 100);
    const globalDiscountAmount = Math.round((afterLine * gd) / 100);
    const total = afterLine - globalDiscountAmount;
    const totalVat = Math.round(total * (1 + VAT_RATE));
    const cost = rows.reduce((s, r) => s + r.totals.netCost * (r.line.qty || 0), 0);
    return {
      gross,
      discountTotal: lineDiscount + globalDiscountAmount,
      total,
      vat: totalVat - total,
      totalVat,
      cost,
      profit: total - cost,
      qty: rows.reduce((s, r) => s + (r.line.qty || 0), 0),
    };
  }, [rows, globalDiscount]);

  const copySummary = async () => {
    const text = [
      ...rows.map((r, i) => {
        const size = isVariable(r.product) ? ` ${r.line.size}${sizeUnit(r.product)}` : '';
        return `${i + 1}. ${r.product.code}${size} x${r.line.qty} — ${formatSom(r.totals.total)} so'm (QQS bilan ${formatSom(r.totals.totalVat)})`;
      }),
      '',
      `Jami (QQSsiz): ${formatSom(summary.total)} so'm`,
      `QQS 12%: ${formatSom(summary.vat)} so'm`,
      `Jami (QQS bilan): ${formatSom(summary.totalVat)} so'm`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Hisob nusxalandi.');
    } catch {
      setError('Nusxalab bo‘lmadi.');
    }
  };

  const [printedAt, setPrintedAt] = useState('');

  useEffect(() => {
    setPrintedAt(new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }));
  }, []);

  const printCart = () => {
    setPrintedAt(new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }));
    setTimeout(() => window.print(), 60);
  };

  const syncedLabel = catalog?.syncedAt
    ? new Date(catalog.syncedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })
    : 'noma’lum';

  return (
    <div className="app">
      <header className="top">
        <div className="brand">Remen kalkulyator</div>
        <div className="spacer" />
        <div className="chip">Kurs: {formatSom(catalog?.usdRate ?? 0)} so&apos;m</div>
        <div className="chip">Mahsulot: {products.length}</div>
        <div className="chip">Oxirgi sync: {syncedLabel}</div>
        <button className="btn primary" onClick={sync} disabled={syncing}>
          {syncing ? 'Yangilanmoqda…' : '↻ Sync'}
        </button>
      </header>

      {/* Faqat chop etishda ko'rinadi: hidden + @media print */}
      <div className="print-sheet" hidden aria-hidden>
        <div className="print-head">
          <div>
            <h1>Hisob-kitob</h1>
            <div className="print-meta">Sana: {printedAt}</div>
          </div>
          <div className="print-meta">
            Pozitsiya: {rows.length} · Dona: {summary.qty}
          </div>
        </div>

        <table className="print-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Mahsulot</th>
              <th>O&apos;lcham</th>
              <th>Soni</th>
              <th>Narx (QQS bilan)</th>
              <th>Summa (QQS bilan)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line, product, totals }, i) => (
              <tr key={line.lineId}>
                <td>{i + 1}</td>
                <td>
                  <b>{product.code}</b>
                  {product.name && product.name !== product.code && (
                    <div className="print-sub">{product.name}</div>
                  )}
                </td>
                <td>{isVariable(product) ? `${line.size} ${sizeUnit(product)}` : '—'}</td>
                <td>{line.qty}</td>
                <td>{formatSom(totals.unitPriceVat)}</td>
                <td>
                  <b>{formatSom(totals.totalVat)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="print-total">
          <div>
            <span>Jami (QQSsiz)</span>
            <span>{formatSom(summary.total)} so&apos;m</span>
          </div>
          {summary.discountTotal > 0 && (
            <div>
              <span>Chegirma</span>
              <span>−{formatSom(summary.discountTotal)} so&apos;m</span>
            </div>
          )}
          <div>
            <span>QQS 12%</span>
            <span>{formatSom(summary.vat)} so&apos;m</span>
          </div>
          <div className="grand">
            <span>Jami (QQS bilan)</span>
            <span>{formatSom(summary.totalVat)} so&apos;m</span>
          </div>
        </div>
      </div>

      {(notice || error) && (
        <div className="toasts">
          {notice && (
            <div className="toast ok">
              <span>{notice}</span>
              <button className="icon-btn" aria-label="Yopish" onClick={() => setNotice(null)}>
                ✕
              </button>
            </div>
          )}
          {error && (
            <div className="toast err">
              <span>{error}</span>
              <button className="icon-btn" aria-label="Yopish" onClick={() => setError(null)}>
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      <div className="layout">
        <section className="panel search-panel">
          <div className="head">
            <h2>Mahsulot qidirish</h2>
            <div className="spacer" />
            <span className="chip">
              {results.length} ta
              {visibleResults.length < results.length ? ` (${visibleResults.length} ko'rsatilmoqda)` : ''}
            </span>
          </div>
          <div className="body">
            <input
              ref={searchRef}
              className="search"
              placeholder="Marka, nom, tip yoki ishlab chiqaruvchi…  ( / tugmasi)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="filters">
              {(
                [
                  ['all', 'Hammasi'],
                  ['timing', 'Tishli (Belts)'],
                  ['vbelt', 'Klinli (V-Belts)'],
                ] as [GroupFilter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={`btn sm ${group === key ? 'active' : ''}`}
                  onClick={() => setGroup(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="types-head">
              <span>Kategoriyalar ({types.length})</span>
              {typeFilter && (
                <button className="btn sm ghost" onClick={() => setTypeFilter(null)}>
                  ✕ {typeFilter}
                </button>
              )}
              <button className="btn sm ghost" onClick={() => setTypesOpen((v) => !v)}>
                {typesOpen ? 'Yashirish' : 'Ko‘rsatish'}
              </button>
            </div>

            {typesOpen && (
              <div className="types">
                {types.map(([type, count]) => (
                  <button
                    key={type}
                    className={`type-card ${typeFilter === type ? 'active' : ''}`}
                    onClick={() => setTypeFilter((cur) => (cur === type ? null : type))}
                  >
                    <span className="type-name">{type}</span>
                    <span className="type-count">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="results" ref={resultsRef} onScroll={onResultsScroll}>
            {loading && <div className="empty">Yuklanmoqda…</div>}
            {!loading && results.length === 0 && <div className="empty">Hech narsa topilmadi.</div>}
            {visibleResults.map((p) => {
              const u = unitPrice(p, p.defaultSize);
              const badge = formBadge(p);
              return (
                <div
                  key={p.id}
                  className="result"
                  role="button"
                  tabIndex={0}
                  onClick={() => addProduct(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addProduct(p);
                  }}
                >
                  <div>
                    <div className="code">
                      {p.code}
                      {badge && <span className={badge.cls}>{badge.label}</span>}
                    </div>
                    <div className="meta">
                      {[p.type, p.manufacturer, p.country, p.name !== p.code ? p.name : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div className="price">
                    <b>{formatSom(u.price)}</b>
                    <small>QQS bilan {formatSom(u.priceVat)}</small>
                  </div>
                </div>
              );
            })}
            {visibleResults.length < results.length && (
              <div className="empty">
                Yana {results.length - visibleResults.length} ta —{' '}
                <button
                  className="btn sm"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                >
                  ko&apos;rsatish
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="head">
            <h2>Savat</h2>
            <div className="spacer" />
            <label className="toggle">
              <input
                type="checkbox"
                checked={showCost}
                onChange={(e) => setShowCost(e.target.checked)}
              />
              Tannarx / foyda
            </label>
            <button className="btn sm ghost" onClick={copySummary} disabled={rows.length === 0}>
              Nusxalash
            </button>
            <button
              className="btn sm ghost"
              onClick={printCart}
              disabled={rows.length === 0}
            >
              Chop etish
            </button>
            <button className="btn sm danger" onClick={clearCart} disabled={rows.length === 0}>
              Tozalash
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="empty grow">Savat bo&apos;sh. Chapdagi ro&apos;yxatdan mahsulot tanlang.</div>
          ) : (
            <div className="cart-scroll">
              <table className="cart">
                <colgroup>
                  <col />
                  <col className="col-size" />
                  <col className="col-qty" />
                  <col className="col-sum" />
                  <col className="col-del" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Mahsulot</th>
                    <th>O&apos;lcham</th>
                    <th>Soni</th>
                    <th>QQS bilan</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ line, product, totals }) => (
                    <tr key={line.lineId}>
                      <td>
                        <div className="cell-name" title={product.name || product.code}>
                          {product.code}
                        </div>
                        {showCost && (
                          <div className="cell-sub">
                            tannarx {formatSom(totals.netCost)} ·{' '}
                            <span className={totals.profit >= 0 ? 'profit' : 'loss'}>
                              foyda {formatSom(totals.profit)}
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        {isVariable(product) ? (
                          <div className="combo">
                            <div className="field">
                              <input
                                type="number"
                                min={1}
                                max={product.sleeveSize || undefined}
                                value={line.size || ''}
                                onChange={(e) =>
                                  patchLine(line.lineId, { size: Number(e.target.value) || 0 })
                                }
                                onFocus={() => setSizeMenuFor(line.lineId)}
                              />
                              <span>{sizeUnit(product)}</span>
                              <button
                                type="button"
                                className="combo-toggle"
                                aria-label="O&apos;lchamni tanlash"
                                onClick={() =>
                                  setSizeMenuFor((cur) => (cur === line.lineId ? null : line.lineId))
                                }
                              >
                                ▾
                              </button>
                            </div>
                            {sizeMenuFor === line.lineId && (
                              <div className="size-menu">
                                {sizeOptions(product).map((v) => (
                                  <button
                                    key={v}
                                    type="button"
                                    className={line.size === v ? 'active' : ''}
                                    onClick={() => {
                                      patchLine(line.lineId, { size: v });
                                      setSizeMenuFor(null);
                                    }}
                                  >
                                    {v}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="cell-sub">dona</span>
                        )}
                      </td>
                      <td>
                        <div className="field">
                          <input
                            type="number"
                            min={1}
                            value={line.qty || ''}
                            onChange={(e) =>
                              patchLine(line.lineId, { qty: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                      </td>
                      <td>
                        <b>{formatSom(totals.totalVat)}</b>
                        {totals.discountAmount > 0 && (
                          <div className="cell-sub">−{formatSom(totals.discountAmount)}</div>
                        )}
                      </td>
                      <td>
                        <button
                          className="icon-btn"
                          title="O&apos;chirish"
                          aria-label="O&apos;chirish"
                          onClick={() => removeLine(line.lineId)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="summary">
            <div className="row">
              <span className="muted">Pozitsiya / dona</span>
              <span>
                {rows.length} / {summary.qty}
              </span>
            </div>
            <div className="row">
              <span className="muted">Chegirmasiz (QQSsiz)</span>
              <span>{formatSom(summary.gross)} so&apos;m</span>
            </div>
            <div className="row">
              <span className="muted">Umumiy chegirma</span>
              <span className="discount-cell">
                <span className={`field ${globalDiscount > 0 ? 'on' : ''}`}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="0"
                    value={globalDiscount || ''}
                    onChange={(e) => setGlobalDiscount(Number(e.target.value) || 0)}
                  />
                  <span>%</span>
                </span>
                <b className={summary.discountTotal > 0 ? 'discount-val' : 'muted'}>
                  −{formatSom(summary.discountTotal)}
                </b>{' '}
                so&apos;m
              </span>
            </div>
            <div className="row">
              <span className="muted">Jami (QQSsiz)</span>
              <span>
                <b>{formatSom(summary.total)}</b> so&apos;m
              </span>
            </div>
            <div className="row vat">
              <span className="muted">QQS 12%</span>
              <span>
                <b>{formatSom(summary.vat)}</b> so&apos;m
              </span>
            </div>
            <div className="row total">
              <span>Jami (QQS bilan)</span>
              <span>{formatSom(summary.totalVat)} so&apos;m</span>
            </div>
            {showCost && (
              <div className="row">
                <span className="muted">Tannarx / foyda</span>
                <span>
                  {formatSom(summary.cost)} /{' '}
                  <b style={{ color: summary.profit >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                    {formatSom(summary.profit)}
                  </b>{' '}
                  so&apos;m
                </span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
