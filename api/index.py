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

AI_MAX_TOKENS = 30000 # 用于内容提取
AI_MAX_TOKENS_PARSING = 2000 # 用于解析特定结构，可以小一点
AI_MAX_TOKENS_EPISODE_LIST = 4000 # 用于提取剧集列表
AI_TEMPERATURE = 0.0 # 保持确定性输出
AI_MAX_RETRIES = 3 # 重试次数
AI_RETRY_DELAY = 1 # 重试延迟（秒）

# --- Constants for YFSP ---
YFSP_BASE_URL = "https://www.yfsp.lv" # 确保这是正确的、可访问的基础 URL
YFSP_SEARCH_TEMPLATE = "https://www.yfsp.lv/s/-------------/?wd={}"
YFSP_PLAY_PAGE_TEMPLATE = "{base_url}/iyfplay/{video_id}-1-{episode_num}/" # 播放页面模板
YFSP_FINAL_PLAYER_TEMPLATE = "https://b.212133.xyz/player/ec.php?code=qw&if=1&url={}" # 最终播放器模板 (如果需要的话)
REQUEST_HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'} # 更新 UA

# --- Helper Function: Extract Domain ---
def get_domain(url):
    try:
        return urlparse(url).netloc
    except:
        return "Unknown"

# --- Helper Function: Safe AI Request with Retries ---
def make_ai_request_with_retry(ai_url, headers, payload, timeout=90):
    """Makes AI API request with retry logic."""
    last_exception = None
    for attempt in range(AI_MAX_RETRIES):
        print(f"Backend (AI Request): Attempt {attempt + 1}/{AI_MAX_RETRIES} to {ai_url}")
        response = None
        try:
            response = requests.post(ai_url, headers=headers, json=payload, timeout=timeout)
            response.raise_for_status() # Raises HTTPError for bad responses (4xx or 5xx)
            # If successful, return the JSON response
            return response.json()
        except requests.exceptions.Timeout:
            print(f"Backend (AI Request): Timeout on attempt {attempt + 1}")
            last_exception = requests.exceptions.Timeout(f"AI API timeout after {timeout}s")
        except requests.exceptions.RequestException as e:
            print(f"Backend (AI Request): Request error on attempt {attempt + 1}: {e}")
            last_exception = e
            # Stop retrying for auth errors
            if response is not None and response.status_code in [401, 403]:
                print("Backend (AI Request): Authentication error. Stopping retries.")
                raise e # Re-raise immediately
        except Exception as e: # Catch other potential errors during the request
             print(f"Backend (AI Request): Unexpected error during request attempt {attempt + 1}: {e}")
             last_exception = e

        # If not the last attempt, wait before retrying
        if attempt < AI_MAX_RETRIES - 1:
            print(f"Backend (AI Request): Waiting {AI_RETRY_DELAY}s before retrying...")
            time.sleep(AI_RETRY_DELAY)
        else:
            print("Backend (AI Request): Max retries reached.")
            # If loop finishes without success, raise the last known exception
            if last_exception:
                raise last_exception
            else:
                # Should not happen if try block failed, but as a fallback
                raise Exception("AI request failed after max retries without specific exception.")
    # Should be unreachable if logic is correct, but as a safeguard
    raise Exception("AI request failed after max retries.")


# --- SearXNG Search Function (Original AI Method) ---
def search_searxng_backend(query, searxng_url):
    params = {
        'q': query, 'categories': 'general', 'language': 'auto',
        'time_range': '', 'safesearch': '0', 'theme': 'simple', 'format': 'html'
    }
    search_results = []
    print(f"Backend (AI Method): Searching SearXNG ({searxng_url}) for: {query}")
    try:
        # Using a common session might be slightly more efficient
        with requests.Session() as session:
             session.headers.update(REQUEST_HEADERS)
             response = session.get(searxng_url, params=params, timeout=20)
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

