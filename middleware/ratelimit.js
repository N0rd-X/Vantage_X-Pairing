import rateLimit from 'express-rate-limit';

// General rate limiter — all routes
export const rateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many requests. Please try again in 15 minutes.'
    }
});

// Strict limiter for pairing endpoints - limits to prevent abuse
export const pairLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many pairing attempts. Please wait before trying again.'
    },
    keyGenerator: (req) => {
        const number = req.query.number || '';
        return `${req.ip}_${number}`;
    }
});
