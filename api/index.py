# api/index.py
import os
import requests
from bs4 import BeautifulSoup
import json
import time
import re # Import regex module
from flask import Flask, request, jsonify, send_from_directory
from urllib.parse import urlparse, parse_qs, urljoin # To help AI extract website domain and join URLs
from dotenv import load_dotenv # For local development

# Load environment variables from .env file for local development
load_dotenv()

app = Flask(__name__, static_folder='../public', static_url_path='')

# --- Configuration ---
DEFAULT_AI_API_URL = os.getenv('AI_API_URL', "https://api.zetatechs.com/v1/chat/completions")
DEFAULT_AI_API_KEY = os.getenv('AI_API_KEY', "YOUR_FALLBACK_OR_PLACEHOLDER_KEY")
DEFAULT_AI_MODEL = os.getenv('AI_MODEL', "gemini-2.0-flash")
DEFAULT_SEARXNG_URL = os.getenv('SEARXNG_URL', "https://searxng.zetatechs.online/search")
DEFAULT_PARSING_INTERFACES_JSON = os.getenv('DEFAULT_PARSING_INTERFACES', json.dumps([
    {"name": "接口1 - xmflv.com", "url": "https://jx.xmflv.com/?url="},
    {"name": "接口2 - bd.jx.cn", "url": "https://bd.jx.cn/?url="},
    {"name": "接口3 - xmflv.cc", "url": "https://jx.xmflv.cc/?url="},
    {"name": "接口4 - hls.one", "url": "https://jx.hls.one/?url="},
    {"name": "接口5 - 77flv.cc", "url": "https://jx.77flv.cc/?url="},
    {"name": "接口6 - yemu.xyz", "url": "https://www.yemu.xyz/?url="}
]))

AI_MAX_TOKENS = 30000
AI_TEMPERATURE = 0.0
AI_MAX_RETRIES = 3
AI_RETRY_DELAY = 5 # seconds

# --- YFSP Configuration ---
YFSP_BASE_URL = "https://www.yfsp.lv"
YFSP_SEARCH_URL_TEMPLATE = "https://www.yfsp.lv/s/-------------/?wd={}"
# --- NEW: YFSP Detail Page URL Template (Assuming structure) ---
YFSP_DETAIL_URL_TEMPLATE = "https://www.yfsp.lv/iyftv/{}/" # Placeholder for video_id
YFSP_PLAYER_URL_PREFIX = "https://b.212133.xyz/player/ec.php?code=qw&if=1&url=" # Your target player prefix
COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'Referer': YFSP_BASE_URL # Often helpful
}

# --- Helper Function: Extract Domain ---
def get_domain(url):
    try:
        return urlparse(url).netloc
    except:
        return "Unknown"

# --- SearXNG Search Function ---
def search_searxng_backend(query, searxng_url):
    params = {
        'q': query, 'categories': 'general', 'language': 'auto',
        'time_range': '', 'safesearch': '0', 'theme': 'simple', 'format': 'html'
    }
    search_results = []
    print(f"Backend: Searching SearXNG ({searxng_url}) for: {query}")
    try:
        response = requests.get(searxng_url, params=params, headers=COMMON_HEADERS, timeout=20)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        result_articles = soup.find_all('article', class_='result')
        print(f"Backend: SearXNG found {len(result_articles)} raw results.")
        for article in result_articles:
            h3_tag = article.find('h3')
            if h3_tag:
                link_tag = h3_tag.find('a', href=True)
                if link_tag:
                    title = link_tag.get_text(strip=True)
                    link = link_tag['href']
                    if title and link.startswith('http') and len(link) > 10:
                        search_results.append({'title': title, 'link': link})
    except Exception as e:
        print(f"Backend: SearXNG Error: {e}")
    print(f"Backend: Extracted {len(search_results)} valid SearXNG results.")
    return search_results

