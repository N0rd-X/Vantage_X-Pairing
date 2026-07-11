import rateLimit from 'express-rate-limit';

// General rate limiting for all routes.
export const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many requests. Please try again in 15 minutes.'
    }
});

// Stronger protection for pairing endpoints
export const pairLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 pairing attempts per IP + phone combo per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many pairing attempts. Please wait before trying again.'
    },
    keyGenerator: (req) => {
        // Limit by both requester IP and target phone number
        const number = req.query.number || '';
        return `${req.ip}_${number}`;
    }
});