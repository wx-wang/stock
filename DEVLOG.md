# 开发日志

> 每次功能改动、bug修复、架构决策，都在此记录。格式：日期 + 标题 + 背景/方案/影响。

## 2026-07-03 · 趋势分析体系 — 完成实现 ✅

### 文件清单

| 文件 | 行数 | 说明 |
|---|---|---|
| `server/api/trend/batch.get.ts` | 625 | 全市场批量趋势摘要计算 |
| `server/api/trend/analyze.get.ts` | 635 | 单股 250 日完整时间序列 |
| `components/trend/TrendTable.vue` | 619 | 搜索 + 筛选 + 表格 |
| `components/trend/TrendChart.vue` | 713 | ECharts 均线图 + hover tooltip |
| `pages/trend-analysis.vue` | 307 | 页面入口（列表⇄详情切换） |

### 关键实现细节

- **batch.get.ts**: stock_basic 获取全市场 ~5000 只 A 股；按交易日增量拉 daily 数据（persist/trend-daily/），缺失日 5 并发补拉；Wilder's ATR 14/20 日；节气状态机从序列第一天重跑（无跨请求状态）
- **analyze.get.ts**: getDaily 单股 250 天，逐日计算 MA/ATR/温度/节气/间距/信号；内存 cache 5 分钟
- **TrendTable.vue**: 搜索框 + 温度筛选下拉；9 档温度彩色 badge；响应式隐藏列
- **TrendChart.vue**: ECharts 5 线图（close/MA5/10/20/60）+ 渐变 area + custom tooltip（含日期/收盘价/温度+emoji/节气/ATR）；底部 4 摘要卡
- **trend-analysis.vue**: onMounted 调 batch API，click→调 analyze API，视图切换动画

### 部署说明

- 首次访问需 120 次 API 调用来建日线缓存（约 10-15 秒），建议页面显示进度
- 后续每天只需 1-2 次增量拉取
- 日线缓存结构：`persist/trend-daily/{YYYYMMDD}.json`，最终结果：`persist/trend-batch.json`

---

## 2026-07-03 · 趋势分析体系 — 设计阶段（待开发）

**背景**：在行业轮动 → 拥挤度 → 个股推荐三层筛选之后，缺少最后一道趋势确认闸门。需要一个基于纯价格数据的趋势判断工具，确保只参与右侧趋势。

**核心指标（四大维度）**：

```
趋势温度（9档冻~沸）  ←  基于均线排列+ATR
趋势节气（5态状态机）  ←  右侧趋势阶段划分
趋势强度（0-100）    ←  多周期ROC在全市场百分位
均线排列评分（0-4）   ←  P/MA5/MA10/MA20/MA60 关系
```

**两层架构**：

```
列表层 GET /api/trend/batch
  └─ 全市场 ~5000 只 → 取 stock_basic + 120天 daily → 算四指标
  └─ 缓存 persist/trend-batch.json，每天重建
  └─ 前端：虚拟滚动表格 + 搜索 + 筛选

详情层 GET /api/trend/analyze?code=600519
  └─ 单股 250 天 → 逐日 MA/ATR/温度/节气
  └─ 前端：ECharts 多线图 + hover tooltip（含当天温度+节气）
  └─ 内存缓存 5 分钟
```

**技术要点**：

| 要点 | 方案 |
|---|---|
| 节气状态机跨天记忆 | 每次请求重算（从序列第一天开始跑状态机），无需持久化 |
| ATR 计算 | daily 需要 open/high/low 字段，之前只取了 close |
| 趋势强度 | 12月ROC = screener 已有 RPS；10日/60日 = 列表 batch 时顺便算 |
| 均线计算 | 前端算或后端算均可；详情用后端（250天返回时间序列），列表也后端（只返回最新一行摘要） |
| daily 拉取 | 按 trade_date 拉全市场（同 market/crowding 的方式） |
| 节气天数 | daily 序列从头跑状态机，不用跨请求存状态 |

**数据流**：

```
stock_basic → 股票列表 (5000 只)
daily       → 120 天 OHLCV → MA5/10/20/60 + ATR → 排列 → 温度
                                      └→ ROC → 强度(RPS)
                                      └→ 状态机 → 节气 + 天数
```

**节气判定规则（可编程伪代码）**：

```
每日:
  score = count(P>MA5, MA5>MA10, MA10>MA20, MA20>MA60)  // 0-4
  temp = scoreToTemperature(score, ATR状态)
  
  if jieqi == 无右侧 and score == 4:
    jieqi = 立夏, 节气天数 = 1, 右侧天数 = 1
  elif jieqi == 立夏 and 右侧天数 >= 5 and spread_20_60 > 0.5% and 价格上涨中:
    jieqi = 夏至, 节气天数 = 1
  elif jieqi == 夏至 and 右侧天数 >= 10 and 短线间距在加速:
    jieqi = 小暑, 节气天数 = 1
  elif jieqi == 小暑 and 右侧天数 >= 15 and ATR > 20日均值 × 1.5:
    jieqi = 大暑, 节气天数 = 1
  elif 价格跌破MA10 or temp < 平:
    jieqi = 立秋 → 下一根K线重置为 无右侧
  
  节气天数++, 右侧天数++
```

**改动清单**：

| 文件 | 新/改 | 内容 |
|---|---|---|
| `server/adapters/tushare.ts` | 改 | `getDaily` 字段加上 `open,high,low` |
| `server/api/trend/batch.get.ts` | **新** | 全市场趋势摘要批量计算 + 缓存 |
| `server/api/trend/analyze.get.ts` | **新** | 单股 250 日完整时间序列 |
| `components/trend/TrendTable.vue` | **新** | 搜索 + 虚拟滚动表格 |
| `components/trend/TrendChart.vue` | **新** | K线均线图 + hover tooltip |
| `pages/trend-analysis.vue` | **新** | 页面入口 |
| `PRD.md` | **新** | 产品需求文档 |
| `DEVLOG.md` | 更新 | 本条目 |

**不做**：
- 欧奈尔基部/Follow-Through Day（A 股适用性存疑）
- 节气持久化到数据库（重启后重新计数不影响分析）
- 详情页批量加载（按需单股计算）

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
