#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 启动 Community Solid Server...');

// 启动 Community Solid Server
const server = spawn('npx', [
  '@solid/community-server',
  '--port', '3000',
  '--loggingLevel', 'info',
  '--config', 'config/file.json'
], {
  stdio: 'inherit',
  cwd: process.cwd()
});

server.on('error', (error) => {
  console.error('❌ 启动服务器失败:', error);
  process.exit(1);
});

server.on('close', (code) => {
  console.log(`🛑 Community Solid Server 已停止 (退出码: ${code})`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n🛑 正在停止 Community Solid Server...');
  server.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n🛑 正在停止 Community Solid Server...');
  server.kill('SIGTERM');
});