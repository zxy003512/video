import os
import requests
from bs4 import BeautifulSoup
import json
import time
import re
from flask import Flask, request, jsonify, send_from_directory
from urllib.parse import urlparse, urljoin # Removed unused parse_qs
from dotenv import load_dotenv
import traceback # For detailed error logging

# Load environment variables from .env file for local development
load_dotenv()

app = Flask(__name__, static_folder='../public', static_url_path='')

# --- Configuration ---
DEFAULT_AI_API_URL = os.getenv('AI_API_URL', "https://api.zetatechs.com/v1/chat/completions")
# Vercel 环境变量中必须设置! 检查确保不是占位符
DEFAULT_AI_API_KEY = os.getenv('AI_API_KEY', "YOUR_FALLBACK_OR_PLACEHOLDER_KEY")
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

AI_MAX_TOKENS_FILTER = 30000 # For filtering search results
AI_MAX_TOKENS_PARSE = 2000  # Smaller limit for parsing specific HTML sections
AI_TEMPERATURE = 0.0 # Keep deterministic output
AI_MAX_RETRIES = 3 # Max retries for AI calls
AI_RETRY_DELAY = 1 # Delay in seconds between retries

# --- Constants for YFSP ---
YFSP_BASE_URL = "https://www.yfsp.lv"
YFSP_SEARCH_TEMPLATE = "https://www.yfsp.lv/s/-------------/?wd={}"
YFSP_DETAIL_PAGE_TEMPLATE = "https://www.yfsp.lv/iyf/{}/" # For fetching episode list maybe? Or use first play page.
YFSP_PLAY_PAGE_TEMPLATE = "https://www.yfsp.lv{}" # Takes relative path like /iyfplay/65978-1-1/
YFSP_FINAL_PLAYER_TEMPLATE = "https://b.212133.xyz/player/ec.php?code=qw&if=1&url={}" # Template for the final iframe src
REQUEST_HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'} # Updated UA

# --- Helper Function: Extract Domain ---
def get_domain(url):
    try:
        return urlparse(url).netloc
    except:
        return "Unknown"

