# 📸 Smart Gallery - AI 智能照片墙

> 一个美观、智能的照片展示应用，专为摄影爱好者打造。使用 React、TypeScript 和 Node.js 构建。

![Tech Stack](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss)

---

## ✨ 功能特性

### 🎨 照片展示
- **🖼️ 多种视图**：瀑布流、网格、时间线三种布局
- **🎬 幻灯片模式**：支持 Ken Burns、翻页、淡入淡出三种切换效果
- **🎵 背景音乐**：幻灯片播放时同步播放 BGM
- **📱 响应式设计**：完美适配桌面、平板和手机

### 🤖 AI 智能分析
- **🏷️ 智能标签**：使用多模态大模型自动为照片打标签
- **📊 质量评分**：AI 评估照片的技术质量和美学质量
- **🔍 语义搜索**：用自然语言搜索照片
- **📈 统计分析**：查看热门标签和分类分布

### 🛡️ 内容保护
- **🚫 禁用右键**：防止图片被保存
- **🚫 禁止拖拽**：防止图片被拖动
- **🚫 快捷键拦截**：拦截 Ctrl+S / Cmd+S 保存快捷键
- **💧 水印支持**：可选的版权水印覆盖

### 🔧 管理功能
- **📁 多源支持**：本地文件夹、NAS、外部硬盘
- **⚡ 实时更新**：WebSocket 实时同步文件变动
- **🖼️ 自动缩略图**：使用 Sharp 生成高质量缩略图
- **📊 EXIF 元数据**：提取相机信息、GPS、拍摄日期

---

## 🚀 快速开始

### 环境要求
- 🟢 Node.js 18+
- 📦 npm 或 yarn

### 安装步骤

```bash
# 📥 克隆并安装
git clone https://github.com/你的用户名/smart-gallery.git
cd smart-gallery
npm install

# ▶️ 启动服务
npm start

# 🛠️ 或开发模式（热重载）
npm run dev
```

### 🌐 访问地址

| 环境 | 地址 |
|------|-----|
| 🏭 生产环境 | http://localhost:3001 |
| 🔧 开发环境 | http://localhost:3000 |
| 🌍 公网部署 | https://你的域名.com |

---

## 🛠️ 技术栈

### 前端
| 技术 | 用途 |
|------|------|
| ⚛️ **React 19** | UI 框架 |
| 📘 **TypeScript** | 类型安全开发 |
| ⚡ **Vite 6** | 快速构建工具 |
| 🎨 **Tailwind CSS 4** | 原子化 CSS |
| 🔌 **Socket.IO Client** | WebSocket 客户端 |
| 🎯 **Lucide React** | 图标库 |

### 后端
| 技术 | 用途 |
|------|------|
| 🟢 **Node.js** | 运行环境 |
| 🚂 **Express.js** | Web 框架 |
| 🔌 **Socket.IO** | WebSocket 服务 |
| 🖼️ **Sharp** | 高性能图片处理 |
| 📸 **ExifReader** | EXIF 元数据提取 |
| ️️ **Chokidar** | 文件监听 |

### AI 集成
| 服务 | 用途 |
|------|------|
| 🧠 **多模态大模型** | 图片分析（通义千问/Claude） |
| 🔍 **向量搜索** | 语义照片搜索 |
| 💾 **本地缓存** | AI 结果本地存储 |

---

## ⚙️ 配置说明

编辑 `server/config.json`：

