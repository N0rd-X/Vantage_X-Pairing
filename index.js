import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { fileURLToPath } from 'url';
import path from 'path';
import { EventEmitter } from 'events';

import pairRouter from './routes/pair.js';
import qrRouter from './routes/qr.js';
import statusRouter from './routes/status.js';
import { rateLimiter, pairLimiter } from './middleware/ratelimit.js';

EventEmitter.defaultMaxListeners = 500;

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 8000;

// ── Middleware ────────────────────────────────────────────────────────────────

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:5500'];

app.use(cors({
    origin: (origin, callback) => {
        // Allow server-side or tool requests without an origin header.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(rateLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.json({
        service: 'VANTAGE-X MD Pairing Server',
        version: '0.0.2',
        status: 'online',
        endpoints: {
            qr:     'GET /qr',
            pair:   'GET /pair?number=XXXXXXXXXXX',
            status: 'GET /status/:sessionId'
        }
    });
});

app.use('/pair',   pairLimiter, pairRouter);
app.use('/qr',     pairLimiter, qrRouter);
app.use('/status', statusRouter);

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    if (err.message.includes('CORS')) {
        return res.status(403).json({ error: 'CORS: Origin not allowed' });
    }
    res.status(500).json({ error: 'Internal server error' });
});

// ── Global exception handler ──────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
    const msg = String(err);
    const ignored = [
        'conflict', 'not-authorized', 'Socket connection timeout',
        'rate-overlimit', 'Connection Closed', 'Timed Out',
        'Value not found', 'Stream Errored', 'statusCode: 515',
        'statusCode: 503'
    ];
    if (ignored.some(s => msg.includes(s))) return;
    console.error('[UNCAUGHT]', err);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n┌─────────────────────────────────────────┐`);
    console.log(`│       VANTAGE-X MD Pairing Server       │`);
    console.log(`│─────────────────────────────────────────│`);
    console.log(`│  Status  : Online                        │`);
    console.log(`│  Port    : ${PORT}                           │`);
    console.log(`│  Docs    : http://localhost:${PORT}/         │`);
    console.log(`└─────────────────────────────────────────┘\n`);
});

export default app;