# --- AI Filtering Function ---
def filter_links_with_ai_backend(results_list, ai_url, ai_key, ai_model):
    if not results_list: return []

    print(f"Backend: Sending {len(results_list)} results to AI ({ai_url}, model: {ai_model})")
    input_data_for_ai = "\n".join([f"Title: {item['title']}\nURL: {item['link']}" for item in results_list])

    # --- AI Prompt (Kept the same refined version) ---
    prompt = f"""
Analyze the following list of search results (each with a Title and URL).
Your task is to identify ONLY the URLs that point DIRECTLY to video playback pages for movies or TV series episodes.
Prioritize links from major video platforms like Tencent Video (v.qq.com), iQiyi (iq.com), Bilibili (bilibili.com), Youku (youku.com), Mango TV (mgtv.com), Wasu (wasu.cn), etc., but include ANY valid direct video playback link you find from other dedicated video streaming sites.

Explicitly EXCLUDE links to:
- General informational pages (like Wikipedia, Baidu Baike, Douban info pages without player)
- News articles, blog posts
- Forum discussions or communities (like Zhihu, Tieba, Reddit)
- Social media sites (unless it's an official platform channel hosting full episodes like YouTube)
- E-commerce sites, download sites, search results pages
- General website homepages or channel pages (unless the URL structure strongly implies direct playback)
- Short video clips (focus on full episodes/movies)
- URLs ending in .apk, .exe, .zip, .rar, .torrent, .magnet

Return your findings ONLY as a JSON list of objects. Each object in the list MUST have the following exact keys:
- "title": The original title associated with the identified video link.
- "video_link": The URL that you identified as a direct video playback link.
- "website": The domain name of the video platform extracted from the video_link (e.g., "v.qq.com", "bilibili.com", "iq.com"). Use the root domain (e.g., www.bilibili.com -> bilibili.com).

If no valid video playback links are found in the provided list, return an empty JSON list: [].
Do not include any explanations or introductory text outside the JSON structure. Just the JSON list itself.

Example of good link structure: https://www.mgtv.com/b/333923/12345678.html, https://v.qq.com/x/cover/abcdefg/hijklmn.html
Example of bad link: https://douban.com/movie/subject/123456/, https://baike.baidu.com/item/MovieName

Here is the list of search results to analyze:
--- START OF LIST ---
{input_data_for_ai}
--- END OF LIST ---

Your JSON output:
"""

    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
    payload = {
        "model": ai_model, "messages": [{"role": "user", "content": prompt}],
        "max_tokens": AI_MAX_TOKENS, "temperature": AI_TEMPERATURE, "stream": False
    }

    for attempt in range(AI_MAX_RETRIES):
        print(f"Backend: AI API attempt {attempt + 1}/{AI_MAX_RETRIES}")
        try:
            response = requests.post(ai_url, headers=headers, json=payload, timeout=90)
            response.raise_for_status()
            ai_response = response.json()

            if 'choices' in ai_response and len(ai_response['choices']) > 0:
                content = ai_response['choices'][0].get('message', {}).get('content')
                if content:
                    print("Backend: AI response received, attempting JSON parsing...")
                    try:
                        json_match = re.search(r'```json\s*([\s\S]*?)\s*```|(\[.*\]|\{.*\})', content, re.DOTALL)
                        if json_match:
                            json_content = json_match.group(1) or json_match.group(2)
                            json_content = json_content.strip()
                            parsed_data = json.loads(json_content)
                            if isinstance(parsed_data, list):
                                validated_data = []
                                for item in parsed_data:
                                    if isinstance(item, dict) and 'title' in item and 'video_link' in item:
                                        if 'website' not in item or not item['website']:
                                            item['website'] = get_domain(item['video_link'])
                                        validated_data.append(item)
                                print(f"Backend: AI successfully parsed {len(validated_data)} valid items.")
                                return validated_data
                            else:
                                print(f"Backend: AI did not return a JSON list after parsing. Parsed type: {type(parsed_data)}")
                                return []
                        else:
                            print(f"Backend: Could not find JSON block in AI response. Content starts with: {content[:200]}...")
                            return []
                    except json.JSONDecodeError as json_e:
                        print(f"Backend: AI JSON parsing error: {json_e}. Content fragment: {content[:200]}...")
                        return []
                else: print("Backend: AI response content is empty.")
            else: print(f"Backend: Unexpected AI response structure: {ai_response}")

        except requests.exceptions.Timeout: print(f"Backend: AI API timeout (Attempt {attempt + 1})")
        except requests.exceptions.RequestException as e:
            status_code = e.response.status_code if e.response is not None else 'N/A'
            print(f"Backend: AI API request error (Attempt {attempt + 1}): {e} (Status: {status_code})")
            if status_code in [401, 403]:
                print("Backend: AI Auth error, stopping retries.")
                return None # Indicate critical auth failure
        except Exception as e: print(f"Backend: Unknown error during AI processing: {e}")

        if attempt < AI_MAX_RETRIES - 1: time.sleep(AI_RETRY_DELAY)
        else: print("Backend: AI API max retries reached.")

    return None # Indicate failure after retries

