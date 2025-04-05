import os
import requests
from bs4 import BeautifulSoup
import json
import time
import re
from flask import Flask, request, jsonify, send_from_directory
from urllib.parse import urlparse, urljoin
from dotenv import load_dotenv
import traceback # For detailed error logging

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
AI_RETRY_DELAY = 1 # seconds (Changed from 5 to 1 as requested)

# --- Constants for YFSP ---
YFSP_BASE_URL = "https://www.yfsp.lv" # Make sure this is the correct current domain
YFSP_SEARCH_TEMPLATE = f"{YFSP_BASE_URL}/s/-------------/?wd={{}}"
YFSP_FINAL_PLAYER_TEMPLATE = "https://b.212133.xyz/player/ec.php?code=qw&if=1&url={}" # This might change
REQUEST_HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36', 'Referer': YFSP_BASE_URL} # Updated UA & Added Referer

# --- Helper Function: Extract Domain ---
def get_domain(url):
    try:
        return urlparse(url).netloc.replace('www.', '')
    except:
        return "Unknown"

# --- SearXNG Search Function (AI Method) ---
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
                    # Ensure link is absolute URL
                    link = urljoin(searxng_url, link) if not link.startswith('http') else link
                    if title and link.startswith('http'):
                        search_results.append({'title': title, 'link': link})
    except Exception as e:
        print(f"Backend (AI Method): SearXNG Error: {e}")
        traceback.print_exc() # Print full traceback
    print(f"Backend (AI Method): Extracted {len(search_results)} valid results.")
    return search_results

