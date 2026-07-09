#!/usr/bin/env python3
"""
论坛舆情爬虫 — 抓取东方财富/雪球/淘股吧热门话题
输出 JSON 到 ../persist/forum-data.json

用法:
  python3 scripts/forum_crawler.py                    # 输出到 persist/forum-data.json
  python3 scripts/forum_crawler.py --stdout            # 输出到标准输出
  python3 scripts/forum_crawler.py --no-save --stdout  # 不写文件，只看结果

在服务器上配置 cron:
  0 16 * * 1-5 cd /home/stock && python3 scripts/forum_crawler.py  # 每个交易日收盘后
"""

import json, re, sys, os, time
from datetime import datetime
from urllib.request import Request, urlopen, build_opener, HTTPCookieProcessor
from urllib.parse import quote
from http.cookiejar import CookieJar
import ssl

# ========== 配置 ==========
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'persist', 'forum-data.json')
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

# A 股行业/概念关键词词典（用于给帖子打标签）
TOPIC_KEYWORDS = {
    '光刻机': ['光刻机', '光刻胶', 'DUV', 'EUV', 'ASML', '国产光刻'],
    '半导体': ['半导体', '芯片', '晶圆', '封测', '存储芯片', 'HBM', 'Chiplet', '先进封装', 'IGBT', '碳化硅', 'SiC', '模拟芯片'],
    'AI算力': ['AI算力', '算力', 'GPU', '英伟达', 'NVIDIA', 'CPO', '光模块', '服务器', '液冷', '数据中心', 'H100', 'B200', 'GB300'],
    '消费电子': ['消费电子', '手机', '苹果', '华为', '小米', 'VR', 'AR', 'MR', '果链', '折叠屏'],
    '新能源': ['光伏', '储能', '锂电池', '锂矿', '钠电池', '固态电池', '钙钛矿', '风电', '逆变器', '宁德时代', '比亚迪'],
    '智能驾驶': ['自动驾驶', '智能驾驶', '激光雷达', '车路云', '智能座舱', '无人驾驶', 'Robotaxi', 'FSD'],
    '机器人': ['机器人', '人形机器人', '伺服电机', '减速器', '特斯拉bot', 'Figure'],
    '医药': ['创新药', 'CRO', 'CXO', '医疗器械', '减肥药', 'GLP-1', '基因编辑', '中药'],
    '军工航天': ['军工', '航天', '卫星', '大飞机', '低空经济', '无人机', '导弹'],
    '金融': ['券商', '银行', '保险', '非银', '数字货币', '跨境支付'],
    '电力': ['电力', '电网', '特高压', '虚拟电厂', '绿电', '火电', '核电'],
    '周期': ['煤炭', '钢铁', '有色', '化工', '石油', '黄金', '稀土', '铜', '铝'],
}

# 情绪词词典
SENTIMENT_POSITIVE = ['涨停', '暴涨', '涨停板', '利好', '超预期', '突破', '起飞', '翻倍', '牛市', '抄底成功', '大赚', '加仓', '全仓']
SENTIMENT_NEGATIVE = ['跌停', '暴跌', '崩盘', '利空', '踩雷', '套牢', '割肉', '亏损', '暴雷', '退市', '熊市', '清仓', '止损', '跑路']

# ========== 工具函数 ==========

def ssl_context():
    return ssl.create_default_context()

def classify_topic(title, text=''):
    """根据标题和文本确定话题归属"""
    combined = (title + ' ' + text).lower()
    matches = []
    for category, keywords in TOPIC_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw.lower() in combined)
        if score > 0:
            matches.append((category, score))
    matches.sort(key=lambda x: -x[1])
    return [m[0] for m in matches[:3]]  # Top 3

def classify_sentiment(title, text=''):
    """情绪分析"""
    combined = title + ' ' + text
    pos = sum(1 for w in SENTIMENT_POSITIVE if w in combined)
    neg = sum(1 for w in SENTIMENT_NEGATIVE if w in combined)
    if pos > neg + 2: return 'positive'
    if neg > pos + 2: return 'negative'
    if pos > neg: return 'slightly_positive'
    if neg > pos: return 'slightly_negative'
    return 'neutral'

