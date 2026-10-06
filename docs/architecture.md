# 架构说明

## 运行时边界

```text
Browser
  ├─ App ──> services/router（/、/my-anime、/journey、/settings）
  ├─ 发现页 GuidePage ──> services/anilistService ──> AniList GraphQL
  ├─ 我的番剧 MyAnimePage ──> features/archive/myAnime（按观看状态分组）
  ├─ 观看历程 JourneyPage ──> features/journey/journeyEvents（只读 userHistory）
  │     └─ 口味地图 TasteMapView ──> features/taste/tasteModel（状态 + 明确感受）
  ├─ App/use archive actions ──> shared/storage/archiveStorage ──> localStorage
  ├─ SettingsPage / SQL import ──> schema + preview ──> App merge ──> localStorage
  └─ AI feature ──> GET /api/deepseek/status（v1：disabled，不上传 Prompt）
                    ├─ 站点 AI（需 SITE_AI_ENABLED=true + DEEPSEEK_API_KEY）──> server.mjs ──> DeepSeek
                    ├─ personal session config ──> user endpoint (direct)
                    └─ ChatGPT 协作模式（用户自行复制粘贴）
```

静态生产服务由 `server.mjs` 提供：HTML、带 hash 的 JS/CSS、`/data/` JSON 和图片采用不同缓存策略；未知的 extensionless path 回退到 `index.html`，缺失带扩展名资源返回 404。

## 状态所有权

| 状态            | 所有者                                                 | 说明                                                                                                    |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 当前 route      | `App.tsx` + `services/router.ts`                       | 四个目的地与查询参数的解析/格式化；`pushState`/`replaceState`/`popstate`，没有引入路由库。见下文。      |
| 年鉴 ID/详情    | `App.tsx` + `shared/storage/archiveStorage`            | UI 状态使用 `Set`/`Map`，存储层负责兼容键、损坏隔离和写入。                                             |
| 年鉴写入规则    | `features/archive/archiveOperations.ts`                | 新增条目、状态变更与历史时间、点评/日期编辑、导入合并与预览的纯函数；JSON 与 SQL 恢复共用同一合并实现。 |
| 观看历史日期    | `shared/schemas/history.ts` + `shared/i18n/dates.ts`   | 历史日期的校验、精度、比较与用户输入解析；显示时按语言格式化，存储保持 ISO。                            |
| 存储 schema     | `shared/storage/archiveStorage.ts`                     | `anime-horizon-archive-schema` 记录版本（当前 4）；读取时确定性、幂等地迁移旧记录。                     |
| 存储完整性      | `App.tsx`（`integrityIssue`）+ `ArchiveRecoveryNotice` | 读取时有条目无法校验或数据无法解析时暂停保存，原始数据保留到用户下载或明确选择“只保留能读取的作品”。    |
| 界面语言        | `shared/i18n/I18nProvider` + `locales.ts`              | 用户显式选择保存在 `anime-horizon-locale`；未选择时跟随浏览器语言，见 `docs/i18n.md`。                  |
| AI 鉴赏档案缓存 | `App.tsx`（`analysisByLocale`）                        | 成功结果按输出语言分别缓存，切换语言不会复用另一种语言的档案；失败不缓存。                              |
| 目录季度数据    | `GuidePage`                                            | 组件负责当前季 loading/abort；`App` 只保留最近当前视图数据给导出和其他 modal 使用。                     |
| 目录缓存/请求   | `services/anilistService.ts`                           | TTL、容量、in-flight Promise 去重和 schema 校验集中在服务层。                                           |
| AI session 配置 | `services/geminiService.ts` + `shared/schemas/ai.ts`   | 只写入 `sessionStorage`，不进入默认代理请求。                                                           |
| 备份迁移        | `features/backup/backupSchema.ts`                      | 版本校验、数量限制、领域 normalizer 和去重在确认写入前完成。                                            |

## 路由与目的地

产品只有四个一级目的地：桌面端是页头中的导航链接，约 390px 的手机上是页头下方的四格导航。各目的地的职责见 `docs/product-structure.md`。

