<template>
  <div class="trend-chart" :class="{ 'is-loading': loading }">
    <!-- Loading overlay -->
    <div v-if="loading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <span class="loading-text">数据加载中...</span>
    </div>

    <!-- Chart container -->
    <div ref="chartRef" class="chart-container"></div>

    <!-- Summary cards -->
    <div v-if="summary && !loading" class="summary-cards">
      <!-- 温度与节气 -->
      <div class="summary-card temp-card">
        <div class="card-label">温度 / 节气</div>
        <div class="card-body">
          <div class="card-value temp-row">
            <span class="temp-emoji">{{ getTempEmoji(summary.temperature) }}</span>
            <span
              class="temp-text"
              :style="{ color: getTempColor(summary.temperature) }"
            >
              {{ summary.temperature || '--' }}
            </span>
          </div>
          <div class="card-sub" v-if="summary.jieqi">
            <span class="jieqi-name">{{ summary.jieqi }}</span>
            <span v-if="summary.jieqiDays !== undefined && summary.jieqiDays !== null">
              （{{ summary.jieqiDays >= 0 ? '已过' : '距' }}{{ Math.abs(summary.jieqiDays) }}天）
            </span>
          </div>
          <div class="card-sub muted" v-else>--</div>
        </div>
      </div>

      <!-- 均线乖离 -->
      <div class="summary-card spread-card">
        <div class="card-label">均线乖离</div>
        <div class="card-body">
          <div v-if="summary.spreads" class="spread-list">
            <div class="spread-item">
              <span class="spread-label">5 ↔ 10</span>
              <span
                class="spread-num"
                :style="{ color: getSpreadColor(summary.spreads.spread_5_10) }"
              >
                {{ formatPercent(summary.spreads.spread_5_10) }}
              </span>
            </div>
            <div class="spread-item">
              <span class="spread-label">10 ↔ 20</span>
              <span
                class="spread-num"
                :style="{ color: getSpreadColor(summary.spreads.spread_10_20) }"
              >
                {{ formatPercent(summary.spreads.spread_10_20) }}
              </span>
            </div>
            <div class="spread-item">
              <span class="spread-label">20 ↔ 60</span>
              <span
                class="spread-num"
                :style="{ color: getSpreadColor(summary.spreads.spread_20_60) }"
              >
                {{ formatPercent(summary.spreads.spread_20_60) }}
              </span>
            </div>
          </div>
          <div v-else class="card-sub muted">--</div>
        </div>
      </div>

      <!-- 评分 -->
      <div class="summary-card score-card">
        <div class="card-label">评分 / 右侧</div>
        <div class="card-body">
          <div class="card-value">
            <span
              class="score-num"
              :style="{ color: getScoreColor(summary.score) }"
            >
              {{ summary.score != null ? summary.score : '--' }}
            </span>
            <span v-if="summary.score != null" class="score-unit">分</span>
          </div>
          <div class="card-sub" v-if="summary.rightDays !== undefined && summary.rightDays !== null">
            右侧 {{ summary.rightDays }} 天
          </div>
          <div class="card-sub muted" v-else>--</div>
        </div>
      </div>

      <!-- ATR 波动 -->
      <div class="summary-card atr-card">
        <div class="card-label">ATR 波动率</div>
        <div class="card-body">
          <div class="card-value">
            <span class="atr-num">{{ summary.atr != null ? summary.atr.toFixed(2) : '--' }}</span>
          </div>
          <div
            class="card-sub"
            v-if="summary.atrAvg != null && summary.atrRatio != null"
          >
            均值 {{ summary.atrAvg.toFixed(2) }} | 比率 {{ (summary.atrRatio * 100).toFixed(1) }}%
          </div>
          <div class="card-sub muted" v-else>--</div>
        </div>
      </div>
    </div>

    <!-- Signal cards slot (from parent, optional) -->
    <div v-if="$slots.signals && !loading" class="signal-cards">
      <slot name="signals" />
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'

