# SmartGallery 项目文档

> 最后更新：2026-03-27（晚间优化）
> 维护者：spkleo + sprinkler
> 本文档供所有后续 AI 开发会话参考，请在每次有重大变更时更新本文档。

---

## 一、项目概述

SmartGallery 是一个智能照片墙应用，支持从本地文件夹自动扫描照片，提供多种视图模式（网格、时间线、幻灯片）、AI 图片分析、语义搜索等功能。

**核心价值**：把散落在本地/NAS 的照片变成可浏览、可搜索、可分享的智能相册。

**外网访问**：`https://sprinkler10.xyz`（Cloudflare Tunnel）

---

## 二、技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端框架 | React 18 + TypeScript | SPA |
| 构建工具 | Vite 6.4 | HMR 开发服务器 |
| 后端 | Node.js + Express | REST API + WebSocket |
| 实时通信 | Socket.IO | 文件变动实时通知 |
| AI 分析 | OpenAI 兼容 API | 多模态 LLM 图片分析 |
| 语义搜索 | Vector Search (本地) | 基于 AI 标签的搜索 |
| 外网暴露 | Cloudflare Tunnel | 内网穿透，域名 sprinkler10.xyz |

---

## 三、项目结构

```
smart-gallery/
├── components/                    # React 组件
│   ├── AdminPanel.tsx             # 管理面板（图片源管理、缓存管理）
│   ├── AIAnalysisPanel.tsx        # AI 分析面板（批量分析、搜索、统计）
│   ├── DreamParticles.tsx         # 粒子效果背景（沙粒效果）
│   ├── LazyImage.tsx              # 懒加载图片组件（Intersection Observer）
│   ├── Lightbox.tsx               # 灯箱查看器（放大查看）
│   ├── ProtectedImage.tsx         # 图片保护组件（防右键/拖拽）
│   ├── Slideshow.tsx              # 幻灯片主组件（Phase 1 拆分完成）
│   ├── TimelineView.tsx           # 时间线视图
│   └── slideshow/                 # 幻灯片子组件（Phase 1 新增）
│       ├── PhotoSlide.tsx         # 单张照片展示 + 过渡动画
│       ├── ProgressBar.tsx        # 进度条（useRef + rAF，无重渲染）
│       ├── SettingsPanel.tsx      # 设置面板（memo 隔离）
│       └── SlideControls.tsx      # 控制按钮（memo 隔离）
├── hooks/
│   └── useGallery.ts             # 画廊数据 hook
├── services/                     # 前端服务层
│   ├── galleryApi.ts             # REST API 客户端
│   ├── geminiService.ts          # Gemini AI 服务
│   └── socketService.ts          # WebSocket 客户端
├── server/                       # 后端
│   ├── index.js                  # Express 服务器入口
│   ├── config.json               # 运行时配置（图片源等）
│   ├── routes/
│   │   └── api.js                # API 路由定义
│   ├── services/
│   │   ├── aiAnalysisService.js  # AI 分析服务
│   │   ├── galleryService.js     # 画廊数据服务
│   │   ├── imageProcessor.js     # 图片处理（缩略图、EXIF）
│   │   ├── orientationService.js # 横竖屏检测
│   │   └── vectorSearchService.js # 向量搜索服务
│   └── cache/                    # 缓存目录
│       ├── thumbnails/           # 缩略图缓存
│       └── analysis/             # AI 分析缓存
├── types.ts                      # TypeScript 类型定义
├── constants.ts                  # 常量定义
├── App.tsx                       # 应用入口组件
├── index.tsx                     # React 渲染入口
├── package.json                  # 依赖配置
├── vite.config.ts                # Vite 配置
└── tsconfig.json                 # TypeScript 配置
```

---

## 四、核心功能

### 4.1 多视图模式
- **Grid 视图**：瀑布流/网格展示所有照片
- **Timeline 视图**：按时间分组展示
- **Slideshow 视图**：全屏幻灯片播放