| 路径                                              | 视图                | 说明                                                                                           |
| ------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| `/`                                               | 发现（Discover）    | 季度目录、搜索、推荐入口；年份/季度仍是页面内状态，不进入 URL。                                |
| `/my-anime?status=watching\|plan\|completed\|all` | 我的番剧            | `status` 可省略：进入时选第一个非空分组（在看 → 想看 → 看过 → 全部），并在本次访问内保持不变。 |
| `/journey?year=YYYY`                              | 观看历程            | `year` 省略或没有对应事件时显示最近有事件的年份。                                              |
| `/journey/taste`                                  | 观看历程 → 口味地图 | 时间线与口味地图之间用 `pushState` 切换，可前进/后退；标题为“口味地图 · Anime Horizon”。       |
| `/settings`                                       | 设置                | 语言、备份/恢复、SQL、AI 与隐私、发现页年份范围、数据管理。                                    |
| `/archive`、`/discover`                           | 别名                | 加载时用 `replaceState` 规范化为 `/my-anime`、`/`，旧书签不失效。                              |
| 其他路径                                          | 未找到              | 显示“页面不存在”和回到发现页的按钮；URL 保持原样，不静默跳到首页。                             |

- **导航**：切换目的地用 `pushState`，可前进/后退；页面内状态（我的番剧分组、观看历程年份）用 `replaceState`，不会塞满历史记录。刷新或直接打开任何上述 URL 都还原同一视图（生产服务器对 extensionless path 回退 `index.html`）。
- **焦点与标题**：切换目的地后滚动到顶部，焦点移到该页 `h1`（`tabIndex=-1`）；`document.title` 为“{目的地} · Anime Horizon”，发现页保持站点标题。当前目的地的链接带 `aria-current="page"`。
- **语言切换不改变路由**：语言只影响渲染文本，URL 与年鉴数据保持不变。

## 观看历程派生

`features/journey/journeyEvents.ts` 是唯一把年鉴转换为时间线的地方，页面只消费它的结果。规则（精度、分组、排序）见 `docs/data-model.md#观看历程的派生规则`。要点：

- 事件只来自 `userHistory`；AniList 的季度、年份、播出状态从不参与。
- 摘要只陈述事实（当年看完/开始的数量、在看数量、有日期的作品占已观看作品的比例），没有分数、排名或 AI 结论。

## 口味模型

`features/taste/tasteModel.ts` 是唯一从年鉴推导口味的地方，口味地图、AI 鉴赏档案与全站画像都只消费它的结果；完整规则见 `docs/taste-model.md`。要点：

- 接触（已看完 = 1、在看 = 0.5）、偏好（看过作品上的明确感受）、未知（看过但没有感受）、意向（想看）分开统计；想看从不算作看过或喜欢，没有感受从不算作“一般”。
- 每个结论都带着计数；某题材少于 3 部有感受的已看作品时不判断方向。没有总分、等级、人格标签或百分比可信度。
- AI 提示词中的“口味证据”由 `services/archivePrompt.ts#formatTasteEvidence` 从模型生成；鉴赏档案缓存只存在于当前会话内存中并按语言区分，因此模型版本变化不需要额外的缓存键。

## 推荐

推荐（发现页的“为你推荐”）由 `features/recommendations/` 中的确定性规则产生，不使用 AI，完整规则见 `docs/recommendations.md`：

- **A 候选生成**：`sources.ts` 选出作为来源的作品（只有看过且喜欢/非常喜欢的作品是正向来源；想看从不作为来源，除非完全没有看过的作品），`candidates.ts` 从 AniList 推荐关系中收集候选并排除年鉴中已有的作品、未开始或不喜欢的作品的续作。
- **B 排序**：`ranking.ts` 只是口味模型之上的一层，按标题关联、口味模型的题材倾向和很弱的人气先验打分，排序是全序（分数 → 标题关联 → 人气 → AniList ID），没有随机性。
- **C 解释**：`explanations.ts` 只读取打分用的同一份证据，因此理由不会与排序矛盾。
- `services/anilistService.ts#fetchRecommendationGraph` 只负责取数（排序、去重后的来源 ID，按来源顺序返回，完整结果缓存）；来源集合不变时不会重新请求，所以把推荐加入想看只会让这一张卡片消失，其余顺序不变。

## 看番回忆（Recall）