# --- AI Filtering Function (Original AI Method - WITH RETRY) ---
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
    if not results_list: return []

    print(f"Backend (AI Filter): Sending {len(results_list)} results to AI ({ai_url}, model: {ai_model})")
    input_data_for_ai = "\n".join([f"Title: {item['title']}\nURL: {item['link']}" for item in results_list])
    prompt_to_use = AI_PROMPT_CN_FILTER.format(input_data_for_ai=input_data_for_ai)

    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
    payload = {
        "model": ai_model, "messages": [{"role": "user", "content": prompt_to_use}],
        "max_tokens": AI_MAX_TOKENS, "temperature": AI_TEMPERATURE, "stream": False
    }

    try:
        ai_response = make_ai_request_with_retry(ai_url, headers, payload, timeout=90) # Use helper

        if 'choices' in ai_response and len(ai_response['choices']) > 0:
            content = ai_response['choices'][0].get('message', {}).get('content')
            if content:
                print("Backend (AI Filter): AI response received, parsing JSON...")
                try:
                    json_content = content.strip()
                    # Basic cleaning of potential markdown code blocks
                    if json_content.startswith("```json"): json_content = json_content[7:]
                    if json_content.endswith("```"): json_content = json_content[:-3]
                    json_content = json_content.strip()

                    parsed_data = json.loads(json_content)
                    if isinstance(parsed_data, list):
                        validated_data = []
                        for item in parsed_data:
                            # Basic validation
                            if isinstance(item, dict) and 'title' in item and 'video_link' in item:
                                if 'website' not in item or not item['website']:
                                     item['website'] = get_domain(item['video_link'])
                                validated_data.append(item)
                        print(f"Backend (AI Filter): AI parsed {len(validated_data)} valid items.")
                        return validated_data
                    else:
                         print(f"Backend (AI Filter): AI did not return a JSON list. Content: {content[:200]}...")
                         # Treat unexpected format as failure for this call, don't retry JSON format errors
                         return None # Indicate failure
                except json.JSONDecodeError as json_e:
                    print(f"Backend (AI Filter): AI JSON parsing error: {json_e}. Content: {content[:200]}...")
                    # Don't retry on parsing error of AI's response
                    return None # Indicate failure
            else:
                print("Backend (AI Filter): AI response content is empty.")
                # Treat empty content as failure, might retry if make_ai_request allows
                return None # Indicate potential issue
        else:
            print(f"Backend (AI Filter): Unexpected AI response structure: {ai_response}")
            return None # Indicate failure

    except requests.exceptions.RequestException as e:
        # Catch errors from make_ai_request_with_retry if all retries failed
        print(f"Backend (AI Filter): AI API request failed after retries: {e}")
        return None # Indicate failure
    except Exception as e:
        print(f"Backend (AI Filter): Unknown error during AI processing: {e}")
        return None # Indicate failure


