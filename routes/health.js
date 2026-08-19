import express from 'express';
import fs from 'fs';
import os from 'os';

const router = express.Router();

// ── Server boot time — persists for the lifetime of the process ───────────────
const BOOT_TIME = Date.now();

/**
 * GET /health
 *
 * Designed for the frontend's wake-detection strategy.
 * The frontend pings this immediately on page load — before the user
 * has interacted with anything. If Render was sleeping, this request
 * is what wakes it. By the time the user submits their number or
 * requests a QR code, the server is already warm.
 *
 * Response shape:
 * {
 *   status:   'ok',
 *   uptime:   <seconds since process start>,
 *   sessions: { active: <n> },
 *   ts:       <epoch ms>     ← lets the frontend measure round-trip latency
 * }
 *
 * The frontend uses:
 *   - Any response at all    → server is awake, proceed normally
 *   - No response yet        → server is waking, show patient loading messages
 *   - uptime < 30            → server just cold-started, warn of slower first request
 *
 * External monitors (cron-job.org, UptimeRobot, Render health checks)
 * can point at this endpoint. A non-200 or no response means the
 * process is down, not just sleeping.
 */
router.get('/', (req, res) => {
    // Count active sessions — any session directory in ./sessions/ that exists
    let activeSessions = 0;
    try {
        const sessionsDir = './sessions';
        if (fs.existsSync(sessionsDir)) {
            activeSessions = fs.readdirSync(sessionsDir)
                .filter(f => f.startsWith('qr_') || f.startsWith('pair_'))
                .length;
        }
    } catch {
        // Non-fatal — session count is informational only
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
