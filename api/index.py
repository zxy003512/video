import os
import requests
from bs4 import BeautifulSoup
import json
import time
import re # Import regex for extracting player_aaaa
from flask import Flask, request, jsonify, send_from_directory
from urllib.parse import urlparse, parse_qs, urljoin # Added urljoin
from dotenv import load_dotenv # For local development

# Load environment variables from .env file for local development
load_dotenv()

app = Flask(__name__, static_folder='../public', static_url_path='')

# --- Configuration ---
DEFAULT_AI_API_URL = os.getenv('AI_API_URL', "https://api.zetatechs.com/v1/chat/completions")
DEFAULT_AI_API_KEY = os.getenv('AI_API_KEY', "YOUR_FALLBACK_OR_PLACEHOLDER_KEY") # Crucial: Set this in Vercel!
DEFAULT_AI_MODEL = os.getenv('AI_MODEL', "gemini-2.0-flash")
DEFAULT_SEARXNG_URL = os.getenv('SEARXNG_URL', "https://searxng.zetatechs.online/search")
DEFAULT_PARSING_INTERFACES_JSON = os.getenv('DEFAULT_PARSING_INTERFACES', json.dumps([
    {"name": "接口1 - xmflv.com", "url": "https://jx.xmflv.com/?url=", "restricted_mobile": True},
    {"name": "接口2 - bd.jx.cn", "url": "https://bd.jx.cn/?url=", "restricted_mobile": False},
    {"name": "接口3 - xmflv.cc", "url": "https://jx.xmflv.cc/?url=", "restricted_mobile": True},
    {"name": "接口4 - hls.one", "url": "https://jx.hls.one/?url=", "restricted_mobile": False},
    {"name": "接口5 - 77flv.cc", "url": "https://jx.77flv.cc/?url=", "restricted_mobile": False},
    {"name": "接口6 - yemu.xyz", "url": "https://www.yemu.xyz/?url=", "restricted_mobile": True}
]))

AI_MAX_TOKENS = 30000
AI_TEMPERATURE = 0.0
AI_MAX_RETRIES = 3
AI_RETRY_DELAY = 5 # seconds

# --- Constants for YFSP ---
YFSP_BASE_URL = "https://www.yfsp.lv"
YFSP_SEARCH_TEMPLATE = "https://www.yfsp.lv/s/-------------/?wd={}"
YFSP_FINAL_PLAYER_TEMPLATE = "https://b.212133.xyz/player/ec.php?code=qw&if=1&url={}"
REQUEST_HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}

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
                    if title and link.startswith('http'):
                        search_results.append({'title': title, 'link': link})
    except Exception as e:
        print(f"Backend (AI Method): SearXNG Error: {e}")
    print(f"Backend (AI Method): Extracted {len(search_results)} valid results.")
    return search_results

# --- AI Filtering Function (Original AI Method) ---
# Original Chinese Prompt
AI_PROMPT_CN = f"""
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

Return your findings ONLY as a JSON list of objects. Each object in the list MUST have the following exact keys:
- "title": The original title associated with the identified video link.
- "video_link": The URL that you identified as a direct video playback link.
- "website": The domain name of the video platform extracted from the video_link (e.g., "v.qq.com", "bilibili.com", "iq.com"). Use the root domain (e.g., www.bilibili.com -> bilibili.com).

If no valid video playback links are found in the provided list, return an empty JSON list: [].
Do not include any explanations or introductory text outside the JSON structure. Just the JSON list itself.

Here is the list of search results to analyze:
--- START OF LIST ---
{{input_data_for_ai}}
--- END OF LIST ---

Your JSON output:
"""

# English version of the AI Prompt
AI_PROMPT_EN = f"""
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

Return your findings ONLY as a JSON list of objects. Each object in the list MUST have the following exact keys:
- "title": The original title associated with the identified video link.
- "video_link": The URL that you identified as a direct video playback link.
- "website": The domain name of the video platform extracted from the video_link (e.g., "v.qq.com", "bilibili.com", "iq.com"). Use the root domain (e.g., www.bilibili.com -> bilibili.com).

If no valid video playback links are found in the provided list, return an empty JSON list: [].
Do not include any explanations or introductory text outside the JSON structure. Just the JSON list itself.

Here is the list of search results to analyze:
--- START OF LIST ---
{{input_data_for_ai}}
--- END OF LIST ---

Your JSON output:
"""

