const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { get, put } = require('@vercel/blob');
const { PrismaClient } = require('@prisma/client');

// Local env loader (for local development). On Vercel set env vars in Project Settings.
require('dotenv').config();

const app = express();

const storage = multer.memoryStorage();
const upload = multer({ storage });
app.set('trust proxy', 1);
app.use(express.json());

// Serve documentation/static files at /docs
app.use('/docs', express.static(path.join(__dirname, 'public')));

const prisma = global.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.prisma = prisma;


async function resolveUserFromAuth(auth) {
    if (!auth) return null;

    if (auth.includes('@')) {
        let user = await prisma.user.findUnique({ where: { email: auth } });
        if (!user) {
            user = await prisma.user.create({
                data: {
                    email: auth,
                    name: auth.split('@')[0],
                    photoUrl: '',
                },
            });
        }
        return user;
    }

    const id = Number(auth);
    if (!Number.isNaN(id)) {
        return prisma.user.findUnique({ where: { id } });
    }

    return null;
}

function getUserEmailFromRequest(req) {
    const bodyEmail = req.body?.userEmail;
    const queryEmail = req.query?.userEmail;
    const auth = req.header('Authorization');

    if (bodyEmail) return String(bodyEmail);
    if (queryEmail) return String(queryEmail);
    if (auth && auth.includes('@')) return auth;

    return '';
}

function resolveBlobAccess() {
    const configuredAccess = process.env.BLOB_ACCESS ?? process.env.BLOB_STORE_PUBLIC;
    const value = String(configuredAccess ?? '').trim().toLowerCase();

    if (value === 'private' || value === 'false') return 'private';
    return 'public';
}

function createBlobOptions() {
    const blobOpts = {
        access: resolveBlobAccess(),
    };

    if (process.env.BLOB_READ_WRITE_TOKEN) {
        blobOpts.token = process.env.BLOB_READ_WRITE_TOKEN;
    } else if (process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN) {
        blobOpts.storeId = process.env.BLOB_STORE_ID;
        blobOpts.oidcToken = process.env.VERCEL_OIDC_TOKEN;
    }

    return blobOpts;
}

function createBlobUploadOptions() {
    return {
        ...createBlobOptions(),
        addRandomSuffix: true,
    };
}

function getRequestBaseUrl(req) {
    const forwardedProto = req.get('x-forwarded-proto');
    const protocol = forwardedProto ? forwardedProto.split(',')[0] : req.protocol;
    return `${protocol}://${req.get('host')}`;
}

function withTransactionImageUrl(req, transaction) {
    return {
        ...transaction,
        imageId: transaction.imageId ? String(transaction.id) : null,
        imageUrl: transaction.imageId ? `${getRequestBaseUrl(req)}/transaction/image/${transaction.id}` : null,
    };
}

async function streamTransactionImage(req, res, transaction) {
    if (!transaction || !transaction.imageId) {
        return res.status(404).json({ error: 'Gambar transaksi tidak ditemukan' });
    }

    const blob = await get(transaction.imageId, {
        ...createBlobOptions(),
        ifNoneMatch: req.header('if-none-match'),
    });

    if (!blob) return res.status(404).json({ error: 'Gambar transaksi tidak ditemukan' });
    if (blob.statusCode === 304) return res.status(304).end();

    res.setHeader('Content-Type', blob.blob.contentType);
    res.setHeader('Content-Length', blob.blob.size);
    res.setHeader('Cache-Control', blob.blob.cacheControl);
    res.setHeader('ETag', blob.blob.etag);

    return Readable.fromWeb(blob.stream).pipe(res);
}

