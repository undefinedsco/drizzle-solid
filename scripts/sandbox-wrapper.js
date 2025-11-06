#!/usr/bin/env node

/**
 * CSS 本地化启动器
 * 使用 CSS 内置的 @css:config/file.json 配置实现完全本地化运行
 * 无需网络访问，所有组件都使用内置定义
 */

console.log('🔒 启动本地化 Community Solid Server...');
console.log('📋 使用内置配置: @css:config/file.json');
console.log('✅ 完全本地化运行，无需网络访问');

// 启动 CSS 服务器
require('./start-css-server.js');