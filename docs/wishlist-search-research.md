# Wishlist 城市搜索与推荐研究

核对日期：2026-10-11。范围：城市选择、推荐来源、数据保存与开源复用；本次没有修改生产代码、接入新服务或发布网站。

## 建议

第一版采用 **GeoNames 本地城市目录 + 人工维护的中英别名 + 人工策展的目的地推荐**。打开添加窗口立即显示推荐，输入后在本地检索，选中城市再填写可选理由。城市和理由公开，仅地图主人可编辑（用户已确认）。这能避免搜索时等待海外 API，也不要求使用者申请新账号或暴露密钥。在线搜索保留为将来的显式“搜索更多地点”，不作为第一版输入联想的必需依赖。以上是本项目的设计建议，不是上游服务的保证。

## 方案比较

| 方案 | 已核对的能力与条件 | 对本项目的判断 |
| --- | --- | --- |
| GeoNames 下载数据、本地搜索 | 原始数据 CC BY 4.0，允许商用与再分发，需署名；提供稳定 ID、坐标、国家、行政区、名称与别名。[导出说明](https://www.geonames.org/export/)、[数据格式](https://download.geonames.org/export/dump/readme.txt) | 首选。联想、排序、简繁/拼音别名由我们控制；需要构建与维护目录。 |
| Open-Meteo Geocoding | 搜索返回 GeoNames ID、WGS84 坐标、行政区、国家、地物类别；可指定语言与国家；两字符是精确名称匹配，三字符起为规范化前缀匹配。[接口文档](https://open-meteo.com/en/docs/geocoding-api) | 无 key 试验方便，但中文名称及拼音覆盖不能想当然；有下述实测与许可文本差异。可选后备。 |
| 公共 Nominatim | 明确禁止 autocomplete；所有用户合计上限 1 请求/秒，还要求标识应用、署名、可切换服务等。该政策限定 OSMF 公共实例。[官方政策](https://operations.osmfoundation.org/policies/nominatim/) | 排除，不用来实现“边输入边出建议”。自建实例是另一个运维项目，本次没必要。 |
| Geoapify Autocomplete | 原生支持部分输入、`type=city`、国家过滤与语言参数；须注册取得 API key，可限制来源。[文档](https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/) | 未来目录覆盖不足时的托管备选；本次没有注册或测试其中文质量。 |

Geoapify 当前 Free 方案为 3,000 credits/天、最多 5 请求/秒，允许商业生产用途，需 Geoapify 及数据来源署名。[价格页](https://www.geoapify.com/pricing/) 官方允许保存结果，但必须保留数据来源署名；其条款要求 OpenStreetMap 署名，免费方案另要求 Geoapify 署名。[保存说明](https://www.geoapify.com/geocoding-api/)、[条款](https://www.geoapify.com/terms-and-conditions/) 若未来使用，建议通过现有服务代理并限流，密钥不写入公开仓库；不让所有开源部署共用作者配额。这是本项目建议。

## 本地目录的覆盖与体积

GeoNames README 描述 `cities15000` 约 25,000 条（人口超过 15,000 或首都），`cities5000` 约 50,000 条（人口超过 5,000 或 PPLA）。这是人口/行政级别筛选，**不等于全球全部城镇，也不是旅游热度榜**。README 的数量是约数，本次未解包统计。[数据格式](https://download.geonames.org/export/dump/readme.txt)

2026-10-11 读取的官方目录列出：`cities15000.zip` 3.2M、`cities5000.zip` 5.4M、`alternateNamesV2.zip` 195M，文件日期为 2026-10-10。这是原始 ZIP 大小，不是生成后网页传输量。[官方文件目录](https://download.geonames.org/export/dump/)

建议以 `cities5000` 作为构建输入，补充有旅游价值但未入目录的小镇。构建阶段筛出必要字段与 en/zh/zh-Hant 名称；不得把 195M 的完整别名包发给浏览器。首屏只带推荐条目，第一次打开搜索才懒加载压缩目录；若生成体积或手机检索耗时过大，再按国家/区域拆分、在 Worker 线程搜索。初始性能预算可定为首批搜索目录压缩后不超过 1–2MB、加载后输入反馈不超过约 100ms；**这是待测目标，尚未得到构建产物或性能实测**。

别名文件有语言与首选名称标记；主表 `asciiname`/`alternatenames` 还包含 ASCII 转写，但没有“任意中文地名的拼音必定可搜”的保证。[数据格式](https://download.geonames.org/export/dump/readme.txt) 本项目应另维护少量可审阅的常用别名，例如东京 / 東京 / Tokyo、罗马 / 羅馬 / 罗马市 / Rome / Roma；中文城市拼音与海外城市中文拼音要分开验证，不能依赖简单转写自动解决所有多音字。

建议排序：完整名称/人工别名精确匹配 → 前缀匹配 → 受限容错；人口只用于同名候选的辅助排序。每行始终显示“城市 + 国家 + 一级行政区”，禁止自动把第一条结果加入愿望清单。已有/已加入状态用稳定地理 ID 判断，不用城市名字符串去重。

## Open-Meteo 少量只读实测

2026-10-11 10:59–11:01（UTC+8），本机 Node `fetch` 请求官方 `/v1/search`；共 20 次独立查询，`count=5`。下面仅列关键观察；这不是完整语言覆盖率或中国网络可用性测试。没有提交用户理由或个人信息。

| 输入 / language | 返回观察 |
| --- | --- |
| Tokyo / zh | 首项日本东京，ID 1850147，显示名称“東京”；后续还有其他国家同名地点。 |
| 东京 / zh | 返回 2 个中国同名居民点；没有返回日本首都。 |
| 東京 / zh | 返回日本首都，ID 1850147。 |
| dongjing / zh | 前列是中国“洞井”“洞泾”等，不是日本东京。 |
| 重庆 / zh；Chongqing / zh | 均可找到 ID 1814906；英文拼音输入也出现同音/同名候选。 |
| 吉隆坡 / zh；Kuala Lumpur / zh | 可找到 ID 1735161；中文查询还返回机场，英文查询还返回其他地物。 |
| 洛杉矶 / zh；Los Angeles / zh | 可找到美国城市 ID 5368361；英文查询也有智利等同名城市。 |
| 罗马 / zh | 第一条是澳大利亚 Roma（ID 2151187），随后有中国同名地点；不能取首条充当意大利罗马。 |
| Rome / zh | 第一条为意大利罗马 ID 3169070，显示“罗马市”。 |
| 东京、重庆、重慶、吉隆坡、洛杉矶、罗马 / en | 本次这些中文输入均返回 0 条。不能把 `language` 仅当展示语言、忽略输入语言。 |
| 巴黎 / zh；北京 / zh | 均找到预期首都，也有同名候选。 |

可复核的官方只读请求：[东京](https://geocoding-api.open-meteo.com/v1/search?name=%E4%B8%9C%E4%BA%AC&count=5&language=zh&format=json)、[東京](https://geocoding-api.open-meteo.com/v1/search?name=%E6%9D%B1%E4%BA%AC&count=5&language=zh&format=json)、[罗马](https://geocoding-api.open-meteo.com/v1/search?name=%E7%BD%97%E9%A9%AC&count=5&language=zh&format=json)、[Rome](https://geocoding-api.open-meteo.com/v1/search?name=Rome&count=5&language=zh&format=json)。结果可能随上游数据改变。

带 `Origin: https://nacr05.github.io` 的后 8 次响应返回 `Access-Control-Allow-Origin: *`；这只证明本次响应的 CORS 头，不等于已完成地图浏览器集成。前 12 次本机响应约 0.22–0.96 秒；未控制网络、缓存和地理分布，不用此数字承诺速度。

对在线后备的实施含义：按输入文字选择/尝试语言，应用已核对的别名，只保留允许的居民点类型，显示国家地区并让用户确认；若用户查不到，给可解释的空状态和改用英文/其他写法入口。不能让地图的英文默认界面导致中文查询失效。

## 保存许可和开源边界

GeoNames 原始数据的 CC BY 4.0 允许复制、改编、再分发及商用；需要保留署名、许可链接，并说明筛选/改名等修改。[GeoNames 导出说明](https://www.geonames.org/export/)、[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 因而将用户选定城市的 ID、名称、国家、经纬度长期保存为仓库数据有明确的数据许可路径；代码许可与数据许可分别声明。

Open-Meteo 当前网站条款把 API 数据写为 CC BY 4.0，但免费 API 访问仅限非商业用途，并列出低于 10,000/天、5,000/小时、600/分钟的限制；无广告/订阅的个人站属于其非商业示例。[当前条款](https://open-meteo.com/en/terms) 然而官方 geocoding 仓库 README 仍写 API 数据 CC BY-NC 4.0、服务源码 AGPLv3，和网站文字存在差异。[官方仓库](https://github.com/open-meteo/geocoding-api#data-license) 本次不推断哪份文字已失效，也不承诺查询结果可无条件用于未来商业分发。个人非商用试验可评估，开源默认城市目录优先直接来自许可明确的 GeoNames 下载数据；若要推广成商业服务，需重新核对访问条款并澄清差异。

建议保存记录：内部 ID、GeoNames ID、`nameEn`/`nameZh`、国家代码、行政区、原始 WGS84 经纬度、可选理由、创建时间、数据来源与快照日期。地图显示投影坐标不能替代原始经纬度。理由由用户提供，不发送给地理搜索服务，也不用生成式模型臆造用户动机。

## 推荐不是搜索排序

本次未核验任何可直接嵌入并免费再分发的全球实时旅游热榜，不能据此断言此类数据不存在；第一版不声称展示实时热门。推荐方案为人工策展约 40–60 座跨区域目的地，每次先展示 8–12 个，提供“亚洲 / 欧洲 / 美洲 / 更多”或“城市漫游 / 自然 / 海边”标签；标题用“目的地灵感 / Destination ideas”，副文说明人工精选。数量是产品建议，不是统计结论。

推荐数据与愿望清单分离：推荐卡片不会自动成为用户想去的地方；点选后才填写可选理由并保存。已加入地点提示“已在清单”；已去过地点可标“去过”，是否允许“想再去”由产品选择。人口、行政级别可帮助排同名搜索结果，但不能标成旅游受欢迎程度。

未来若接真实排行，必须先选定指标（国际过夜游客、住宿人次、搜索量或预订量）、统计年份、地域范围及再使用条件，在界面保留来源/年份。不同指标不能混成一个没有定义的“热门”分数。

## 下一步最小验证

1. 离线构建目录样本与人工别名；量出实际压缩体积与移动端首搜耗时。
2. 回归样本覆盖东京/Tokyo/東京、罗马/Rome/Roma、重庆/chongqing、吉隆坡/Kuala Lumpur、简繁中文、带重音英文、同名城市、小城镇缺失、零结果与重复加入。
3. UI 先做推荐→搜索→选择→可选理由→确认的短流程；键盘选择、加载/空/错误状态齐全。
4. 后续新增 wishlist 数据与保存接口，复用现有 owner 身份检查；现有照片接口并不已经支持保存愿望清单。确认后即时更新本页，仓库和静态站点后台发布，沿用现有照片保存反馈原则。