def clean_text(text):
    """清理 HTML 标签和空白"""
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text

# ========== 东方财富股吧 ==========

def fetch_eastmoney():
    """爬东方财富股吧首页热门"""
    topics = []
    try:
        req = Request('https://guba.eastmoney.com/', headers=HEADERS)
        resp = urlopen(req, timeout=15, context=ssl_context())
        html = resp.read().decode('gbk', errors='ignore')

        # 方法1: 找热门标题 (通过对 class 为 note-title 的元素)
        titles = re.findall(r'<a[^>]*title="([^"]+)"[^>]*>', html)
        # 方法2: 提取 note-body 里的内容
        bodies = re.findall(r'class="note-body[^"]*"[^>]*>([^<]+)', html)

        # 合并去重
        seen = set()
        for t in titles[:30]:
            t = t.strip()
            if len(t) > 5 and t not in seen and not t.startswith('http'):
                seen.add(t)
                topics.append({
                    'title': t,
                    'source': 'eastmoney',
                    'concepts': classify_topic(t),
                    'sentiment': classify_sentiment(t),
                })
    except Exception as e:
        print(f'[东财] 爬取失败: {e}')

    print(f'[东财] 提取到 {len(topics)} 条话题')
    return topics


def fetch_eastmoney_hot_stocks():
    """爬东方财富热门个股（通过热门贴吧列表推断）"""
    stocks = []
    try:
        # 访问个股吧排行页
        req = Request('https://guba.eastmoney.com/rank/', headers=HEADERS)
        resp = urlopen(req, timeout=15, context=ssl_context())
        html = resp.read().decode('gbk', errors='ignore')

        # 找股票代码和名称
        items = re.findall(r'(\d{6})[^<]*?<[^>]*>([^<]+)</a>', html)
        for code, name in items[:20]:
            name = clean_text(name)
            if name and len(name) < 20:
                stocks.append({'code': code, 'name': name})
    except Exception as e:
        print(f'[东财个股] 爬取失败: {e}')

    print(f'[东财个股] 提取到 {len(stocks)} 只热股')
    return stocks


# ========== 雪球 ==========

def fetch_xueqiu():
    """爬雪球热门话题 + 热帖"""
    topics = []
    try:
        cj = CookieJar()
        opener = build_opener(HTTPCookieProcessor(cj))

        # Step 1: 获取 cookie
        opener.open(Request('https://xueqiu.com/', headers=HEADERS), timeout=15)

        # Step 2: 热门话题
        req = Request('https://xueqiu.com/statuses/topic/hot.json?count=15', headers={
            **HEADERS,
            'Referer': 'https://xueqiu.com/',
            'X-Requested-With': 'XMLHttpRequest',
        })
        resp = opener.open(req, timeout=15)
        data = json.loads(resp.read())
        for item in data.get('list', [])[:15]:
            title = item.get('title', '') or ''
            desc = item.get('description', '') or item.get('summary', '') or ''
            if title:
                topics.append({
                    'title': title,
                    'desc': desc[:120],
                    'source': 'xueqiu',
                    'concepts': classify_topic(title, desc),
                    'sentiment': classify_sentiment(title, desc),
                })

        # Step 3: 热门讨论
        req2 = Request('https://xueqiu.com/statuses/hot/listV2.json?type=day&count=10', headers={
            **HEADERS,
            'Referer': 'https://xueqiu.com/',
            'X-Requested-With': 'XMLHttpRequest',
        })
        resp2 = opener.open(req2, timeout=15)
        data2 = json.loads(resp2.read())
        for item in data2.get('list', [])[:10]:
            title = item.get('title', '') or item.get('text', '') or ''
            desc = item.get('description', '') or item.get('text', '') or ''
            if title and len(title) > 5:
                topics.append({
                    'title': clean_text(title)[:100],
                    'desc': clean_text(desc)[:120],
                    'source': 'xueqiu_discussion',
                    'concepts': classify_topic(title, desc),
                    'sentiment': classify_sentiment(title, desc),
                })
    except Exception as e:
        print(f'[雪球] 爬取失败: {type(e).__name__}: {e}')

    print(f'[雪球] 提取到 {len(topics)} 条')
    return topics


