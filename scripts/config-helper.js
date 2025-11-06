/**
 * 配置助手 - 动态构建 WebID 和 Pod URL
 */

const fs = require('fs');
const path = require('path');

/**
 * 加载配置并动态构建 URL
 */
function loadConfig(baseUrl = null) {
  const configPath = path.join(__dirname, '../config/preset-accounts-template.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  // 使用传入的 baseUrl 或配置中的默认值
  const serverBaseUrl = baseUrl || config.serverConfig.baseUrl;
  const paths = config.serverConfig.paths;
  
  // 为每个账户动态构建 URL
  const processedAccounts = {};
  
  Object.entries(config.presetAccounts).forEach(([key, account]) => {
    processedAccounts[key] = {
      ...account,
      // 动态构建的 URL
      webId: `${serverBaseUrl}/${account.username}${paths.profilePath}${paths.profileFragment}`,
      podUrl: `${serverBaseUrl}/${account.username}/`,
      dataContainer: `${serverBaseUrl}/${account.username}${paths.dataPath}`,
      profileUrl: `${serverBaseUrl}/${account.username}${paths.profilePath}`
    };
  });
  
  return {
    ...config,
    presetAccounts: processedAccounts,
    serverConfig: {
      ...config.serverConfig,
      baseUrl: serverBaseUrl
    }
  };
}

/**
 * 获取账户信息
 */
function getAccount(username, baseUrl = null) {
  const config = loadConfig(baseUrl);
  return config.presetAccounts[username];
}

/**
 * 获取所有账户
 */
function getAllAccounts(baseUrl = null) {
  const config = loadConfig(baseUrl);
  return config.presetAccounts;
}

/**
 * 构建 WebID
 */
function buildWebId(username, baseUrl = 'http://localhost:3000') {
  return `${baseUrl}/${username}/profile/card#me`;
}

/**
 * 构建 Pod URL
 */
function buildPodUrl(username, baseUrl = 'http://localhost:3000') {
  return `${baseUrl}/${username}/`;
}

/**
 * 从 WebID 解析用户名
 */
function parseUsernameFromWebId(webId) {
  try {
    const url = new URL(webId);
    const pathParts = url.pathname.split('/').filter(part => part);
    return pathParts[0]; // 第一个路径部分应该是用户名
  } catch (error) {
    throw new Error(`Invalid WebID format: ${webId}`);
  }
}

/**
 * 验证 WebID 格式
 */
function validateWebId(webId) {
  try {
    const url = new URL(webId);
    const pathParts = url.pathname.split('/').filter(part => part);
    
    // 检查基本格式：应该有用户名和 profile/card 路径
    if (pathParts.length < 3) {
      return false;
    }
    
    // 检查是否有 fragment
    if (!url.hash || url.hash !== '#me') {
      return false;
    }
    
    // 检查路径格式
    if (pathParts[1] !== 'profile' || pathParts[2] !== 'card') {
      return false;
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  loadConfig,
  getAccount,
  getAllAccounts,
  buildWebId,
  buildPodUrl,
  parseUsernameFromWebId,
  validateWebId
};