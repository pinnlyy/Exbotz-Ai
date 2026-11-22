# API Backend ExBotz

Semua endpoint `/api/*` memerlukan header `Authorization: Bearer <APP_TOKEN>`.

| Method | Path | Fungsi |
|---|---|---|
| GET | `/health` | Cek hidup (tanpa auth) |
| GET | `/api/ping` | Validasi token, mengembalikan default model |
| GET | `/api/models` | Daftar model/Combo dari 9Router (`GET /v1/models`) |
| POST | `/api/chat` | Chat streaming (SSE) |
| POST | `/api/upload` | Upload (multipart: `file`, `conversationId`) → `{id,...}` |
| GET | `/api/files/:convId` | Daftar file hasil generate |
| GET | `/api/files/:convId/preview?path=` | Pratinjau file teks |
| GET | `/api/files/:convId/download?path=` | Unduh file |
| POST | `/api/files/:convId/zip` | Kemas folder jadi ZIP `{dir?,name?}` |
| DELETE | `/api/files/:convId` | Hapus workspace percakapan |

## POST /api/chat
Body:
```json
{ "conversationId": "uuid-atau-id-8-64-karakter", "model": "nama-combo",
  "messages": [{"role":"user","content":"...","attachmentIds":["<hex24>"]}] }
```
Klien mengirim seluruh riwayat (edit/regenerate = kirim ulang riwayat yang dipotong).

Event SSE: `start`, `delta {text}`, `file_start {path}`, `file {file}`,
`file_error {path,message}`, `error {message}`, `done`.
Menghentikan generate = menutup koneksi HTTP; backend membatalkan request ke 9Router.

## Protokol pembuatan file
AI diinstruksikan menulis `<exbotz-file path="...">isi</exbotz-file>` dan
`<exbotz-zip name="x.zip" dir="folder" />`. Backend memisahkan blok ini dari teks chat,
menulis file ke `DATA_DIR/workspaces/<convId>/` (path divalidasi, ekstensi di-whitelist,
kuota ukuran/jumlah), dan tidak pernah mengeksekusi isinya.
