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

const CLEANUP_DELAY = 12 * 60 * 60 * 1000; // 12 hours

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

function ensureSessionsDir() {
    if (!fs.existsSync('./sessions')) {
        fs.mkdirSync('./sessions', { recursive: true });
    }
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
    const sessionToken = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const sessionDir   = `./sessions/qr_${sessionToken}`;
    const resultPath   = `./sessions/result_${sessionToken}.json`;

    ensureSessionsDir();
    fs.mkdirSync(sessionDir, { recursive: true });

    let responseSent     = false;
    let qrSent           = false;
    let sessionDelivered = false;

    // Timeout — clean up if nothing happens in 90s
    const timeoutHandle = setTimeout(() => {
        if (!responseSent) {
            responseSent = true;
            res.status(408).json({ error: 'QR generation timed out. Please try again.' });
        }
        removeDir(sessionDir);
    }, 90000);

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        try {
            const { version } = await fetchLatestBaileysVersion();
            const logger = pino({ level: 'fatal' });

            const socketConfig = {
                version,
                logger,
                browser: Browsers.windows('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger)
                },
                printQRInTerminal: false,
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
                if (qrSent || responseSent) return;
                qrSent = true;

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
                        clearTimeout(timeoutHandle);
                        console.log(`[QR] Generated: ${sessionToken}`);
                        res.json({
                            success:     true,
                            qr:          qrDataURL,
                            sessionId:   sessionToken,
                            expiresIn:   60,
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
                        clearTimeout(timeoutHandle);
                        res.status(500).json({ error: 'Failed to generate QR code.' });
                    }
                }
            };

            // ── Connection handler ────────────────────────────────────────────

            const handleConnection = async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !qrSent) await handleQR(qr);

                if (connection === 'open') {
                    if (sessionDelivered) return;
                    sessionDelivered = true;

                    console.log(`[QR] Scan successful: ${sessionToken}`);
                    reconnectAttempts = 0;

                    try {
                        await delay(2000);

                        const credsPath = `${sessionDir}/creds.json`;
                        if (!fs.existsSync(credsPath)) {
                            throw new Error('creds.json not found after QR scan');
                        }

                        const credsRaw = fs.readFileSync(credsPath, 'utf8');
                        JSON.parse(credsRaw);

                        const sessionId = 'VANTAGE-X://' + Buffer.from(credsRaw).toString('base64');

                        const meId    = sock.authState.creds.me?.id;
                        const userJid = meId ? jidNormalizedUser(meId) : null;

                        if (userJid) {
                            // Message 1 — instructions
                            await sock.sendMessage(userJid, {
                                text: [
                                    `✅ *VANTAGE-X MD — Session Created*`,
                                    ``,
                                    `Your bot is now paired and ready to deploy.`,
                                    ``,
                                    `📋 *Next steps:*`,
                                    `1. *Copy the Session* in the message below`,
                                    `2. Add it to your .env file as SESSION_ID`,
                                    `3. Run npm start`,
                                    ``,
                                    `🗃️ Repo: https://github.com/N0rd-X/VANTAGE_X-MD`,
                                    `🐛 Issues: https://github.com/Nord-X/VANTAGE_X-MD/issues`,
                                    ``,
                                    `⚠️ *Never share your Session ID with anyone.*`
                                ].join('\n')
                            });

                            // Message 2 — session ID
                            await sock.sendMessage(userJid, {
                                text:    sessionId,
                                footer:  '⚡ POWERED BY VANTAGE-X MD',
                                buttons: [
                                    {
                                        buttonId:   'copy_session',
                                        buttonText: { displayText: '📋 Copy Session' },
                                        type:       1
                                    }
                                ],
                                headerType: 1
                            });

                            console.log(`[QR] Session ID delivered to WhatsApp: ${userJid}`);
                        } else {
                            console.warn('[QR] Could not resolve user JID — session ID not delivered via WhatsApp');
                        }

                        fs.writeFileSync(resultPath, JSON.stringify({
                            success:   true,
                            createdAt: new Date().toISOString()
                        }));

                    } catch (err) {
                        console.error('[QR] Post-connect error:', err.message);
                        fs.writeFileSync(resultPath, JSON.stringify({
                            success: false,
                            error:   err.message
                        }));
                    } finally {
                        sock.ev.removeAllListeners();
                        sock.ws?.close();

                        setTimeout(() => {
                            removeDir(sessionDir);
                            if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);
                            console.log(`[QR] Cleaned up: ${sessionToken}`);
                        }, CLEANUP_DELAY);
                    }
                }

                if (connection === 'close') {
                    const code = lastDisconnect?.error?.output?.statusCode;

                    if (code === 401) {
                        console.log(`[QR] Logged out: ${sessionToken}`);
                        removeDir(sessionDir);
                    } else if ([515, 503].includes(code) && !sessionDelivered) {
                        reconnectAttempts++;
                        if (reconnectAttempts <= maxReconnects) {
                            console.log(`[QR] Reconnecting (${reconnectAttempts}/${maxReconnects})`);
                            setTimeout(() => {
                                sock = makeWASocket(socketConfig);
                                sock.ev.on('connection.update', handleConnection);
                                sock.ev.on('creds.update', saveCreds);
                            }, 2000);
                        } else {
                            console.log(`[QR] Max reconnects reached: ${sessionToken}`);
                            removeDir(sessionDir);
                        }
                    }
                }
            };

            sock.ev.on('connection.update', handleConnection);
            sock.ev.on('creds.update', saveCreds);

        } catch (err) {
            console.error('[QR] Init error:', err.message);
            clearTimeout(timeoutHandle);
            removeDir(sessionDir);
            if (!res.headersSent) {
                res.status(503).json({ error: 'Service unavailable. Please try again.' });
            }
        }
    }

    await initiateSession();
});

export default router;