### 4.2 幻灯片系统（Phase 1 已优化）
- **三种切换效果**：Crossfade / Ken Burns / 3D Page Flip
- **随机/顺序播放**：支持预加载播放列表
- **沙粒粒子背景**：DreamParticles v3 — 梦境记忆碎片感 ✅
  - 粒子精确匹配照片 `object-contain` 区域
  - FBM 分形噪声风场，粒子随风摆动
  - 生命周期：飞入构成 → 随风摆动 → 飘散消逝 → 重生
- **背景音乐同步**：暂停续播
- **Orientation 筛选**：All / Landscape / Portrait

### 4.3 AI 分析系统
- **多模态 LLM 分析**：标签、分类、描述、质量/美学评分
- **语义搜索**：自然语言搜索照片
- **统计分析**：热门标签、分类分布
- **API 配置管理**：支持自定义多模态模型

### 4.4 图片管理
- **多图片源管理**：支持本地/NAS/外部驱动器
- **批量选择 + 删除**
- **缩略图缓存管理**
- **HEIF 格式自动跳过**

### 4.5 图片保护
- 禁用右键保存、拖拽、选择
- 禁用 Ctrl+S / Cmd+S
- CSS 层面防护

---

## 五、服务架构

```
用户浏览器
    ↓
Cloudflare Tunnel (sprinkler10.xyz)
    ↓
Vite Dev Server (:3000)  ← 前端 + API 代理
    ↓ proxy /api/* 
Express Backend (:3001)  ← 图片处理 + WebSocket
```

**端口分配**：
- `:3000` - Vite 前端服务器（开发模式）
- `:3001` - Express 后端服务器
- Vite 将 `/api/*` 请求代理到 `:3001`
- Cloudflare Tunnel 指向 `:3000`

**⚠️ 已知问题**：Cloudflare Tunnel 的远程配置缓存指向 `:3001`，需要手动更新 Cloudflare 隧道配置才能正确指向 `:3000`。

---

## 六、启动方式

### 开发环境启动
```bash
# 终端 1：启动前端
cd /Users/sprinkler/openclaw/smart-gallery
npx vite --port 3000

# 终端 2：启动后端
cd /Users/sprinkler/openclaw/smart-gallery
node server/index.js

# 终端 3：启动隧道
cloudflared tunnel run sprinkler-gallery
```

### 生产环境
```bash
cd /Users/sprinkler/openclaw/smart-gallery
npm run build
# 然后部署到服务器
```

---

## 七、性能优化记录

### Phase 1（2026-03-27）✅ 已完成
**目标**：拆分 Slideshow 组件，减少重渲染

**变更**：
1. **ProgressBar.tsx** - 使用 `useRef` + `requestAnimationFrame` 代替 `useState`，消除每 100ms 的 React 重渲染
2. **PhotoSlide.tsx** - `memo` 包裹，隔离照片切换动画
3. **SettingsPanel.tsx** - `memo` 包裹，设置变更不触发其他组件重渲染
4. **SlideControls.tsx** - `memo` 包裹，按钮交互不触发其他组件重渲染
5. **DreamParticles.tsx** - 添加 `memo`，父组件状态变更不触发粒子重绘

**效果**：Slideshow 组件从 250+ 行拆分为 4 个独立子组件，每个 `memo` 包裹，状态变更完全隔离。

**Git 提交**：`491cc8c` - "Phase 1: Split Slideshow into memo'd sub-components"

### DreamParticles v5 + 图片加载优化（2026-03-27 晚间）✅ 已完成
**目标**：性能优化 + 流畅的图片切换体验

**变更**：

**1. DreamParticles v5 - 性能优化**
- `STEP=3`, `MAX_PARTICLES=15000`（降低以提升帧率）
- `FPS=60`（目标 60fps）
- **移除复杂噪声函数**（hash/smoothNoise/fbm），改用简单 sin/cos 伪随机
- **简化动画阶段**：forming/swaying/scattering 计算优化
- **随机采样**：粒子均匀分布，避免只在上部生成

