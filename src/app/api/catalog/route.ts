import { NextResponse } from 'next/server';
import { getCatalog } from '@/lib/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const catalog = getCatalog();
    return NextResponse.json(catalog);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Katalogni o‘qib bo‘lmadi' },
      { status: 500 },
    );
  }
}