async function streamTransactionImageByBlobUrl(req, res, rawImageId) {
    const imageId = rawImageId.startsWith('https:/') && !rawImageId.startsWith('https://')
        ? rawImageId.replace(/^https:\//, 'https://')
        : rawImageId;

    const transaction = await prisma.transaction.findFirst({
        where: { imageId },
        select: { imageId: true },
    });

    return streamTransactionImage(req, res, transaction);
}

app.get('/', (req, res) => {
    // Arahkan root ke dokumentasi statis
    res.redirect('/docs');
});

app.get('/categories', async (req, res) => {
    const userEmail = getUserEmailFromRequest(req);

    try {
        const categories = await prisma.category.findMany({
            where: userEmail ? { userEmail } : undefined,
            orderBy: { name: 'asc' },
        });
        res.json(categories);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal mengambil kategori' });
    }
});

app.post('/categories', async (req, res) => {
    const { name } = req.body;
    const userEmail = getUserEmailFromRequest(req);
    if (!name) return res.status(400).json({ error: 'name harus diisi' });
    if (!userEmail) return res.status(400).json({ error: 'userEmail harus diisi' });

    try {
        const category = await prisma.category.create({
            data: {
                name,
                userEmail,
            },
        });
        res.status(201).json(category);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal membuat kategori' });
    }
});

app.get('/users', async (req, res) => {
    try {
        const users = await prisma.user.findMany();
        res.json(users);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal mengambil pengguna' });
    }
});

app.post('/users', async (req, res) => {
    const { name, email, photoUrl } = req.body;
    if (!email) return res.status(400).json({ error: 'email harus diisi' });

    try {
        const user = await prisma.user.upsert({
            where: { email },
            update: { name, photoUrl },
            create: { name, email, photoUrl },
        });
        res.status(201).json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal membuat user' });
    }
});

app.get('/transactions', async (req, res) => {
    const auth = req.header('Authorization');
    let filter = {};

    try {
        if (auth) {
            const user = await resolveUserFromAuth(auth);
            if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
            filter = { userId: user.id };
        }

        const transactions = await prisma.transaction.findMany({
            where: filter,
            include: {
                category: true,
                user: true,
            },
            orderBy: { date: 'desc' },
        });

        res.json(transactions.map((transaction) => withTransactionImageUrl(req, transaction)));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal mengambil transaksi' });
    }
});

app.get('/transactions/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const transaction = await prisma.transaction.findUnique({
            where: { id: Number(id) },
            include: { category: true, user: true },
        });
        if (!transaction) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
        res.json(withTransactionImageUrl(req, transaction));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal mengambil transaksi' });
    }
});

app.get('/transaction/image/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const transaction = await prisma.transaction.findUnique({
            where: { id: Number(id) },
            select: { imageId: true },
        });

        return streamTransactionImage(req, res, transaction);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Gagal mengambil gambar transaksi' });
    }
});

app.get('/transaction/image/*', async (req, res) => {
    try {
        return streamTransactionImageByBlobUrl(req, res, req.params[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Gagal mengambil gambar transaksi' });
    }
});

app.get('/transactions/image/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const transaction = await prisma.transaction.findUnique({
            where: { id: Number(id) },
            select: { imageId: true },
        });

        return streamTransactionImage(req, res, transaction);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Gagal mengambil gambar transaksi' });
    }
});

app.get('/transactions/image/*', async (req, res) => {
    try {
        return streamTransactionImageByBlobUrl(req, res, req.params[0]);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Gagal mengambil gambar transaksi' });
    }
});

app.get('/transactions/:id/image', async (req, res) => {
    const auth = req.header('Authorization');
    const { id } = req.params;

    if (!auth) return res.status(401).json({ error: 'Authorization header wajib diisi' });

    try {
        const user = await resolveUserFromAuth(auth);
        if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });

        const transaction = await prisma.transaction.findFirst({
            where: {
                id: Number(id),
                userId: user.id,
            },
            select: { imageId: true },
        });

        if (!transaction || !transaction.imageId) {
            return res.status(404).json({ error: 'Gambar transaksi tidak ditemukan' });
        }

        return streamTransactionImage(req, res, transaction);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal mengambil gambar transaksi' });
    }
});