# --- YFSP Search Function ---
def search_yfsp(query):
    search_url = YFSP_SEARCH_URL_TEMPLATE.format(requests.utils.quote(query))
    results = []
    print(f"Backend: Searching YFSP ({search_url}) for: {query}")
    try:
        response = requests.get(search_url, headers=COMMON_HEADERS, timeout=15)
        response.raise_for_status()
        response.encoding = response.apparent_encoding

        soup = BeautifulSoup(response.text, 'html.parser')
        items = soup.select('div.module-main div.module-items div.module-card-item.module-item')
        print(f"Backend: YFSP found {len(items)} potential result items.")

        for item in items:
            try:
                title_tag = item.select_one('.module-card-item-title a strong')
                title = title_tag.text.strip() if title_tag else None

                poster_link_tag = item.select_one('a.module-card-item-poster')
                # --- MODIFIED: Get detail href, not play href ---
                detail_href = poster_link_tag['href'] if poster_link_tag else None
                detail_url = urljoin(YFSP_BASE_URL, detail_href) if detail_href else None # Full URL to detail page

                cover_img_tag = item.select_one('.module-item-pic img.lazyload')
                cover_img = cover_img_tag['data-original'] if cover_img_tag and 'data-original' in cover_img_tag.attrs else None
                if cover_img and not cover_img.startswith(('http://', 'https://')):
                    cover_img = urljoin(YFSP_BASE_URL, cover_img)

                note_tag = item.select_one('.module-item-note')
                note = note_tag.text.strip() if note_tag else "N/A"

                # --- Extract video ID from detail_href ---
                video_id = None
                if detail_href:
                    # Example detail href: /iyftv/78888/ -> extract 78888
                    match = re.search(r'/(\d+)/?$', detail_href) # Match digits at the end, optionally followed by /
                    if match:
                        video_id = match.group(1)

                if title and detail_url and video_id:
                    results.append({
                        "title": title,
                        "cover_img": cover_img,
                        "note": note,
                        "video_id": video_id, # ID needed to fetch episodes
                        "detail_page_url": detail_url # URL for fetching episodes
                    })
                else:
                    print(f"Backend: Skipping item, missing title, detail_url, or video_id. Title: {title}, DetailURL: {detail_url}, VideoID: {video_id}")

            except Exception as e:
                print(f"Backend: Error parsing one YFSP item: {e}")
                continue

    except requests.exceptions.RequestException as e:
        print(f"Backend: YFSP Search Error: {e}")
    except Exception as e:
        print(f"Backend: General Error during YFSP search: {e}")

    print(f"Backend: Extracted {len(results)} valid YFSP results.")
    return results

# --- NEW: YFSP Episode List Extraction Function ---
def get_yfsp_episodes_by_id(video_id):
    detail_url = YFSP_DETAIL_URL_TEMPLATE.format(video_id)
    print(f"Backend: Fetching episode list from YFSP detail page: {detail_url}")
    episodes = []
    try:
        response = requests.get(detail_url, headers=COMMON_HEADERS, timeout=20)
        response.raise_for_status()
        response.encoding = response.apparent_encoding
        soup = BeautifulSoup(response.text, 'html.parser')

        # --- Find episode list container(s) ---
        # This selector might need adjustment based on the actual YFSP detail page structure
        # Common patterns: Look for divs/uls containing playlists or episode links
        # Example selectors (adjust as needed):
        # 'div.module-play-list .module-play-list-content a'
        # 'ul.episode-list li a'
        # 'div#play-list a'
        episode_list_containers = soup.select('div.module-play-list') # Select the main container first
        if not episode_list_containers:
             print(f"Backend: ERROR - Could not find episode list container (e.g., 'div.module-play-list') on {detail_url}")
             return [] # Return empty list if container not found

        # Assume first container is the one we want, or iterate if multiple sources
        container = episode_list_containers[0]
        episode_links = container.select('.module-play-list-content a') # Find links within the container

        print(f"Backend: Found {len(episode_links)} potential episode links in container.")

        for link_tag in episode_links:
            href = link_tag.get('href')
            title = link_tag.get_text(strip=True)

            if href and title:
                play_page_url = urljoin(YFSP_BASE_URL, href) # Construct full URL
                 # Basic validation: ensure it looks like a play page URL
                if video_id in play_page_url and '/iyfplay/' in play_page_url:
                    episodes.append({
                        "episode_name": title,
                        "play_page_url": play_page_url
                    })
                else:
                    print(f"Backend: Skipping invalid-looking episode link: {title} - {play_page_url}")

    except requests.exceptions.RequestException as e:
        print(f"Backend: ERROR fetching YFSP detail page {detail_url}: {e}")
    except Exception as e:
        import traceback
        print(f"Backend: ERROR parsing episodes from {detail_url}: {e}")
        print(traceback.format_exc())

    print(f"Backend: Extracted {len(episodes)} valid episodes for video ID {video_id}.")
    return episodes


