# saavn-dl

A clean modern frontend for downloading songs from JioSaavn.

Built with React, Vite and TypeScript.  
Designed with a premium glassmorphism-inspired UI.

---
## Preview

### Home
![saavn-dl Home](./assets/home.png)

### Track view

![saavn-dl Track view](./assets/track.png)
---

## Features

- 🔗 Paste any JioSaavn song URL
- 🎵 Built-in audio preview player
- 🔓 Client-side DES ECB decryption
- 🎚️ Quality selector:
  - 12 kbps
  - 48 kbps
  - 96 kbps
  - 160 kbps
  - 320 kbps
- ⬇️ Download with embedded metadata:
  - title
  - artists
  - album
  - year
  - cover art
- ⚡ Direct download fallback if ffmpeg fails
- 🌑 Dark glassmorphism UI
- 📱 Responsive layout
- ✨ Smooth animations via Framer Motion

---

## Stack

- React 18
- Vite
- TypeScript
- TailwindCSS
- Framer Motion
- CryptoJS
- ffmpeg.wasm

---

## Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

---

## ffmpeg.wasm Requirements

`ffmpeg.wasm` requires `SharedArrayBuffer`, which means these headers must be enabled:

```txt
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Vite dev server already sets these automatically.

For production deployments (Cloudflare Pages, Vercel, Nginx, etc.), configure them manually.

---

## Cloudflare Pages (`public/_headers`)

```txt
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

---

## Vercel (`vercel.json`)

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Cross-Origin-Opener-Policy",
          "value": "same-origin"
        },
        {
          "key": "Cross-Origin-Embedder-Policy",
          "value": "require-corp"
        }
      ]
    }
  ]
}
```

---

## Decryption

`src/utils/decrypt.ts`

Uses:
- DES
- ECB mode
- PKCS7 padding

via CryptoJS using key:

```txt
38346591
```

The decrypted media URL is dynamically modified depending on selected quality.

---

## Download Modes

| Mode | Description |
|------|-------------|
| ⚡ Fast | Direct download without metadata embedding |
| ✨ Enhanced | Downloads audio and embeds metadata using ffmpeg.wasm |

---

## Disclaimer

This project is intended for educational and personal use only.

All music content, trademarks, album arts and related assets belong to their respective owners.

This project:
- does not host music
- does not store copyrighted content
- does not distribute media files

Users are responsible for complying with their local copyright laws.

---

## License

This project is licensed under the Mozilla Public License 2.0 (MPL-2.0).

---

## Author

Made with ❤️ by OD Skyler