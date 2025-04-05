# api/index.py
import os
import requests
from bs4 import BeautifulSoup
import json
import time
from flask import Flask, request, jsonify, send_from_directory
from urllib.parse import urlparse, parse_qs # To help AI extract website domain
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

# --- Helper Function: Extract Domain ---
def get_domain(url):
    try:
        return urlparse(url).netloc
    except:
        return "Unknown"

# --- SearXNG Search Function (Adapted) ---
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

# --- AI Filtering Function (Adapted) ---
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
                        if json_content.startswith("```json"): json_content = json_content[7:]
                        if json_content.endswith("```"): json_content = json_content[:-3]
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

# --- API Endpoints ---

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

    # Security check: Never allow frontend to *override* the backend's default key if the backend one exists
    # UNLESS you explicitly trust the user input (generally not recommended for shared deployments)
    # For this setup, we'll prioritize the user's key IF THEY PROVIDE ONE.
    # If the user *doesn't* provide a key, we MUST use the backend default.
    if not ai_key: # If user didn't provide one via settings
        ai_key = DEFAULT_AI_API_KEY
        print("Backend: Using default AI API Key from environment.")
    # Very basic validation
    if not query: return jsonify({"error": "Query parameter is required"}), 400
    if not ai_key or "PLACEHOLDER" in ai_key: # Ensure a key is actually set
         return jsonify({"error": "AI API Key is not configured on the server or provided by the user."}), 500
    if not ai_url: return jsonify({"error": "AI API URL is not configured."}), 500
    if not ai_model: return jsonify({"error": "AI Model is not configured."}), 500
    if not searxng_url: return jsonify({"error": "SearXNG URL is not configured."}), 500


    # 1. Search SearXNG
    raw_results = search_searxng_backend(query, searxng_url)
    if not raw_results:
        # Return empty list, AI step will be skipped
        print("Backend: No results from SearXNG.")
        return jsonify([]) # Return empty list, not an error

    # 2. Filter with AI
    filtered_results = filter_links_with_ai_backend(raw_results, ai_url, ai_key, ai_model)

    if filtered_results is None:
        return jsonify({"error": "AI processing failed after multiple retries."}), 500
    else:
        return jsonify(filtered_results) # Return the list (possibly empty)

@app.route('/api/config', methods=['GET'])
def get_config():
    # Send default parsing interfaces from ENV vars to frontend
    try:
        default_interfaces = json.loads(DEFAULT_PARSING_INTERFACES_JSON)
    except json.JSONDecodeError:
        print("Backend: ERROR decoding DEFAULT_PARSING_INTERFACES JSON from environment variable.")
        default_interfaces = [] # Fallback to empty list

    # We DON'T send API keys or full URLs here, only non-sensitive defaults
    config_data = {
        "defaultParsingInterfaces": default_interfaces,
        "defaultSearxngUrl": DEFAULT_SEARXNG_URL, # Send default search URL
        # Do NOT send default AI URL/Key/Model here for security/privacy.
        # The user provides them or the backend uses its own env vars.
    }
    return jsonify(config_data)

# --- Serve Frontend ---
@app.route('/')
def serve_index():
    # Serves index.html from the 'public' folder
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
     # Serves other static files (style.css, script.js)
    return send_from_directory(app.static_folder, path)

# This is needed for Vercel to detect the Flask app
# The variable must be called 'app'
# No need for if __name__ == '__main__': app.run() for Vercel deployment