# --- YFSP M3U8 Extraction Function (Using the previously refined version) ---
def get_yfsp_m3u8_url(play_page_url):
    print(f"Backend: Fetching M3U8 from YFSP play page: {play_page_url}")
    try:
        response = requests.get(play_page_url, headers=COMMON_HEADERS, timeout=20) # Increased timeout slightly
        response.raise_for_status()
        response.encoding = response.apparent_encoding

        soup = BeautifulSoup(response.text, 'html.parser')

        script_tags = soup.find_all('script')
        player_script_content = None
        for script in script_tags:
            if script.string and 'var player_aaaa' in script.string:
                player_script_content = script.string
                print("Backend: Found script tag containing 'var player_aaaa'.")
                break

        if not player_script_content:
            print("Backend: ERROR - Script tag containing 'var player_aaaa' not found.")
            return None

        match = re.search(r'var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;?', player_script_content, re.DOTALL)

        if match:
            json_str = match.group(1)
            print(f"Backend: Regex matched. Extracted JSON string (first 100 chars): {json_str[:100]}...")

            try:
                player_data = json.loads(json_str)
                m3u8_url = player_data.get('url')

                if m3u8_url:
                     try: m3u8_url = m3u8_url.encode('utf-8').decode('unicode_escape')
                     except Exception: pass
                     m3u8_url = m3u8_url.replace('\\/', '/')
                     print(f"Backend: Successfully extracted M3U8 URL: {m3u8_url}")
                     return m3u8_url
                else:
                    print("Backend: ERROR - 'url' key not found in player_aaaa JSON data.")
                    return None

            except json.JSONDecodeError as e:
                print(f"Backend: JSONDecodeError: {e}. Trying potential fixes...")
                try:
                    json_str_fixed = json_str.encode('utf-8').decode('unicode_escape')
                    json_str_fixed = json_str_fixed.replace('\\/', '/')
                    print(f"Backend: Attempting parse after unicode/slash fixes...")
                    player_data = json.loads(json_str_fixed)
                    m3u8_url = player_data.get('url')

                    if m3u8_url:
                        m3u8_url = m3u8_url.replace('\\/', '/')
                        print(f"Backend: Successfully extracted M3U8 URL after fixes: {m3u8_url}")
                        return m3u8_url
                    else:
                        print("Backend: ERROR - 'url' key not found in player_aaaa JSON (after fixes).")
                        return None
                except Exception as fix_e:
                     print(f"Backend: ERROR - Could not parse player_aaaa JSON even after fixes: {fix_e}. Problematic string fragment: {json_str[:200]}...")
                     return None
        else:
            print("Backend: ERROR - Regex could not find 'var player_aaaa = {...}' structure in the script.")
            return None

    except requests.exceptions.Timeout:
         print(f"Backend: ERROR - Timeout fetching YFSP play page {play_page_url}")
         return None
    except requests.exceptions.RequestException as e:
        print(f"Backend: ERROR - RequestException fetching YFSP play page {play_page_url}: {e}")
        return None
    except Exception as e:
        import traceback
        print(f"Backend: ERROR - General error extracting M3U8 from {play_page_url}: {e}")
        print(traceback.format_exc())
        return None

# --- API Endpoints ---