```json
{
  "appName": "你的应用名称",
  "photographerName": "摄影师名称",
  "server": {
    "port": 3001,
    "host": "0.0.0.0"
  },
  "imageSources": [
    {
      "id": "local-photos",
      "name": "📁 本地照片",
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

## 🎮 幻灯片快捷键

| 按键 | 功能 |
|-----|------|
| ␣ **空格** | 播放 / 暂停 |
| ← **左方向键** | 上一张 |
| → **右方向键** | 下一张 |
| **T** | 切换切换效果 |
| **R** | 切换随机/顺序播放 |
| **M** | 静音/取消静音 |
| **S** | 打开设置 |
| **F** | 全屏 |
| **ESC** | 退出/关闭 |

---

## 🌟 核心功能详解

### 🎬 幻灯片切换效果

| 效果 | 描述 |
|------|------|
| ✨ **淡入淡出** | 平滑的淡入淡出过渡 |
| 🎥 **Ken Burns** | 轻微的平移和缩放（4-6%） |
| 📖 **翻页** | 3D 书本翻页效果 |
| 🎵 **BGM 同步** | 音乐随幻灯片暂停/播放同步控制 |

### 🤖 AI 分析示例

```javascript
// AI 分析每张照片：
{
  "tags": ["日落", "海洋", "剪影"],
  "category": "自然",
  "description": "金色夕阳下的平静海面...",
  "quality": { "score": 8, "issues": [] },
  "aesthetic": { "score": 9, "strengths": ["构图", "色彩"] }
}
```

### 🔍 语义搜索

自然语言搜索：
- "🌅 日落照片"
- "🏔️ 雪山风景"
- "👨‍👩‍👧 家庭合影"

---

## 📁 项目结构

```
smart-gallery/
├── 📂 server/                 # 🟢 后端
│   ├── 📄 index.js           # Express 入口
│   ├── 📄 config.json        # ⚙️ 配置文件
│   ├── 📂 routes/
│   │   └── 📄 api.js         # 🛣️ API 接口
│   ├── 📂 services/
│   │   ├── 📄 aiAnalysisService.js   # 🤖 AI 分析
│   │   ├── 📄 galleryService.js      # 📊 相册逻辑
│   │   ├── 📄 imageProcessor.js      # 🖼️ 图片处理
│   │   └── 📄 vectorSearchService.js # 🔍 语义搜索
│   └── 📂 cache/             # 💾 缩略图和 AI 缓存
│       ├── 📂 thumbnails/
│       ├── 📂 analysis/
│       └── 📂 vectors/
├── 📂 components/            # ⚛️ React 组件
│   ├── 📄 Slideshow.tsx      # 🎬 幻灯片（含特效）
│   ├── 📄 Lightbox.tsx       # 🔍 图片查看器
│   ├── 📄 AIAnalysisPanel.tsx # 🤖 AI 统计面板
│   ├── 📄 AdminPanel.tsx     # ⚙️ 设置界面
│   └── 📄 ProtectedImage.tsx # 🛡️ 受保护图片
├── 📂 hooks/
│   └── 📄 useGallery.ts      # 🎣 Gallery 状态钩子
├── 📄 App.tsx               # 🏠 主应用
├── 📄 index.html            # 📄 HTML 模板
└── 📄 package.json          # 📦 依赖配置
```

---

## 🚀 部署指南

### 生产构建

```bash
# 🏗️ 构建前端
npm run build

# ▶️ 启动生产服务
npm start
```

### Cloudflare Tunnel（推荐）

```bash
# 🌐 将本地服务暴露到公网
cloudflared tunnel run your-tunnel-name
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 3001 |
| `AI_API_ENDPOINT` | AI 服务地址 | - |
| `AI_API_KEY` | AI 服务密钥 | - |

---

## 🐛 常见问题

| 问题 | 解决方案 |
|------|----------|
| 🖼️ 图片无法加载 | 检查路径权限和格式支持 |
| 🎞️ 缩略图生成失败 | 确认 Sharp 安装正确 |
| 🔌 WebSocket 错误 | 检查 CORS 配置 |
| 🤖 AI 无法使用 | 验证 API 密钥和端点地址 |

---

## 📝 开源协议

MIT © [你的用户名](https://github.com/你的用户名)

---

## 🙏 致谢

- 🎨 UI 设计灵感来自极简摄影作品集
- 🖼️ 图片处理由 [Sharp](https://sharp.pixelplumbing.com/) 提供支持
- 🔌 实时同步使用 [Socket.IO](https://socket.io/)
- 🎨 样式基于 [Tailwind CSS](https://tailwindcss.com/)

---

> 📸 **享受摄影的乐趣！** 用 ❤️ 为热爱摄影的人打造。
