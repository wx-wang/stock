#!/usr/bin/env python3
"""
论坛舆情雷达采集器

目标：
  1. 优先采集可稳定访问的数据源，失败源记录在 source_status 中。
  2. 统一输出热门股票、热门主题、来源状态和情绪统计。
  3. 写入 persist/forum-radar/latest.json，并同步写旧版 persist/forum-data.json 兼容前端。

推荐 cron：
  15 9,12,15,20 * * 1-5 cd /home/stock && python3 scripts/forum_crawler.py >> logs/forum_crawler.log 2>&1
"""

import json
import os
import re
import ssl
import sys
import time
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RADAR_DIR = os.path.join(ROOT_DIR, 'persist', 'forum-radar')
LATEST_FILE = os.path.join(RADAR_DIR, 'latest.json')
LEGACY_FILE = os.path.join(ROOT_DIR, 'persist', 'forum-data.json')

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; StockDashboardForumRadar/1.0; +https://wx-wang.top)',
    'Accept': 'application/json,text/plain,text/html,*/*',
}

SOURCE_LABELS = {
    'eastmoney_flow': '东方财富资金流',
    'eastmoney_sector': '东方财富行业',
    'eastmoney_concept': '东方财富概念',
    'tushare_dc_hot': '东方财富热榜(Tushare)',
    'stocktwits': 'Stocktwits',
    'reddit_wsb': 'Reddit WSB',
    'reddit_stocks': 'Reddit Stocks',
    'cnbc': 'CNBC',
    'marketwatch': 'MarketWatch',
}

SOURCE_WEIGHTS = {
    'eastmoney_flow': 1.4,
    'eastmoney_sector': 1.0,
    'eastmoney_concept': 1.0,
    'tushare_dc_hot': 1.6,
    'stocktwits': 1.5,
    'reddit_wsb': 1.3,
    'reddit_stocks': 1.1,
    'cnbc': 0.8,
    'marketwatch': 0.8,
}

TOPIC_KEYWORDS = {
    'AI算力': ['AI算力', '算力', 'GPU', '英伟达', 'NVIDIA', 'CPO', '光模块', '服务器', '液冷', '数据中心', 'HBM', 'Blackwell', 'Hopper', 'AI'],
    '半导体': ['半导体', '芯片', '晶圆', '封测', '存储芯片', 'Chiplet', '先进封装', 'IGBT', '碳化硅', 'SiC', 'TSMC', '台积电', 'ASML'],
    '新能源': ['光伏', '储能', '锂电池', '锂矿', '钠电池', '固态电池', '钙钛矿', '风电', '逆变器', '宁德时代', '比亚迪', 'EV', 'battery'],
    '智能驾驶': ['自动驾驶', '智能驾驶', '激光雷达', '车路云', '无人驾驶', 'Robotaxi', 'FSD', 'Waymo', 'Lidar'],
    '机器人': ['机器人', '人形机器人', '伺服电机', '减速器', 'Optimus', 'Figure'],
    '航天军工': ['航天', '卫星', '大飞机', '低空经济', '军工', '无人机', 'SpaceX', 'Starlink', 'defense', 'drone'],
    '医药': ['创新药', 'CRO', 'CXO', 'CDMO', '医疗器械', '减肥药', 'GLP-1', 'pharma', 'drug', 'FDA'],
    '金融科技': ['数字货币', '跨境支付', '券商', 'bitcoin', 'crypto', 'blockchain', 'stablecoin'],
    '量子计算': ['量子', 'quantum', 'qubit', 'ionq'],
    '核能': ['核能', '核电', 'nuclear', 'SMR', 'uranium'],
    '消费电子': ['消费电子', '苹果', '华为', '小米', 'VR', 'AR', '折叠屏', 'iPhone', 'Apple'],
}

