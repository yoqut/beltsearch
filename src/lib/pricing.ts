import type { Product } from './types';

/** O'zbekistonda QQS stavkasi */
export const VAT_RATE = 0.12;

export function ceilTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.ceil(value / step) * step;
}

/**
 * AppSheetdagi formulaning aynan o'zi (883 ta Belts va 849 ta VBelts qatorida tekshirilgan):
 *   Selling_price = ROUNDUP(Net_cost * (1 + Margin/100), -3) + 2000
 */
export function sellingPriceFromNet(netCost: number, margin: number): number {
  if (!netCost) return 0;
  return ceilTo(netCost * (1 + margin / 100), 1000) + 2000;
}

/** Rukavda 1 mm / 1 rib tannarxi yuqoriga 0.01 USD gacha yaxlitlanadi */
export function costPerUnit(incomePrice: number, sleeveSize: number): number {
  if (!incomePrice || !sleeveSize) return 0;
  return ceilTo(incomePrice / sleeveSize, 0.01);
}

export function isVariable(product: Product): boolean {
  return product.form === 'sleeve_mm' || product.form === 'sleeve_rib';
}

export function sizeUnit(product: Product): string {
  if (product.form === 'sleeve_mm') return 'mm';
  if (product.form === 'sleeve_rib') return 'rib';
  return 'dona';
}

export interface UnitPrice {
  netCost: number;
  price: number;
  priceVat: number;
}

/** Berilgan o'lcham uchun 1 dona mahsulot narxi */
export function unitPrice(product: Product, size: number): UnitPrice {
  if (!isVariable(product)) {
    const price = product.price || sellingPriceFromNet(product.netCost, product.margin);
    return {
      netCost: product.netCost,
      price,
      priceVat: product.priceVat || Math.round(price * (1 + VAT_RATE)),
    };
  }

  const effSize = size > 0 ? size : product.defaultSize;
  // O'lcham o'zgarmagan bo'lsa — AppSheetdagi narx (qo'lda tuzatilgan bo'lishi mumkin)
  if (effSize === product.defaultSize && product.price) {
    return {
      netCost: product.netCost,
      price: product.price,
      priceVat: product.priceVat || Math.round(product.price * (1 + VAT_RATE)),
    };
  }

  const usdRate = product.usdRate > 0
    ? product.usdRate
    : product.costPerUnit > 0 && product.defaultSize > 0 && product.netCost > 0
      ? product.netCost / (product.costPerUnit * product.defaultSize)
      : 0;
  const netCost = Math.round(product.costPerUnit * effSize * usdRate);
  const price = sellingPriceFromNet(netCost, product.margin);
  return { netCost, price, priceVat: Math.round(price * (1 + VAT_RATE)) };
}

export interface LineTotals {
  unitPrice: number;
  unitPriceVat: number;
  netCost: number;
  /** Chegirmasiz, QQSsiz */
  gross: number;
  discountAmount: number;
  /** Chegirmadan keyin, QQSsiz */
  total: number;
  vatAmount: number;
  /** Chegirmadan keyin, QQS bilan */
  totalVat: number;
  profit: number;
}

export function lineTotals(
  product: Product,
  size: number,
  qty: number,
  discount: number,
): LineTotals {
  const u = unitPrice(product, size);
  const safeQty = qty > 0 ? qty : 0;
  const gross = u.price * safeQty;
  const d = Math.min(Math.max(discount || 0, 0), 100);
  const discountAmount = Math.round((gross * d) / 100);
  const total = gross - discountAmount;
  const totalVat = Math.round(total * (1 + VAT_RATE));
  return {
    unitPrice: u.price,
    unitPriceVat: u.priceVat,
    netCost: u.netCost,
    gross,
    discountAmount,
    total,
    vatAmount: totalVat - total,
    profit: total - u.netCost * safeQty,
  };
}

export function formatSom(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(value || 0));
}
