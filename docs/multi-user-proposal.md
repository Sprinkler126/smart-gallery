# SmartGallery 多用户支持方案草案

## 需求概述
- 支持不同用户通过不同链接访问各自的照片墙
- 无需注册功能
- 支持图片上传
- 用户访问 `https://sprinkler10.xyz/photowall/u/{username}` 即进入自己的照片墙

---

## 技术方案

### 1. URL 设计
| 路径 | 说明 |
|------|------|
| `/photowall/u/alice` | Alice 的照片墙 |
| `/photowall/u/bob` | Bob 的照片墙 |
| `/photowall/u/{username}/upload` | 上传页面（可选） |

### 2. 目录结构
```
server/
├── users/                          # 用户数据根目录
│   ├── default/                    # 默认用户（兼容现有数据）
│   │   ├── images/                 # 原始图片
│   │   ├── cache/                  # 缩略图缓存
│   │   ├── ai-cache/               # AI 分析缓存
│   │   └── config.json             # 用户配置
│   └── {username}/                 # 其他用户
│       ├── images/
│       ├── cache/
│       ├── ai-cache/
│       └── config.json
├── index.js                        # 入口（需修改）
├── routes/
│   ├── api.js                      # API 路由（需修改）
│   └── upload.js                   # 新增：上传路由
└── services/
    ├── galleryService.js           # 需修改：支持多用户
    └── userService.js              # 新增：用户管理
```

### 3. API 变更

#### 路径前缀变更
所有 API 增加 `/:username` 前缀：

| 原路径 | 新路径 |
|--------|--------|
| `/photowall/api/photos` | `/photowall/api/:username/photos` |
| `/photowall/api/photos/:id` | `/photowall/api/:username/photos/:id` |
| `/photowall/api/image/:id` | `/photowall/api/:username/image/:id` |
| `/photowall/api/thumbnail/:id` | `/photowall/api/:username/thumbnail/:id` |
| `/photowall/api/upload` | `/photowall/api/:username/upload` |

#### 新增接口
```
POST /api/:username/upload
Content-Type: multipart/form-data
Body: { file: File, category?: string }
```

### 4. 前端变更

#### 需修改文件
| 文件 | 修改内容 |
|------|----------|
| `App.tsx` | 从 URL 解析 username，传递给所有 API 调用 |
| `index.tsx` | 路由配置（可选） |
| `constants.ts` | API_BASE_URL 改为动态构建 |
| `vite.config.ts` | 开发代理配置 |

#### 新增组件
| 组件 | 功能 |
|------|------|
| `UploadZone.tsx` | 拖拽上传区域 |
| `UserNav.tsx` | 用户切换导航（可选） |

### 5. 后端变更

#### 需修改文件
| 文件 | 修改内容 |
|------|----------|
| `server/index.js` | 添加用户路由前缀处理、用户目录自动初始化 |
| `server/routes/api.js` | 所有路由加 `/:username` 参数，从 userService 获取用户配置 |
| `server/services/galleryService.js` | 支持按用户隔离的图片扫描、缓存管理 |
| `server/config.json` | 添加 `usersDir` 配置项 |

#### 新增文件
| 文件 | 功能 |
|------|------|
| `server/services/userService.js` | 用户目录创建、配置读写、用户列表管理 |
| `server/routes/upload.js` | 文件上传处理（multer）、图片格式验证 |

### 6. 依赖新增
```json
{
  "multer": "^2.x",        // 文件上传
  "uuid": "^9.x"           // 生成唯一文件名（可选）
}
```

### 7. 配置项
```json
// server/config.json 新增
{
  "usersDir": "./server/users",
  "defaultUser": "default",
  "upload": {
    "maxFileSize": 50 * 1024 * 1024,  // 50MB
    "allowedFormats": [".jpg", ".jpeg", ".png", ".webp"]
  }
}
```

---

## 实现步骤

1. **Phase 1: 后端改造**
   - [ ] 创建 `userService.js`
   - [ ] 修改 `galleryService.js` 支持多用户
   - [ ] 修改 `api.js` 路由
   - [ ] 创建 `upload.js` 路由
   - [ ] 修改 `index.js` 入口

2. **Phase 2: 前端改造**
   - [ ] 修改 `constants.ts` 动态 API 路径
   - [ ] 修改 `App.tsx` 读取 URL username
   - [ ] 创建 `UploadZone.tsx` 组件
   - [ ] 测试所有功能

3. **Phase 3: 数据迁移**
   - [ ] 将现有数据移动到 `users/default/`
   - [ ] 验证默认用户正常工作

---

## 注意事项

1. **向后兼容**：现有数据可放在 `users/default/`，无需迁移即可运行
2. **安全性**：上传需验证文件类型，防止恶意文件
3. **性能**：每个用户独立缓存，避免互相影响
4. **扩展性**：后续可加用户密码、配额限制等功能

---

## 预估工作量

- 后端改造：2-3 小时
- 前端改造：1-2 小时
- 测试调试：1 小时
- **总计：4-6 小时**

---

*创建时间：2026-04-09*
*状态：草案，待实施*
