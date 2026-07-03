<template>
  <div class="trend-table-container">
    <!-- Header: Search + Filter + Count -->
    <div class="trend-table-header">
      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索代码 / 名称..."
          class="search-input"
        />
        <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="filter-group">
        <select v-model="tempFilter" class="temp-select">
          <option value="全部">全部</option>
          <option value="热+沸">热 + 沸</option>
          <option value="温">温</option>
          <option value="平及以下">平及以下</option>
        </select>
        <select v-model="signalFilter" class="temp-select">
          <option value="全部">全部信号</option>
          <option value="入场">✅ 入场信号</option>
          <option value="出场">⚠️ 出场信号</option>
        </select>

        <span class="count-badge">
          共 <strong>{{ filteredStocks.length }}</strong> / {{ stocks.length }} 只
        </span>
      </div>
    </div>

    <!-- Table -->
    <div class="table-scroll">
      <table class="trend-table">
        <thead>
          <tr>
            <th class="col-code">代码</th>
            <th class="col-name">名称</th>
            <th class="col-price">最新价</th>
            <th class="col-temp">温度</th>
            <th class="col-jieqi">节气</th>
            <th class="col-strength">强度</th>
            <th class="col-days">右侧天数</th>
            <th class="col-signal">信号</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="8" class="empty-cell">
              <div class="loading-spinner"></div>
              <span>加载中...</span>
            </td>
          </tr>
          <tr v-else-if="filteredStocks.length === 0">
            <td colspan="8" class="empty-cell">暂无数据</td>
          </tr>
          <tr
            v-for="stock in filteredStocks"
            :key="stock.code"
            class="stock-row"
            @click="handleSelect(stock)"
          >
            <td class="col-code">
              <span class="code-text">{{ stock.code }}</span>
            </td>
            <td class="col-name">
              <span class="name-text">{{ stock.name }}</span>
            </td>
            <td class="col-price">
              <span
                class="price-text"
                :class="stock.spread_20_60 != null ? (stock.spread_20_60 >= 0 ? 'up' : 'down') : ''"
              >
                {{ stock.close != null ? stock.close.toFixed(2) : '--' }}
              </span>
            </td>
            <td class="col-temp">
              <span
                v-if="stock.tempLabel"
                class="temp-badge"
                :style="{ backgroundColor: getTempColor(stock.tempLabel) }"
              >
                {{ stock.tempLabel }}
              </span>
              <span v-else class="temp-badge temp-null">--</span>
            </td>
            <td class="col-jieqi">
              <template v-if="stock.jieqi">
                <span class="jieqi-text">{{ stock.jieqi }}</span>
                <span v-if="stock.jieqiDays != null" class="jieqi-days">
                  {{ stock.jieqiDays }}d
                </span>
              </template>
              <span v-else class="jieqi-null">--</span>
            </td>
            <td class="col-strength">
              <span v-if="stock.strength != null" class="strength-text">
                {{ stock.strength }}
              </span>
              <span v-else class="strength-null">--</span>
            </td>
            <td class="col-days">
              <span v-if="stock.rightDays != null" class="days-text">
                {{ stock.rightDays }}
              </span>
              <span v-else class="days-null">--</span>
            </td>
            <td class="col-signal">
              <span v-if="stock.entrySignal" class="signal-entry">入场</span>
              <span v-else-if="stock.exitSignal" class="signal-exit">出场</span>
              <span v-else class="signal-none">--</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

// ── Temperature color map ──────────────────────────────────────────────
const TEMP_COLORS = {
  '沸': '#D4380D',
  '热': '#E15241',
  '温偏热': '#F0A030',
  '温': '#F5C842',
  '温偏凉': '#73D13D',
  '平': '#909399',
  '凉': '#40A9FF',
  '寒': '#3370FF',
  '冻': '#722ED1',
}

// Temperature filter groups
const TEMP_GROUPS = {
  '热+沸': ['沸', '热'],
  '温': ['温偏热', '温', '温偏凉'],
  '平及以下': ['平', '凉', '寒', '冻'],
}

