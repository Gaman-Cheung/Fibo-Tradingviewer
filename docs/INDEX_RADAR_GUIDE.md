# Index Radar Indicator Guide

Algorithm version: **1**  
Universe version: **1**  
Data provider: **BaoStock official SH/SZ index daily data**

## 1. 这个模块解决什么问题

Index Radar 是 Look First 之前的市场背景筛选器。它每天从已明确分类的行业与主题指数中，找出最多五个同时具备相对强度、趋势结构和新事件的板块。它不会为了填满五张卡而加入弱指数。

系统滚动保留最近 400 个正式交易日。页面只读取预先计算好的最新快照，不会让浏览器下载 507 个指数的历史。卡片上的 `Official Close · YYYY-MM-DD` 是榜单使用的正式收盘日期。

沪深300（`SH.000300`）只作为统一相对强弱基准，不能进入 Leader 榜。宽基、风格、策略、基金、债券和未审阅的指数同样不能入榜。v1 分类种子逐代码覆盖 2026-07-29 BaoStock 返回的 507 个 `SH.000* / SZ.399*` 指数；未来新增代码默认归为 `other`、关闭 Radar，并在同步日志中产生分类警告，直至新的 Universe 版本明确分类。

## 2. 主分数

```text
Score = 25 × PctRank(RS5)
      + 30 × PctRank(RS20)
      + Trend(0–30)
      + min(Event, 15)
      − Risk
```

正向分值预算可读作：相对强弱 55 分、趋势结构 30 分、事件最多 15 分，随后扣除风险。

- `RS5` = 指数最近 5 个交易日收益率 − 沪深300同期收益率。
- `RS20` = 指数最近 20 个交易日收益率 − 沪深300同期收益率。
- `PctRank` 是当日全部有效行业/主题候选中的百分位排名，范围 0–1；不是概率。
- Close 高于 MA60：`+5`。
- MA60 单日变化率高于 `+0.01%`：`+10`。
- `Close > MA20 > MA60` 且 MA20、MA60 单日变化率都高于 `+0.01%`：`+15`。
- MA 单日变化率在 `±0.01%` 内视作 flat。

入榜还必须同时满足：至少 62 个正式收盘点、Score ≥ 60、Close > MA60、RS5 或 RS20 至少一项为正，并且没有 MA60 Breakdown。

## 3. 加分事件

| 事件 | 分值 | 实际触发条件 |
|---|---:|---|
| MA60 Reclaim Confirmed | +9 | 前两日 Close 不高于当日 MA60，随后两个连续正式收盘均高于各自 MA60。 |
| MA60 Breakout | +8 | 昨日 Close 不高于昨日 MA60，今日 Close 高于今日 MA60。 |
| 20D High Breakout | +7 | 今日 Close 严格高于此前 20 个正式收盘的最高值。 |
| Relative Strength New High | +6 | `指数 Close ÷ 沪深300 Close` 的最新值严格创此前 20 日新高。 |
| MA60 Turn Up | +6 | MA60 日变化率由不高于 `+0.01%` 转为高于 `+0.01%`。 |
| 3D Acceleration | +5 | 最近 3 个交易日累计收盘涨幅不低于 5%。 |
| Persistent Advance | +4 | 最近 10 个单日收盘变动中至少 7 日上涨。 |
| 3-Day Streak | +3 | 最近 3 个单日收盘变动全部上涨。 |
| 1D Surge | +2 | 最新单日正式收盘涨幅不低于 5%。 |

Event 原始分可以超过 15，但进入 Score 的 Event 最多为 15。单日大涨因此只是注意力事件，不能单独压过趋势与相对强弱。

## 4. 只提示、不加分的结构事件

- `MA60 Retest`：当日 High/Low 穿过 MA60。
- `Healthy Retest`：穿过 MA60，同时昨日和今日收盘仍在 MA60 上方且 MA60 上行。
- `Near MA60`：Close 距 MA60 不超过 ±0.8%，MA60 上行、RS20 为正，并且最近 15 日至少 10 日收于各自 MA60 上方。

High/Low 只在同步任务当次计算 Retest 时存在，计算后丢弃；数据库长期只保存 Close、pctChg 和交易状态。三个提示均为 0 分，避免触碰均线本身被误当成强势确认。

