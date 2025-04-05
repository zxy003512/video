// api/index.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
// const { URL } = require('url'); // 保持，可能未来需要

const app = express();

// CORS 设置 (Vercel 通常需要，但有时其代理会处理)
// 允许来自任何源的请求，或者更安全地，限制为你的 Vercel 部署 URL
app.use(cors());
// 或者更安全的设置:
// const allowedOrigins = ['YOUR_VERCEL_APP_URL', 'https://your-app-name.vercel.app']; // 替换成你的 Vercel URL
// app.use(cors({
//   origin: function (origin, callback) {
//     if (!origin || allowedOrigins.indexOf(origin) !== -1) {
//       callback(null, true);
//     } else {
//       callback(new Error('Not allowed by CORS'));
//     }
//   }
// }));


// --- 从环境变量获取 AI 配置 ---
// !!! 切勿硬编码密钥 !!!
const AI_API_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'; // 确认 Endpoint
const AI_API_KEY = process.env.AI_API_KEY; // 从 Vercel 环境变量读取
const AI_MODEL = 'deepseek-v3-250324';
const AI_MAX_TOKENS = 16000; // 减少一点以防万一
const AI_TEMPERATURE = 0.1;

// --- Base URLs for the Sources ---
const SOURCE_CONFIG = {
    original: {
        baseUrl: 'https://www.pkcom.cc',
        searchPath: (query) => `/vodsearch/${encodeURIComponent(query)}-------------.html`,
        name: 'Original Source (pkcom.cc)'
    },
    fsyuyou: {
        baseUrl: 'https://www.fsyuyou.com',
        searchPath: (query) => `/fqsiso/-------------.html?wd=${encodeURIComponent(query)}`,
        name: 'Fsyuyou Source'
    }
    // 可以添加更多来源...
};

// --- Helper Function for Fetching Data ---
async function fetchHtml(targetUrl, sourceName, refererBaseUrl) {
    console.log(`[${sourceName}] Fetching HTML from: ${targetUrl}`);
    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': refererBaseUrl + '/',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
            timeout: 15000 // 15 seconds timeout
        });
        return response.data; // Return HTML content
    } catch (error) {
        console.error(`[${sourceName}] Error fetching HTML from ${targetUrl}:`, error.message);
        // Re-throw a structured error
        let statusCode = 500;
        let message = `Error fetching from ${sourceName}`;
        if (error.response) {
            statusCode = error.response.status;
            message = `Error from ${sourceName} server: ${statusCode}`;
        } else if (error.request) {
            statusCode = 504; // Gateway Timeout
            message = `No response received from ${sourceName} server (Timeout or Network Issue)`;
        }
        const err = new Error(message);
        err.statusCode = statusCode;
        throw err; // Rethrow the customized error
    }
}