观看历程 → 看番回忆（`/journey/recall`）是唯一保留的小游戏：`features/recall/recall.ts` 是纯函数，只从“已看完”的作品出题，选项围绕作品的播出季度生成，不依赖当前日期，也不调用 AI；作答后只显示用户自己记录过的日期、感受和短评。它只读年鉴，不写入任何数据，也不影响口味模型和推荐。详见 `docs/recall.md`。Phase B4 移除了其余小游戏、快速测评、页头“更多”菜单以及对应的 AI 游戏服务；旧的游戏统计键在启动时清除（`shared/storage/retiredStorage.ts`）。

## 目录请求生命周期

1. `GuidePage` 根据年份和季度建立唯一 cache key；一个季度总是整体加载，不再有“单季数量”参数。
2. 服务层先检查 TTL 缓存，再检查相同 key 的 in-flight Promise。
3. 新请求携带 `AbortSignal`；组件卸载或参数切换时取消请求。
4. 远程响应经过 AniList schema 校验（见第 6 条），再转换为应用自己的 `Anime`。
5. 网络失败按有限次数重试；4xx、GraphQL 错误和 schema 错误不重复重试。
6. 网络响应先只校验外层结构，再逐条校验作品与推荐关系：个别格式错误的条目被跳过并计数（控制台给出一次警告），同一页其余有效条目保留；整页没有任何有效条目时仍按 schema 错误失败。本地 `/data` 文件仍整体严格校验。
7. local 模式优先读取 `/data/anime-<year>.json`；`local-strict` 缺失或损坏时直接失败，普通 local 才允许回退远程。

## 数据与信任边界

- AniList、AI、上传文件、粘贴文本和浏览器存储都视为不可信输入。
- `shared/schemas` 和 `normalizeAnimeRecord` 是进入 UI、缓存和持久化前的边界。
- AI 文本只作为结构化内容展示，不执行为 HTML、SQL、JavaScript 或系统命令。
- 默认 AI 代理只接收 Prompt，由服务端决定上游 URL、Key 和模型；个人模式明确绕过本站，由用户承担 endpoint 信任和 CORS 责任。

## 当前刻意保留的简化

- `App.tsx` 仍是业务组合入口，尚未拆成完整的 `useArchive`/`useModalManager`。
- 路由仍是手写的 `parseRoute`/`formatRoute`，没有嵌套路由或按页分包；目的地数量增长后再评估路由库。
- 观看历程的事件每次在页面中从年鉴派生（`useMemo`），不持久化、不建索引；当前年鉴规模（≤2,000 条）下足够。
- localStorage 仍是跨刷新存储；在确认数据规模、迁移回滚和浏览器支持矩阵前，不直接迁移到 IndexedDB。

## 年鉴不变量

- **作品播出时间与用户观看时间是两个独立领域。** `userHistory`（收录、开始、看完、更新时间）只由用户操作或输入写入，从不根据 AniList 的季度、年份或播出状态推断；未知就是 `null`，迁移不会写入迁移时刻。详见 `docs/data-model.md`。
- **观看状态只来自用户。** 新收录作品一律为 `PLAN`（`services/archiveStatus.ts` 的 `DEFAULT_ARCHIVE_STATUS`）。AniList 的季度、年份和播出状态描述的是作品，不代表用户看过或正在看；缺少状态的旧数据和备份同样迁移为 `PLAN`。
- **导入只合并，不替换。** JSON 与 SQL 恢复都按 AniList ID 合并；导入中不存在的本地作品原样保留，解析失败或取消时不调用任何 state setter。
- **移出必须是明确动作。** 年鉴页的封面和标题只用于展示；移出需要点击“移出”并确认。所有移出（包括导视页、搜索和推荐中的取消收录）都会在提示条中提供“撤销”，恢复完整的状态、感受和短评。
- **季度目录按季度整体加载。** AniList 查询按 `POPULARITY_DESC, ID` 分页（每页 50，最多 6 页）；评分只影响界面排序，不决定哪些作品出现，未评分的新番同样可见。
- **AI 失败不是结果。** 鉴赏请求失败或返回空白内容时只设置错误状态，不写入、不缓存档案；重试会重新请求，已有的成功档案保留。
- **界面语言与数据分离。** 服务层只返回语言无关的代码或结构化数据（AI 错误、推荐理由、备份/SQL 错误、口味模型的计数与倾向），由组件按当前语言翻译；作品标题只使用 AniList 提供的字段，不做机器翻译。详见 `docs/i18n.md`。
