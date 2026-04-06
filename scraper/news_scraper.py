import os, sys, json, time, random, hashlib, re, requests
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from bs4 import BeautifulSoup

load_dotenv()

# ── 配置（全部从环境变量读取，代码中无任何硬编码密钥）────────────
REQUIRED_ENV = ["X_AUTH_TOKEN", "X_CT0", "GEMINI_API_KEY",
                "CF_ACCOUNT_ID", "CF_KV_NAMESPACE_ID", "CF_API_TOKEN"]
cfg = {k: os.getenv(k) for k in REQUIRED_ENV}
missing = [k for k, v in cfg.items() if not v]
if missing:
    raise EnvironmentError(f"缺少环境变量: {', '.join(missing)}")

X_LIST_ID   = "2030185247699296603"  # 从列表URL中获取数字ID填入
HOURS_BACK  = 25             # 抓取过去25小时，覆盖昨夜内容
RETAIN_DAYS = 30

# ── Gemini 限速配置 ──────────────────────────────────────────────
GEMINI_RPM        = 15         # 每分钟最多 15 次请求
GEMINI_TPM        = 250_000    # 每分钟 input+output token 上限
GEMINI_DAILY_MAX  = 500        # 每日总请求上限（RPD）
GEMINI_INTERVAL   = 60.0 / GEMINI_RPM + 0.5  # 每次调用间隔 ~4.5 秒

# ── Token / 速率追踪器 ──────────────────────────────────────────
class RateLimiter:
    def __init__(self):
        self.last_call_time = 0      # 上一次调用的时间戳
        self.minute_tokens = []      # (timestamp, token_count) 记录
        self.daily_calls = 0

    def wait_for_slot(self):
        """确保两次调用间隔至少 GEMINI_INTERVAL 秒"""
        elapsed = time.time() - self.last_call_time
        if elapsed < GEMINI_INTERVAL:
            gap = GEMINI_INTERVAL - elapsed
            time.sleep(gap)
        self.last_call_time = time.time()

    def check_tpm(self):
        """返回当前分钟内剩余可用 token 数"""
        now = time.time()
        self.minute_tokens = [(t, n) for t, n in self.minute_tokens if now - t < 60]
        used = sum(n for _, n in self.minute_tokens)
        return GEMINI_TPM - used

    def record_tokens(self, count):
        self.minute_tokens.append((time.time(), count))

    def wait_for_tpm(self, estimated_tokens):
        """如果 TPM 不够，等到下一个分钟窗口"""
        remaining = self.check_tpm()
        if estimated_tokens > remaining and self.minute_tokens:
            oldest = self.minute_tokens[0][0]
            wait = 60 - (time.time() - oldest) + 0.5
            print(f"  TPM 接近上限（剩余 ~{remaining:,}），等待 {wait:.0f} 秒...")
            time.sleep(max(wait, 1))

    def can_continue(self):
        if self.daily_calls >= GEMINI_DAILY_MAX:
            print(f"已达每日上限 {GEMINI_DAILY_MAX} 次，停止处理")
            return False
        return True

    def record_call(self):
        self.daily_calls += 1

rate_limiter = RateLimiter()