// ========================
// Props
// ========================
const props = defineProps({
  series: {
    type: Array,
    default: () => [],
  },
  summary: {
    type: Object,
    default: null,
  },
  code: {
    type: String,
    default: '',
  },
  name: {
    type: String,
    default: '',
  },
  loading: {
    type: Boolean,
    default: false,
  },
})

// ========================
// State
// ========================
const chartRef = ref(null)
let chartInstance = null

// ========================
// 温度映射
// ========================
const TEMP_MAP = {
  '沸':   { emoji: '\u{1F30B}', color: '#FF1744' },
  '热':   { emoji: '\u{1F525}', color: '#FF5722' },
  '温偏热': { emoji: '\u2600\uFE0F', color: '#FF9800' },
  '温':   { emoji: '\u{1F324}\uFE0F', color: '#FFC107' },
  '温偏凉': { emoji: '\u26C5', color: '#03A9F4' },
  '平':   { emoji: '\u2601\uFE0F', color: '#9E9E9E' },
  '凉':   { emoji: '\u{1F327}\uFE0F', color: '#2196F3' },
  '寒':   { emoji: '\u2744\uFE0F', color: '#536DFE' },
  '冻':   { emoji: '\u{1F9CA}', color: '#00BCD4' },
}

function getTempEmoji(temp) {
  return TEMP_MAP[temp]?.emoji || ''
}

function getTempColor(temp) {
  return TEMP_MAP[temp]?.color || '#9E9E9E'
}

// ========================
// 乖离率颜色
// ========================
function getSpreadColor(spread) {
  if (spread == null) return '#9E9E9E'
  if (spread > 0) return '#4CAF50'
  if (spread < 0) return '#F44336'
  return '#9E9E9E'
}

function formatPercent(val) {
  if (val == null || isNaN(val)) return '--'
  const sign = val > 0 ? '+' : ''
  return sign + (val * 100).toFixed(2) + '%'
}

// ========================
// 评分颜色
// ========================
function getScoreColor(score) {
  if (score == null) return '#9E9E9E'
  if (score >= 80) return '#4CAF50'
  if (score >= 60) return '#FFC107'
  if (score >= 40) return '#FF9800'
  return '#F44336'
}

