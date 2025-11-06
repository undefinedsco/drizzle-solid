/**
 * 创建预设用户的Profile数据文件
 */

const fs = require('fs');
const path = require('path');

// 读取预设账户配置
const configPath = path.join(__dirname, '../config/preset-accounts.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/**
 * 创建用户的Profile数据文件
 */
async function createProfileData() {
  console.log('🔧 开始创建Profile数据文件...');
  
  try {
    // 创建数据目录
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 为每个用户创建Profile数据
    for (const [username, userConfig] of Object.entries(config.presetAccounts)) {
      const userDir = path.join(dataDir, username);
      const profileDir = path.join(userDir, 'profile');
      
      // 创建用户目录
      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }
      if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
      }

      // 创建Profile数据（Turtle格式）
      const profileTurtle = `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix schema: <https://schema.org/> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .

<${userConfig.webId}> a foaf:Person ;
    foaf:name "${userConfig.name}" ;
    foaf:mbox <mailto:${userConfig.email}> ;
    foaf:img <${userConfig.profile.avatar}> ;
    foaf:phone "${userConfig.profile.phone}" ;
    schema:bio """${userConfig.profile.bio}""" ;
    schema:website <${userConfig.profile.website}> ;
    schema:location "${userConfig.profile.location}" ;
    schema:organization "${userConfig.profile.organization}" ;
    schema:jobTitle "${userConfig.profile.title}" ;
    solid:oidcIssuer <${config.serverConfig.baseUrl}> .
`;

      // 写入Profile文件
      const profileFile = path.join(profileDir, 'card');
      fs.writeFileSync(profileFile, profileTurtle);
      
      console.log(`✅ 创建 ${username} 的Profile数据: ${profileFile}`);
    }

    console.log('\n🎉 Profile数据创建完成！');
    
  } catch (error) {
    console.error('❌ 创建Profile数据失败:', error.message);
    throw error;
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  createProfileData().catch(console.error);
}

module.exports = { createProfileData };
