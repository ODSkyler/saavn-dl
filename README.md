# saavn-dl

A modern JioSaavn songs & albums downloader and with ffmpeg powered metadata embedding.

Built with React, Vite and TypeScript.  
Designed with a premium glassmorphism-inspired UI.

---
## Preview

### Home
![saavn-dl Home](./assets/home.png)
### Track

![saavn-dl Track view](./assets/track.png)

### Search
![saavn-dl Track search](./assets/search.png)

### Album search
![saavn-dl Album search](./assets/albumSearch.png)

### Album
![saavn-dl Album view](./assets/album.png)

### Download Menu
![saavn-dl Download menu](./assets/downloadMenu.png)

### Metadata Editor
![saavn-dl Metadata editor](./assets/metadataEditor.png)
---

## Features

- 🔗 Paste any JioSaavn song/album URL or just search by track/album name
- 🎵 Built-in audio preview player
- 🎚️ Quality selector up to 320 kbps
- 🗃️ Built-in metadata editor
- ⬇️ Download tracks & albums with embedded metadata
- ⚡ Direct download fallback if ffmpeg fails

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

## Download Modes

| Mode | Description |
|------|-------------|
| ⚡ Fast | Direct download without metadata embedding |
| ✨ Enhanced | Downloads audio and embeds metadata using ffmpeg.wasm |
| 💿 Individual Files (Album) | Downloads all tracks as individual files |
| 📁 Zip File (Album) | Downloads all track and stores them in a zip archive |


---
## Host your own JioSaavn API

- To host your own JioSaavn API, check out https://github.com/ODSkyler/jiosaavn-api
- To host your own saavn-dl API, check out https://github.com/ODSkyler/saavn-dl-api

---

## ❤️ Support

If saavn-dl has been useful to you and you'd like to help cover hosting and development costs, you can support the project via Ko-fi.

<p align="center">
  <a href="https://ko-fi.com/odskyler">
    <img src="https://storage.ko-fi.com/cdn/kofi5.png?v=3" alt="Support me on Ko-fi" width="220">
  </a>
</p>

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

---

<p align="center">
  <a href="https://fmhy.net/audio#audio-ripping-sites">
    <img src="./assets/fmhy.png" alt="As Seen on FMHY" height="50">
  </a>
</p>

---