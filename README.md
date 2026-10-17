# Remen kalkulyator

AppSheet'dagi ikkita ilova (tishli remenlar — **Belts**, klinli/poliklinli remenlar — **VBelts**) ma'lumotlari
asosida ishlaydigan savat + narx kalkulyatori. Next.js (App Router) da yozilgan, Vercel'ga deploy qilinadi.

## Imkoniyatlar

- **Qidiruv** — marka, nom, tip, ishlab chiqaruvchi va davlat bo'yicha; `Hammasi / Tishli / Klinli` filtri, `/` tugmasi qidiruvga fokus beradi.
- **Savat** — mahsulot ustiga bosilsa savatga tushadi; har bir qator uchun o'lcham (rukav uchun mm yoki rib), soni va chegirma % alohida sozlanadi.
- **QQS** — har bir qator va umumiy jami QQSsiz va QQS bilan (12%) ko'rsatiladi, QQS summasi alohida chiqadi.
- **Chegirma** — qator bo'yicha ham, umumiy savat bo'yicha ham (ixtiyoriy, bo'sh qoldirilsa 0).
- **Tannarx / foyda** — yoqib qo'yiladigan ustun (sotuvchiga ko'rinadi, mijozga chop etilganda ham chiqadi).
- **Sync** — AppSheet API'dan barcha jadvallarni qayta yuklab, `data/*/*.json` fayllarini yangilaydi.
- Savat brauzerda (`localStorage`) saqlanadi, sahifa yangilansa yo'qolmaydi. "Nusxalash" va "Chop etish" tugmalari bor.

## Narx formulalari

Formulalar AppSheet'dagi hisob-kitobdan olingan va butun baza bo'yicha tekshirilgan
(883 ta Belts va 849 ta VBelts qatorida 100% mos keldi):

```
Cost_per_mm / Cost_per_rib = ROUNDUP(Income_price / Sleeve_width, 0.01)   # USD
Net_cost  = Cost_per_mm × o'lcham × dollar_kursi                          # so'm
Selling   = ROUNDUP(Net_cost × (1 + Margin/100), -3) + 2000               # QQSsiz
Selling_VAT = Selling × 1.12                                              # QQS 12%
```

- **Товар / Рулон** — narx AppSheet'dagi `Selling_price` / `Selling_price_VAT` dan olinadi.
- **Рукав** — o'lcham AppSheet'dagi standart o'lchamga teng bo'lsa, AppSheet narxi ishlatiladi;
  o'lcham o'zgartirilsa narx yuqoridagi formula bo'yicha qayta hisoblanadi.
- Dollar kursi `data/*/Reference.json` dagi "Курс доллара" qatoridan olinadi (hozir 13 500).
- Chegirma QQSsiz summadan ayriladi, QQS esa chegirmadan keyingi summadan hisoblanadi.

## Loyiha tuzilishi

```
data/Belts/*.json          AppSheet (tishli remenlar) eksporti
data/VBelts/*.json         AppSheet (klinli remenlar) eksporti
src/lib/appsheet.ts        AppSheet API v2 mijozi (Find action)
src/lib/storage.ts         JSON fayllarni o'qish/yozish (lokalda data/, Vercelda /tmp)
src/lib/catalog.ts         JSON -> yagona Product modeliga aylantirish + kesh (5 daqiqa)
src/lib/pricing.ts         Narx, chegirma va QQS formulalari
src/app/api/catalog/route.ts   GET  — katalogni qaytaradi
src/app/api/sync/route.ts      POST — AppSheet'dan yangilaydi
src/components/Calculator.tsx  Butun UI (qidiruv + savat + jami)
```

## Lokalda ishga tushirish

```bash
npm install
npm run dev     # http://localhost:3000
```

`.env` fayli kerak (namuna: `.env.example`):

```
APPSHEET_TIMING_APP_ID=...
APPSHEET_TIMING_KEY=...
APPSHEET_TIMING_TABLE=Belts
APPSHEET_TIMING_TABLES=Manufacturers,Purchase,Purchase_basket,Reference,Types

APPSHEET_VBELT_APP_ID=...
APPSHEET_VBELT_KEY=...
APPSHEET_VBELT_TABLE=VBelts
APPSHEET_VBELT_TABLES=Manufacturers,Purchase,Purchase_basket,Reference,Types

# ixtiyoriy
SYNC_SECRET=maxfiy-kalit
```

## Vercel'ga deploy

1. Repozitoriyni GitHub'ga yuklang (`data/` papkasi ham commit qilinsin — u boshlang'ich ma'lumot bo'lib xizmat qiladi).
2. Vercel'da "New Project" → repo tanlanadi (framework avtomatik Next.js deb aniqlanadi).
3. **Settings → Environment Variables** ga yuqoridagi `APPSHEET_*` o'zgaruvchilarini qo'shing.
   `.env` fayli git'ga tushmaydi (`.gitignore` da), shuning uchun kalitlar faqat Vercel'da saqlanadi.
4. Deploy.

### Sync Vercel'da qanday ishlaydi

Vercel'da fayl tizimi faqat o'qish uchun, yozish mumkin bo'lgan yagona joy — `/tmp`. Shuning uchun:

- **Lokalda** Sync to'g'ridan-to'g'ri `data/*/*.json` fayllarini yangilaydi (keyin commit qilib deploy qilsangiz, yangi narxlar bazaga kiradi).
- **Vercel'da** Sync AppSheet'dan yangi ma'lumotni oladi, `/tmp` ga yozadi va sahifaga darhol qaytaradi —
  ya'ni Sync bosgan odam yangi narxlarni shu zahoti ko'radi. `/tmp` vaqtinchalik bo'lgani uchun
  bir necha vaqtdan keyin yoki boshqa serverda katalog yana repo'dagi `data/` ga qaytadi
  (shuning uchun katalog hech qachon bo'sh qolmaydi).
- Doimiy saqlash kerak bo'lsa, keyingi qadam — `writeJson` ni Vercel Blob yoki KV ga yozadigan qilish
  (`src/lib/storage.ts` da bitta joyda o'zgaradi).

`SYNC_SECRET` qo'yilsa, `/api/sync` ga `x-sync-secret` sarlavhasisiz murojaat qilib bo'lmaydi
(UI'dagi tugma uchun uni bo'sh qoldiring).
