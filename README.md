# ExBotz

Aplikasi AI pribadi berbasis web (PWA, di-host di GitHub Pages, bisa dijadikan APK lewat PWABuilder) dengan backend Node.js + TypeScript.
Satu-satunya provider AI adalah **9Router** (endpoint OpenAI-compatible, mode Combo/Fallback).

## Status

| Bagian | Status |
|---|---|
| `backend/` | Kode lengkap (build penuh belum dijalankan, lihat catatan). |
| `web/` | Frontend statis satu file (`index.html`) + manifest PWA. |

## Konfigurasi 9Router Combo
1. Jalankan 9Router (default `http://localhost:20128`, API di `/v1`; dashboard di `/dashboard`).
2. Di dashboard, buat **Combo** berisi model berurutan (fallback otomatis ke model berikutnya saat gagal/kuota habis).
3. Jika 9Router memakai `REQUIRE_API_KEY=true`, salin API key dari dashboard.
4. Isi `backend/.env` (lihat bagian bawah). Nama Combo dipakai sebagai nilai `model`.

## Menjalankan backend
```bash
cd backend
cp .env.example .env      # isi APP_TOKEN (openssl rand -hex 32), NINEROUTER_*
npm install
npm run typecheck && npm run build
npm start                 # atau: npm run dev
curl localhost:8787/health
curl -H "Authorization: Bearer $APP_TOKEN" localhost:8787/api/models
```
Termux: `pkg install nodejs git`, lalu langkah yang sama (semua dependensi pure-JS).

## HTTPS di VPS
Aplikasi Android harus terhubung lewat HTTPS. Contoh Caddy (sertifikat otomatis):
```
exbotz.contoh.com {
    reverse_proxy 127.0.0.1:8787 {
        flush_interval -1
    }
}
```
`flush_interval -1` penting agar streaming SSE tidak tertahan. Di nginx: `proxy_buffering off;`.
Jangan membuka port 20128 (9Router) ke publik; cukup backend ExBotz.

## Keamanan
API key 9Router hanya ada di `backend/.env`. Aplikasi memakai `APP_TOKEN` yang diisi pemilik di layar pengaturan (tidak ditanam di APK). Upload divalidasi (ukuran, ekstensi, magic bytes, batas ekstraksi ZIP), file hasil AI disimpan di direktori terisolasi per percakapan dengan whitelist ekstensi, dan kode buatan AI tidak pernah dieksekusi.

Dokumentasi API: `docs/API.md`.

## Deploy web (GitHub Pages)
1. Push repo ke GitHub. Settings → Pages → Source: **GitHub Actions** (workflow `.github/workflows/pages.yml` sudah ada).
2. Setelah deploy, URL-nya `https://USERNAME.github.io/REPO/`.
3. Di `backend/.env` isi `CORS_ORIGIN=https://USERNAME.github.io` (origin saja, tanpa path), restart backend.
4. Buka web, isi **URL backend (HTTPS)** dan **APP_TOKEN** di Pengaturan (disimpan di browser perangkat Anda, bukan di repo).

## Web → APK
Buka https://www.pwabuilder.com, masukkan URL GitHub Pages, pilih paket Android, unduh APK/AAB. Manifest, service worker, dan ikon sudah tersedia di `web/`.
