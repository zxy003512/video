// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
// const { URL } = require('url'); // Not strictly needed for this implementation, can be removed

const app = express();
const port = 3000; // You can choose another port

// Allow all origins for cross-origin requests (convenient for development, configure stricter rules for production)
app.use(cors());

// --- Base URLs for the Sources ---
const SOURCE_CONFIG = {
    original: {
        baseUrl: 'https://www.pkcom.cc',
        searchPath: (query) => `/vodsearch/${encodeURIComponent(query)}-------------.html`,
        name: 'Original Source (pkcom.cc)'
    },
    fsyuyou: {
        baseUrl: 'https://www.fsyuyou.com',
        // Based on the user provided URL: https://www.fsyuyou.com/fqsiso/-------------.html?wd=KEYWORD
        searchPath: (query) => `/fqsiso/-------------.html?wd=${encodeURIComponent(query)}`,
        name: 'Fsyuyou Source'
    }
};

// --- Helper Function for Fetching Data ---
async function fetchAndRespond(req, res, targetUrl, sourceName, refererBaseUrl) {
    console.log(`[${sourceName}] Proxying request to: ${targetUrl}`); // Debug log with source name

    try {
        const response = await axios.get(targetUrl, {
            headers: {
                // Simulate browser headers, some sites might check User-Agent
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': refererBaseUrl + '/', // Add Referer, specific to the source being accessed
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                // Add other headers if necessary
            },
             // Set timeout to prevent requests hanging too long
            timeout: 15000 // 15 seconds timeout (increased slightly)
        });
        res.send(response.data); // Send the fetched HTML directly back to the frontend
    } catch (error) {
        console.error(`[${sourceName}] Error fetching data from ${targetUrl}:`, error.message);
         // Determine if it's a network error or an error from the target server
        if (error.response) {
             // Request was made, but the server responded with a non-2xx status code
             res.status(error.response.status).send({ error: `Error from ${sourceName} server: ${error.response.status}`, details: error.message });
        } else if (error.request) {
             // Request was made, but no response was received (e.g., network issue, timeout)
             res.status(504).send({ error: `No response received from ${sourceName} server (Timeout or Network Issue)`, details: error.message });
        } else {
             // Error occurred while setting up the request
             res.status(500).send({ error: `Error setting up request to ${sourceName}`, details: error.message });
        }
    }
}

// --- Search Endpoints for Each Source ---

// Proxy search request for the ORIGINAL source
app.get('/search-source-original', async (req, res) => {
    const query = req.query.query;
    const sourceId = 'original'; // Hardcoded for this endpoint
    const config = SOURCE_CONFIG[sourceId];

    if (!query) {
        return res.status(400).send({ error: 'Missing search query' });
    }
    if (!config) {
         return res.status(500).send({ error: 'Internal Server Error: Source configuration missing for original' });
    }

    const targetUrl = config.baseUrl + config.searchPath(query);
    await fetchAndRespond(req, res, targetUrl, config.name, config.baseUrl);
});

// Proxy search request for the FSYUYOU source
app.get('/search-source-fsyuyou', async (req, res) => {
    const query = req.query.query;
    const sourceId = 'fsyuyou'; // Hardcoded for this endpoint
    const config = SOURCE_CONFIG[sourceId];

    if (!query) {
        return res.status(400).send({ error: 'Missing search query' });
    }
     if (!config) {
         return res.status(500).send({ error: 'Internal Server Error: Source configuration missing for fsyuyou' });
    }

    const targetUrl = config.baseUrl + config.searchPath(query);
    await fetchAndRespond(req, res, targetUrl, config.name, config.baseUrl);
});


// --- Proxy to get play page content ---
// Now accepts a 'source' query parameter
app.get('/get-play-data', async (req, res) => {
    const playPagePath = req.query.path;
    const sourceId = req.query.source; // Get the source ID from the query

    // --- Validation ---
    if (!sourceId || !SOURCE_CONFIG[sourceId]) {
        return res.status(400).send({ error: 'Invalid or missing source parameter. Expected "original" or "fsyuyou".' });
    }
    if (!playPagePath || typeof playPagePath !== 'string' || !playPagePath.startsWith('/')) {
         // Basic validation for the path (must start with '/')
        return res.status(400).send({ error: 'Invalid or missing play page path provided. Path must start with /.' });
    }
    // You might want more specific path validation based on source later, e.g.:
    // if (sourceId === 'original' && !playPagePath.startsWith('/vodplay/')) { ... }

    const config = SOURCE_CONFIG[sourceId];

    // Construct the full play page URL based on the source
    const targetUrl = config.baseUrl + playPagePath;

    await fetchAndRespond(req, res, targetUrl, `${config.name} (Play Page)`, config.baseUrl);
});


app.listen(port, () => {
    console.log(`ZXY Multi-Source Proxy Server listening at http://localhost:${port}`);
    console.log('Configured Sources:');
    console.log(` -> Original: ${SOURCE_CONFIG.original.baseUrl}`);
    console.log(` -> Fsyuyou: ${SOURCE_CONFIG.fsyuyou.baseUrl}`);
});
