# 在地图内添加和移除旅行照片

城市相册支持选图、拖放、缩图、月份和说明表单，由 Cloudflare Worker 验证所有者身份后保存。**真实 GitHub 登录、读取相册、两座城市保存照片、仓库提交和线上图片发布均已验证。** 正式前端已配置公开服务地址；旧试用入口转至正式地图并保留城市链接。保存与发布是两个状态，只有正式网站的数据和图片都能读取时，界面才会确认发布完成。

## 接入状态（2026-10-10）

- Worker：`https://travel-footprints-upload.wangzhenhuan05.workers.dev`，已通过 Cloudflare 控制台发布打包程序和公开参数；运行日期为 `2026-10-01`，关闭运行日志，与仓库配置一致。
- GitHub App：`NaCr05 Travel Photos`（`nacr05-travel-photos`），只允许当前账号安装，仅授予 `travel-footprints-site` 的 Contents 读写和 Metadata 只读权限。未申请 Actions、Administration 或其他仓库权限。
- Client ID 和服务 URL 是公开参数，可保存在 `wrangler.jsonc`；Client Secret 和会话密钥只进入 Worker secrets，不提交到 Git。
- `GITHUB_CLIENT_SECRET` 和 `SESSION_SECRET` 已由所有者录入，控制台均显示为加密 Secret。不要在文档中记录密钥值。
- 控制台已确认生产 Worker URL 启用。测试网络的系统 DNS 与公共 DNS 查询结果不同；曾遇到 `ERR_CERT_COMMON_NAME_INVALID` 和连接重置，切换手机热点后仍超时。尚未确认具体原因；不应反复要求切换网络或绕过证书检查。
- 不带凭据的 HTTP `/health` 诊断收到 `200 {"ready":true}`，只证明程序运行及必需配置存在且格式符合要求，不能证明 HTTPS、GitHub 凭据或真实保存已验证。认证和上传必须使用 HTTPS，不应忽略证书错误或关闭证书校验。
- Pages 项目 `travel-footprints-upload-check` 已由所有者手动发布实际接入包，生产部署为 `178f10a6-0063-4e09-8a31-e6ee4d68f026`。此前的无凭据连接测试包已被替换。Chrome 能显示实际服务首页，地图登录弹窗也能经 Pages 跳转到 GitHub；旧测试包的 JSON 页面曾出现 `ERR_BLOCKED_BY_CLIENT`，不能据此认定实际浏览器 API 不可用。
- Pages Production 配置已保存并随新部署生效：`PUBLIC_SERVICE_ORIGIN=https://travel-footprints-upload-check.pages.dev` 和 `UPLOAD_SERVICE → travel-footprints-upload` Service binding（默认入口），并设为 Fail closed。Pages 的兼容日期为 `2026-10-10`，原 Worker 为 `2026-10-01`，均与仓库配置一致。
- 原 Worker 的 `SERVICE_ORIGIN` 已部署为 `https://travel-footprints-upload-check.pages.dev`；GitHub App 已确认保存 `https://travel-footprints-upload-check.pages.dev/auth/callback`，未启用通配符。现有密钥、目标仓库、所有者 ID 和权限范围均不变。
- `upload-service/pages-gateway/` 通过内部绑定调用原 Worker，保留登录校验和密钥；只允许固定正式域名及指定接口。自动审批拒绝代传 ZIP 后没有绕过，最终由所有者手动发布。
- 实际 HTTPS 检查：`GET /health` 为 `200 {"ready":true}`；带地图来源、未登录的 `/api/snapshot` 为 401；其他来源为 403；地图来源的上传预检为 204。`/auth/start` 为 302，返回地址是新的 Pages `/auth/callback`，使用 S256 PKCE 和 Secure/HttpOnly/SameSite=Lax cookie。实际部署的预览域名首页与 `/health` 均为 403。以上未使用真实凭据，不能证明 GitHub token 交换或仓库写入成功。
- 所有者在同源试用地图中完成 GitHub 授权，Chrome 显示 `Signed in as NaCr05` 和相册就绪状态。随后为罗马、扎金索斯各上传一张照片，分别形成提交 `04c0f4e`、`53d1157`，都归入 `2026-08`。罗马现有 3 张，扎金索斯现有 1 张；原两张罗马照片保留。
- 首次保存后的自动发布暴露出旧构建仍使用「1 座城市、2 张照片」的试用限制。`1927be9` 将静态构建与上传服务统一使用 `site/album-model.js`，并加入「原相册增加第三张、另一城市增加照片」的回归检查。该版本已由 GitHub Actions 成功发布；两个新图片 URL 返回 200，内容与仓库文件逐字节一致，服务端再次清理也未发现残留 APP/COM 元数据。
- 试用页面的前端副本已移除，仅保留同源跳转页面；后续从[正式地图](https://nacr05.github.io/travel-footprints-site/)的城市相册使用「添加照片」。旧试用链接保留所选城市后转入正式入口。

## 使用流程

进入一座城市，在「旅途相册」旁点击「添加照片」。选择或拖入 JPG、PNG、WebP，可以先在本机预览；选择已有到访月份，也可以放入不关联月份的城市相册。每张照片可以填写说明。

所有者通过弹出的 GitHub 窗口登录，回到同一个地图页面点击「保存照片」。照片与相册关联一次写入仓库；仓库确认成功后，当前相册、管理列表和城市封面立即更新。新照片在正式文件发布前使用本机预览显示，状态为「已保存，公开网站正在后台同步」。此时可以关闭表单、切换城市或继续编辑，不需要等待发布或反复点击检查按钮。

后台自动读取正式网站，核对构建包含此次保存、相册内容正确且新图片可读取后，状态变为「已公开」，并用正式图片替换本机预览。保存失败时不改动相册，保留所选草稿供重试。保存前不会上传照片。关闭表单会保留当前城市的本机草稿；刷新或关闭整个网页会丢失未保存草稿及本机预览，但已成功保存的内容仍在仓库，网站继续发布。发布完成前重新打开网页，仍可能暂时看到旧版公开相册。

- 每批最多 5 张，原图每张不超过 20 MiB、6000 万像素。
- 新上传图片在浏览器中解码，按正确方向缩至长边不超过 1920 像素，再编码为 JPEG；透明区域使用白底。服务端再次检查 JPEG 结构与尺寸，移除 APP/COM 元数据，包括 EXIF、GPS 和 XMP。服务端不是完整图像解码器。
- 每张新图片不超过 2 MiB；每个「城市 + 月份」相册最多 24 张。已有 Pages CMS 原图保持原样，仍按 8 MiB 的兼容上限检查。
- 图片会进入公开仓库。这里只清除新上传版本的元数据，不会处理照片画面中的个人信息，也不会修改设备原图。
- 已有照片的城市显示「管理照片」，进入后可以在「添加照片」与「管理照片」之间切换。排序和修改已保存说明仍可使用 Pages CMS。两个编辑器共享同一相册文件，避免同时保存；地图编辑器检测到并发修改会保留草稿并要求重新读取。

### 移除已保存的照片

1. 打开城市，点击「管理照片」，使用原来的 GitHub 账号登录。
2. 选择到访月份，点击照片旁的「移除」。通过地图或 Pages CMS 保存的照片都在同一列表中。
3. 确认页显示照片、城市和月份。选择「保留照片」可取消；选择「从相册移除」才会提交修改。
4. 提交成功后，该照片立即从当前相册和管理列表移除；界面自动返回列表，可以继续操作。公开网站的发布在后台进行，完成后状态自动变为「已公开」。

只移除当前「城市 + 月份」中的关联。图片若被其他相册或原始城市记录使用，会保留文件；没有其他引用时，会在同一提交中删除相册关联和当前分支的图片文件。设备原图和 Git 历史版本保留，因此这不是历史内容清除工具。移除该相册的最后一张照片会清理空相册，不会改变城市或到访月份。直接写在原始城市记录中的照片继续由城市数据编辑流程维护。

移除 API 为 `DELETE /api/photos`，沿用现有登录、所有者和仓库权限检查。仅接受当前相册中校验过的照片路径，不能删除任意仓库文件。分支改变时要求重新读取后再次选择；网络中断后可安全重试，已经不存在的关联不会触发额外删除。前端检查 `canRemove` 能力，服务未升级时保持移除按钮禁用。部署顺序是先更新现有 Worker，再发布地图；现有 Pages gateway 已支持原样转发 DELETE，无需增加入口、密钥或权限。

实现参考：[GitHub Git trees API](https://docs.github.com/en/rest/git/trees#create-a-tree)。使用 `base_tree` 保留其他内容，`sha: null` 仅用于本次已校验且不再被引用的照片，再以非强制更新提交到主分支。

移除功能验证（2026-10-10）：本地地图检查和 24 项服务/入口测试通过；覆盖身份与来源拒绝、原子移除、最后一张照片、跨城市/月与原始记录共用图片、非法路径、过期编辑、并发写入及响应丢失后的重试。已用仅在内存中修改的本地副本走通桌面英文、手机中文确认、取消、提交、等待发布、发布后刷新和返回相册。该本地流程不会写入真实 GitHub；现有四张照片保留。真实线上移除应由所有者选择具体照片后验证，不把模拟测试当作真实删除证据。

现有 Worker 已通过控制台部署为 `82233e3f`（Active / Latest）。编辑器内容与通过测试的打包程序一致，编辑器诊断为零；正式 Pages 服务入口的 DELETE 预检返回 204，允许的方法包含 DELETE，未登录移除返回 401。没有更改服务绑定、登录返回地址、密钥或 GitHub App 权限。

### 当前相册及时更新与后台发布（2026-10-11）

- `site/photo-sync.js` 只投影已经得到服务成功响应的修改，不把未完成的请求当作成功。相册显示与公开发布状态分开，关闭表单和切换城市不会丢失待确认的修改。
- 复用服务返回的新提交号和相册内容继续编辑，短时间内切换添加/管理视图不再重复读取整个仓库。服务端仍对每次写入重新校验权限与分支，并发冲突仍要求重新读取。
- 自动检查从约 1.5 秒开始，逐步退避到 30 秒；单轮最长 10 分钟。隐藏页面或离线时暂停网络检查，重新显示或恢复网络时继续。未能确认时保留当前相册并显示重试入口，不重复上传、删除或撤销已成功保存的内容。
- 静态导出在公开地图数据中加入最近 64 个提交号；构建签出相应历史。只有包含此次写入的构建、对应相册内容以及图片可用性都通过检查，才确认公开发布。因此「先添加再删除」不会把内容恰好相同的旧网站误认为新发布，也能识别跳过中间排队版本的后续构建。超出记录窗口或构建失败时，界面保留待确认状态。
- 较旧的检查响应不能覆盖较新的操作。更新仅替换照片区域与变化的封面，保留浏览位置和编辑表单；本机预览 URL 在正式图片可读后释放。
- 此改动仅更新前端与静态发布流程，不改变上传服务、登录权限或用户照片数据。13 项同步回归测试及原有 24 项服务/入口测试通过，包含「网站发布先于保存响应」的顺序检查。隔离本地预览在故意暂停发布时，测得照片和封面更新约 4–40 ms（从模拟保存响应返回计起）；该数字不包含真实网络上传或 GitHub 保存耗时，不是线上性能承诺。

## 首次部署（所有者操作）

1. 注册/登录 Cloudflare，使用 Workers。网站本身继续留在 GitHub Pages，网址不变。
2. 在 `upload-service/` 执行 `npm ci` 安装锁定的官方 Wrangler；`npm run bundle` 只检查打包，`npm run deploy` 才部署。先部署未配置凭据的服务取得实际 `workers.dev` 地址；该状态只报告尚未配置，不能写仓库。
3. 注册一个 **GitHub App**，首页为地图网址；Callback URL 为 `https://实际服务地址/auth/callback`。仅申请 repository **Contents: Read and write**，Metadata 自动只读；关闭 webhook，不申请 Actions、Administration 或 Workflows 写权限。启用用户授权的过期令牌。仅允许在自己的账号安装，然后只安装到 `travel-footprints-site`。
4. 在 `upload-service/wrangler.jsonc` 填实际 `SERVICE_ORIGIN` 和 App Client ID。现有非敏感配置固定目标仓库、仓库 ID、所有者稳定用户 ID 和 `main` 分支。其他人复用时必须更换这些值。
5. 将 App Client Secret 保存为 Worker secret `GITHUB_CLIENT_SECRET`；另外生成至少 32 字节密码学随机值（base64url 后至少 43 字符），保存为 `SESSION_SECRET`。通过 `wrangler secret put` 的标准输入或 Cloudflare 控制台录入，不能写进仓库、前端配置、截图或命令参数。
6. 重新部署 Worker。在浏览器核对 `/health` 返回 `ready: true`；用实际 GitHub 所有者完成登录。只用一张准备公开的照片验证一次保存、仓库提交及正式网站发布，再配置 `site/upload-config.js` 的公开服务 URL，合并发布网页入口。

第 6 步可以先使用同源的独立地图试用入口接入实际服务，验证后再配置正常首页。试用入口没有另外的数据库，保存会写入正式公开相册，因此只选择准备公开的照片；发布程序也必须使用相同的相册验证规则。正式服务仅接受正式地图 origin；不要为本地测试放宽生产 CORS。需要完全隔离测试时，应使用独立 Worker 配置、测试仓库/分支及 HTTPS 测试页面。

也可通过 Cloudflare 控制台发布 Wrangler 生成的单文件打包产物；本次采用此方式。控制台中的公开变量、兼容日期和日志设置需要与 `wrangler.jsonc` 保持一致，密钥单独保存为 Secret。无需把账户令牌或本机 GitHub CLI 登录信息复制给上传服务。

Cloudflare 尚无账号时，先完成网页本地预览和自动测试即可；不要填写虚构服务地址或把 GitHub CLI 的个人令牌挪用为网页凭据。

官方参考：[Workers 部署](https://developers.cloudflare.com/workers/get-started/guide/)、[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)、[GitHub App 用户授权与 PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)、[撤销单个授权令牌](https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-token)。

### 可选的 Pages 服务入口（已发布并通过基础连通检查）

当 `workers.dev` 无法正常访问，但 Pages 测试入口可访问时，可以使用同一账号的 Service binding。请求在 Cloudflare 内部进入原 Worker，浏览器只连接 Pages 地址；无需在新项目复制 GitHub Client Secret 或会话密钥。

1. 使用 `upload-service/pages-gateway/public/` 作为上传内容，ZIP 根目录包含 `index.html` 和 `_worker.js`。该目录没有照片、城市数据或密钥。控制台上传配置与 `upload-service/pages-gateway/wrangler.jsonc` 保持一致。
2. 在 Pages 的 **Production** 配置中设置公开变量 `PUBLIC_SERVICE_ORIGIN=https://travel-footprints-upload-check.pages.dev`，添加 Service binding：名称 `UPLOAD_SERVICE`，只连接现有 `travel-footprints-upload` Worker。不要给预览环境增加绑定。Pages Runtime 使用 `2026-10-10`，Fail open/closed 设为 **Fail closed**，避免额度耗尽时跳过函数处理。添加绑定后需要重新部署。
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

已执行现有地图检查、官方 Pages CMS 配置验证、Wrangler 4.149.0 的 Worker 预打包及 11 项上传服务自动测试：未登录/错误来源拒绝、身份与权限校验、OAuth state/PKCE、元数据移除、非法图片/月份拒绝、单次原子提交、并发冲突和丢失响应后的幂等重试。另有 5 项 Pages 服务入口测试。这些自动测试使用模拟 GitHub API 与合成图片；真实登录、保存与发布的证据单独记录于接入状态。

已查看英文、中文桌面和中文手机空表单，并在真实 HTTPS 地图中验证城市相册加载、GitHub 所有者授权、登录返回和已登录相册读取。照片由所有者亲自选择并保存，已核对两个真实提交、发布任务、线上相册关联、图片字节及浏览器图片加载。此前自动选图受到审批限制，没有绕过；拖放手势和处理中队列未单独自动回放，因此不将它们列为已完成的浏览器自动化检查。
