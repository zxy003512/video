# api/index.py
import os
import requests
from bs4 import BeautifulSoup
import json
import time
import re # <-- Added for YFSP M3U8 extraction
from flask import Flask, request, jsonify, send_from_directory
from urllib.parse import urlparse, parse_qs, urljoin, quote # <-- Added urljoin and quote
from dotenv import load_dotenv # For local development

# Load environment variables from .env file for local development
load_dotenv()

app = Flask(__name__, static_folder='../public', static_url_path='')

# --- Configuration ---
# Get default settings from environment variables
# Provide sensible fallbacks if running locally without all env vars set
DEFAULT_AI_API_URL = os.getenv('AI_API_URL', "https://api.zetatechs.com/v1/chat/completions")
DEFAULT_AI_API_KEY = os.getenv('AI_API_KEY', "YOUR_FALLBACK_OR_PLACEHOLDER_KEY") # Crucial: Set this in Vercel!
DEFAULT_AI_MODEL = os.getenv('AI_MODEL', "gemini-2.0-flash")
DEFAULT_SEARXNG_URL = os.getenv('SEARXNG_URL', "https://searxng.zetatechs.online/search")
# Parsing interfaces from ENV VAR (JSON string expected)
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

# --- YFSP Specific Configuration ---
YFSP_BASE_URL = "https://www.yfsp.lv"
YFSP_SEARCH_URL_TEMPLATE = YFSP_BASE_URL + "/s/-------------/?wd={}"
YFSP_DETAIL_URL_TEMPLATE = YFSP_BASE_URL + "/iyftv/{}/"
YFSP_PLAYER_PREFIX = "https://b.212133.xyz/player/ec.php?code=qw&if=1&url=" # Preset player prefix
YFSP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Referer': YFSP_BASE_URL + '/' # Often needed for scraping
}

# --- Helper Function: Extract Domain ---
def get_domain(url):
    try:
        return urlparse(url).netloc
    except:
        return "Unknown"

# --- SearXNG Search Function (Existing - Unchanged) ---
def search_searxng_backend(query, searxng_url):
    params = {
        'q': query, 'categories': 'general', 'language': 'auto',
        'time_range': '', 'safesearch': '0', 'theme': 'simple', 'format': 'html'
    }
    headers = {'User-Agent': 'Mozilla/5.0'}
    search_results = []
    print(f"Backend: Searching SearXNG ({searxng_url}) for: {query}")
    try:
        response = requests.get(searxng_url, params=params, headers=headers, timeout=20)
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
                    if title and link.startswith('http'):
                        search_results.append({'title': title, 'link': link})
    except Exception as e:
        print(f"Backend: SearXNG Error: {e}")
        # Don't raise, just return empty or partial list
    print(f"Backend: Extracted {len(search_results)} valid results.")
    return search_results

# --- AI Filtering Function (Existing - Unchanged) ---
def filter_links_with_ai_backend(results_list, ai_url, ai_key, ai_model):
    if not results_list: return []

    print(f"Backend: Sending {len(results_list)} results to AI ({ai_url}, model: {ai_model})")
    input_data_for_ai = "\n".join([f"Title: {item['title']}\nURL: {item['link']}" for item in results_list])

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

Return your findings ONLY as a JSON list of objects. Each object in the list MUST have the following exact keys:
- "title": The original title associated with the identified video link.
- "video_link": The URL that you identified as a direct video playback link.
- "website": The domain name of the video platform extracted from the video_link (e.g., "v.qq.com", "bilibili.com", "iq.com"). Use the root domain (e.g., www.bilibili.com -> bilibili.com).

