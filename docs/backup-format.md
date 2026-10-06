# 备份格式

## JSON v4（主格式）

```json
{
  "version": 4,
  "timestamp": "2026-08-01T00:00:00.000Z",
  "config": {
    "startYear": 2000,
    "endYear": 2027
  },
  "userSelection": ["101"],
  "userDetails": [
    {
      "id": "101",
      "title": {},
      "season": "WINTER",
      "seasonYear": 2024,
      "userStatus": "COMPLETED",
      "userReaction": "LIKE",
      "userHistory": {
        "addedAt": "2026-09-30T11:02:00.000Z",
        "startedAt": "2019",
        "completedAt": "2026-10-05T09:30:00.000Z",
        "updatedAt": "2026-10-05T09:30:00.000Z"
      }
    }
  ],
  "currentViewData": []
}
```

限制：文件最多 5 MB；年鉴详情最多 2,000 条；当前导视缓存最多 500 条；单个作品和用户字段遵循 `shared/schemas/anime.ts` 的边界。

### 迁移规则

- 未提供 `version` 的旧对象按 v1 读取。
- v1–v4 都会被转换为当前 v4 返回值；新备份写入 v4。
- **感受（v4 起）**：缺少 `userReaction` 表示“没有标记感受”（未知），`NEUTRAL` 只表示用户明确选择的“一般”。v1–v3 中未标记的作品也被写成 `NEUTRAL`，与明确的“一般”无法区分，因此导入 v1–v3 时 `NEUTRAL` 读作“没有标记感受”；其他感受原样保留。
- v1/v2 备份没有 `userHistory`：导入后所有观看历史为未知（`null`），不会用导入时间补写。
- `userHistory` 逐字段校验：合法值为 UTC 时刻或 `YYYY` / `YYYY-MM` / `YYYY-MM-DD`；格式错误或不存在的日期变为未知，而不是拒绝整份备份；`updatedAt` 只接受时刻。
- `userDetails` 按 ID 去重，详情 ID 会并入 `userSelection`。
- 不支持的版本、非法 ID、超限数组或损坏作品会在确认前失败，不写入现有状态。
- 旧备份中的 `config.itemsPerSeason` 仍可读取但会被忽略：季度目录现在总是完整加载。
- 缺少 `userStatus` 的作品迁移为 `PLAN`，不根据播出时间推断为已看完或在看。

## SQL 兼容格式

SQL 导出用于 MySQL 8+/MariaDB 兼容性场景，不是应用的主恢复格式。导入器只接受本项目生成的 `INSERT IGNORE INTO anime_archive` 固定字段顺序：

```text
anilist_id, title_native, title_romaji, season_year, season,
format, average_score, cover_image, genres, description,
user_status, user_reaction, user_note
```

SQL 格式 2 的导出文件开头带有 `-- anime-horizon-sql-format: 2` 标记：`user_reaction` 为 `NULL` 表示没有标记感受，`NEUTRAL` 表示明确的“一般”。没有该标记的旧导出把所有未标记作品写成 `NEUTRAL`，因此导入旧文件时 `NEUTRAL` 读作“没有标记感受”。

限制：输入最多 5 MB、2,000 行、每行 13 个字段；字段会经过字符串、数字、季度、状态、反应和作品 schema 校验。解析器只读取 `VALUES` 行，不执行 SQL，不接受其他 INSERT 列表。

## 恢复流程

1. 读取文件或粘贴文本。
2. 在内存中解析、迁移、归一化，并预览合并结果：新增几部、更新几部同 ID 作品、当前年鉴中保持不变几部。
3. 用户确认后，按 ID 合并到当前年鉴：同 ID 作品的目录快照、状态和短评以备份为准（Phase A 语义不变）；感受只有在备份中**已知**时才覆盖本地，备份中没有感受（例如旧备份）不会清掉本地已标记的感受；观看历史按下文规则逐字段合并；备份里没有的本地作品全部保留。恢复永远不会清空或替换整个年鉴。
4. 用户取消、文件损坏或校验失败时，现有年鉴不发生任何变化。
5. 写入 `localStorage`；如果浏览器容量不足，保留内存状态并提示用户导出备份。

## 观看历史的合并规则

`mergeUserHistory`（`features/archive/archiveOperations.ts`）对 JSON 和 SQL 恢复都适用，逐字段、确定性地合并：

| 字段                                  | 本地未知 | 备份未知 | 两边都已知                   |
| ------------------------------------- | -------- | -------- | ---------------------------- |
| `addedAt`、`startedAt`、`completedAt` | 用备份值 | 保留本地 | 取较早者（第一次发生的时间） |
| `updatedAt`                           | 用备份值 | 保留本地 | 取较晚者                     |

- **未知永远不会覆盖已知。** 因此本地已有 `completedAt`、而较旧的备份（v1/v2，或没有时间字段的 v3 记录）中同一作品没有时间时，恢复后本地历史保持不变。
- 两个值的时间范围互相包含时（例如 `2019` 与 `2019-06-15`），取更精确的那个，而不是简单比较起点。
- 合并结果与参数顺序无关；同一份备份中重复的 ID 也按同样规则合并历史。
- SQL 兼容格式没有历史列：SQL 导入不会改变本地历史；通过 SQL 新增的作品历史全部未知。SQL 导出也不包含历史，需要完整备份时请使用 JSON。