// ========================
// 构建 ECharts 配置
// ========================
function buildChartOptions() {
  const raw = props.series || []

  const dates = raw.map((d) => d.date || '')
  const closeValues = raw.map((d) => d.close)
  const ma5Values = raw.map((d) => d.ma5)
  const ma10Values = raw.map((d) => d.ma10)
  const ma20Values = raw.map((d) => d.ma20)
  const ma60Values = raw.map((d) => d.ma60)

  // 用于 tooltip 获取完整行数据
  const rawData = raw

  return {
    backgroundColor: 'transparent',
    darkMode: true,
    textStyle: {
      color: '#b0b8c8',
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(20, 24, 36, 0.96)',
      borderColor: '#2a3040',
      borderWidth: 1,
      textStyle: {
        color: '#e0e6f0',
        fontSize: 13,
      },
      // 自定义 tooltip 内容
      formatter(params) {
        if (!params || params.length === 0) return ''
        const idx = params[0].dataIndex
        const item = rawData[idx]
        if (!item) return ''

        const closeVal = item.close != null ? Number(item.close).toFixed(2) : '--'

        // 温度行
        let tempLine = ''
        if (item.temperature) {
          const emoji = getTempEmoji(item.temperature)
          const color = getTempColor(item.temperature)
          tempLine = `<div style="margin-top:4px;display:flex;align-items:center;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px;"></span>
            ${emoji} <span style="color:${color};font-weight:600;margin-left:2px;">${item.temperature}</span>
          </div>`
        }

        // 节气行
        let jieqiLine = ''
        if (item.jieqi) {
          jieqiLine = `<div style="margin-top:2px;color:#c0c8d8;">
            &#x1F4C5; ${item.jieqi}
          </div>`
        }

        // 均线信息
        const ma5Val = item.ma5 != null ? Number(item.ma5).toFixed(2) : '--'
        const ma10Val = item.ma10 != null ? Number(item.ma10).toFixed(2) : '--'
        const ma20Val = item.ma20 != null ? Number(item.ma20).toFixed(2) : '--'
        const ma60Val = item.ma60 != null ? Number(item.ma60).toFixed(2) : '--'

        // ATR
        const atrVal = item.atr != null ? Number(item.atr).toFixed(2) : '--'

        return `
          <div style="font-weight:700;font-size:14px;margin-bottom:6px;color:#e8ecf4;">
            ${item.date || ''}
          </div>
          <div style="font-size:16px;font-weight:700;color:#ffffff;margin-bottom:4px;">
            收盘 <span style="color:#e8eaed;">${closeVal}</span>
          </div>
          ${tempLine}
          ${jieqiLine}
          <div style="margin-top:8px;padding-top:6px;border-top:1px solid #2a3040;display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;font-size:12px;color:#a0a8b8;">
            <div>MA5 <span style="color:#FFD54F;">${ma5Val}</span></div>
            <div>MA10 <span style="color:#FFB74D;">${ma10Val}</span></div>
            <div>MA20 <span style="color:#CE93D8;">${ma20Val}</span></div>
            <div>MA60 <span style="color:#64B5F6;">${ma60Val}</span></div>
          </div>
          <div style="margin-top:4px;font-size:12px;color:#a0a8b8;">
            ATR <span style="color:#80CBC4;">${atrVal}</span>
          </div>
        `
      },
      extraCssText: 'max-width:280px;white-space:nowrap;padding:12px 14px;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);',
    },
    legend: {
      data: ['收盘价', 'MA5', 'MA10', 'MA20', 'MA60'],
      bottom: 0,
      textStyle: {
        color: '#b0b8c8',
        fontSize: 12,
      },
      itemWidth: 20,
      itemHeight: 3,
      icon: 'roundRect',
    },
    grid: {
      top: 16,
      right: 16,
      bottom: 36,
      left: 56,
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLine: {
        lineStyle: { color: '#2a3040' },
      },
      axisTick: { show: false },
      axisLabel: {
        color: '#6b7280',
        fontSize: 11,
        formatter(value) {
          if (!value) return ''
          // 只显示部分日期标签避免拥挤
          return value
        },
        interval: Math.max(1, Math.floor(dates.length / 8)),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#6b7280',
        fontSize: 11,
        formatter(value) {
          if (value >= 1000) return (value / 1000).toFixed(1) + 'k'
          return value.toFixed(2)
        },
      },
      splitLine: {
        lineStyle: {
          color: '#1e2430',
          type: 'dashed',
        },
      },
    },
    dataZoom: [
      {
        type: 'inside',
        start: 0,
        end: 100,
        minSpan: 10,
      },
      {
        type: 'slider',
        start: 70,
        end: 100,
        height: 20,
        bottom: 28,
        borderColor: '#2a3040',
        backgroundColor: '#1a1e2a',
        fillerColor: 'rgba(100,130,180,0.15)',
        handleStyle: { color: '#6b7280' },
        textStyle: { color: '#6b7280', fontSize: 10 },
      },
    ],
    series: [
      // 收盘价下方渐变填充
      {
        name: '收盘价',
        type: 'line',
        data: closeValues,
        smooth: false,
        symbol: 'none',
        lineStyle: {
          width: 2.5,
          color: '#e8eaed',
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(232,234,237,0.28)' },
            { offset: 1, color: 'rgba(232,234,237,0.02)' },
          ]),
        },
        z: 5,
      },
      // MA5
      {
        name: 'MA5',
        type: 'line',
        data: ma5Values,
        smooth: false,
        symbol: 'none',
        lineStyle: {
          width: 1.2,
          color: '#FFD54F',
        },
        z: 4,
      },
      // MA10
      {
        name: 'MA10',
        type: 'line',
        data: ma10Values,
        smooth: false,
        symbol: 'none',
        lineStyle: {
          width: 1.2,
          color: '#FFB74D',
        },
        z: 3,
      },
      // MA20
      {
        name: 'MA20',
        type: 'line',
        data: ma20Values,
        smooth: false,
        symbol: 'none',
        lineStyle: {
          width: 1.2,
          color: '#CE93D8',
        },
        z: 2,
      },
      // MA60
      {
        name: 'MA60',
        type: 'line',
        data: ma60Values,
        smooth: false,
        symbol: 'none',
        lineStyle: {
          width: 1.2,
          color: '#64B5F6',
        },
        z: 1,
      },
    ],
  }
}

