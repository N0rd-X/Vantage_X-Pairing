import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

import pairRouter from './routes/pair.js';
import qrRouter from './routes/qr.js';
import statusRouter from './routes/status.js';
import { rateLimiter, pairLimiter } from './middleware/ratelimit.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

// Raise event listener limit for Baileys connections
import('events').then(events => {
    events.EventEmitter.defaultMaxListeners = 500;
});

// ── Middleware ────────────────────────────────────────────────────────────────

// CORS — allow requests from your website
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:5500'];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, Postman)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Global rate limiter — all routes
app.use(rateLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
    res.json({
        service: 'Vantage-X Pairing Server',
        version: '1.0.0',
        status: 'online',
        endpoints: {
            qr: 'GET /qr',
            pair: 'GET /pair?number=XXXXXXXXXXX',
            status: 'GET /status/:sessionId'
        }
    });
});

// Pairing routes — stricter rate limit applied
app.use('/pair', pairLimiter, pairRouter);
app.use('/qr', pairLimiter, qrRouter);
app.use('/status', statusRouter);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    if (err.message.includes('CORS')) {
        return res.status(403).json({ error: 'CORS: Origin not allowed' });
    }
    res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`\n┌─────────────────────────────────────────┐`);
    console.log(`│         Vantage-X Pairing Server       │`);
    console.log(`│─────────────────────────────────────────│`);
    console.log(`│  Status  : Online                        │`);
    console.log(`│  Port    : ${PORT}                           │`);
    console.log(`│  Docs    : http://localhost:${PORT}/         │`);
    console.log(`└─────────────────────────────────────────┘\n`);
});

export default app;