// --- Helper: AI Call (Moved to Backend) ---
// --- Retry Configuration (for AI call) ---
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function callAIForStreamUrl(htmlContent, title, attempt = 1) {
    console.log(`[AI Backend] Attempt ${attempt}/${MAX_RETRIES} to analyze: ${title}`);

    if (!AI_API_KEY) {
         console.error("[AI Backend] Error: AI_API_KEY environment variable is not set!");
         throw new Error("AI API Key is missing in server configuration.");
    }

    try {
        const aiResponse = await axios.post(AI_API_URL, {
            model: AI_MODEL,
            messages: [
                {
                    role: "system",
                    content: "You are an expert web scraper. Your task is to extract the primary video stream URL (usually ending in .m3u8) from the given HTML content. Respond ONLY with the URL itself, without any introductory text, explanations, or formatting like backticks or quotes."
                },
                {
                    role: "user",
                    content: `Extract the video stream URL (e.g., https://.../video.m3u8) from this HTML:\n\n\`\`\`html\n${htmlContent.substring(0, 15000)}\n\`\`\`\n\nReturn only the URL.`
                }
            ],
            max_tokens: 500, // Reduced max_tokens, URL should be short
            temperature: AI_TEMPERATURE,
            stream: false
        }, {
            headers: {
                'Authorization': `Bearer ${AI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 20000 // AI might take longer
        });

        if (!aiResponse.data || !aiResponse.data.choices || aiResponse.data.choices.length === 0 || !aiResponse.data.choices[0].message || !aiResponse.data.choices[0].message.content) {
            console.error(`[AI Backend] Invalid AI response structure (Attempt ${attempt}):`, aiResponse.data);
            throw new Error('AI returned invalid data structure');
        }

        let streamUrl = aiResponse.data.choices[0].message.content.trim();
        console.log(`[AI Backend] Raw AI response (Attempt ${attempt}): "${streamUrl}"`);
        streamUrl = streamUrl.replace(/^["'`]+|["'`]+$/g, ''); // Clean quotes/backticks
        streamUrl = streamUrl.replace(/^URL:\s*/i, ''); // Clean prefix

        // Basic validation
        if (!streamUrl || (!streamUrl.startsWith('http') && !streamUrl.startsWith('/')) || !streamUrl.includes('.m3u8')) { // Added .m3u8 check
             console.warn(`[AI Backend] Invalid or non-M3U8 URL extracted (Attempt ${attempt}): "${streamUrl}"`);
             throw new Error(`AI failed to extract a valid .m3u8 link`);
        }

        console.log(`[AI Backend] Valid Stream URL Extracted (Attempt ${attempt}): "${streamUrl}"`);
        return streamUrl.replace(/\\\//g, '/'); // Clean potential escaped slashes

    } catch (error) {
        console.warn(`[AI Backend] Attempt ${attempt} failed for ${title}:`, error.message);
        if (attempt < MAX_RETRIES) {
            await delay(RETRY_DELAY_MS);
            return callAIForStreamUrl(htmlContent, title, attempt + 1); // Retry
        } else {
            console.error(`[AI Backend] All ${MAX_RETRIES} AI attempts failed for ${title}.`);
            const finalError = new Error(`AI analysis failed after ${MAX_RETRIES} attempts: ${error.message}`);
            finalError.statusCode = 500; // Internal Server Error
            if (error.response) finalError.statusCode = error.response.status; // Propagate HTTP error if possible
            if (error.code === 'ECONNABORTED') finalError.statusCode = 504; // Timeout
            throw finalError;
        }
    }
}


// --- API Endpoints ---

// Generic Search Endpoint Wrapper
async function handleSearch(req, res, sourceId) {
    const query = req.query.query;
    const config = SOURCE_CONFIG[sourceId];

    if (!query) {
        return res.status(400).json({ error: 'Missing search query' });
    }
    if (!config) {
        return res.status(500).json({ error: `Internal Server Error: Source configuration missing for ${sourceId}` });
    }

    const targetUrl = config.baseUrl + config.searchPath(query);
    try {
        const html = await fetchHtml(targetUrl, config.name, config.baseUrl);
        // Send HTML back to the frontend for parsing
        res.setHeader('Content-Type', 'text/html'); // Set correct content type
        res.send(html);
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
}

// Specific Search Routes
app.get('/api/search-source-original', (req, res) => handleSearch(req, res, 'original'));
app.get('/api/search-source-fsyuyou', (req, res) => handleSearch(req, res, 'fsyuyou'));
// Add more search routes here if needed...


// Endpoint to get play page HTML (still needed for AI input)
// /api/get-play-data?path=/vodplay/123.html&source=original
app.get('/api/get-play-data', async (req, res) => {
    const playPagePath = req.query.path;
    const sourceId = req.query.source;

    if (!sourceId || !SOURCE_CONFIG[sourceId]) {
        return res.status(400).json({ error: 'Invalid or missing source parameter.' });
    }
    if (!playPagePath || typeof playPagePath !== 'string' || !playPagePath.startsWith('/')) {
        return res.status(400).json({ error: 'Invalid or missing play page path.' });
    }

    const config = SOURCE_CONFIG[sourceId];
    const targetUrl = config.baseUrl + playPagePath;

    try {
        const html = await fetchHtml(targetUrl, `${config.name} (Play Page)`, config.baseUrl);
        res.setHeader('Content-Type', 'text/html'); // Important: Tell browser it's HTML
        res.send(html);
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

// *** NEW Endpoint: Securely get stream URL using AI ***
// /api/get-stream-url?path=/vodplay/123.html&source=original&title=Movie Title
app.get('/api/get-stream-url', async (req, res) => {
    const playPagePath = req.query.path;
    const sourceId = req.query.source;
    const title = req.query.title || 'Unknown Video'; // Get title for logging

    // Validation
    if (!sourceId || !SOURCE_CONFIG[sourceId]) {
        return res.status(400).json({ error: 'Invalid or missing source parameter.' });
    }
    if (!playPagePath || typeof playPagePath !== 'string' || !playPagePath.startsWith('/')) {
        return res.status(400).json({ error: 'Invalid or missing play page path.' });
    }
    if (!AI_API_KEY) { // Check again before proceeding
        console.error("[API /get-stream-url] AI_API_KEY is not configured on the server.");
        return res.status(500).json({ error: 'Server AI configuration error.' });
    }


    const config = SOURCE_CONFIG[sourceId];
    const targetUrl = config.baseUrl + playPagePath;

    try {
        // 1. Fetch the play page HTML (backend side)
        console.log(`[Stream URL] Fetching HTML for AI analysis: ${targetUrl}`);
        const playPageHtml = await fetchHtml(targetUrl, `${config.name} (Play Page for AI)`, config.baseUrl);
        console.log(`[Stream URL] Fetched HTML for ${title} (length: ${playPageHtml.length})`);

        // 2. Call AI to extract the stream URL (backend side)
        const streamUrl = await callAIForStreamUrl(playPageHtml, title);

        // 3. Return the extracted stream URL to the frontend
        res.status(200).json({ streamUrl: streamUrl });

    } catch (error) {
        console.error(`[Stream URL] Failed to get stream URL for ${title} (${playPagePath}):`, error);
        res.status(error.statusCode || 500).json({ error: `Failed to get stream URL: ${error.message}` });
    }
});


// --- Export the app for Vercel ---
module.exports = app;
