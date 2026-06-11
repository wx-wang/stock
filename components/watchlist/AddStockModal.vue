<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-title">添加自选股</div>
      <div class="modal-body">
        <!-- 搜索框 -->
        <div class="form-group search-group">
          <label class="form-label">搜索股票（输入代码 / 名称）</label>
          <div class="search-input-wrap">
            <span class="search-icon">🔍</span>
            <input
              ref="searchInput"
              class="form-input search-input"
              v-model="query"
              placeholder="输入代码或名称，如 002240、盛新锂能、赣锋..."
              @input="onSearch"
              @keydown.escape="results = []"
              @keydown.enter.prevent="selectFirst"
              @keydown.down.prevent="moveDown"
              @keydown.up.prevent="moveUp"
            />
          </div>
          <!-- 搜索结果下拉 -->
          <div v-if="results.length > 0" class="search-dropdown">
            <div
              v-for="(r, i) in results"
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
          <div v-else-if="query.length >= 2 && searched && !form.name" class="search-dropdown search-empty-dropdown">
            <div class="search-empty-item">未找到匹配的股票</div>
          </div>
        </div>

        <!-- 已选股票 -->
        <div v-if="form.name" class="selected-stock">
          <div class="selected-stock-info">
            <span class="selected-code">{{ form.ts_code }}</span>
            <span class="selected-name">{{ form.name }}</span>
            <span v-if="form.industry" class="search-tag" style="margin-left:6px;">{{ form.industry }}</span>
            <button class="btn btn-ghost btn-sm selected-clear" @click="clearStock">✕ 重新选择</button>
          </div>
        </div>

        <!-- 自选日期 -->
        <div v-if="form.name" class="form-group" style="margin-top:12px;">
          <label class="form-label">自选日期（标记在K线上）</label>
          <input class="form-input" v-model="form.selectedDate" type="date" />
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-outline" @click="$emit('close')">取消</button>
        <button class="btn btn-primary" @click="handleSubmit" :disabled="!form.name || adding">
          {{ adding ? '添加中...' : form.name ? '✅ 确认添加' : '请先选择股票' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{ close: []; submit: [tsCode: string, name: string, industry: string, selectedDate: string] }>()

const searchInput = ref<HTMLInputElement | null>(null)

const query = ref('')
const results = ref<any[]>([])
const searched = ref(false)
const selectedIndex = ref(-1)
const adding = ref(false)

const form = ref({ ts_code: '', name: '', industry: '', selectedDate: new Date().toISOString().slice(0, 10) })

// ===== 本地股票列表（页面加载时预加载） =====
const allStocks = ref<any[]>([])
const stockListLoaded = ref(false)
const loadingStockList = ref(false)

const LOCAL_FALLBACK = [
  { ts_code: '000001.SZ', name: '平安银行', industry: '银行' },
  { ts_code: '000002.SZ', name: '万科A', industry: '房地产' },
  { ts_code: '000063.SZ', name: '中兴通讯', industry: '通信' },
  { ts_code: '000333.SZ', name: '美的集团', industry: '家用电器' },
  { ts_code: '000568.SZ', name: '泸州老窖', industry: '食品饮料' },
  { ts_code: '000651.SZ', name: '格力电器', industry: '家用电器' },
  { ts_code: '000858.SZ', name: '五粮液', industry: '食品饮料' },
  { ts_code: '002230.SZ', name: '科大讯飞', industry: '计算机' },
  { ts_code: '002240.SZ', name: '盛新锂能', industry: '小金属' },
  { ts_code: '002415.SZ', name: '海康威视', industry: '计算机' },
  { ts_code: '002460.SZ', name: '赣锋锂业', industry: '小金属' },
  { ts_code: '002475.SZ', name: '立讯精密', industry: '电子' },
  { ts_code: '002594.SZ', name: '比亚迪', industry: '汽车' },
  { ts_code: '002714.SZ', name: '牧原股份', industry: '农林牧渔' },
  { ts_code: '300014.SZ', name: '亿纬锂能', industry: '电力设备' },
  { ts_code: '300059.SZ', name: '东方财富', industry: '非银金融' },
  { ts_code: '300124.SZ', name: '汇川技术', industry: '机械设备' },
  { ts_code: '300274.SZ', name: '阳光电源', industry: '电力设备' },
  { ts_code: '300502.SZ', name: '新易盛', industry: '通信' },
  { ts_code: '300750.SZ', name: '宁德时代', industry: '电力设备' },
  { ts_code: '600036.SH', name: '招商银行', industry: '银行' },
  { ts_code: '600276.SH', name: '恒瑞医药', industry: '医药生物' },
  { ts_code: '600519.SH', name: '贵州茅台', industry: '食品饮料' },
  { ts_code: '600809.SH', name: '山西汾酒', industry: '食品饮料' },
  { ts_code: '600900.SH', name: '长江电力', industry: '公用事业' },
  { ts_code: '601012.SH', name: '隆基绿能', industry: '电力设备' },
  { ts_code: '601318.SH', name: '中国平安', industry: '非银金融' },
  { ts_code: '601899.SH', name: '紫金矿业', industry: '有色金属' },
  { ts_code: '603259.SH', name: '药明康德', industry: '医药生物' },
  { ts_code: '688981.SH', name: '中芯国际', industry: '电子' },
]

async function loadStockList() {
  if (stockListLoaded.value) return
  loadingStockList.value = true
  try {
    const resp = await fetch('/api/stocks/search?q=')
    const json = await resp.json()
    allStocks.value = json.data || []
    stockListLoaded.value = true
  } catch {
    allStocks.value = LOCAL_FALLBACK
    stockListLoaded.value = true
  } finally {
    loadingStockList.value = false
  }
}

onMounted(async () => {
  await loadStockList()
  nextTick(() => searchInput.value?.focus())
})

// ===== 搜索 =====
function onSearch() {
  const q = query.value.trim().toUpperCase()
  selectedIndex.value = -1
  if (q.length < 2) { results.value = []; searched.value = false; return }
  results.value = allStocks.value.filter((s: any) =>
    (s.ts_code || '').toUpperCase().includes(q) || (s.name || '').toUpperCase().includes(q)
  ).slice(0, 15)
  searched.value = true
}

function moveDown() {
  if (results.value.length === 0) return
  selectedIndex.value = (selectedIndex.value + 1) % results.value.length
}
function moveUp() {
  if (results.value.length === 0) return
  selectedIndex.value = selectedIndex.value <= 0 ? results.value.length - 1 : selectedIndex.value - 1
}

function selectStock(stock: any) {
  form.value = { ts_code: stock.ts_code, name: stock.name, industry: stock.industry || '', selectedDate: form.value.selectedDate }
  query.value = `${stock.name} (${stock.ts_code})`
  results.value = []
  selectedIndex.value = -1
}

function selectFirst() {
  if (results.value.length > 0) {
    selectStock(results.value[selectedIndex.value >= 0 ? selectedIndex.value : 0])
  }
}

function clearStock() {
  form.value = { ts_code: '', name: '', industry: '', selectedDate: form.value.selectedDate }
  query.value = ''
  results.value = []
  nextTick(() => searchInput.value?.focus())
}

async function handleSubmit() {
  if (!form.value.name || adding.value) return
  adding.value = true
  emit('submit', form.value.ts_code, form.value.name, form.value.industry, form.value.selectedDate)
}
</script>

<style scoped>
.search-group { position: relative; }
.search-input-wrap { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: 10px; font-size: 14px; opacity: 0.6; z-index: 1; }
.search-input { padding-left: 32px !important; padding-right: 16px !important; font-size: 14px; height: 40px; }

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
.search-empty-dropdown { max-height: 50px; }
.search-empty-item { padding: 12px 14px; font-size: 13px; color: var(--text-secondary); text-align: center; }

.search-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.1s;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.search-item:hover, .search-item-active { background: rgba(51,112,255,0.12); }
.search-item-left { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
.search-code {
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  font-size: 12px; font-weight: 700;
  color: var(--color-accent);
  white-space: nowrap; min-width: 85px;
}
.search-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.search-tag {
  font-size: 11px; color: var(--text-secondary);
  background: var(--bg-input); padding: 2px 8px; border-radius: 4px; white-space: nowrap;
}

.selected-stock {
  margin-top: 12px;
  padding: 12px 16px;
  background: rgba(51,112,255,0.06);
  border: 1px solid rgba(51,112,255,0.2);
  border-radius: var(--radius-sm);
}
.selected-stock-info { display: flex; align-items: center; gap: 10px; }
.selected-code { font-family: 'JetBrains Mono', 'SF Mono', monospace; font-size: 12px; font-weight: 700; color: var(--color-accent); }
.selected-name { font-size: 15px; font-weight: 700; flex: 1; }
.selected-clear { color: var(--text-muted); font-size: 12px; padding: 2px 8px; }
</style>
