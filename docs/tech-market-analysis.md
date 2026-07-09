# 大盘分析模块 — 技术文档

## 一、数据源汇总

| 序号 | 数据 | Tushare 接口 | 字段 | 验证状态 |
|---|---|---|---|---|
| 1 | 主要指数行情 | `index_daily` | ts_code, trade_date, close, open, high, low, pct_chg, vol, amount | ✅ 已验证 |
| 2 | 同花顺概念列表 | `ths_index` (type='N') | ts_code, name, count | ✅ 409 个概念 |
| 3 | 同花顺行业列表 | `ths_index` (type='I') | ts_code, name, count | ✅ 594 个行业 |
| 4 | 概念/行业日行情 | `ths_daily` | ts_code, trade_date, close, open, high, low, pct_change, vol, total_mv, float_mv | ✅ 已验证 |
| 5 | 申万行业日行情 | `sw_daily` | ts_code, trade_date, close, pct_chg, vol | ✅ 已有 adapter |
| 6 | 申万行业分类 | `index_classify` | index_code, industry_name, level (L1/L2/L3) | ✅ L1:59, L2:238, L3:573 |
| 7 | 涨跌停统计 | `limit_list_d` | ts_code, trade_date, limit (U/D) | ✅ 约 108 涨停/19 跌停 |
| 8 | 涨跌家数 | `daily`（全市场无筛选） | ts_code, pct_chg | ✅ 5516 只股票 |
| 9 | 北向资金 | `moneyflow_hsgt` | trade_date, north_money, south_money | ✅ 日频 3 条 |
| 10 | 融资融券 | `margin` | trade_date, rzye（融资余额）, rqye（融券余额） | ✅ 日频 |
| 11 | 国债收益率 | `yc_cb` | ts_code=1001.CB, curve_term=10, trade_date, yield | ✅ 月频 |
| 12 | 全 A 加权 PE | `daily_basic`（全市场） | ts_code, pe_ttm, total_mv | ✅ 已有 computeWeightedPE |
| 13 | 波动率 / 恐慌指数 | **无直接 API** | — | ⚠️ 自建情绪指数替代 |
| 14 | AI 总结 | DeepSeek API | chat/completions | ✅ 已有 DEEPSEEK_API_KEY |

### 涨跌家数的特殊处理

`daily` 不传 `ts_code` 会返回全市场约 5500 只股票的当日行情。按 `pct_chg` 分组：

```
涨停（≥9.5%） / 涨超 5%（5-9.5%） / 涨 0-5% / 平 / 跌 0-5% / 跌超 5%（5-9.5%） / 跌停（≤-9.5%）
```

⚠️ 这是本模块**最重的 API 调用**（5000+ 行），必须磁盘缓存 4 小时以上。

### 情绪指数（自建）

由于没有可直接使用的恐慌/波动率指数 API，用 6 个可测量维度构建综合恐惧贪婪指数：

```
FearGreedIndex = 
  涨跌比归一化        × 0.25  // (up-down)/(up+down) → 映射到 0-100
+ 涨停跌停比归一化    × 0.20  // limit_up / (limit_up + limit_down + 1)
+ 北向净流入归一化    × 0.15  // north_money / 历史 max → 0-100
+ 融资余额变化率      × 0.15  // (rzye-prev)/prev → 映射到 0-100
+ 市场宽度           × 0.15  // % 股票 close > MA20 → 0-100
+ 成交额变化率       × 0.10  // vol / 20d_avg_vol → 映射到 0-100 (cap 2.0)
```

其中"市场宽度"需要额外一次 `daily_basic` 全量查询来获取每只股票的 MA20 位置。如果成本太高，可降级为用沪深300成分股来计算。

---

## 二、文件结构

### 新增文件

```
server/
├── api/market/
│   ├── indices-panel.get.ts    # 6 大指数即时行情
│   ├── hot-sectors.get.ts      # 热门行业 Top 10 + 概念 Top 10
│   ├── main-theme.get.ts       # 主线检测（行业 + 概念 Top 3）
│   ├── theme-timeline.get.ts   # 近 15 日行业/概念排名变迁
│   ├── fear-greed.get.ts       # 情绪指数（自建恐惧贪婪）
│   ├── breadth.get.ts          # 涨跌家数分布
│   └── ai-summary.get.ts       # DeepSeek AI 大盘总结

├── adapters/
│   └── tushare.ts              # 新增: getThsIndex(), getThsDaily(), getLimitList(),
│                               #       getMargin(), getMoneyflowHsgt(), getDailyAll()
│
pages/
├── market.vue                  # 重写：整合所有模块

components/market/
├── IndexCards.vue              # 指数卡片 + K线弹窗
├── HotRanking.vue              # 热门排行双栏
├── MainThemeCard.vue           # 主线卡片 + 得分明细
├── SpreadChart.vue             # 已有：股债利差图
├── FearGreedGauge.vue          # 恐惧贪婪仪表盘
├── ThemeTimeline.vue           # 排名变迁 ECharts
└── AiSummary.vue               # AI 总结面板
```

