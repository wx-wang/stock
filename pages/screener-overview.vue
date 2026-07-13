<template>
  <div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <h2 style="font-size:18px;font-weight:700;margin:0;color:var(--text-primary);">📊 股票一览表</h2>
        <span v-if="totalStocks" style="font-size:12px;color:var(--text-muted);background:var(--bg-card);padding:2px 8px;border-radius:4px;">{{ totalStocks }} 只 · {{ groups.length }} 行业</span>
        <span v-if="marketPE" style="font-size:12px;color:var(--bg-card);background:var(--color-accent);padding:2px 8px;border-radius:4px;">全A PE{{ marketPE }} | r={{ discountRate }}%</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <input v-model="searchText" class="search-input" style="background:var(--bg-input);border:1px solid var(--border-color);border-radius:6px;color:var(--text-primary);padding:0 10px;height:32px;width:200px;" placeholder="🔍 搜索代码或名称..." />
        <button :disabled="loading" @click="refreshAll()" style="background:var(--color-accent);color:var(--bg-card);border:none;border-radius:6px;padding:0 12px;height:32px;font-size:12px;cursor:pointer;">
          {{ loading ? '⏳ 更新中...' : '🔄 更新数据' }}
        </button>
      </div>
    </div>

    <div v-if="error" style="padding:12px;background:rgba(225,82,65,0.08);border:1px solid rgba(225,82,65,0.2);border-radius:6px;margin-bottom:12px;color:var(--color-up);">{{ error }}</div>

    <div class="filter-bar" style="margin-bottom:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:6px 12px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;">
      <span style="font-size:13px;color:var(--text-muted);cursor:pointer;user-select:none;" @click="showFilters=!showFilters">🔽 高级筛选</span>
      <template v-if="showFilters">
        <span style="font-size:12px;color:var(--text-muted);">PEG</span>
        <input v-model="filterPegMin" type="number" step="0.1" placeholder="Min" style="width:70px;height:28px;background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);text-align:center;border-radius:4px;" />
        <span style="color:var(--text-muted);">—</span>
        <input v-model="filterPegMax" type="number" step="0.1" placeholder="Max" style="width:70px;height:28px;background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);text-align:center;border-radius:4px;" />
        <span style="font-size:12px;color:var(--text-muted);">估值空间%</span>
        <input v-model="filterUpsideMin" type="number" placeholder="Min" style="width:70px;height:28px;background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);text-align:center;border-radius:4px;" />
        <span style="color:var(--text-muted);">—</span>
        <input v-model="filterUpsideMax" type="number" placeholder="Max" style="width:70px;height:28px;background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);text-align:center;border-radius:4px;" />
        <span style="font-size:12px;color:var(--text-muted);">目标空间%</span>
        <input v-model="filterTargetMin" type="number" placeholder="Min" style="width:70px;height:28px;background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);text-align:center;border-radius:4px;" />
        <span style="color:var(--text-muted);">—</span>
        <input v-model="filterTargetMax" type="number" placeholder="Max" style="width:70px;height:28px;background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);text-align:center;border-radius:4px;" />
        <span style="font-size:12px;color:var(--text-muted);">🏅金股≥</span>
        <input v-model="filterGoldenMin" type="number" placeholder="次" style="width:50px;height:28px;background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);text-align:center;border-radius:4px;" />
        <span style="font-size:12px;color:var(--text-muted);">天花板</span>
        <input v-model="filterCeilingMin" type="number" step="0.1" placeholder="Min" style="width:60px;height:28px;background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);text-align:center;border-radius:4px;" />
        <span style="color:var(--text-muted);">—</span>
        <input v-model="filterCeilingMax" type="number" step="0.1" placeholder="Max" style="width:60px;height:28px;background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);text-align:center;border-radius:4px;" />
        <span style="font-size:12px;color:var(--text-muted);">PE空间%</span>
        <input v-model="filterPeSpaceMin" type="number" placeholder="Min" style="width:60px;height:28px;background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);text-align:center;border-radius:4px;" />
        <span style="color:var(--text-muted);">—</span>
        <input v-model="filterPeSpaceMax" type="number" placeholder="Max" style="width:60px;height:28px;background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);text-align:center;border-radius:4px;" />
      </template>
    </div>

    <div v-for="g in collapsedGroups" :key="g.industryName" style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;margin-bottom:10px;overflow:hidden;">
      <div @click="toggleGroup(g.industryName)" style="padding:10px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;color:var(--text-primary);">
        <span style="font-size:10px;">{{ expandedGroups.has(g.industryName) ? '▼' : '▶' }}</span>
        <span style="font-size:15px;font-weight:700;">{{ g.industryName }}</span>
        <span style="font-size:12px;color:var(--text-muted);">{{ g.displayStocks?.length || 0 }}/{{ g.count }}只</span>
        <span v-if="g.avgPe>0" style="font-size:12px;color:var(--text-muted);">均PE {{ g.avgPe }}</span>
        <span v-if="g.avgGrowth!==0" style="font-size:12px;" :style="{color:(g.avgGrowth>0?'var(--color-up)':'var(--color-down)')}">均26E {{ g.avgGrowth>0?'+':'' }}{{ g.avgGrowth }}%</span>
        <span v-if="g.avgPeg>0" style="font-size:12px;color:var(--color-accent);font-weight:700;">PEG {{ g.avgPeg }}</span>
      </div>
      <div v-if="expandedGroups.has(g.industryName)" style="padding:0 10px 8px;overflow-x:auto;">
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead>
            <tr style="font-size:10px;color:var(--text-muted);position:sticky;top:0;background:var(--bg-card);">
              <th style="padding:5px 8px;width:32px;">⭐</th>
              <th style="padding:5px 8px;text-align:left;">代码</th><th style="padding:5px 8px;text-align:left;">名称</th>
              <th style="padding:5px 8px;text-align:right;cursor:pointer;user-select:none;" @click="toggleSort('close')">股价{{sortIcon('close')}}</th>
              <th style="padding:5px 8px;text-align:right;cursor:pointer;user-select:none;" @click="toggleSort('peTtm')">PE_TTM{{sortIcon('peTtm')}}</th>
              <th style="padding:5px 8px;text-align:right;cursor:pointer;user-select:none;" @click="toggleSort('staticPe')">静态PE{{sortIcon('staticPe')}}</th>
              <th style="padding:5px 8px;text-align:center;cursor:pointer;user-select:none;" @click="toggleSort('growthCeiling')">天花板{{sortIcon('growthCeiling')}}</th>
              <th class="hide-mobile" style="padding:5px 8px;text-align:right;cursor:pointer;user-select:none;" @click="toggleSort('estimatedPe')">预估PE{{sortIcon('estimatedPe')}}</th>
              <th class="hide-mobile" style="padding:5px 8px;text-align:right;cursor:pointer;user-select:none;" @click="toggleSort('ceilingEps')">天花板EPS{{sortIcon('ceilingEps')}}</th>
              <th style="padding:5px 8px;text-align:right;cursor:pointer;user-select:none;" @click="toggleSort('terminalEps')">终局EPS{{sortIcon('terminalEps')}}</th>
              <th style="padding:5px 8px;text-align:right;cursor:pointer;user-select:none;" @click="toggleSort('terminalPe')">终局PE{{sortIcon('terminalPe')}}</th>
              <th class="hide-mobile" style="padding:5px 8px;text-align:center;cursor:pointer;user-select:none;" @click="toggleSort('peg')">PEG{{sortIcon('peg')}}</th>
              <th class="hide-mobile" style="padding:5px 8px;text-align:right;cursor:pointer;user-select:none;" @click="toggleSort('totalMv')">市值{{sortIcon('totalMv')}}</th>
              <th class="hide-mobile" style="padding:5px 8px;text-align:center;">研报</th>
              <th class="hide-mobile" style="padding:5px 8px;text-align:center;">{{ yearLabel(g,2) }}</th><th class="hide-mobile" style="padding:5px 8px;text-align:center;">{{ yearLabel(g,3) }}</th><th class="hide-mobile" style="padding:5px 8px;text-align:center;">{{ yearLabel(g,4) }}</th>
              <th class="hide-mobile" style="padding:5px 8px;text-align:center;">评级</th>
              <th style="padding:5px 8px;text-align:center;">🏅金股</th>
              <th class="hide-mobile" style="padding:5px 8px;text-align:center;">目标价/空间</th>
              <th class="hide-mobile" style="padding:5px 8px;text-align:center;">估值/空间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in g.displayStocks" :key="s.code" style="color:var(--text-primary);">
              <td style="padding:5px 8px;text-align:center;cursor:pointer;font-size:16px;" :title="watchlistCodes.has(s.code)?'取消自选':'加入自选'" @click="toggleWatchlist(s.code,s.name)">{{ watchlistCodes.has(s.code) ? '★' : '☆' }}</td>
              <td style="padding:5px 8px;font-family:monospace;font-size:12px;">{{ s.code }}</td>
              <td style="padding:5px 8px;font-weight:600;">{{ s.name }}</td>
              <td style="padding:5px 8px;text-align:right;font-family:monospace;">{{ s.close>0?s.close.toFixed(2):'--' }}</td>
              <td style="padding:5px 8px;text-align:right;font-family:monospace;">{{ s.peTtm>0?s.peTtm.toFixed(1):'--' }}</td>
              <td style="padding:5px 8px;text-align:right;font-family:monospace;">{{ (s.staticPe||0)>0?(s.staticPe||0).toFixed(1):'--' }}</td>
              <td style="padding:5px 8px;text-align:center;font-family:monospace;cursor:pointer;color:var(--color-accent);text-decoration:underline;" @click.stop="openCeiling(s)">{{ getCeiling(s)>0?getCeiling(s).toFixed(2)+'x':'--' }}</td>
              <td class="hide-mobile" style="padding:5px 8px;text-align:right;font-family:monospace;"><div>{{ getEstPe(s)>0?getEstPe(s).toFixed(1):'--' }}</div><div style="font-size:10px;font-family:monospace;" :style="{color:(getEstPe(s)>0&&(s.peTtm||0)>0&&getEstPe(s)/(s.peTtm||1)<1)?'var(--color-down)':'var(--color-up)'}">{{ (getEstPe(s)>0&&(s.peTtm||0)>0)?((getEstPe(s)/(s.peTtm||0)-1)*100).toFixed(0)+'%':'--' }}</div></td>
              <td class="hide-mobile" style="padding:5px 8px;text-align:right;font-family:monospace;">{{ getCeilingEps(s)>0?getCeilingEps(s).toFixed(2):'--' }}</td>
              <td style="padding:5px 8px;text-align:right;font-family:monospace;cursor:pointer;color:var(--color-down);" @click.stop="openTerminal(s)">{{ getTermEps(s)>0?getTermEps(s).toFixed(2):'--' }}</td>
              <td style="padding:5px 8px;text-align:right;font-family:monospace;">{{ getTermPe(s)>0?getTermPe(s).toFixed(1):'--' }}</td>
              <td class="hide-mobile" style="padding:5px 8px;text-align:center;font-family:monospace;">{{ s.peg>0?s.peg.toFixed(2):'--' }}</td>
              <td class="hide-mobile" style="padding:5px 8px;text-align:right;font-family:monospace;">{{ s.totalMv>0?s.totalMv.toFixed(1):'--' }}</td>
              <td class="hide-mobile" style="padding:5px 8px;text-align:center;"><span :style="{color:s.reports>=30?'var(--color-down)':s.reports>=15?'var(--color-accent)':'var(--text-muted)'}">{{ s.reports }}</span></td>
              <td class="hide-mobile" style="padding:5px 8px;text-align:center;"><template v-if="s.fy2Eps"><div style="font-family:monospace;">{{ s.fy2Eps.toFixed(2) }}</div><div style="font-size:10px;font-family:monospace;" :style="{color:s.fy2Growth>0?'var(--color-up)':'var(--color-down)'}">{{ (s.fy2Growth>0?'+':'')+s.fy2Growth.toFixed(1)+'%' }}</div></template><span v-else style="color:var(--text-muted);">--</span></td>
              <td class="hide-mobile" style="padding:5px 8px;text-align:center;"><template v-if="s.fy3Eps"><div style="font-family:monospace;">{{ s.fy3Eps.toFixed(2) }}</div><div style="font-size:10px;font-family:monospace;" :style="{color:s.fy3Growth>0?'var(--color-up)':'var(--color-down)'}">{{ (s.fy3Growth>0?'+':'')+s.fy3Growth.toFixed(1)+'%' }}</div></template><span v-else style="color:var(--text-muted);">--</span></td>
              <td class="hide-mobile" style="padding:5px 8px;text-align:center;"><template v-if="s.fy4Eps"><div style="font-family:monospace;">{{ s.fy4Eps.toFixed(2) }}</div><div style="font-size:10px;font-family:monospace;" :style="{color:s.fy4Growth>0?'var(--color-up)':'var(--color-down)'}">{{ (s.fy4Growth>0?'+':'')+s.fy4Growth.toFixed(1)+'%' }}</div></template><span v-else style="color:var(--text-muted);">--</span></td>
              <td class="hide-mobile" style="padding:5px 8px;text-align:center;"><span v-if="s.buyRating" style="color:var(--color-up);font-weight:600;">{{ s.buyRating }}B</span><span v-if="s.addRating" style="color:var(--text-muted);"> / {{ s.addRating }}A</span><span v-if="!s.buyRating&&!s.addRating" style="color:var(--text-muted);">--</span></td>
              <td style="padding:5px 8px;text-align:center;"><span v-if="s.isGoldenRecent">⭐</span><span v-if="s.goldenCount12m>0" :style="{color:s.isGoldenRecent?'var(--color-down)':'var(--text-muted)'}">{{ s.goldenCount12m }}/12</span><span v-if="s.goldenCount12m===0" style="color:var(--text-muted);">--</span></td>
              <td class="hide-mobile" style="padding:5px 8px;text-align:center;"><template v-if="s.targetPrice>0"><div style="font-family:monospace;">{{ s.targetPrice.toFixed(0) }}</div><div style="font-size:10px;font-family:monospace;" :style="{color:s.targetUpside>0?'var(--color-up)':'var(--color-down)'}">{{ (s.targetUpside>0?'+':'')+s.targetUpside.toFixed(1)+'%' }}</div></template><span v-else style="color:var(--text-muted);">--</span></td>
              <td class="hide-mobile" style="padding:5px 8px;text-align:center;"><template v-if="s.dcfValue>0"><div style="font-family:monospace;">{{ s.dcfValue.toFixed(1) }}</div><div style="font-size:10px;font-family:monospace;" :style="{color:s.dcfUpside>0?'var(--color-up)':'var(--color-down)'}">{{ (s.dcfUpside>0?'+':'')+s.dcfUpside.toFixed(1)+'%' }}</div></template><span v-else style="color:var(--text-muted);">--</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 天花板弹窗 -->
    <div v-if="ceilingStock" style="position:fixed;inset:0;background:rgba(43,36,28,0.42);z-index:1000;display:flex;align-items:center;justify-content:center;" @click="ceilingStock=null">
      <div @click.stop class="mobile-modal" style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:20px 24px;max-width:420px;width:90%;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <span style="font-size:16px;font-weight:700;color:var(--text-primary);">{{ ceilingStock.name }} ({{ ceilingStock.code }})</span>
          <span style="cursor:pointer;color:var(--text-muted);font-size:20px;" @click="ceilingStock=null">✕</span>
        </div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">
          静态PE: <b style="color:var(--text-primary);">{{ (ceilingStock.staticPe||0).toFixed(1) }}</b>
          &nbsp; PE_TTM: <b style="color:var(--text-primary);">{{ (ceilingStock.peTtm||0).toFixed(1) }}</b>
          &nbsp; 股价: <b style="color:var(--text-primary);">{{ (ceilingStock.close||0).toFixed(2) }}</b>
          <div style="margin-top:4px;">上年度EPS(估): <b style="color:var(--text-primary);">{{ (ceilingStock.staticPe||0)>0&&(ceilingStock.close||0)>0 ? ((ceilingStock.close||0)/(ceilingStock.staticPe||1)).toFixed(2) : '--' }}</b></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px 10px;background:rgba(69,107,143,0.08);border:1px solid rgba(69,107,143,0.18);border-radius:6px;flex-wrap:wrap;">
          <span style="font-size:12px;color:var(--text-muted);">折现率:</span>
          <select v-model="ceilingCustomRate" style="background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);border-radius:4px;padding:2px 6px;font-size:12px;height:26px;">
            <option v-for="r in ceilingRates" :key="r" :value="r">{{ (r*100).toFixed(0) }}%</option>
          </select>
          <span style="font-size:12px;color:var(--text-muted);">到达年数:</span>
          <select v-model="terminalYears" style="background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);border-radius:4px;padding:2px 6px;font-size:12px;height:26px;">
            <option :value="3">3年</option>
            <option :value="5">5年</option>
            <option :value="7">7年</option>
            <option :value="10">10年</option>
            <option :value="12">12年</option>
            <option :value="15">15年</option>
            <option :value="20">20年</option>
          </select>
          <span style="font-size:12px;font-family:monospace;color:var(--color-accent);margin-left:auto;">
            天花板 {{ liveCeiling }} &nbsp; EPS {{ liveCeilingEps }} &nbsp; 预估PE {{ liveEstPe }}
          </span>
          <button @click="applyCustomRate" style="background:var(--color-accent);color:var(--bg-card);border:none;border-radius:4px;padding:2px 10px;font-size:12px;height:26px;cursor:pointer;">应用</button>
          <button @click="resetCustomRate" style="background:transparent;color:var(--text-muted);border:1px solid var(--border-color);border-radius:4px;padding:2px 10px;font-size:12px;height:26px;cursor:pointer;">重置</button>
        </div>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          <thead><tr style="color:var(--text-muted);text-align:center;">
            <th style="padding:6px 12px;border-bottom:1px solid var(--border-color);">折现率</th>
            <th style="padding:6px 12px;border-bottom:1px solid var(--border-color);">天花板 (x倍)</th>
            <th style="padding:6px 12px;border-bottom:1px solid var(--border-color);">隐含增速</th>
          </tr></thead>
          <tbody>
            <tr v-for="r in ceilingRates" :key="r" style="text-align:center;color:var(--text-primary);" :style="{background:r===0.10?'rgba(69,107,143,0.08)':'transparent'}">
              <td style="padding:6px 12px;">{{ (r*100).toFixed(0) }}%</td>
              <td style="padding:6px 12px;font-family:monospace;" :style="{color:r===0.10?'var(--color-accent)':'var(--text-primary)'}">{{ computeCeilingForRate(ceilingStock.staticPe||0, r) }}</td>
              <td style="padding:6px 12px;font-family:monospace;">{{ computeGrowthRateForRate(ceilingStock.staticPe||0, r) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <!-- 终局EPS弹窗 -->
    <div v-if="terminalStock" style="position:fixed;inset:0;background:rgba(43,36,28,0.42);z-index:1000;display:flex;align-items:center;justify-content:center;" @click="terminalStock=null">
      <div @click.stop class="mobile-modal" style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:8px;padding:20px 24px;max-width:760px;width:95%;max-height:90vh;overflow-y:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <span style="font-size:16px;font-weight:700;color:var(--text-primary);">{{ terminalStock.name }} ({{ terminalStock.code }}) — 终局EPS</span>
          <span style="cursor:pointer;color:var(--text-muted);font-size:20px;" @click="terminalStock=null">✕</span>
        </div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">
          股价: <b style="color:var(--text-primary);">{{ (terminalStock.close||0).toFixed(2) }}</b>
          &nbsp; 静态PE: <b style="color:var(--text-primary);">{{ (terminalStock.staticPe||0)>0?(terminalStock.staticPe||0).toFixed(1):'亏损' }}</b>
          &nbsp; PE_TTM: <b style="color:var(--text-primary);">{{ (terminalStock.peTtm||0)>0?(terminalStock.peTtm||0).toFixed(1):'--' }}</b>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px 10px;background:rgba(45,139,111,0.08);border:1px solid rgba(45,139,111,0.18);border-radius:6px;flex-wrap:wrap;">
          <span style="font-size:12px;color:var(--text-muted);">折现率:</span>
          <select v-model="terminalCustomRate" style="background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);border-radius:4px;padding:2px 6px;font-size:12px;height:26px;">
            <option v-for="r in ceilingRates" :key="r" :value="r">{{ (r*100).toFixed(0) }}%</option>
          </select>
          <span style="font-size:12px;color:var(--text-muted);">年数:</span>
          <select v-model="terminalCustomYears" style="background:var(--bg-input);border:1px solid var(--border-color);color:var(--text-primary);border-radius:4px;padding:2px 6px;font-size:12px;height:26px;">
            <option :value="3">3年</option>
            <option :value="5">5年</option>
            <option :value="7">7年</option>
            <option :value="10">10年</option>
            <option :value="12">12年</option>
            <option :value="15">15年</option>
            <option :value="20">20年</option>
          </select>
          <span style="font-size:12px;font-family:monospace;color:var(--color-down);margin-left:auto;">
            终局EPS {{ liveTermEpsPreview }} &nbsp; 终局PE {{ liveTermPePreview }}
          </span>
          <button @click="applyTerminalCustom" style="background:var(--color-down);color:var(--bg-card);border:none;border-radius:4px;padding:2px 10px;font-size:12px;height:26px;cursor:pointer;">应用</button>
          <button @click="resetTerminalCustom" style="background:transparent;color:var(--text-muted);border:1px solid var(--border-color);border-radius:4px;padding:2px 10px;font-size:12px;height:26px;cursor:pointer;">重置</button>
        </div>
        <table style="width:100%;font-size:12px;border-collapse:collapse;">
          <thead>
            <tr style="color:var(--text-muted);text-align:center;">
              <th style="padding:6px 10px;border-bottom:1px solid var(--border-color);"></th>
              <th v-for="r in ceilingRates" :key="r" style="padding:6px 10px;border-bottom:1px solid var(--border-color);" :style="{background:r===0.10?'rgba(45,139,111,0.08)':'transparent'}">r={{ (r*100).toFixed(0) }}%</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="yr in terminalYearsAll" :key="yr" style="text-align:center;color:var(--text-primary);">
              <td style="padding:6px 10px;font-weight:600;" :style="{background:yr===10?'rgba(45,139,111,0.08)':'transparent'}">{{ yr }}年</td>
              <td v-for="r in ceilingRates" :key="r" style="padding:6px 10px;font-family:monospace;" :style="{background:r===0.10&&yr===10?'rgba(45,139,111,0.12)':'transparent'}">
                <div style="color:var(--color-down);">{{ fmtTermEps(terminalStock.close||0, r, yr) }}</div>
                <div style="font-size:10px;color:var(--text-muted);">PE{{ fmtTermPe(terminalStock.close||0, r, yr) }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
interface Stock { code:string;name:string;close:number;peTtm:number;staticPe:number;growthCeiling:number;estimatedPe:number;ceilingEps:number;terminalEps:number;terminalPe:number;totalMv:number;reports:number;fy2Eps:number;fy2Growth:number;fy2Year:number;fy3Eps:number;fy3Growth:number;fy3Year:number;fy4Eps:number;fy4Growth:number;fy4Year:number;buyRating:number;addRating:number;targetPrice:number;dcfValue:number;dcfUpside:number;peg:number;targetUpside:number;goldenCount12m:number;isGoldenRecent:boolean }
interface GroupData { industryName:string;count:number;avgPe:number;avgGrowth:number;avgPeg:number;stocks:Stock[];displayStocks?:Stock[] }

const groups = ref<GroupData[]>([])
const totalStocks = ref(0)
const marketPE = ref(0)
const discountRate = ref(0)
const loading = ref(false)
const error = ref<string|null>(null)
const searchText = ref('')
const showFilters = ref(false)
const filterPegMin = ref(''); const filterPegMax = ref('')
const filterUpsideMin = ref(''); const filterUpsideMax = ref('')
const filterTargetMin = ref(''); const filterTargetMax = ref('')
const filterGoldenMin = ref('')
const filterCeilingMin = ref(''); const filterCeilingMax = ref('')
const filterPeSpaceMin = ref(''); const filterPeSpaceMax = ref('')
const expandedGroups = ref(new Set<string>())
const watchlistCodes = ref(new Set<string>())

const sortField = ref('totalMv')
const sortDir = ref(-1)

function sortIcon(field: string): string {
  if (sortField.value !== field) return ''
  return sortDir.value === -1 ? ' ↓' : ' ↑'
}
function toggleSort(field: string) {
  if (sortField.value === field) sortDir.value = -sortDir.value
  else { sortField.value = field; sortDir.value = -1 }
}

function yearLabel(g: GroupData, fy: 2|3|4): string {
  const s = g.stocks.find(s => { const yr = (s as any)['fy'+fy+'Year']; return yr && yr > 2000 })
  if (s) { const yr = (s as any)['fy'+fy+'Year']; return String(yr % 100) + 'E' }
  return ['', '26E', '27E', '28E'][fy]
}
function toggleGroup(name:string) {
  if (expandedGroups.value.has(name)) expandedGroups.value.delete(name)
  else expandedGroups.value.add(name)
  expandedGroups.value = new Set(expandedGroups.value)
}
function matches(st:Stock):boolean {
  const toNum = (v:string) => { const n = parseFloat(v); return isNaN(n) ? null : n }
  const peg = toNum(filterPegMin.value); if (peg !== null && (st.peg || 0) < peg) return false
  const pegM = toNum(filterPegMax.value); if (pegM !== null && (st.peg || 0) > pegM) return false
  const up = toNum(filterUpsideMin.value); if (up !== null && (st.dcfUpside || 0) < up) return false
  const upM = toNum(filterUpsideMax.value); if (upM !== null && (st.dcfUpside || 0) > upM) return false
  const tgt = toNum(filterTargetMin.value); if (tgt !== null && (st.targetUpside || 0) < tgt) return false
  const tgtM = toNum(filterTargetMax.value); if (tgtM !== null && (st.targetUpside || 0) > tgtM) return false
  const gold = toNum(filterGoldenMin.value); if (gold !== null && (st.goldenCount12m || 0) < gold) return false
  const ceil = toNum(filterCeilingMin.value); if (ceil !== null && (st.growthCeiling || 0) < ceil) return false
  const ceilM = toNum(filterCeilingMax.value); if (ceilM !== null && (st.growthCeiling || 0) > ceilM) return false
  const peSpace = getEstPe(st)>0&&(st.peTtm||0)>0 ? (getEstPe(st)/(st.peTtm||0)-1)*100 : null
  const psMin = toNum(filterPeSpaceMin.value); if (psMin !== null && (peSpace===null || peSpace < psMin)) return false
  const psMax = toNum(filterPeSpaceMax.value); if (psMax !== null && (peSpace===null || peSpace > psMax)) return false
  return true
}
function sortArr(arr:Stock[], field:string, dir:number):Stock[] { return [...arr].sort((a,b)=>{ const va=Number((a as any)[field])||0; const vb=Number((b as any)[field])||0; if(va===vb) return ((b.totalMv||0)-(a.totalMv||0)); return (va-vb)*dir }) }
const collapsedGroups = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const hf = !!(filterPegMin.value||filterPegMax.value||filterUpsideMin.value||filterUpsideMax.value||filterTargetMin.value||filterTargetMax.value||filterGoldenMin.value||filterCeilingMin.value||filterCeilingMax.value||filterPeSpaceMin.value||filterPeSpaceMax.value)
  return groups.value.map(g => {
    let f = g.stocks
    if (q) f = f.filter(s => s.code.includes(q) || s.name.toLowerCase().includes(q))
    if (hf) f = f.filter(matches)
    return { ...g, displayStocks: sortArr(f as Stock[], sortField.value, sortDir.value) }
  }).filter(g => g.displayStocks!.length > 0)
})
async function loadData(refresh: boolean) {
  error.value = null
  if (refresh) loading.value = true
  try {
    const r = await fetch(refresh ? '/api/screener/overview?refresh=true' : '/api/screener/overview')
    const j = await r.json()
    if (j.success) { groups.value = j.groups; totalStocks.value = j.totalStocks; marketPE.value = j.marketPE || 0; discountRate.value = j.discountRate || 0 }
    else error.value = j.error || '加载失败'
  } catch (e: any) { error.value = e.message }
  finally { loading.value = false }
}
async function loadWatchlist() {
  try {
    const r = await fetch('/api/watchlist')
    const j = await r.json()
    const list = j.data?.stocks || j.stocks || []
    watchlistCodes.value = new Set(list.map((s: any) => (s.ts_code || '').replace(/\.(SZ|SH)$/, '')))
  } catch {}
}
function todayStr() { const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0') }
async function toggleWatchlist(code: string, name: string) {
  const old = new Set(watchlistCodes.value)
  const tc = code.startsWith('6')||code.startsWith('9')||code.startsWith('8') ? code+'.SH' : code+'.SZ'
  if (watchlistCodes.value.has(code)) {
    watchlistCodes.value = new Set([...watchlistCodes.value].filter(c => c !== code))
    try { await fetch('/api/watchlist?ts_code='+encodeURIComponent(tc), { method: 'DELETE' }) } catch { watchlistCodes.value = old }
  } else {
    watchlistCodes.value = new Set([...watchlistCodes.value, code])
    try {
      const r = await fetch('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ts_code: tc, name, selected_date: todayStr() }) })
      const j = await r.json()
      if (!j.success) watchlistCodes.value = old
    } catch { watchlistCodes.value = old }
  }
}
function refreshAll() { loadData(true) }

const ceilingStock = ref<Stock|null>(null)
const terminalStock = ref<Stock|null>(null)
const terminalYearsAll = [3,5,7,10,12,15,20]
const terminalCustomRate = ref(0.10)
const terminalCustomYears = ref(10)
const ceilingRates = [0.02, 0.04, 0.06, 0.08, 0.10, 0.12, 0.14, 0.16]
const ceilingCustomRate = ref(0.10)
const terminalYears = ref(10)
const customCeilingMap = ref(new Map<string, {ceiling:number, estPe:number, eps:number, terminalEps:number, terminalPe:number, rate:number}>())

function getCeiling(s: Stock): number {
  const m = customCeilingMap.value.get(s.code)
  return m ? m.ceiling : (s.growthCeiling || 0)
}
function getCeilingEps(s: Stock): number {
  const m = customCeilingMap.value.get(s.code)
  return m ? m.eps : (s.ceilingEps || 0)
}
function getEstPe(s: Stock): number {
  const m = customCeilingMap.value.get(s.code)
  return m ? m.estPe : (s.estimatedPe || 0)
}
function getTermEps(s: Stock): number {
  const m = customCeilingMap.value.get(s.code)
  return m ? m.terminalEps : (s.terminalEps || 0)
}
function getTermPe(s: Stock): number {
  const m = customCeilingMap.value.get(s.code)
  return m ? m.terminalPe : (s.terminalPe || 0)
}
const liveCeiling = computed(() => {
  const s = ceilingStock.value; if (!s) return '--'
  return computeCeilingForRate(s.staticPe||0, ceilingCustomRate.value)
})
const liveCeilingEps = computed(() => {
  const s = ceilingStock.value; if (!s) return '--'
  const sp = s.staticPe||0; const cl = s.close||0
  if (sp<=0||cl<=0) return '--'
  const eps = cl/sp
  const ceil = parseFloat(computeCeilingForRate(sp, ceilingCustomRate.value)) || 0
  return (ceil * eps).toFixed(2)
})
const liveEstPe = computed(() => {
  const s = ceilingStock.value; if (!s) return '--'
  const sp = s.staticPe||0
  const gc = parseFloat(computeCeilingForRate(sp, ceilingCustomRate.value)) || 0
  if (gc<=0) return '--'
  return (sp / Math.pow(gc, 0.1)).toFixed(1)
})
const liveTermEps = computed(() => {
  const s = ceilingStock.value; if (!s) return '--'
  return computeTerminalEps(s.close||0, ceilingCustomRate.value, terminalYears.value).toFixed(2)
})
const liveTermEpsPreview = computed(() => {
  const s=terminalStock.value; if(!s) return '--'
  return computeTerminalEps(s.close||0, terminalCustomRate.value, terminalCustomYears.value).toFixed(2)
})
const liveTermPePreview = computed(() => {
  const s=terminalStock.value; if(!s) return '--'
  const te=computeTerminalEps(s.close||0, terminalCustomRate.value, terminalCustomYears.value)
  return te>0 ? ((s.close||0)/te).toFixed(1) : '--'
})
function applyTerminalCustom() {
  const s = terminalStock.value; if(!s) return
  const cl=s.close||0; const r=terminalCustomRate.value
  const te=computeTerminalEps(cl,r,terminalCustomYears.value)
  const tp=te>0?cl/te:0
  const m=new Map(customCeilingMap.value)
  const old=m.get(s.code)||{ceiling:s.growthCeiling||0,estPe:s.estimatedPe||0,eps:s.ceilingEps||0,terminalEps:s.terminalEps||0,terminalPe:s.terminalPe||0,rate:0.10}
  m.set(s.code,{...old,terminalEps:te,terminalPe:tp})
  customCeilingMap.value=m
}
function resetTerminalCustom() {
  const s=terminalStock.value; if(!s) return
  const m=new Map(customCeilingMap.value)
  const old=m.get(s.code)
  if(old){m.set(s.code,{...old,terminalEps:s.terminalEps||0,terminalPe:s.terminalPe||0})}
  else m.delete(s.code)
  customCeilingMap.value=m
  terminalCustomRate.value=0.10; terminalCustomYears.value=10
}
const liveTermPe = computed(() => {
  const s = ceilingStock.value; if (!s) return '--'
  const te = computeTerminalEps(s.close||0, ceilingCustomRate.value, terminalYears.value)
  return te>0 ? ((s.close||0)/te).toFixed(1) : '--'
})
function applyCustomRate() {
  const s = ceilingStock.value; if (!s) return
  const sp = s.staticPe||0; const cl = s.close||0; const r = ceilingCustomRate.value
  const gc = parseFloat(computeCeilingForRate(sp, r)) || 0
  const eps = sp>0&&cl>0 ? cl/sp : 0
  const estPe = gc>0 ? sp / Math.pow(gc, 0.1) : 0
  const m = new Map(customCeilingMap.value)
  const te = computeTerminalEps(cl, r, terminalYears.value)
  const tp = te>0 ? cl/te : 0
  m.set(s.code, { ceiling: gc, estPe, eps: gc*eps, terminalEps: te, terminalPe: tp, rate: r })
  customCeilingMap.value = m
}
function resetCustomRate() {
  const s = ceilingStock.value; if (!s) return
  const m = new Map(customCeilingMap.value)
  m.delete(s.code)
  customCeilingMap.value = m
  ceilingCustomRate.value = 0.10
}
function openCeiling(s: Stock) { ceilingStock.value = s; ceilingCustomRate.value = 0.10; terminalYears.value = 10 }
function openTerminal(s: Stock) { terminalStock.value = s; terminalCustomRate.value = 0.10; terminalCustomYears.value = 10 }
function peCalc(g: number, r: number): number {
  const g1 = 1+g, r1 = 1+r
  let sum=0, gp=g1, rp=r1
  for (let t=1;t<=10;t++){sum+=gp/rp;gp*=g1;rp*=r1}
  return sum+(gp/g1)/(r*(rp/r1))
}
function computeCeilingForRate(pe: number, r: number): string {
  if (pe<=0||r<=0) return '--'
  let lo=-0.999, hi=0.50
  for (let i=0;i<30;i++){const mid=(lo+hi)/2;if(peCalc(mid,r)<pe)lo=mid;else hi=mid}
  const g=(lo+hi)/2
  if (g<=-0.9) return '--'
  return ((1+g)**10).toFixed(2)+'x'
}
function computeGrowthRateForRate(pe: number, r: number): string {
  if (pe<=0||r<=0) return '--'
  let lo=-0.999, hi=0.50
  for (let i=0;i<30;i++){const mid=(lo+hi)/2;if(peCalc(mid,r)<pe)lo=mid;else hi=mid}
  const g=(lo+hi)/2
  if (g<=-0.9) return '--'
  return (g>0?'+':'')+(g*100).toFixed(1)+'%'
}

function computeTerminalEps(price: number, r: number, n: number): number {
  if (price<=0||r<=0||n<=0) return 0
  const r1=1+r; let sum=0, rp=r1
  for (let t=1;t<=n;t++){sum+=(t/n)/rp;rp*=r1}
  const d=sum+1/(r*Math.pow(r1,n))
  return d>0?price/d:0
}

function fmtTermEps(price:number, r:number, n:number): string {
  const te=computeTerminalEps(price,r,n)
  return te>0?te.toFixed(2):'--'
}
function fmtTermPe(price:number, r:number, n:number): string {
  const te=computeTerminalEps(price,r,n)
  return te>0?(price/te).toFixed(1):'--'
}

onMounted(() => { loadData(false); loadWatchlist() })
</script>