# --- YFSP Search Function (No Change Needed Here) ---
def search_yfsp_backend(query):
    search_url = YFSP_SEARCH_TEMPLATE.format(query)
    results = []
    print(f"Backend (YFSP Method): Searching YFSP for: {query} at {search_url}")
    try:
        # Using a session
        with requests.Session() as session:
            session.headers.update(REQUEST_HEADERS)
            response = session.get(search_url, timeout=20)
            response.raise_for_status()
            response.encoding = response.apparent_encoding # Detect encoding

            soup = BeautifulSoup(response.text, 'html.parser')
            # Refined selector based on common structures
            items = soup.select('.module-items .module-item, .module-main .module-card-item.module-item') # Try common patterns
            print(f"Backend (YFSP Method): Found {len(items)} potential result items.")

            for item in items:
                title_tag = item.select_one('.module-card-item-title a, .module-item-title a')
                poster_link_tag = item.select_one('a.module-card-item-poster, a.module-item-poster')
                img_tag = item.select_one('.module-item-pic img.lazyload, .module-item-pic img') # Handle lazyload and direct img

                title = title_tag.get_text(strip=True) if title_tag else None
                # Get detail page link (might be relative)
                detail_page_stub = poster_link_tag.get('href') if poster_link_tag else None
                # Get cover image (might be in 'data-original' or 'src')
                cover_img_stub = img_tag.get('data-original') or img_tag.get('src') if img_tag else None

                if title and detail_page_stub and cover_img_stub:
                    # Extract ID, assuming format /iyfdetail/XXXXX/ or similar
                    match = re.search(r'/(\d+)/?$', detail_page_stub)
                    if match:
                        video_id = match.group(1)
                        # Make cover URL absolute
                        cover_url = urljoin(YFSP_BASE_URL, cover_img_stub)
                        results.append({
                            "title": title,
                            "cover": cover_url,
                            "id": video_id,
                            "base_url": YFSP_BASE_URL # Pass base URL for constructing play links later
                        })
                    else:
                         print(f"Backend (YFSP Method): Could not extract ID from detail link: {detail_page_stub}")
                else:
                     # Log which part is missing for debugging
                     missing = []
                     if not title: missing.append("title")
                     if not detail_page_stub: missing.append("detail_link")
                     if not cover_img_stub: missing.append("cover_image")
                     print(f"Backend (YFSP Method): Skipping item due to missing data: {', '.join(missing)}")

    except requests.exceptions.Timeout: print(f"Backend (YFSP Method): Timeout searching {search_url}")
    except requests.exceptions.RequestException as e: print(f"Backend (YFSP Method): Request error searching {search_url}: {e}")
    except Exception as e: print(f"Backend (YFSP Method): Error parsing YFSP search results: {e}")

    print(f"Backend (YFSP Method): Extracted {len(results)} valid results.")
    return results


# --- NEW: AI Function to Parse YFSP Episode List HTML (WITH RETRY) ---
AI_PROMPT_YFSP_EPISODE_LIST = """
请仔细分析以下提供的 HTML 内容，这段内容来自一个视频播放页面，包含了剧集列表。
你的任务是定位到包含剧集链接列表的父容器。这个容器通常是 `<div class="module-play-list-content">` 或类似的结构，内部包含多个 `<a>` 标签，每个 `<a>` 标签代表一集。
每个 `<a>` 标签具有类似 `class="module-play-list-link"` 的属性，并且包含一个 `<span>` 标签，`<span>` 内的文本是剧集编号（例如 "01", "02", "第3集" 等）。 `<a>` 标签的 `href` 属性是该剧集的相对或绝对链接。

请提取这个列表中的所有剧集信息。
返回一个 JSON 列表对象，列表中的每个对象代表一集，并包含以下键：
- "episode": 从 `<span>` 标签中提取的剧集编号或名称 (例如 "01", "52", "番外篇").
- "link": 从 `<a>` 标签的 `href` 属性中提取的链接 (例如 "/iyfplay/65978-1-1/", "/iyfplay/65978-1-52/").

请确保提取所有找到的剧集链接。
如果 HTML 中找不到符合描述的剧集列表结构，请返回一个空的 JSON 列表：`[]`。

返回结果必须是且仅是这个 JSON 列表对象。不要包含任何解释性文字或 ```json 标记。

以下是需要分析的 HTML 内容片段：
--- START HTML ---
{html_content_snippet}
--- END HTML ---

你的 JSON 输出：
"""