// ========================
// 初始化/更新图表
// ========================
function initChart() {
  if (!chartRef.value) return
  chartInstance = echarts.init(chartRef.value, 'dark')
  chartInstance.setOption(buildChartOptions(), true)
}

function updateChart() {
  if (!chartInstance) return
  chartInstance.setOption(buildChartOptions(), true)
}

let resizeTimer = null
function handleResize() {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    chartInstance?.resize()
  }, 150)
}

// ========================
// 生命周期
// ========================
onMounted(async () => {
  await nextTick()
  initChart()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  if (resizeTimer) clearTimeout(resizeTimer)
  chartInstance?.dispose()
  chartInstance = null
})

// ========================
// 监听数据变化
// ========================
watch(
  () => props.series,
  () => {
    nextTick(() => {
      if (!chartInstance) {
        initChart()
      } else {
        updateChart()
      }
    })
  },
  { deep: true }
)

watch(
  () => props.loading,
  (val) => {
    if (!val) {
      nextTick(() => {
        if (!chartInstance) {
          initChart()
        } else {
          chartInstance.resize()
          updateChart()
        }
      })
    }
  }
)
</script>

<style scoped>
.trend-chart {
  position: relative;
  width: 100%;
  background: #131720;
  border-radius: 10px;
  border: 1px solid #1e2632;
  overflow: hidden;
}

.trend-chart.is-loading {
  min-height: 400px;
}

/* ---- Loading ---- */
.loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(13, 17, 23, 0.85);
  gap: 14px;
}

.loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #2a3040;
  border-top-color: #64B5F6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-text {
  color: #6b7280;
  font-size: 13px;
}

/* ---- Chart ---- */
.chart-container {
  width: 100%;
  height: 400px;
}

/* ---- Summary Cards ---- */
.summary-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  padding: 14px 16px 16px;
  border-top: 1px solid #1e2632;
}

.summary-card {
  background: #181d28;
  border: 1px solid #232a38;
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-label {
  font-size: 11px;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  font-weight: 500;
}

.card-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.card-value {
  font-size: 18px;
  font-weight: 700;
  color: #e0e6f0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.card-sub {
  font-size: 12px;
  color: #8b94a6;
}

.card-sub.muted {
  color: #4a5060;
}

/* 温度行 */
.temp-row {
  gap: 4px;
}

.temp-emoji {
  font-size: 20px;
  line-height: 1;
}

.temp-text {
  font-size: 18px;
  font-weight: 700;
}

.jieqi-name {
  font-weight: 600;
  color: #c0c8d8;
}

/* 乖离 */
.spread-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.spread-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.spread-label {
  font-size: 12px;
  color: #6b7280;
  font-weight: 500;
}

.spread-num {
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

/* 评分 */
.score-num {
  font-size: 22px;
  font-weight: 800;
}

.score-unit {
  font-size: 13px;
  color: #6b7280;
  font-weight: 400;
}

/* ATR */
.atr-num {
  font-size: 20px;
  font-weight: 700;
  color: #80CBC4;
}

/* ---- Signal Cards ---- */
.signal-cards {
  padding: 0 16px 16px;
}

/* ---- Responsive ---- */
@media (max-width: 768px) {
  .chart-container {
    height: 300px;
  }

  .summary-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .chart-container {
    height: 260px;
  }

  .summary-cards {
    grid-template-columns: 1fr;
  }
}
</style>