app.post('/transactions', upload.single('image'), async (req, res) => {
    const auth = req.header('Authorization');
    const { title, categoryId, amount, type, date, imageId } = req.body;
    const file = req.file;

    if (!auth) return res.status(401).json({ error: 'Authorization header wajib diisi' });
    if (!title || !categoryId || !amount || !type || !date) {
        return res.status(400).json({ error: 'title, categoryId, amount, type, dan date wajib diisi' });
    }

    try {
        const user = await resolveUserFromAuth(auth);
        if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });

        let savedImageId = imageId ?? null;

        if (file) {
            const blob = await put(file.originalname, file.buffer, createBlobUploadOptions());
            savedImageId = blob.url;
        }

        const transaction = await prisma.transaction.create({
            data: {
                title,
                amount: Number(amount),
                type,
                date,
                imageId: savedImageId,
                categoryId: Number(categoryId),
                userId: user.id,
            },
            include: {
                category: true,
                user: true,
            },
        });

        res.status(201).json(withTransactionImageUrl(req, transaction));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal membuat transaksi' });
    }
});

// Tambahkan di app.js
app.put('/transactions/:id', upload.single('image'), async (req, res) => {
    const { id } = req.params;
    const auth = req.header('Authorization')
    const {
        title,
        categoryId,
        amount,
        type
    } = req.body;
    const file = req.file;
    if (!auth) {
        return res.status(401).json({
            error: "Authorization header wajib diisi"
        });
    }
    try {
        const user = await resolveUserFromAuth(auth);
        if (!user) {
            return res.status(401).json({
                error: "User tidak ditemukan"
            });
        }
        let updateData = {
            title,
            amount: Number(amount),
            type,
            categoryId: Number(categoryId)
        };
        // jika upload gambar baru
        if (file) {
            const blob = await put(file.originalname, file.buffer, createBlobUploadOptions());
            updateData.imageId = blob.url;
        }
        const transaction =
            await prisma.transaction.update({
                where: {
                    id: Number(id)
                },
                data: updateData,
                include: {
                    category: true,
                    user: true
                }
            });
        res.json(
            withTransactionImageUrl(
                req,
                transaction
            )
        );
    } catch (error) {
        console.error(error);
        res.status(500).json({

            error: "Gagal update transaksi"
        });
    }
});

app.delete('/transactions/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.transaction.delete({ where: { id: Number(id) } });
        res.json({ message: 'Berhasil dihapus' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});


app.put('/categories/:id', async (req,res)=>{
    const id = Number(req.params.id);
    const {name} = req.body;
    const userEmail = getUserEmailFromRequest(req);
    try {
        const existing =
        await prisma.category.findFirst({
            where:{
                id:id,
                ...(userEmail ? { userEmail } : {})
            }
        });
        if(!existing){
            return res.status(404).json({
                error:"Kategori tidak ditemukan"
            });

        }
        const category =
        await prisma.category.update({
            where:{
                id:id
            },
            data:{
                ...(typeof name !== 'undefined' ? { name: name } : {}),
                ...(userEmail ? { userEmail: userEmail } : {})
            }
        });
        res.json(category);
    }catch(error){
        console.error(error);
        res.status(500).json({
            error:"Gagal update kategori"
        });
    }
});

    app.delete('/categories/:id', async (req, res) => {
    const id = Number(req.params.id);
    const userEmail = getUserEmailFromRequest(req);
    try {
        const category = await prisma.category.findFirst({
            where: {
                id: id,
                ...(userEmail ? { userEmail } : {})
            }
        });
        if (!category) {
            return res.status(404).json({
                error: "Kategori tidak ditemukan"
            });
        }
        await prisma.category.delete({
            where: {
                id: category.id
            }
        });
        res.json({
            message: "Kategori berhasil dihapus"
        });
    } catch (error) {
        console.error(error);
        // jika kategori masih digunakan transaksi
        if (error.code === "P2003") {
            
            return res.status(400).json({
                error: "Kategori masih digunakan oleh transaksi"
            });
            
        }
        res.status(500).json({
            error: "Gagal menghapus kategori"
        });
    }
});

app.use((req, res) => {
    res.status(404).json({ error: 'Rute tidak ditemukan' });
});

module.exports = app;