### 修改文件

| 文件 | 改动 |
|---|---|
| `server/adapters/tushare.ts` | 新增 6 个函数 |
| `server/lib/tushare.ts` | 重导出新函数 |
| `pages/market.vue` | 完全重写布局 |
| `stores/ui.ts` | 无需变动 |

---

## 三、API 设计

### 3.1 GET /api/market/indices-panel

```json
{
  "success": true,
  "indices": [
    {
      "code": "000001.SH", "name": "上证指数",
      "close": 3085.47, "pctChg": 0.23,
      "amount": 342000000000, "vol": 182000000
    }
    // ... 6 个
  ]
}
```

缓存：5 分钟内存。

### 3.2 GET /api/market/hot-sectors?top=10

```json
{
  "industries": [
    { "code": "850111.SI", "name": "半导体", "pctChg": 5.23, "close": 3456.78, "amount": 89000000000 }
  ],
  "concepts": [
    { "code": "884009.TI", "name": "光刻机", "pctChg": 7.45, "close": 2456.78 }
  ]
}
```

数据流：`ths_index` 取列表 → 批量 `ths_daily` 查当日行情 → 按 pct_change 降序取 Top N。

### 3.3 GET /api/market/main-theme?days=20

```json
{
  "industryTheme": [
    {
      "code": "850111.SI", "name": "半导体",
      "score": 89, "rank": 1,
      "dimensions": {
        "momentum5d": 92, "momentum20d": 85, "persistence": 7,
        "breadth": 67, "volumeRatio": 1.82
      },
      "narrative": "连续 7 天领涨, 板块内 67% 股票站上 MA20, 量能放大 1.8 倍"
    }
  ],
  "conceptTheme": [ /* 同上结构 */ ]
}
```

### 3.4 GET /api/market/fear-greed

```json
{
  "index": 68,
  "label": "贪婪",
  "level": "greed",
  "components": {
    "breadth": 72,
    "limitRatio": 85,
    "northFlow": 55,
    "marginChange": 60,
    "marketWidth": 68,
    "volumeRatio": 70
  },
  "history": [
    { "date": "20260701", "index": 62 }, { "date": "20260702", "index": 65 }
  ]
}
```

### 3.5 GET /api/market/ai-summary

```json
{
  "headline": "放量普涨，半导体主线确立",
  "narrative": "今日市场放量上涨，上证涨 0.85%...",
  "breadth": "普涨行情，68% 个股收红",
  "trendAlignment": "主线（半导体/光刻机）与大盘趋势共振向上",
  "riskFlags": ["外资连续 3 日净流出，需关注持续性"],
  "position": "当前股债利差 4.82% 处于近 3 年第 78 分位，股票相对便宜",
  "generatedAt": "2026-07-09T15:30:00Z"
}
```

实现：构建数据卡片 → 发送给 DeepSeek → 解析 JSON 响应 → 磁盘缓存 4 小时。

---

## 四、主线检测算法详解

### 输入

- `N` 个行业/概念板块（行业 ≈130，概念 ≈270）
- 每个板块：近 20 日的日行情（close, pct_change, vol, amount）
- 每个板块的成分股权重：通过 `index_classify` 或 `sw_daily` 关联

### 算法步骤

1. **计算核心指标**
   - `S_m5`：板块 5 日涨幅在所有板块中的排名百分位（0-100）
   - `S_m20`：板块 20 日涨幅的排名百分位（0-100）
   - `persistence`：板块近 15 天内在 Top-5 出现的天数
   - `breadth`：板块内 close > MA20 的股票占比（%）
   - `volRatio`：今日成交额 / 20 日平均成交额（上限 3.0 截断，防单日异常）

2. **归一化**
   - `S_m5` 和 `S_m20` 已经是 0-100
   - `persistence` 映射到 0-100（0 天=0, 15 天=100）
   - `breadth` 已经是 0-100
   - `volRatio` 映射到 0-100（1.0=50 分, 2.0+=100 分）

3. **加权合成**

   ```
   score = S_m5 × 0.30 + S_m20 × 0.20 + persistence × 0.25 + breadth × 0.15 + volRatio × 0.10
   ```

4. **排序 → Top 3**

### 驱动逻辑文案