**2. 图片加载 - 真正异步 + 状态驱动**
- **并行加载**：缩略图和原图同时加载，不阻塞
- **三态显示**：
  - 呼吸光晕（缩略图未加载）
  - DreamParticles + 模糊缩略图（缩略图已加载）
  - 高清原图（原图已加载 + 最小显示时间 3s）
- **最小显示时间**：粒子效果最少显示 3 秒，避免来回跳转

**3. 预加载策略优化**
- `PRELOAD_AHEAD=3`（减少数量）
- 优先加载下一张（缩略图高优先级，原图中优先级）
- 后续图片仅预加载缩略图

**Git 提交**：`90caffe` - "✨ 优化粒子效果：均匀分布 + 切换流畅"

### DreamParticles v2（2026-03-27）✅ 已完成（已被 v3 替代）
**变更**（v1 原始版本）：
- `STEP=6`（每 6 像素采样一次）
- `MAX_PARTICLES=8000`
- `FPS=30` 节流
- 缓存渐变色
- 批量颜色渲染

### Phase 2（待规划）
**目标**：
- 基于设备性能动态调整粒子数量
- AbortController 取消图片加载
- 内存清理机制

---

## 八、Git 信息

- **仓库**：`https://github.com/Sprinkler126/smart-gallery.git`
- **分支**：`master`
- **提交规范**：使用 emoji 前缀（🚀 新功能、🔧 修复、⚡ 优化、📝 文档）

### 最近提交
- `90caffe` - ✨ 优化粒子效果：均匀分布 + 切换流畅
- `491cc8c` - Phase 1: Split Slideshow into memo'd sub-components
- 之前：DreamParticles 优化

---

## 九、已知问题

1. **Cloudflare Tunnel 配置**：远程缓存指向 `:3001`，需要更新 Cloudflare 隧道配置
2. **TypeScript 编译**：`constants.ts` 中 `originalUrl` 字段缺失、`services/` 中 `import.meta.env` 未定义——这些是预存问题，不影响运行
3. **HEIF 格式**：已自动跳过，但无提示信息

---

## 十、给后续 AI 的说明

### 读这个文档的原因
这个文档记录了项目的完整架构、历史决策、性能优化记录和已知问题。每次开发新功能前，请先阅读本文档，避免重复造轮子或破坏已有功能。

### 如何更新本文档
1. **新功能**：更新「四、核心功能」和「项目结构」
2. **性能优化**：更新「七、性能优化记录」，添加新的 Phase
3. **Bug 修复**：更新「九、已知问题」
4. **架构变更**：更新「五、服务架构」
5. **每次提交前**：更新「最后更新」日期

### 开发注意事项
- **Slideshow 已拆分**：如需修改幻灯片功能，请先查看 `components/slideshow/` 目录下的子组件
- **性能关键**：DreamParticles 和 ProgressBar 是性能敏感组件，修改前请评估影响
- **类型定义**：Photo 类型在 `types.ts` 中定义，使用 `category` 而非 `folder`
- **图片保护**：如需增加新的保护措施，请在 `ProtectedImage.tsx` 中添加

### 待开发功能
- [ ] 虚拟滚动（Virtual Scrolling）- 大数据量优化
- [ ] PWA 离线访问
- [ ] Docker 容器化
- [ ] 微服务架构设计
- [x] Phase 2 性能优化 - ✅ DreamParticles v5 + 异步加载优化已完成

---

## 十一、联系方式

- **开发者**：spkleo + sprinkler
- **外网访问**：`https://sprinkler10.xyz`
- **GitHub**：`https://github.com/Sprinkler126/smart-gallery.git`

---

*本文档是 SmartGallery 的"说明书"，请妥善维护。*
