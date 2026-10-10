# 维护城市记录

主数据为 `data/places.geojson`。每个 Feature 对应一座城市，通过固定 `id` 关联点位、卡片和详情链接。

这是公开仓库，文件与历史都可被访问。只保留准备公开的旅行记录；原始工作簿、整理表和私人核对资料保存在仓库之外。

## 城市记录格式

下面以现有吉隆坡记录说明字段格式。新增城市时，在 `features` 数组中添加一条记录，替换 ID、城市与国家、代表坐标和月份，避免重复添加已有城市：

```json
{
  "type": "Feature",
  "id": "kuala-lumpur",
  "geometry": { "type": "Point", "coordinates": [101.68653, 3.1412] },
  "properties": {
    "name": "吉隆坡",
    "nameEn": "Kuala Lumpur",
    "displayName": "吉隆坡",
    "country": "马来西亚",
    "countryCode": "MY",
    "region": "吉隆坡联邦直辖区",
    "category": "visited",
    "visits": [{ "when": "2025-12", "precision": "month" }],
    "photos": [],
    "link": null,
    "note": "",
    "sourceInput": { "city": "吉隆坡" }
  }
}
```

坐标依次为经度、纬度。`category` 可为 `visited`（到访）、`residence`（常住）、`frequent`（常去）。常住和常去记录的 `visits` 保持空数组；`sourceInput.city` 仅用于可公开的城市别名搜索，不放原表行号、原始日期或私人来源说明。修改后同步更新文件顶层的 `updatedOn` 日期。

## 添加照片

在项目中建立 `photos/` 文件夹，放入选好的个人照片。在城市 `properties.photos` 中填写下列格式。这里是格式示例，不是现有照片：

```json
"photos": [
  { "src": "./photos/rome-01.jpg", "caption": "罗马的一段回忆" }
]
```

也可以在某次 `visits` 的 `photos` 中填写，照片将保留对应月份：

```json
{
  "when": "2026-08",
  "precision": "month",
  "photos": [{ "src": "./photos/rome-01.jpg", "caption": "照片说明" }],
  "link": null
}
```

相对路径从项目根目录计算，使用 `/`；GitHub Pages 文件名区分大小写。也支持 HTTPS 图片地址。第一张可用照片作为详情封面，相册照片可点击放大；缺失的照片会显示加载失败状态。没有照片时保留详情小地图和相册空状态，当前没有网页上传管理后台。侧栏保持简洁文字列表。

## 添加游记

城市 `properties.link` 对应城市游记；某次到访的 `visits[].link` 对应该次记录。可使用完整网址或项目中的静态网页路径，例如 `./stories/rome.html`。填入有效地址后，详情才显示跳转入口。Markdown 文件本身不等于已经渲染的 HTML 网页。

## 添加月份和城市

同一城市再次到访，在 `visits` 增加 `YYYY-MM` 记录，不新增重复城市。常住、常去保持类别，未知月份留空。

新增城市应核对同名地点、国家和经纬度；地理资产来源集中记在 `data/sources.json`。各国底图统一使用灰色，不需要额外设置国家颜色。这个公开项目只维护 GeoJSON，不依赖 Excel 或 CSV。

修改后运行 `npm run check`，它会重新生成 SVG 封面，并检查公开字段、重复 ID、坐标、日期、图片标记和交互数据逻辑。在预览中核对点位、月份、筛选和照片，再提交到本仓库。`main` 的更新会自动检查并发布，网站地址不变；Actions 显示成功后再检查正式网页。无需另外导出并上传 ZIP。

生成的 `assets/*.svg` 与城市数据一起提交；`docs/build-check.json` 是本地生成的检查结果，已忽略。交互逻辑检查使用虚构的固定样例，新增真实城市无需修改测试中的人数或月份计数。

## 调整页面

`site/styles.css` 顶部是颜色变量，默认深色；`.pin-dot` 控制光点大小，外层透明按钮保留可点击区域。`site/app.js` 管理地图与侧栏；`site/model.js` 管理筛选、时间线和链接。`index.html` 保存导航和基本文案。

底图只包含国家轮廓。如希望查看街道、地形，需要另外选择瓦片底图，并考虑其网络、许可和使用额度。
