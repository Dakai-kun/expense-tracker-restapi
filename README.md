# REST API Express + Prisma

API ini dibuat menggunakan Express.js dan Prisma. Untuk deployment ke Neon, gunakan Neon sebagai database Postgres dan set `DATABASE_URL` pada environment.

## Instalasi

1. Buka terminal di folder `rest-api`
2. Jalankan:
   ```bash
   npm install
   ```
3. Buat file `.env` berdasarkan `.env.example`
4. Set `DATABASE_URL` dengan connection string Neon Postgres

## Prisma

Sinkronkan schema ke database:
```bash
npx prisma db push
```

## Jalankan server

```bash
npm run dev
```

Server akan berjalan di `http://localhost:3000` atau port di `PORT` environment.

## Endpoints

### Category
- `GET /categories`
- `POST /categories`

Body contoh:
```json
{
  "name": "Food"
}
```

### User
- `GET /users`
- `POST /users`

Body contoh:
```json
{
  "name": "Budi",
  "email": "budi@example.com",
  "photoUrl": "https://example.com/budi.jpg"
}
```

### Transaction
- `GET /transactions`
- `GET /transactions/:id`
- `POST /transactions`

Header wajib untuk `POST /transactions`:
```
Authorization: user@example.com
```

Body contoh JSON:
```json
{
  "title": "Belanja",
  "categoryId": 1,
  "amount": 120000,
  "type": "expense",
  "date": "2026-06-21",
  "imageId": "receipt-123"
}
```

Jika menggunakan multipart upload seperti di Android:
- `title`
- `categoryId`
- `amount`
- `type`
- `date`
- `image`

Contoh `DATABASE_URL`:
```env
DATABASE_URL="postgresql://username:password@db.neon.tech:5432/database_name?schema=public"
```

## Deploy ke Neon

Neon hanya memberikan database. Untuk API, deploy aplikasi ke hosting Node seperti Vercel, Render, Railway, atau Heroku, lalu beri aplikasi environment variable `DATABASE_URL` dengan Neon connection string.
