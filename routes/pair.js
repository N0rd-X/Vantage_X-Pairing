import express from 'express';
import fs from 'fs';
import pino from 'pino';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pn from 'awesome-phonenumber';

const router = express.Router();

const CLEANUP_DELAY = 12 * 60 * 60 * 1000; // 12 hours

// ── Helpers ───────────────────────────────────────────────────────────────────

function removeDir(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) return false;
        fs.rmSync(dirPath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('[PAIR] Cleanup error:', e.message);
        return false;
    }
}

function writeResult(resultPath, payload) {
    try {
        fs.writeFileSync(resultPath, JSON.stringify(payload));
    } catch (e) {
        console.error('[PAIR] Failed to write result file:', e.message);
    }
}

function ensureSessionsDir() {
    if (!fs.existsSync('./sessions')) {
        fs.mkdirSync('./sessions', { recursive: true });
    }
}

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /pair?number=XXXXXXXXXXX
 *
 * Returns: { code: "ABCD-EFGH", sessionId }
 *
 * The client polls GET /status/:sessionId to track delivery.
 * The Session ID is delivered via WhatsApp only — never in an API response.
 */
router.get('/', async (req, res) => {
    let num = req.query.number;

    if (!num) {
        return res.status(400).json({
            error: 'Phone number required. Usage: /pair?number=1234567890'
        });
    }

    num = num.replace(/[^0-9]/g, '');

    const phone = pn('+' + num);
    if (!phone.isValid()) {
        return res.status(400).json({
            error: 'Invalid phone number. Use full international format without + or spaces. Example: 12125551234'
        });
    }

    num = phone.getNumber('e164').replace('+', '');

    ensureSessionsDir();

    const sessionToken = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const sessionDir   = `./sessions/qr_${sessionToken}`;
    const resultPath   = `./sessions/result_${sessionToken}.json`;

    removeDir(sessionDir);

    let sessionDelivered = false;

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        try {
            const { version } = await fetchLatestBaileysVersion();
            const logger = pino({ level: 'fatal' });

            const sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger)
                },
                printQRInTerminal: false,
                logger,
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5
            });

            // ── Connection event ──────────────────────────────────────────────

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'open') {
                    if (sessionDelivered) return;
                    sessionDelivered = true;

                    console.log(`[PAIR] Connected: ${sessionToken}`);

                    try {
                        await delay(2000);

                        const credsPath = `${sessionDir}/creds.json`;
                        if (!fs.existsSync(credsPath)) {
                            throw new Error('creds.json not found after connection');
                        }

                        const credsRaw = fs.readFileSync(credsPath, 'utf8');
                        JSON.parse(credsRaw); // Validate JSON before encoding

                        const sessionId = 'VANTAGE-X://' + Buffer.from(credsRaw).toString('base64');
                        const userJid   = jidNormalizedUser(num + '@s.whatsapp.net');

                        // Message 1 — instructions (no session ID here)
                        await sock.sendMessage(userJid, {
                            text: [
                                `✅ *VANTAGE-X MD — Session Created*`,
                                ``,
                                `Your bot is now paired and ready to deploy.`,
                                ``,
                                `📋 *Next steps:*`,
                                `1. Tap *Copy Session* in the next message`,
                                `2. Add it to your .env file as SESSION_ID`,
                                `3. Run npm start`,
                                ``,
                                `📖 Docs: https://nordx.dev/docs`,
                                `🐛 Issues: https://github.com/Nord-X/VANTAGE-X-MD/issues`,
                                ``,
                                `⚠️ *Never share your Session ID with anyone.*`
                            ].join('\n')
                        });

                        // Message 2 — session ID with Copy Session button.
                        // Falls back gracefully to plain text if buttons are filtered
                        // by WhatsApp for personal accounts.
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

                        console.log(`[PAIR] Session ID delivered to WhatsApp: ${sessionToken}`);

                        // Write success result — /status polls for this file
                        writeResult(resultPath, {
                            success:   true,
                            createdAt: new Date().toISOString()
                        });

                    } catch (error) {
                        console.error('[PAIR] Delivery error:', error.message);

                        writeResult(resultPath, {
                            success: false,
                            error:   error.message
                        });
                    } finally {
                        // Close the WebSocket without calling logout() — logout() deregisters
                        // the device on WhatsApp's side and would invalidate the session the
                        // user just received. We just want to drop the connection so their bot
                        // can pick it up cleanly.
                        sock.ev.removeAllListeners();
                        sock.ws?.close();

                        // Keep the session dir and result file for 12 hours so the status
                        // endpoint keeps returning 'connected' and the user has time to deploy.
                        setTimeout(() => {
                            removeDir(sessionDir);
                            try { fs.unlinkSync(resultPath); } catch {}
                            console.log(`[PAIR] Cleaned up: ${sessionToken}`);
                        }, CLEANUP_DELAY);
                    }
                }

                if (connection === 'close') {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    if (code === 401) {
                        console.log(`[PAIR] Logged out: ${sessionToken}`);
                        removeDir(sessionDir);
                    } else if (!sessionDelivered) {
                        console.log(`[PAIR] Connection closed (${code}) — restarting`);
                        initiateSession();
                    }
                }
            });

            // ── Generate pairing code ─────────────────────────────────────────

            if (!sock.authState.creds.registered) {
                await delay(3000);

                try {
                    let code = await sock.requestPairingCode(num);

                    if (!code) throw new Error('Empty code returned from Baileys');

                    code = code.match(/.{1,4}/g)?.join('-') || code;

                    console.log(`[PAIR] Code generated: ${sessionToken}`);

                    if (!res.headersSent) {
                        res.json({ code, sessionId: sessionToken });
                    }
                } catch (error) {
                    console.error('[PAIR] Code error:', error.message);
                    removeDir(sessionDir);
                    if (!res.headersSent) {
                        res.status(503).json({
                            error: 'Failed to generate pairing code. Check your number and try again.'
                        });
                    }
                }
            }

            sock.ev.on('creds.update', saveCreds);

        } catch (err) {
            console.error('[PAIR] Init error:', err.message);
            removeDir(sessionDir);
            if (!res.headersSent) {
                res.status(503).json({ error: 'Service unavailable. Please try again.' });
            }
        }
    }

    await initiateSession();
});

export default router;
