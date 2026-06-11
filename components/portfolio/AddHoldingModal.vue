<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-title">{{ isEdit ? '编辑持仓' : '添加持仓' }}</div>
      <div class="modal-body">
        <!-- 搜索框（仅新增模式） -->
        <div v-if="!isEdit" class="form-group search-group">
          <label class="form-label">搜索股票（输入代码 / 名称）</label>
          <div class="search-input-wrap">
            <span class="search-icon">🔍</span>
            <input
              ref="searchInput"
              class="form-input search-input"
              v-model="query"
              placeholder="输入代码或名称，如 002240、盛新锂能、茅台..."
              @input="onSearch"
              @keydown.escape="searchResults = []"
              @keydown.enter.prevent="selectFirst"
              @keydown.down.prevent="moveDown"
              @keydown.up.prevent="moveUp"
            />
            <span v-if="loadingStockList" class="search-spinner">⏳ 加载股票列表...</span>
          </div>
          <!-- 搜索结果下拉 -->
          <div v-if="searchResults.length > 0" class="search-dropdown">
            <div
              v-for="(r, i) in searchResults"
              :key="r.ts_code"
              class="search-item"
              :class="{ 'search-item-active': i === selectedIndex }"
              @click="selectStock(r)"
              @mouseenter="selectedIndex = i"
            >
              <div class="search-item-left">
                <span class="search-code">{{ r.ts_code }}</span>
                <span class="search-name">{{ r.name }}</span>
              </div>
              <span class="search-tag">{{ r.industry || '--' }}</span>
            </div>
          </div>
          <div v-else-if="query.length >= 2 && searched && !loadingStockList && !form.name" class="search-dropdown search-empty-dropdown">
            <div class="search-empty-item">未找到匹配的股票</div>
          </div>
        </div>

        <!-- 已选股票 -->
        <div v-if="form.name" class="selected-stock">
          <div class="selected-stock-info">
            <span class="selected-code">{{ form.ts_code }}</span>
            <span class="selected-name">{{ form.name }}</span>
            <button class="btn btn-ghost btn-sm selected-clear" @click="clearStock">✕ 重新选择</button>
          </div>
        </div>

        <!-- 持仓信息 -->
        <div v-if="form.name" class="form-row-2">
          <div class="form-group">
            <label class="form-label">持仓成本（元）</label>
            <input class="form-input" v-model.number="form.cost" type="number" step="0.01" placeholder="0.00" />
          </div>
          <div class="form-group">
            <label class="form-label">持仓数量（股）</label>
            <input class="form-input" v-model.number="form.shares" type="number" step="100" placeholder="0" />
          </div>
        </div>
        <div v-if="form.name" class="form-row-2">
          <div class="form-group">
            <label class="form-label">建仓日期</label>
            <input class="form-input" v-model="form.buy_date" type="date" />
          </div>
          <div class="form-group">
            <label class="form-label">备注（选填）</label>
            <input class="form-input" v-model="form.note" placeholder="买入理由等" />
          </div>
        </div>

        <!-- 预览 -->
        <div v-if="form.name && form.cost > 0 && form.shares > 0" class="preview-card">
          <div class="preview-title">📋 持仓预览</div>
          <div class="preview-row">
            <span>投入金额</span>
            <span class="preview-value">{{ formatMoney(form.cost * form.shares) }}</span>
          </div>
          <div class="preview-row">
            <span>持仓股数</span>
            <span class="preview-value">{{ form.shares.toLocaleString() }} 股</span>
          </div>
          <div class="preview-row">
            <span>成本均价</span>
            <span class="preview-value">{{ formatMoney(form.cost) }}</span>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline" @click="$emit('close')">取消</button>
        <button class="btn btn-primary" @click="handleSubmit" :disabled="!canSubmit">
          {{ isEdit ? '💾 保存修改' : canSubmit ? '✅ 确认添加' : '请完善持仓信息' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatMoney } from '~/utils/formatters'

const emit = defineEmits<{ close: []; submit: [data: any]; update: [data: any] }>()
const props = defineProps<{ editData?: { id: string; ts_code: string; name: string; cost: number; shares: number; buy_date: string } | null }>()

const searchInput = ref<HTMLInputElement | null>(null)

const isEdit = computed(() => !!props.editData?.id)

const query = ref('')
const searchResults = ref<any[]>([])
const searched = ref(false)
const selectedIndex = ref(-1)
const loadingStockList = ref(false)

// ===== 全量股票列表（页面加载时拉一次） =====
const allStocks = ref<any[]>([])
const stockListLoaded = ref(false)

async function loadStockList() {
  if (stockListLoaded.value) return
  loadingStockList.value = true
  try {
    // 用原生 fetch，不依赖 Nuxt context
    const resp = await fetch('/api/stocks/search?q=')
    const json = await resp.json()
    // 这个接口对空 q 返回完整列表（需改造），目前用批量搜索兜底
    allStocks.value = json.data || []
    stockListLoaded.value = true
  } catch {
    // 兜底：用本地列表
    allStocks.value = LOCAL_FALLBACK
    stockListLoaded.value = true
  } finally {
    loadingStockList.value = false
  }
}

// 本地兜底（Tushare 挂掉时用）
const LOCAL_FALLBACK = [
  { ts_code: '000001.SZ', name: '平安银行', industry: '银行' },
  { ts_code: '000002.SZ', name: '万科A', industry: '房地产' },
  { ts_code: '000063.SZ', name: '中兴通讯', industry: '通信' },
  { ts_code: '000333.SZ', name: '美的集团', industry: '家用电器' },
  { ts_code: '000568.SZ', name: '泸州老窖', industry: '食品饮料' },
  { ts_code: '000651.SZ', name: '格力电器', industry: '家用电器' },
  { ts_code: '000725.SZ', name: '京东方A', industry: '电子' },
  { ts_code: '000858.SZ', name: '五粮液', industry: '食品饮料' },
  { ts_code: '002240.SZ', name: '盛新锂能', industry: '小金属' },
  { ts_code: '002230.SZ', name: '科大讯飞', industry: '计算机' },
  { ts_code: '002415.SZ', name: '海康威视', industry: '计算机' },
  { ts_code: '002475.SZ', name: '立讯精密', industry: '电子' },
  { ts_code: '002594.SZ', name: '比亚迪', industry: '汽车' },
  { ts_code: '002714.SZ', name: '牧原股份', industry: '农林牧渔' },
  { ts_code: '300014.SZ', name: '亿纬锂能', industry: '电力设备' },
  { ts_code: '300059.SZ', name: '东方财富', industry: '非银金融' },
  { ts_code: '300124.SZ', name: '汇川技术', industry: '机械设备' },
  { ts_code: '300274.SZ', name: '阳光电源', industry: '电力设备' },
  { ts_code: '300502.SZ', name: '新易盛', industry: '通信' },
  { ts_code: '300750.SZ', name: '宁德时代', industry: '电力设备' },
  { ts_code: '300760.SZ', name: '迈瑞医疗', industry: '医药生物' },
  { ts_code: '600036.SH', name: '招商银行', industry: '银行' },
  { ts_code: '600276.SH', name: '恒瑞医药', industry: '医药生物' },
  { ts_code: '600519.SH', name: '贵州茅台', industry: '食品饮料' },
  { ts_code: '600585.SH', name: '海螺水泥', industry: '建筑材料' },
  { ts_code: '600809.SH', name: '山西汾酒', industry: '食品饮料' },
  { ts_code: '600887.SH', name: '伊利股份', industry: '食品饮料' },
  { ts_code: '600900.SH', name: '长江电力', industry: '公用事业' },
  { ts_code: '601012.SH', name: '隆基绿能', industry: '电力设备' },
  { ts_code: '601166.SH', name: '兴业银行', industry: '银行' },
  { ts_code: '601318.SH', name: '中国平安', industry: '非银金融' },
  { ts_code: '601899.SH', name: '紫金矿业', industry: '有色金属' },
  { ts_code: '603259.SH', name: '药明康德', industry: '医药生物' },
  { ts_code: '603288.SH', name: '海天味业', industry: '食品饮料' },
  { ts_code: '688111.SH', name: '金山办公', industry: '计算机' },
  { ts_code: '688981.SH', name: '中芯国际', industry: '电子' },
]

const form = ref({
  ts_code: '',
  name: '',
  industry: '',
  cost: 0,
  shares: 0,
  buy_date: new Date().toISOString().slice(0, 10),
  note: '',
})

const canSubmit = computed(() => {
  if (isEdit.value) return form.value.cost > 0 && form.value.shares > 0
  return form.value.ts_code && form.value.name && form.value.cost > 0 && form.value.shares > 0
})

// ===== 初始化 =====
onMounted(async () => {
  if (isEdit.value && props.editData) {
    // 编辑模式：预填已有数据
    form.value.ts_code = props.editData.ts_code
    form.value.name = props.editData.name
    form.value.industry = (props.editData as any).industry || ''
    form.value.cost = props.editData.cost
    form.value.shares = props.editData.shares
    form.value.buy_date = props.editData.buy_date || new Date().toISOString().slice(0, 10)
    query.value = `${props.editData.name} (${props.editData.ts_code})`
  } else {
    await loadStockList()
  }
  nextTick(() => searchInput.value?.focus())
})

// ===== 搜索逻辑 =====
function onSearch() {
  const q = query.value.trim().toUpperCase()
  selectedIndex.value = -1

  if (q.length < 2) {
    searchResults.value = []
    searched.value = false
    return
  }

  // ★ 直接在浏览器本地匹配，零延迟
  const list = allStocks.value
  searchResults.value = list.filter((s: any) => {
    const code = (s.ts_code || '').toUpperCase()
    const name = (s.name || '').toUpperCase()
    return code.includes(q) || name.includes(q)
  }).slice(0, 15)

  searched.value = true
}

function moveDown() {
  if (searchResults.value.length === 0) return
  selectedIndex.value = (selectedIndex.value + 1) % searchResults.value.length
}
function moveUp() {
  if (searchResults.value.length === 0) return
  selectedIndex.value = selectedIndex.value <= 0
    ? searchResults.value.length - 1
    : selectedIndex.value - 1
}

function selectStock(stock: any) {
  form.value.ts_code = stock.ts_code
  form.value.name = stock.name
  form.value.industry = stock.industry || ''
  query.value = `${stock.name} (${stock.ts_code})`
  searchResults.value = []
  selectedIndex.value = -1
}

function selectFirst() {
  if (searchResults.value.length > 0) {
    const idx = selectedIndex.value >= 0 ? selectedIndex.value : 0
    selectStock(searchResults.value[idx])
  }
}

function clearStock() {
  form.value.ts_code = ''
  form.value.name = ''
  query.value = ''
  searchResults.value = []
  selectedIndex.value = -1
  nextTick(() => searchInput.value?.focus())
}

function handleSubmit() {
  if (!canSubmit.value) return
  const payload = {
    id: props.editData?.id,
    ts_code: form.value.ts_code,
    name: form.value.name,
    industry: form.value.industry,
    cost: form.value.cost,
    shares: form.value.shares,
    buy_date: form.value.buy_date,
  }
  if (isEdit.value) {
    emit('update', payload)
  } else {
    emit('submit', payload)
  }
  form.value = { ts_code: '', name: '', industry: '', cost: 0, shares: 0, buy_date: new Date().toISOString().slice(0, 10), note: '' }
  query.value = ''
}
</script>

<style scoped>
.search-group { position: relative; }
.search-input-wrap { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: 10px; font-size: 14px; opacity: 0.6; z-index: 1; }
.search-input { padding-left: 32px !important; padding-right: 16px !important; font-size: 14px; height: 40px; }
.search-spinner { position: absolute; right: 12px; font-size: 12px; color: var(--text-secondary); z-index: 1; }

.search-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  max-height: 360px;
  overflow-y: auto;
  z-index: 1010;
  margin-top: 2px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.5);
}

.search-empty-dropdown {
  max-height: 50px;
}

.search-empty-item {
  padding: 12px 14px;
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
}

.search-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.1s;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.search-item:hover, .search-item-active {
  background: rgba(51,112,255,0.12);
}

.search-item-left {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.search-code {
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-accent);
  white-space: nowrap;
  min-width: 85px;
}

.search-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-tag {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-input);
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
}

.selected-stock {
  margin-top: 12px;
  padding: 12px 16px;
  background: rgba(51,112,255,0.06);
  border: 1px solid rgba(51,112,255,0.2);
  border-radius: var(--radius-sm);
}

.selected-stock-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.selected-code {
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-accent);
}

.selected-name {
  font-size: 15px;
  font-weight: 700;
  flex: 1;
}

.selected-clear {
  color: var(--text-muted);
  font-size: 12px;
  padding: 2px 8px;
}

.form-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.preview-card {
  margin-top: 8px;
  padding: 14px 16px;
  background: var(--bg-input);
  border-radius: var(--radius-sm);
}

.preview-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.preview-row {
  display: flex;
  justify-content: space-between;
  padding: 3px 0;
  font-size: 13px;
}

.preview-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
