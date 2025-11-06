#!/usr/bin/env node

/**
 * 构建浏览器版本的 drizzle-solid
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 构建浏览器版本的 Drizzle-Solid...');

try {
    // 使用浏览器配置编译 TypeScript
    console.log('📦 编译 TypeScript (ES2020 模块)...');
    execSync('npx tsc -p tsconfig.browser.json', { stdio: 'inherit' });
    
    // 创建浏览器入口文件
    console.log('🌐 创建浏览器入口文件...');
    const browserEntryContent = `
// Drizzle-Solid 浏览器版本入口文件
import * as DrizzleSolid from './index.js';

// 将所有导出添加到全局对象
if (typeof window !== 'undefined') {
    window.DrizzleSolid = DrizzleSolid;
}

export * from './index.js';
export default DrizzleSolid;
`;
    
    fs.writeFileSync(path.join(__dirname, '../dist/browser/browser.js'), browserEntryContent);
    
    console.log('✅ 浏览器版本构建完成！');
    console.log('📁 输出目录: dist/browser/');
    
} catch (error) {
    console.error('❌ 构建失败:', error.message);
    process.exit(1);
}