SUBNET_ACCOUNTS = {
    "apex_sn1":         "SN1 Apex",
    "inference_labs":   "SN2 Dsperse",
    "tplr_ai":          "SN3 τemplar",
    "targoncompute":    "SN4 Targon",
    "manifoldlabs":     "SN5 HONE",
    "numinous_ai":      "SN6 Numinous",
    "taoshiio":         "SN8 Vanta",
    "iota_sn9":         "SN9 iota",
    "_taofi_":          "SN10 Swap",
    "trajectoryrl":     "SN11 TrajectoryRL",
    "computehorde":     "SN12 Compute Horde",
    "data_sn13":        "SN13 Data Universe",
    "taohash":          "SN14 TAOHash",
    "oroagents":        "SN15 ORO",
    "bitads_ai":        "SN16 BitAds",
    "404gen_":          "SN17 404—GEN",
    "zeussubnet":       "SN18 Zeus",
    "blockmachine_io":  "SN19 blockmachine",
    "groundlayerhq":    "SN20 GroundLayer",
    "adtao_ppcrebel":   "SN21 AdTAO",
    "desearch_ai":      "SN22 Desearch",
    "trishoolai":       "SN23 Trishool",
    "quasarmodels":     "SN24 Quasar",
    "macrocosmosai":    "SN25 Mainframe",
    "kinitroai":        "SN26 Kinitro",
    "nodex0_":          "SN27 Nodexo",
    "naschain_ai":      "SN31 Halftime",
    "ai_detection":     "SN32 ItsAI",
    "readyai_":         "SN33 ReadyAI",
    "bitmindai":        "SN34 BitMind",
    "0x_markets":       "SN35 Cartha",
    "aureliusaligned":  "SN37 Aurelius",
    "chunking_subnet":  "SN40 Chunking",
    "sportstensor":     "SN41 Almanac",
    "graphitesubnet":   "SN43 Graphite",
    "webuildscore":     "SN44 Score",
    "wearetalisman":    "SN45 Talisman AI",
    "resilabsai":       "SN46 RESI",
    "qbittensorlabs":   "SN48 & SN63",
    "nepher_robotics":  "SN49 Nepher Robotics",
    "synthdataco":      "SN50 Synth",
    "lium_io":          "SN51 lium",
    "yanez__ai":        "SN54 Yanez MIID",
    "niomeai":          "SN55 NIOME",
    "gradients_ai":     "SN56 Gradients",
    "handshake_58":     "SN58 Handshake",
    "babelbit":         "SN59 Babelbit",
    "bitsecai":         "SN60 Bitsec ai",
    "_redteam_":        "SN61 RedTeam",
    "ridges_ai":        "SN62 Ridges",
    "chutes_ai":        "SN64 Chutes",
    "tpn_labs":         "SN65 TPN",
    "alpha_core_ai":    "SN66 Tau coding agent",
    "harnyx_ai":        "SN67 Harnyx",
    "metanova_labs":    "SN68 NOVA",
    "nexisgen_ai":      "SN70 NexisGen",
    "leadpoetai":       "SN71 Leadpoet",
    "natixnetwork":     "SN72 NATIX",
    "metahashsn73":     "SN73 MetaHash",
    "gittensor_io":     "SN74 Gittensor",
    "hippius_subnet":   "SN75 Hippius",
    "77liquidity":      "SN77 Liquidity",
    "loosh_ai":         "SN78 Loosh",
    "taos_im":          "SN79 MVTRX",
    "layer_doge":       "SN80 dogelayer",
    "grail_ai":         "SN81 grail",
    "hermessubnet":     "SN82 Hermes",
    "tatsuecosystem":   "SN84 ChipForge",
    "vidaio_":          "SN85 Vidaio",
    "luminarnetwork":   "SN87 Luminar Network",
    "investing88ai":    "SN88 Investing",
    "infinitequant_":   "SN89 InfiniteHash",
    "bitstarterai":     "SN91 Bitstarter",
    "bitcast_network":  "SN93 Bitcast",
    "arbos_born":       "SN97 distil",
    "forevermoney_ai":  "SN98 ForeverMoney",
    "leoma_ai":         "SN99 Leoma",
    "platform_tao":     "SN100 Plaτform",
    "djinn_gg":         "SN103 Djinn",
    "b1m_ai":           "SN105 Beam",
    "v0idai":           "SN106 VoidAI",
    "theminos_ai":      "SN107 Minos",
    "minotaursubnet":   "SN112 minotaur",
    "tensorusd":        "SN113 TensorUSD",
    "somasubnet":       "SN114 SOMA",
    "taolend":          "SN116 TaoLend",
    "shiftlayer_ai":    "SN117 BrainPlay",
    "subnet118":        "SN118 HODL Exchange",
    "affine_io":        "SN120 Affine",
    "sundaebar_ai":     "SN121 sundae_bar",
    "bitrecs":          "SN122 Bitrecs",
    "swarmsubnet":      "SN124 Swarm",
    "poker44subnet":    "SN126 Poker44",
    "astridintel":      "SN127 Astrid",
    "byteleap_ai":      "SN128 ByteLeap",
}

# ── 网络检测（开机后等待网络就绪）───────────────────────────────
def wait_for_network(retries=5, interval=30):
    for i in range(retries):
        try:
            requests.get("https://x.com", timeout=10)
            return True
        except Exception:
            print(f"网络未就绪，{interval}秒后重试（{i+1}/{retries}）")
            time.sleep(interval)
    return False

