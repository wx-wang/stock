<template>
  <div class="data-table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th>代码·名称</th>
          <th class="text-right">成本</th>
          <th class="text-right">持仓</th>
          <th class="text-right">最新价</th>
          <th class="text-right">涨跌幅</th>
          <th class="text-right">市值</th>
          <th class="text-right">浮动盈亏</th>
          <th class="text-right">盈亏比例</th>
          <th class="text-center">PE</th>
          <th class="text-center">行业</th>
          <th class="text-center">AI建议</th>
          <th class="text-center">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td>
            <div class="stock-name-cell" @click="$emit('kline', row.ts_code, row.name)">
              <div style="font-weight:600;color:var(--color-accent);cursor:pointer;">{{ row.name }}</div>
              <div style="font-size:11px;color:var(--text-secondary)">{{ row.ts_code }}</div>
            </div>
          </td>
          <td class="text-right">{{ formatMoney(row.cost) }}</td>
          <td class="text-right">{{ row.shares.toLocaleString() }}股</td>
          <td class="text-right" :style="{ color: getChangeColor(row.change || 0) }">
            {{ row.close?.toFixed(2) || '-' }}
          </td>
          <td class="text-right">
            <span class="tag" :class="row.pct_chg > 0 ? 'tag-up' : row.pct_chg < 0 ? 'tag-down' : 'tag-neutral'">
              {{ formatPercent(row.pct_chg || 0) }}
            </span>
          </td>
          <td class="text-right">{{ formatLargeMoney(row.marketValue || 0) }}</td>
          <td class="text-right" :style="{ color: getChangeColor(row.profit || 0) }">
            {{ formatMoney(row.profit || 0) }}
          </td>
          <td class="text-right">
            <span class="tag" :class="(row.profitPct || 0) > 0 ? 'tag-up' : (row.profitPct || 0) < 0 ? 'tag-down' : 'tag-neutral'">
              {{ formatPercent(row.profitPct || 0) }}
            </span>
          </td>
          <td class="text-center">{{ row.pe ? row.pe.toFixed(1) : '-' }}</td>
          <td class="text-center">
            <span class="tag tag-accent">{{ row.industry || '-' }}</span>
          </td>
          <td class="text-center">
            <span v-if="row.aiSummary" class="ai-tag" :title="row.aiSummary" @click="$emit('aiAnalysis', row.ts_code, row.name)">{{ row.aiSummary }}</span>
            <button v-else class="btn btn-ghost btn-sm ai-btn" @click="$emit('aiAnalysis', row.ts_code, row.name)" title="AI分析">🤖</button>
          </td>
          <td class="text-center">
            <button class="btn btn-ghost btn-sm" @click="$emit('edit', row)" title="编辑">✏️</button>
            <button class="btn btn-ghost btn-sm" @click="$emit('remove', row.id)" title="删除">🗑️</button>
          </td>
        </tr>
        <tr v-if="rows.length === 0">
          <td colspan="13">
            <div class="state-message">
              <div class="icon">📋</div>
              <div class="text">暂无持仓，点击上方「添加持仓」开始</div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { formatMoney, formatLargeMoney, formatPercent, getChangeColor } from '~/utils/formatters'

interface TableRow {
  id: string
  ts_code: string
  name: string
  cost: number
  shares: number
  close?: number
  change?: number
  pct_chg?: number
  marketValue?: number
  profit?: number
  profitPct?: number
  pe?: number
  industry?: string
  aiSummary?: string
}

defineProps<{ rows: TableRow[] }>()
defineEmits<{ remove: [id: string]; edit: [row: TableRow]; kline: [tsCode: string, name: string]; aiAnalysis: [tsCode: string, name: string] }>()
</script>
