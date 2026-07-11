import express from 'express';
import fs from 'fs';

const router = express.Router();

router.get('/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    // Prevent path traversal
    if (!sessionId || !/^[\w\-]+$/.test(sessionId)) {
        return res.status(400).json({ error: 'Invalid session ID format.' });
    }

    const resultPath = `./sessions/result_${sessionId}.json`;
    const sessionDir = `./sessions/qr_${sessionId}`;

    // Result file exists — scan completed (success or failure)
    if (fs.existsSync(resultPath)) {
        try {
            const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));

            if (result.success) {
                return res.json({
                    status:    'success',
                    createdAt: result.createdAt,
                    message:   'Check your WhatsApp for your Session ID.'
                });
            } else {
                return res.json({
                    status: 'failed',
                    error:  result.error || 'Session delivery failed. Please try again.'
                });
            }
        } catch (e) {
            console.error('[STATUS] Read error:', e.message);
            return res.status(500).json({ error: 'Failed to read session result.' });
        }
    }

    // Session dir still exists — waiting for scan
    if (fs.existsSync(sessionDir)) {
        return res.json({ status: 'pending' });
    }

    // Nothing found — expired or invalid
    return res.json({ status: 'expired' });
});

export default router;