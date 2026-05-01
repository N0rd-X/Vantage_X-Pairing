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

// ── Route ─────────────────────────────────────────────────────────────────────

/**
 * GET /pair?number=XXXXXXXXXXX
 *
 * Returns: { code: "ABCD-EFGH" }
 * On connect: { sessionId: "base64encodedcreds..." }
 */
router.get('/', async (req, res) => {
    let num = req.query.number;

    if (!num) {
        return res.status(400).json({
            error: 'Phone number is required. Usage: /pair?number=1234567890'
        });
    }

    // Strip all non-digit characters
    num = num.replace(/[^0-9]/g, '');

    // Validate phone number
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        return res.status(400).json({
            error: 'Invalid phone number. Provide full international format without + or spaces. Example: 12125551234'
        });
    }

    // Normalise to E.164 without the +
    num = phone.getNumber('e164').replace('+', '');

    const sessionDir = `./sessions/pair_${num}_${Date.now()}`;
    removeDir(sessionDir);

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        try {
            const { version } = await fetchLatestBaileysVersion();

            const sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: 'fatal' }).child({ level: 'fatal' })
                    )
                },
                printQRInTerminal: false,
                logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
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
                    console.log(`[PAIR] Connected: ${num}`);

                    try {
                        await delay(2000);

                        const credsRaw = fs.readFileSync(`${sessionDir}/creds.json`, 'utf8');
                        const sessionId = 'Vantage_X-MD_' + Buffer.from(credsRaw).toString('base64');

                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');

                        // Send welcome message via WhatsApp
                        await sock.sendMessage(userJid, {
                            text: [
                                `✅ *Vantage-X — Session Created*`,
                                ``,
                                `Your bot is now paired and ready to deploy.`,
                                ``,
                                `📋 *Next steps:*`,
                                `1. Open WhatsApp and go to your bot chats to find your session ID message.`,
                                `2. Copy your Session ID from the message (it’s a long string starting with Vantage_X-MD_)`,
                                `3. Add it to your .env file where you see SESSION_ID=, or use it in our conveince dashboard at https://Vantage_X-MD.dev/dashboard`,
                                `4. Run npm start`,
                                ``,
                                `📖 Docs: https://Vantage_X-Prime.dev/docs`,
                                `🐛 Issues: https://github.com/N0rd-X/Vantage_X-md/issues`,
                                ``,
                                `⚠️ *Never share your Session ID with anyone.*`
                            ].join('\n')
                        });

                        // Confirm to the API that pairing completed — no session ID in response
                        if (!res.headersSent) {
                            res.json({
                                success: true,
                                message: 'Session created. Check your WhatsApp for your Session ID.'
                            });
                        }

                        console.log(`[PAIR] Session delivered: ${num}`);

                    } catch (error) {
                        console.error('[PAIR] Delivery error:', error.message);
                        if (!res.headersSent) {
                            res.status(500).json({ error: 'Session created but failed to deliver.' });
                        }
                    } finally {
                        await delay(3000);
                        removeDir(sessionDir);
                    }
                }

                if (connection === 'close') {
                    const code = lastDisconnect?.error?.output?.statusCode;
                    if (code === 401) {
                        console.log(`[PAIR] Logged out: ${num}`);
                        removeDir(sessionDir);
                    } else {
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
                    // Format as XXXX-XXXX
                    code = code?.match(/.{1,4}/g)?.join('-') || code;

                    console.log(`[PAIR] Code generated for ${num}: ${code}`);

                    if (!res.headersSent) {
                        res.json({ code });
                    }
                } catch (error) {
                    console.error('[PAIR] Code generation error:', error.message);
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
