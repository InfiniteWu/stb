#!/bin/bash
# 刷题宝 启动脚本

cd "$(dirname "$0")"

PORT=${1:-2026}

# 杀掉占用端口的旧进程
OLD_PID=$(lsof -t -i:$PORT 2>/dev/null)
if [ -n "$OLD_PID" ]; then
    echo "停止旧进程 (PID: $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null
    sleep 1
fi

IP=$(hostname -I | awk '{print $1}')

echo "刷题宝 - 启动中..."
echo "端口: $PORT"
echo "访问: http://${IP:-localhost}:$PORT"
echo ""

nohup setsid php -S 0.0.0.0:$PORT router.php > /tmp/shuatibao.log 2>&1 &
disown

sleep 1
if curl -s -o /dev/null -w '' http://localhost:$PORT/ 2>/dev/null; then
    echo "启动成功! 实时日志:"
    echo "---"
    tail -f /tmp/shuatibao.log
else
    echo "启动失败，请检查日志: /tmp/shuatibao.log"
    cat /tmp/shuatibao.log
fi
