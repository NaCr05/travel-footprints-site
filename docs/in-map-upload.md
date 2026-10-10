# 在地图内添加旅行照片

开发分支已经包含城市相册内的选图、拖放、缩图、月份和说明表单，以及配套的 Cloudflare Worker。**上传程序已部署，地图专用 GitHub 应用已创建并仅安装到本仓库，两项服务密钥均已加密保存；新的 Pages 连接测试页可访问，但实际上传服务尚未接到该入口，真实登录和上传尚未通过验证。** 前端服务地址仍留空，本地表单显示“本地预览”，登录和保存不可用。不能把后台部署成功或连接测试通过当作正式上传已接通。

## 接入状态（2026-10-10）

- Worker：`https://travel-footprints-upload.wangzhenhuan05.workers.dev`，已通过 Cloudflare 控制台发布打包程序和公开参数；运行日期为 `2026-10-01`，关闭运行日志，与仓库配置一致。
- GitHub App：`NaCr05 Travel Photos`（`nacr05-travel-photos`），只允许当前账号安装，仅授予 `travel-footprints-site` 的 Contents 读写和 Metadata 只读权限。未申请 Actions、Administration 或其他仓库权限。
- Client ID 和服务 URL 是公开参数，可保存在 `wrangler.jsonc`；Client Secret 和会话密钥只进入 Worker secrets，不提交到 Git。
- `GITHUB_CLIENT_SECRET` 和 `SESSION_SECRET` 已由所有者录入，控制台均显示为加密 Secret。不要在文档中记录密钥值。
- 控制台已确认生产 Worker URL 启用。测试网络的系统 DNS 与公共 DNS 查询结果不同；曾遇到 `ERR_CERT_COMMON_NAME_INVALID` 和连接重置，切换手机热点后仍超时。尚未确认具体原因；不应反复要求切换网络或绕过证书检查。
- 不带凭据的 HTTP `/health` 诊断收到 `200 {"ready":true}`，只证明程序运行及必需配置存在且格式符合要求，不能证明 HTTPS、GitHub 凭据或真实保存已验证。认证和上传必须使用 HTTPS，不应忽略证书错误或关闭证书校验。
- Pages 项目 `travel-footprints-upload-check` 已由所有者上传连接测试包并发布。`https://travel-footprints-upload-check.pages.dev/` 和 `/health` 在正常 HTTPS 检测中均返回 200；后者返回 `{"check":"travel-footprints-network","status":"ok"}`。Chrome 能显示首页，但直接导航到 `/health` 时出现 `ERR_BLOCKED_BY_CLIENT`；浏览器 API 使用情况仍待确认。这个测试包没有仓库权限、照片或密钥。
- `upload-service/pages-gateway/` 是已准备的后续接入代码，**尚未部署或添加 Service binding**。它可以通过 Cloudflare 内部绑定调用现有 Worker，保留当前密钥；只允许固定正式域名及指定接口，预览域名不能成为其他登录入口。正式地图网址和现有相册保持不变。

## 使用流程

进入一座城市，在「旅途相册」旁点击「添加照片」。选择或拖入 JPG、PNG、WebP，可以先在本机预览；选择已有到访月份，也可以放入不关联月份的城市相册。每张照片可以填写说明。

服务接通后，所有者通过弹出的 GitHub 窗口登录，回到同一个地图页面点击「保存照片」。照片与相册关联一次写入仓库，页面分别显示「已同步到仓库」与「已发布」；后者需要读取正式网站的相册与图片确认。保存前不会上传照片。关闭表单会保留当前城市的本机草稿，刷新或关闭网页会丢失未保存草稿。