def extract_yfsp_episode_list_ai(html_content, ai_url, ai_key, ai_model):
    """
    Uses AI to parse HTML and extract the list of episodes.
    Args:
        html_content (str): The full HTML content of the first episode's play page.
        ai_url, ai_key, ai_model: AI configuration (using backend defaults).
    Returns:
        list: A list of episode dicts [{"episode": "...", "link": "..."}, ...] or None on failure.
    """
    if not html_content: return None
    print(f"Backend (YFSP Epi List AI): Sending HTML to AI ({ai_url}, model: {ai_model}) for episode list extraction.")

    # --- Use BeautifulSoup to find the relevant block first ---
    # This significantly reduces the amount of data sent to the AI and focuses its task.
    soup = BeautifulSoup(html_content, 'html.parser')
    # Look for potential containers - adjust selectors if needed based on YFSP structure
    episode_list_container = soup.select_one('#panel2 .module-play-list-content, .module-list.play-list .module-play-list-content, .content_playlist') # Add more selectors if needed
    
    if not episode_list_container:
        print("Backend (YFSP Epi List AI): Could not find episode list container using BS4 selectors.")
        # Optional: Fallback to sending more HTML to AI if BS4 fails? Or just fail here? Let's fail for now.
        return None 
        
    html_snippet = str(episode_list_container)
    print(f"Backend (YFSP Epi List AI): Found container, sending snippet (length {len(html_snippet)}) to AI.")

    # Limit snippet size further if needed
    max_snippet_len = 25000 # Adjust as necessary
    if len(html_snippet) > max_snippet_len:
        print(f"Backend (YFSP Epi List AI): Snippet too long, truncating to {max_snippet_len} chars.")
        html_snippet = html_snippet[:max_snippet_len]


    prompt = AI_PROMPT_YFSP_EPISODE_LIST.format(html_content_snippet=html_snippet)
    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
    payload = {
        "model": ai_model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": AI_MAX_TOKENS_EPISODE_LIST, # Adjust token limit for list extraction
        "temperature": AI_TEMPERATURE,
        "stream": False
    }

    try:
        ai_response = make_ai_request_with_retry(ai_url, headers, payload, timeout=60) # Use helper

        if 'choices' in ai_response and len(ai_response['choices']) > 0:
            content = ai_response['choices'][0].get('message', {}).get('content')
            if content:
                print("Backend (YFSP Epi List AI): AI response received, parsing JSON list...")
                try:
                    json_content = content.strip()
                    if json_content.startswith("```json"): json_content = json_content[7:]
                    if json_content.endswith("```"): json_content = json_content[:-3]
                    json_content = json_content.strip()

                    parsed_data = json.loads(json_content)
                    if isinstance(parsed_data, list):
                        # Basic validation of list items
                        validated_list = []
                        for item in parsed_data:
                             if isinstance(item, dict) and 'episode' in item and 'link' in item:
                                 # Optional: Make link absolute if it's relative
                                 item['link'] = urljoin(YFSP_BASE_URL, item['link'])
                                 validated_list.append(item)
                        print(f"Backend (YFSP Epi List AI): Successfully parsed {len(validated_list)} episode items.")
                        return validated_list
                    else:
                        print(f"Backend (YFSP Epi List AI): AI did not return a JSON list. Content: {content[:200]}...")
                        return None # Indicate failure

                except json.JSONDecodeError as json_e:
                    print(f"Backend (YFSP Epi List AI): AI JSON *result* parsing error: {json_e}. Content: {content[:200]}...")
                    return None # Indicate failure (don't retry parse errors)
            else:
                print("Backend (YFSP Epi List AI): AI response content is empty.")
                return None # Indicate failure
        else:
            print(f"Backend (YFSP Epi List AI): Unexpected AI response structure: {ai_response}")
            return None # Indicate failure

    except requests.exceptions.RequestException as e:
        print(f"Backend (YFSP Epi List AI): AI API request failed after retries: {e}")
        return None # Indicate failure
    except Exception as e:
        print(f"Backend (YFSP Epi List AI): Unknown error during AI processing: {e}")
        return None # Indicate failure


