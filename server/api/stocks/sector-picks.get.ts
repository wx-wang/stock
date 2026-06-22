/**
 * GET /api/stocks/sector-picks
 *
 * 行业掘金：基于行业轮动（CAPM四象限）精选个股，多因子打分 + 简单组合优化
 *
 * Query:
 *  ?days=60         — CAPM 计算窗口
 *  ?quadrant=Q1,Q2  — 选哪些象限（默认 Q1+Q2）
 *  ?count=10        — 推荐股数上限（默认10）
 *  ?force=false     — 强制重算
 */
import { getIndexMember } from '@/server/lib/tushare'
import { promises as fs } from 'fs'
import path from 'path'

import { PERSIST_DIR } from '../../config'

// ── 类型 ──

interface SectorData {
  ts_code: string
  name: string
  alphaAnnual: number
  beta: number
  alphaMomentum: number
  sharpe: number
  cumulativeReturn: number
  crowdingPct: number
}

interface StockScore {
  ts_code: string
  name: string
  sectorName: string
  sectorAlpha: number
  sectorBeta: number

  // Screener fields
  close: number
  peTtm: number
  totalMv: number
  dcfUpside: number
  targetUpside: number
  peg: number
  goldenCount12m: number
  isGoldenRecent: boolean
  buyRating: number
  fy2Growth: number
  terminalPe: number

  // Scores
  scoreMomentum: number    // 25%
  scoreValuation: number   // 25%
  scoreConsensus: number   // 20%
  scoreGrowth: number      // 15%
  scoreCrowding: number    // 15% — 拥挤风险（行业不拥挤=高分）
  totalScore: number
}