# --- AI Filtering Function (AI Method) ---
AI_PROMPT_FILTER_CN = f"""
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
- "website": 从 video_link 中提取的视频平台域名（例如："v.qq.com", "bilibili.com", "iq.com"）。请使用根域名（例如：www.bilibili.com -> bilibili.com）。

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
    prompt_to_use = AI_PROMPT_FILTER_CN.format(input_data_for_ai=input_data_for_ai) # Use Chinese prompt

    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
    payload = {
        "model": ai_model, "messages": [{"role": "user", "content": prompt_to_use}],
        "max_tokens": AI_MAX_TOKENS, "temperature": AI_TEMPERATURE, "stream": False
    }

    last_exception = None
    for attempt in range(AI_MAX_RETRIES):
        print(f"Backend (AI Filter): AI API attempt {attempt + 1}/{AI_MAX_RETRIES}")
        response = None
        try:
            response = requests.post(ai_url, headers=headers, json=payload, timeout=90)
            response.raise_for_status() # Raises HTTPError for bad responses (4xx or 5xx)
            ai_response = response.json()

            if 'choices' in ai_response and len(ai_response['choices']) > 0:
                content = ai_response['choices'][0].get('message', {}).get('content')
                if content:
                    print("Backend (AI Filter): AI response received, parsing JSON...")
                    try:
                        # Clean potential markdown code fences
                        json_content = content.strip()
                        if json_content.startswith("```json"): json_content = json_content[7:]
                        if json_content.endswith("```"): json_content = json_content[:-3]
                        json_content = json_content.strip()

                        parsed_data = json.loads(json_content)
                        if isinstance(parsed_data, list):
                            validated_data = []
                            for item in parsed_data:
                                if isinstance(item, dict) and 'title' in item and 'video_link' in item:
                                    # Ensure 'website' exists, extract if missing
                                    if 'website' not in item or not item['website']:
                                         item['website'] = get_domain(item['video_link'])
                                    validated_data.append(item)
                            print(f"Backend (AI Filter): AI parsed {len(validated_data)} valid items.")
                            return validated_data # Success! Exit retry loop.
                        else:
                             # AI returned something, but not a list as expected
                             print(f"Backend (AI Filter): AI did not return a JSON list. Content: {content[:200]}...")
                             # Don't retry if the format is wrong, it's likely an AI issue
                             return [] # Return empty list as per instructions for no valid links

                    except json.JSONDecodeError as json_e:
                        # AI returned content, but it wasn't valid JSON
                        print(f"Backend (AI Filter): AI response JSON parsing error: {json_e}. Content: {content[:200]}...")
                        last_exception = json_e # Store exception
                        # Don't retry on parsing error of the AI's response, AI needs fixing
                        return None # Indicate failure
                else:
                    # AI response had empty content
                    print("Backend (AI Filter): AI response content is empty.")
                    last_exception = ValueError("AI response content is empty.")
            else:
                # AI response structure was unexpected
                print(f"Backend (AI Filter): Unexpected AI response structure: {ai_response}")
                last_exception = ValueError(f"Unexpected AI response structure: {ai_response}")

        except requests.exceptions.Timeout as timeout_e:
            print(f"Backend (AI Filter): AI API timeout (Attempt {attempt + 1})")
            last_exception = timeout_e
        except requests.exceptions.RequestException as req_e:
            print(f"Backend (AI Filter): AI API request error (Attempt {attempt + 1}): {req_e}")
            last_exception = req_e
            # Stop retrying on auth errors
            if response is not None and response.status_code in [401, 403]:
                print("Backend (AI Filter): AI Auth error (401/403), stopping retries.")
                return None # Indicate failure without further retries
        except Exception as e:
            print(f"Backend (AI Filter): Unknown error during AI processing (Attempt {attempt + 1}): {e}")
            last_exception = e
            traceback.print_exc() # Print full traceback for unknown errors

        # If this attempt failed and it's not the last one, wait before retrying
        if attempt < AI_MAX_RETRIES - 1:
            print(f"Backend (AI Filter): Retrying in {AI_RETRY_DELAY} seconds...")
            time.sleep(AI_RETRY_DELAY)
        else:
            print(f"Backend (AI Filter): AI API max retries reached. Last error: {last_exception}")

    # If loop finishes without returning successfully, indicate failure
    return None


# --- YFSP Search Function (YFSP Method) ---
def search_yfsp_backend(query):
    search_url = YFSP_SEARCH_TEMPLATE.format(query)
    results = []
    print(f"Backend (YFSP Method): Searching YFSP for: {query} at {search_url}")
    try:
        response = requests.get(search_url, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
        response.encoding = response.apparent_encoding # Auto-detect encoding
        soup = BeautifulSoup(response.text, 'html.parser')
        items = soup.select('.module-main .module-card-item.module-item') # More specific selector
        print(f"Backend (YFSP Method): Found {len(items)} result items.")

        for item in items:
            # Selectors based on YFSP structure (might need adjustment if site changes)
            title_tag = item.select_one('.module-card-item-title a') # Get the <a> tag directly
            poster_link_tag = item.select_one('a.module-card-item-poster') # Link wrapping the image
            img_tag = item.select_one('.module-item-pic img.lazyload, .module-item-pic img') # Handle lazyload or direct img

            if title_tag and poster_link_tag and img_tag:
                title = title_tag.get_text(strip=True)
                detail_page_stub = poster_link_tag.get('href')
                # Prefer 'data-original' for lazy loaded, fallback to 'src'
                cover_img_stub = img_tag.get('data-original') or img_tag.get('src')

                if title and detail_page_stub and cover_img_stub:
                    # Extract ID: typically /yfdetail/ID/ or /detail/ID.html etc.
                    match = re.search(r'/(\d+)[/\.]', detail_page_stub) # Look for digits followed by / or .
                    if match:
                        video_id = match.group(1)
                        absolute_cover_url = urljoin(YFSP_BASE_URL, cover_img_stub)
                        results.append({
                            "title": title,
                            "cover": absolute_cover_url,
                            "id": video_id,
                             # Store the base URL used for this search, in case it changes later
                            "base_url": YFSP_BASE_URL
                        })
                    else:
                         print(f"Backend (YFSP Method): Could not extract ID from detail link: {detail_page_stub}")
                else:
                    print(f"Backend (YFSP Method): Missing title, detail link, or cover for an item.")
            else:
                 print(f"Backend (YFSP Method): Skipping item due to missing essential tags (title_tag, poster_link_tag, img_tag).")

    except requests.exceptions.Timeout:
        print(f"Backend (YFSP Method): Timeout searching {search_url}")
    except requests.exceptions.RequestException as e:
        print(f"Backend (YFSP Method): Request error searching {search_url}: {e}")
        traceback.print_exc()
    except Exception as e:
        print(f"Backend (YFSP Method): Error parsing YFSP search results: {e}")
        traceback.print_exc()

    print(f"Backend (YFSP Method): Extracted {len(results)} valid results.")
    return results

# --- AI Function to Parse Episode HTML for player_aaaa (YFSP Method) ---
# Focuses ONLY on extracting the player config, not the episode list
AI_PROMPT_PARSE_PLAYER_CN = f"""
请仔细分析以下提供的视频播放页面的 HTML 内容。
你的任务是：
1. 在 HTML 中找到定义了 `player_aaaa` JavaScript 变量的 `<script>` 代码块。这个变量通常被赋值为一个 JSON 对象，例如 `var player_aaaa = {{...}};`。
2. 精确地解析这个 JSON 对象。
3. 提取与键 "url" 相关联的值。如果存在 "url_next" 键，也提取它的值。

