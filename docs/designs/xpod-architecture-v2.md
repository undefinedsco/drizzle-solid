# XPOD 架构升级与合规重构规划 (XPOD Architecture V2)

## 1. 核心目标 (Objective)

将 XPOD 从单一的 Pod 托管平台，转型为**“去中心化 Pod 管理与身份服务平台”**。通过实施**身份(IdP)与存储(SP)分离架构**，实现用户身份（WebID）的永久稳定，同时将用户数据存储（Pod）动态剥离至用户端，以彻底规避法律风险并解决内网穿透难题。

## 2. 架构模式：身份与存储分离 (IdP & SP Separation)

### A. 身份服务模块 (Identity Provider Service) - 部署在 XPOD 云端
*   **角色**: 仅作为身份提供商 (IdP)，不接触用户实际数据。
*   **功能**:
    *   **Profile 托管**: 为用户生成永久固定、高可用的 WebID（例如 `https://id.xpod.io/alice#me`）。
    *   **动态指针**: 在 Profile 文档中维护 `pim:storage` 或 `solid:pod` 字段。该字段不指向云端，而是指向用户当前的动态存储域名。
    *   **指针更新 API**: 提供受 OAuth 保护的 API 接口，允许经过认证的 XPOD 本地客户端远程更新其 `storage` 指针地址。
*   **合规优势**: 服务器上仅存储几 KB 的 RDF 文本（索引/名片），不存储用户上传的任何图片、视频或文档，极大地降低了内容合规风险。

### B. 本地节点客户端 (Local Pod Manager) - 运行在用户侧 (SP)
*   **角色**: 实际的存储提供商 (SP)，运行在用户家庭/公司网络中。
*   **功能**:
    *   **数据存储**: CSS (Community Solid Server) 实例运行在本地，数据物理存储在用户硬盘。
    *   **心跳同步**: 节点启动或公网 IP 变更时，自动调用云端 API，更新 WebID Profile 中的 `pim:storage` 指向。

## 3. 网络模块重构 (Network Module)

为了在不触碰“非法流量转发”红线的前提下实现易用性，采用**智能穿透状态机**策略：

*   **Level 1: IPv6 + UPnP (优先/极速)**
    *   自动检测宿主机是否拥有公网 IPv6 地址。
    *   尝试通过 UPnP (IGD协议) 在路由器上自动映射端口。
    *   **优势**: 物理直连，无中转，零成本，合规（流量不经过 XPOD）。
*   **Level 2: IPv4 + UPnP (次选)**
    *   检测公网 IPv4 地址，尝试 UPnP 映射。
*   **Level 3: 合规第三方穿透 (高速/国内)**
    *   支持绑定合规的第三方 DDNS/内网穿透服务商（如花生壳 Oray、FRP 公益备案服）。
    *   用户填入第三方服务的 Token，XPOD 自动配置。
*   **Level 4: Cloudflare Tunnel (保底/零配置)**
    *   当上述均不可用时，自动启动内置的 `cloudflared` 进程。
    *   利用 Cloudflare 边缘节点进行流量清洗和转发。
    *   **优势**: 零配置可用，流量出口在海外（规避备案风险）。

## 4. 合规与风控模块 (Compliance & Risk Control)

针对 Solid Pod 可能被滥用为违规内容分发源的风险，实施以下技术风控：

### A. ACL 模板与拦截引擎
*   **默认私有化**: Pod 初始化时，根目录 ACL 默认不包含 `foaf:Agent` (Public) 权限。
*   **硬编码拦截**: 在 CSS Server 配置层或反向代理层，拦截所有试图授予 `foaf:Agent` (所有人) 或 `foaf:AuthenticatedAgent` (所有登录用户) `acl:Read` 权限的请求。
    *   **目的**: 将服务性质从“公共内容发布平台”强制降维为“个人/私密云存储”，消除传播属性。

### B. 应用白名单 (App Registry)
*   **Client ID 校验**: 仅允许 XPOD 官方认证或注册在白名单内的 Solid App (`Client_ID`) 连接本地 Pod。
*   **权限隔离**: 防止恶意 App 在用户不知情的情况下修改 ACL 或传播数据。

## 5. 域名与证书策略
*   **双域名策略**:
    *   **身份域名**: `id.xpod.io` (高信誉，永不变更)。
    *   **存储域名**: `node1.xyz`, `node2.top` (动态分配，用于 DDNS/Tunnel，随时可替换)。
*   **HTTPS 自动化**:
    *   XPOD 客户端内置 Let's Encrypt 申请逻辑。
    *   配合 DDNS 域名，自动通过 DNS-01 或 HTTP-01 方式在用户本地签发和续期 SSL 证书。

---
**总结**: 通过此架构，XPOD 将从“高风险的托管商”转变为“低风险的软件工具提供商 + 身份索引服务商”，在保障用户数据主权的同时，最大化规避法律与运营风险。
