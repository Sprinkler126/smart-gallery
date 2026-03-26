# 在 Mac 上部署照片墙网站（中国地区）

本教程将指导你如何在 Mac 上部署照片墙网站，并让互联网用户可以访问。

## 目录

1. [准备工作](#准备工作)
2. [本地部署](#本地部署)
3. [内网穿透方案](#内网穿透方案)
4. [域名配置](#域名配置)
5. [安全配置](#安全配置)
6. [自动启动配置](#自动启动配置)
7. [常见问题](#常见问题)

---

## 准备工作

### 1. 安装 Node.js

```bash
# 使用 Homebrew 安装
brew install node

# 验证安装
node -v  # 应该显示 v18.x.x 或更高版本
npm -v
```

### 2. 下载项目代码

```bash
# 克隆仓库
git clone https://github.com/Sprinkler126/PhotoWall.git
cd PhotoWall

# 安装依赖
npm install

# 构建前端
npm run build
```

### 3. 配置图片源

编辑 `server/config.json`，添加你的图片目录：

```json
{
  "appName": "我的照片墙",
  "photographerName": "你的名字",
  "server": {
    "port": 3001,
    "host": "0.0.0.0"
  },
  "imageSources": [
    {
      "id": "my-photos",
      "name": "我的照片",
      "type": "local",
      "path": "/Users/你的用户名/Pictures/PhotoWall",
      "enabled": true,
      "useFolderAsCategory": true,
      "watch": true
    }
  ]
}
```

### 4. 整理照片目录

```
/Users/你的用户名/Pictures/PhotoWall/
├── 风景/
│   ├── 西湖.jpg
│   └── 黄山.jpg
├── 人像/
│   └── portrait.jpg
└── 街拍/
    └── street.jpg
```

每个文件夹会自动成为一个分类！

---

## 本地部署

### 启动服务器

```bash
cd PhotoWall
npm start
```

访问 http://localhost:3001 查看你的照片墙。

### 后台运行（推荐）

使用 PM2 管理进程：

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start server/index.js --name "photowall"

# 设置开机自启
pm2 startup
pm2 save

# 查看状态
pm2 status

# 查看日志
pm2 logs photowall

# 重启服务
pm2 restart photowall
```

---

## 内网穿透方案

由于国内家庭宽带通常没有公网 IP，需要使用内网穿透服务让外网用户访问。

### 方案一：Cloudflare Tunnel（推荐，免费）

**优点**：免费、稳定、自带 HTTPS、无需备案

```bash
# 1. 安装 cloudflared
brew install cloudflared

# 2. 登录 Cloudflare（需要有 Cloudflare 账号和域名）
cloudflared tunnel login

# 3. 创建隧道
cloudflared tunnel create photowall

# 4. 配置隧道
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
tunnel: photowall
credentials-file: /Users/你的用户名/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: photos.你的域名.com
    service: http://localhost:3001
  - service: http_status:404
EOF

# 5. 在 Cloudflare DNS 添加记录
cloudflared tunnel route dns photowall photos.你的域名.com

# 6. 启动隧道
cloudflared tunnel run photowall
```

**设置开机自启**：

```bash
# 创建 LaunchAgent
cat > ~/Library/LaunchAgents/com.cloudflare.tunnel.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cloudflare.tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/cloudflared</string>
        <string>tunnel</string>
        <string>run</string>
        <string>photowall</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

# 加载服务
launchctl load ~/Library/LaunchAgents/com.cloudflare.tunnel.plist
```

### 方案二：frp（需要有服务器）

如果你有一台有公网 IP 的服务器（如阿里云、腾讯云）：

**服务器端 (frps)**：

```bash
# 下载 frp
wget https://github.com/fatedier/frp/releases/download/v0.52.3/frp_0.52.3_linux_amd64.tar.gz
tar -xzf frp_0.52.3_linux_amd64.tar.gz
cd frp_0.52.3_linux_amd64

# 配置 frps.toml
cat > frps.toml << EOF
bindPort = 7000
vhostHTTPPort = 80
vhostHTTPSPort = 443
EOF

# 启动
./frps -c frps.toml
```

**Mac 端 (frpc)**：

```bash
# 下载 frp for macOS
wget https://github.com/fatedier/frp/releases/download/v0.52.3/frp_0.52.3_darwin_arm64.tar.gz
tar -xzf frp_0.52.3_darwin_arm64.tar.gz
cd frp_0.52.3_darwin_arm64

# 配置 frpc.toml
cat > frpc.toml << EOF
serverAddr = "你的服务器IP"
serverPort = 7000

[[proxies]]
name = "photowall"
type = "http"
localPort = 3001
customDomains = ["photos.你的域名.com"]
EOF

# 启动
./frpc -c frpc.toml
```

### 方案三：花生壳/Ngrok（简单但有限制）

**花生壳**（国内服务，需实名）：
1. 注册 https://hsk.oray.com/
2. 下载客户端
3. 添加映射：本地 3001 端口

**Ngrok**（国外服务，国内访问可能慢）：
```bash
brew install ngrok
ngrok http 3001
```

### 方案四：DDNS + 端口映射（需要公网 IP）

如果你的宽带有公网 IP：

1. **检查是否有公网 IP**：
   ```bash
   # 查看外网 IP
   curl ifconfig.me
   
   # 在路由器中查看 WAN IP，如果一致则有公网 IP
   ```

2. **配置路由器端口映射**：
   - 登录路由器管理页面
   - 找到"端口映射"或"虚拟服务器"
   - 添加规则：外部端口 80/443 -> 内部 IP:3001

3. **配置 DDNS**：
   - 使用花生壳、No-IP 等 DDNS 服务
   - 或在域名商处配置动态 DNS

---

## 域名配置

### 购买域名

推荐域名商：
- 阿里云：https://wanwang.aliyun.com/
- 腾讯云：https://dnspod.cloud.tencent.com/
- Cloudflare：https://www.cloudflare.com/products/registrar/

### DNS 配置

| 类型 | 名称 | 值 |
|------|------|-----|
| A | photos | 你的服务器 IP |
| CNAME | photos | xxx.cfargotunnel.com（Cloudflare Tunnel）|

### 备案说明

⚠️ **重要**：如果使用国内服务器，域名需要备案才能正常访问。

- 使用 **Cloudflare Tunnel** 可以绕过备案要求
- 使用境外服务器也可以绕过备案
- 仅限个人/朋友访问可以不备案

---

## 安全配置

### 1. 防火墙配置

```bash
# macOS 防火墙
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on
```

### 2. 添加访问认证（可选）

编辑 `server/index.js`，添加基本认证：

```javascript
// 在文件开头添加
import basicAuth from 'express-basic-auth';

// 在 app.use(cors()) 后添加
app.use('/api/sources', basicAuth({
  users: { 'admin': '你的密码' },
  challenge: true
}));
```

安装依赖：
```bash
npm install express-basic-auth
```

### 3. HTTPS 配置（使用 Cloudflare）

Cloudflare Tunnel 自动提供 HTTPS，无需额外配置。

如果自建 HTTPS：
```bash
# 使用 Let's Encrypt
brew install certbot
sudo certbot certonly --standalone -d photos.你的域名.com
```

---

## 自动启动配置

### 完整的开机自启脚本

创建 `~/photowall-start.sh`：

```bash
#!/bin/bash

# 等待网络就绪
sleep 10

# 启动照片墙服务
cd /Users/你的用户名/PhotoWall
/opt/homebrew/bin/pm2 start server/index.js --name "photowall"

# 启动 Cloudflare Tunnel（如果使用）
/opt/homebrew/bin/cloudflared tunnel run photowall &

echo "PhotoWall started at $(date)" >> ~/photowall.log
```

```bash
chmod +x ~/photowall-start.sh
```

创建 LaunchAgent：

```bash
cat > ~/Library/LaunchAgents/com.photowall.start.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.photowall.start</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/你的用户名/photowall-start.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.photowall.start.plist
```

---

## 常见问题

### Q: 图片加载很慢怎么办？

A: 
1. 确保图片已经生成缩略图
2. 使用 CDN 加速（Cloudflare 自带）
3. 压缩原图大小（建议单张不超过 5MB）

### Q: 如何添加新图片？

A: 直接将图片放入配置的目录中，服务会自动检测并添加。

### Q: Mac 睡眠后服务会断吗？

A: 会的。建议设置：
- 系统偏好设置 -> 节能 -> 防止电脑自动进入睡眠

或使用命令：
```bash
caffeinate -i -w $(pgrep -f "server/index.js")
```

### Q: 如何更新照片墙程序？

```bash
cd PhotoWall
git pull
npm install
npm run build
pm2 restart photowall
```

### Q: 如何查看访问日志？

```bash
pm2 logs photowall
```

### Q: NAS 作为图片源如何配置？

在 `server/config.json` 中添加：

```json
{
  "id": "nas-photos",
  "name": "NAS照片",
  "path": "/Volumes/NAS/Photos",
  "useFolderAsCategory": true,
  "watch": true
}
```

确保 NAS 已挂载到 Mac。

---

## 推荐配置

| 配置项 | 推荐值 |
|--------|--------|
| 内网穿透 | Cloudflare Tunnel |
| 进程管理 | PM2 |
| 域名商 | Cloudflare |
| 图片格式 | JPEG (压缩后 < 2MB) |

---

## 技术支持

如有问题，请在 GitHub 提 Issue：
https://github.com/Sprinkler126/PhotoWall/issues