请注意处理以下情况：
- JSON 对象可能嵌套在 `<script>` 标签内。
- JSON 字符串值可能包含转义字符（例如 `\\/` 应替换为 `/`）。你需要返回清理后的 URL。
- 如果 "url" 键不存在于 JSON 对象中，对应的值应返回 `null`。
- 如果 "url_next" 键不存在，对应的值应返回 `null`。
- 如果在 HTML 中找不到 `player_aaaa` 对象，或者无法解析其内容为有效的 JSON，请返回 `{{ "error": "player_aaaa not found or invalid" }}`。

返回结果必须是且仅是一个 JSON 对象，包含提取的信息。有效输出示例：
`{{ "url": "https://actual.m3u8/link/...", "url_next": "https://next.m3u8/link/..." }}`
`{{ "url": "https://actual.m3u8/link/...", "url_next": null }}`
`{{ "url": null, "url_next": null }}`
`{{ "error": "player_aaaa not found or invalid" }}`

不要在 JSON 结构之外添加任何说明或前导/尾随文本。

HTML 内容如下（只显示开头部分）：
--- START HTML ---
{{html_content}}
--- END HTML ---

你的 JSON 输出：
"""

def parse_episode_html_with_ai(html_content, ai_url, ai_key, ai_model):
    """
    Uses AI to parse the episode page HTML and extract m3u8 URLs from player_aaaa.
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
         return {"error": "AI configuration is incomplete for parsing"}

    # Limit HTML size sent to AI to avoid large token usage/costs
    max_html_length = 28000
    truncated_html = html_content[:max_html_length]

    print(f"Backend (YFSP AI Parser): Sending HTML (truncated to {len(truncated_html)} chars) to AI ({ai_url}, model: {ai_model}) for player_aaaa parsing.")

    prompt = AI_PROMPT_PARSE_PLAYER_CN.format(html_content=truncated_html)

    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
    payload = {
        "model": ai_model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1000, # Parsing result should be small
        "temperature": AI_TEMPERATURE,
        "stream": False
    }

    last_exception = None
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

                        # Basic validation: expecting a dict with 'url' or 'error'
                        if isinstance(parsed_data, dict) and ('url' in parsed_data or 'error' in parsed_data):
                             print(f"Backend (YFSP AI Parser): Successfully parsed AI result: {parsed_data}")

                             # Clean up potential escaped slashes in URLs if AI didn't
                             # Use .get() to avoid KeyError if keys are missing but 'error' isn't present
                             url_val = parsed_data.get('url')
                             url_next_val = parsed_data.get('url_next')

                             if url_val and isinstance(url_val, str):
                                 parsed_data['url'] = url_val.replace('\\/', '/')
                             if url_next_val and isinstance(url_next_val, str):
                                  parsed_data['url_next'] = url_next_val.replace('\\/', '/')

                             # Ensure expected keys exist even if null
                             if 'url' not in parsed_data and 'error' not in parsed_data: parsed_data['url'] = None
                             if 'url_next' not in parsed_data and 'error' not in parsed_data: parsed_data['url_next'] = None

                             return parsed_data # Success! Exit retry loop.
                        else:
                             # AI returned JSON, but not the expected structure
                             print(f"Backend (YFSP AI Parser): AI returned unexpected JSON structure: {parsed_data}")
                             # Don't retry if structure is wrong
                             return {"error": f"AI returned unexpected JSON structure: {parsed_data}"}

                    except json.JSONDecodeError as json_e:
                         # AI returned content, but it wasn't valid JSON
                        print(f"Backend (YFSP AI Parser): AI JSON *result* parsing error: {json_e}. Content: {content[:200]}...")
                        last_exception = json_e
                        # Don't retry on parsing error of AI's response
                        return {"error": f"AI response JSON parsing error: {json_e}"}
                else:
                    print("Backend (YFSP AI Parser): AI response content is empty.")
                    last_exception = ValueError("AI response content is empty.")
            else:
                print(f"Backend (YFSP AI Parser): Unexpected AI response structure: {ai_response}")
                last_exception = ValueError(f"Unexpected AI response structure: {ai_response}")

        except requests.exceptions.Timeout as timeout_e:
            print(f"Backend (YFSP AI Parser): AI API timeout (Attempt {attempt + 1})")
            last_exception = timeout_e
        except requests.exceptions.RequestException as req_e:
            print(f"Backend (YFSP AI Parser): AI API request error (Attempt {attempt + 1}): {req_e}")
            last_exception = req_e
            if response is not None and response.status_code in [401, 403]:
                print("Backend (YFSP AI Parser): AI Auth error (401/403), stopping retries.")
                return {"error": "AI Authentication Error"} # Indicate failure without retries
        except Exception as e:
            print(f"Backend (YFSP AI Parser): Unknown error during AI processing (Attempt {attempt + 1}): {e}")
            last_exception = e
            traceback.print_exc()

        # Wait before retrying if not the last attempt
        if attempt < AI_MAX_RETRIES - 1:
            print(f"Backend (YFSP AI Parser): Retrying in {AI_RETRY_DELAY} seconds...")
            time.sleep(AI_RETRY_DELAY)
        else:
            print(f"Backend (YFSP AI Parser): AI API max retries reached. Last error: {last_exception}")

    # If loop finishes without success, return error
    return {"error": f"AI processing failed after {AI_MAX_RETRIES} retries. Last error: {last_exception}"}