# --- AI Function to Parse Episode Page for M3U8 (WITH RETRY) ---
AI_PROMPT_YFSP_M3U8 = f"""
请仔细分析以下提供的视频播放页面的 HTML 内容。
在 HTML 中找到定义了 `player_aaaa` JavaScript 变量的 `<script>` 代码块。这个变量被赋值为一个 JSON 对象。
请精确地解析这个 JSON 对象。
提取与键 "url" 相关联的值 (这是主要的 M3U8 链接)。也尝试提取 "url_next" (下一集的预加载链接，如果存在)。

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
{{html_content}}
--- END HTML ---

你的 JSON 输出：
"""

def parse_episode_html_with_ai(html_content, ai_url, ai_key, ai_model):
    """
    Uses AI to parse the episode page HTML and extract m3u8 URLs from player_aaaa.
    Args:
        html_content (str): The full HTML content of the specific episode page.
        ai_url, ai_key, ai_model: AI configuration (using backend defaults).
    Returns:
        dict: A dictionary containing 'url' and 'url_next' or an 'error' key.
              Example: {"url": "...", "url_next": "..."} or {"error": "message"}
              Returns None on request/retry failure.
    """
    if not html_content: return {"error": "HTML content is empty"}
    print(f"Backend (YFSP M3U8 AI): Sending HTML to AI ({ai_url}, model: {ai_model}) for M3U8 parsing.")

    # Limit HTML size sent to AI
    max_html_len = 25000
    if len(html_content) > max_html_len:
        print(f"Backend (YFSP M3U8 AI): HTML too long, truncating to {max_html_len} chars.")
        # Try to find script tag containing player_aaaa first? More robust but complex.
        # For now, just truncate.
        html_content_truncated = html_content[:max_html_len]
    else:
        html_content_truncated = html_content


    prompt = AI_PROMPT_YFSP_M3U8.format(html_content=html_content_truncated)
    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
    payload = {
        "model": ai_model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": AI_MAX_TOKENS_PARSING, # Parsing result should be small
        "temperature": AI_TEMPERATURE,
        "stream": False
    }

    try:
        ai_response = make_ai_request_with_retry(ai_url, headers, payload, timeout=60) # Use helper

        if 'choices' in ai_response and len(ai_response['choices']) > 0:
            content = ai_response['choices'][0].get('message', {}).get('content')
            if content:
                print("Backend (YFSP M3U8 AI): AI response received, parsing JSON result...")
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
                         print(f"Backend (YFSP M3U8 AI): Successfully parsed AI result: {parsed_data}")
                         # Clean up potential escaped slashes in URLs if AI didn't do it
                         if parsed_data.get('url'):
                             parsed_data['url'] = parsed_data['url'].replace('\\/', '/')
                         if parsed_data.get('url_next'):
                              parsed_data['url_next'] = parsed_data['url_next'].replace('\\/', '/')
                         return parsed_data # Return the parsed dict
                    else:
                         print(f"Backend (YFSP M3U8 AI): AI returned unexpected JSON structure: {parsed_data}")
                         return {"error": "AI returned unexpected JSON structure"}

                except json.JSONDecodeError as json_e:
                    print(f"Backend (YFSP M3U8 AI): AI JSON *result* parsing error: {json_e}. Content: {content[:200]}...")
                    # Don't retry on parsing error of AI's response
                    return {"error": f"AI JSON result parsing error: {json_e}"}
            else:
                print("Backend (YFSP M3U8 AI): AI response content is empty.")
                return {"error": "AI response content is empty"} # Treat as error
        else:
            print(f"Backend (YFSP M3U8 AI): Unexpected AI response structure: {ai_response}")
            return {"error": "Unexpected AI response structure from API"} # Treat as error

    except requests.exceptions.RequestException as e:
        print(f"Backend (YFSP M3U8 AI): AI API request failed after retries: {e}")
        return None # Indicate request/retry failure
    except Exception as e:
        print(f"Backend (YFSP M3U8 AI): Unknown error during AI processing: {e}")
        return None # Indicate other failure