If no valid video playback links are found in the provided list, return an empty JSON list: [].
Do not include any explanations or introductory text outside the JSON structure. Just the JSON list itself.

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
            response = requests.post(ai_url, headers=headers, json=payload, timeout=90) # Longer timeout for AI
            response.raise_for_status()
            ai_response = response.json()

            if 'choices' in ai_response and len(ai_response['choices']) > 0:
                content = ai_response['choices'][0].get('message', {}).get('content')
                if content:
                    print("Backend: AI response received, parsing JSON...")
                    try:
                        json_content = content.strip()
                        # Handle potential markdown code block fences
                        if json_content.startswith("```json"):
                            json_content = json_content[7:]
                        if json_content.endswith("```"):
                            json_content = json_content[:-3]
                        json_content = json_content.strip()

                        # Validate it's a list before returning
                        parsed_data = json.loads(json_content)
                        if isinstance(parsed_data, list):
                             # Double-check structure and add domain if missing
                            validated_data = []
                            for item in parsed_data:
                                if isinstance(item, dict) and 'title' in item and 'video_link' in item:
                                     # Ensure website field exists, add if missing
                                     if 'website' not in item or not item['website']:
                                         item['website'] = get_domain(item['video_link'])
                                     validated_data.append(item)
                            print(f"Backend: AI parsed {len(validated_data)} valid items.")
                            return validated_data
                        else:
                             print(f"Backend: AI did not return a JSON list. Content: {content[:200]}...")
                             return [] # Return empty list if format is wrong

                    except json.JSONDecodeError as json_e:
                        print(f"Backend: AI JSON parsing error: {json_e}. Content: {content[:200]}...")
                        # Don't retry on parsing error, AI response is likely malformed
                        return None # Indicate failure
                else: print("Backend: AI response content is empty.")
            else: print(f"Backend: Unexpected AI response structure: {ai_response}")

        except requests.exceptions.Timeout: print(f"Backend: AI API timeout (Attempt {attempt + 1})")
        except requests.exceptions.RequestException as e:
            print(f"Backend: AI API request error (Attempt {attempt + 1}): {e}")
            # Stop retrying on auth errors
            if response is not None and response.status_code in [401, 403]:
                print("Backend: AI Auth error, stopping retries.")
                return None # Indicate failure
        except Exception as e: print(f"Backend: Unknown error during AI processing: {e}")

        if attempt < AI_MAX_RETRIES - 1: time.sleep(AI_RETRY_DELAY)
        else: print("Backend: AI API max retries reached.")

    return None # Indicate failure after retries

# --- YFSP Search Function ---
def search_yfsp(query):
    """
    Searches the YFSP website for a given query.
    Args:
        query (str): The search term.
    Returns:
        list: A list of dictionaries, each containing info about a search result.
              Returns an empty list on error or if no results are found.
    """
    search_url = YFSP_SEARCH_URL_TEMPLATE.format(quote(query)) # URL Encode query
    results = []
    print(f"YFSP: Searching for '{query}' at {search_url}")
    try:
        response = requests.get(search_url, headers=YFSP_HEADERS, timeout=20)
        response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
        soup = BeautifulSoup(response.text, 'html.parser')

        # Find result items - Adjust selector based on actual site structure if needed
        result_items = soup.select('div.module-card-item.module-item')
        print(f"YFSP: Found {len(result_items)} result items.")

        for item in result_items:
            try:
                title_tag = item.select_one('a.module-card-item-title')
                pic_tag = item.select_one('a.module-item-pic')
                img_tag = item.select_one('img.module-item-pic-img')
                note_tag = item.select_one('div.module-item-note')

                if title_tag and pic_tag and img_tag:
                    title = title_tag.get_text(strip=True)
                    detail_rel_url = pic_tag.get('href')
                    detail_page_url = urljoin(YFSP_BASE_URL, detail_rel_url) # Make absolute

                    # Extract video_id from detail URL (e.g., /iyftv/81886/)
                    video_id = None
                    if detail_rel_url:
                        parts = detail_rel_url.strip('/').split('/')
                        if len(parts) >= 2: # Expecting like ['iyftv', '81886']
                            video_id = parts[-1] # Get the last part

                    # Get cover image, prioritizing data-original for lazy loading
                    cover_img = img_tag.get('data-original') or img_tag.get('src')
                    if cover_img:
                         cover_img = urljoin(YFSP_BASE_URL, cover_img) # Make absolute

                    note = note_tag.get_text(strip=True) if note_tag else ""

                    if title and video_id and detail_page_url:
                        results.append({
                            "title": title,
                            "cover_img": cover_img,
                            "note": note,
                            "video_id": video_id,
                            "detail_page_url": detail_page_url
                        })
            except Exception as e:
                print(f"YFSP: Error parsing a result item: {e}")
                continue # Skip this item if parsing fails

    except requests.exceptions.RequestException as e:
        print(f"YFSP: Request error during search: {e}")
    except Exception as e:
        print(f"YFSP: General error during search: {e}")

    print(f"YFSP: Extracted {len(results)} valid search results.")
    return results