US_TICKER_STOP = {
    'A', 'I', 'AI', 'CEO', 'CFO', 'USA', 'US', 'ETF', 'IPO', 'GDP', 'FDA', 'SEC',
    'THE', 'AND', 'FOR', 'WITH', 'THIS', 'THAT', 'WILL', 'FROM', 'ARE', 'HAS',
    'U', 'S', 'X', 'SK', 'GOP', 'UAW', 'IRA', 'IRS', 'EU', 'UK',
}
KNOWN_US_TICKERS = {
    'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'AMD',
    'INTC', 'QCOM', 'ARM', 'TSM', 'ASML', 'MU', 'SMCI', 'PLTR', 'ORCL', 'NFLX',
    'COIN', 'MSTR', 'HOOD', 'RBLX', 'UBER', 'LYFT', 'BABA', 'NIO', 'XPEV', 'LI',
    'RIVN', 'IONQ', 'QBTS', 'RGTI', 'SOUN', 'CRWD', 'PANW', 'SNOW', 'SHOP',
    'JPM', 'BAC', 'C', 'GS', 'MS', 'WFC', 'V', 'MA', 'PYPL', 'DIS', 'BA',
    'LLY', 'NVO', 'PFE', 'MRNA', 'UNH', 'XOM', 'CVX', 'OXY', 'GLD', 'SLV',
}

SENTIMENT_POSITIVE = [
    '涨停', '暴涨', '利好', '超预期', '突破', '起飞', '翻倍', '牛市', '抄底', '加仓',
    'bullish', 'rocket', 'moon', 'beat', 'upgrade', 'surge', 'rally', 'ath', 'breakout',
]
SENTIMENT_NEGATIVE = [
    '跌停', '暴跌', '利空', '踩雷', '套牢', '割肉', '亏损', '暴雷', '退市', '熊市',
    'bearish', 'crash', 'dump', 'downgrade', 'plunge', 'tumble', 'sell-off', 'short',
]


def ssl_context():
    return ssl.create_default_context()


def now_iso():
    return datetime.now().isoformat(timespec='seconds')


def clean_text(text):
    text = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', str(text), flags=re.S)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'&#x([0-9a-fA-F]+);', lambda m: chr(int(m.group(1), 16)), text)
    text = re.sub(r'&#(\d+);', lambda m: chr(int(m.group(1))), text)
    text = re.sub(r'&[a-zA-Z]+;', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


def normalize_pct(value):
    try:
        n = float(value)
    except Exception:
        return None
    if abs(n) > 100:
        n = n / 100
    return round(n, 2)


def normalize_price(value):
    try:
        n = float(value)
    except Exception:
        return None
    if abs(n) > 1000:
        n = n / 100
    return round(n, 2)


def classify_topic(text):
    combined = clean_text(text).lower()
    matches = []
    for category, keywords in TOPIC_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw.lower() in combined)
        if score > 0:
            matches.append((category, score))
    matches.sort(key=lambda x: -x[1])
    return [m[0] for m in matches[:3]]


def classify_sentiment(title, text=''):
    combined = (title + ' ' + text).lower()
    pos = sum(1 for w in SENTIMENT_POSITIVE if w.lower() in combined)
    neg = sum(1 for w in SENTIMENT_NEGATIVE if w.lower() in combined)
    if pos > neg + 1:
        return 'positive'
    if neg > pos + 1:
        return 'negative'
    if pos > neg:
        return 'slightly_positive'
    if neg > pos:
        return 'slightly_negative'
    return 'neutral'


def sentiment_score(sentiment):
    return {
        'positive': 2,
        'slightly_positive': 1,
        'neutral': 0,
        'slightly_negative': -1,
        'negative': -2,
    }.get(sentiment, 0)


def request_text(url, headers=None, timeout=15, retries=1):
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = Request(url, headers={**HEADERS, 'Connection': 'close', **(headers or {})})
            with urlopen(req, timeout=timeout, context=ssl_context()) as resp:
                return resp.read().decode('utf-8', errors='ignore')
        except Exception as err:
            last_err = err
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
    raise last_err


def request_json(url, headers=None, timeout=15, retries=1):
    return json.loads(request_text(url, headers=headers, timeout=timeout, retries=retries))


def source_ok(status, source, count):
    status[source] = {'ok': True, 'count': count, 'message': 'ok', 'label': SOURCE_LABELS.get(source, source)}


def source_fail(status, source, err):
    status[source] = {
        'ok': False,
        'count': 0,
        'message': f'{type(err).__name__}: {err}',
        'label': SOURCE_LABELS.get(source, source),
    }


