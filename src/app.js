const express = require('express');
const multer = require('multer');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
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

app.get('/', (req, res) => {
    // Arahkan root ke dokumentasi statis
    res.redirect('/docs');
});

app.get('/categories', async (req, res) => {
    try {
        const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
        res.json(categories);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal mengambil kategori' });
    }
});

app.post('/categories', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name harus diisi' });

    try {
        const category = await prisma.category.create({ data: { name } });
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

        res.json(transactions);
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
        res.json(transaction);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal mengambil transaksi' });
    }
});

app.get('/transactions/image/:imageId', async (req, res) => {
    const { imageId } = req.params;
    const transaction = await prisma.transaction.findFirst({
        where: { imageId: imageId },
        select: { imageId: true },
    });
    if (!transaction) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    res.json(transaction);
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

        const transaction = await prisma.transaction.create({
            data: {
                title,
                amount: Number(amount),
                type,
                date,
                imageId: file ? `${Date.now()}-${file.originalname}` : imageId ?? null,
                categoryId: Number(categoryId),
                userId: user.id,
            },
            include: {
                category: true,
                user: true,
            },
        });

        res.status(201).json(transaction);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal membuat transaksi' });
    }
});

app.use((req, res) => {
    res.status(404).json({ error: 'Rute tidak ditemukan' });
});

module.exports = app;
