export type CatalogGroup = 'timing' | 'vbelt';

/** Товар/Рулон — tayyor mahsulot, Рукав — kesib sotiladigan rukav */
export type ProductForm = 'piece' | 'roll' | 'sleeve_mm' | 'sleeve_rib';

export interface Product {
  id: string;
  group: CatalogGroup;
  /** AppSheet "mark" — asosiy qidiruv kaliti */
  code: string;
  /** AppSheet "mark_name" — to'liq nomi */
  name: string;
  type: string;
  manufacturer: string;
  country: string;
  form: ProductForm;
  /** Rukav uchun: 1 mm (yoki 1 rib) tannarxi, USD */
  costPerUnit: number;
  /** Rukavning to'liq eni (mm) yoki riblar soni */
  sleeveSize: number;
  /** AppSheetdagi joriy o'lcham (mm yoki rib) */
  defaultSize: number;
  /** Ustama, % */
  margin: number;
  /** AppSheetdagi tannarx, so'm */
  netCost: number;
  /** AppSheetdagi sotuv narxi (QQSsiz), so'm */
  price: number;
  /** AppSheetdagi sotuv narxi (QQS bilan), so'm */
  priceVat: number;
  /** Qo'shimcha ma'lumot: uzunlik, en, balandlik va h.k. */
  info: Record<string, string>;
}

export interface Catalog {
  products: Product[];
  usdRate: number;
  syncedAt: string | null;
  source: 'runtime' | 'repo';
  counts: Record<string, number>;
}

export interface CartLine {
  lineId: string;
  productId: string;
  /** Rukav uchun tanlangan en (mm) / riblar soni */
  size: number;
  qty: number;
  /** Chegirma, % */
  discount: number;
}
