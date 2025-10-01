# Community Solid Server 预设账户配置

## CSS 预设账户参数

Community Solid Server 提供了几种方式来配置预设账户：

### 1. `--seededPodConfigJson` 参数 (推荐)

这是 CSS 7.0+ 版本的标准方式：

```bash
npx @solid/community-server \
  --seededPodConfigJson ./config/seeded-pods.json \
  --port 3001 \
  --baseUrl http://localhost:3000
```

**seeded-pods.json 格式：**
```json
{
  "podOwners": [
    {
      "email": "alice@example.com",
      "password": "alice123", 
      "podName": "alice",
      "webId": "http://localhost:3001/alice/profile/card#me"
    },
    {
      "email": "bob@example.com",
      "password": "bob123",
      "podName": "bob", 
      "webId": "http://localhost:3001/bob/profile/card#me"
    }
  ]
}
```

### 2. 环境变量方式

```bash
export CSS_SEEDED_POD_CONFIG_JSON=./config/seeded-pods.json
npx @solid/community-server --port 3000 --baseUrl http://localhost:3000
```

### 3. 配置文件方式

通过完整的配置文件：

```bash
npx @solid/community-server --config ./config/server-config.json
```

## 参数说明

### `--seededPodConfigJson`
- **作用**: 指定预设 Pod 配置文件路径
- **格式**: JSON 文件，包含 `podOwners` 数组
- **版本**: CSS 5.0+

### Pod Owner 配置项

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `email` | string | ✅ | 用户邮箱地址 |
| `password` | string | ✅ | 用户密码 |
| `podName` | string | ✅ | Pod 名称（URL 路径） |
| `webId` | string | ✅ | 用户 WebID URI |

### 其他相关参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--port` | 服务器端口 | `3001` |
| `--baseUrl` | 基础URL | `http://localhost:3001` |
| `--rootFilePath` | 数据存储路径 | `./data` |
| `--showStackTrace` | 显示错误堆栈 | 无值参数 |

## 使用示例

### 基础启动
```bash
# 使用预设配置启动 CSS
npm run server:start
```

### 手动启动
```bash
# 1. 生成配置文件
node scripts/setup-preset-accounts.js

# 2. 启动服务器
npx @solid/community-server \
  --seededPodConfigJson ./.solid-server/seeded-pods.json \
  --port 3000 \
  --baseUrl http://localhost:3000 \
  --rootFilePath ./data
```

### 验证预设账户
启动后，可以通过以下方式验证：

1. **Web 界面登录**:
   - 访问 http://localhost:3000
   - 使用 alice@example.com / alice123 登录
   - 使用 bob@example.com / bob123 登录

2. **程序化验证**:
   ```bash
   npm run example:auth
   ```

## 注意事项

1. **版本兼容性**: `--seededPodConfigJson` 需要 CSS 5.0+
2. **数据持久化**: 预设账户数据存储在 `--rootFilePath` 指定的目录
3. **WebID 格式**: 确保 WebID 与 baseUrl 和 podName 匹配
4. **密码安全**: 生产环境请使用强密码

## 故障排除

### 常见错误

1. **"Unknown option: --seededPodConfigJson"**
   - 解决: 升级到 CSS 7.0+ 版本

2. **"Pod creation failed"**
   - 检查 WebID 格式是否正确
   - 确保 baseUrl 和 podName 匹配

3. **"Authentication failed"**
   - 验证邮箱和密码是否正确
   - 检查配置文件格式

### 调试命令
```bash
# 查看 CSS 版本
npx @solid/community-server --version

# 查看所有可用参数
npx @solid/community-server --help