## 5. 风险

- `Extended`：Close 高于 MA60 超过 12%，Score 扣 10 分，并在卡片显示风险。它表示趋势仍强但追高风险升高。
- `MA60 Breakdown`：昨日收于 MA60 上方或相等、今日跌破 MA60。该指数直接退出强势榜，不以扣分方式保留。

未显示 Radar 风险不代表没有波动、估值、政策或个股风险；这些不在本模型输入内。

## 6. Theme Group 去重与连续性

1. 同一 Theme Group 通常只保留分数最高者。
2. 只有两个代表都位于去重前原始 Top 5，且分差不超过 5 分时，才允许同主题展示两张卡。
3. 昨日最终 Leader 若今日仍在原始 Top 8、Score ≥ 60，且与今日第五名分差不超过 5 分，可以替换最低分的新上榜者。
4. 稳定缓冲不让不合格指数留下；MA60 Breakdown、低于 60 分或相对强弱门槛失败仍会退出。
5. 主卡显示的 `Consecutive ND`、`13D N×`、`60D N×` 由浏览器对兼容的最终快照按 Theme Group 重新统计。Python快照中的旧15D/30D字段继续兼容，其中最近30个交易日的最终上榜次数仍只在Score完全相同时先于RS20/RS5破同分，并用于稳定缓冲；它不会持续累加到主分数。

## 7. Leadership Memory v1

Leadership Memory读取最近最多60份最终Top 5快照，不下载507个指数的历史，也不保存或还原当日第6名以后的原始候选排名。

- `Yesterday`：前一个正式交易日的实际Top 5，并对照同一Theme Group今天是否仍在榜及当前名次。
- `3D Fast`、`13D Swing`、`60D Regime`：均包含最新正式交易日，并向前取对应数量的兼容交易日。
- 每个交易日第1至第5名依次获得`5 / 4 / 3 / 2 / 1`分；同一Theme Group当日出现两个代表时只计算排名更高者。
- `Leadership Score = 名次分合计 ÷ (5 × 实际可用交易日) × 100`。
- 同分时依次比较上榜交易日数量、平均名次、最近上榜时间和稳定主题名称。
- 60日榜完整保留窗口内的长期强者。已经退出当前榜时显示`Last Seen N sessions ago`，不设置近期13日入榜门槛，也不做时间衰减。
- 算法版本或Universe版本不同的快照不会混合。历史不足时使用实际可用交易日计算，并明确显示`History N/目标 · Building`。
- Mini卡只显示前三名；详情最多显示Yesterday 5个、3D 15个，以及当前分类下13D/60D最多28个Theme Group。60日每日历史默认先展示最近13日，再由用户展开剩余日期。

这些分数只描述“最终Top 5中持续出现的程度”，不会反馈到Radar Score或Terminal Composite Signal。

## 8. 如何读一张卡

示例：

```text
#1 AI & Computing · MA60 Reclaim Confirmed
RS5 +4.6% · RS20 +8.2% · Score 88.4
Consecutive 4D · 13D 7× · 60D 12×
```

含义依次是：当前最终排名第一；刚出现正式的 MA60 收复确认；5 日和 20 日都跑赢沪深300；总分通过质量门槛；并且不是只在今天偶然上榜。点击卡片可查看 RS、Trend、Event、Risk 的完整拆分、MA 状态和历史次数。

## 9. 数据质量与发布规则

- 基准历史缺失、指数请求未恢复，或有效行业/主题覆盖率低于 95% 时，不发布新快照。
- 失败不会覆盖最后一份有效榜单，不推进 `CN_INDEX` 成功检查点，也不触发历史清理。
- 首次 Backfill 按日期顺序重建历史榜单；Repair 或算法/分类版本升级会重算受影响日期之后的快照。
- Radar 页面读取失败不会阻止 Look First 表格使用。

## 10. 明确边界

Index Radar 是市场背景和注意力工具，不是上涨概率、目标价、买入建议或收益承诺。它不读取 Pool、Ticker、Current 或永久 ID，也不会更改 Terminal Composite Signal、Fibonacci、Stop、R:R、MACD、Trend Tracker 或 Wave 的任何结果。