# --- NEW: Endpoint for AI-Filtered Search Results ---
@app.route('/api/ai-search', methods=['POST'])
def handle_ai_search():
    data = request.json
    query = data.get('query')
    settings = data.get('settings', {})
    searxng_url = settings.get('searxngUrl') or DEFAULT_SEARXNG_URL
    ai_url = settings.get('aiApiUrl') or DEFAULT_AI_API_URL
    ai_key = settings.get('aiApiKey') # User key takes precedence
    ai_model = settings.get('aiModel') or DEFAULT_AI_MODEL

    # Validation
    if not query: return jsonify({"error": "Query parameter is required"}), 400
    effective_ai_key = ai_key or DEFAULT_AI_API_KEY
    if not effective_ai_key or "PLACEHOLDER" in effective_ai_key:
         return jsonify({"error": "AI API Key is missing. Please configure it."}), 500
    if not ai_url: return jsonify({"error": "AI API URL is not configured."}), 500
    if not ai_model: return jsonify({"error": "AI Model is not configured."}), 500
    if not searxng_url: return jsonify({"error": "SearXNG URL is not configured."}), 500

    print(f"Backend: Received AI search query: '{query}'")
    ai_filtered_results = []
    try:
        raw_results = search_searxng_backend(query, searxng_url)
        if raw_results:
            filtered = filter_links_with_ai_backend(raw_results, ai_url, effective_ai_key, ai_model)
            if filtered is not None: # Check for AI failure (None indicates failure)
                 ai_filtered_results = filtered
            else:
                 # Return specific error if AI failed critically (e.g., auth)
                 return jsonify({"error": "AI processing failed. Check API key or backend logs."}), 500
        else:
            print("Backend: No results from SearXNG for AI filtering.")
    except Exception as e:
        print(f"Backend: Error during SearXNG/AI search phase: {e}")
        return jsonify({"error": f"An error occurred during AI search: {e}"}), 500

    return jsonify({"ai_results": ai_filtered_results})

# --- NEW: Endpoint for YFSP Search Results ---
@app.route('/api/yfsp-search', methods=['POST'])
def handle_yfsp_search():
    data = request.json
    query = data.get('query')
    if not query: return jsonify({"error": "Query parameter is required"}), 400

    print(f"Backend: Received YFSP search query: '{query}'")
    yfsp_results = []
    try:
        yfsp_results = search_yfsp(query)
    except Exception as e:
        print(f"Backend: Error during YFSP search phase: {e}")
        return jsonify({"error": f"An error occurred during YFSP search: {e}"}), 500

    return jsonify({"yfsp_results": yfsp_results})

# --- NEW: Endpoint to get Episodes for a YFSP video ID ---
@app.route('/api/yfsp/episodes', methods=['POST'])
def handle_yfsp_episodes():
    data = request.json
    video_id = data.get('video_id')

    if not video_id:
        return jsonify({"error": "video_id is required"}), 400

    print(f"Backend: Requesting episodes for video_id: {video_id}")
    try:
        episodes = get_yfsp_episodes_by_id(video_id)
        if not episodes:
             # It's possible a movie only has one implicit episode handled differently
             # Or the parsing failed. Return empty list or error? Let's return empty for now.
             print(f"Backend: No episodes found or extracted for video_id {video_id}. Might be a movie or parsing issue.")
        return jsonify({"episodes": episodes})
    except Exception as e:
        print(f"Backend: Error getting episodes for video_id {video_id}: {e}")
        return jsonify({"error": f"Failed to get episodes: {e}"}), 500


# --- NEW: Endpoint to get final Player URL for a specific YFSP episode's play page ---
@app.route('/api/yfsp/play', methods=['POST'])
def handle_yfsp_play():
    data = request.json
    play_page_url = data.get('play_page_url')

    if not play_page_url or not play_page_url.startswith(YFSP_BASE_URL):
        return jsonify({"error": "Valid play_page_url starting with YFSP base URL is required"}), 400

    print(f"Backend: Requesting M3U8/Player URL for: {play_page_url}")
    m3u8_url = get_yfsp_m3u8_url(play_page_url) # Use the refined function

    if m3u8_url:
        final_player_url = YFSP_PLAYER_URL_PREFIX + requests.utils.quote(m3u8_url)
        print(f"Backend: Constructed final player URL: {final_player_url}")
        return jsonify({"final_player_url": final_player_url})
    else:
        print(f"Backend: Failed to get M3U8 for {play_page_url}")
        return jsonify({"error": "Failed to extract M3U8 URL from the provided page."}), 500


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
    }
    return jsonify(config_data)

# --- Serve Frontend ---
@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(app.static_folder, path)

# No need for if __name__ == '__main__' for Vercel
