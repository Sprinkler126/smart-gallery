# PhotoWall 路径前缀迁移说明

## 变更摘要

已将 PhotoWall 从根域名 `https://sprinkler10.xyz` 迁移到子路径 `https://sprinkler10.xyz/photowall`。

这样可以让根域名 `sprinkler10.xyz` 用于其他项目，而 PhotoWall 通过 `/photowall` 后缀访问。

---

## 修改的文件

### 1. 前端配置
- **`vite.config.ts`**
  - 添加 `base: '/photowall/'`
  - 更新代理规则，将 `/photowall/api` 和 `/photowall/socket.io` 代理到后端

### 2. 后端服务器
- **`server/index.js`**
  - API 路由改为 `/photowall/api`
  - 静态文件服务改为 `/photowall`
  - WebSocket path 改为 `/photowall/socket.io`
  - 图片 URL 返回 `/photowall/api/...` 格式

### 3. API 路由
- **`server/routes/api.js`**
  - 所有图片 URL 添加 `/photowall` 前缀
  - BGM 音乐 URL 添加 `/photowall` 前缀

### 4. 前端代码
- **`services/galleryApi.ts`**
  - API_BASE 改为 `/photowall/api`

- **`services/socketService.ts`**
  - WebSocket path 改为 `/photowall/socket.io`

- **`App.tsx`**
  - `/api/reset` 改为 `/photowall/api/reset`

- **`components/AIAnalysisPanel.tsx`**
  - 所有 `/api/...` 改为 `/photowall/api/...`

- **`components/Slideshow.tsx`**
  - `/api/orientations` 改为 `/photowall/api/orientations`
  - `/api/bgm/list` 改为 `/photowall/api/bgm/list`

### 5. Cloudflare Tunnel 配置
- **`~/.cloudflared/config.yml`**
  - 添加 `path: /photowall` 规则
  - 只有 `/photowall` 路径的请求会被转发到 PhotoWall 服务

---

## 访问地址

| 环境 | 地址 |
|------|------|
| 本地开发 | http://localhost:3000/photowall |
| 本地生产 | http://localhost:3001/photowall |
| 公网访问 | https://sprinkler10.xyz/photowall |

---

## 启动方式

### 开发模式
```bash
cd /Users/sprinkler/openclaw/smart-gallery
npm run dev
```
访问：http://localhost:3000/photowall

### 生产模式
```bash
cd /Users/sprinkler/openclaw/smart-gallery
./start-photowall.sh
```
访问：https://sprinkler10.xyz/photowall

---

## 注意事项

1. **根域名现在空闲**：`https://sprinkler10.xyz` 不再自动跳转到 PhotoWall，可以用于部署其他项目

2. **直接访问旧地址会 404**：访问 `https://sprinkler10.xyz/` 会返回 404，需要加上 `/photowall`

3. **Cloudflare Tunnel 需要重启**：
   ```bash
   cloudflared tunnel run photowall
   ```

4. **构建后的文件**：运行 `npm run build` 后，前端资源会自动包含 `/photowall` 前缀

---

## 回滚方式

如果需要恢复根域名访问，可以：

1. 恢复 `~/.cloudflared/config.yml`：
```yaml
tunnel: photowall
credentials-file: /Users/sprinkler/.cloudflared/e1984090-18ba-4350-812a-1db92a02015c.json

ingress:
  - hostname: sprinkler10.xyz
    service: http://localhost:3001
  - service: http_status:404
```

2. 恢复 `vite.config.ts` 中的 `base: '/photowall/'` 为 `base: '/'`

3. 恢复 `server/index.js` 中的路径前缀

---

## 验证清单

- [ ] 访问 https://sprinkler10.xyz/photowall 能看到照片墙
- [ ] 照片能正常加载
- [ ] 幻灯片功能正常
- [ ] AI 分析功能正常
- [ ] WebSocket 实时更新正常
- [ ] 管理面板功能正常

---

*迁移日期：2026-03-29*