def topic(title, source, concepts=None, sentiment=None, stocks=None, heat=1, url=''):
    title = clean_text(title)
    concepts = concepts if concepts is not None else classify_topic(title)
    return {
        'title': title,
        'source': source,
        'source_label': SOURCE_LABELS.get(source, source),
        'concepts': concepts if concepts else ['综合'],
        'sentiment': sentiment or classify_sentiment(title),
        'stocks': stocks or [],
        'heat': round(float(heat), 2),
        'url': url,
    }


def stock(symbol, name='', market='A', **extra):
    return {
        'symbol': str(symbol).strip(),
        'name': clean_text(name or symbol),
        'market': market,
        **extra,
    }


def extract_us_tickers(text):
    tickers = []
    explicit = re.findall(r'\$([A-Z]{1,5})\b', text)
    candidates = explicit + re.findall(r'\b[A-Z]{2,5}\b', text)
    for t in candidates:
        if t not in US_TICKER_STOP and (t in KNOWN_US_TICKERS or t in explicit):
            tickers.append(t)
    return list(dict.fromkeys(tickers))[:6]


def fetch_rss(source, url, limit=18):
    raw = request_text(url, headers={'Accept': 'application/rss+xml,text/xml,*/*'})
    items = re.findall(r'<item\b[\s\S]*?</item>', raw, flags=re.I)
    topics = []
    for item in items[:limit]:
        title_match = re.search(r'<title>([\s\S]*?)</title>', item, flags=re.I)
        link_match = re.search(r'<link>([\s\S]*?)</link>', item, flags=re.I)
        pub_match = re.search(r'<pubDate>([\s\S]*?)</pubDate>', item, flags=re.I)
        if not title_match:
            continue
        title_text = clean_text(title_match.group(1))
        link = clean_text(link_match.group(1)) if link_match else ''
        pub_date = ''
        if pub_match:
            try:
                pub_date = parsedate_to_datetime(clean_text(pub_match.group(1))).isoformat()
            except Exception:
                pub_date = clean_text(pub_match.group(1))
        stocks = [stock(t, t, 'US') for t in extract_us_tickers(title_text)]
        t = topic(title_text, source, stocks=stocks, url=link)
        t['published_at'] = pub_date
        topics.append(t)
    return topics


