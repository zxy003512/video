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
AI_RETRY_DELAY = 5 # seconds

# --- Constants for YFSP ---
YFSP_BASE_URL = "https://www.yfsp.lv"
YFSP_SEARCH_TEMPLATE = "https://www.yfsp.lv/s/-------------/?wd={}"
YFSP_FINAL_PLAYER_TEMPLATE = "https://b.212133.xyz/player/ec.php?code=qw&if=1&url={}"
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

# (English AI Prompt - AI_PROMPT_EN - remains the same, not shown for brevity)

def filter_links_with_ai_backend(results_list, ai_url, ai_key, ai_model):
    # (Function remains largely the same, ensure it uses the correct prompt and parses the response)
    # ... (Previous implementation of filter_links_with_ai_backend) ...
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
                        if json_content.startswith("```json"): json_content = json_content[7:]
                        if json_content.endswith("```"): json_content = json_content[:-3]
                        json_content = json_content.strip()

                        parsed_data = json.loads(json_content)
                        if isinstance(parsed_data, list):
                            validated_data = []
                            for item in parsed_data:
                                if isinstance(item, dict) and 'title' in item and 'video_link' in item:
                                    if 'website' not in item or not item['website']:
                                         item['website'] = get_domain(item['video_link'])
                                    validated_data.append(item)
                            print(f"Backend (AI Filter): AI parsed {len(validated_data)} valid items.")
                            return validated_data
                        else:
                             print(f"Backend (AI Filter): AI did not return a JSON list. Content: {content[:200]}...")
                             return [] # Return empty list if format is wrong

                    except json.JSONDecodeError as json_e:
                        print(f"Backend (AI Filter): AI JSON parsing error: {json_e}. Content: {content[:200]}...")
                        # Don't retry on parsing error
                        return None # Indicate failure
                else: print("Backend (AI Filter): AI response content is empty.")
            else: print(f"Backend (AI Filter): Unexpected AI response structure: {ai_response}")

        except requests.exceptions.Timeout: print(f"Backend (AI Filter): AI API timeout (Attempt {attempt + 1})")
        except requests.exceptions.RequestException as e:
            print(f"Backend (AI Filter): AI API request error (Attempt {attempt + 1}): {e}")
            if response is not None and response.status_code in [401, 403]:
                print("Backend (AI Filter): AI Auth error, stopping retries.")
                return None # Indicate failure
        except Exception as e: print(f"Backend (AI Filter): Unknown error during AI processing: {e}")

        if attempt < AI_MAX_RETRIES - 1: time.sleep(AI_RETRY_DELAY)
        else: print("Backend (AI Filter): AI API max retries reached.")

    return None # Indicate failure after retries


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
        items = soup.select('.module-main .module-card-item.module-item')
        print(f"Backend (YFSP Method): Found {len(items)} result items.")

        for item in items:
            title_tag = item.select_one('.module-card-item-title a strong')
            poster_link_tag = item.select_one('a.module-card-item-poster')
            img_tag = item.select_one('.module-item-pic img.lazyload')

            if title_tag and poster_link_tag and img_tag:
                title = title_tag.get_text(strip=True)
                detail_page_stub = poster_link_tag.get('href')
                cover_img_stub = img_tag.get('data-original')

                if title and detail_page_stub and cover_img_stub:
                    match = re.search(r'/(\d+)/?$', detail_page_stub)
                    if match:
                        video_id = match.group(1)
                        results.append({
                            "title": title,
                            "cover": urljoin(YFSP_BASE_URL, cover_img_stub),
                            "id": video_id,
                            "base_url": YFSP_BASE_URL
                        })
                    else:
                         print(f"Backend (YFSP Method): Could not extract ID from {detail_page_stub}")
            else:
                 print(f"Backend (YFSP Method): Skipping item due to missing title, link, or image.")

    except requests.exceptions.Timeout: print(f"Backend (YFSP Method): Timeout searching {search_url}")
    except requests.exceptions.RequestException as e: print(f"Backend (YFSP Method): Request error searching {search_url}: {e}")
    except Exception as e: print(f"Backend (YFSP Method): Error parsing YFSP search results: {e}")

    print(f"Backend (YFSP Method): Extracted {len(results)} valid results.")
    return results

