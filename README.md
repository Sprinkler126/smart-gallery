# 📸 Smart Gallery - AI-Powered Photo Gallery

> A beautiful, intelligent photo gallery for photographers. Built with React, TypeScript, and Node.js.
>
> **Formerly PhotoWall** - Migrated and rebranded for enhanced features and security.

![Tech Stack](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss)

---

## ✨ Features

### 🎨 Gallery Display
- **🖼️ Multiple Views**: Masonry, Grid, and Timeline layouts
- **🎬 Slideshow Mode**: Ken Burns, Page Flip, and Crossfade transitions
- **🎵 Background Music**: Auto-play BGM with sync to slideshow
- **📱 Responsive Design**: Perfect on desktop, tablet, and mobile

### 🤖 AI-Powered Analysis
- **🏷️ Smart Tagging**: Automatic photo tagging using multimodal LLM
- **📊 Quality Scoring**: AI evaluates technical and aesthetic quality
- **🔍 Semantic Search**: Search photos with natural language
- **📈 Statistics**: View popular tags and category distribution

### 🛡️ Content Protection
- **🚫 Right-click Protection**: Disable image saving
- **🚫 Drag Protection**: Prevent image dragging
- **🚫 Keyboard Shortcuts**: Block Ctrl+S / Cmd+S
- **💧 Watermark**: Optional copyright overlay

### 🔧 Management
- **📁 Multi-source Support**: Local folders, NAS, external drives
- **⚡ Real-time Updates**: WebSocket live sync
- **🖼️ Auto Thumbnails**: Sharp-powered thumbnail generation
- **📊 EXIF Metadata**: Camera info, GPS, date extraction

---

## 🚀 Quick Start

### Prerequisites
- 🟢 Node.js 18+
- 📦 npm or yarn

### Installation

```bash
# 📥 Clone and install
git clone https://github.com/Sprinkler126/smart-gallery.git
cd smart-gallery
npm install

# ▶️ Start the server
npm start

# 🛠️ Or development mode (with hot reload)
npm run dev
```

### 🌐 Access

| Environment | URL |
|-------------|-----|
| 🏭 Production | http://localhost:3001 |
| 🔧 Development | http://localhost:3000 |
| 🌍 Deployed | https://sprinkler10.xyz |

---

## 🛠️ Tech Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| ⚛️ **React 19** | UI framework with hooks |
| 📘 **TypeScript** | Type-safe development |
| ⚡ **Vite 6** | Fast build tool & dev server |
| 🎨 **Tailwind CSS 4** | Utility-first styling |
| 🔌 **Socket.IO Client** | Real-time WebSocket |
| 🎯 **Lucide React** | Beautiful icons |

### Backend
| Technology | Purpose |
|------------|---------|
| 🟢 **Node.js** | Runtime environment |
| 🚂 **Express.js** | Web framework |
| 🔌 **Socket.IO** | WebSocket server |
| 🖼️ **Sharp** | High-performance image processing |
| 📸 **ExifReader** | EXIF metadata extraction |
| 🗂️ **Chokidar** | File watching |

### AI Integration
| Service | Purpose |
|---------|---------|
| 🧠 **Multimodal LLM** | Image analysis (Qwen/Claude) |
| 🔍 **Vector Search** | Semantic photo search |
| 💾 **Local Caching** | AI results stored locally |

---

## ⚙️ Configuration

Edit `server/config.json`:

```json
{
  "appName": "SPRINKLER",
  "photographerName": "Your Name",
  "server": {
    "port": 3001,
    "host": "0.0.0.0"
  },
  "imageSources": [
    {
      "id": "local-photos",
      "name": "📁 Local Photos",
      "type": "local",
      "path": "./public/photos",
      "enabled": true,
      "useFolderAsCategory": true,
      "watch": true
    }
  ],
  "thumbnails": {
    "width": 800,
    "quality": 80,
    "format": "jpeg"
  },
  "enableAutoAnalysis": true
}
```

---

## 🎮 Slideshow Controls

