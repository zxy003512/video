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
AI_MAX_RETRIES = 3      # Max retries for AI calls
AI_RETRY_DELAY = 1      # Delay between retries in seconds

# --- Constants for YFSP ---
YFSP_BASE_URL = "https://www.yfsp.lv" # Keep this updated if the domain changes
YFSP_SEARCH_TEMPLATE = f"{YFSP_BASE_URL}/s/-------------/?wd={{}}"
YFSP_DETAIL_TEMPLATE = f"{YFSP_BASE_URL}/voddetail/{{}}/" # Detail page URL format
YFSP_PLAY_TEMPLATE = f"{YFSP_BASE_URL}/iyfplay/{{}}-1-{{}}/" # Play page URL format (videoId, episodeNum)
YFSP_FINAL_PLAYER_TEMPLATE = "https://b.212133.xyz/player/ec.php?code=qw&if=1&url={}" # Final player URL template
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
            response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
            ai_response = response.json()

            if 'choices' in ai_response and len(ai_response['choices']) > 0:
                content = ai_response['choices'][0].get('message', {}).get('content')
                if content:
                    print("Backend (AI Filter): AI response received, parsing JSON...")
                    try:
                        # Clean potential markdown and extra whitespace
                        json_content = content.strip()
                        if json_content.startswith("```json"): json_content = json_content[7:]
                        if json_content.endswith("```"): json_content = json_content[:-3]
                        json_content = json_content.strip()

                        parsed_data = json.loads(json_content)
                        if isinstance(parsed_data, list):
                            validated_data = []
                            for item in parsed_data:
                                if isinstance(item, dict) and 'title' in item and 'video_link' in item:
                                    # Ensure website is present, derive if missing
                                    if 'website' not in item or not item['website']:
                                        item['website'] = get_domain(item['video_link'])
                                    validated_data.append(item)
                            print(f"Backend (AI Filter): AI parsed {len(validated_data)} valid items.")
                            return validated_data # Success
                        else:
                            print(f"Backend (AI Filter): AI did not return a JSON list. Content: {content[:200]}...")
                            # Treat non-list JSON as an error, but don't retry parsing errors
                            return None # Indicate failure

                    except json.JSONDecodeError as json_e:
                        print(f"Backend (AI Filter): AI JSON parsing error: {json_e}. Content: {content[:200]}...")
                        # Don't retry on parsing error of AI's response
                        return None # Indicate failure
                else:
                    print("Backend (AI Filter): AI response content is empty.")
                    # Consider empty content a failure, maybe retry? For now, fail.
            else:
                print(f"Backend (AI Filter): Unexpected AI response structure: {ai_response}")
                # Treat unexpected structure as failure, maybe retry? For now, fail.

        except requests.exceptions.Timeout:
            print(f"Backend (AI Filter): AI API timeout (Attempt {attempt + 1}/{AI_MAX_RETRIES})")
            # Let it retry
        except requests.exceptions.RequestException as e:
            print(f"Backend (AI Filter): AI API request error (Attempt {attempt + 1}/{AI_MAX_RETRIES}): {e}")
            # Check for specific non-retryable HTTP errors
            if response is not None and response.status_code in [401, 403]:
                print("Backend (AI Filter): AI Auth error (401/403), stopping retries.")
                return None # Indicate auth failure, don't retry
            elif response is not None and 400 <= response.status_code < 500:
                 print(f"Backend (AI Filter): AI Client error ({response.status_code}), stopping retries.")
                 return None # Indicate other client error, don't retry
            # Otherwise, server errors (5xx) or connection errors might be temporary, so allow retry
        except Exception as e:
            print(f"Backend (AI Filter): Unknown error during AI processing (Attempt {attempt + 1}/{AI_MAX_RETRIES}): {e}")
            # Allow retry for unknown errors

        # If this attempt failed and more retries are left, wait and continue
        if attempt < AI_MAX_RETRIES - 1:
            print(f"Backend (AI Filter): Retrying in {AI_RETRY_DELAY} seconds...")
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
        # Refined selector to target items within the main content area more precisely
        items = soup.select('.module-items .module-card-item.module-item')
        print(f"Backend (YFSP Method): Found {len(items)} result items using selector '.module-items .module-card-item.module-item'.")

        if not items: # Fallback selector if the first one fails
             items = soup.select('.module-main .module-card-item.module-item')
             print(f"Backend (YFSP Method): Fallback selector '.module-main .module-card-item.module-item' found {len(items)} items.")


        for item in items:
            title_tag = item.select_one('.module-card-item-title a strong')
            poster_link_tag = item.select_one('a.module-card-item-poster')
            img_tag = item.select_one('.module-item-pic img.lazyload')
            desc_tags = item.select('.module-card-item-info .module-info-item-content') # Get description items

            if title_tag and poster_link_tag and img_tag:
                title = title_tag.get_text(strip=True)
                detail_page_stub = poster_link_tag.get('href')
                # Prefer data-original for lazy loaded images, fallback to src
                cover_img_stub = img_tag.get('data-original') or img_tag.get('src')

                description_parts = [tag.get_text(strip=True) for tag in desc_tags]
                description = ' / '.join(filter(None, description_parts)) # Join non-empty parts

                if title and detail_page_stub and cover_img_stub:
                    # Extract ID more reliably from the detail page stub
                    match = re.search(r'/voddetail/(\d+)/?$', detail_page_stub)
                    if match:
                        video_id = match.group(1)
                        full_cover_url = urljoin(YFSP_BASE_URL, cover_img_stub)
                        # Ensure cover URL starts with http or https
                        if not full_cover_url.startswith(('http://', 'https://')):
                            print(f"Backend (YFSP Method): Fixing cover URL scheme for {full_cover_url}")
                            full_cover_url = urljoin(YFSP_BASE_URL, full_cover_url) # Ensure base is added if relative

                        results.append({
                            "title": title,
                            "cover": full_cover_url,
                            "id": video_id,
                            "description": description, # Add description
                            "base_url": YFSP_BASE_URL # Pass base URL for constructing detail/play links later
                        })
                    else:
                        print(f"Backend (YFSP Method): Could not extract video ID from detail stub {detail_page_stub}")
                else:
                    print(f"Backend (YFSP Method): Skipping item due to missing title ({title}), detail link ({detail_page_stub}), or cover ({cover_img_stub}).")
            else:
                print(f"Backend (YFSP Method): Skipping item due to missing primary tags (title_tag: {bool(title_tag)}, poster_link_tag: {bool(poster_link_tag)}, img_tag: {bool(img_tag)}).")

    except requests.exceptions.Timeout:
        print(f"Backend (YFSP Method): Timeout searching {search_url}")
    except requests.exceptions.RequestException as e:
        print(f"Backend (YFSP Method): Request error searching {search_url}: {e}")
    except Exception as e:
        print(f"Backend (YFSP Method): Error parsing YFSP search results: {e}")

    print(f"Backend (YFSP Method): Extracted {len(results)} valid results.")
    return results


