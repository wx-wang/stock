#!/usr/bin/env python3
"""
论坛舆情爬虫 — 抓取国内外财经媒体热门话题
输出 JSON 到 ../persist/forum-data.json

用法:
  python3 scripts/forum_crawler.py            # 写入 persist/forum-data.json
  python3 scripts/forum_crawler.py --stdout    # 输出到标准输出

数据来源:
  RSS (国外): CNBC, MarketWatch
  API  (国内): 东方财富热门板块 → 推断讨论热度

在服务器配置 cron:
  0 16 * * 1-5 cd /home/stock && python3 scripts/forum_crawler.py >> logs/forum_crawler.log 2>&1
"""

import json, re, sys, os, time
from datetime import datetime
from urllib.request import Request, urlopen
import ssl

# ========== 配置 ==========
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'persist', 'forum-data.json')
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
}

# A 股行业/概念关键词词典
TOPIC_KEYWORDS = {
    'AI算力': ['AI算力', '算力', 'GPU', '英伟达', 'NVIDIA', 'CPO', '光模块', '服务器', '液冷', '数据中心', 'HBM', 'Blackwell', 'Hopper'],
    '半导体': ['半导体', '芯片', '晶圆', '封测', '存储芯片', 'Chiplet', '先进封装', 'IGBT', '碳化硅', 'SiC', 'TSMC', '台积电', 'ASML'],
    '新能源': ['光伏', '储能', '锂电池', '锂矿', '钠电池', '固态电池', '钙钛矿', '风电', '逆变器', '宁德时代', '比亚迪', 'solar', 'battery', 'EV'],
    '智能驾驶': ['自动驾驶', '智能驾驶', '激光雷达', '车路云', '无人驾驶', 'Robotaxi', 'FSD', 'Waymo', 'Lidar'],
    '机器人': ['机器人', '人形机器人', '伺服电机', '减速器', 'Optimus', 'Figure'],
    '航天': ['航天', '卫星', '大飞机', '低空经济', 'SpaceX', 'Starlink', 'rocket'],
    '军工': ['军工', '导弹', '无人机', 'defense', 'drone', 'Lockheed', 'military'],
    '医药': ['创新药', 'CRO', 'CXO', '医疗器械', '减肥药', 'GLP-1', 'pharma', 'drug', 'FDA'],
    '金融科技': ['数字货币', '跨境支付', '券商', 'bitcoin', 'crypto', 'blockchain'],
    '量子计算': ['量子', 'quantum', 'qubit', 'ionq'],
    '核能': ['核能', '核电', 'nuclear', 'SMR', 'uranium'],
    '消费电子': ['消费电子', '苹果', '华为', '小米', 'VR', 'AR', '折叠屏', 'iPhone', 'Apple'],
}

SENTIMENT_POSITIVE = ['涨停', '暴涨', '利好', '超预期', '突破', '起飞', '翻倍', '牛市', '抄底', '加仓',
                       'bullish', 'rocket', 'moon', 'beat', 'upgrade', 'surge', 'rally', 'ATH']
SENTIMENT_NEGATIVE = ['跌停', '暴跌', '利空', '踩雷', '套牢', '割肉', '亏损', '暴雷', '退市', '熊市',
                       'bearish', 'crash', 'dump', 'downgrade', 'plunge', 'tumble', 'sell-off']

def ssl_context():
    return ssl.create_default_context()

def clean_text(text):
    """清理 HTML 标签和空白"""
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&[a-z]+;', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def classify_topic(text):
    """根据文本确定概念归属"""
    combined = text.lower()
    matches = []
    for category, keywords in TOPIC_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw.lower() in combined)
        if score > 0:
            matches.append((category, score))
    matches.sort(key=lambda x: -x[1])
    return [m[0] for m in matches[:3]]

def classify_sentiment(title, text=''):
    """中英文混合情绪分析"""
    combined = (title + ' ' + text).lower()
    pos = sum(1 for w in SENTIMENT_POSITIVE if w.lower() in combined)
    neg = sum(1 for w in SENTIMENT_NEGATIVE if w.lower() in combined)
    if pos > neg + 2: return 'positive'
    if neg > pos + 2: return 'negative'
    if pos > neg: return 'slightly_positive'
    if neg > pos: return 'slightly_negative'
    return 'neutral'

