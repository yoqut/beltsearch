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
const MAX_RESULTS = 60;

type GroupFilter = 'all' | 'timing' | 'vbelt';

function formBadge(p: Product): { label: string; cls: string } | null {
  if (p.form === 'sleeve_mm') return { label: 'rukav / mm', cls: 'badge sleeve' };
  if (p.form === 'sleeve_rib') return { label: 'rukav / rib', cls: 'badge sleeve' };
  if (p.form === 'roll') return { label: 'rulon', cls: 'badge roll' };
  return null;
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
  const [lines, setLines] = useState<CartLine[]>([]);
  const [globalDiscount, setGlobalDiscount] = useState(0);
  const [showCost, setShowCost] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
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

  const results = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const pool = group === 'all' ? products : products.filter((p) => p.group === group);
    if (tokens.length === 0) return pool.slice(0, MAX_RESULTS);
    const scored: { p: Product; score: number }[] = [];
    for (const p of pool) {
      const hay = haystack(p);
      if (!tokens.every((t) => hay.includes(t))) continue;
      const code = p.code.toLowerCase();
      const joined = tokens.join(' ');
      scored.push({ p, score: code === joined ? 0 : code.startsWith(tokens[0]) ? 1 : 2 });
      if (scored.length > 400) break;
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, MAX_RESULTS).map((s) => s.p);
  }, [products, query, group]);

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

  const syncedLabel = catalog?.syncedAt
    ? new Date(catalog.syncedAt).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' })
    : 'noma’lum';

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          Remen kalkulyator
          <span>AppSheet ma&apos;lumotlari asosida</span>
        </div>
        <div className="spacer" />
        <div className="chip">Kurs: {formatSom(catalog?.usdRate ?? 0)} so&apos;m</div>
        <div className="chip">Mahsulot: {products.length}</div>
        <div className="chip">Oxirgi sync: {syncedLabel}</div>
        <button className="btn primary" onClick={sync} disabled={syncing}>
          {syncing ? 'Yangilanmoqda…' : '↻ Sync'}
        </button>
      </header>

      {error && <div className="error">{error}</div>}
      {notice && <div className="ok-msg">{notice}</div>}

      <div className="layout">
        <section className="panel search-panel">
          <div className="head">
            <h2>Mahsulot qidirish</h2>
            <div className="spacer" />
            <span className="chip">{results.length} ta</span>
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
          </div>
          <div className="results">
            {loading && <div className="empty">Yuklanmoqda…</div>}
            {!loading && results.length === 0 && <div className="empty">Hech narsa topilmadi.</div>}
            {results.map((p) => {
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
              onClick={() => window.print()}
              disabled={rows.length === 0}
            >
              Chop etish
            </button>
            <button className="btn sm danger" onClick={clearCart} disabled={rows.length === 0}>
              Tozalash
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="empty">Savat bo&apos;sh. Chapdagi ro&apos;yxatdan mahsulot tanlang.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="cart">
                <thead>
                  <tr>
                    <th>Mahsulot</th>
                    <th>O&apos;lcham</th>
                    <th>Soni</th>
                    <th>Narx (QQSsiz)</th>
                    <th>Chegirma %</th>
                    <th>Summa (QQSsiz)</th>
                    <th>Summa (QQS bilan)</th>
                    {showCost && <th>Foyda</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ line, product, totals }) => (
                    <tr key={line.lineId}>
                      <td>
                        <div className="cell-name">{product.code}</div>
                        <div className="cell-sub">
                          {[product.type, product.manufacturer].filter(Boolean).join(' · ')}
                          {showCost ? ` · tannarx ${formatSom(totals.netCost)}` : ''}
                        </div>
                      </td>
                      <td>
                        {isVariable(product) ? (
                          <>
                            <input
                              className="num small"
                              type="number"
                              min={1}
                              max={product.sleeveSize || undefined}
                              value={line.size || ''}
                              onChange={(e) =>
                                patchLine(line.lineId, { size: Number(e.target.value) || 0 })
                              }
                            />{' '}
                            <span className="cell-sub">{sizeUnit(product)}</span>
                          </>
                        ) : (
                          <span className="cell-sub">dona</span>
                        )}
                      </td>
                      <td>
                        <input
                          className="num small"
                          type="number"
                          min={1}
                          value={line.qty || ''}
                          onChange={(e) =>
                            patchLine(line.lineId, { qty: Number(e.target.value) || 0 })
                          }
                        />
                      </td>
                      <td>{formatSom(totals.unitPrice)}</td>
                      <td>
                        <input
                          className="num small"
                          type="number"
                          min={0}
                          max={100}
                          placeholder="0"
                          value={line.discount || ''}
                          onChange={(e) =>
                            patchLine(line.lineId, { discount: Number(e.target.value) || 0 })
                          }
                        />
                      </td>
                      <td>
                        <b>{formatSom(totals.total)}</b>
                        {totals.discountAmount > 0 && (
                          <div className="cell-sub">−{formatSom(totals.discountAmount)}</div>
                        )}
                      </td>
                      <td>{formatSom(totals.totalVat)}</td>
                      {showCost && (
                        <td style={{ color: totals.profit >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                          {formatSom(totals.profit)}
                        </td>
                      )}
                      <td>
                        <button className="btn sm danger" onClick={() => removeLine(line.lineId)}>
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
              <span>
                <input
                  className="num small"
                  type="number"
                  min={0}
                  max={100}
                  placeholder="0"
                  value={globalDiscount || ''}
                  onChange={(e) => setGlobalDiscount(Number(e.target.value) || 0)}
                />{' '}
                % → −{formatSom(summary.discountTotal)} so&apos;m
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