def filter_links_with_ai_backend(results_list, ai_url, ai_key, ai_model):
    if not results_list: return []

    print(f"Backend (AI Method): Sending {len(results_list)} results to AI ({ai_url}, model: {ai_model})")
    input_data_for_ai = "\n".join([f"Title: {item['title']}\nURL: {item['link']}" for item in results_list])

    # Using the Chinese Prompt by default here
    prompt_to_use = AI_PROMPT_CN.format(input_data_for_ai=input_data_for_ai)

    headers = {"Authorization": f"Bearer {ai_key}", "Content-Type": "application/json"}
    payload = {
        "model": ai_model, "messages": [{"role": "user", "content": prompt_to_use}],
        "max_tokens": AI_MAX_TOKENS, "temperature": AI_TEMPERATURE, "stream": False
    }

    for attempt in range(AI_MAX_RETRIES):
        print(f"Backend (AI Method): AI API attempt {attempt + 1}/{AI_MAX_RETRIES}")
        response = None # Initialize response here
        try:
            response = requests.post(ai_url, headers=headers, json=payload, timeout=90) # Longer timeout for AI
            response.raise_for_status()
            ai_response = response.json()

            if 'choices' in ai_response and len(ai_response['choices']) > 0:
                content = ai_response['choices'][0].get('message', {}).get('content')
                if content:
                    print("Backend (AI Method): AI response received, parsing JSON...")
                    try:
                        # Clean potential markdown code blocks
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
                            print(f"Backend (AI Method): AI parsed {len(validated_data)} valid items.")
                            return validated_data
                        else:
                             print(f"Backend (AI Method): AI did not return a JSON list. Content: {content[:200]}...")
                             return []

                    except json.JSONDecodeError as json_e:
                        print(f"Backend (AI Method): AI JSON parsing error: {json_e}. Content: {content[:200]}...")
                        return None # Indicate failure
                else: print("Backend (AI Method): AI response content is empty.")
            else: print(f"Backend (AI Method): Unexpected AI response structure: {ai_response}")

        except requests.exceptions.Timeout: print(f"Backend (AI Method): AI API timeout (Attempt {attempt + 1})")
        except requests.exceptions.RequestException as e:
            print(f"Backend (AI Method): AI API request error (Attempt {attempt + 1}): {e}")
            if response is not None and response.status_code in [401, 403]:
                print("Backend (AI Method): AI Auth error, stopping retries.")
                return None # Indicate failure
        except Exception as e: print(f"Backend (AI Method): Unknown error during AI processing: {e}")

        if attempt < AI_MAX_RETRIES - 1: time.sleep(AI_RETRY_DELAY)
        else: print("Backend (AI Method): AI API max retries reached.")

    return None # Indicate failure after retries


# --- YFSP Search Function (New Method) ---
def search_yfsp_backend(query):
    search_url = YFSP_SEARCH_TEMPLATE.format(query)
    results = []
    print(f"Backend (YFSP Method): Searching YFSP for: {query} at {search_url}")
    try:
        response = requests.get(search_url, headers=REQUEST_HEADERS, timeout=20)
        response.raise_for_status()
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
                    # Extract ID from detail page stub (e.g., /iyftv/65978/ -> 65978)
                    match = re.search(r'/(\d+)/?$', detail_page_stub)
                    if match:
                        video_id = match.group(1)
                        results.append({
                            "title": title,
                            "cover": urljoin(YFSP_BASE_URL, cover_img_stub), # Make absolute URL
                            "id": video_id,
                            "base_url": YFSP_BASE_URL # Pass base URL for constructing episode links later
                        })
                    else:
                         print(f"Backend (YFSP Method): Could not extract ID from {detail_page_stub}")
            else:
                 print(f"Backend (YFSP Method): Skipping item due to missing title, link, or image.")


    except requests.exceptions.Timeout:
        print(f"Backend (YFSP Method): Timeout when searching {search_url}")
    except requests.exceptions.RequestException as e:
        print(f"Backend (YFSP Method): Request error searching {search_url}: {e}")
    except Exception as e:
        print(f"Backend (YFSP Method): Error parsing YFSP search results: {e}")

    print(f"Backend (YFSP Method): Extracted {len(results)} valid results.")
    return results