```typescript
function generateNarrative(dims: ThemeDimensions): string {
  const parts: string[] = []
  if (dims.persistence >= 5) parts.push(`连续 ${dims.persistence} 天领涨`)
  if (dims.breadth >= 60) parts.push(`板块内 ${dims.breadth}% 股票站上 MA20`)
  if (dims.volumeRatio >= 1.5) parts.push(`量能放大 ${dims.volumeRatio.toFixed(1)} 倍`)
  if (parts.length === 0) parts.push(`5 日动量 ${dims.momentum5d} 分`)
  return parts.join(', ')
}
```

---

## 五、AI 总结实现

### System Prompt

```
你是一个 A 股市场分析师。根据以下今日市场数据，用中文输出 JSON（不要 markdown 代码块）：

{
  "headline": "一句话概括今日市场特征（20字以内）",
  "narrative": "2-3 句话描述市场整体表现和特征",
  "breadth": "分析上涨广度：普涨/结构性行情/严重分化，附具体数据",
  "trendAlignment": "主线板块与大盘趋势是否共振，附判断依据",
  "riskFlags": ["列出 1-3 个值得注意的风险信号，如无量价背离/外资流出等"],
  "position": "结合当前股债利分位给出仓位参考建议"
}
```

### Data Context Template

```
今日市场数据：
- 上证指数: {close} / {pctChg}%
- 深证成指: {close} / {pctChg}%
- 创业板指: {close} / {pctChg}%
- 科创50: {close} / {pctChg}%
- 沪深300: {close} / {pctChg}%
- 涨跌家数: {up}涨 / {down}跌 / {flat}平
- 涨停: {upLimit} / 跌停: {dnLimit}
- 成交额: {amount}亿（20日均: {avgAmount}亿）
- 北向资金: 净流入{netNorth}亿
- 融资余额: {rzye}亿（较昨日 +/-{marginChg}亿）
- 主线行业: {top3Industries}
- 主线概念: {top3Concepts}
- 股债利差: {spread}%（近3年第 {pct} 分位，{zone}）
- 情绪指数: {fearGreed}/100（{fearGreedLabel}）
```

---

## 六、关键设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 行业粒度 | 申万二级 (238 个) | 申万一级太粗（28 个），三级太细（573 个），二级是投资实践中常用的颗粒度 |
| 概念数据源 | 同花顺概念 (ths_index) | 申万没有概念分类，同花顺 409 个概念覆盖光刻机/AI芯片/Chiplet 等市场关注焦点 |
| 主线窗口 | 20 天 | 1 个月太噪、3 个月太钝，20 个交易日恰好跨越一个市场情绪周期 |
| 排名变迁窗口 | 15 天 | 三周足够看出趋势形态，同时保持图表可读 |
| AI 总结触发 | 页面加载 + 手动按钮 | 不设为自动定时任务，避免对 DeepSeek API 产生不必要的调用费用 |
| 情绪指数方案 | 自建复合指标 | 无直接可用 API；6 个可测量维度构建的复合指数比单一涨跌比更全面 |
| 涨跌家数 | Tushare daily 全量 | 一次性获取全部股票数据，虽重但准确可靠，缓存 4 小时完全合理 |

---

## 七、性能考量

### 重调用防护

| API | 调用量 | 缓存策略 |
|---|---|---|
| `daily` 全市场（涨跌家数） | 5500+ 行 | 磁盘 4 小时，仅交易日触发 |
| `ths_daily` 批量（概念行情） | 409 × N 天 | 磁盘 30 分钟 |
| `daily_basic` 全量（市场宽度） | 5500+ 行 | 仅在情绪指数计算时触发，缓存 4 小时 |
| DeepSeek AI | 1 次/触发 | 磁盘 4 小时 |

### 并行化

所有子模块 API 在 `market.vue` 的 `onMounted` 中并行发起请求，利用 HTTP/2 多路复用减少总等待时间。后端 API 之间不相互依赖。

---

## 八、代理兼容性说明

代理 (`lianghua.nanyangqiankun.top`) 已确认支持所有用到的 Tushare 接口。`yc_cb`（国债收益率）数据更新延迟较大（当前最新 2026-06-01），对低频月度数据可接受。

`ths_*` 接口需要 6000 积分，代理已验证可用。如果后续积分变动导致不可用，降级方案为：行业用 `sw_daily` 替代，概念板块暂时隐藏。

---

## 九、后续可能迭代

1. **恐慌指数历史**：积累 3-6 个月数据后，可绘制历史分位图表
2. **资金流主线**：用北向资金 + 融资余额的板块集中度辅助判断主线
3. **主线轮动日历**：记录每一次主线切换的时间点和驱动力
4. **AI 总结历史**：保存每日 AI 总结，形成"每日复盘日记"
5. **移动端优化**：情绪仪表盘在小屏上的交互优化