# --- NEW: AI Function to Parse Episode HTML ---
def parse_episode_html_with_ai(html_content, ai_url, ai_key, ai_model):
    """
    Uses AI to parse the episode page HTML and extract m3u8 URLs.
    Args:
        html_content (str): The full HTML content of the episode page.
        ai_url (str): AI API endpoint URL.
        ai_key (str): AI API key.
        ai_model (str): AI model name.
    Returns:
        dict: A dictionary containing 'url' and 'url_next' or an 'error' key.
              Example: {"url": "...", "url_next": "..."} or {"error": "message"}
    """
    if not html_content:
        return {"error": "HTML content is empty"}
    if not all([ai_url, ai_key, ai_model]):
         return {"error": "AI configuration is incomplete"}

    print(f"Backend (YFSP AI Parser): Sending HTML to AI ({ai_url}, model: {ai_model}) for parsing.")

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

HTML 内容如下：
--- START HTML ---
{html_content[:25000]} 
--- END HTML ---

你的 JSON 输出：
""" # Truncate HTML to avoid exceeding token limits easily

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
                             if 'url' in parsed_data and parsed_data['url']:
                                 parsed_data['url'] = parsed_data['url'].replace('\\/', '/')
                             if 'url_next' in parsed_data and parsed_data['url_next']:
                                  parsed_data['url_next'] = parsed_data['url_next'].replace('\\/', '/')
                             return parsed_data
                        else:
                             print(f"Backend (YFSP AI Parser): AI returned unexpected JSON structure: {parsed_data}")
                             return {"error": "AI returned unexpected JSON structure"}

                    except json.JSONDecodeError as json_e:
                        print(f"Backend (YFSP AI Parser): AI JSON *result* parsing error: {json_e}. Content: {content[:200]}...")
                        # Don't retry on parsing error of AI's response
                        return {"error": f"AI JSON result parsing error: {json_e}"}
                else: print("Backend (YFSP AI Parser): AI response content is empty.")
            else: print(f"Backend (YFSP AI Parser): Unexpected AI response structure: {ai_response}")

        except requests.exceptions.Timeout: print(f"Backend (YFSP AI Parser): AI API timeout (Attempt {attempt + 1})")
        except requests.exceptions.RequestException as e:
            print(f"Backend (YFSP AI Parser): AI API request error (Attempt {attempt + 1}): {e}")
            if response is not None and response.status_code in [401, 403]:
                print("Backend (YFSP AI Parser): AI Auth error, stopping retries.")
                return {"error": "AI Authentication Error"} # Indicate failure
        except Exception as e: print(f"Backend (YFSP AI Parser): Unknown error during AI processing: {e}")

        if attempt < AI_MAX_RETRIES - 1: time.sleep(AI_RETRY_DELAY)
        else: print("Backend (YFSP AI Parser): AI API max retries reached.")

    return {"error": "AI processing failed after multiple retries"} # Indicate failure after retries


# --- MODIFIED: YFSP Get Episode Details Function (Uses AI Parsing) ---
def get_yfsp_episode_details(video_id, episode_num, base_url):
    episode_page_url = f"{base_url}/iyfplay/{video_id}-1-{episode_num}/"
    print(f"Backend (YFSP Method): Fetching episode page HTML from {episode_page_url}")
    try:
        response = requests.get(episode_page_url, headers=REQUEST_HEADERS, timeout=20) # Increased timeout for page load
        response.raise_for_status()
        response.encoding = response.apparent_encoding # Ensure correct encoding
        html_content = response.text

        # Check if HTML content was retrieved
        if not html_content or len(html_content) < 500: # Basic check for empty or very small response
             print(f"Backend (YFSP Method): HTML content from {episode_page_url} seems empty or too small.")
             return None

        # --- Call AI to parse the HTML ---
        # Use default backend AI settings, NOT user-provided ones from settings modal
        ai_result = parse_episode_html_with_ai(
            html_content,
            DEFAULT_AI_API_URL,
            DEFAULT_AI_API_KEY,
            DEFAULT_AI_MODEL
        )

        # --- Process AI Result ---
        if not ai_result or 'error' in ai_result:
            error_msg = ai_result.get('error', 'Unknown AI parsing error') if ai_result else 'AI parsing failed'
            print(f"Backend (YFSP Method): AI failed to parse episode HTML: {error_msg}")
            return None # Indicate failure

        m3u8_url = ai_result.get('url')

        if not m3u8_url:
             print(f"Backend (YFSP Method): AI did not return a 'url' key or it was null.")
             return None

        # Construct the final player link using the URL returned by AI
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
        # Add method indicator
        for r in results: r['method'] = 'yfsp'
        return jsonify(results)

    elif method == 'ai':
        print(f"Backend: Received AI search request for '{query}'")
        searxng_url = settings.get('searxngUrl') or DEFAULT_SEARXNG_URL
        # For AI filtering, use user-provided or default backend key
        ai_url = settings.get('aiApiUrl') or DEFAULT_AI_API_URL
        ai_key = settings.get('aiApiKey') or DEFAULT_AI_API_KEY
        ai_model = settings.get('aiModel') or DEFAULT_AI_MODEL

        # *** Crucial Security/Config Check ***
        # Check if *any* key is available (either user-provided or backend default)
        effective_ai_key = settings.get('aiApiKey') if settings.get('aiApiKey') else DEFAULT_AI_API_KEY
        if not effective_ai_key or "PLACEHOLDER" in effective_ai_key or "YOUR_FALLBACK_OR_PLACEHOLDER_KEY" in effective_ai_key:
             print("Backend Error: AI API Key is missing or is a placeholder. Check Vercel Env Vars and user settings.")
             return jsonify({"error": "AI API Key is not configured or provided properly."}), 500
        # Use the determined key for the call
        ai_key_to_use = effective_ai_key

        if not ai_url: return jsonify({"error": "AI API URL is not configured."}), 500
        if not ai_model: return jsonify({"error": "AI Model is not configured."}), 500
        if not searxng_url: return jsonify({"error": "SearXNG URL is not configured."}), 500

        raw_results = search_searxng_backend(query, searxng_url)
        if not raw_results:
            print("Backend (AI Method): No results from SearXNG.")
            return jsonify([])

        # Use the key determined above
        filtered_results = filter_links_with_ai_backend(raw_results, ai_url, ai_key_to_use, ai_model)

        if filtered_results is None:
            return jsonify({"error": "AI processing failed after multiple retries."}), 500
        else:
             for r in filtered_results: r['method'] = 'ai'
             return jsonify(filtered_results)

    else:
        return jsonify({"error": "Invalid search method specified"}), 400


@app.route('/api/get_episode_details', methods=['POST'])
def handle_get_episode_details():
    data = request.json
    video_id = data.get('id')
    episode_num = data.get('episode', 1)
    base_url = data.get('base_url')

    if not video_id or not base_url:
        return jsonify({"error": "Missing 'id' or 'base_url'"}), 400

    print(f"Backend: Received request for YFSP episode details: id={video_id}, ep={episode_num}, base={base_url}")

    # This function now uses AI with backend's default credentials internally
    final_player_url = get_yfsp_episode_details(video_id, episode_num, base_url)

    if final_player_url:
        return jsonify({"player_url": final_player_url})
    else:
        # Give a slightly more specific error based on the new logic
        return jsonify({"error": f"无法通过 AI 解析获取剧集 {episode_num} 的播放信息"}), 500


@app.route('/api/config', methods=['GET'])
def get_config():
    try:
        default_interfaces = json.loads(DEFAULT_PARSING_INTERFACES_JSON)
    except json.JSONDecodeError:
        print("Backend: ERROR decoding DEFAULT_PARSING_INTERFACES JSON from environment variable.")
        default_interfaces = []

    config_data = {
        "defaultParsingInterfaces": default_interfaces,
        "defaultSearxngUrl": DEFAULT_SEARXNG_URL,
        # Still DO NOT send default AI URL/Key/Model here
    }
    return jsonify(config_data)

# --- Serve Frontend ---
@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
     # Allow serving files also from subdirectories like 'static' if needed
    return send_from_directory(app.static_folder, path)

# Vercel needs the 'app' variable
# No need for if __name__ == '__main__': app.run(...) for Vercel