// ── Props ──────────────────────────────────────────────────────────────
const props = defineProps({
  stocks: {
    type: Array,
    required: true,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
})

// ── Emits ──────────────────────────────────────────────────────────────
const emit = defineEmits(['select'])

// ── Reactive state ──────────────────────────────────────────────────────
const searchQuery = ref('')
const tempFilter = ref('全部')
const signalFilter = ref('全部')

// ── Computed: filtered stocks ──────────────────────────────────────────
const filteredStocks = computed(() => {
  let result = props.stocks || []

  // Signal filter
  if (signalFilter.value === '入场') {
    result = result.filter((s) => s.entrySignal === true)
  } else if (signalFilter.value === '出场') {
    result = result.filter((s) => s.exitSignal === true)
  }

  // Temperature filter
  if (tempFilter.value !== '全部') {
    const allowed = TEMP_GROUPS[tempFilter.value] || []
    result = result.filter((s) => allowed.includes(s.tempLabel))
  }

  // Search filter (case-insensitive, code or name)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    result = result.filter(
      (s) =>
        (s.code && String(s.code).toLowerCase().includes(q)) ||
        (s.name && s.name.toLowerCase().includes(q))
    )
  }

  return result
})

// ── Methods ────────────────────────────────────────────────────────────
function getTempColor(label) {
  return TEMP_COLORS[label] || '#909399'
}

function handleSelect(stock) {
  emit('select', stock)
}
</script>

