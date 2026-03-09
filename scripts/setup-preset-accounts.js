/**
 * 预设账户设置脚本
 * 用于在 Community Solid Server 启动时自动创建测试账户
 */

const fs = require('fs');
const path = require('path');

// 读取预设账户配置
const configPath = path.join(__dirname, '../config/preset-accounts.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/**
 * 生成 Community Solid Server 的预设 Pod 配置
 * 使用 --seedConfig 参数格式（直接数组）
 */
function generateSeededPodsConfig() {
  const podOwners = [];
  
  Object.entries(config.presetAccounts).forEach(([username, userConfig]) => {
    podOwners.push({
      email: userConfig.email,
      password: userConfig.password,
      podName: username,
      webId: userConfig.webId
    });
  });

  return podOwners;
}

/**
 * 生成服务器启动配置
 */
function generateServerConfig() {
  const serverConfig = config.serverConfig;
  
  return {
    "@context": "https://linkedsoftwaredependencies.org/bundles/npm/@solid/community-server/^8.0.0/components/context.jsonld",
    "import": [
      "css:config/app/init/initialize-prefilled-root.json",
      "css:config/app/main/default.json",
      "css:config/app/variables/default.json",
      "css:config/http/handler/default.json",
      "css:config/http/middleware/websockets.json",
      "css:config/http/server-factory/websockets.json",
      "css:config/http/static/default.json",
      "css:config/identity/access/public.json",
      "css:config/identity/email/default.json",
      "css:config/identity/handler/default.json",
      "css:config/identity/ownership/token.json",
      "css:config/identity/pod/static.json",
      "css:config/identity/registration/enabled.json",
      "css:config/ldp/authentication/dpop-bearer.json",
      "css:config/ldp/authorization/webacl.json",
      "css:config/ldp/handler/default.json",
      "css:config/ldp/metadata-parser/default.json",
      "css:config/ldp/metadata-writer/default.json",
      "css:config/ldp/modes/default.json",
      "css:config/storage/backend/data-accessors/file.json",
      "css:config/storage/key-value/resource-store.json",
      "css:config/storage/middleware/default.json",
      "css:config/util/auxiliary/acl.json",
      "css:config/util/identifiers/suffix.json",
      "css:config/util/index/default.json",
      "css:config/util/logging/winston.json",
      "css:config/util/representation-conversion/default.json",
      "css:config/util/resource-locker/file.json",
      "css:config/util/variables/default.json"
    ],
    "@graph": [
      {
        "comment": "预设账户配置 - 用于测试和示例",
        "@id": "urn:solid-server:default:variable:port",
        "@type": "Variable",
        "valueRaw": serverConfig.port.toString()
      },
      {
        "@id": "urn:solid-server:default:variable:baseUrl", 
        "@type": "Variable",
        "valueRaw": serverConfig.baseUrl
      },
      {
        "@id": "urn:solid-server:default:variable:rootFilePath",
        "@type": "Variable", 
        "valueRaw": "./data"
      },
      {
        "@id": "urn:solid-server:default:variable:sparqlEndpoint",
        "@type": "Variable",
        "valueRaw": ""
      },
      {
        "@id": "urn:solid-server:default:variable:showStackTrace",
        "@type": "Variable",
        "valueRaw": "true"
      }
    ]
  };
}

/**
 * 创建预设用户的初始数据
 */
function generateInitialData() {
  const initialData = {};
  
  Object.entries(config.presetAccounts).forEach(([username, userConfig]) => {
    // 创建完整的Profile数据
    const profileData = {
      "@context": {
        "foaf": "http://xmlns.com/foaf/0.1/",
        "schema": "https://schema.org/",
        "solid": "http://www.w3.org/ns/solid/terms#"
      },
      "@id": userConfig.webId,
      "@type": "foaf:Person",
      "foaf:name": userConfig.name,
      "foaf:mbox": `mailto:${userConfig.email}`,
      "foaf:img": userConfig.profile.avatar,
      "foaf:phone": userConfig.profile.phone,
      "schema:bio": userConfig.profile.bio,
      "schema:website": userConfig.profile.website,
      "schema:location": userConfig.profile.location,
      "schema:organization": userConfig.profile.organization,
      "schema:jobTitle": userConfig.profile.title,
      "solid:oidcIssuer": config.serverConfig.baseUrl
    };

    initialData[username] = {
      profile: profileData,
      data: {
        users: [],
        profiles: []
      }
    };
  });

  return initialData;
}

/**
 * 主函数：设置所有预设账户
 */
async function setupPresetAccounts() {
  console.log('🔧 开始设置预设账户...');
  
  try {
    // 创建配置目录
    const configDir = path.join(__dirname, '../.solid-server');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // 生成预设 Pod 配置文件
    const seededPodsConfig = generateSeededPodsConfig();
    fs.writeFileSync(
      path.join(configDir, 'seeded-pods.json'),
      JSON.stringify(seededPodsConfig, null, 2)
    );
    console.log('✅ 预设 Pod 配置文件已生成');

    // 生成服务器配置文件
    const serverConfig = generateServerConfig();
    fs.writeFileSync(
      path.join(configDir, 'server-config.json'),
      JSON.stringify(serverConfig, null, 2)
    );
    console.log('✅ 服务器配置文件已生成');

    // 生成初始数据
    const initialData = generateInitialData();
    fs.writeFileSync(
      path.join(configDir, 'initial-data.json'),
      JSON.stringify(initialData, null, 2)
    );
    console.log('✅ 初始数据文件已生成');

    // 输出账户信息
    console.log('\n📋 预设账户信息:');
    Object.entries(config.presetAccounts).forEach(([username, userConfig]) => {
      console.log(`\n👤 ${username.toUpperCase()}:`);
      console.log(`   WebID: ${userConfig.webId}`);
      console.log(`   Email: ${userConfig.email}`);
      console.log(`   Password: ${userConfig.password}`);
      console.log(`   Pod URL: ${userConfig.podUrl}`);
    });

    console.log('\n🚀 预设账户设置完成！');
    console.log('💡 现在可以启动 Community Solid Server 并使用这些账户进行测试');
    
  } catch (error) {
    console.error('❌ 预设账户设置失败:', error.message);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  setupPresetAccounts().catch(console.error);
}

module.exports = {
  setupPresetAccounts,
  generateSeededPodsConfig,
  generateServerConfig,
  generateInitialData,
  config
};