# --- YFSP Get Episodes Function ---
def get_yfsp_episodes_by_id(video_id):
    """
    Fetches the list of episodes for a given YFSP video ID.
    Args:
        video_id (str): The internal ID of the movie/show on YFSP.
    Returns:
        list: A list of dictionaries, each containing episode name and play page URL.
              Returns an empty list on error or if no episodes are found.
    """
    detail_url = YFSP_DETAIL_URL_TEMPLATE.format(video_id)
    episodes = []
    print(f"YFSP: Fetching episodes for video ID '{video_id}' from {detail_url}")
    try:
        response = requests.get(detail_url, headers=YFSP_HEADERS, timeout=20)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        # Find episode links - Adjust selector if needed
        # Look within specifically named playlist sections if possible
        episode_links = soup.select('div.module-play-list-content a') # Check all playlists
        print(f"YFSP: Found {len(episode_links)} potential episode links.")

        for link in episode_links:
            try:
                episode_name = link.get_text(strip=True)
                play_rel_url = link.get('href')

                if episode_name and play_rel_url:
                    play_page_url = urljoin(YFSP_BASE_URL, play_rel_url) # Make absolute
                    episodes.append({
                        "episode_name": episode_name,
                        "play_page_url": play_page_url
                    })
            except Exception as e:
                 print(f"YFSP: Error parsing an episode link: {e}")
                 continue

    except requests.exceptions.RequestException as e:
        print(f"YFSP: Request error fetching episodes: {e}")
    except Exception as e:
        print(f"YFSP: General error fetching episodes: {e}")

    print(f"YFSP: Extracted {len(episodes)} episode links.")
    return episodes

# --- YFSP M3U8 Extraction Function ---
def get_yfsp_m3u8_url(play_page_url):
    """
    Extracts the M3U8 URL from a YFSP episode play page.
    Args:
        play_page_url (str): The URL of the specific episode's playback page.
    Returns:
        str: The extracted M3U8 URL, or None if extraction fails.
    """
    print(f"YFSP: Attempting to extract M3U8 from {play_page_url}")
    try:
        response = requests.get(play_page_url, headers=YFSP_HEADERS, timeout=20)
        response.raise_for_status()
        html_content = response.text

        # Use regex to find the player_aaaa variable and extract the JSON part
        # Pattern explanation:
        # var\s+player_aaaa\s*=\s*   : Match "var player_aaaa =" with optional whitespace
        # (\{                          : Start capturing group 1 for the JSON object
        #   [\s\S]*?                 : Match any character (including newlines) non-greedily
        # \})                          : End capturing group 1
        # \s*;?                       : Match optional whitespace and a semicolon
        match = re.search(r'var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;?', html_content)

        if match:
            json_str = match.group(1)
            print("YFSP: Found player_aaaa JSON string.")
            try:
                player_data = json.loads(json_str)
                m3u8_url = player_data.get('url')

                if m3u8_url:
                    # Decode URL: Replace '\/' with '/' and handle unicode escapes (though json.loads often does)
                    decoded_url = m3u8_url.replace('\\/', '/')
                    # Optional: Explicit unicode decoding if needed (usually not)
                    # try:
                    #     decoded_url = decoded_url.encode('utf-8').decode('unicode_escape')
                    # except Exception as decode_err:
                    #      print(f"YFSP: Minor issue during unicode decoding (might be okay): {decode_err}")
                    print(f"YFSP: Successfully extracted M3U8 URL: {decoded_url[:100]}...") # Print prefix
                    return decoded_url
                else:
                    print("YFSP: 'url' key not found in player_aaaa JSON.")
            except json.JSONDecodeError as e:
                print(f"YFSP: Failed to parse player_aaaa JSON: {e}")
                print(f"YFSP: Raw JSON string was: {json_str[:200]}...") # Log beginning of string
            except Exception as e:
                 print(f"YFSP: Error processing player_aaaa data: {e}")
        else:
            print("YFSP: Could not find 'var player_aaaa = {...};' script block.")

    except requests.exceptions.RequestException as e:
        print(f"YFSP: Request error fetching play page: {e}")
    except Exception as e:
        print(f"YFSP: General error extracting M3U8: {e}")

    return None # Return None if any step failed

# --- API Endpoints ---