# --- YFSP Get Episode Details Function (New Method) ---
def get_yfsp_episode_details(video_id, episode_num, base_url):
    episode_page_url = f"{base_url}/iyfplay/{video_id}-1-{episode_num}/"
    print(f"Backend (YFSP Method): Fetching episode details from {episode_page_url}")
    try:
        response = requests.get(episode_page_url, headers=REQUEST_HEADERS, timeout=15)
        response.raise_for_status()
        html_content = response.text

        # Find the script containing player_aaaa using regex for flexibility
        match = re.search(r'var player_aaaa\s*=\s*(\{.*?\});', html_content, re.DOTALL | re.IGNORECASE)
        if not match:
            print(f"Backend (YFSP Method): Could not find player_aaaa script block in {episode_page_url}")
            return None

        player_data_str = match.group(1)

        # Parse the JSON data
        try:
            player_data = json.loads(player_data_str)
            m3u8_url = player_data.get('url')

            if not m3u8_url:
                 print(f"Backend (YFSP Method): 'url' key not found in player_aaaa JSON.")
                 return None

            # Handle potential unicode escapes and backslashes if needed (depends on source format)
            # Python's json.loads usually handles standard escapes.
            # Need to handle escaped forward slashes '\/' if present
            m3u8_url = m3u8_url.replace('\\/', '/')

            # Construct the final player link
            final_player_url = YFSP_FINAL_PLAYER_TEMPLATE.format(m3u8_url)
            print(f"Backend (YFSP Method): Found M3U8 URL: {m3u8_url}")
            print(f"Backend (YFSP Method): Constructed final player URL: {final_player_url}")
            return final_player_url

        except json.JSONDecodeError as e:
            print(f"Backend (YFSP Method): Failed to parse player_aaaa JSON: {e}")
            print(f"Backend (YFSP Method): Raw JSON string attempt: {player_data_str[:500]}...") # Log beginning of string
            return None
        except KeyError:
             print(f"Backend (YFSP Method): 'url' key missing in player_aaaa data.")
             return None

    except requests.exceptions.Timeout:
        print(f"Backend (YFSP Method): Timeout fetching episode page {episode_page_url}")
        return None
    except requests.exceptions.RequestException as e:
        # Check for 404 explicitly, might mean episode doesn't exist
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
    method = data.get('method', 'ai') # Default to 'ai' if not specified
    settings = data.get('settings', {})

    if not query:
        return jsonify({"error": "Query parameter is required"}), 400

    if method == 'yfsp':
        print(f"Backend: Received YFSP search request for '{query}'")
        results = search_yfsp_backend(query)
        # Add method indicator to results for frontend handling
        for r in results:
            r['method'] = 'yfsp'
        return jsonify(results)

    elif method == 'ai':
        print(f"Backend: Received AI search request for '{query}'")
        # Use settings passed from frontend if available, otherwise use defaults from ENV
        searxng_url = settings.get('searxngUrl') or DEFAULT_SEARXNG_URL
        ai_url = settings.get('aiApiUrl') or DEFAULT_AI_API_URL
        ai_key = settings.get('aiApiKey') or DEFAULT_AI_API_KEY
        ai_model = settings.get('aiModel') or DEFAULT_AI_MODEL

        if not ai_key or "PLACEHOLDER" in ai_key:
             return jsonify({"error": "AI API Key is not configured or provided."}), 500
        if not ai_url: return jsonify({"error": "AI API URL is not configured."}), 500
        if not ai_model: return jsonify({"error": "AI Model is not configured."}), 500
        if not searxng_url: return jsonify({"error": "SearXNG URL is not configured."}), 500

        # 1. Search SearXNG
        raw_results = search_searxng_backend(query, searxng_url)
        if not raw_results:
            print("Backend (AI Method): No results from SearXNG.")
            return jsonify([]) # Return empty list

        # 2. Filter with AI
        filtered_results = filter_links_with_ai_backend(raw_results, ai_url, ai_key, ai_model)

        if filtered_results is None:
            return jsonify({"error": "AI processing failed after multiple retries."}), 500
        else:
             # Add method indicator to results for frontend handling
             for r in filtered_results:
                 r['method'] = 'ai'
             return jsonify(filtered_results)

    else:
        return jsonify({"error": "Invalid search method specified"}), 400


@app.route('/api/get_episode_details', methods=['POST'])
def handle_get_episode_details():
    data = request.json
    video_id = data.get('id')
    episode_num = data.get('episode', 1) # Default to episode 1 if not provided
    base_url = data.get('base_url')

    if not video_id or not base_url:
        return jsonify({"error": "Missing 'id' or 'base_url'"}), 400

    print(f"Backend: Received request for YFSP episode details: id={video_id}, ep={episode_num}, base={base_url}")
    final_player_url = get_yfsp_episode_details(video_id, episode_num, base_url)

    if final_player_url:
        return jsonify({"player_url": final_player_url})
    else:
        # Provide a more specific error if possible (e.g., not found vs parsing error)
        # For simplicity now, just return a generic error
        return jsonify({"error": f"Failed to retrieve details for episode {episode_num}"}), 500


@app.route('/api/config', methods=['GET'])
def get_config():
    try:
        default_interfaces = json.loads(DEFAULT_PARSING_INTERFACES_JSON)
    except json.JSONDecodeError:
        print("Backend: ERROR decoding DEFAULT_PARSING_INTERFACES JSON from environment variable.")
        default_interfaces = [] # Fallback

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

# Vercel needs the 'app' variable