# --- Get YFSP Episode Details (Uses AI for Player URL + BS4 for Episode List) ---
def get_yfsp_episode_details(video_id, episode_num, base_url):
    """
    Fetches the episode page, uses AI to get the M3U8 link from player_aaaa,
    and uses BeautifulSoup to parse the episode list.

    Returns:
        dict: { "player_url": "...", "episodes": [...] } or {"error": "message"}
    """
    # Construct the specific episode page URL (e.g., /iyfplay/65978-1-2/)
    # The format '-1-' seems common, representing the playlist/source number
    episode_page_url = f"{base_url}/iyfplay/{video_id}-1-{episode_num}/"
    print(f"Backend (YFSP Method): Fetching episode page HTML from {episode_page_url}")

    html_content = None
    try:
        response = requests.get(episode_page_url, headers=REQUEST_HEADERS, timeout=25) # Increased timeout slightly
        response.raise_for_status()
        # Explicitly try UTF-8 first, then apparent_encoding as fallback
        try:
            response.encoding = 'utf-8'
            html_content = response.text
            # Basic check if decoding worked (look for common Chinese chars)
            if '播放' not in html_content and '剧集' not in html_content:
                 print("UTF-8 decoding might be incorrect, trying apparent_encoding")
                 raise UnicodeDecodeError("utf-8", b"", 0, 0, "heuristic check failed")
        except UnicodeDecodeError:
             response.encoding = response.apparent_encoding
             html_content = response.text

        # Check if HTML content seems valid
        if not html_content or len(html_content) < 500: # Basic check
             print(f"Backend (YFSP Method): HTML content from {episode_page_url} seems empty or too small.")
             return {"error": f"未能获取有效的页面内容从 {episode_page_url}"}

    except requests.exceptions.Timeout:
        print(f"Backend (YFSP Method): Timeout fetching episode page {episode_page_url}")
        return {"error": f"请求超时: {episode_page_url}"}
    except requests.exceptions.RequestException as e:
        error_msg = f"请求错误: {episode_page_url}: {e}"
        if e.response is not None:
             error_msg += f" (Status Code: {e.response.status_code})"
             if e.response.status_code == 404:
                 error_msg = f"剧集页面未找到 (404): {episode_page_url}"
        print(f"Backend (YFSP Method): {error_msg}")
        traceback.print_exc()
        return {"error": error_msg}
    except Exception as e:
        print(f"Backend (YFSP Method): Error fetching episode page {episode_page_url}: {e}")
        traceback.print_exc()
        return {"error": f"获取剧集页面时发生未知错误: {e}"}

    # --- 1. Use AI to parse for the player URL ---
    # Use default backend AI settings, NOT user-provided ones
    ai_parse_result = parse_episode_html_with_ai(
        html_content,
        DEFAULT_AI_API_URL,
        DEFAULT_AI_API_KEY,
        DEFAULT_AI_MODEL
    )

    if not ai_parse_result or 'error' in ai_parse_result:
        error_msg = ai_parse_result.get('error', 'Unknown AI parsing error') if ai_parse_result else 'AI parsing failed'
        print(f"Backend (YFSP Method): AI failed to parse player_aaaa: {error_msg}")
        # Proceed to parse episodes even if AI fails, maybe user just wants list
        # Let's return an error to be consistent, the primary goal is playback
        return {"error": f"AI 未能解析播放链接: {error_msg}"}

    m3u8_url = ai_parse_result.get('url')
    final_player_url = None
    if m3u8_url:
        # Construct the final player link using the URL returned by AI
        final_player_url = YFSP_FINAL_PLAYER_TEMPLATE.format(m3u8_url)
        print(f"Backend (YFSP Method): AI extracted M3U8 URL: {m3u8_url}")
        print(f"Backend (YFSP Method): Constructed final player URL: {final_player_url}")
    else:
         print(f"Backend (YFSP Method): AI did not return a valid 'url' key.")
         # Consider this an error case as playback isn't possible
         return {"error": f"AI 未能从 player_aaaa 中提取有效的 'url'"}

    # --- 2. Use BeautifulSoup to parse the episode list ---
    episodes_list = []
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        # Adjust selector based on the provided HTML snippet
        list_container = soup.select_one('.module-play-list-content.module-play-list-base')
        if list_container:
            episode_links = list_container.find_all('a', class_='module-play-list-link', href=True)
            print(f"Backend (YFSP Method): Found {len(episode_links)} episode links using BS4.")
            for link_tag in episode_links:
                ep_num_span = link_tag.find('span')
                ep_num = ep_num_span.get_text(strip=True) if ep_num_span else link_tag.get_text(strip=True) # Fallback if no span
                relative_link = link_tag['href']
                # Extract episode number from link as a fallback/verification
                link_match = re.search(r'-(\d+)/?$', relative_link)
                link_ep_num = link_match.group(1) if link_match else None

                if ep_num and relative_link:
                    episodes_list.append({
                        "num": ep_num,
                        "link": relative_link,
                        "link_num": link_ep_num # Store number extracted from link too
                    })
                else:
                    print(f"Backend (YFSP Method): BS4 skipped episode link due to missing num or href: {link_tag}")
        else:
            print("Backend (YFSP Method): BS4 could not find episode list container '.module-play-list-content.module-play-list-base'.")

    except Exception as e:
        print(f"Backend (YFSP Method): Error parsing episode list with BS4: {e}")
        traceback.print_exc()
        # Don't fail entirely if BS4 parsing fails, maybe AI worked

    if not episodes_list:
         print("Backend (YFSP Method): BS4 parsing yielded no episodes.")
         # Optionally return an error or just empty list depending on requirements
         # Let's return empty list for now

    return {
        "player_url": final_player_url,
        "episodes": episodes_list
    }