# ── Gemini 筛选+改写 ─────────────────────────────────────────────
SYSTEM_INSTRUCTION = ("你是一位社交媒体翻译官。请将推文翻译成地道的中文。\n"
    "要求：\n"
    "使用互联网化的中文表达。\n"
    "保持原推文的语气（是幽默、讽刺还是严肃）。\n"
    "避免任何形式的'翻译腔'，读起来要像中国博主自己发的动态。")

PROMPT = """你是 Bittensor 生态编辑。判断以下内容是否属于重要事件：
主网上线 / 重大技术突破（新模型、论文、算法升级）/ 路线图里程碑完成 /
融资或合作公告 / 代币经济调整（emission、registration、矿工门槛）/
重要活动开启或结果（锦标赛、黑客松）/ 关键指标突破（用户数、算力、收入）/
验证者政策重大变化 / 知名机构或KOL背书 / 与其他子网重要集成联动。

不重要（日常感谢、转发水帖、纯价格评论、无实质预热帖）→ 只返回 NOT_IMPORTANT

重要 → 改写为中文快讯，规则如下：
- 120字以内，完整保留推文核心意思，不遗漏关键信息
- 如果内容来自文章，概括文章大意，并引导"详情见原文"
- 不加"该项目""该子网"等主语，语气简洁有力
- 不要附链接，链接由系统自动添加

内容：{text}

直接返回中文内容或 NOT_IMPORTANT，不要任何其他说明。"""

