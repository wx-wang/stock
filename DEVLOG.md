# 开发日志

> 每次功能改动、bug修复、架构决策，都在此记录。格式：日期 + 标题 + 背景/方案/影响。

---

## 2026-07-03 · 金股缓存自愈式增量更新

**背景**：金股数据来自 Tushare `broker_recommend`，拉 12 个月数据后写入 `broker-golden.json`。旧逻辑是"缓存文件存在就不重建"，导致 6 月建好的缓存 7 月不会自动更新，金股列表永久停留在旧月份。

**方案**：自愈式增量缓存

```
每次请求 broker-golden：
  1. 读取缓存文件，找出最新月份（如 202606）
  2. 从最新月 + 1 开始，逐月调 broker_recommend（每月 1 次 API）
  3. 有新月份 → 推进 12 月窗口（丢最旧加最新），写回文件
  4. 没新月份 → 直接用缓存
```

**影响**：
- `server/api/broker-golden.get.ts` 改动，新增 `syncLatestMonths()` 
- 每次请求多 0~2 次 API 调用（零积分消耗）
- 不需要 cron，纯惰性更新
- 首次访问后缓存永久自愈

---

## 2026-07-03 · 拥挤度引擎 v5 — idx_factor_pro + 250日历史自比

**背景**：拥挤度之前用的是 `daily`（个股日线）+ screener 缓存做行业映射，存在两个致命问题：① 只覆盖有研报的 ~3000 只股票，行业成交额分母偏小；② 算法是横截面对比（银行占 5% 永远高分位，小行业永远低分位），不符合"历史自比"的研报标准。

**方案**：
- 数据源从 `daily` 切到 `idx_factor_pro`（申万行业指数技术因子），官方含 amount/vol/pct_change
- 支持日期范围查询，单次 60 天 × 130 行业 ≈ 7800 行 < 8000 上限，250 天 = 4~5 次 API
- 增量缓存 `idx-factor-cache.json`，只补新增天数
- 拥挤度 = 三维加权历史自比分位：成交额占比 60% + 成交量占比 25% + 涨幅 15%
- 每行业取自己 250 天分布，今天在其中排第几分位
- 5 日变化 = 近 6 日成交额占比的线性回归斜率

**影响**：
- `server/adapters/tushare.ts` 新增 `getIdxFactorPro(startDate, endDate, fields)`
- `server/api/sectors/capm.get.ts` 重写 `computeCrowding()`，CAPM 缓存版本号 v5
- `server/api/stocks/sector-picks.get.ts` CAPM 缓存路径同步更新

---

## 2026-07-03 · 行业掘金：五因子打分 + 拥挤风险替代行业契合

**背景**：个股推荐原来用 PE 作为"行业契合"因子，但高增长股（如宁德）天然 PE 高，被扣分不公平。同期拥挤度引擎上线，正好用拥挤风险替代。

**方案**：
- 删除 scoreFit（PE 匹配），新增 scoreCrowding（拥挤风险，15%权重）
- 拥挤 < 50 → 满分 1.0，50-70 线性递减，70-80 地板 0.1，>80 → 0
- 强制要求：必须入选过券商金股（goldenCount12m > 0 或 isGoldenRecent）

**因子权重**：行业动量 25% + 估值空间 25% + 分析师共识 20% + 成长质量 15% + 拥挤风险 15%

**影响**：
- `server/api/stocks/sector-picks.get.ts` 改动
- 缓存文件名 `sector-picks-d60-Q1_Q2.json`

---

## 2026-07-03 · CAPM 缓存版本号机制

**背景**：CAPM 计算结果缓存在 `sectors-capm-*.json`，代码改数据结构后旧缓存字段缺失（如加了 crowdingPct 但旧缓存没有），导致前端显示空值。每次手动删缓存很麻烦。

**方案**：文件名中嵌入版本号（如 `-v5`），改数据结构时递增版本号，旧缓存文件自动被忽略。

**影响**：
- `server/api/sectors/capm.get.ts` 定义 `CACHE_VERSION`
- `server/api/stocks/sector-picks.get.ts` 同步更新文件名

---

## 2026-07-03 · 拥挤度散点图 + 大盘拥挤度温度计

**背景**：新增行业拥挤度和市场拥挤度可视化。

**方案**：
- 行业拥挤度散点图：X=拥挤度分位(0-100)，Y=5日变化率，四象限着色（红=拥挤加剧/橙=消退/蓝=涌入/绿=低位）
- 大盘拥挤度温度计：前 5% 个股成交额 / 全市场，>30% 偏热、>40% 拥挤、>50% 极度拥挤，附带 30 日趋势线

**影响**：
- `components/sector/SectorCrowdingChart.vue` 新增
- `components/sector/MarketCrowdingGauge.vue` 新增
- `server/api/market/crowding.get.ts` 新增
- `sector-rotation.vue` 嵌入两个组件

---

## 2026-07-03 · Alpha/Beta 四象限 + CAPM 行业轮动

详见提交记录。核心理念：SW 二级行业 vs 沪深 300，CAPM 回归。

---

## 2026-06-30 · 项目初始化

Nuxt 3 + Tushare 数据 + 申万行业指数 + 股票筛选器。
