# 手动上线：Market Insights v1

此包是可部署代码，不代表已上线。没有为你执行线上 SQL、推送 GitHub、
修改 Secrets 或开启任务。旧算法与旧行情保留规则不变。

## 1. 更新 GitHub 仓库

将发布 ZIP 内 `Fibo-Tradingviewer/` 的**内容**放到原仓库根目录，保留原 GitHub
提交历史、仓库设置和 Secrets。不要上传外层 ZIP，不要另套一层项目目录。
务必包含隐藏目录 `.github/workflows/`；只替换 HTML 不够。

发布包不含本机 `.git`、`.env.local`、`.venv`、node_modules、缓存、试算报告或
本地行情 CSV。`.env.local.example` 只有占位符，不需要填写到 GitHub 源码。
本地工作区的上述内容未删除。不要将 0820 的私密配置上传。

## 2. 先建新表（只需一次，可重复执行）

在已有项目的 Supabase SQL Editor 执行：

`supabase/migrations/20260929_market_insights.sql`

它只创建新 Insights 表、该表读取策略及原子发布函数，不迁移或清理旧表。
现有 market_daily_bar、目录、检查点、Pulse 表应已存在；无需重跑旧迁移。
先确认 SQL 成功，再启用 GitHub 任务。未部署表时新 UI 会显示待接入，旧页面照常。

## 3. 确认容量并设置 GitHub Actions Variables

在 Supabase Dashboard 查看实际数据库容量，确认剩余空间不少于 **75 MB**。
本次试算的 JSON 60 期约 8.33 MiB，不包含行/索引/TOAST 等；正式发布还带覆盖诊断，
以实际用量为准。不要为此删除或缩短旧行情历史。

在仓库 Settings → Secrets and variables → Actions → **Variables** 设置：

| Variable | 值 |
|---|---|
| `INSIGHTS_ENABLED` | `true`（迁移及容量确认之后再设） |
| `INSIGHTS_HEADROOM_MB` | Dashboard 中核对的剩余 MB 数，>=75；不是固定填 75 |
| `INSIGHTS_CAPACITY_CHECKED_ON` | 核对当天的 UTC 日期，`YYYY-MM-DD` |

容量确认有效期为 7 天；过期或不足会让**新发布步骤**失败并保留旧快照，不回滚
已完成的旧行情同步。每周复核后更新日期和数值。关闭新发布只需把
`INSIGHTS_ENABLED` 改为 `false`；页面会继续展示有日期的最后有效结果。

继续使用原有 **Secrets** `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`。
新 publisher 不需要新密钥；Service Role 不得放在 Variables、HTML 或浏览器脚本中。

## 4. 手动运行一次

GitHub Actions → **Sync BaoStock full market** → Run workflow：

- mode：`daily`
- dataset：`all`

旧同步和 freshness audit 成功后才会执行 `Publish independent Market Insights v1`。
原 smoke、单 dataset、backfill、repair 不会自动发布新指标；修复结束后再运行 daily/all。
后续沿用工作日北京时间 19:00 的现有日程（GitHub 调度可能延迟）。

如果页面已部署、但未执行 SQL/首次发布，等待状态是预期行为，不是前端故障。

## 5. 验收

- Actions 新步骤输出 `status: published`、`trade_date` 和 `calculation_id`。
- Supabase 新表出现同日期的一行；可只读检查：

```sql
select trade_date, algorithm_version, calculation_id, computed_at
from public.market_insights_snapshot order by trade_date desc limit 3;
```

- 登录 Terminal：Pulse 保持原图；三个范围的 Radar 有真实点位，1/3/13/60窗口
  可切换，有历史不足时不显示虚构结果。旧榜单和 Memory 必须仍正常。
- `?` 展示 Insights v1 原理、日期、覆盖和局限。综合状态只属于 A 股。
- 编辑/移除/恢复/云端拉取不整页刷新；跨 Terminal/Wave/Tracker 仍是多页面跳转。
- 检查移动端无横向页面溢出，减少动画偏好生效。

## 故障与回退

- 缺表：补执行本次迁移；不要改旧表解决。
- 401/403：检查 Actions Secrets、用户登录与新表权限；不要关闭 RLS。
- 来源检查点不一致：先检查旧同步日志并完成 daily/all，新任务不能伪造成功日期。
- 主题历史不足：本版明确排除，不扩库，不补价格；以后另行评估。
- 新发布失败：原子事务保留上次有效新快照，旧算法/表不受影响。
- 回退：关闭 `INSIGHTS_ENABLED`，按原 GitHub 提交历史回退前端/新任务即可。
  无需删除新表，更不应重置旧数据库。

## 本地验证与手动发布（可选）

安装原项目依赖后：`npm test`、`npm run test:sync`、`npm run test:e2e`。
只读检查：`python scripts/publish_market_insights.py --env-file PATH_TO_EXISTING_ENV`。
显式发布需先设置上述两项容量环境变量，再增加 `--publish`。
不要和旧同步/repair同时手动运行；现有同步不提供跨全库读事务。

SQL 集成测试位于 `tests/sql/market-insights.mjs`，可在独立临时目录安装
`@electric-sql/pglite@0.3.14`，将其 `dist/index.js` 路径作为参数运行。
它不连接 Supabase，也不要求把 PGlite 加入生产依赖。