<style scoped>
/* ── Container ───────────────────────────────────────────────────────── */
.trend-table-container {
  background: var(--bg-card, #1a1d2e);
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

/* ── Header ──────────────────────────────────────────────────────────── */
.trend-table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-wrap: wrap;
}

/* ── Search Box ──────────────────────────────────────────────────────── */
.search-box {
  position: relative;
  flex: 1;
  min-width: 200px;
  max-width: 340px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 16px;
  color: var(--text-secondary, #6b7280);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 38px;
  padding: 0 36px 0 38px;
  background: var(--bg-primary, #11131f);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: var(--text-primary, #e5e7eb);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.search-input::placeholder {
  color: var(--text-secondary, #6b7280);
}

.search-input:focus {
  border-color: rgba(59, 130, 246, 0.5);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: var(--text-secondary, #6b7280);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.search-clear:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #e5e7eb);
}

.search-clear svg {
  width: 14px;
  height: 14px;
}

/* ── Filter Group ────────────────────────────────────────────────────── */
.filter-group {
  display: flex;
  align-items: center;
  gap: 12px;
}

.temp-select {
  height: 38px;
  padding: 0 32px 0 12px;
  background: var(--bg-primary, #11131f);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: var(--text-primary, #e5e7eb);
  font-size: 13px;
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  transition: border-color 0.2s;
}

.temp-select:focus {
  border-color: rgba(59, 130, 246, 0.5);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
}

.count-badge {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
}

.count-badge strong {
  color: var(--text-primary, #e5e7eb);
  font-weight: 600;
}

/* ── Table Scroll ────────────────────────────────────────────────────── */
.table-scroll {
  max-height: 520px;
  overflow-y: auto;
  overflow-x: auto;
}

.table-scroll::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.table-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.table-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

.table-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.18);
}

/* ── Table ───────────────────────────────────────────────────────────── */
.trend-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}

/* ── Sticky Header ───────────────────────────────────────────────────── */
.trend-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.trend-table th {
  padding: 12px 12px;
  background: var(--bg-card, #1a1d2e);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #6b7280);
  text-align: left;
  white-space: nowrap;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  user-select: none;
}

.trend-table th:first-child {
  padding-left: 20px;
}

.trend-table th:last-child {
  padding-right: 20px;
}

/* ── Body Rows ───────────────────────────────────────────────────────── */
.trend-table td {
  padding: 11px 12px;
  font-size: 13px;
  color: var(--text-primary, #e5e7eb);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  white-space: nowrap;
}

.trend-table td:first-child {
  padding-left: 20px;
}

.trend-table td:last-child {
  padding-right: 20px;
}

.stock-row {
  cursor: pointer;
  transition: background 0.15s;
}

.stock-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.stock-row:active {
  background: rgba(255, 255, 255, 0.06);
}

/* ── Empty / Loading ─────────────────────────────────────────────────── */
.empty-cell {
  text-align: center !important;
  padding: 48px 12px !important;
  color: var(--text-secondary, #6b7280);
  font-size: 14px;
}

.loading-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.12);
  border-top-color: rgba(59, 130, 246, 0.7);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  vertical-align: middle;
  margin-right: 8px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Column: Code ────────────────────────────────────────────────────── */
.col-code {
  width: 90px;
}

.code-text {
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  color: var(--text-primary, #e5e7eb);
}

/* ── Column: Price ───────────────────────────────────────────────────── */
.col-price {
  width: 100px;
  text-align: right;
}

.price-text {
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

.price-text.up {
  color: var(--color-up, #ef4444);
}

.price-text.down {
  color: var(--color-down, #22c55e);
}

/* ── Column: Temperature Badge ───────────────────────────────────────── */
.col-temp {
  width: 100px;
}

.temp-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  line-height: 1.6;
  letter-spacing: 0.02em;
}

.temp-null {
  background: transparent;
  color: var(--text-secondary, #6b7280);
  font-weight: 400;
}

/* ── Column: Jieqi ───────────────────────────────────────────────────── */
.col-jieqi {
  width: 110px;
}

.jieqi-text {
  font-weight: 500;
}

.jieqi-days {
  margin-left: 4px;
  font-size: 11px;
  color: var(--text-secondary, #6b7280);
}

.jieqi-null {
  color: var(--text-secondary, #6b7280);
}

/* ── Column: Strength ────────────────────────────────────────────────── */
.col-strength {
  width: 70px;
  text-align: center;
}

.strength-text {
  font-weight: 500;
}

.strength-null {
  color: var(--text-secondary, #6b7280);
}

/* ── Column: Right Days ──────────────────────────────────────────────── */
.col-days {
  width: 90px;
  text-align: center;
}

.days-text {
  font-weight: 500;
}

.days-null {
  color: var(--text-secondary, #6b7280);
}

/* ── Signal badges ───────────────────────────────────────────────────── */
.signal-entry {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(76, 175, 80, 0.15);
  color: #4CAF50;
}

.signal-exit {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(244, 67, 54, 0.15);
  color: #F44336;
}

.signal-none {
  color: var(--text-secondary, #6b7280);
}

/* ── Responsive ──────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .col-jieqi,
  .col-strength {
    display: none;
  }

  .trend-table-header {
    padding: 12px 14px;
    gap: 10px;
  }

  .search-box {
    min-width: 140px;
    max-width: none;
    flex: 2;
  }

  .filter-group {
    flex: 1;
    justify-content: flex-end;
  }

  .temp-select {
    padding: 0 28px 0 10px;
    background-position: right 8px center;
  }

  .col-code {
    width: 70px;
  }

  .trend-table th {
    padding: 10px 8px;
  }

  .trend-table td {
    padding: 10px 8px;
  }

  .trend-table th:first-child {
    padding-left: 14px;
  }

  .trend-table td:first-child {
    padding-left: 14px;
  }

  .trend-table th:last-child {
    padding-right: 14px;
  }

  .trend-table td:last-child {
    padding-right: 14px;
  }

  .count-badge {
    display: none;
  }
}

@media (max-width: 480px) {
  .col-days {
    display: none;
  }

  .trend-table-header {
    flex-direction: column;
    align-items: stretch;
  }

  .search-box {
    max-width: none;
  }

  .filter-group {
    justify-content: space-between;
  }
}
</style>
