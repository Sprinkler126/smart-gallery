#!/bin/bash

# PhotoWall 启动脚本 - 带 /photowall 路径前缀

echo "🚀 Starting PhotoWall with /photowall path prefix..."

# 检查是否已在运行
if pgrep -f "node server/index.js" > /dev/null; then
    echo "⚠️  PhotoWall server is already running"
    echo "   Run 'pkill -f \"node server/index.js\"' to stop it first"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")"

# 启动后端服务器
echo "📡 Starting backend server on port 3001..."
node server/index.js &
SERVER_PID=$!

# 等待服务器启动
sleep 2

# 检查是否成功启动
if ! curl -s http://localhost:3001/photowall/api/stats > /dev/null; then
    echo "❌ Failed to start server"
    kill $SERVER_PID 2>/dev/null
    exit 1
fi

echo "✅ PhotoWall server started successfully!"
echo ""
echo "📍 Access URLs:"
echo "   Local:    http://localhost:3001/photowall"
echo "   Public:   https://sprinkler10.xyz/photowall"
echo ""
echo "🔧 API Endpoints:"
echo "   http://localhost:3001/photowall/api/photos"
echo "   http://localhost:3001/photowall/api/stats"
echo ""
echo "🌐 Cloudflare Tunnel:"
echo "   Check status: cloudflared tunnel info photowall"
echo "   Restart:      cloudflared tunnel run photowall"
echo ""
echo "Press Ctrl+C to stop the server"

# 等待用户中断
trap 'echo ""; echo "🛑 Stopping server..."; kill $SERVER_PID 2>/dev/null; exit 0' INT
wait $SERVER_PID