# --- Existing AI Search Endpoint (Unchanged) ---
@app.route('/api/search', methods=['POST'])
def handle_search():
    data = request.json
    query = data.get('query')
    # Use settings passed from frontend if available, otherwise use defaults from ENV
    settings = data.get('settings', {})
    searxng_url = settings.get('searxngUrl') or DEFAULT_SEARXNG_URL
    ai_url = settings.get('aiApiUrl') or DEFAULT_AI_API_URL
    ai_key = settings.get('aiApiKey') or DEFAULT_AI_API_KEY # Use user key if provided, else default
    ai_model = settings.get('aiModel') or DEFAULT_AI_MODEL

    # Security check logic (unchanged)
    if not ai_key: # If user didn't provide one via settings
        ai_key = DEFAULT_AI_API_KEY
        print("Backend: Using default AI API Key from environment.")
    if not query: return jsonify({"error": "Query parameter is required"}), 400
    if not ai_key or "PLACEHOLDER" in ai_key:
         return jsonify({"error": "AI API Key is not configured on the server or provided by the user."}), 500
    if not ai_url: return jsonify({"error": "AI API URL is not configured."}), 500
    if not ai_model: return jsonify({"error": "AI Model is not configured."}), 500
    if not searxng_url: return jsonify({"error": "SearXNG URL is not configured."}), 500

    # 1. Search SearXNG (unchanged)
    raw_results = search_searxng_backend(query, searxng_url)
    if not raw_results:
        print("Backend: No results from SearXNG.")
        return jsonify([]) # Return empty list, not an error

    # 2. Filter with AI (unchanged)
    filtered_results = filter_links_with_ai_backend(raw_results, ai_url, ai_key, ai_model)

    if filtered_results is None:
        return jsonify({"error": "AI processing failed after multiple retries."}), 500
    else:
        return jsonify(filtered_results) # Return the list (possibly empty)

# --- Existing Config Endpoint (Unchanged) ---
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
    }
    return jsonify(config_data)


# --- NEW YFSP API Endpoints ---

@app.route('/api/yfsp-search', methods=['POST'])
def handle_yfsp_search():
    """API endpoint to search YFSP."""
    data = request.json
    query = data.get('query')
    if not query:
        return jsonify({"error": "Query parameter 'query' is required"}), 400

    results = search_yfsp(query)
    # No need for complex error response here, empty list indicates no results or error
    return jsonify({"yfsp_results": results})

@app.route('/api/yfsp/episodes', methods=['POST'])
def handle_yfsp_episodes():
    """API endpoint to get episodes for a YFSP video ID."""
    data = request.json
    video_id = data.get('video_id')
    if not video_id:
        return jsonify({"error": "Parameter 'video_id' is required"}), 400

    episodes = get_yfsp_episodes_by_id(video_id)
    return jsonify({"episodes": episodes})

@app.route('/api/yfsp/play', methods=['POST'])
def handle_yfsp_play():
    """API endpoint to get the final player URL for a YFSP episode."""
    data = request.json
    play_page_url = data.get('play_page_url')
    if not play_page_url:
        return jsonify({"error": "Parameter 'play_page_url' is required"}), 400

    # Validate if the URL looks like it belongs to YFSP (basic check)
    if not play_page_url.startswith(YFSP_BASE_URL):
         return jsonify({"error": "Invalid play_page_url provided"}), 400

    m3u8_url = get_yfsp_m3u8_url(play_page_url)

    if m3u8_url:
        # URL encode the M3U8 link before appending to the player prefix
        encoded_m3u8 = quote(m3u8_url)
        final_player_url = YFSP_PLAYER_PREFIX + encoded_m3u8
        print(f"YFSP: Generated final player URL: {final_player_url[:150]}...")
        return jsonify({"final_player_url": final_player_url})
    else:
        print(f"YFSP: Failed to get M3U8 for {play_page_url}. Cannot generate final URL.")
        return jsonify({"error": "无法提取有效的播放链接 (M3U8 not found or extraction failed)"}), 404


# --- Serve Frontend (Existing - Unchanged) ---
@app.route('/')
def serve_index():
    # Serves index.html from the 'public' folder
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
     # Serves other static files (style.css, script.js) from 'public'
    # Ensure files like style.css and script.js are requested without /static/ prefix
    if os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        # Fallback for potential static file requests under non-root paths if needed
        # This might not be strictly necessary depending on frontend routing
        return send_from_directory(app.static_folder, 'index.html')


# This is needed for Vercel to detect the Flask app
# The variable must be called 'app'
# No need for if __name__ == '__main__': app.run() for Vercel deployment