# --- Generic AI Request Function with Retry ---
def make_ai_request(ai_url, ai_key, ai_model, prompt, max_tokens, context="AI Request"):
    """Makes an AI API request with retry logic."""
    if not all([ai_url, ai_key, ai_model, prompt]):
        print(f"Backend ({context}): Missing AI configuration or prompt.")
        return None, "AI configuration or prompt missing"

    # Check for placeholder key
    if "YOUR_FALLBACK_OR_PLACEHOLDER_KEY" in ai_key or not ai_key:
         print(f"Backend ({context}): ERROR - AI API Key is not configured or is a placeholder.")
         return None, "AI API Key is not configured properly"

    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
    payload = {
        "model": ai_model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": AI_TEMPERATURE,
        "stream": False
    }

    for attempt in range(AI_MAX_RETRIES):
        print(f"Backend ({context}): AI API attempt {attempt + 1}/{AI_MAX_RETRIES} to {ai_url} with model {ai_model}")
        response = None
        try:
            response = requests.post(ai_url, headers=headers, json=payload, timeout=90) # 90s timeout
            response.raise_for_status() # Raises HTTPError for bad responses (4xx or 5xx)
            ai_response = response.json()

            if 'choices' in ai_response and len(ai_response['choices']) > 0:
                message = ai_response['choices'][0].get('message', {})
                content = message.get('content')
                if content:
                    print(f"Backend ({context}): AI response received successfully.")
                    # Clean potential markdown ```json ... ```
                    json_content = content.strip()
                    if json_content.startswith("```json"): json_content = json_content[7:]
                    if json_content.endswith("```"): json_content = json_content[:-3]
                    json_content = json_content.strip()
                    return json_content, None # Return content and no error
                else:
                    print(f"Backend ({context}): AI response content is empty.")
                    # Treat as potentially retryable? Or specific error? Let's retry.
                    error_reason = "AI response content empty"
            else:
                print(f"Backend ({context}): Unexpected AI response structure: {ai_response}")
                # Treat as potentially retryable? Or specific error? Let's retry.
                error_reason = "Unexpected AI response structure"

        except requests.exceptions.Timeout:
            print(f"Backend ({context}): AI API timeout (Attempt {attempt + 1})")
            error_reason = "Timeout"
        except requests.exceptions.HTTPError as http_err:
            print(f"Backend ({context}): AI API HTTP error (Attempt {attempt + 1}): {http_err}")
            error_reason = f"HTTP Error: {http_err.response.status_code}"
            if http_err.response.status_code in [401, 403]:
                print(f"Backend ({context}): Authentication error ({http_err.response.status_code}). Stopping retries.")
                return None, f"AI Authentication Error ({http_err.response.status_code})" # Non-retryable
            if http_err.response.status_code == 429: # Rate limit
                print(f"Backend ({context}): Rate limit hit. Waiting longer before next attempt.")
                time.sleep(AI_RETRY_DELAY * (attempt + 2)) # Exponential backoff maybe? Simple longer wait for now.
            # Other 4xx/5xx errors might be temporary, continue retry logic
        except requests.exceptions.RequestException as e:
            print(f"Backend ({context}): AI API request error (Attempt {attempt + 1}): {e}")
            error_reason = f"RequestException: {e}"
        except Exception as e:
            print(f"Backend ({context}): Unknown error during AI processing (Attempt {attempt + 1}): {e}")
            # Log traceback for unexpected errors
            traceback.print_exc()
            error_reason = f"Unknown Error: {e}"

        # If an error occurred and it's not the last attempt, wait before retrying
        if attempt < AI_MAX_RETRIES - 1:
            print(f"Backend ({context}): Retrying after delay...")
            time.sleep(AI_RETRY_DELAY)
        else:
            print(f"Backend ({context}): AI API max retries reached. Last error: {error_reason}")
            return None, f"AI failed after {AI_MAX_RETRIES} attempts ({error_reason})"

    return None, f"AI failed after {AI_MAX_RETRIES} attempts (Loop ended unexpectedly)" # Should not be reached if logic is correct

# --- SearXNG Search Function (Original AI Method) ---
def search_searxng_backend(query, searxng_url):
    # (Function remains the same as before)
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
                    # Ensure link is absolute
                    link = urljoin(searxng_url, link) if not link.startswith('http') else link
                    if title and link.startswith('http'):
                        search_results.append({'title': title, 'link': link})
    except Exception as e:
        print(f"Backend (AI Method): SearXNG Error: {e}")
    print(f"Backend (AI Method): Extracted {len(search_results)} valid results.")
    return search_results