| Key | Action |
|-----|--------|
| ␣ **Space** | Play / Pause |
| ← **Arrow Left** | Previous photo |
| → **Arrow Right** | Next photo |
| **T** | Toggle transition effect |
| **R** | Toggle random / sequential order |
| **M** | Toggle music mute |
| **S** | Open settings |
| **F** | Fullscreen |
| **ESC** | Exit / Close |

---

## 🌟 Key Features Explained

### 🎬 Slideshow Transitions

| Effect | Description |
|--------|-------------|
| ✨ **Crossfade** | Smooth fade between photos |
| 🎥 **Ken Burns** | Subtle pan and zoom (4-6%) |
| 📖 **Page Flip** | 3D book-like page turning |
| 🎵 **BGM Sync** | Music pauses/resumes with slideshow |

### 🤖 AI Analysis

```javascript
// AI analyzes each photo for:
{
  "tags": ["sunset", "ocean", "silhouette"],
  "category": "Nature",
  "description": "Golden sunset over calm ocean...",
  "quality": { "score": 8, "issues": [] },
  "aesthetic": { "score": 9, "strengths": ["composition", "color"] }
}
```

### 🔍 Semantic Search

Search naturally:
- "🌅 sunset photos"
- "🏔️ mountains with snow"
- "👨‍👩‍👧 family portraits"

---

## 📁 Project Structure

```
PhotoWall/
├── 📂 server/                 # 🟢 Backend
│   ├── 📄 index.js           # Express entry
│   ├── 📄 config.json        # ⚙️ Configuration
│   ├── 📂 routes/
│   │   └── 📄 api.js         # 🛣️ API endpoints
│   ├── 📂 services/
│   │   ├── 📄 aiAnalysisService.js   # 🤖 AI analysis
│   │   ├── 📄 galleryService.js      # 📊 Gallery logic
│   │   ├── 📄 imageProcessor.js      # 🖼️ Image processing
│   │   └── 📄 vectorSearchService.js # 🔍 Semantic search
│   └── 📂 cache/             # 💾 Thumbnails & AI cache
│       ├── 📂 thumbnails/
│       ├── 📂 analysis/
│       └── 📂 vectors/
├── 📂 components/            # ⚛️ React components
│   ├── 📄 Slideshow.tsx      # 🎬 Slideshow with effects
│   ├── 📄 Lightbox.tsx       # 🔍 Image viewer
│   ├── 📄 AIAnalysisPanel.tsx # 🤖 AI stats panel
│   ├── 📄 AdminPanel.tsx     # ⚙️ Settings UI
│   └── 📄 ProtectedImage.tsx # 🛡️ Protected image
├── 📂 hooks/
│   └── 📄 useGallery.ts      # 🎣 Gallery state hook
├── 📄 App.tsx               # 🏠 Main app
├── 📄 index.html            # 📄 HTML template
└── 📄 package.json          # 📦 Dependencies
```

---

## 🚀 Deployment

### Build for Production

```bash
# 🏗️ Build frontend
npm run build

# ▶️ Start production server
npm start
```

### Cloudflare Tunnel (Recommended)

```bash
# 🌐 Expose local server to internet
cloudflared tunnel run photowall
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3001 |
| `AI_API_ENDPOINT` | AI service URL | - |
| `AI_API_KEY` | AI service key | - |

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| 🖼️ Images not loading | Check path permissions & formats |
| 🎞️ Thumbnails failing | Verify Sharp installation |
| 🔌 WebSocket errors | Check CORS configuration |
| 🤖 AI not working | Verify API key and endpoint |

---

## 📝 License

MIT © [Sprinkler](https://github.com/Sprinkler126)

---

## 🔄 Migration Note

This project was formerly known as **PhotoWall**. It has been migrated to **smart-gallery** with:
- ✅ New private repository for enhanced security
- ✅ Updated branding and documentation
- ✅ All features preserved and improved

---

## 🙏 Credits

- 🎨 UI inspired by minimal photography portfolios
- 🖼️ Image processing powered by [Sharp](https://sharp.pixelplumbing.com/)
- 🔌 Real-time sync via [Socket.IO](https://socket.io/)
- 🎨 Styling with [Tailwind CSS](https://tailwindcss.com/)

---

> 📸 **Happy Photography!** Built with ❤️ for photographers who love their craft.