# --- API Endpoints ---

@app.route('/api/search', methods=['POST'])
def handle_search():
    data = request.json
    query = data.get('query')
    method = data.get('method', 'ai') # Default to 'ai' if not provided
    settings = data.get('settings', {})

    print(f"Backend: Received search request. Method: {method}, Query: '{query}'")

    if not query:
        return jsonify({"error": "Query parameter is required"}), 400

    if method == 'yfsp':
        results = search_yfsp_backend(query)
        # Add method indicator for frontend logic
        for r in results: r['method'] = 'yfsp'
        return jsonify(results)

    elif method == 'ai':
        searxng_url = settings.get('searxngUrl') or DEFAULT_SEARXNG_URL
        # For AI filtering, use user-provided OR default backend credentials if user didn't provide
        ai_url = settings.get('aiApiUrl') or DEFAULT_AI_API_URL
        ai_key = settings.get('aiApiKey') # Use user's key if provided
        ai_model = settings.get('aiModel') or DEFAULT_AI_MODEL

        # *** Crucial Check: Use *backend's* key ONLY if user didn't provide one ***
        # This allows users to use their own keys, but provides a fallback
        # Make sure the DEFAULT_AI_API_KEY is *actually* set in the environment
        # and is not the placeholder value.
        effective_ai_key = ai_key # Start with user's key
        if not effective_ai_key:
            print("Backend (AI Method): User did not provide AI API Key, attempting to use backend default.")
            effective_ai_key = DEFAULT_AI_API_KEY # Fallback to backend default

        # Validate the key we are about to use
        if not effective_ai_key or "PLACEHOLDER" in effective_ai_key or "YOUR_FALLBACK_OR_PLACEHOLDER_KEY" in effective_ai_key:
             print("Backend Error: AI API Key is missing or invalid. SearXNG+AI method requires a valid key either from user settings or backend environment (DEFAULT_AI_API_KEY).")
             return jsonify({"error": "AI API Key 未配置或无效。请在设置中提供您的密钥，或者确保后端已配置默认密钥。"}), 500

        # Validate other required settings for AI method
        if not ai_url: return jsonify({"error": "AI API URL is not configured."}), 500
        if not ai_model: return jsonify({"error": "AI Model is not configured."}), 500
        if not searxng_url: return jsonify({"error": "SearXNG URL is not configured."}), 500

        print(f"Backend (AI Method): Using AI Config - URL: {ai_url}, Key: {'Provided (ends ...' + effective_ai_key[-4:] + ')' if effective_ai_key else 'None'}, Model: {ai_model}")
        print(f"Backend (AI Method): Using SearXNG URL: {searxng_url}")

        raw_results = search_searxng_backend(query, searxng_url)
        if not raw_results:
            print("Backend (AI Method): No results from SearXNG.")
            return jsonify([]) # Return empty list, not an error

        # Use the determined key for filtering
        filtered_results = filter_links_with_ai_backend(raw_results, ai_url, effective_ai_key, ai_model)

        if filtered_results is None:
            # This indicates an error occurred during AI processing after retries
            return jsonify({"error": "AI 分析处理失败 (多次尝试后)。请检查 AI 配置或稍后再试。"}), 500
        else:
             # Add method indicator for frontend logic
             for r in filtered_results: r['method'] = 'ai'
             return jsonify(filtered_results)

    else:
        return jsonify({"error": f"Invalid search method specified: {method}"}), 400