# --- AI Filtering Function (Original AI Method - Now uses generic request function) ---
AI_PROMPT_CN_FILTER = f"""
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
    if not results_list: return [], None

    print(f"Backend (AI Filter): Preparing {len(results_list)} results for AI filtering.")
    input_data_for_ai = "\n".join([f"Title: {item['title']}\nURL: {item['link']}" for item in results_list])
    prompt_to_use = AI_PROMPT_CN_FILTER.format(input_data_for_ai=input_data_for_ai)

    json_content, error = make_ai_request(
        ai_url, ai_key, ai_model, prompt_to_use, AI_MAX_TOKENS_FILTER, "AI Filter"
    )

    if error:
        return None, error # Propagate error message

    if not json_content:
        return None, "AI returned empty content after successful request."

    try:
        parsed_data = json.loads(json_content)
        if isinstance(parsed_data, list):
            validated_data = []
            for item in parsed_data:
                if isinstance(item, dict) and 'title' in item and 'video_link' in item:
                    if 'website' not in item or not item['website']:
                        item['website'] = get_domain(item['video_link'])
                    validated_data.append(item)
            print(f"Backend (AI Filter): AI parsed {len(validated_data)} valid items.")
            return validated_data, None
        else:
            print(f"Backend (AI Filter): AI did not return a JSON list. Content: {json_content[:200]}...")
            return None, "AI did not return a JSON list"
    except json.JSONDecodeError as json_e:
        print(f"Backend (AI Filter): AI JSON parsing error: {json_e}. Content: {json_content[:200]}...")
        return None, f"AI result JSON parsing error: {json_e}"
    except Exception as e:
        print(f"Backend (AI Filter): Error processing AI response: {e}")
        traceback.print_exc()
        return None, f"Error processing AI response: {e}"


# --- YFSP Search Function (New Method) ---
def search_yfsp_backend(query):
    # (Function remains largely the same as before)
    search_url = YFSP_SEARCH_TEMPLATE.format(query)
    results = []
    print(f"Backend (YFSP Method): Searching YFSP for: {query} at {search_url}")
    try:
        response = requests.get(search_url, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
        response.encoding = response.apparent_encoding # Try to auto-detect encoding
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
                    # Extract ID from detail page link, e.g., /iyf/65978/
                    match = re.search(r'/iyf/(\d+)/?$', detail_page_stub)
                    if match:
                        video_id = match.group(1)
                        results.append({
                            "title": title,
                            "cover": urljoin(YFSP_BASE_URL, cover_img_stub),
                            "id": video_id, # The ID of the show/movie
                            "base_url": YFSP_BASE_URL
                        })
                    else:
                         print(f"Backend (YFSP Method): Could not extract ID from {detail_page_stub}")
            else:
                 print(f"Backend (YFSP Method): Skipping item due to missing title, link, or image.")

    except requests.exceptions.Timeout: print(f"Backend (YFSP Method): Timeout searching {search_url}")
    except requests.exceptions.RequestException as e: print(f"Backend (YFSP Method): Request error searching {search_url}: {e}")
    except Exception as e:
        print(f"Backend (YFSP Method): Error parsing YFSP search results: {e}")
        traceback.print_exc()

    print(f"Backend (YFSP Method): Extracted {len(results)} valid results.")
    return results


# --- NEW: AI Function to Parse Episode LIST from HTML ---
AI_PROMPT_YFSP_EPISODE_LIST = """
请仔细分析以下提供的视频播放页面的 HTML 内容。
你的任务是找到包含剧集链接列表的区域，通常在一个 class 包含 'module-play-list-content' 的 div 元素内。
你需要提取该区域中所有剧集链接 (`<a>` 标签)。

对于每个找到的剧集链接 `<a>` 标签，请提取以下信息：
1.  **剧集编号/名称**: `<a>` 标签内部 `<span>` 标签的文本内容。如果找不到 `<span>`，则使用 `<a>` 标签本身的文本内容。去除文本前后的空白。
2.  **剧集链接**: `<a>` 标签的 `href` 属性值。这通常是一个相对路径。

请将提取的信息组织成一个 JSON 列表。列表中的每个对象代表一个剧集，并包含以下确切的键：
- "num": 提取到的剧集编号/名称 (字符串)。
- "link": 提取到的 `href` 属性值 (字符串，相对路径)。

例如:
`[ { "num": "01", "link": "/iyfplay/65978-1-1/" }, { "num": "02", "link": "/iyfplay/65978-1-2/" }, ... ]`

如果找不到包含 'module-play-list-content' 的 div，或者该 div 内没有有效的 `<a>` 剧集链接，请返回一个空的 JSON 列表：`[]`。

确保返回的是纯粹的 JSON 列表，不要包含任何额外的解释或文本。

HTML 内容如下（只显示开头部分）：
--- START HTML ---
{html_content_snippet}
--- END HTML ---

