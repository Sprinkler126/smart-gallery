# 📸 Smart Gallery

> 一个美观、智能的照片展示应用，专为摄影爱好者打造。

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss)](https://tailwindcss.com)

**在线演示**: https://sprinkler10.xyz

---

## ✨ 功能特性

### 🎨 照片展示
- **多种视图**: 瀑布流、网格、时间线三种布局，自适应横竖屏
- **幻灯片模式**: Ken Burns、翻页、淡入淡出三种切换效果，支持背景音乐同步
- **粒子效果**: 15000 粒子梦幻光晕，60fps 流畅动画
- **响应式设计**: 完美适配桌面、平板和手机

### 🤖 AI 智能
- **智能标签**: 多模态大模型自动分析照片内容
- **语义搜索**: 用自然语言搜索照片（如"日落照片"、"雪山风景"）
- **质量评分**: AI 评估技术质量和美学表现
- **统计分析**: 热门标签、分类分布可视化

### 🛡️ 内容保护
- 禁用右键保存、拖拽、Ctrl+S 快捷键
- 可选水印覆盖

### 🔧 管理功能
- **多源支持**: 本地文件夹、NAS、外部硬盘
- **实时更新**: WebSocket 自动同步文件变动
- **自动缩略图**: Sharp 高性能图片处理
- **EXIF 元数据**: 提取相机信息、GPS、拍摄参数

---

## 🚀 快速开始

### 环境要求
- Node.js 18+
- npm 或 yarn

### 安装运行

```bash
# 克隆项目
git clone https://github.com/yourusername/smart-gallery.git
cd smart-gallery

# 安装依赖
npm install

# 配置照片源
# 编辑 server/config.json，设置 imageSources.path

# 启动服务
npm start

# 或开发模式（热重载）
npm run dev
```

访问 http://localhost:3001

---

## ⚙️ 配置

编辑 `server/config.json`:

```json
{
  "appName": "My Gallery",
  "photographerName": "Your Name",
  "imageSources": [
    {
      "id": "photos",
      "name": "我的照片",
      "type": "local",
      "path": "/path/to/photos",
      "enabled": true,
      "useFolderAsCategory": true
    }
  ],
  "enableAutoAnalysis": true
}
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `AI_API_ENDPOINT` | AI 服务地址 |
| `AI_API_KEY` | AI 服务密钥 |
| `AI_MODEL` | 模型名称（如 qwen-vl-plus） |

---

## 🎮 快捷键

| 按键 | 功能 |
|------|------|
| `Space` | 播放/暂停 |
| `← / →` | 上一张/下一张 |
| `T` | 切换效果 |
| `R` | 随机/顺序播放 |
| `M` | 静音 |
| `F` | 全屏 |
| `ESC` | 退出 |

---

## 🛠️ 技术架构

### 前端工程
| 技术 | 选型理由 |
|------|---------|
| **React 19** | 最新并发特性，自动批处理优化渲染性能 |
| **TypeScript 5** | 全链路类型安全，编译时错误捕获 |
| **Vite 6** | 秒级冷启动，原生 ESM 构建，HMR 极速响应 |
| **Tailwind CSS 4** | 原子化 CSS 引擎，零运行时开销，极致包体积优化 |

### 后端服务
| 技术 | 核心能力 |
|------|---------|
| **Node.js + Express** | 高性能异步 I/O，轻量级微服务架构 |
| **Socket.IO** | 双向实时通信，自动降级兼容，房间级广播 |
| **Sharp** | 基于 libvips 的 GPU 加速图像处理，比 ImageMagick 快 4-10x |
| **Chokidar** | 原生 FSEvents 监听，毫秒级文件变动感知 |

### AI 智能层
| 技术 | 应用场景 |
|------|---------|
| **多模态大模型** | 视觉理解 + 自然语言，端到端图像语义分析 |
| **Universal Sentence Encoder** | Google 开源向量编码，语义相似度计算 |
| **TensorFlow.js** | 浏览器端本地推理，零延迟向量检索 |
| **向量相似度搜索** | 余弦相似度 + 缓存优化，毫秒级语义匹配 |

### 工程化
| 技术 | 价值 |
|------|------|
| **WebGL 粒子系统** | 自定义 Shader，15000 粒子 60fps，GPU 加速渲染 |
| **LRU 缓存策略** | 智能内存管理，图片 + 向量双级缓存 |
| **Cloudflare Tunnel** | 零配置内网穿透，全球 CDN 边缘加速 |

---

## 🚀 部署

### Cloudflare Tunnel（推荐）

```bash
cloudflared tunnel run your-tunnel
```

### 生产构建

```bash
npm run build
npm start
```

---

## 📁 项目结构

```
smart-gallery/
├── server/           # Express 后端
│   ├── services/     # AI分析、图片处理、语义搜索
│   ├── routes/       # API 接口
│   └── config.json   # 配置文件
├── components/       # React 组件
│   ├── Slideshow.tsx # 幻灯片系统
│   ├── DreamParticles.tsx # 粒子效果
│   └── AIAnalysisPanel.tsx # AI 面板
├── hooks/            # 自定义 Hooks
└── services/         # 前端服务
```

---

## 📝 License

MIT © [yourusername](https://github.com/yourusername)

---

> 📸 用 ❤️ 为热爱摄影的人打造