@app.route('/api/get_episode_details', methods=['POST'])
def handle_get_episode_details():
    data = request.json
    video_id = data.get('id')
    episode_num = data.get('episode', 1) # Default to episode 1 if not provided
    base_url = data.get('base_url') # Base URL of the YFSP site used for search

    if not video_id or not base_url:
        return jsonify({"error": "Missing 'id' or 'base_url' for YFSP episode request"}), 400

    print(f"Backend: Received request for YFSP episode details: id={video_id}, ep={episode_num}, base={base_url}")

    # This function now uses AI (with backend's default creds) + BS4 internally
    details_result = get_yfsp_episode_details(video_id, episode_num, base_url)

    if 'error' in details_result:
         # Forward the specific error message from the function
         print(f"Backend Error getting episode details: {details_result['error']}")
         return jsonify({"error": f"获取剧集 {episode_num} 详情失败: {details_result['error']}"}), 500
    elif not details_result.get('player_url'):
         # Handle case where function succeeded but didn't find a player URL
         print(f"Backend Error: No player_url found for episode {episode_num}, though no explicit error was raised.")
         return jsonify({"error": f"未能找到剧集 {episode_num} 的有效播放链接。"}), 500
    else:
         # Success, return player URL and episode list
         return jsonify(details_result)


@app.route('/api/config', methods=['GET'])
def get_config():
    try:
        default_interfaces = json.loads(DEFAULT_PARSING_INTERFACES_JSON)
    except json.JSONDecodeError:
        print("Backend: ERROR decoding DEFAULT_PARSING_INTERFACES JSON from environment variable.")
        default_interfaces = [] # Fallback to empty list

    # Send necessary default values to the frontend
    # DO NOT send default AI Key here for security reasons.
    config_data = {
        "defaultParsingInterfaces": default_interfaces,
        "defaultSearxngUrl": DEFAULT_SEARXNG_URL,
        # Optionally send default AI URL/Model if you want them pre-filled in settings
        # "defaultAiApiUrl": DEFAULT_AI_API_URL,
        # "defaultAiModel": DEFAULT_AI_MODEL,
    }
    return jsonify(config_data)

# --- Serve Frontend ---
@app.route('/')
def serve_index():
    # Serve index.html from the 'public' folder (relative to this script)
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
     # Serve other static files (CSS, JS, images) from the 'public' folder
     # This allows paths like /style.css or /script.js
    return send_from_directory(app.static_folder, path)

# --- Vercel Entry Point ---
# The 'app' variable is automatically picked up by Vercel.
# No need for `if __name__ == '__main__': app.run(...)` for Vercel deployment.

