@echo off
title ZXY影视服务器控制台 (关闭此窗口以停止)

echo 启动 ZXY影视代理服务器...
echo (服务器输出已隐藏，关闭此窗口以停止服务器)
echo.

REM 在默认浏览器中启动 HTML 页面
start "" "videopage.html"

REM 在此窗口中运行 Node.js 服务器，隐藏其输出
REM 脚本将在此处等待，直到 node 进程终止（例如，通过关闭此窗口）
node server.js > nul 2>&1

echo 服务器已停止。
