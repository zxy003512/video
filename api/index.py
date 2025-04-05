import os
import requests
from bs4 import BeautifulSoup
import json
import time
import re
from flask import Flask, request, jsonify, send_from_directory
from urllib.parse import urlparse, parse_qs, urljoin
from dotenv import load_dotenv

# Load environment variables from .env file for local development
load_dotenv()

app = Flask(__name__, static_folder='../public', static_url_path='')

# --- Configuration ---
DEFAULT_AI_API_URL = os.getenv('AI_API_URL', "https://api.zetatechs.com/v1/chat/completions")
DEFAULT_AI_API_KEY = os.getenv('AI_API_KEY', "YOUR_FALLBACK_OR_PLACEHOLDER_KEY") # Vercel 环境变量中必须设置!
DEFAULT_AI_MODEL = os.getenv('AI_MODEL', "gemini-2.0-flash") # 确认模型名称正确
DEFAULT_SEARXNG_URL = os.getenv('SEARXNG_URL', "https://searxng.zetatechs.online/search")
DEFAULT_PARSING_INTERFACES_JSON = os.getenv('DEFAULT_PARSING_INTERFACES', json.dumps([
    {"name": "接口1 - xmflv.com", "url": "https://jx.xmflv.com/?url=", "restricted_mobile": True},
    {"name": "接口2 - bd.jx.cn", "url": "https://bd.jx.cn/?url=", "restricted_mobile": False},
    {"name": "接口3 - xmflv.cc", "url": "https://jx.xmflv.cc/?url=", "restricted_mobile": True},
    {"name": "接口4 - hls.one", "url": "https://jx.hls.one/?url=", "restricted_mobile": False},
    {"name": "接口5 - 77flv.cc", "url": "https://jx.77flv.cc/?url=", "restricted_mobile": False},
    {"name": "接口6 - yemu.xyz", "url": "https://www.yemu.xyz/?url=", "restricted_mobile": True}
]))

AI_MAX_TOKENS = 30000 # 可以适当调整，但对于提取任务应该足够
AI_TEMPERATURE = 0.0 # 保持确定性输出
AI_MAX_RETRIES = 3
AI_RETRY_DELAY = 1 # seconds (修改为1秒)

# --- Constants for YFSP ---
YFSP_BASE_URL = "https://www.yfsp.lv" # 使用实际的YFSP域名
YFSP_SEARCH_TEMPLATE = f"{YFSP_BASE_URL}/s/-------------/?wd={{}}"
YFSP_DETAIL_TEMPLATE = f"{YFSP_BASE_URL}/voddetail/{{}}/" # 详情页模板
YFSP_PLAY_TEMPLATE = f"{YFSP_BASE_URL}/iyfplay/{{}}-1-{{}}/" # 播放页模板
YFSP_FINAL_PLAYER_TEMPLATE = "https://b.212133.xyz/player/ec.php?code=qw&if=1&url={}" # 这个最终播放器地址可能需要确认是否仍有效
REQUEST_HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'} # 使用较新的 UA

# --- Helper Function: Extract Domain ---
def get_domain(url):
    try:
        return urlparse(url).netloc
    except:
        return "Unknown"

