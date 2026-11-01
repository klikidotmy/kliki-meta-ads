# KLIKI Meta Ads

Web app (PWA) untuk pantau prestasi iklan Meta (Facebook/Instagram, click-to-WhatsApp) KLIKI. Tema sama dengan KLIKI Marketing Dashboard.

Apps Script ada dua mod sumber data:

- **Mod snapshot (sekarang):** tugasan berjadual Claude tarik data Meta 4× sehari (8:39, 12:39, 16:39, 20:39 waktu Malaysia) melalui sambungan Meta Ads dan tulis ke Google Sheet *KLIKI Meta Ads Data* (tab `raw`). Apps Script baca sheet tu. Tempoh: sejak mula, hari ini, semalam, 7 hari lepas. Tak perlu token Meta.
- **Mod live:** bila `META_TOKEN` diset dalam Script Properties, data ditarik terus dari Meta setiap kali app dibuka (cache 5 minit) dan semua 7 tempoh tersedia.

Repo ini public, jadi **tiada token, PIN atau data iklan disimpan di sini**: semuanya dalam Script Properties dan sheet peribadi.

## Isi app

| Tab | Isi |
|---|---|
| Ringkasan | Chat, kos sechat, belanja, klik → chat, 8 kad dengan bar prestasi (hijau / kuning / merah), chat per hari, chat ikut jam |
| Outlet | Satu kad setiap outlet (ad set `OUTLET \| Kategori` digabung): belanja, chat, kos sechat dengan bar, dan pecahan setiap kategori |
| Kategori | Kategori = padang, angle = pemain. Kos sechat setiap angle dalam padang yang sama, dan status pemenang (≥ 10 chat setiap angle, beza ≥ 20%) |
| Iklan | Jadual semua iklan, boleh cari dan sort |

Kategori & angle dibaca dari **nama iklan**: `OUTLET | Kategori | Angle`, contoh `AS | Repair | RP1 Siap hari sama`.

## Sasaran & bar prestasi

Semua dalam `js/config.js`:
- Sasaran chat = bajet harian ad set aktif (dibaca dari Meta) ÷ RM5 × hari aktif.
- Sasaran klik = sasaran chat ÷ 30%.
- Zon setiap bar (`meters`). Median kos sechat Malaysia RM13.43 (ALIQ Studio, Ogos 2026) jadi garis titik pada bar kos sechat.
- Zon lain ialah sasaran cadangan KLIKI, bukan standard industri.

## Setup (sekali sahaja)

### 1. Token Meta (pilihan, untuk mod live sahaja)
Langkah dalam laman Meta mungkin berubah sedikit.
1. Buka developers.facebook.com → **My Apps → Create App**, pilih jenis Business, tambah produk **Marketing API**.
2. **Tools → Graph API Explorer**: pilih app tadi, *User Token*, tambah kebenaran **ads_read**, tekan **Generate Access Token** dan benarkan akses ke akaun iklan KLIKI Kedah.
3. **Tools → Access Token Debugger**: tampal token, tekan **Extend Access Token** untuk token tahan lebih kurang 60 hari. Catat tarikh tamat.

Token ini beri akses baca ke akaun iklan. Jangan kongsi atau letak dalam repo.

### 2. Apps Script
1. script.google.com → **New project**, namakan `KLIKI Meta Ads API`.
2. Tampal isi `apps-script/Code.gs`.
3. **Project Settings → Script properties**, tambah:

   | Property | Nilai |
   |---|---|
   | `META_TOKEN` | (pilihan) token dari langkah 1. Kosongkan untuk mod snapshot |
   | `AD_ACCOUNT_ID` | `2071524496317412` |
   | `APP_PIN` | PIN pilihan |
   | `TOKEN_EXPIRES` | tarikh tamat token, `YYYY-MM-DD` (app beri amaran 7 hari sebelum) |

4. Pilih fungsi `testSetup` → **Run** → benarkan kebenaran. Execution log patut tunjuk `OK (sheet). Belanja RM…` atau `OK (live)…`.
5. **Deploy → New deployment → Web app**. Execute as: **Me**. Who has access: **Anyone**. Salin URL Web App.
6. Letak URL tu dalam `apiUrl` di `js/config.js`.

Bila tukar kod Apps Script: **Deploy → Manage deployments → Edit → Version: New version**. Jangan buat New deployment, nanti URL bertukar.

### 3. Perbaharui token (setiap ~60 hari)
Ulang langkah 1.2 dan 1.3, kemudian kemas kini `META_TOKEN` dan `TOKEN_EXPIRES` dalam Script properties. Tak perlu deploy semula.

## Pasang di phone
- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** menu ⋮ → *Install app*

## Struktur

```
index.html            shell app + skrin PIN
styles.css            tema KLIKI Marketing Dashboard + komponen Meta Ads
js/config.js          URL Apps Script, sasaran, zon bar
js/app.js             kiraan + paparan 4 tab
sw.js                 service worker (buka laju)
manifest.webmanifest  maklumat app
apps-script/Code.gs   backend: panggil Meta Graph API, semak PIN, cache 5 minit
```

Nota data: "Chat" ialah keputusan Meta (*messaging conversations started*, atribusi lalai Meta). Ia bukan lead yang disahkan outlet. Padankan dengan kod `[FB-xx]` dalam Outlet Tracker sebelum buat keputusan bajet.