// ── 缓存 ──
function getCachePath(days: number, quadrants: string): string {
  return path.join(PERSIST_DIR, `sector-picks-d${days}-${quadrants.replace(/,/g,'_')}.json`)
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── 读取 screener 缓存 ──
async function readScreenerCache(): Promise<Map<string, any>> {
  const map = new Map<string, any>()
  const file = path.join(PERSIST_DIR, 'screener-overview.json')
  try {
    const raw = await fs.readFile(file, 'utf-8')
    const data = JSON.parse(raw)
    const groups = data.groups || []
    for (const g of groups) {
      const stocks = g.displayStocks || g.stocks || []
      for (const st of stocks) {
        map.set(st.code, st)
      }
    }
    console.log(`[sector-picks] screener cache: ${map.size} stocks`)
  } catch { console.warn('[sector-picks] screener cache not found') }
  return map
}

// ── 读取 CAPM 缓存（复用 sectors/capm 的缓存） ──
async function readCapmCache(days: number, indexCode = '000300.SH'): Promise<SectorData[]> {
  const capmFile = path.join(PERSIST_DIR, `sectors-capm-d${days}-${indexCode.replace('.','_')}-v5.json`)
  try {
    const raw = await fs.readFile(capmFile, 'utf-8')
    const data = JSON.parse(raw)
    console.log(`[sector-picks] CAPM cache: ${data.sectors?.length || 0} sectors`)
    return (data.sectors || []) as SectorData[]
  } catch {
    console.warn('[sector-picks] CAPM cache not found, run /api/sectors/capm first')
    return []
  }
}

// ── 归一化（0~1） ──
function normalize(values: number[], invert = false): number[] {
  if (!values.length) return values
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return values.map(() => 0.5)
  return values.map(v => invert ? (max - v) / (max - min) : (v - min) / (max - min))
}

// ── 主逻辑 ──
export default defineEventHandler(async (event) => {
  try {
    const q = getQuery(event)
    const days = parseInt(q.days as string) || 60
    const rawQuad = (q.quadrant as string) || 'Q1,Q2'
    const quadrants = rawQuad.split(',').map(s => s.trim())
    const count = Math.min(parseInt(q.count as string) || 10, 20)
    const force = q.force === 'true'

    const cachePath = getCachePath(days, rawQuad)
    const capmFile = path.join(PERSIST_DIR, `sectors-capm-d${days}-000300_SH-v5.json`)

    // Cache check — 仅当天有效 + CAPM缓存不能比它新
    if (!force) {
      try {
        const cached = JSON.parse(await fs.readFile(cachePath, 'utf-8'))
        if (cached._date === todayStr()) {
          // 检查 CAPM 缓存时间戳，如果CAPM更新了则需重建
          try {
            const capmStat = await fs.stat(capmFile)
            const picksStat = await fs.stat(cachePath)
            if (capmStat.mtimeMs <= picksStat.mtimeMs) {
              console.log('[sector-picks] returning cached result')
              return cached
            }
          } catch {}
        }
      } catch { /* build fresh */ }
    }

    // 1. Load data
    await fs.mkdir(PERSIST_DIR, { recursive: true })

    const sectors = await readCapmCache(days)
    if (!sectors.length) {
      return { success: false, error: '行业CAPM缓存不存在，请先访问 /sector-rotation 页面' }
    }

    const screenerMap = await readScreenerCache()
    if (!screenerMap.size) {
      return { success: false, error: '股票筛选缓存不存在，请先访问股票一览页面' }
    }

    // 2. Identify target sectors by quadrant
    const targetSectors: SectorData[] = []
    for (const s of sectors) {
      if (quadrants.includes('Q1') && s.alphaAnnual > 0 && s.beta <= 1) targetSectors.push(s)
      else if (quadrants.includes('Q2') && s.alphaAnnual > 0 && s.beta > 1) targetSectors.push(s)
      else if (quadrants.includes('Q3') && s.alphaAnnual <= 0 && s.beta <= 1) targetSectors.push(s)
      else if (quadrants.includes('Q4') && s.alphaAnnual <= 0 && s.beta > 1) targetSectors.push(s)
    }
    // Sort: Q1 first (high alpha), then Q2
    targetSectors.sort((a, b) => b.alphaAnnual - a.alphaAnnual)

    console.log(`[sector-picks] target sectors (${quadrants.join(',')}): ${targetSectors.length}`)

    // 3. Get constituent stocks for each target sector
    const scoredStocks: StockScore[] = []
    const seen = new Set<string>()

    for (const sector of targetSectors.slice(0, 15)) {
      try {
        const members = await getIndexMember(sector.ts_code)
        // con_code comes as "000001.SZ" format; screener uses "000001" (6-digit)
        const codes = members.map((m: any) => m.con_code?.replace(/\.(SZ|SH|BJ)$/, '')).filter(Boolean)

        for (const code of codes) {
          if (seen.has(code)) continue
          seen.add(code)

          const st = screenerMap.get(code)
          if (!st) continue

          // Quick filters: skip stocks with no PE or negative price
          if (!st.close || st.close <= 0) continue
          if (!st.peTtm || st.peTtm <= 0) continue

          // 强制要求：必须入选过券商金股
          if (!st.goldenCount12m && !st.isGoldenRecent) continue

          scoredStocks.push(buildScore(st, sector))
        }
      } catch (e: any) {
        console.warn(`[sector-picks] failed to get members for ${sector.ts_code}:`, e.message)
      }
    }

    console.log(`[sector-picks] scored stocks: ${scoredStocks.length}`)

    // 4. Apply multi-factor scoring
    for (const ss of scoredStocks) {
      ss.totalScore = 
        ss.scoreMomentum * 0.25 +
        ss.scoreValuation * 0.25 +
        ss.scoreConsensus * 0.20 +
        ss.scoreGrowth * 0.15 +
        ss.scoreCrowding * 0.15
    }

    // 5. Sort and pick top N, with sector diversification (max 3 per sector)
    scoredStocks.sort((a, b) => b.totalScore - a.totalScore)

    const picks: StockScore[] = []
    const sectorCount = new Map<string, number>()
    for (const ss of scoredStocks) {
      const sc = sectorCount.get(ss.sectorName) || 0
      if (sc >= 3) continue  // max 3 per sector
      picks.push(ss)
      sectorCount.set(ss.sectorName, sc + 1)
      if (picks.length >= count) break
    }

    // 6. Simple equal-weight (if we had full daily data we'd do CAPM optimal weights)
    // For now: equal weight then score-based tilt
    const totalScore = picks.reduce((s, p) => s + p.totalScore, 0) || 1
    for (const p of picks) {
      (p as any).weight = Math.round(p.totalScore / totalScore * 10000) / 100
    }
    // Normalize to 100%
    const wSum = picks.reduce((s, p: any) => s + p.weight, 0)
    if (wSum > 0) {
      for (const p of picks) (p as any).weight = Math.round((p as any).weight / wSum * 10000) / 100
    }

    const result = {
      success: true,
      _date: todayStr(),
      quadrants,
      sectors: targetSectors.slice(0, 15).map(s => ({ name: s.name, code: s.ts_code, alphaAnnual: s.alphaAnnual, beta: s.beta })),
      picks: picks.map(p => ({
        ts_code: p.ts_code,
        name: p.name,
        sector: p.sectorName,
        weight: (p as any).weight,
        totalScore: Math.round(p.totalScore * 100) / 100,
        scoreMomentum: Math.round(p.scoreMomentum * 100) / 100,
        scoreValuation: Math.round(p.scoreValuation * 100) / 100,
        scoreConsensus: Math.round(p.scoreConsensus * 100) / 100,
        scoreGrowth: Math.round(p.scoreGrowth * 100) / 100,
        scoreCrowding: Math.round(p.scoreCrowding * 100) / 100,
        close: p.close,
        peTtm: p.peTtm,
        dcfUpside: p.dcfUpside,
        targetUpside: p.targetUpside,
        peg: p.peg,
        goldenCount12m: p.goldenCount12m,
        isGoldenRecent: p.isGoldenRecent,
        buyRating: p.buyRating,
        fy2Growth: p.fy2Growth,
        terminalPe: p.terminalPe,
        sectorAlpha: Math.round(p.sectorAlpha * 100) / 100,
        sectorBeta: p.sectorBeta,
      })),
    }

    // Save cache
    await fs.writeFile(cachePath, JSON.stringify(result, null, 2))

    return result
  } catch (e: any) {
    console.error('[sector-picks]', e)
    return { success: false, error: e.message }
  }
})

// ── 单股打分 ──
function buildScore(st: any, sector: SectorData): StockScore {
  // Factor 1: Industry momentum (25%) — alpha + alphaMomentum
  const alphaNorm = Math.max(0, sector.alphaAnnual)
  const momNorm = Math.max(0, sector.alphaMomentum || 0)
  const scoreMomentum = Math.min(1, (alphaNorm / 0.3) * 0.5 + Math.min(1, momNorm / 0.5) * 0.5)

  // Factor 2: Valuation upside (25%) — DCF + target price
  //   两者都有 → 60% DCF + 40% 目标价
  //   只有目标价 → 100% 目标价
  //   都缺失 → 0
  const dcfUp = st.dcfUpside || 0
  const tgtUp = st.targetUpside || 0
  let scoreValuation: number
  if (dcfUp > 0 && tgtUp > 0) {
    scoreValuation = Math.min(1, Math.max(0, dcfUp / 50) * 0.6 + Math.max(0, tgtUp / 50) * 0.4)
  } else if (tgtUp > 0) {
    scoreValuation = Math.min(1, Math.max(0, tgtUp / 50))  // 只靠目标价
  } else if (dcfUp > 0) {
    scoreValuation = Math.min(1, Math.max(0, dcfUp / 50))
  } else {
    scoreValuation = 0
  }

  // Factor 3: Analyst consensus (20%) — golden stocks + buy rating
  const goldScore = Math.min(1, (st.goldenCount12m || 0) / 6)
  const buyScore = Math.min(1, (st.buyRating || 0) / 20)
  const scoreConsensus = goldScore * 0.5 + buyScore * 0.3 + (st.isGoldenRecent ? 0.2 : 0)

  // Factor 4: Growth quality (15%) — FY2 growth + PEG
  //   两者都有 → 60% 增长率 + 40% PEG
  //   缺少PEG → 100% 增长率
  const growth = Math.max(-30, st.fy2Growth || 0)
  const growthComponent = Math.min(1, growth / 30)
  const peg = st.peg || 0
  let scoreGrowth: number
  if (peg > 0) {
    const pegComponent = Math.min(1, 1 / peg)
    scoreGrowth = growthComponent * 0.6 + pegComponent * 0.4
  } else {
    scoreGrowth = growthComponent  // 没有PEG就全靠增长率
  }

  // Factor 5: Crowding risk (15%) — 拥挤的行业自动降分
  //   不拥挤(<50)=满分, 偏热(50-70)=递减, 拥挤(70-80)=低分, 极度拥挤(>80)=0
  const crowd = sector.crowdingPct || 50
  const scoreCrowding = crowd < 50 ? 1.0 : crowd < 70 ? Math.max(0, 1 - (crowd - 50) / 40) : crowd < 80 ? Math.max(0.1, (80 - crowd) / 40) : 0

  return {
    ts_code: st.code + (st.code.startsWith('6') ? '.SH' : '.SZ'),
    name: st.name,
    sectorName: sector.name,
    sectorAlpha: sector.alphaAnnual,
    sectorBeta: sector.beta,
    close: st.close,
    peTtm: st.peTtm,
    totalMv: st.totalMv,
    dcfUpside: dcfUp,
    targetUpside: tgtUp,
    peg: st.peg,
    goldenCount12m: st.goldenCount12m || 0,
    isGoldenRecent: st.isGoldenRecent || false,
    buyRating: st.buyRating || 0,
    fy2Growth: st.fy2Growth || 0,
    terminalPe: st.terminalPe || 0,
    scoreMomentum,
    scoreValuation,
    scoreConsensus,
    scoreGrowth,
    scoreCrowding,
    totalScore: 0,
  }
}