# ========== CNBC RSS ==========
def fetch_cnbc():
    """CNBC RSS — 美股最活跃的财经新闻源"""
    topics = []
    try:
        req = Request('https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',
                      headers={'User-Agent': 'Mozilla/5.0'})
        resp = urlopen(req, timeout=15, context=ssl_context())
        xml = resp.read().decode('utf-8', errors='ignore')
        titles = re.findall(r'<title>([^<]+)</title>', xml)
        for t in titles[1:21]:
            t = clean_text(t)
            if len(t) > 10:
                concepts = classify_topic(t)
                topics.append({
                    'title': t, 'source': 'cnbc',
                    'concepts': concepts if concepts else ['宏观/综合'],
                    'sentiment': classify_sentiment(t),
                })
    except Exception as e:
        print(f'[CNBC] 失败: {type(e).__name__}: {e}')
    print(f'[CNBC] {len(topics)} 条')
    return topics

# ========== MarketWatch RSS ==========
def fetch_marketwatch():
    """MarketWatch RSS"""
    topics = []
    try:
        req = Request('https://feeds.marketwatch.com/marketwatch/topstories',
                      headers={'User-Agent': 'Mozilla/5.0'})
        resp = urlopen(req, timeout=15, context=ssl_context())
        xml = resp.read().decode('utf-8', errors='ignore')
        titles = re.findall(r'<title>([^<]+)</title>', xml)
        for t in titles[1:13]:
            t = clean_text(t)
            if len(t) > 10:
                concepts = classify_topic(t)
                topics.append({
                    'title': t, 'source': 'marketwatch',
                    'concepts': concepts if concepts else ['宏观/综合'],
                    'sentiment': classify_sentiment(t),
                })
    except Exception as e:
        print(f'[MarketWatch] 失败: {type(e).__name__}: {e}')
    print(f'[MarketWatch] {len(topics)} 条')
    return topics

# ========== 东方财富热门板块 ==========
def fetch_eastmoney_sectors():
    """获取东方财富当日涨幅/成交额最大的板块，用于推断 A 股讨论热点"""
    topics = []
    try:
        # 行业板块涨幅排行
        url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=15&po=1&np=1&fields=f12,f14,f3,f2,f4,f20&fid=f3&fs=m:90+t:2'
        req = Request(url, headers={**HEADERS, 'Referer': 'https://quote.eastmoney.com/'})
        resp = urlopen(req, timeout=15, context=ssl_context())
        data = json.loads(resp.read())
        items = data.get('data', {}).get('diff', [])
        for it in items:
            name = it.get('f14', '')
            pct = it.get('f3', 0) or 0
            volume = it.get('f20', 0) or 0
            if name:
                concepts = classify_topic(name)
                topics.append({
                    'title': f'{name} 板块涨 {pct:+.2f}% 成交额 {volume/1e8:.0f}亿',
                    'source': 'eastmoney_sector',
                    'concepts': concepts if concepts else ['板块热点'],
                    'sentiment': 'positive' if pct > 2 else ('slightly_positive' if pct > 0 else 'slightly_negative'),
                })
    except Exception as e:
        print(f'[东财板块] 失败: {type(e).__name__}: {e}')
    print(f'[东财板块] {len(topics)} 条')
    return topics

# ========== 东财热门概念板块 ==========
def fetch_eastmoney_concepts():
    """概念板块涨幅排行"""
    topics = []
    try:
        url = 'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=15&po=1&np=1&fields=f12,f14,f3,f2&fid=f3&fs=m:90+t:3'
        req = Request(url, headers={**HEADERS, 'Referer': 'https://quote.eastmoney.com/'})
        resp = urlopen(req, timeout=15, context=ssl_context())
        data = json.loads(resp.read())
        items = data.get('data', {}).get('diff', [])
        for it in items:
            name = it.get('f14', '')
            pct = it.get('f3', 0) or 0
            if name and abs(pct) > 0.5:
                concepts = classify_topic(name)
                topics.append({
                    'title': f'{name} 概念 {pct:+.2f}%',
                    'source': 'eastmoney_concept',
                    'concepts': concepts if concepts else classify_topic(name),
                    'sentiment': 'positive' if pct > 2 else ('slightly_positive' if pct > 0 else 'slightly_negative'),
                })
    except Exception as e:
        print(f'[东财概念] 失败: {type(e).__name__}: {e}')
    print(f'[东财概念] {len(topics)} 条')
    return topics

