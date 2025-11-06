#!/usr/bin/env node

/**
 * 简单的HTTP服务器，用于提供浏览器认证示例
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const HTML_FILE = path.join(__dirname, '01-browser-authentication.html');
const NODE_MODULES_DIR = path.join(__dirname, '..', 'node_modules');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const BROWSER_DIST_DIR = path.join(__dirname, '..', 'dist', 'browser');

// MIME类型映射
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
};

// 创建HTTP服务器
const server = http.createServer((req, res) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    
    // 设置CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // 处理OPTIONS请求
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // 只处理GET请求
    if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
    }
    
    // 处理node_modules请求
    if (req.url.startsWith('/node_modules/')) {
        const filePath = path.join(NODE_MODULES_DIR, req.url.replace('/node_modules/', ''));
        serveFile(filePath, res);
        return;
    }
    
    // 处理dist目录请求 (drizzle-solid库文件)
    if (req.url.startsWith('/dist/browser/')) {
        const filePath = path.join(BROWSER_DIST_DIR, req.url.replace('/dist/browser/', ''));
        serveFile(filePath, res);
        return;
    } else if (req.url.startsWith('/dist/')) {
        const filePath = path.join(DIST_DIR, req.url.replace('/dist/', ''));
        serveFile(filePath, res);
        return;
    }
    
    // 处理lib目录请求
    if (req.url.startsWith('/lib/')) {
        const filePath = path.join(__dirname, req.url);
        serveFile(filePath, res);
        return;
    }
    
    // 默认返回HTML文件
    if (req.url === '/' || req.url === '/index.html') {
        serveFile(HTML_FILE, res);
        return;
    }
    
    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

// 提供文件
function serveFile(filePath, res) {
    // 检查文件是否存在
    fs.access(filePath, fs.constants.F_OK, (err) => {
        if (err) {
            console.error('File not found:', filePath);
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File Not Found');
            return;
        }
        
        fs.readFile(filePath, (err, data) => {
            if (err) {
                console.error('Error reading file:', err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
                return;
            }
            
            const ext = path.extname(filePath);
            const contentType = mimeTypes[ext] || 'text/plain';
            
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(data);
        });
    });
}

// 启动服务器
server.listen(PORT, () => {
    console.log('🌐 浏览器认证示例服务器启动');
    console.log(`📱 访问地址: http://localhost:${PORT}`);
    console.log('💡 请确保Community Solid Server正在运行 (http://localhost:3000)');
    console.log('🔧 按 Ctrl+C 停止服务器');
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n👋 正在关闭服务器...');
    server.close(() => {
        console.log('✅ 服务器已关闭');
        process.exit(0);
    });
});
