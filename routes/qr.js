import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    delay
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function removeDir(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) return false;
        fs.rmSync(dirPath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('[QR] Cleanup error:', e.message);
        return false;
    }
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
    const sessionId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const sessionDir = `./sessions/qr_${sessionId}`;

    if (!fs.existsSync('./sessions')) {
        fs.mkdirSync('./sessions', { recursive: true });
    }
    fs.mkdirSync(sessionDir, { recursive: true });

    let responseSent = false;
    let qrGenerated = false;

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        try {
            const { version } = await fetchLatestBaileysVersion();

            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.windows('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: 'fatal' }).child({ level: 'fatal' })
                    )
                },
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5
            };

            let sock = makeWASocket(socketConfig);
            let reconnectAttempts = 0;
            const maxReconnects = 3;

            // ── QR handler ────────────────────────────────────────────────────

            const handleQR = async (qr) => {
                if (qrGenerated || responseSent) return;
                qrGenerated = true;

                try {
                    const qrDataURL = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: 'M',
                        type: 'image/png',
                        quality: 0.92,
                        margin: 2,
                        color: { dark: '#000000', light: '#FFFFFF' }
                    });

                    if (!responseSent) {
                        responseSent = true;
                        console.log(`[QR] Generated: ${sessionId}`);
                        res.json({
                            success: true,
                            qr: qrDataURL,
                            sessionId,
                            expiresIn: 60,
                            instructions: [
                                'Open WhatsApp on your phone',
                                'Go to Settings → Linked Devices',
                                'Tap "Link a Device"',
                                'Scan this QR code'
                            ]
                        });
                    }
                } catch (err) {
                    console.error('[QR] Generation error:', err.message);
                    if (!responseSent) {
                        responseSent = true;
                        res.status(500).json({ error: 'Failed to generate QR code.' });
                    }
                }
            };

            // ── Connection handler ────────────────────────────────────────────

            const handleConnection = async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !qrGenerated) await handleQR(qr);

                if (connection === 'open') {
                    console.log(`[QR] Scan successful: ${sessionId}`);
                    reconnectAttempts = 0;

                    try {
                        await delay(2000);

                        const credsRaw = fs.readFileSync(`${sessionDir}/creds.json`, 'utf8');
                        const encodedSession = 'Vantage_X-MD_' + Buffer.from(credsRaw).toString('base64');

                        // Store completion flag so /status can confirm success
                        // Session ID is NOT stored here — it's delivered via WhatsApp only
                        const resultPath = `./sessions/result_${sessionId}.json`;
                        fs.writeFileSync(resultPath, JSON.stringify({
                            success: true,
                            createdAt: new Date().toISOString()
                        }));

                        // Get the connected user's JID
                        const userJid = sock.authState.creds.me?.id
                            ? jidNormalizedUser(sock.authState.creds.me.id)
                            : null;

                        if (userJid) {
                            await sock.sendMessage(userJid, {
                                text: [
                                    `✅ *Vantage-X — Session Created*`,
                                    ``,
                                    `Your bot is now paired and ready to deploy.`,
                                    ``,
                                    `📋 *Next steps:*`,
                                    `1. Copy your Session ID from the website`,
                                    `2. Add it to your .env file as SESSION_ID`,
                                    `3. Run npm start`,
                                    ``,
                                    `📖 Docs: https://Vantage_X-Prime.dev/docs`,
                                    `🐛 Issues: https://github.com/N0rd-X/Vantage_X-md/issues`,
                                    ``,
                                    `⚠️ *Never share your Session ID with anyone.*`
                                ].join('\n')
                            });
                        }

                        console.log(`[QR] Session stored for pickup: ${sessionId}`);

                    } catch (err) {
                        console.error('[QR] Post-connect error:', err.message);
                    } finally {
                        // Clean up session files after 2 minutes
                        setTimeout(() => {
                            removeDir(sessionDir);
                            const result = `./sessions/result_${sessionId}.json`;
                            if (fs.existsSync(result)) fs.unlinkSync(result);
                            console.log(`[QR] Cleaned up: ${sessionId}`);
                        }, 2 * 60 * 1000);
                    }
                }

                if (connection === 'close') {
                    const code = lastDisconnect?.error?.output?.statusCode;

                    if (code === 401) {
                        console.log(`[QR] Logged out: ${sessionId}`);
                        removeDir(sessionDir);
                    } else if ([515, 503].includes(code)) {
                        reconnectAttempts++;
                        if (reconnectAttempts <= maxReconnects) {
                            console.log(`[QR] Reconnecting (${reconnectAttempts}/${maxReconnects})`);
                            setTimeout(() => {
                                sock = makeWASocket(socketConfig);
                                sock.ev.on('connection.update', handleConnection);
                                sock.ev.on('creds.update', saveCreds);
                            }, 2000);
                        } else {
                            console.log(`[QR] Max reconnects reached: ${sessionId}`);
                            removeDir(sessionDir);
                        }
                    }
                }
            };

            sock.ev.on('connection.update', handleConnection);
            sock.ev.on('creds.update', saveCreds);

            // Timeout — give up after 90 seconds
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).json({ error: 'QR generation timed out. Please try again.' });
                    removeDir(sessionDir);
                }
            }, 90000);

        } catch (err) {
            console.error('[QR] Init error:', err.message);
            removeDir(sessionDir);
            if (!res.headersSent) {
                res.status(503).json({ error: 'Service unavailable. Please try again.' });
            }
        }
    }

    await initiateSession();
});

// ── Exception handler ─────────────────────────────────────────────────────────

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

export default router;