# --- SearXNG Search Function (Original AI Method) ---
def search_searxng_backend(query, searxng_url):
    params = {
        'q': query, 'categories': 'general', 'language': 'auto',
        'time_range': '', 'safesearch': '0', 'theme': 'simple', 'format': 'html'
    }
    search_results = []
    print(f"Backend (AI Method): Searching SearXNG ({searxng_url}) for: {query}")
    try:
        response = requests.get(searxng_url, params=params, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        result_articles = soup.find_all('article', class_='result')
        print(f"Backend (AI Method): SearXNG found {len(result_articles)} raw results.")
        for article in result_articles:
            h3_tag = article.find('h3')
            if h3_tag:
                link_tag = h3_tag.find('a', href=True)
                if link_tag:
                    title = link_tag.get_text(strip=True)
                    link = link_tag['href']
                    # 确保链接是绝对 URL
                    link = urljoin(searxng_url, link) if not link.startswith('http') else link
                    if title and link.startswith('http'):
                        search_results.append({'title': title, 'link': link})
    except Exception as e:
        print(f"Backend (AI Method): SearXNG Error: {e}")
    print(f"Backend (AI Method): Extracted {len(search_results)} valid results.")
    return search_results

# --- AI Filtering Function (Original AI Method) ---
AI_PROMPT_CN = f"""
请分析以下搜索结果列表（每个结果包含标题 Title 和 URL）。
你的任务是仅识别出那些直接指向电影或电视剧集播放页面的 URL。
优先考虑来自主要视频平台（如腾讯视频 v.qq.com, 爱奇艺 iq.com, Bilibili bilibili.com, 优酷 youku.com, 芒果TV mgtv.com, 华数TV wasu.cn 等）的链接，但也要包含来自其他专用视频流媒体网站的任何有效的直接视频播放链接。

明确排除以下类型的链接：
- 一般信息页面（如维基百科、百度百科、豆瓣信息页，除非页面内嵌了播放器）
- 新闻文章、博客帖子
- 论坛讨论或社区（如知乎、贴吧、Reddit）
- 社交媒体网站（除非是官方平台频道托管的完整剧集，如 YouTube 官方频道）
- 电子商务网站、下载网站、搜索结果聚合页
- 网站主页或频道列表页（除非 URL 结构强烈暗示直接播放）
- 短视频剪辑（重点是完整剧集/电影）

请仅以 JSON 列表对象的形式返回你的发现。列表中的每个对象必须包含以下确切的键：
- "title": 与识别出的视频链接关联的原始标题。
- "video_link": 你识别出的直接视频播放链接 URL。
- "website": 从 video_link 中提取的视频平台域名（例如："v.qq.com", "bilibili.com", "iq.com"）。使用根域名（例如：www.bilibili.com -> bilibili.com）。

如果在提供的列表中未找到有效的视频播放链接，请返回一个空的 JSON 列表：[]。
请勿在 JSON 结构之外包含任何解释或介绍性文字。只需返回 JSON 列表本身。

以下是需要分析的搜索结果列表：
--- START OF LIST ---
{{input_data_for_ai}}
--- END OF LIST ---

你的 JSON 输出：
"""

def filter_links_with_ai_backend(results_list, ai_url, ai_key, ai_model):
    if not results_list: return []

    print(f"Backend (AI Filter): Sending {len(results_list)} results to AI ({ai_url}, model: {ai_model})")
    input_data_for_ai = "\n".join([f"Title: {item['title']}\nURL: {item['link']}" for item in results_list])
    prompt_to_use = AI_PROMPT_CN.format(input_data_for_ai=input_data_for_ai) # 使用中文提示

    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
    payload = {
        "model": ai_model, "messages": [{"role": "user", "content": prompt_to_use}],
        "max_tokens": AI_MAX_TOKENS, "temperature": AI_TEMPERATURE, "stream": False
    }

    for attempt in range(AI_MAX_RETRIES):
        print(f"Backend (AI Filter): AI API attempt {attempt + 1}/{AI_MAX_RETRIES}")
        response = None
        try:
            response = requests.post(ai_url, headers=headers, json=payload, timeout=90)
            response.raise_for_status()
            ai_response = response.json()

            if 'choices' in ai_response and len(ai_response['choices']) > 0:
                content = ai_response['choices'][0].get('message', {}).get('content')
                if content:
                    print("Backend (AI Filter): AI response received, parsing JSON...")
                    try:
                        json_content = content.strip()
                        # Handle potential markdown code blocks
                        if json_content.startswith("```json"): json_content = json_content[7:]
                        if json_content.endswith("```"): json_content = json_content[:-3]
                        json_content = json_content.strip()

                        parsed_data = json.loads(json_content)
                        if isinstance(parsed_data, list):
                            validated_data = []
                            for item in parsed_data:
                                if isinstance(item, dict) and 'title' in item and 'video_link' in item:
                                    # Ensure website field is present
                                    if 'website' not in item or not item['website']:
                                         item['website'] = get_domain(item['video_link'])
                                    validated_data.append(item)
                            print(f"Backend (AI Filter): AI parsed {len(validated_data)} valid items.")
                            return validated_data # Success, return result
                        else:
                             print(f"Backend (AI Filter): AI did not return a JSON list. Content: {content[:200]}...")
                             # Don't retry if structure is wrong but AI responded
                             return [] # Return empty list if format is wrong

                    except json.JSONDecodeError as json_e:
                        print(f"Backend (AI Filter): AI JSON parsing error: {json_e}. Content: {content[:200]}...")
                        # Don't retry on parsing error of AI's response
                        return None # Indicate failure
                else:
                    print("Backend (AI Filter): AI response content is empty.")
                    # Consider retrying if content is empty? For now, treat as failure.
                    # return None # Or continue to retry logic below
            else:
                print(f"Backend (AI Filter): Unexpected AI response structure: {ai_response}")
                # Consider retrying if structure is unexpected

        except requests.exceptions.Timeout:
            print(f"Backend (AI Filter): AI API timeout (Attempt {attempt + 1})")
        except requests.exceptions.RequestException as e:
            print(f"Backend (AI Filter): AI API request error (Attempt {attempt + 1}): {e}")
            if response is not None and response.status_code in [401, 403]:
                print("Backend (AI Filter): AI Auth error, stopping retries.")
                return None # Indicate failure, don't retry auth errors
            # For other request errors (like 5xx, 429), proceed to retry
        except Exception as e:
            print(f"Backend (AI Filter): Unknown error during AI processing (Attempt {attempt + 1}): {e}")

        # Retry logic: if we haven't returned a result or None (for fatal errors), wait and retry
        if attempt < AI_MAX_RETRIES - 1:
            print(f"Backend (AI Filter): Waiting {AI_RETRY_DELAY}s before retrying...")
            time.sleep(AI_RETRY_DELAY)
        else:
            print("Backend (AI Filter): AI API max retries reached.")

    return None # Indicate failure after all retries


# --- YFSP Search Function (New Method) ---
def search_yfsp_backend(query):
    search_url = YFSP_SEARCH_TEMPLATE.format(query)
    results = []
    print(f"Backend (YFSP Method): Searching YFSP for: {query} at {search_url}")
    try:
        response = requests.get(search_url, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
        response.encoding = response.apparent_encoding # 尝试自动检测编码
        soup = BeautifulSoup(response.text, 'html.parser')
        # Updated selector based on common structures (might need adjustment for specific YFSP site)
        items = soup.select('.module-items .module-item')
        if not items: # Fallback selector
             items = soup.select('.module-main .module-card-item.module-item')
        print(f"Backend (YFSP Method): Found {len(items)} result items.")

        for item in items:
            title_tag = item.select_one('.module-item-title a, .module-card-item-title a') # Try multiple title locations
            poster_link_tag = item.select_one('a.module-item-poster, a.module-card-item-poster')
            img_tag = item.select_one('.module-item-pic img.lazyload, .module-item-pic img[data-original]') # Support lazyload or data-original

            if title_tag and poster_link_tag:
                title = title_tag.get_text(strip=True)
                # Sometimes title is inside strong tag
                if not title and title_tag.select_one('strong'):
                    title = title_tag.select_one('strong').get_text(strip=True)

                detail_page_stub = poster_link_tag.get('href')
                cover_img_stub = None
                if img_tag:
                    cover_img_stub = img_tag.get('data-original') or img_tag.get('src')

                if title and detail_page_stub:
                    # Extract ID from detail page link (more reliable)
                    # Example: /voddetail/12345/ or /index.php/voddetail/12345.html etc.
                    match = re.search(r'/(\d+)[/\.]?$', detail_page_stub)
                    if match:
                        video_id = match.group(1)
                        # Resolve cover image URL
                        cover_url = None
                        if cover_img_stub:
                             cover_url = urljoin(YFSP_BASE_URL, cover_img_stub)

                        results.append({
                            "title": title,
                            "cover": cover_url or "", # Use empty string if no cover found
                            "id": video_id,
                            "base_url": YFSP_BASE_URL # Pass base URL for later use
                        })
                    else:
                         print(f"Backend (YFSP Method): Could not extract ID from detail page link: {detail_page_stub}")
            else:
                 print(f"Backend (YFSP Method): Skipping item due to missing title or link tag.")

    except requests.exceptions.Timeout: print(f"Backend (YFSP Method): Timeout searching {search_url}")
    except requests.exceptions.RequestException as e: print(f"Backend (YFSP Method): Request error searching {search_url}: {e}")
    except Exception as e: print(f"Backend (YFSP Method): Error parsing YFSP search results: {e}")

    print(f"Backend (YFSP Method): Extracted {len(results)} valid results.")
    return results


# --- NEW: AI Function to Parse Episode Player Page HTML (player_aaaa object) ---
def parse_episode_html_with_ai(html_content, ai_url, ai_key, ai_model):
    """
    Uses AI to parse the episode page HTML and extract m3u8 URLs from player_aaaa.
    Applies retry mechanism.
    """
    if not html_content: return {"error": "HTML content is empty"}
    if not all([ai_url, ai_key, ai_model]): return {"error": "AI configuration is incomplete"}

    print(f"Backend (YFSP AI Parser): Sending HTML to AI ({ai_url}, model: {ai_model}) for parsing player_aaaa.")

    prompt = f"""
请仔细分析以下提供的视频播放页面的 HTML 内容。
在 HTML 中找到定义了 `player_aaaa` JavaScript 变量的 `<script>` 代码块。这个变量被赋值为一个 JSON 对象。
请精确地解析这个 JSON 对象。
提取与键 "url" 和 "url_next" 相关联的值。

请注意处理以下情况：
- JSON 对象可能嵌套在 `<script>` 标签内。
- JSON 字符串值可能包含转义字符（例如 `\\/` 应替换为 `/`，处理 `\\uXXXX` unicode 转义）。你需要返回清理后的 URL。
- 如果 "url" 或 "url_next" 键不存在于 JSON 对象中，对应的值应返回 `null`。
- 如果在 HTML 中找不到 `player_aaaa` 对象，或者无法解析其内容为有效的 JSON，请返回 `{{ "error": "player_aaaa not found or invalid" }}`。

返回结果必须是且仅是一个 JSON 对象，包含提取的信息。有效输出示例：
`{{ "url": "https://actual.m3u8/link/...", "url_next": "https://next.m3u8/link/..." }}`
`{{ "url": "https://actual.m3u8/link/...", "url_next": null }}`
`{{ "error": "player_aaaa not found or invalid" }}`

不要在 JSON 结构之外添加任何说明或前导/尾随文本。

HTML 内容如下（可能被截断）：
--- START HTML ---
{html_content[:25000]}
--- END HTML ---

你的 JSON 输出：
""" # Truncate HTML

    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
    payload = {
        "model": ai_model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1000, # Parsing result should be small
        "temperature": AI_TEMPERATURE,
        "stream": False
    }

    for attempt in range(AI_MAX_RETRIES):
        print(f"Backend (YFSP AI Parser): AI API attempt {attempt + 1}/{AI_MAX_RETRIES}")
        response = None
        try:
            response = requests.post(ai_url, headers=headers, json=payload, timeout=60) # Shorter timeout for parsing
            response.raise_for_status()
            ai_response = response.json()

            if 'choices' in ai_response and len(ai_response['choices']) > 0:
                content = ai_response['choices'][0].get('message', {}).get('content')
                if content:
                    print("Backend (YFSP AI Parser): AI response received, parsing JSON result...")
                    try:
                        # Clean potential markdown
                        json_content = content.strip()
                        if json_content.startswith("```json"): json_content = json_content[7:]
                        if json_content.endswith("```"): json_content = json_content[:-3]
                        json_content = json_content.strip()

                        # Attempt to parse the JSON the AI returned
                        parsed_data = json.loads(json_content)

                        # Basic validation of the expected structure
                        if isinstance(parsed_data, dict) and ('url' in parsed_data or 'error' in parsed_data):
                             print(f"Backend (YFSP AI Parser): Successfully parsed AI result: {parsed_data}")
                             # Clean up potential escaped slashes in URLs if AI didn't do it
                             if 'url' in parsed_data and parsed_data['url'] and isinstance(parsed_data['url'], str):
                                 parsed_data['url'] = parsed_data['url'].replace('\\/', '/')
                             if 'url_next' in parsed_data and parsed_data['url_next'] and isinstance(parsed_data['url_next'], str):
                                  parsed_data['url_next'] = parsed_data['url_next'].replace('\\/', '/')
                             return parsed_data # Success, return result
                        else:
                             print(f"Backend (YFSP AI Parser): AI returned unexpected JSON structure: {parsed_data}")
                             # Don't retry if structure is wrong but AI responded
                             return {"error": "AI returned unexpected JSON structure"}

                    except json.JSONDecodeError as json_e:
                        print(f"Backend (YFSP AI Parser): AI JSON *result* parsing error: {json_e}. Content: {content[:200]}...")
                        # Don't retry on parsing error of AI's response
                        return {"error": f"AI JSON result parsing error: {json_e}"}
                else:
                    print("Backend (YFSP AI Parser): AI response content is empty.")
                    # Consider retrying if content is empty
            else:
                print(f"Backend (YFSP AI Parser): Unexpected AI response structure: {ai_response}")
                # Consider retrying if structure is unexpected

        except requests.exceptions.Timeout:
            print(f"Backend (YFSP AI Parser): AI API timeout (Attempt {attempt + 1})")
        except requests.exceptions.RequestException as e:
            print(f"Backend (YFSP AI Parser): AI API request error (Attempt {attempt + 1}): {e}")
            if response is not None and response.status_code in [401, 403]:
                print("Backend (YFSP AI Parser): AI Auth error, stopping retries.")
                return {"error": "AI Authentication Error"} # Indicate failure, don't retry auth errors
            # For other request errors, proceed to retry
        except Exception as e:
            print(f"Backend (YFSP AI Parser): Unknown error during AI processing (Attempt {attempt + 1}): {e}")

        # Retry logic
        if attempt < AI_MAX_RETRIES - 1:
            print(f"Backend (YFSP AI Parser): Waiting {AI_RETRY_DELAY}s before retrying...")
            time.sleep(AI_RETRY_DELAY)
        else:
            print("Backend (YFSP AI Parser): AI API max retries reached.")

    return {"error": "AI processing failed after multiple retries"} # Indicate failure after retries


# --- MODIFIED: YFSP Get Episode Details Function (Fetches Episode Page, Uses AI Parsing for player_aaaa) ---
def get_yfsp_episode_details(video_id, episode_num, base_url):
    """
    Fetches the specific episode page for YFSP, then uses AI to parse the
    player_aaaa object within its HTML to get the M3U8 link.
    """
    # Construct the episode-specific play page URL (adjust if YFSP structure differs)
    # Example: https://www.yfsp.lv/iyfplay/12345-1-1/
    episode_page_url = YFSP_PLAY_TEMPLATE.format(video_id, episode_num)
    print(f"Backend (YFSP Method): Fetching episode page HTML from {episode_page_url}")
    try:
        response = requests.get(episode_page_url, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
        response.encoding = response.apparent_encoding # Ensure correct encoding
        html_content = response.text

        # Basic check for valid HTML content
        if not html_content or len(html_content) < 500:
             print(f"Backend (YFSP Method): HTML content from {episode_page_url} seems empty or too small.")
             return None # Indicate failure

        # --- Call AI to parse the HTML for player_aaaa ---
        # Use default backend AI settings defined at the top of this file
        ai_result = parse_episode_html_with_ai(
            html_content,
            DEFAULT_AI_API_URL,
            DEFAULT_AI_API_KEY,
            DEFAULT_AI_MODEL
        )

        # --- Process AI Result ---
        if not ai_result or 'error' in ai_result:
            error_msg = ai_result.get('error', 'Unknown AI parsing error') if ai_result else 'AI parsing failed'
            print(f"Backend (YFSP Method): AI failed to parse episode HTML for player_aaaa: {error_msg}")
            return None # Indicate failure

        m3u8_url = ai_result.get('url')

        if not m3u8_url:
             print(f"Backend (YFSP Method): AI did not return a 'url' key or it was null/empty.")
             return None # Indicate failure

        # Construct the final player link using the M3U8 URL returned by AI
        # Check if the M3U8 URL is relative, if so, make it absolute (unlikely based on prompt but good practice)
        if not m3u8_url.startswith('http'):
            print(f"Backend (YFSP Method): Warning - AI returned a relative M3U8 URL: {m3u8_url}. Attempting to resolve.")
            # This might need a proper base URL from the *episode page* if different
            m3u8_url = urljoin(episode_page_url, m3u8_url)

        final_player_url = YFSP_FINAL_PLAYER_TEMPLATE.format(m3u8_url)
        print(f"Backend (YFSP Method): AI extracted M3U8 URL: {m3u8_url}")
        print(f"Backend (YFSP Method): Constructed final player URL: {final_player_url}")
        return final_player_url

    except requests.exceptions.Timeout:
        print(f"Backend (YFSP Method): Timeout fetching episode page {episode_page_url}")
        return None
    except requests.exceptions.RequestException as e:
        if e.response is not None and e.response.status_code == 404:
             print(f"Backend (YFSP Method): Episode page not found (404): {episode_page_url}")
        else:
             print(f"Backend (YFSP Method): Request error fetching episode page {episode_page_url}: {e}")
        return None
    except Exception as e:
        print(f"Backend (YFSP Method): Error processing episode page {episode_page_url}: {e}")
        return None


# --- API Endpoints ---

@app.route('/api/search', methods=['POST'])
def handle_search():
    data = request.json
    query = data.get('query')
    method = data.get('method', 'ai')
    settings = data.get('settings', {})

    if not query:
        return jsonify({"error": "Query parameter is required"}), 400

    if method == 'yfsp':
        print(f"Backend: Received YFSP search request for '{query}'")
        results = search_yfsp_backend(query)
        # Add method indicator for frontend logic
        for r in results: r['method'] = 'yfsp'
        return jsonify(results)

    elif method == 'ai':
        print(f"Backend: Received AI search request for '{query}'")
        searxng_url = settings.get('searxngUrl') or DEFAULT_SEARXNG_URL
        # For AI filtering, use user-provided or default backend key/url/model
        ai_url = settings.get('aiApiUrl') or DEFAULT_AI_API_URL
        ai_key = settings.get('aiApiKey') or DEFAULT_AI_API_KEY
        ai_model = settings.get('aiModel') or DEFAULT_AI_MODEL

        # *** Crucial Security/Config Check ***
        if not ai_key or "PLACEHOLDER" in ai_key or "YOUR_FALLBACK_OR_PLACEHOLDER_KEY" in ai_key:
             print("Backend Error: AI API Key is missing or is a placeholder. Check Vercel Env Vars and user settings.")
             # Return a user-friendly error, but log the specific issue
             return jsonify({"error": "AI 服务未正确配置 (API Key missing or invalid). 请检查应用设置或联系管理员。"}), 500
        if not ai_url: return jsonify({"error": "AI 服务未正确配置 (API URL missing)."}), 500
        if not ai_model: return jsonify({"error": "AI 服务未正确配置 (Model missing)."}), 500
        if not searxng_url: return jsonify({"error": "搜索引擎未正确配置 (SearXNG URL missing)."}), 500

        raw_results = search_searxng_backend(query, searxng_url)
        if not raw_results:
            print("Backend (AI Method): No results from SearXNG.")
            return jsonify([]) # Return empty list, not an error

        # Use the determined AI config for filtering
        filtered_results = filter_links_with_ai_backend(raw_results, ai_url, ai_key, ai_model)

        if filtered_results is None:
            # This means AI filtering failed after retries
            return jsonify({"error": "AI 分析搜索结果失败，请稍后重试。"}), 500
        else:
             # Add method indicator
             for r in filtered_results: r['method'] = 'ai'
             return jsonify(filtered_results)

    else:
        return jsonify({"error": "Invalid search method specified"}), 400


# --- NEW API Endpoint: Get YFSP Episode List ---
@app.route('/api/get_yfsp_episode_list', methods=['POST'])
def get_yfsp_episode_list():
    data = request.json
    video_id = data.get('id')
    base_url = data.get('base_url') # Base URL provided by frontend

    if not video_id or not base_url:
        return jsonify({"error": "Missing 'id' or 'base_url'"}), 400

    detail_page_url = YFSP_DETAIL_TEMPLATE.format(video_id)
    print(f"Backend (YFSP Episode List): Fetching detail page from {detail_page_url}")
    episodes = []

    try:
        response = requests.get(detail_page_url, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
        response.encoding = response.apparent_encoding
        soup = BeautifulSoup(response.text, 'html.parser')

        # Find the episode list container (adjust selector based on actual YFSP site)
        # Common selectors: '.module-play-list .module-play-list-content a', '.module-list .module-play-list-content a'
        # Need to inspect the target website's HTML structure
        episode_links = soup.select('.module-play-list-content a') # Primary selector
        if not episode_links: # Fallback selector
            episode_links = soup.select('.module-playerlist .scroll-content__list a')
        if not episode_links: # Another fallback
             episode_links = soup.select('#playlist a') # Generic fallback

        print(f"Backend (YFSP Episode List): Found {len(episode_links)} potential episode links.")

        if not episode_links:
             return jsonify({"error": f"在详情页 {detail_page_url} 未找到剧集列表容器，请检查网站结构或选择器。"}), 404


        for link in episode_links:
            href = link.get('href')
            # Try to get episode number from link text or title
            ep_num_text = link.get_text(strip=True)
            ep_title_text = link.get('title', '').strip()

            if href:
                # Extract episode number using regex from href or text/title
                # Example href: /iyfplay/12345-1-5/
                match_href = re.search(r'-(\d+)/?$', href)
                # Example text/title: "第5集", "5", "高清5"
                match_text = re.search(r'(\d+)', ep_num_text)
                match_title = re.search(r'(\d+)', ep_title_text)

                ep_num = None
                if match_href:
                    ep_num = match_href.group(1)
                elif match_text:
                    ep_num = match_text.group(1)
                elif match_title:
                    ep_num = match_title.group(1)
                else:
                     # If no number found, maybe use the text itself if simple (like just "5")
                     if ep_num_text.isdigit():
                         ep_num = ep_num_text
                     else: # Last resort: skip if cannot determine number
                         print(f"Backend (YFSP Episode List): Skipping link, cannot determine episode number: href='{href}', text='{ep_num_text}', title='{ep_title_text}'")
                         continue # Skip this link

                # Simple validation: Check if ep_num is reasonable (e.g., avoid huge numbers)
                try:
                    if 0 < int(ep_num) < 5000: # Assume max 5000 episodes
                        episodes.append({
                            "num": ep_num,
                            # We don't need the full href, just the number for the next step
                            # "href": urljoin(base_url, href) # Store full URL if needed later
                        })
                    else:
                        print(f"Backend (YFSP Episode List): Skipping link, episode number out of range: {ep_num}")
                except ValueError:
                    print(f"Backend (YFSP Episode List): Skipping link, invalid episode number format: {ep_num}")


        if not episodes:
             print(f"Backend (YFSP Episode List): No valid episode numbers extracted from found links.")
             # Don't return error 404 here, maybe it's a movie (no episodes) or parsing failed
             # Frontend should handle empty list gracefully

        # Sort episodes numerically (important if parsing order isn't guaranteed)
        episodes.sort(key=lambda x: int(x['num']))

        print(f"Backend (YFSP Episode List): Extracted {len(episodes)} episodes.")
        return jsonify(episodes)

    except requests.exceptions.Timeout:
        print(f"Backend (YFSP Episode List): Timeout fetching detail page {detail_page_url}")
        return jsonify({"error": "获取剧集列表超时"}), 504
    except requests.exceptions.RequestException as e:
        print(f"Backend (YFSP Episode List): Request error fetching detail page {detail_page_url}: {e}")
        status_code = e.response.status_code if e.response else 500
        return jsonify({"error": f"获取剧集列表失败 (HTTP {status_code})"}), status_code
    except Exception as e:
        print(f"Backend (YFSP Episode List): Error parsing detail page {detail_page_url}: {e}")
        return jsonify({"error": f"解析剧集列表时发生错误: {e}"}), 500


@app.route('/api/get_episode_details', methods=['POST'])
def handle_get_episode_details():
    data = request.json
    video_id = data.get('id')
    # Ensure episode_num is treated as string if needed by templates, but usually int is fine for logic
    episode_num = str(data.get('episode', '1')) # Default to episode '1' as string
    base_url = data.get('base_url')

    if not video_id or not base_url:
        return jsonify({"error": "Missing 'id' or 'base_url'"}), 400
    if not episode_num:
        return jsonify({"error": "Missing 'episode' number"}), 400


    print(f"Backend: Received request for YFSP episode details: id={video_id}, ep={episode_num}, base={base_url}")

    # This function fetches the episode page and uses AI to get the M3U8 link
    final_player_url = get_yfsp_episode_details(video_id, episode_num, base_url)

    if final_player_url:
        return jsonify({"player_url": final_player_url})
    else:
        # Error message comes from get_yfsp_episode_details logs, provide generic failure message
        return jsonify({"error": f"无法获取或解析剧集 {episode_num} 的播放信息"}), 500


@app.route('/api/config', methods=['GET'])
def get_config():
    try:
        default_interfaces = json.loads(DEFAULT_PARSING_INTERFACES_JSON)
    except json.JSONDecodeError:
        print("Backend: ERROR decoding DEFAULT_PARSING_INTERFACES JSON from environment variable.")
        default_interfaces = [] # Fallback to empty list

    config_data = {
        "defaultParsingInterfaces": default_interfaces,
        "defaultSearxngUrl": DEFAULT_SEARXNG_URL,
        # DO NOT send default AI URL/Key/Model to frontend
    }
    return jsonify(config_data)

# --- Serve Frontend ---
@app.route('/')
def serve_index():
    # Use safe_join to prevent directory traversal
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    # More robust static file serving
    # Check if the path is safe and exists within the static folder
    safe_path = os.path.normpath(path).lstrip('/')
    full_path = os.path.join(app.static_folder, safe_path)

    # Prevent directory traversal attacks
    if not full_path.startswith(os.path.abspath(app.static_folder)):
        return "Forbidden", 403

    # Serve the file if it exists and is a file
    if os.path.exists(full_path) and os.path.isfile(full_path):
        return send_from_directory(app.static_folder, safe_path)
    else:
        # Handle potential 404s or maybe serve index.html for SPA routing
        # For now, just return 404 if file not found
        return "Not Found", 404


# Vercel needs the 'app' variable, no need for `if __name__ == '__main__':`
# app.run(...) should not be present for Vercel deployment.
