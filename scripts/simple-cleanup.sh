#!/bin/bash

echo "🧹 简单清理 Solid Pod 数据"
echo "================================"

# 方案1: 直接删除文件系统中的数据
echo "1️⃣ 检查 solid-server-data 目录..."
if [ -d "solid-server-data/alice/tasks" ]; then
    echo "   发现 tasks 目录，准备清理..."
    
    # 备份当前数据
    echo "   📦 创建备份..."
    cp -r solid-server-data/alice/tasks solid-server-data/alice/tasks.backup.$(date +%Y%m%d_%H%M%S)
    
    # 清理数据
    echo "   🗑️  删除 tasks 目录内容..."
    rm -rf solid-server-data/alice/tasks/*
    
    # 重新创建基本结构
    echo "   📁 重新创建基本结构..."
    mkdir -p solid-server-data/alice/tasks
    
    # 创建基本的容器文件
    cat > solid-server-data/alice/tasks/.meta << 'EOF'
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix dc: <http://purl.org/dc/terms/> .

<> a ldp:Container ;
   dc:title "Tasks Container" ;
   dc:description "Container for task management" .
EOF
    
    echo "   ✅ 文件系统清理完成"
else
    echo "   ❌ 未找到 tasks 目录"
fi

# 方案2: 检查是否有其他相关文件
echo ""
echo "2️⃣ 检查其他可能的数据文件..."
find solid-server-data/alice -name "*task*" -o -name "*test*" 2>/dev/null | while read file; do
    echo "   发现文件: $file"
    echo "   内容预览:"
    head -3 "$file" 2>/dev/null | sed 's/^/      /'
    echo ""
done

echo ""
echo "3️⃣ 重启建议..."
echo "   如果问题仍然存在，建议重启 Solid Pod 服务器:"
echo "   - 停止当前服务器 (Ctrl+C)"
echo "   - 重新运行: npm run solid-server"

echo ""
echo "✅ 清理脚本执行完成"