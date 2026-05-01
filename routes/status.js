import express from 'express';
import fs from 'fs';

const router = express.Router();

// The website polls this after successful pairing to check if the session is ready

router.get('/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    // Basic sanity check — prevent path traversal
    if (!sessionId || !/^[\w\-]+$/.test(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID format.' });
    }

    const resultPath = `./sessions/result_${sessionId}.json`;

    // Result file exists — scan was successful
    if (fs.existsSync(resultPath)) {
        try {
            const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
            return res.json({
                status: 'success',
                createdAt: result.createdAt,
                message: 'Check your WhatsApp for your Session ID.'
            });
        } catch (e) {
            console.error('[STATUS] Read error:', e.message);
            return res.status(500).json({ error: 'Failed to read session result.' });
        }
    }

    // Session directory still exists — still waiting for scan
    const sessionDir = `./sessions/qr_${sessionId}`;
    if (fs.existsSync(sessionDir)) {
        return res.json({ status: 'pending' });
    }

    // Neither exists — expired or invalid
    return res.json({ status: 'expired' });
});

export default router;