# ========== 淘股吧 ==========

def fetch_taoguba():
    """爬淘股吧首页热门帖子"""
    topics = []
    try:
        req = Request('https://www.tgb.cn/', headers=HEADERS)
        resp = urlopen(req, timeout=15, context=ssl_context())
        html = resp.read().decode('utf-8', errors='ignore')

        # 找帖子标题
        # 淘股吧帖子标题通常在 <a> 标签或特定 class 中
        titles = re.findall(r'<a[^>]*title="([^"]{4,})"[^>]*>', html)
        for t in titles[:20]:
            t = clean_text(t)
            if t and len(t) > 4 and not t.startswith('http') and not t.startswith('javascript'):
                topics.append({
                    'title': t,
                    'source': 'taoguba',
                    'concepts': classify_topic(t),
                    'sentiment': classify_sentiment(t),
                })
    except Exception as e:
        print(f'[淘股吧] 爬取失败: {type(e).__name__}: {e}')

    print(f'[淘股吧] 提取到 {len(topics)} 条')
    return topics


# ========== 汇总 & 分析 ==========

def aggregate_results(all_topics, hot_stocks):
    """汇总各论坛结果，生成汇总分析"""
    today = datetime.now().strftime('%Y-%m-%d')

    # 去重（相似标题合并）
    deduped = []
    seen_words = set()
    for t in sorted(all_topics, key=lambda x: len(x.get('concepts', [])), reverse=True):
        key = t['title'][:20]
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

    # 热词排行
    all_words = ' '.join(t['title'] for t in deduped)
    word_freq = {}
    for w in re.findall(r'[\u4e00-\u9fff]{2,4}', all_words):
        if w not in ['一个', '什么', '怎么', '这个', '我们', '大家', '可以', '没有', '不是', '现在', '已经', '还是']:
            word_freq[w] = word_freq.get(w, 0) + 1
    hot_words = sorted(word_freq.items(), key=lambda x: -x[1])[:20]

    # 构建输出
    result = {
        'date': today,
        'generated_at': datetime.now().isoformat(),
        'summary': {
            'total_topics': len(deduped),
            'forums_crawled': list(set(t['source'] for t in deduped)),
            'dominant_sentiment': '偏乐观' if sentiments['positive'] > sentiments['negative'] else ('偏悲观' if sentiments['negative'] > sentiments['positive'] else '中性'),
            'sentiment_breakdown': sentiments,
        },
        'hot_keywords': [{'word': w, 'count': c} for w, c in hot_words],
        'top_topics': deduped[:20],
        'concept_heat': [{'concept': c, 'count': n} for c, n in sorted(concept_heat.items(), key=lambda x: -x[1])],
        'hot_stocks': hot_stocks,
    }
    return result


# ========== 主入口 ==========

def main(save=True):
    print(f'[论坛雷达] 开始抓取 — {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    start = time.time()

    # 并行抓取
    print('[论坛雷达] 抓取东方财富...')
    em_topics = fetch_eastmoney()
    em_stocks = fetch_eastmoney_hot_stocks()

    print('[论坛雷达] 抓取雪球...')
    xq_topics = fetch_xueqiu()

    print('[论坛雷达] 抓取淘股吧...')
    tg_topics = fetch_taoguba()

    # 汇总
    all_topics = em_topics + xq_topics + tg_topics
    result = aggregate_results(all_topics, em_stocks)

    elapsed = time.time() - start
    print(f'[论坛雷达] 完成 — {len(all_topics)} 条原始帖, {len(result["top_topics"])} 条去重, 耗时 {elapsed:.1f}s')

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