# ── X 文章正文抓取 ───────────────────────────────────────────────
def fetch_article(url):
    """检测推文中的 X 文章链接并抓取正文前1500字"""
    try:
        resp = requests.get(
            url,
            headers={
                "Cookie": f"auth_token={cfg['X_AUTH_TOKEN']}; ct0={cfg['X_CT0']}",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout=15,
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        # 移除脚本、样式等无用标签
        for tag in soup(["script", "style", "nav", "header", "footer"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
        return text[:1500]
    except Exception:
        return ""

def estimate_tokens(text):
    """粗略估算 token 数：中文 ~1.5 token/字，英文 ~0.75 token/词，加 prompt 开销"""
    char_count = len(text)
    # 混合中英文，按 1 token / 2 字符 估算，加 prompt 模板 ~300 token + 输出 ~200 token
    return int(char_count / 2) + 500

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent"

def call_gemini(tweet_text):
    """通过 REST API 调用 Gemini 3.1 Flash Lite，返回 (text, token_count) 或抛异常"""
    prompt = PROMPT.replace("{text}", tweet_text)
    resp = requests.post(
        GEMINI_API_URL,
        params={"key": cfg["GEMINI_API_KEY"]},
        headers={"Content-Type": "application/json"},
        json={
            "system_instruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.6, "topP": 0.95, "maxOutputTokens": 256},
        },
        timeout=60,
    )
    if resp.status_code == 429:
        raise Exception("429")
    resp.raise_for_status()
    data = resp.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    # token 用量
    usage = data.get("usageMetadata", {})
    tokens = usage.get("promptTokenCount", 0) + usage.get("candidatesTokenCount", 0)
    return text, tokens

def _clean_result(text):
    """清理 Gemini 返回内容，只保留纯中文快讯"""
    if not text:
        return None
    text = text.strip()
    if "NOT_IMPORTANT" in text:
        return None
    # 丢弃含英文分析痕迹的回复（Gemma/Gemini 偶尔回显 prompt）
    garbage_markers = ["Task:", "Input:", "Role:", "Classify", "Response:", "Determine if", "Constraints:"]
    for marker in garbage_markers:
        if marker in text:
            return None
    # 去掉 markdown 标记
    text = re.sub(r"^\s*[\*\-•]\s*", "", text, flags=re.MULTILINE).strip()
    # 去掉可能残留的引号包裹
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1].strip()
    # 最终检查：中文字符占比 < 30% 视为垃圾
    chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
    if len(text) > 0 and chinese_chars / len(text) < 0.3:
        return None
    return text if text else None

def rewrite(text):
    # 检测是否含 X 文章链接
    article_match = re.search(r"https://x\.com/i/articles/\S+", text)
    if article_match:
        article_text = fetch_article(article_match.group(0))
        if article_text:
            combined = f"推文摘要：{text}\n\n文章正文节选：{article_text}"
            safe_content = combined[:3000]
        else:
            safe_content = text[:1500]
    else:
        safe_content = text[:1500]

    # TPM 检查
    est = estimate_tokens(safe_content)
    remaining_tpm = rate_limiter.check_tpm()
    if est > remaining_tpm:
        if remaining_tpm > 1000:
            max_chars = max(200, (remaining_tpm - 500) * 2)
            safe_content = safe_content[:int(max_chars)]
            print(f"  TPM 紧张（剩余 ~{remaining_tpm:,}），截短至 {len(safe_content)} 字符")
            est = estimate_tokens(safe_content)
        else:
            rate_limiter.wait_for_tpm(est)

    # RPM 等待
    rate_limiter.wait_for_slot()

    try:
        result, tokens = call_gemini(safe_content)
        rate_limiter.record_tokens(tokens or est)
        rate_limiter.record_call()
        cleaned = _clean_result(result)
        return cleaned
    except Exception as e:
        if "429" in str(e):
            print("  429 限速，等待 60 秒后重试...")
            time.sleep(60)
            rate_limiter.wait_for_slot()
            try:
                result, tokens = call_gemini(safe_content)
                rate_limiter.record_tokens(tokens or est)
                rate_limiter.record_call()
                return _clean_result(result)
            except Exception as e2:
                print(f"  重试仍失败: {e2}")
                return None
        print(f"Gemini 错误: {e}")
        return None

# ── X 列表抓取 ───────────────────────────────────────────────────
GRAPHQL_FEATURES = {'rweb_video_screen_enabled':False,'profile_label_improvements_pcf_label_in_post_enabled':True,'responsive_web_profile_redirect_enabled':False,'rweb_tipjar_consumption_enabled':False,'verified_phone_label_enabled':False,'creator_subscriptions_tweet_preview_api_enabled':True,'responsive_web_graphql_timeline_navigation_enabled':True,'responsive_web_graphql_skip_user_profile_image_extensions_enabled':False,'premium_content_api_read_enabled':False,'communities_web_enable_tweet_community_results_fetch':True,'c9s_tweet_anatomy_moderator_badge_enabled':True,'responsive_web_grok_analyze_button_fetch_trends_enabled':False,'responsive_web_grok_analyze_post_followups_enabled':True,'responsive_web_jetfuel_frame':True,'responsive_web_grok_share_attachment_enabled':True,'responsive_web_grok_annotations_enabled':True,'articles_preview_enabled':True,'responsive_web_edit_tweet_api_enabled':True,'graphql_is_translatable_rweb_tweet_is_translatable_enabled':True,'view_counts_everywhere_api_enabled':True,'longform_notetweets_consumption_enabled':True,'responsive_web_twitter_article_tweet_consumption_enabled':True,'content_disclosure_indicator_enabled':True,'content_disclosure_ai_generated_indicator_enabled':True,'responsive_web_grok_show_grok_translated_post':False,'responsive_web_grok_analysis_button_from_backend':True,'post_ctas_fetch_enabled':False,'freedom_of_speech_not_reach_fetch_enabled':True,'standardized_nudges_misinfo':True,'tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled':True,'longform_notetweets_rich_text_read_enabled':True,'longform_notetweets_inline_media_enabled':False,'responsive_web_grok_image_annotation_enabled':True,'responsive_web_grok_imagine_annotation_enabled':True,'responsive_web_grok_community_note_auto_translation_is_enabled':False,'responsive_web_enhance_cards_enabled':False}

def fetch_tweets():
    headers = {
        "Authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
        "Cookie": f"auth_token={cfg['X_AUTH_TOKEN']}; ct0={cfg['X_CT0']}",
        "X-Csrf-Token": cfg["X_CT0"],
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "Referer": "https://x.com/home",
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
    }
    cutoff = datetime.now(timezone.utc) - timedelta(hours=HOURS_BACK)
    tweets, cursor = [], None

    while True:
        variables = {"listId": X_LIST_ID, "count": 100}
        if cursor:
            variables["cursor"] = cursor

        resp = None
        for attempt in range(3):
            try:
                resp = requests.get(
                    "https://x.com/i/api/graphql/qcQY-EkEWjJ-wwJhsKdxYQ/ListLatestTweetsTimeline",
                    headers=headers,
                    params={"variables": json.dumps(variables), "features": json.dumps(GRAPHQL_FEATURES)},
                    timeout=15,
                )
                resp.raise_for_status()
                break
            except Exception as e:
                print(f"X 请求失败（第{attempt+1}次）: {e}")
                if attempt < 2:
                    time.sleep(3 * (attempt + 1))
        if not resp or not resp.ok:
            break
        try:
            data = resp.json()
        except Exception as e:
            print(f"X 响应解析失败: {e}")
            break

        entries = (data.get("data", {}).get("list", {})
                       .get("tweets_timeline", {}).get("timeline", {})
                       .get("instructions", [{}])[0].get("entries", []))
        if not entries:
            break

        next_cursor, reached_cutoff = None, False

        for entry in entries:
            if "cursor-bottom" in entry.get("entryId", ""):
                next_cursor = entry.get("content", {}).get("value")
                continue

            t = (entry.get("content", {}).get("itemContent", {})
                      .get("tweet_results", {}).get("result", {}))
            if not t:
                continue

            legacy = t.get("legacy", {})
            text = legacy.get("full_text", "")
            if text.startswith("RT @"):
                continue

            try:
                created_at = datetime.strptime(
                    legacy.get("created_at", ""), "%a %b %d %H:%M:%S +0000 %Y"
                ).replace(tzinfo=timezone.utc)
            except Exception:
                continue

            if created_at < cutoff:
                reached_cutoff = True
                continue

            user = t.get("core", {}).get("user_results", {}).get("result", {})
            author = (user.get("core", {}).get("screen_name")
                      or user.get("legacy", {}).get("screen_name", "")).lower()
            subnet = SUBNET_ACCOUNTS.get(author)
            if not subnet:
                continue

            tid = legacy.get("id_str", "")
            tweets.append({
                "text": text,
                "subnet": subnet,
                "created_at": created_at.isoformat(),
                "url": f"https://x.com/{author}/status/{tid}",
                "tid": tid,
            })

        if reached_cutoff or not next_cursor:
            break
        cursor = next_cursor
        time.sleep(random.uniform(2, 4))

    return tweets

# ── Cloudflare KV 操作 ───────────────────────────────────────────
KV_BASE = (f"https://api.cloudflare.com/client/v4/accounts/"
           f"{cfg['CF_ACCOUNT_ID']}/storage/kv/namespaces/{cfg['CF_KV_NAMESPACE_ID']}")
KV_HDR  = {"Authorization": f"Bearer {cfg['CF_API_TOKEN']}"}

def kv_put(key, value):
    requests.put(f"{KV_BASE}/values/{key}", headers=KV_HDR,
                 data=json.dumps(value), timeout=10)

def kv_list(prefix):
    r = requests.get(f"{KV_BASE}/keys", headers=KV_HDR,
                     params={"prefix": prefix}, timeout=10)
    return [k["name"] for k in r.json().get("result", [])] if r.ok else []

def kv_delete(key):
    requests.delete(f"{KV_BASE}/values/{key}", headers=KV_HDR, timeout=10)

# ── 主流程 ───────────────────────────────────────────────────────
def main():
    if not wait_for_network():
        print("网络连接失败，退出")
        return

    print(f"开始抓取，范围：过去 {HOURS_BACK} 小时")
    tweets = fetch_tweets()
    print(f"抓取到 {len(tweets)} 条子网推文")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    saved = 0

    for i, tweet in enumerate(tweets):
        if not rate_limiter.can_continue():
            break
        print(f"[{i+1}/{len(tweets)}] 处理 {tweet['subnet']}...")
        content = rewrite(tweet["text"])
        if not content:
            continue

        key = f"news:{today}:{hashlib.md5(tweet['tid'].encode()).hexdigest()[:6]}"
        kv_put(key, {
            "subnet":     tweet["subnet"],
            "content":    content,
            "url":        tweet["url"],
            "created_at": tweet["created_at"],
        })
        saved += 1
        print(f"✓ [{tweet['subnet']}] {content[:40]}...")

    # 清理超过30天的过期数据
    cutoff_date = (datetime.now(timezone.utc) - timedelta(days=RETAIN_DAYS)).strftime("%Y-%m-%d")
    for key in kv_list("news:"):
        parts = key.split(":")
        if len(parts) >= 2 and parts[1] < cutoff_date:
            kv_delete(key)

    print(f"完成，共保存 {saved} 条快讯")

if __name__ == "__main__":
    main()
