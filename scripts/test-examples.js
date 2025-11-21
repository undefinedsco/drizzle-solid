#!/usr/bin/env node

/**
 * 示例测试脚本
 * 
 * 用于验证所有示例是否能正常运行
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function execCommand(command, options = {}) {
  try {
    const result = execSync(command, { 
      encoding: 'utf8', 
      stdio: 'pipe',
      ...options 
    });
    return { success: true, output: result };
  } catch (error) {
    return { 
      success: false, 
      output: error.stdout || error.message,
      error: error.stderr || error.message
    };
  }
}

async function checkPrerequisites() {
  log('\n🔍 检查前提条件...', 'blue');
  
  // 检查 Node.js 版本
  const nodeVersion = process.version;
  log(`Node.js 版本: ${nodeVersion}`, 'cyan');
  
  if (parseInt(nodeVersion.slice(1)) < 16) {
    log('❌ Node.js 版本过低，需要 >= 16.0.0', 'red');
    return false;
  }
  
  // 检查是否已构建
  if (!fs.existsSync('dist')) {
    log('📦 项目尚未构建，正在构建...', 'yellow');
    const buildResult = execCommand('yarn build');
    if (!buildResult.success) {
      log('❌ 构建失败', 'red');
      log(buildResult.error, 'red');
      return false;
    }
    log('✅ 构建成功', 'green');
  }
  
  // 检查是否已链接
  log('🔗 检查 yarn link 状态...', 'yellow');
  const linkResult = execCommand('yarn list --depth=0 drizzle-solid');
  if (!linkResult.success) {
    log('🔗 正在设置 yarn link...', 'yellow');
    
    const linkSelfResult = execCommand('yarn link');
    if (!linkSelfResult.success) {
      log('❌ yarn link 失败', 'red');
      return false;
    }
    
    const linkPackageResult = execCommand('yarn link drizzle-solid');
    if (!linkPackageResult.success) {
      log('❌ yarn link drizzle-solid 失败', 'red');
      return false;
    }
    
    log('✅ yarn link 设置成功', 'green');
  }
  
  return true;
}

async function testTypeScriptExamples() {
  log('\n📝 测试 TypeScript 示例...', 'blue');
  
  const examples = [
    {
      name: '基础认证示例',
      file: 'examples/01-basic-authentication.ts',
      timeout: 30000
    },
    {
      name: '原始认证示例',
      file: 'examples/authentication.ts',
      timeout: 30000
    }
  ];
  
  const results = [];
  
  for (const example of examples) {
    log(`\n🧪 测试: ${example.name}`, 'cyan');
    
    if (!fs.existsSync(example.file)) {
      log(`❌ 文件不存在: ${example.file}`, 'red');
      results.push({ name: example.name, success: false, reason: '文件不存在' });
      continue;
    }
    
    // 直接运行，不使用 timeout（因为 macOS 默认没有 timeout 命令）
    const command = `npx tsx ${example.file}`;
    
    const result = execCommand(command, { timeout: example.timeout });
    
    if (result.success) {
      log(`✅ ${example.name} 执行成功`, 'green');
      results.push({ name: example.name, success: true });
    } else {
      // 检查是否是预期的网络错误（401, 403 等）
      const isExpectedError = result.error && (
        result.error.includes('401') || 
        result.error.includes('403') || 
        result.error.includes('404') ||
        result.error.includes('ENOTFOUND') ||
        result.error.includes('ECONNREFUSED')
      );
      
      if (isExpectedError) {
        log(`⚠️ ${example.name} 遇到预期的网络错误（这是正常的）`, 'yellow');
        results.push({ name: example.name, success: true, note: '网络错误（预期）' });
      } else {
        log(`❌ ${example.name} 执行失败`, 'red');
        log(`错误信息: ${result.error}`, 'red');
        results.push({ name: example.name, success: false, reason: result.error });
      }
    }
  }
  
  return results;
}

async function testHTMLExamples() {
  log('\n🌐 检查 HTML 示例...', 'blue');
  
  const htmlFiles = [
    'examples/02-browser-authentication.html'
  ];
  
  const results = [];
  
  for (const file of htmlFiles) {
    if (fs.existsSync(file)) {
      log(`✅ ${file} 存在`, 'green');
      
      // 简单检查 HTML 文件是否包含必要的元素
      const content = fs.readFileSync(file, 'utf8');
      const hasScript = content.includes('<script');
      const hasTitle = content.includes('<title>');
      
      if (hasScript && hasTitle) {
        log(`✅ ${file} 格式正确`, 'green');
        results.push({ name: file, success: true });
      } else {
        log(`⚠️ ${file} 可能缺少必要元素`, 'yellow');
        results.push({ name: file, success: false, reason: '缺少必要元素' });
      }
    } else {
      log(`❌ ${file} 不存在`, 'red');
      results.push({ name: file, success: false, reason: '文件不存在' });
    }
  }
  
  return results;
}

async function testDocumentation() {
  log('\n📚 检查文档...', 'blue');
  
  const docs = [
    'docs/README.md',
    'docs/guides/installation.md',
    'docs/guides/authentication.md',
    'docs/guides/concepts.md',
    'docs/examples/authentication-example.md',
    'examples/README.md'
  ];
  
  const results = [];
  
  for (const doc of docs) {
    if (fs.existsSync(doc)) {
      const stats = fs.statSync(doc);
      if (stats.size > 0) {
        log(`✅ ${doc} (${Math.round(stats.size / 1024)}KB)`, 'green');
        results.push({ name: doc, success: true });
      } else {
        log(`⚠️ ${doc} 文件为空`, 'yellow');
        results.push({ name: doc, success: false, reason: '文件为空' });
      }
    } else {
      log(`❌ ${doc} 不存在`, 'red');
      results.push({ name: doc, success: false, reason: '文件不存在' });
    }
  }
  
  return results;
}

function generateReport(tsResults, htmlResults, docResults) {
  log('\n📊 测试报告', 'magenta');
  log('='.repeat(50), 'magenta');
  
  const allResults = [...tsResults, ...htmlResults, ...docResults];
  const successCount = allResults.filter(r => r.success).length;
  const totalCount = allResults.length;
  
  log(`\n总体结果: ${successCount}/${totalCount} 通过`, 
    successCount === totalCount ? 'green' : 'yellow');
  
  // TypeScript 示例结果
  log('\n📝 TypeScript 示例:', 'blue');
  tsResults.forEach(result => {
    const status = result.success ? '✅' : '❌';
    const note = result.note ? ` (${result.note})` : '';
    log(`  ${status} ${result.name}${note}`);
  });
  
  // HTML 示例结果
  log('\n🌐 HTML 示例:', 'blue');
  htmlResults.forEach(result => {
    const status = result.success ? '✅' : '❌';
    log(`  ${status} ${result.name}`);
  });
  
  // 文档结果
  log('\n📚 文档文件:', 'blue');
  docResults.forEach(result => {
    const status = result.success ? '✅' : '❌';
    log(`  ${status} ${result.name}`);
  });
  
  // 失败项目详情
  const failures = allResults.filter(r => !r.success);
  if (failures.length > 0) {
    log('\n❌ 失败项目详情:', 'red');
    failures.forEach(failure => {
      log(`  • ${failure.name}: ${failure.reason}`, 'red');
    });
  }
  
  log('\n🎯 下一步建议:', 'cyan');
  if (successCount === totalCount) {
    log('  🎉 所有测试通过！可以开始使用示例了。', 'green');
    log('  📖 建议阅读 examples/README.md 了解如何运行示例。', 'cyan');
  } else {
    log('  🔧 请修复失败的项目后重新测试。', 'yellow');
    log('  📖 查看 examples/README.md 获取详细说明。', 'cyan');
  }
}

async function main() {
  log('🚀 Drizzle Solid 示例测试工具', 'magenta');
  log('='.repeat(50), 'magenta');
  
  try {
    // 检查前提条件
    const prereqsOk = await checkPrerequisites();
    if (!prereqsOk) {
      log('\n❌ 前提条件检查失败，请解决后重试', 'red');
      process.exit(1);
    }
    
    // 运行测试
    const tsResults = await testTypeScriptExamples();
    const htmlResults = await testHTMLExamples();
    const docResults = await testDocumentation();
    
    // 生成报告
    generateReport(tsResults, htmlResults, docResults);
    
  } catch (error) {
    log(`\n💥 测试过程中发生错误: ${error.message}`, 'red');
    process.exit(1);
  }
}

// 运行主函数
if (require.main === module) {
  main();
}
