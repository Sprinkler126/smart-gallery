# 图片上传接口

图片上传复用现有管理员登录，会话由 HttpOnly Cookie 保存。请先在部署机执行：

```bash
npm run auth:init -- --write-env
npm run build
npm start
```

浏览器访问 `/photowall/`，使用密码和 TOTP 动态码登录，打开管理面板即可在手机或电脑上创建分类、批量选择并上传图片。

## API

所有接口都位于 `/photowall/api`，并且要求已登录的管理员会话。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/uploads/categories` | 查询上传分类，包括空分类 |
| `POST` | `/uploads/categories` | 创建分类，JSON 请求体为 `{ "name": "旅行" }` |
| `POST` | `/uploads` | 上传图片，使用 `multipart/form-data` |

上传表单字段：

- `category`：目标分类名称；不存在时自动创建。
- `images`：原始图片文件，可重复，默认一次最多 20 张，应用层不限制单张大小。

默认支持 JPEG、PNG、WebP、AVIF 和 GIF。上传采用磁盘流式接收，不会把完整大图放入内存；服务端只校验扩展名、MIME 类型和实际图片内容，不压缩、不转码、不调整画质或分辨率，保存内容与上传原图逐字节一致。文件保存到 `server/data/uploads/<分类>/`，该目录已被 Git 忽略。可通过环境变量 `UPLOAD_DIR` 改为独立磁盘或 NAS 路径。

应用本身不设置单文件大小上限。如果前面使用 Nginx、Cloudflare Tunnel 或其他反向代理，还需要同步取消或调高代理层的请求体限制。例如 Nginx 可在对应 `server` 或 `location` 中设置 `client_max_body_size 0;`。上传目录应预留足够磁盘空间。

文件成功落盘后才会刷新图库索引。如果索引刷新临时失败，接口仍会保留原图并返回 `indexed: false` 与 `warning`，之后在管理面板点击“刷新全部”即可重试，不会因为索引故障删除已经上传的原图。

## curl 示例

先登录并保存 Cookie：

```bash
curl -c cookie.txt \
  -H "Content-Type: application/json" \
  -d '{"password":"你的密码","code":"123456"}' \
  https://你的域名/photowall/api/auth/login
```

创建分类并上传：

```bash
curl -b cookie.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"旅行"}' \
  https://你的域名/photowall/api/uploads/categories

curl -b cookie.txt \
  -F "category=旅行" \
  -F "images=@photo-1.jpg" \
  -F "images=@photo-2.png" \
  https://你的域名/photowall/api/uploads
```

对公网开放时应使用 HTTPS。手机和电脑只需能访问同一个部署地址，不需要共享服务器文件系统。