# --- MODIFIED: YFSP Get Episode Details Function (Gets M3U8 for a SPECIFIC episode) ---
def get_yfsp_episode_details(video_id, episode_num, base_url):
    """Fetches the specific episode page and uses AI to get the M3U8 URL."""
    episode_page_url = YFSP_PLAY_PAGE_TEMPLATE.format(base_url=base_url, video_id=video_id, episode_num=episode_num)
    print(f"Backend (YFSP Detail): Fetching episode page HTML from {episode_page_url} for M3U8 extraction")

    try:
        with requests.Session() as session:
             session.headers.update(REQUEST_HEADERS)
             response = session.get(episode_page_url, timeout=20)
             response.raise_for_status()
             response.encoding = response.apparent_encoding
             html_content = response.text

        if not html_content or len(html_content) < 500: # Basic check
             print(f"Backend (YFSP Detail): HTML content from {episode_page_url} seems empty or too small.")
             return None # Indicate failure to get HTML

        # --- Call AI to parse the HTML for M3U8 ---
        # Use default backend AI settings
        ai_result = parse_episode_html_with_ai(
            html_content,
            DEFAULT_AI_API_URL,
            DEFAULT_AI_API_KEY,
            DEFAULT_AI_MODEL
        )

        # --- Process AI Result ---
        if ai_result is None: # Check for None which indicates request/retry failure
             print(f"Backend (YFSP Detail): AI M3U8 parsing failed due to request errors or retries exhaustion.")
             return None # Indicate failure
        elif 'error' in ai_result:
            error_msg = ai_result.get('error', 'Unknown AI parsing error')
            print(f"Backend (YFSP Detail): AI failed to parse M3U8 from episode HTML: {error_msg}")
            return None # Indicate failure
        elif not ai_result.get('url'):
             print(f"Backend (YFSP Detail): AI did not return a 'url' (M3U8 link) key or it was null.")
             return None # Indicate failure
        else:
            m3u8_url = ai_result['url']
            # Construct the final player link using the template if necessary, or return raw m3u8?
            # Let's assume the YFSP_FINAL_PLAYER_TEMPLATE uses the extracted M3U8.
            # final_player_url = YFSP_FINAL_PLAYER_TEMPLATE.format(m3u8_url) # Use this if template is needed

            # It's often better to return the raw m3u8 if the frontend player can handle it directly
            # Let's return the M3U8 URL directly. The frontend needs adjustment if it expects the template.
            # OR, we return the template URL if the frontend expects that. Let's stick to the template for now.
            final_player_url = YFSP_FINAL_PLAYER_TEMPLATE.format(m3u8_url)

            print(f"Backend (YFSP Detail): AI extracted M3U8 URL: {m3u8_url}")
            print(f"Backend (YFSP Detail): Constructed final player URL: {final_player_url}")
            return final_player_url # Return the URL for the iframe

    except requests.exceptions.Timeout:
        print(f"Backend (YFSP Detail): Timeout fetching episode page {episode_page_url}")
        return None
    except requests.exceptions.RequestException as e:
        if e.response is not None and e.response.status_code == 404:
             print(f"Backend (YFSP Detail): Episode page not found (404): {episode_page_url}")
        else:
             print(f"Backend (YFSP Detail): Request error fetching episode page {episode_page_url}: {e}")
        return None
    except Exception as e:
        print(f"Backend (YFSP Detail): Error processing episode page {episode_page_url}: {e}")
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

    # --- YFSP Search Method ---
    if method == 'yfsp':
        print(f"Backend: Received YFSP search request for '{query}'")
        results = search_yfsp_backend(query)
        # Add method indicator for frontend
        for r in results: r['method'] = 'yfsp'
        return jsonify(results)

    # --- AI Search Method ---
    elif method == 'ai':
        print(f"Backend: Received AI search request for '{query}'")
        # Determine effective AI/SearXNG config (user settings override defaults)
        searxng_url = settings.get('searxngUrl') or DEFAULT_SEARXNG_URL
        ai_url = settings.get('aiApiUrl') or DEFAULT_AI_API_URL
        ai_key = settings.get('aiApiKey') or DEFAULT_AI_API_KEY # User key takes precedence
        ai_model = settings.get('aiModel') or DEFAULT_AI_MODEL

        # *** Crucial Security/Config Check ***
        if not ai_key or "PLACEHOLDER" in ai_key or "YOUR_FALLBACK_OR_PLACEHOLDER_KEY" in ai_key:
             print("Backend Error: AI API Key is missing or is a placeholder for AI method. Check Vercel Env Vars and user settings.")
             # Allow fallback if default key is valid and user didn't provide one? No, user selected AI method. They need a key.
             return jsonify({"error": "AI 功能需要有效的 API Key。请在设置中提供或确保后端默认 Key 已配置。"}), 500
        if not ai_url: return jsonify({"error": "AI API URL is not configured."}), 500
        if not ai_model: return jsonify({"error": "AI Model is not configured."}), 500
        if not searxng_url: return jsonify({"error": "SearXNG URL is not configured."}), 500

        raw_results = search_searxng_backend(query, searxng_url)
        if not raw_results:
            print("Backend (AI Method): No results from SearXNG.")
            return jsonify([])

        # Filter results using AI (with potentially user-provided key)
        filtered_results = filter_links_with_ai_backend(raw_results, ai_url, ai_key, ai_model)

        if filtered_results is None: # Check for None which indicates failure
            return jsonify({"error": "AI 处理搜索结果失败（可能多次尝试后仍然失败）。"}), 500
        else:
             # Add method indicator for frontend
             for r in filtered_results: r['method'] = 'ai'
             return jsonify(filtered_results)

    else:
        return jsonify({"error": "Invalid search method specified"}), 400