# ========== 汇总 & 分析 ==========
def aggregate_results(all_topics):
    """汇总各来源结果"""
    today = datetime.now().strftime('%Y-%m-%d')

    # 去重
    deduped = []
    seen_words = set()
    for t in sorted(all_topics, key=lambda x: len(x.get('concepts', [])), reverse=True):
        key = clean_text(t['title'])[:30]
        if key not in seen_words:
            seen_words.add(key)
            deduped.append(t)

    # 统计概念频率
    concept_heat = {}
    for t in deduped:
        for c in t.get('concepts', []):
            concept_heat[c] = concept_heat.get(c, 0) + 1

    # 情绪统计
    sentiments = {'positive': 0, 'negative': 0, 'neutral': 0}
    for t in deduped:
        s = t.get('sentiment', 'neutral')
        if 'positive' in s: sentiments['positive'] += 1
        elif 'negative' in s: sentiments['negative'] += 1
        else: sentiments['neutral'] += 1

    # 热词（仅中文）
    all_cn = ' '.join(t['title'] for t in deduped if any('\u4e00' <= c <= '\u9fff' for c in t['title']))
    word_freq = {}
    stop = {'一个','什么','怎么','这个','我们','大家','可以','没有','不是','现在','已经','还是',
            '因为','所以','如果','但是','而且','然后','可能','应该','需要','非常','比较',
            '自己','他们','进行','使用','通过','相关','主要','目前','其中','其他',
            '不过','只是','就是','还有','来说','对于','以及','一定','板块','概念','涨幅','成交额'}
    for w in re.findall(r'[\u4e00-\u9fff]{2,6}', all_cn):
        if w not in stop:
            word_freq[w] = word_freq.get(w, 0) + 1
    hot_words = sorted(word_freq.items(), key=lambda x: -x[1])[:20]

    sources = list(set(t['source'] for t in deduped))
    domestic = len([t for t in deduped if t['source'] in ('eastmoney_sector', 'eastmoney_concept')])
    intl = len([t for t in deduped if t['source'] in ('cnbc', 'marketwatch')])

    dominant = '偏乐观' if sentiments['positive'] > sentiments['negative'] else \
               ('偏悲观' if sentiments['negative'] > sentiments['positive'] else '中性')

    result = {
        'date': today,
        'generated_at': datetime.now().isoformat(),
        'summary': {
            'total_topics': len(deduped),
            'forums_crawled': sources,
            'domestic_forums': domestic,
            'international_forums': intl,
            'dominant_sentiment': dominant,
            'sentiment_breakdown': sentiments,
        },
        'hot_keywords': [{'word': w, 'count': c} for w, c in hot_words],
        'top_topics': deduped[:30],
        'concept_heat': [{'concept': c, 'count': n} for c, n in sorted(concept_heat.items(), key=lambda x: -x[1])],
        'hot_stocks': [],
    }
    return result

# ========== 主入口 ==========
def main(save=True):
    print(f'[论坛雷达] 开始 — {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    start = time.time()

    print('[论坛雷达] CNBC RSS...')
    cnbc = fetch_cnbc()

    print('[论坛雷达] MarketWatch RSS...')
    mw = fetch_marketwatch()

    print('[论坛雷达] 东财行业板块...')
    em_sectors = fetch_eastmoney_sectors()

    print('[论坛雷达] 东财概念板块...')
    em_concepts = fetch_eastmoney_concepts()

    all_topics = cnbc + mw + em_sectors + em_concepts
    result = aggregate_results(all_topics)

    elapsed = time.time() - start
    print(f'[论坛雷达] 完成 — {len(all_topics)} 条原始, {len(result["top_topics"])} 条去重, {elapsed:.1f}s')

    if save:
        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f'[论坛雷达] 已保存 → {OUTPUT_FILE}')

    return result

if __name__ == '__main__':
    save = '--no-save' not in sys.argv
    to_stdout = '--stdout' in sys.argv
    result = main(save=save)
    if to_stdout:
        print(json.dumps(result, ensure_ascii=False, indent=2))
