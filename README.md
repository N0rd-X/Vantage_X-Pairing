<h1 align="center">Vantage-X Pairing Server</h1>

<p align="center">
Secure WhatsApp pairing server for Vantage-X MD  
<br/>
Supports QR + pairing code flows • Fully self-hostable
</p>

<p align="center">
<img src="https://img.shields.io/badge/Node.js-20+-green?style=flat-square" />
<img src="https://img.shields.io/badge/Status-Stable-blue?style=flat-square" />
<img src="https://img.shields.io/badge/Security-Session%20Isolated-critical?style=flat-square" />
</p>

---

## Overview

Vantage-X Pairing is a **lightweight session server** for linking WhatsApp devices.

It does one thing well:

> Create a secure pairing session → deliver Session ID directly to WhatsApp

No dashboards. No lock-in. No unnecessary layers.

---

## There are two pairing methods:

- **QR Code method** → scan to connect  
- **Pairing Code method** → manual code entry

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| GET | `/qr` | Create QR session |
| GET | `/pair?number=XXXXXXXXXXX` | Generate pairing code |
| GET | `/status/:sessionId` | Check session status |

---

## Quick Start

### Manual

```bash
git clone https://github.com/N0rd-X/Vantage_X-Pairing
cd Vantage_X-Pairing
npm install
cp .env.example .env   # edit ALLOWED_ORIGINS to match your site
npm start
```

### Docker

```bash
git clone https://github.com/N0rd-X/Vantage_X-pairing
cd Vantage_X-Pairing
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
// code looks like: "ABCD-EFGH"

// 2. User enters code in WhatsApp → Settings → Linked Devices → Link with phone number

// 3. Session ID is delivered directly to the user's WhatsApp — never through the browser
```

> **Why WhatsApp-only session delivery?** The Session ID never touches the browser or API response.
> This means it cannot be intercepted via web traffic. The user receives it
> directly on the device they're pairing — the only place it should ever appear.

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

This repo can be deployed anywhere:

- **Heroku**
- **Hoyeb**
- **Railway**
- **Render**
- *Vercel**
- **VPS**
- **Local(PC)**

`pm2 start index.js --name Vantage_X-Pairing`

---

## Self-Hosting

This server is intentionally kept minimal and self-hostable. Anyone can run their own instance:

1. Fork this repo
2. Deploy anywhere with Node.js 20+
3. Set `ALLOWED_ORIGINS` to your site
4. Point your Vantage-X Pairing website at your server URL

No account required. No vendor lock-in.

---

## Credits

Built on top of [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)

---

## Disclaimer

This project uses unofficial WhatsApp APIs. It is not affiliated with or endorsed by WhatsApp or Meta. Use at your own risk.