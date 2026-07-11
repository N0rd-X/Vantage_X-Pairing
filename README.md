# VANTAGE-X — Pairing Server

WhatsApp session pairing server for VANTAGE-X MD. Supports both QR code and pairing code methods.

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check & endpoint list |
| GET | `/qr` | Generate QR code for scanning |
| GET | `/pair?number=XXXXXXXXXXX` | Generate pairing code for phone number |
| GET | `/status/:sessionId` | Poll for QR scan result |

---

## Quick Start

### Manual

```bash
git clone https://github.com/N0rd-X/VANTAGE_X-Pairing
cd VANTAGE_X-Pairing
npm install
cp .env.example .env   # edit ALLOWED_ORIGINS to match your site
npm start
```

### Docker

```bash
git clone https://github.com/N0rd-X/VANTAGE_X-Pairing
cd VANTAGE_X-Pairing
cp .env.example .env   # edit as needed
docker-compose up -d
```

---

## API Usage

### QR Code Flow

```js
// 1. Request QR code
const res = await fetch('https://your-server/qr');
const { qr, sessionId } = await res.json();

// 2. Display the QR image (qr is a base64 data URL)
img.src = qr;

// 3. Poll for scan completion
const poll = setInterval(async () => {
    const status = await fetch(`https://your-server/status/${sessionId}`);
    const { status: state } = await status.json();

    if (state === 'success') {
        clearInterval(poll);
        // Session ID is delivered to the user's WhatsApp — not returned here
        showMessage('Check your WhatsApp for your Session ID!');
    }

    if (state === 'expired') {
        clearInterval(poll);
        showMessage('QR expired — request a new one');
    }
}, 3000);
```

### Pairing Code Flow

```js
// 1. Request pairing code (number in international format, no + or spaces)
const res = await fetch('https://your-server/pair?number=12125551234');
const { code } = await res.json();
// code looks like: "ABC4-EF7H"

// 2. User enters code in WhatsApp → Settings → Linked Devices → Link with phone number

// 3. Session ID is delivered directly to the user's WhatsApp — never through the browser
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | Port to run the server on |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated list of allowed CORS origins |

---

## Rate Limits

| Limit | Value |
|-------|-------|
| General (all routes) | 100 requests / 15 minutes |
| Pairing endpoints | 10 requests / hour per IP |

---

## Deploy

Works out of the box on:

- **Railway** — connect repo, set env vars, deploy
- **Render** — free tier works, set `npm start` as start command
- **Fly.io** — `fly launch` then `fly deploy`
- **VPS** — clone, install, run with PM2: `pm2 start index.js --name VANTAGE_X-Pairing`

---

## Self-Hosting

This server is intentionally kept minimal and self-hostable. Anyone can run their own instance:

1. Fork this repo
2. Deploy anywhere Node.js 20+ runs
3. Set `ALLOWED_ORIGINS` to your site
4. Point your VANTAGE-X MD website at your server URL

---

## Credits

Built on top of [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys).

---

## Disclaimer

This project uses unofficial WhatsApp APIs. It is not affiliated with or endorsed by WhatsApp or Meta. Use at your own risk.