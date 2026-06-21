const express = require('express');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/', async (req, res) => {
    res.json({ message: 'REST API Express + Prisma berjalan' });
});

app.get('/posts', async (req, res) => {
    try {
        const posts = await prisma.post.findMany({ orderBy: { createdAt: 'desc' } });
        res.json(posts);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal mengambil daftar post' });
    }
});

app.get('/posts/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const post = await prisma.post.findUnique({ where: { id } });
        if (!post) return res.status(404).json({ error: 'Post tidak ditemukan' });
        res.json(post);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal mengambil post' });
    }
});

app.post('/posts', async (req, res) => {
    const { title, content, published } = req.body;
    if (!title) return res.status(400).json({ error: 'Title harus diisi' });

    try {
        const post = await prisma.post.create({
            data: { title, content, published: published ?? false },
        });
        res.status(201).json(post);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal membuat post' });
    }
});

app.put('/posts/:id', async (req, res) => {
    const { id } = req.params;
    const { title, content, published } = req.body;

    try {
        const updatedPost = await prisma.post.update({
            where: { id },
            data: { title, content, published },
        });
        res.json(updatedPost);
    } catch (error) {
        console.error(error);
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Post tidak ditemukan' });
        }
        res.status(500).json({ error: 'Gagal memperbarui post' });
    }
});

app.delete('/posts/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.post.delete({ where: { id } });
        res.json({ message: 'Post berhasil dihapus' });
    } catch (error) {
        console.error(error);
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'Post tidak ditemukan' });
        }
        res.status(500).json({ error: 'Gagal menghapus post' });
    }
});

app.use((req, res) => {
    res.status(404).json({ error: 'Rute tidak ditemukan' });
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});