# --- NEW: API Endpoint to Get YFSP Episode List ---
@app.route('/api/get_yfsp_episode_list', methods=['POST'])
def handle_get_yfsp_episode_list():
    data = request.json
    video_id = data.get('id')
    base_url = data.get('base_url')

    if not video_id or not base_url:
        return jsonify({"error": "Missing 'id' or 'base_url'"}), 400

    print(f"Backend: Received request for YFSP episode list: id={video_id}, base={base_url}")

    # Fetch the *first* episode's page to get the list HTML
    first_episode_url = YFSP_PLAY_PAGE_TEMPLATE.format(base_url=base_url, video_id=video_id, episode_num=1)
    html_content = None
    try:
         with requests.Session() as session:
             session.headers.update(REQUEST_HEADERS)
             response = session.get(first_episode_url, timeout=20)
             response.raise_for_status()
             response.encoding = response.apparent_encoding
             html_content = response.text
             if not html_content or len(html_content) < 300:
                  raise ValueError("Fetched HTML content seems too small or empty.")
    except requests.exceptions.RequestException as e:
        print(f"Backend: Failed to fetch first episode page ({first_episode_url}): {e}")
        return jsonify({"error": f"无法访问剧集列表页面: {e}"}), 500
    except ValueError as e:
         print(f"Backend: Issue with HTML content from {first_episode_url}: {e}")
         return jsonify({"error": "获取的剧集列表页面内容无效。"}), 500
    except Exception as e:
        print(f"Backend: Unexpected error fetching first episode page ({first_episode_url}): {e}")
        return jsonify({"error": "获取剧集列表时发生未知错误。"}), 500


    # *** IMPORTANT: Use BACKEND DEFAULT AI Config for YFSP functions ***
    if not DEFAULT_AI_API_KEY or "PLACEHOLDER" in DEFAULT_AI_API_KEY or "YOUR_FALLBACK_OR_PLACEHOLDER_KEY" in DEFAULT_AI_API_KEY:
        print("Backend Error: Default AI API Key is not configured. YFSP episode list extraction requires it.")
        return jsonify({"error": "后端 AI 配置不完整，无法提取 YFSP 剧集列表。"}), 500

    # Call AI to extract the list from the fetched HTML
    episode_list = extract_yfsp_episode_list_ai(
        html_content,
        DEFAULT_AI_API_URL,
        DEFAULT_AI_API_KEY,
        DEFAULT_AI_MODEL
    )

    if episode_list is None: # Indicates AI failure
        return jsonify({"error": "使用 AI 提取剧集列表失败（可能多次尝试后仍失败）。"}), 500
    elif not episode_list: # Empty list returned by AI (or parsing failed validation)
         # Could be genuinely no episodes, or AI failed to find the pattern
         print(f"Backend: AI returned an empty or invalid episode list for {video_id}.")
         # Let's return empty list to frontend, it can display a message.
         return jsonify([])
    else:
        print(f"Backend: Successfully extracted {len(episode_list)} episodes for {video_id}.")
        return jsonify(episode_list)


