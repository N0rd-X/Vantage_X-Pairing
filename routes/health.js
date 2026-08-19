import express from 'express';
import fs from 'fs';
import os from 'os';

const router = express.Router();

// ── Server boot time — persists for the lifetime of the process ───────────────
const BOOT_TIME = Date.now();

router.get('/', (req, res) => {
    let activeSessions = 0;
    try {
        const sessionsDir = './sessions';
        if (fs.existsSync(sessionsDir)) {
            activeSessions = fs.readdirSync(sessionsDir)
                .filter(f => f.startsWith('qr_') || f.startsWith('pair_'))
                .length;
        }
    } catch {
        // Non-fatal
    }

    const uptimeSecs = Math.floor((Date.now() - BOOT_TIME) / 1000);

    res.json({
        status:   'ok',
        uptime:   uptimeSecs,
        sessions: {
            active: activeSessions
        },
        ts: Date.now()
    });
});

export default router;