# --- YFSP Function to Parse Episode HTML using AI ---
def parse_episode_html_with_ai(html_content, ai_url, ai_key, ai_model):
    """
    Uses AI to parse the episode *player page* HTML and extract m3u8 URLs from player_aaaa.
    Args:
        html_content (str): The full HTML content of the episode player page.
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

    print(f"Backend (YFSP Player AI Parser): Sending HTML to AI ({ai_url}, model: {ai_model}) for parsing player_aaaa.")

    # The prompt remains focused on extracting player_aaaa from the PLAYER page HTML
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
        print(f"Backend (YFSP Player AI Parser): AI API attempt {attempt + 1}/{AI_MAX_RETRIES}")
        response = None
        try:
            response = requests.post(ai_url, headers=headers, json=payload, timeout=60) # Shorter timeout for parsing
            response.raise_for_status()
            ai_response = response.json()

            if 'choices' in ai_response and len(ai_response['choices']) > 0:
                content = ai_response['choices'][0].get('message', {}).get('content')
                if content:
                    print("Backend (YFSP Player AI Parser): AI response received, parsing JSON result...")
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
                            print(f"Backend (YFSP Player AI Parser): Successfully parsed AI result: {parsed_data}")
                            # Clean up potential escaped slashes in URLs if AI didn't do it
                            if 'url' in parsed_data and parsed_data['url']:
                                parsed_data['url'] = parsed_data['url'].replace('\\/', '/')
                            if 'url_next' in parsed_data and parsed_data['url_next']:
                                parsed_data['url_next'] = parsed_data['url_next'].replace('\\/', '/')
                            return parsed_data # Success
                        else:
                            print(f"Backend (YFSP Player AI Parser): AI returned unexpected JSON structure: {parsed_data}")
                            # Don't retry structural errors from AI
                            return {"error": "AI returned unexpected JSON structure"}

                    except json.JSONDecodeError as json_e:
                        print(f"Backend (YFSP Player AI Parser): AI JSON *result* parsing error: {json_e}. Content: {content[:200]}...")
                        # Don't retry on parsing error of AI's response
                        return {"error": f"AI JSON result parsing error: {json_e}"}
                else:
                    print("Backend (YFSP Player AI Parser): AI response content is empty.")
                    # Maybe retry if content is empty? For now, fail.
            else:
                print(f"Backend (YFSP Player AI Parser): Unexpected AI response structure: {ai_response}")
                # Maybe retry? For now, fail.

        except requests.exceptions.Timeout:
            print(f"Backend (YFSP Player AI Parser): AI API timeout (Attempt {attempt + 1}/{AI_MAX_RETRIES})")
            # Allow retry
        except requests.exceptions.RequestException as e:
            print(f"Backend (YFSP Player AI Parser): AI API request error (Attempt {attempt + 1}/{AI_MAX_RETRIES}): {e}")
            if response is not None and response.status_code in [401, 403]:
                print("Backend (YFSP Player AI Parser): AI Auth error (401/403), stopping retries.")
                return {"error": "AI Authentication Error"} # Indicate auth failure
            elif response is not None and 400 <= response.status_code < 500:
                 print(f"Backend (YFSP Player AI Parser): AI Client error ({response.status_code}), stopping retries.")
                 return {"error": f"AI Client Error: {response.status_code}"}
            # Allow retry for other request errors (like 5xx or connection issues)
        except Exception as e:
            print(f"Backend (YFSP Player AI Parser): Unknown error during AI processing (Attempt {attempt + 1}/{AI_MAX_RETRIES}): {e}")
            # Allow retry for unknown errors

        if attempt < AI_MAX_RETRIES - 1:
            print(f"Backend (YFSP Player AI Parser): Retrying in {AI_RETRY_DELAY} seconds...")
            time.sleep(AI_RETRY_DELAY)
        else:
            print("Backend (YFSP Player AI Parser): AI API max retries reached.")

    return {"error": "AI processing failed after multiple retries"} # Indicate failure after retries


# --- MODIFIED: YFSP Get Episode Details Function (Fetches Player Page, Uses AI Parsing) ---
def get_yfsp_episode_details(video_id, episode_num, base_url):
    """Fetches the PLAYER page for a specific episode and uses AI to parse it."""
    # Construct the correct player page URL based on the template
    episode_page_url = YFSP_PLAY_TEMPLATE.format(video_id, episode_num)
    print(f"Backend (YFSP Method): Fetching episode PLAYER page HTML from {episode_page_url}")

    try:
        response = requests.get(episode_page_url, headers=REQUEST_HEADERS, timeout=25) # Slightly longer timeout
        response.raise_for_status()
        response.encoding = response.apparent_encoding # Ensure correct encoding
        html_content = response.text

        if not html_content or len(html_content) < 500: # Basic check
            print(f"Backend (YFSP Method): HTML content from {episode_page_url} seems empty or too small.")
            return None, f"无法从 {episode_page_url} 获取有效的页面内容"

        # --- Call AI to parse the PLAYER page HTML ---
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
            print(f"Backend (YFSP Method): AI failed to parse episode player HTML: {error_msg}")
            return None, f"AI 解析播放页失败: {error_msg}"

        m3u8_url = ai_result.get('url')

        if not m3u8_url:
            print(f"Backend (YFSP Method): AI did not return a 'url' key or it was null from player page.")
            return None, f"AI 未能在播放页找到 'url' 链接"

        # Construct the final player link using the URL returned by AI
        final_player_url = YFSP_FINAL_PLAYER_TEMPLATE.format(m3u8_url)
        print(f"Backend (YFSP Method): AI extracted M3U8 URL: {m3u8_url}")
        print(f"Backend (YFSP Method): Constructed final player URL: {final_player_url}")
        return final_player_url, None # Return URL and no error

    except requests.exceptions.Timeout:
        print(f"Backend (YFSP Method): Timeout fetching episode player page {episode_page_url}")
        return None, f"请求播放页超时: {episode_page_url}"
    except requests.exceptions.RequestException as e:
        error_detail = f"HTTP Status: {e.response.status_code}" if e.response else str(e)
        if e.response is not None and e.response.status_code == 404:
            print(f"Backend (YFSP Method): Episode player page not found (404): {episode_page_url}")
            return None, f"播放页未找到 (404): {episode_page_url}"
        else:
            print(f"Backend (YFSP Method): Request error fetching episode player page {episode_page_url}: {error_detail}")
            return None, f"请求播放页错误: {error_detail}"
    except Exception as e:
        print(f"Backend (YFSP Method): Error processing episode player page {episode_page_url}: {e}")
        return None, f"处理播放页时发生未知错误: {e}"

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
        ai_url = settings.get('aiApiUrl') or DEFAULT_AI_API_URL
        ai_key = settings.get('aiApiKey') or DEFAULT_AI_API_KEY # User setting takes precedence
        ai_model = settings.get('aiModel') or DEFAULT_AI_MODEL

        # *** Crucial Security/Config Check ***
        if not ai_key or "PLACEHOLDER" in ai_key or "YOUR_FALLBACK_OR_PLACEHOLDER_KEY" in ai_key:
             print("Backend Error: AI API Key is missing or is a placeholder. Check Vercel Env Vars and user settings.")
             # Only return error if AI method is explicitly chosen and key is bad
             return jsonify({"error": "AI API Key is not configured or provided properly. Please check settings or backend environment variables."}), 500

        if not ai_url: return jsonify({"error": "AI API URL is not configured."}), 500
        if not ai_model: return jsonify({"error": "AI Model is not configured."}), 500
        if not searxng_url: return jsonify({"error": "SearXNG URL is not configured."}), 500

        raw_results = search_searxng_backend(query, searxng_url)
        if not raw_results:
            print("Backend (AI Method): No results from SearXNG.")
            return jsonify([]) # Return empty list, not an error

        # Use the key determined above
        filtered_results = filter_links_with_ai_backend(raw_results, ai_url, ai_key, ai_model)

        if filtered_results is None:
            # AI processing failed after retries or due to non-retryable error
            return jsonify({"error": "AI processing failed after multiple retries or encountered an unrecoverable error."}), 500
        else:
            for r in filtered_results: r['method'] = 'ai'
            return jsonify(filtered_results)

    else:
        return jsonify({"error": "Invalid search method specified"}), 400

# --- NEW: API Endpoint to Get Episodes from Detail Page ---
@app.route('/api/get_episodes', methods=['POST'])
def handle_get_episodes():
    data = request.json
    video_id = data.get('id')
    base_url_from_request = data.get('base_url') # Use the base_url sent from frontend

    if not video_id or not base_url_from_request:
        return jsonify({"error": "Missing 'id' or 'base_url'"}), 400

    # Use the provided base URL, fallback to constant if necessary, but log a warning.
    base_url_to_use = base_url_from_request
    if base_url_to_use != YFSP_BASE_URL:
        print(f"Warning: Base URL from request ('{base_url_from_request}') differs from default ('{YFSP_BASE_URL}'). Using requested URL.")

    detail_page_url = YFSP_DETAIL_TEMPLATE.format(video_id)
    # Ensure the detail page URL uses the correct base URL
    detail_page_url = urljoin(base_url_to_use + "/", detail_page_url) # Use urljoin for safety

    print(f"Backend (YFSP Episodes): Fetching detail page HTML from {detail_page_url}")
    episodes = []
    try:
        response = requests.get(detail_page_url, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
        response.encoding = response.apparent_encoding
        soup = BeautifulSoup(response.text, 'html.parser')

        # Find the container for the episode links based on the provided HTML structure
        # Look for the first active tab panel that contains the episode list structure
        episode_list_container = soup.select_one('.tab-list.play-tab-list.active .module-play-list-content')

        if not episode_list_container:
             # Fallback: Maybe there's only one playlist without tabs?
             episode_list_container = soup.select_one('.module-play-list-content')
             if episode_list_container:
                  print("Backend (YFSP Episodes): Found episode container using fallback selector '.module-play-list-content'")
             else:
                 print(f"Backend (YFSP Episodes): Could not find episode list container on {detail_page_url}")
                 # Try finding ANY play list container if specific ones fail
                 episode_list_container = soup.select_one('div[class*="module-play-list-content"]')
                 if episode_list_container:
                     print("Backend (YFSP Episodes): Found episode container using general selector 'div[class*=\"module-play-list-content\"]'")
                 else:
                     return jsonify({"error": f"无法在页面上找到剧集列表容器"}), 404


        # Extract links and episode numbers
        episode_links = episode_list_container.find_all('a', class_='module-play-list-link', href=True)

        if not episode_links:
             print(f"Backend (YFSP Episodes): No 'a' tags found within the container.")
             return jsonify({"error": f"在剧集容器中未找到剧集链接"}), 404

        print(f"Backend (YFSP Episodes): Found {len(episode_links)} potential episode links.")

        for link in episode_links:
            episode_num_tag = link.find('span')
            if episode_num_tag:
                episode_num_text = episode_num_tag.get_text(strip=True)
                href = link.get('href')
                # Extract the actual episode number from the URL as it's more reliable
                match = re.search(r'-(\d+)/?$', href)
                if match:
                    actual_episode_num = match.group(1)
                    episodes.append({
                        "num_text": episode_num_text, # Keep the displayed text (e.g., "高清版")
                        "num": actual_episode_num,   # The actual number for the API call
                        "href": href                 # The relative href
                    })
                else:
                    print(f"Could not parse episode number from href: {href}")
            else:
                print(f"Skipping link, no span found: {link}")

        if not episodes:
             print(f"Backend (YFSP Episodes): Found links but couldn't extract episode numbers/hrefs correctly.")
             return jsonify({"error": "无法从链接中提取有效的剧集信息"}), 500

        # Sort episodes numerically based on the extracted number
        episodes.sort(key=lambda x: int(x['num']))

        print(f"Backend (YFSP Episodes): Successfully extracted {len(episodes)} episodes.")
        return jsonify({"episodes": episodes})

    except requests.exceptions.Timeout:
        print(f"Backend (YFSP Episodes): Timeout fetching detail page {detail_page_url}")
        return jsonify({"error": f"请求详情页超时: {detail_page_url}"}), 504
    except requests.exceptions.RequestException as e:
        error_detail = f"HTTP Status: {e.response.status_code}" if e.response else str(e)
        if e.response is not None and e.response.status_code == 404:
            print(f"Backend (YFSP Episodes): Detail page not found (404): {detail_page_url}")
            return jsonify({"error": f"详情页未找到 (404): {detail_page_url}"}), 404
        else:
             print(f"Backend (YFSP Episodes): Request error fetching detail page {detail_page_url}: {error_detail}")
             return jsonify({"error": f"请求详情页错误: {error_detail}"}), 500
    except Exception as e:
        import traceback
        print(f"Backend (YFSP Episodes): Error parsing detail page {detail_page_url}: {e}")
        print(traceback.format_exc()) # Print stack trace for debugging parsing issues
        return jsonify({"error": f"解析详情页时发生错误: {e}"}), 500


# --- Endpoint to get player URL for a SPECIFIC YFSP episode ---
@app.route('/api/get_episode_details', methods=['POST'])
def handle_get_episode_details():
    data = request.json
    video_id = data.get('id')
    episode_num = data.get('episode', 1) # Default to 1 if not provided
    base_url = data.get('base_url')

    if not video_id or not base_url:
        return jsonify({"error": "Missing 'id' or 'base_url'"}), 400
    if not episode_num:
         return jsonify({"error": "Missing 'episode' number"}), 400

    print(f"Backend: Received request for YFSP episode details: id={video_id}, ep={episode_num}, base={base_url}")

    # This function fetches the PLAYER page and uses AI to parse it
    final_player_url, error_msg = get_yfsp_episode_details(video_id, episode_num, base_url)

    if final_player_url:
        return jsonify({"player_url": final_player_url})
    else:
        # Return the specific error message from the function
        return jsonify({"error": error_msg or f"无法获取剧集 {episode_num} 的播放信息"}), 500


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
        # Still DO NOT send default AI URL/Key/Model here for security
    }
    return jsonify(config_data)

# --- Serve Frontend ---
@app.route('/')
def serve_index():
    # Use safe_join for security
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    # Use safe_join for security
    return send_from_directory(app.static_folder, path)

# Vercel needs the 'app' variable
# No need for if __name__ == '__main__': app.run(...) for Vercel deployment
