/**
 * 创建 Pod 结构脚本
 * 确保预设账户的 Pod 容器和数据正确创建
 */

const fs = require('fs');
const path = require('path');

/**
 * 创建 Pod 容器结构
 */
function createPodStructure() {
  console.log('🏗️ 创建 Pod 容器结构...');
  
  const accounts = ['alice', 'bob', 'charlie'];
  const dataDir = path.join(__dirname, '../data');
  
  accounts.forEach(account => {
    const accountDir = path.join(dataDir, account);
    
    // 创建根容器的 .meta 文件
    const rootMetaPath = path.join(accountDir, '.meta');
    const rootMeta = `@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<http://localhost:3000/${account}/> a ldp:BasicContainer ;
    dcterms:title "Pod for ${account}" .
`;
    
    if (!fs.existsSync(rootMetaPath)) {
      fs.writeFileSync(rootMetaPath, rootMeta);
      console.log(`✅ 创建 ${account} 根容器元数据`);
    }
    
    // 创建 profile 容器的 .meta 文件
    const profileDir = path.join(accountDir, 'profile');
    const profileMetaPath = path.join(profileDir, '.meta');
    const profileMeta = `@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<http://localhost:3000/${account}/profile/> a ldp:BasicContainer ;
    dcterms:title "Profile container for ${account}" .
`;
    
    if (!fs.existsSync(profileMetaPath)) {
      fs.writeFileSync(profileMetaPath, profileMeta);
      console.log(`✅ 创建 ${account} profile 容器元数据`);
    }
    
    // 创建 profile card 的 .meta 文件
    const cardMetaPath = path.join(profileDir, 'card.meta');
    const cardMeta = `@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<http://localhost:3000/${account}/profile/card> a ldp:Resource ;
    dcterms:title "Profile card for ${account}" .
`;
    
    if (!fs.existsSync(cardMetaPath)) {
      fs.writeFileSync(cardMetaPath, cardMeta);
      console.log(`✅ 创建 ${account} profile card 元数据`);
    }
  });
  
  console.log('🎉 Pod 容器结构创建完成！');
}

// 如果直接运行此脚本
if (require.main === module) {
  createPodStructure();
}

module.exports = { createPodStructure };