def fetch_cnbc(status):
    source = 'cnbc'
    try:
        rows = fetch_rss(source, 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', 20)
        source_ok(status, source, len(rows))
        return rows
    except Exception as e:
        source_fail(status, source, e)
        return []


def fetch_marketwatch(status):
    source = 'marketwatch'
    try:
        rows = fetch_rss(source, 'https://feeds.marketwatch.com/marketwatch/topstories', 16)
        source_ok(status, source, len(rows))
        return rows
    except Exception as e:
        source_fail(status, source, e)
        return []


def fetch_eastmoney_board(board_type, status):
    source = 'eastmoney_sector' if board_type == 'industry' else 'eastmoney_concept'
    fs = 'm:90+t:2' if board_type == 'industry' else 'm:90+t:3'
    try:
        params = {
            'pn': 1,
            'pz': 20,
            'po': 1,
            'np': 1,
            'fid': 'f3',
            'fs': fs,
            'fields': 'f12,f14,f3,f2,f20',
        }
        url = 'https://push2.eastmoney.com/api/qt/clist/get?' + urlencode(params)
        data = request_json(url, headers={'Referer': 'https://quote.eastmoney.com/'})
        items = data.get('data', {}).get('diff', []) or []
        rows = []
        for it in items:
            name = it.get('f14') or ''
            pct = normalize_pct(it.get('f3'))
            if not name:
                continue
            title_text = f'{name} {"行业" if board_type == "industry" else "概念"} {pct:+.2f}%' if pct is not None else f'{name} 板块活跃'
            rows.append(topic(
                title_text,
                source,
                concepts=classify_topic(name) or ['板块热点'],
                sentiment='positive' if pct is not None and pct >= 2 else ('slightly_positive' if pct is not None and pct > 0 else 'neutral'),
                heat=max(1, abs(pct or 0)),
            ))
        source_ok(status, source, len(rows))
        return rows
    except Exception as e:
        source_fail(status, source, e)
        return []


def fetch_eastmoney_hot_stocks(status):
    source = 'eastmoney_flow'
    try:
        params = {
            'pn': 1,
            'pz': 40,
            'po': 1,
            'np': 1,
            'fid': 'f62',
            'fs': 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
            'fields': 'f12,f14,f3,f2,f4,f20,f62',
        }
        url = 'https://push2.eastmoney.com/api/qt/clist/get?' + urlencode(params)
        data = request_json(url, headers={'Referer': 'https://quote.eastmoney.com/'})
        items = data.get('data', {}).get('diff', []) or []
        rows = []
        for rank, it in enumerate(items, start=1):
            code = str(it.get('f12') or '')
            name = it.get('f14') or code
            pct = normalize_pct(it.get('f3'))
            price = normalize_price(it.get('f2'))
            net_inflow = float(it.get('f62') or 0)
            heat = max(1, 42 - rank) + min(20, max(0, net_inflow) / 1e8)
            s = stock(
                code,
                name,
                'A',
                pct_chg=pct,
                price=price,
                net_inflow=round(net_inflow / 1e8, 2),
                rank=rank,
            )
            rows.append(topic(
                f'{name}({code}) 主力净流入 {net_inflow/1e8:.2f} 亿，涨跌幅 {pct:+.2f}%' if pct is not None else f'{name}({code}) 资金流活跃',
                source,
                concepts=classify_topic(name) or ['个股热度'],
                sentiment='positive' if pct is not None and pct >= 2 else ('slightly_positive' if pct is not None and pct > 0 else ('negative' if pct is not None and pct <= -3 else 'neutral')),
                stocks=[s],
                heat=heat,
            ))
        source_ok(status, source, len(rows))
        return rows
    except Exception as e:
        source_fail(status, source, e)
        return []


def fetch_tushare_dc_hot(status):
    source = 'tushare_dc_hot'
    token = os.environ.get('TUSHARE_TOKEN') or os.environ.get('NUXT_TUSHARE_TOKEN')
    url = os.environ.get('TUSHARE_URL') or os.environ.get('NUXT_TUSHARE_URL') or 'http://api.tushare.pro'
    if not token:
        status[source] = {'ok': False, 'count': 0, 'message': 'missing TUSHARE_TOKEN', 'label': SOURCE_LABELS[source]}
        return []

    try:
        payload = {
            'api_name': 'dc_hot',
            'token': token,
            'params': {'market': 'A'},
            'fields': 'trade_date,ts_code,ts_name,rank,pct_change,current_price',
        }
        req = Request(url, data=json.dumps(payload).encode('utf-8'), headers={**HEADERS, 'Content-Type': 'application/json'})
        raw = urlopen(req, timeout=20).read().decode('utf-8', errors='ignore')
        data = json.loads(raw)
        items = data.get('data', {}).get('items', []) or []
        fields = data.get('data', {}).get('fields', []) or []
        rows = []
        for arr in items[:40]:
            obj = dict(zip(fields, arr))
            code = obj.get('ts_code') or ''
            name = obj.get('ts_name') or code
            rank = int(float(obj.get('rank') or 999))
            pct = normalize_pct(obj.get('pct_change'))
            symbol = code.split('.')[0] if code else ''
            rows.append(topic(
                f'{name}({code}) 东财热榜第 {rank} 名，涨跌幅 {pct:+.2f}%' if pct is not None else f'{name}({code}) 东财热榜第 {rank} 名',
                source,
                concepts=classify_topic(name) or ['个股热度'],
                sentiment='positive' if pct is not None and pct >= 2 else ('slightly_positive' if pct is not None and pct > 0 else 'neutral'),
                stocks=[stock(symbol, name, 'A', pct_chg=pct, rank=rank, ts_code=code)],
                heat=max(1, 45 - rank),
            ))
        source_ok(status, source, len(rows))
        return rows
    except Exception as e:
        source_fail(status, source, e)
        return []


def fetch_stocktwits(status):
    source = 'stocktwits'
    try:
        data = request_json('https://api.stocktwits.com/api/2/trending/symbols.json', headers={'Referer': 'https://stocktwits.com/'})
        symbols = data.get('symbols', []) or []
        rows = []
        for rank, s in enumerate(symbols[:30], start=1):
            symbol = s.get('symbol') or ''
            name = s.get('title') or symbol
            if not symbol:
                continue
            rows.append(topic(
                f'{symbol} {name} Stocktwits trending #{rank}',
                source,
                concepts=classify_topic(f'{symbol} {name}') or ['美股热议'],
                sentiment='neutral',
                stocks=[stock(symbol, name, 'US', rank=rank)],
                heat=max(1, 32 - rank),
            ))
        source_ok(status, source, len(rows))
        return rows
    except Exception as e:
        source_fail(status, source, e)
        return []


def fetch_reddit(subreddit, status):
    source = f'reddit_{subreddit}'
    try:
        url = f'https://www.reddit.com/r/{subreddit}/hot.json?limit=30'
        data = request_json(url, headers={'User-Agent': 'StockDashboardForumRadar/1.0 by wx-wang'})
        children = data.get('data', {}).get('children', []) or []
        rows = []
        for item in children:
            d = item.get('data', {})
            title_text = d.get('title') or ''
            if not title_text:
                continue
            tickers = [stock(t, t, 'US') for t in extract_us_tickers(title_text)]
            heat = max(1, (d.get('score') or 0) / 100 + (d.get('num_comments') or 0) / 40)
            rows.append(topic(
                title_text,
                source,
                concepts=classify_topic(title_text) or ['美股热议'],
                sentiment=classify_sentiment(title_text),
                stocks=tickers,
                heat=heat,
                url='https://www.reddit.com' + (d.get('permalink') or ''),
            ))
        source_ok(status, source, len(rows))
        return rows
    except Exception as e:
        source_fail(status, source, e)
        return []


def aggregate_results(all_topics, source_status):
    today = datetime.now().strftime('%Y-%m-%d')
    deduped = []
    seen = set()
    for item in sorted(all_topics, key=lambda x: x.get('heat', 1), reverse=True):
        key = (item.get('source'), clean_text(item.get('title', ''))[:42])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    concept_heat = {}
    sentiments = {'positive': 0, 'negative': 0, 'neutral': 0}
    stock_map = {}

    for item in deduped:
        source = item.get('source', '')
        source_weight = SOURCE_WEIGHTS.get(source, 1.0)
        heat = float(item.get('heat') or 1) * source_weight

        for c in item.get('concepts', []):
            concept_heat[c] = concept_heat.get(c, 0) + heat

        s = item.get('sentiment', 'neutral')
        if 'positive' in s:
            sentiments['positive'] += 1
        elif 'negative' in s:
            sentiments['negative'] += 1
        else:
            sentiments['neutral'] += 1

        for st in item.get('stocks', []) or []:
            symbol = st.get('symbol')
            if not symbol:
                continue
            market = st.get('market', '')
            key = f'{market}:{symbol}'
            current = stock_map.setdefault(key, {
                'symbol': symbol,
                'name': st.get('name') or symbol,
                'market': market,
                'heat': 0,
                'mentions': 0,
                'sources': [],
                'topics': [],
                'sentiment_score': 0,
                'pct_chg': st.get('pct_chg'),
                'price': st.get('price'),
                'net_inflow': st.get('net_inflow'),
            })
            current['heat'] += heat
            current['mentions'] += 1
            current['sentiment_score'] += sentiment_score(s)
            if source not in current['sources']:
                current['sources'].append(source)
            if len(current['topics']) < 3:
                current['topics'].append(item.get('title', ''))
            for field in ('pct_chg', 'price', 'net_inflow'):
                if current.get(field) is None and st.get(field) is not None:
                    current[field] = st.get(field)

    hot_stocks = sorted(stock_map.values(), key=lambda x: (-x['heat'], -x['mentions']))[:30]
    for rank, item in enumerate(hot_stocks, start=1):
        item['rank'] = rank
        item['heat'] = round(item['heat'], 2)
        item['sentiment'] = '偏多' if item['sentiment_score'] > 0 else ('偏空' if item['sentiment_score'] < 0 else '中性')

    hot_words = extract_hot_words(deduped)
    successful_sources = [k for k, v in source_status.items() if v.get('ok')]
    domestic_sources = {'eastmoney_flow', 'eastmoney_sector', 'eastmoney_concept', 'tushare_dc_hot'}
    international_sources = {'stocktwits', 'reddit_wsb', 'reddit_stocks', 'cnbc', 'marketwatch'}
    domestic_count = sum(1 for t in deduped if t.get('source') in domestic_sources)
    intl_count = sum(1 for t in deduped if t.get('source') in international_sources)

    dominant = '偏乐观' if sentiments['positive'] > sentiments['negative'] else (
        '偏悲观' if sentiments['negative'] > sentiments['positive'] else '中性'
    )

    result = {
        'success': True,
        'version': 2,
        'date': today,
        'generated_at': now_iso(),
        'summary': {
            'total_topics': len(deduped),
            'forums_crawled': successful_sources,
            'domestic_forums': domestic_count,
            'international_forums': intl_count,
            'dominant_sentiment': dominant,
            'sentiment_breakdown': sentiments,
            'source_count': len(successful_sources),
        },
        'source_status': source_status,
        'hot_keywords': hot_words,
        'top_topics': sorted(deduped, key=lambda x: x.get('heat', 1), reverse=True)[:40],
        'concept_heat': [
            {'concept': c, 'count': round(n, 1)}
            for c, n in sorted(concept_heat.items(), key=lambda x: -x[1])[:20]
        ],
        'hot_stocks': hot_stocks,
        'methodology': '多源缓存式论坛雷达：稳定源优先，失败源记录状态；热门股票按来源权重、热度、提及次数和情绪合成。',
    }
    return result


def extract_hot_words(topics):
    all_cn = ' '.join(t.get('title', '') for t in topics if any('\u4e00' <= c <= '\u9fff' for c in t.get('title', '')))
    word_freq = {}
    stop = {
        '一个', '什么', '怎么', '这个', '我们', '大家', '可以', '没有', '不是', '现在', '已经', '还是',
        '因为', '所以', '如果', '但是', '而且', '然后', '可能', '应该', '需要', '非常', '比较',
        '自己', '他们', '进行', '使用', '通过', '相关', '主要', '目前', '其中', '其他',
        '不过', '只是', '就是', '还有', '来说', '对于', '以及', '一定', '板块', '概念', '涨幅', '成交额',
        '主力', '净流入', '东方财富', '行业', '个股',
    }
    for w in re.findall(r'[\u4e00-\u9fff]{2,6}', all_cn):
        if w not in stop:
            word_freq[w] = word_freq.get(w, 0) + 1
    return [{'word': w, 'count': c} for w, c in sorted(word_freq.items(), key=lambda x: -x[1])[:20]]


def save_result(result):
    os.makedirs(RADAR_DIR, exist_ok=True)
    with open(LATEST_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    dated = os.path.join(RADAR_DIR, f'{result["date"]}.json')
    with open(dated, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    os.makedirs(os.path.dirname(LEGACY_FILE), exist_ok=True)
    with open(LEGACY_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)


def main(save=True):
    print(f'[论坛雷达] 开始 — {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    start = time.time()
    source_status = {}

    collectors = [
        ('东方财富资金流', lambda: fetch_eastmoney_hot_stocks(source_status)),
        ('东方财富行业', lambda: fetch_eastmoney_board('industry', source_status)),
        ('东方财富概念', lambda: fetch_eastmoney_board('concept', source_status)),
        ('Tushare东财热榜', lambda: fetch_tushare_dc_hot(source_status)),
        ('Stocktwits', lambda: fetch_stocktwits(source_status)),
        ('Reddit WSB', lambda: fetch_reddit('wsb', source_status)),
        ('Reddit Stocks', lambda: fetch_reddit('stocks', source_status)),
        ('CNBC RSS', lambda: fetch_cnbc(source_status)),
        ('MarketWatch RSS', lambda: fetch_marketwatch(source_status)),
    ]

    all_topics = []
    for label, fn in collectors:
        print(f'[论坛雷达] {label}...')
        rows = fn()
        print(f'[论坛雷达] {label}: {len(rows)} 条')
        all_topics.extend(rows)

    result = aggregate_results(all_topics, source_status)
    elapsed = time.time() - start
    print(f'[论坛雷达] 完成 — {len(all_topics)} 条原始, {len(result["top_topics"])} 条话题, {len(result["hot_stocks"])} 只股票, {elapsed:.1f}s')

    if save:
        save_result(result)
        print(f'[论坛雷达] 已保存 → {LATEST_FILE}')
        print(f'[论坛雷达] 已同步 → {LEGACY_FILE}')

    return result


if __name__ == '__main__':
    save = '--no-save' not in sys.argv
    to_stdout = '--stdout' in sys.argv
    data = main(save=save)
    if to_stdout:
        print(json.dumps(data, ensure_ascii=False, indent=2))