@app.route('/api/get_episode_details', methods=['POST'])
def handle_get_episode_details():
    data = request.json
    video_id = data.get('id')
    episode_num = data.get('episode', 1) # Default to 1 if not provided, though should be
    base_url = data.get('base_url')

    if not video_id or not base_url or episode_num is None: # Check episode_num too
        return jsonify({"error": "Missing 'id', 'base_url', or 'episode' number"}), 400

    # Ensure episode_num is treated as a string or number consistently if needed by the template
    try:
        episode_num_str = str(episode_num)
    except:
        return jsonify({"error": "Invalid 'episode' number format"}), 400

    print(f"Backend: Received request for YFSP episode details: id={video_id}, ep={episode_num_str}, base={base_url}")

    # *** IMPORTANT: Use BACKEND DEFAULT AI Config for YFSP functions ***
    if not DEFAULT_AI_API_KEY or "PLACEHOLDER" in DEFAULT_AI_API_KEY or "YOUR_FALLBACK_OR_PLACEHOLDER_KEY" in DEFAULT_AI_API_KEY:
        print("Backend Error: Default AI API Key is not configured. YFSP M3U8 extraction requires it.")
        return jsonify({"error": "后端 AI 配置不完整，无法获取 YFSP 播放链接。"}), 500


    # This function now uses AI with backend's default credentials internally
    final_player_url = get_yfsp_episode_details(video_id, episode_num_str, base_url)

    if final_player_url:
        return jsonify({"player_url": final_player_url})
    else:
        # Give a slightly more specific error based on the new logic
        return jsonify({"error": f"无法获取剧集 {episode_num_str} 的播放信息（可能 AI 解析失败或页面无效）。"}), 500


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
    # Use safe_join to prevent path traversal
    safe_path = os.path.join(app.static_folder, 'index.html')
    if os.path.exists(safe_path):
        return send_from_directory(app.static_folder, 'index.html')
    else:
        print(f"Error: index.html not found in {app.static_folder}")
        return "index.html not found", 404


@app.route('/<path:path>')
def serve_static(path):
     # Basic security check: prevent accessing files outside static folder
    if '..' in path or path.startswith('/'):
         return "Invalid path", 400
         
    # Check if file exists to avoid errors
    full_path = os.path.join(app.static_folder, path)
    if os.path.isfile(full_path):
         return send_from_directory(app.static_folder, path)
    elif os.path.isfile(full_path + '.html'): # Try adding .html if it's a directory-like path
         return send_from_directory(app.static_folder, path + '.html')
    else:
        # Optionally, serve index.html for SPA routing (if needed)
        # return send_from_directory(app.static_folder, 'index.html')
        print(f"Warning: Static file not found: {path} in {app.static_folder}")
        return "Not Found", 404


# Vercel needs the 'app' variable for deployment
# No need for if __name__ == '__main__': app.run(...) for Vercel