你的 JSON 输出：
"""

def parse_episode_list_with_ai(html_content, ai_url, ai_key, ai_model):
    """Uses AI to parse HTML and extract the list of episodes."""
    if not html_content: return None, "HTML content for episode list parsing is empty"

    print(f"Backend (YFSP AI List Parser): Sending HTML snippet to AI for episode list extraction.")
    # Limit HTML size sent to AI
    html_snippet = html_content[:30000] # Send a large chunk likely containing the list
    prompt = AI_PROMPT_YFSP_EPISODE_LIST.format(html_content_snippet=html_snippet)

    json_content, error = make_ai_request(
        ai_url, ai_key, ai_model, prompt, AI_MAX_TOKENS_PARSE, "YFSP AI List Parser"
    )

    if error:
        return None, error # Propagate error

    if not json_content:
        return None, "AI returned empty content for episode list."

    try:
        parsed_data = json.loads(json_content)
        if isinstance(parsed_data, list):
             # Basic validation of list items
             validated_list = []
             for item in parsed_data:
                 if isinstance(item, dict) and 'num' in item and 'link' in item and isinstance(item['link'], str):
                     # Ensure link looks like a relative path
                     if item['link'].startswith('/'):
                         validated_list.append({
                             "num": str(item['num']).strip(), # Ensure num is string and stripped
                             "link": item['link'].strip()
                         })
                     else:
                         print(f"Backend (YFSP AI List Parser): Skipping item with invalid link format: {item}")
                 else:
                    print(f"Backend (YFSP AI List Parser): Skipping invalid item structure: {item}")

             print(f"Backend (YFSP AI List Parser): Successfully parsed {len(validated_list)} episode items.")
             return validated_list, None
        else:
             print(f"Backend (YFSP AI List Parser): AI did not return a JSON list. Content: {json_content[:200]}...")
             return None, "AI did not return a JSON list for episodes"

    except json.JSONDecodeError as json_e:
        print(f"Backend (YFSP AI List Parser): AI JSON result parsing error: {json_e}. Content: {json_content[:200]}...")
        return None, f"AI episode list result JSON parsing error: {json_e}"
    except Exception as e:
        print(f"Backend (YFSP AI List Parser): Error processing AI response: {e}")
        traceback.print_exc()
        return None, f"Error processing AI episode list response: {e}"

# --- AI Function to Parse M3U8 URL from Episode Page HTML ---
AI_PROMPT_YFSP_PLAYER_URL = f"""
请仔细分析以下提供的视频播放页面的 HTML 内容。
在 HTML 中找到定义了 `player_aaaa` JavaScript 变量的 `<script>` 代码块。这个变量被赋值为一个 JSON 对象。
请精确地解析这个 JSON 对象。
主要提取与键 "url" 相关联的值。这个值是实际的播放地址 (通常是 m3u8 链接)。

请注意处理以下情况：
- JSON 对象可能嵌套在 `<script>` 标签内。
- JSON 字符串值可能包含转义字符（例如 `\\/` 应处理为 `/`）。你需要返回清理后的 URL。
- 如果 "url" 键不存在于 `player_aaaa` JSON 对象中，或者找不到 `player_aaaa` 对象，请返回 `{{ "error": "Player URL not found in player_aaaa" }}`。

返回结果必须是且仅是一个 JSON 对象。
如果成功提取，格式为：`{{ "url": "https://actual.m3u8/link/..." }}`
如果失败，格式为：`{{ "error": "Some error message" }}`

不要在 JSON 结构之外添加任何说明或前导/尾随文本。

HTML 内容如下（只显示开头部分）：
--- START HTML ---
{{html_content_snippet}}
--- END HTML ---