- 每批最多 5 张，原图每张不超过 20 MiB、6000 万像素。
- 新上传图片在浏览器中解码，按正确方向缩至长边不超过 1920 像素，再编码为 JPEG；透明区域使用白底。服务端再次检查 JPEG 结构与尺寸，移除 APP/COM 元数据，包括 EXIF、GPS 和 XMP。服务端不是完整图像解码器。
- 每张新图片不超过 2 MiB；每个「城市 + 月份」相册最多 24 张。已有 Pages CMS 原图保持原样，仍按 8 MiB 的兼容上限检查。
- 图片会进入公开仓库。这里只清除新上传版本的元数据，不会处理照片画面中的个人信息，也不会修改设备原图。
- 当前只添加照片；删除、排序和修改已保存说明仍可使用 Pages CMS。两个编辑器共享同一相册文件，避免同时保存；地图编辑器检测到并发修改会保留草稿并要求重新读取。

## 首次部署（所有者操作）

1. 注册/登录 Cloudflare，使用 Workers。网站本身继续留在 GitHub Pages，网址不变。
2. 在 `upload-service/` 执行 `npm ci` 安装锁定的官方 Wrangler；`npm run bundle` 只检查打包，`npm run deploy` 才部署。先部署未配置凭据的服务取得实际 `workers.dev` 地址；该状态只报告尚未配置，不能写仓库。
3. 注册一个 **GitHub App**，首页为地图网址；Callback URL 为 `https://实际服务地址/auth/callback`。仅申请 repository **Contents: Read and write**，Metadata 自动只读；关闭 webhook，不申请 Actions、Administration 或 Workflows 写权限。启用用户授权的过期令牌。仅允许在自己的账号安装，然后只安装到 `travel-footprints-site`。
4. 在 `upload-service/wrangler.jsonc` 填实际 `SERVICE_ORIGIN` 和 App Client ID。现有非敏感配置固定目标仓库、仓库 ID、所有者稳定用户 ID 和 `main` 分支。其他人复用时必须更换这些值。
5. 将 App Client Secret 保存为 Worker secret `GITHUB_CLIENT_SECRET`；另外生成至少 32 字节密码学随机值（base64url 后至少 43 字符），保存为 `SESSION_SECRET`。通过 `wrangler secret put` 的标准输入或 Cloudflare 控制台录入，不能写进仓库、前端配置、截图或命令参数。
6. 重新部署 Worker。在浏览器核对 `/health` 返回 `ready: true`；用实际 GitHub 所有者完成登录。只用一张准备公开的照片验证一次保存、仓库提交及正式网站发布，再配置 `site/upload-config.js` 的公开服务 URL，合并发布网页入口。

第 6 步需要先在独立预览部署或本地配置中接入实际服务；正式服务默认仅接受正式地图 origin。本地测试应使用独立 Worker 配置、测试仓库/分支与明确允许的本地 origin，不要为方便测试放宽生产 CORS。当前源码仅接受 HTTPS origin；独立本地集成测试使用 HTTPS 预览。

也可通过 Cloudflare 控制台发布 Wrangler 生成的单文件打包产物；本次采用此方式。控制台中的公开变量、兼容日期和日志设置需要与 `wrangler.jsonc` 保持一致，密钥单独保存为 Secret。无需把账户令牌或本机 GitHub CLI 登录信息复制给上传服务。

Cloudflare 尚无账号时，先完成网页本地预览和自动测试即可；不要填写虚构服务地址或把 GitHub CLI 的个人令牌挪用为网页凭据。

