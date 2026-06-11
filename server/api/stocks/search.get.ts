/**
 * GET /api/stocks/search?q=平安
 * 搜索股票（代码/名称/行业模糊匹配）
 */
import { getStockBasic } from '@/server/lib/tushare'

// 缓存全量股票列表
let stockListCache: any[] | null = null
let cacheTime = 0
const CACHE_TTL = 24 * 60 * 60 * 1000 // 1天

export default defineEventHandler(async (event) => {
  const q = (getQuery(event).q as string || '').trim().toUpperCase()

  try {
    // 加载缓存（全量股票列表）
    if (!stockListCache || Date.now() - cacheTime > CACHE_TTL) {
      const results = await getStockBasic()
      stockListCache = results
      cacheTime = Date.now()
    }

    // ★ 空查询 = 返回全量列表（前端一次拉取后用本地搜索）
    if (!q || q.length < 2) {
      return {
        success: true,
        data: stockListCache.map((s: any) => ({
          ts_code: s.ts_code,
          name: s.name,
          industry: s.industry || '',
          area: s.area || '',
          market: s.market || '',
        })),
      }
    }

    // 模糊搜索：代码/名称/拼音/行业
    const filtered = stockListCache.filter((s: any) => {
      const code = (s.ts_code || '').toUpperCase()
      const name = (s.name || '').toUpperCase()
      const industry = (s.industry || '').toUpperCase()
      return code.includes(q) || name.includes(q) || industry.includes(q)
    }).slice(0, 20)

    return {
      success: true,
      data: filtered.map((s: any) => ({
        ts_code: s.ts_code,
        name: s.name,
        industry: s.industry || '',
        area: s.area || '',
        market: s.market || '',
      })),
    }
  } catch (e: any) {
    // 兜底：本地股票列表
    const local = LOCAL_STOCKS.filter(s =>
      s.ts_code.includes(q) || s.name.toUpperCase().includes(q) || s.industry.toUpperCase().includes(q)
    ).slice(0, 20)
    return { success: true, data: local }
  }
})

// 兜底本地列表
const LOCAL_STOCKS = [
  { ts_code: '000001.SZ', name: '平安银行', industry: '银行' },
  { ts_code: '000002.SZ', name: '万科A', industry: '房地产' },
  { ts_code: '000063.SZ', name: '中兴通讯', industry: '通信' },
  { ts_code: '000333.SZ', name: '美的集团', industry: '家用电器' },
  { ts_code: '000568.SZ', name: '泸州老窖', industry: '食品饮料' },
  { ts_code: '000651.SZ', name: '格力电器', industry: '家用电器' },
  { ts_code: '000725.SZ', name: '京东方A', industry: '电子' },
  { ts_code: '000858.SZ', name: '五粮液', industry: '食品饮料' },
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