你的 JSON 输出：
"""

def parse_m3u8_url_with_ai(html_content, ai_url, ai_key, ai_model):
    """Uses AI to parse HTML for the m3u8 URL within the player_aaaa variable."""
    if not html_content: return None, "HTML content for M3U8 parsing is empty"

    print(f"Backend (YFSP AI M3U8 Parser): Sending HTML snippet to AI for M3U8 URL extraction.")
    html_snippet = html_content[:25000] # Limit size
    prompt = AI_PROMPT_YFSP_PLAYER_URL.format(html_content_snippet=html_snippet)

    json_content, error = make_ai_request(
        ai_url, ai_key, ai_model, prompt, AI_MAX_TOKENS_PARSE, "YFSP AI M3U8 Parser"
    )

    if error:
        return None, error # Propagate error

    if not json_content:
        return None, "AI returned empty content for M3U8 URL."

    try:
        parsed_data = json.loads(json_content)
        if isinstance(parsed_data, dict):
            if 'error' in parsed_data:
                 print(f"Backend (YFSP AI M3U8 Parser): AI reported an error: {parsed_data['error']}")
                 return None, parsed_data['error']
            elif 'url' in parsed_data and parsed_data['url']:
                 # Clean up potential escaped slashes
                 m3u8_url = str(parsed_data['url']).replace('\\/', '/')
                 print(f"Backend (YFSP AI M3U8 Parser): Successfully parsed M3U8 URL: {m3u8_url}")
                 return m3u8_url, None
            else:
                 print(f"Backend (YFSP AI M3U8 Parser): AI result missing 'url' or it's empty. Data: {parsed_data}")
                 return None, "AI result missing 'url' key or value"
        else:
             print(f"Backend (YFSP AI M3U8 Parser): AI did not return a JSON object. Content: {json_content[:200]}...")
             return None, "AI did not return a JSON object for M3U8 URL"

    except json.JSONDecodeError as json_e:
        print(f"Backend (YFSP AI M3U8 Parser): AI JSON result parsing error: {json_e}. Content: {json_content[:200]}...")
        return None, f"AI M3U8 result JSON parsing error: {json_e}"
    except Exception as e:
        print(f"Backend (YFSP AI M3U8 Parser): Error processing AI response: {e}")
        traceback.print_exc()
        return None, f"Error processing AI M3U8 response: {e}"


# --- Function to fetch HTML with retries ---
def fetch_html(url, context="HTML Fetch"):
    """Fetches HTML content with basic retry logic."""
    for attempt in range(AI_MAX_RETRIES): # Use same retry count for fetching
        print(f"Backend ({context}): Fetching HTML attempt {attempt + 1}/{AI_MAX_RETRIES} from {url}")
        try:
            response = requests.get(url, headers=REQUEST_HEADERS, timeout=30) # Increased timeout
            response.raise_for_status()
            response.encoding = response.apparent_encoding # Ensure correct encoding
            html_content = response.text
            if not html_content or len(html_content) < 300: # Basic check for valid content
                 print(f"Backend ({context}): HTML content from {url} seems empty or too small.")
                 # Consider this a failure and retry
                 raise ValueError("HTML content too small or empty")
            print(f"Backend ({context}): Successfully fetched HTML content (length: {len(html_content)}).")
            return html_content, None
        except requests.exceptions.Timeout:
            print(f"Backend ({context}): Timeout fetching {url} (Attempt {attempt + 1})")
            error_reason = "Timeout"
        except requests.exceptions.HTTPError as http_err:
             print(f"Backend ({context}): HTTP error fetching {url} (Attempt {attempt + 1}): {http_err}")
             error_reason = f"HTTP Error: {http_err.response.status_code}"
             if http_err.response.status_code == 404:
                 return None, f"Page not found (404)" # Non-retryable for 404
        except requests.exceptions.RequestException as e:
            print(f"Backend ({context}): Request error fetching {url} (Attempt {attempt + 1}): {e}")
            error_reason = f"RequestException: {e}"
        except Exception as e:
            print(f"Backend ({context}): Unknown error fetching {url} (Attempt {attempt + 1}): {e}")
            traceback.print_exc()
            error_reason = f"Unknown Error: {e}"

        if attempt < AI_MAX_RETRIES - 1:
            time.sleep(AI_RETRY_DELAY)
        else:
            print(f"Backend ({context}): Max retries reached for fetching HTML. Last error: {error_reason}")
            return None, f"Failed to fetch HTML after {AI_MAX_RETRIES} attempts ({error_reason})"

    return None, "Failed to fetch HTML (Loop ended unexpectedly)"


# --- NEW: Get YFSP Episode List ---
def get_yfsp_episode_list_backend(video_id, base_url):
    # Use the first episode's play page URL to get the list, as it likely contains it
    # Example: /iyfplay/65978-1-1/
    # We need to guess the first episode structure. Let's assume 'video_id-1-1'.
    # This might need adjustment if the URL structure varies.
    first_episode_path = f"/iyfplay/{video_id}-1-1/"
    page_url_to_parse = urljoin(base_url, first_episode_path)
    print(f"Backend (YFSP Episode List): Attempting to fetch HTML for list from {page_url_to_parse}")

    html_content, error = fetch_html(page_url_to_parse, "YFSP Episode List Fetch")
    if error:
        # Fallback: Try the main detail page? e.g., /iyf/65978/
        detail_page_path = f"/iyf/{video_id}/"
        page_url_to_parse = urljoin(base_url, detail_page_path)
        print(f"Backend (YFSP Episode List): First episode page failed ({error}). Falling back to detail page {page_url_to_parse}")
        html_content, error = fetch_html(page_url_to_parse, "YFSP Detail Page Fetch")
        if error:
            return None, f"Failed to fetch HTML for episode list from both play and detail pages: {error}"

    # Use backend's default AI settings for parsing
    episode_list, ai_error = parse_episode_list_with_ai(
        html_content,
        DEFAULT_AI_API_URL,
        DEFAULT_AI_API_KEY,
        DEFAULT_AI_MODEL
    )

    if ai_error:
        return None, f"AI failed to parse episode list: {ai_error}"

    return episode_list, None


# --- MODIFIED: Get YFSP M3U8 for a SPECIFIC Episode Link ---
def get_yfsp_m3u8_for_episode_link(episode_link_path, base_url):
    """Fetches M3U8 for a specific episode link path like /iyfplay/65978-1-5/"""
    if not episode_link_path or not episode_link_path.startswith('/'):
        return None, "Invalid episode link path provided"

    episode_page_url = urljoin(base_url, episode_link_path)
    print(f"Backend (YFSP M3U8): Fetching HTML for M3U8 from {episode_page_url}")

    html_content, fetch_error = fetch_html(episode_page_url, f"YFSP M3U8 Fetch {episode_link_path}")
    if fetch_error:
        return None, f"Failed to fetch HTML for episode {episode_link_path}: {fetch_error}"

    # Use backend's default AI settings for parsing M3U8
    m3u8_url, ai_error = parse_m3u8_url_with_ai(
        html_content,
        DEFAULT_AI_API_URL,
        DEFAULT_AI_API_KEY,
        DEFAULT_AI_MODEL
    )

    if ai_error:
        return None, f"AI failed to parse M3U8 for episode {episode_link_path}: {ai_error}"

    if not m3u8_url:
        return None, f"AI did not return a valid M3U8 URL for episode {episode_link_path}"

    # Construct the final player URL using the template
    final_player_url = YFSP_FINAL_PLAYER_TEMPLATE.format(m3u8_url)
    print(f"Backend (YFSP M3U8): Constructed final player URL: {final_player_url}")
    return final_player_url, None

# --- API Endpoints ---

@app.route('/api/search', methods=['POST'])
def handle_search():
    start_time = time.time()
    data = request.json
    query = data.get('query')
    method = data.get('method', 'ai')
    settings = data.get('settings', {})

    if not query:
        return jsonify({"error": "Query parameter is required"}), 400

    results = []
    error_message = None

    if method == 'yfsp':
        print(f"Backend: Received YFSP search request for '{query}'")
        results = search_yfsp_backend(query)
        # Add method indicator
        for r in results: r['method'] = 'yfsp'

    elif method == 'ai':
        print(f"Backend: Received AI search request for '{query}'")
        searxng_url = settings.get('searxngUrl') or DEFAULT_SEARXNG_URL
        ai_url = settings.get('aiApiUrl') or DEFAULT_AI_API_URL
        # Use user-provided key first, fallback to default backend key
        ai_key_to_use = settings.get('aiApiKey') or DEFAULT_AI_API_KEY
        ai_model = settings.get('aiModel') or DEFAULT_AI_MODEL

        # *** Crucial Config Check ***
        if not ai_key_to_use or "PLACEHOLDER" in ai_key_to_use or "YOUR_FALLBACK_OR_PLACEHOLDER_KEY" in ai_key_to_use:
             print("Backend Error: AI API Key is missing or is a placeholder. Check Env Vars and user settings.")
             return jsonify({"error": "AI API Key is not configured or provided properly."}), 500
        if not ai_url: return jsonify({"error": "AI API URL is not configured."}), 500
        if not ai_model: return jsonify({"error": "AI Model is not configured."}), 500
        if not searxng_url: return jsonify({"error": "SearXNG URL is not configured."}), 500

        raw_results = search_searxng_backend(query, searxng_url)
        if not raw_results:
            print("Backend (AI Method): No results from SearXNG.")
            # Return empty list, not an error
        else:
             filtered_results, ai_error = filter_links_with_ai_backend(raw_results, ai_url, ai_key_to_use, ai_model)
             if ai_error:
                 # Don't halt everything, just log it and return empty results for AI method
                 print(f"Backend (AI Method): AI filtering failed: {ai_error}")
                 # Return empty list, let frontend know maybe? Or just empty list.
                 # Let's return the error message to frontend
                 error_message = f"AI 过滤失败: {ai_error}"
                 results = [] # Ensure results is empty list on failure
             elif filtered_results is not None:
                 for r in filtered_results: r['method'] = 'ai'
                 results = filtered_results
             else:
                 # Should not happen if ai_error handling is correct, but as fallback
                 results = []

    else:
        return jsonify({"error": "Invalid search method specified"}), 400

    end_time = time.time()
    print(f"Backend: Search request for '{query}' (method: {method}) completed in {end_time - start_time:.2f} seconds. Returning {len(results)} results.")

    # If there was an error during AI filtering, return it along with empty results
    if error_message:
        return jsonify({"error": error_message, "results": []})
    else:
        return jsonify(results)


# --- NEW API Endpoint: Get Episode List ---
@app.route('/api/get_episode_list', methods=['POST'])
def handle_get_episode_list():
    start_time = time.time()
    data = request.json
    video_id = data.get('id')
    base_url = data.get('base_url')

    if not video_id or not base_url:
        return jsonify({"error": "Missing 'id' or 'base_url'"}), 400

    print(f"Backend: Received request for YFSP episode list: id={video_id}, base={base_url}")

    episode_list, error = get_yfsp_episode_list_backend(video_id, base_url)

    end_time = time.time()
    if error:
        print(f"Backend: Failed to get episode list for {video_id} in {end_time - start_time:.2f}s. Error: {error}")
        return jsonify({"error": f"获取剧集列表失败: {error}"}), 500
    else:
        print(f"Backend: Successfully got {len(episode_list)} episodes for {video_id} in {end_time - start_time:.2f}s.")
        return jsonify(episode_list)


# --- MODIFIED API Endpoint: Get Player URL for Specific Episode Link ---
@app.route('/api/get_episode_details', methods=['POST'])
def handle_get_episode_details():
    start_time = time.time()
    data = request.json
    # Now expects 'episode_link' (relative path) instead of 'episode' number
    episode_link_path = data.get('episode_link')
    base_url = data.get('base_url')

    if not episode_link_path or not base_url:
        return jsonify({"error": "Missing 'episode_link' or 'base_url'"}), 400

    print(f"Backend: Received request for YFSP player URL for link: {episode_link_path}, base={base_url}")

    final_player_url, error = get_yfsp_m3u8_for_episode_link(episode_link_path, base_url)

    end_time = time.time()
    if error:
        print(f"Backend: Failed to get player URL for {episode_link_path} in {end_time - start_time:.2f}s. Error: {error}")
        return jsonify({"error": f"无法获取剧集播放信息: {error}"}), 500
    else:
        print(f"Backend: Successfully got player URL for {episode_link_path} in {end_time - start_time:.2f}s.")
        return jsonify({"player_url": final_player_url})


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
        # DO NOT send default AI URL/Key/Model here for security
    }
    return jsonify(config_data)

# --- Serve Frontend ---
@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    # Allow serving files also from subdirectories like 'static' if needed
    # Check if the path actually exists to prevent directory traversal issues
    safe_path = os.path.abspath(os.path.join(app.static_folder, path))
    if safe_path.startswith(os.path.abspath(app.static_folder)):
        return send_from_directory(app.static_folder, path)
    else:
        return "Not Found", 404

# Vercel needs the 'app' variable
# No need for if __name__ == '__main__': app.run(...) for Vercel