官方参考：[Workers 部署](https://developers.cloudflare.com/workers/get-started/guide/)、[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[GitHub App 用户授权与 PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[撤销单个授权令牌](https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-token)。

### 可选的 Pages 服务入口（接入尚未执行）

当 `workers.dev` 无法正常访问，但 Pages 测试入口可访问时，可以使用同一账号的 Service binding。请求在 Cloudflare 内部进入原 Worker，浏览器只连接 Pages 地址；无需在新项目复制 GitHub Client Secret 或会话密钥。

1. 使用 `upload-service/pages-gateway/public/` 作为上传内容，ZIP 根目录包含 `index.html` 和 `_worker.js`。该目录没有照片、城市数据或密钥。控制台上传配置与 `upload-service/pages-gateway/wrangler.jsonc` 保持一致。
2. 在 Pages 的 **Production** 配置中设置公开变量 `PUBLIC_SERVICE_ORIGIN=https://travel-footprints-upload-check.pages.dev`，添加 Service binding：名称 `UPLOAD_SERVICE`，只连接现有 `travel-footprints-upload` Worker。不要给预览环境增加绑定。Runtime 使用 `2026-10-01`，Fail open/closed 设为 **Fail closed**，避免额度耗尽时跳过函数处理。添加绑定后需要重新部署。
3. 将原 Worker 的 `SERVICE_ORIGIN` 和 GitHub App 的 Callback URL 分别改为这个 Pages origin 和该 origin 下的 `/auth/callback`。保持现有 App、目标仓库、所有者 ID、密钥和权限范围不变；同步修改原 Worker 的 `wrangler.jsonc`，防止后续部署覆盖配置。
4. 重新部署 Pages 接入包。先确认 `/health` 返回的是实际服务的 `{"ready":true}`，再验证受限来源、未登录拒绝、真实 GitHub 登录、照片提交及网站发布。连接测试包的 `status: ok` 不代表实际上传服务已接入。
5. 完成验证后再发布地图前端服务地址。需要回退时，恢复 Pages 连接测试部署，并同时恢复原 Worker 的 `SERVICE_ORIGIN` 与 GitHub App Callback URL；现有地图相册不受影响。

入口按原样转交请求和响应，不更换请求域名、不移除登录要求、不增加 CORS 来源。其本地测试覆盖预览域名拒绝、请求体与 Cookie/Authorization 保留，以及通过实际 Worker 处理器验证未登录、来源限制和 PKCE 回调地址。测试没有调用真实 GitHub API。

官方参考：[Pages Service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings)、[Pages Advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)、[Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)。

## 实现边界

`site/photo-upload.js` 只处理界面、本机图片转换和上传服务的短期会话。GitHub 凭据不暴露给页面；浏览器内存中的一小时服务会话是加密封装，刷新后需要重新登录。登录使用 state + PKCE 和 HttpOnly/Secure/SameSite=Lax cookie；回调仅向固定的地图 origin 返回会话，前端同时核对弹窗来源、窗口与随机 nonce。

`upload-service/worker.js` 在每次请求中重新校验 GitHub 稳定用户 ID、仓库 ID 和当前写权限。只接受固定 origin，不接受客户端指定仓库、分支或写入路径。API 没有通用文件写入能力。

`upload-service/github.js` 读取同一提交中的城市记录和相册；拒绝不存在的城市或到访月份。JPEG 内容摘要决定文件名，重试已成功的保存不会重复插图。创建图片 blob 和相册树后，用一个提交和非强制分支更新发布；发生并发冲突时不会覆盖另一位编辑者的提交。失败的 Git 对象创建可能留下不可达对象，但不会形成部分相册提交。

相册解析位于 `site/album-model.js`，构建和服务使用同一验证逻辑。`data/places.geojson` 不会因上传而改变。静态导出不包含 `upload-service/`、配置密钥、测试或开发文档。

## 验证状态

已执行现有地图检查、官方 Pages CMS 配置验证、Wrangler 4.149.0 的 Worker 预打包及 11 项上传服务自动测试：未登录/错误来源拒绝、身份与权限校验、OAuth state/PKCE、元数据移除、非法图片/月份拒绝、单次原子提交、并发冲突和丢失响应后的幂等重试。另有 5 项 Pages 服务入口测试。测试使用模拟 GitHub API 与合成图片，**不代表真实 GitHub 登录和云端写入已经验证**。

已查看英文、中文桌面和中文手机空表单。自动选择本地照片被浏览器审批拦截，没有绕过；真实文件选择、拖放、缩略图队列、实际登录及云端保存仍需验证。连接服务前不要合并为已完成的生产功能。
