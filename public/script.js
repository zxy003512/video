// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const resultsContainer = document.getElementById('results-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const loadingText = document.getElementById('loading-text'); // Text inside loading indicator
    const errorMessageDiv = document.getElementById('error-message');
    const searchMethodRadios = document.querySelectorAll('input[name="search-method"]');

    // Settings Modal
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = settingsModal.querySelector('.close-btn');
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const resetSettingsBtn = document.getElementById('reset-settings-btn');
    const aiApiUrlInput = document.getElementById('ai-api-url');
    const aiApiKeyInput = document.getElementById('ai-api-key');
    const aiModelInput = document.getElementById('ai-model');
    const searxngUrlInput = document.getElementById('searxng-url');
    const interfacesListDiv = document.getElementById('parsing-interfaces-list');
    const newInterfaceNameInput = document.getElementById('new-interface-name');
    const newInterfaceUrlInput = document.getElementById('new-interface-url');
    const addInterfaceBtn = document.getElementById('add-interface-btn');

    // Player Modal
    const playerModal = document.getElementById('player-modal');
    const closePlayerBtn = playerModal.querySelector('.close-player-btn');
    const playerTitle = document.getElementById('player-title');
    const parsingSelectorContainer = document.getElementById('parsing-selector-container'); // Container for select+label
    const parsingSelect = document.getElementById('parsing-select');
    const videoPlayerIframe = document.getElementById('video-player');
    const playerLoadingIndicator = document.getElementById('player-loading-indicator'); // Loading inside player

    // --- State & Configuration ---
    let currentSettings = {};
    let defaultSettings = { // Will be populated by /api/config
        defaultParsingInterfaces: [],
        defaultSearxngUrl: ''
    };
    let currentVideoLink = ''; // To store the link for AI method results requiring parsing
    let currentSearchMethod = 'ai'; // Default search method

    // --- Functions ---

    // (showLoading, showPlayerLoading, showError, clearError, clearResults - no changes needed)
    const showLoading = (show, method = 'ai') => {
        if (show) {
            loadingText.textContent = method === 'ai' ? '正在智能分析中...' : '正在搜索 YFSP 资源...';
            loadingIndicator.style.display = 'flex'; // Use flex for centering
        } else {
            loadingIndicator.style.display = 'none';
        }
        searchBtn.disabled = show;
    };
    const showPlayerLoading = (show) => {
         playerLoadingIndicator.style.display = show ? 'flex' : 'none';
         videoPlayerIframe.style.opacity = show ? '0' : '1'; // Hide iframe while loading
    }
    const showError = (message) => {
        errorMessageDiv.textContent = message;
        errorMessageDiv.style.display = 'block';
        setTimeout(() => {
             if (errorMessageDiv.textContent === message) {
                 errorMessageDiv.style.display = 'none';
             }
        }, 7000);
    };
    const clearError = () => {
        errorMessageDiv.style.display = 'none';
        errorMessageDiv.textContent = '';
    };
    const clearResults = () => {
        resultsContainer.innerHTML = '';
    };


    // (loadSettings, saveSettings, resetToDefaults, populateSettingsForm, renderParsingInterfacesList, addParsingInterface, removeParsingInterface, updateParsingSelect - no changes needed)
    const loadSettings = async () => {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error(`无法加载默认配置 (${response.status})`);
            defaultSettings = await response.json();
            console.log("Fetched default settings:", defaultSettings);
        } catch (error) {
            console.error("Error fetching default config:", error);
            showError("无法从服务器加载默认配置，将使用内置后备设置。");
            defaultSettings = { /* fallback settings */ };
        }
        const savedSettings = localStorage.getItem('videoSearchPlayerSettings');
        if (savedSettings) {
            try {
                currentSettings = JSON.parse(savedSettings);
                currentSettings.parsingInterfaces = currentSettings.parsingInterfaces || defaultSettings.defaultParsingInterfaces || [];
                currentSettings.searxngUrl = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl || '';
            } catch (e) { /* handle parse error */ }
        } else {
            currentSettings = { /* default settings */ };
        }
        currentSearchMethod = localStorage.getItem('videoSearchMethod') || 'ai';
        try {
            const radioToCheck = document.querySelector(`input[name="search-method"][value="${currentSearchMethod}"]`);
            if (radioToCheck) radioToCheck.checked = true;
            else document.querySelector(`input[name="search-method"][value="ai"]`).checked = true;
        } catch(e) { /* handle querySelector error */ }
        populateSettingsForm();
        renderParsingInterfacesList();
        updateParsingSelect();
    };
    const saveSettings = () => { /* ... save logic ... */ };
    const resetToDefaults = () => { /* ... reset logic ... */ };
    const populateSettingsForm = () => { /* ... populate logic ... */ };
    const renderParsingInterfacesList = () => { /* ... render logic ... */ };
    const addParsingInterface = (name, url, updateUI = true) => { /* ... add logic ... */ };
    const removeParsingInterface = (index) => { /* ... remove logic ... */ };
    const updateParsingSelect = () => { /* ... update select logic ... */ };


    // --- Display Search Results (Handles AI and YFSP) ---
    // (No changes needed here, the card creation logic is fine)
    const displayResults = (results) => {
        clearResults();
        if (!results || results.length === 0) {
            resultsContainer.innerHTML = `<p style="text-align: center;">未能找到相关资源。请尝试更换关键词或搜索方式。</p>`;
            return;
        }
        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('result-card');
            card.dataset.title = result.title;

            if (result.method === 'yfsp' && result.id && result.base_url) {
                // YFSP Card
                card.classList.add('yfsp-card');
                card.dataset.id = result.id;
                card.dataset.baseUrl = result.base_url;
                card.dataset.method = 'yfsp';
                // ... (rest of YFSP card creation, including button) ...
                const coverDiv = document.createElement('div');
                 coverDiv.classList.add('yfsp-cover');
                 const img = document.createElement('img');
                 img.src = result.cover || '';
                 img.alt = `${result.title} Cover`;
                 img.loading = 'lazy';
                 img.onerror = () => { /* handle image error */ };
                 coverDiv.appendChild(img);

                 const infoDiv = document.createElement('div');
                 infoDiv.classList.add('yfsp-info');
                 const titleH3 = document.createElement('h3');
                 titleH3.textContent = result.title;
                 titleH3.title = result.title;

                 const actionContainer = document.createElement('div');
                 actionContainer.classList.add('yfsp-action-container');

                 const selectEpisodeBtn = document.createElement('button');
                 selectEpisodeBtn.classList.add('select-episode-btn');
                 selectEpisodeBtn.innerHTML = '<i class="fas fa-list-ul"></i> 选择剧集';
                 selectEpisodeBtn.addEventListener('click', (e) => {
                     e.stopPropagation();
                     showEpisodeList(result.id, result.base_url, result.title, card, selectEpisodeBtn); // Pass the button itself
                 });

                 actionContainer.appendChild(selectEpisodeBtn);
                 infoDiv.appendChild(titleH3);
                 infoDiv.appendChild(actionContainer);
                 card.appendChild(coverDiv);
                 card.appendChild(infoDiv);

            } else if (result.method === 'ai' && result.video_link) {
                // AI Card
                 card.classList.add('ai-card');
                 card.dataset.link = result.video_link;
                 card.dataset.method = 'ai';
                 card.innerHTML = `<h3>${result.title}</h3> ... (rest of AI card HTML) ... `;
                 card.addEventListener('click', () => {
                    if (parsingSelect.disabled) {
                         showError("请先在设置中添加至少一个视频解析接口才能播放此链接。");
                         return;
                    }
                    // Pass 'false' for isDirectUrl for AI results
                    openPlayer(result.video_link, result.title, false);
                 });
            } else {
                 console.warn("Skipping result with unexpected structure:", result);
                 return;
            }
            resultsContainer.appendChild(card);
        });
    };

    // --- MODIFIED: Function to Fetch and Display YFSP Episode List ---
    const showEpisodeList = async (id, baseUrl, title, cardElement, buttonElement) => {
         console.log(`Fetching episode list for YFSP: id=${id}, title=${title}`);
         const actionContainer = cardElement.querySelector('.yfsp-action-container');
         if (!actionContainer) return;

         const originalButtonHTML = buttonElement.innerHTML;
         buttonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 加载剧集...`;
         buttonElement.disabled = true;
         clearError();

         try {
             const response = await fetch('/api/get_yfsp_episode_list', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ id: id, base_url: baseUrl })
             });

             const episodes = await response.json();

             if (!response.ok) {
                 const errorMsg = episodes.error || `服务器错误 (${response.status})`;
                 throw new Error(errorMsg);
             }

             actionContainer.innerHTML = ''; // Clear the button

             if (!episodes || episodes.length === 0) {
                 actionContainer.innerHTML = '<p class="no-episodes-msg">未能获取到剧集列表。</p>';
                 return;
             }

             const episodeListDiv = document.createElement('div');
             episodeListDiv.classList.add('episode-list');

             episodes.forEach(ep => {
                 // *** CRITICAL CHANGE HERE ***
                 // Check if ep.episode_num exists from the backend response
                 if (ep.episode_num === undefined || ep.episode_num === null) {
                     console.warn("Skipping episode, missing 'episode_num':", ep);
                     return; // Skip this episode if the crucial number is missing
                 }

                 const episodeButton = document.createElement('button');
                 episodeButton.classList.add('episode-button');
                 // Use ep.episode for the button text (display name like "4K国语")
                 episodeButton.textContent = ep.episode;
                 episodeButton.title = `播放 ${title} - ${ep.episode}`;

                 // Store the *numeric* identifier in the dataset
                 episodeButton.dataset.episodeNum = ep.episode_num; // <-- STORE THE NUMBER

                 episodeButton.addEventListener('click', (e) => {
                      e.stopPropagation();
                      // Pass the *numeric* identifier stored in the dataset
                      playYfspEpisode(id, baseUrl, title, episodeButton.dataset.episodeNum, episodeButton); // <-- PASS THE NUMBER
                 });
                 episodeListDiv.appendChild(episodeButton);
             });

             actionContainer.appendChild(episodeListDiv);

         } catch (error) {
             console.error("Error fetching/displaying YFSP episode list:", error);
             showError(`获取剧集列表时出错: ${error.message}`);
             // Restore button only if it wasn't replaced by the list
             if (!actionContainer.querySelector('.episode-list') && !actionContainer.querySelector('.no-episodes-msg')) {
                 actionContainer.innerHTML = ''; // Clear potential errors
                 buttonElement.innerHTML = originalButtonHTML;
                 buttonElement.disabled = false;
                 actionContainer.appendChild(buttonElement);
             }
         }
         // No finally needed for button state, handled in catch or success replaces it
    };


    // --- MODIFIED: Function to handle playing a SPECIFIC YFSP episode ---
    // Now receives the *numeric* episodeNum correctly
    const playYfspEpisode = async (id, baseUrl, title, episodeNum, clickedButtonElement) => {
        // episodeNum should now be the numeric identifier (e.g., "1", "2")
        console.log(`Attempting to play YFSP: id=${id}, ep=${episodeNum}, title=${title}`);

        const originalButtonText = clickedButtonElement.textContent;
        clickedButtonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
        clickedButtonElement.disabled = true;
        clearError();

        try {
            const response = await fetch('/api/get_episode_details', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 // Send the numeric episodeNum received by this function
                 body: JSON.stringify({ id: id, episode: episodeNum, base_url: baseUrl })
            });

            const data = await response.json();

            if (!response.ok) {
                 const errorMsg = data.error || `服务器错误 (${response.status})`;
                 throw new Error(errorMsg);
            }

            // *** Check if backend returned M3U8 ***
            if (data.player_url && data.is_m3u8) {
                 // Handle M3U8 URL - needs a player that supports it (like hls.js, video.js with hls plugin, etc.)
                 // For now, let's assume the iframe might handle it, or openPlayer needs adjustment
                 console.log("Received M3U8 URL:", data.player_url);
                 // Pass 'true' for isDirectUrl, but the player needs to handle M3U8
                 openPlayer(data.player_url, `${title} - Episode ${episodeNum}`, true); // Indicate it's a direct link (M3U8)
            } else if (data.player_url) {
                 // Handle regular player URL (if backend returns templated URL)
                 console.log("Received Player URL:", data.player_url);
                 openPlayer(data.player_url, `${title} - Episode ${episodeNum}`, true); // Indicate it's a direct link
            }
            else {
                throw new Error(`未能从服务器获取到有效的播放链接`);
            }

        } catch (error) {
             console.error("Error fetching/playing YFSP episode:", error);
             showError(`播放剧集 ${episodeNum} 时出错: ${error.message}`);
        } finally {
             // Restore button state
             clickedButtonElement.innerHTML = originalButtonText;
             clickedButtonElement.disabled = false;
        }
    };


    // --- MODIFIED: Open the player modal ---
    // Handles direct URLs (M3U8 or standard player) and links needing parsing
    const openPlayer = (urlOrLink, title, isDirectUrl = false) => {
        playerTitle.textContent = title;
        videoPlayerIframe.src = 'about:blank';
        showPlayerLoading(true);

        if (isDirectUrl) {
            // --- Direct URL (from YFSP or potentially other direct sources) ---
            console.log("Opening player with direct URL:", urlOrLink);
            currentVideoLink = '';
            parsingSelectorContainer.style.display = 'none';

            // *** Player Handling Logic ***
            // Check if it looks like an M3U8 URL
            if (urlOrLink.toLowerCase().includes('.m3u8')) {
                console.log("Detected M3U8, attempting to use basic iframe (may need HLS.js for broad compatibility)");
                // Simple iframe source set - relies on browser/extensions or future HLS.js integration
                videoPlayerIframe.src = urlOrLink;
                 // Consider adding HLS.js logic here if needed for better M3U8 support
                 // Example (conceptual - requires including hls.js library):
                 /*
                 if (Hls.isSupported()) {
                     const videoElement = document.createElement('video'); // Need a <video> tag instead of iframe
                     videoElement.controls = true;
                     // videoElement.style... = // Style the video element
                     // Replace iframe with video tag in the DOM if not already done
                     const hls = new Hls();
                     hls.loadSource(urlOrLink);
                     hls.attachMedia(videoElement);
                     hls.on(Hls.Events.MANIFEST_PARSED, function() {
                         showPlayerLoading(false);
                         videoElement.play();
                     });
                     hls.on(Hls.Events.ERROR, function (event, data) {
                         console.error('HLS Error:', data);
                          showPlayerLoading(false);
                         showError("无法加载 M3U8 视频流: " + data.details);
                     });
                 } else {
                     // Fallback or error if HLS not supported
                     console.warn("HLS.js not supported, relying on native browser support for M3U8.");
                      videoPlayerIframe.src = urlOrLink; // Try iframe anyway
                 }
                 */
            } else {
                 // Assume it's a standard URL for an embeddable player
                 videoPlayerIframe.src = urlOrLink;
            }

            videoPlayerIframe.onload = () => {
                 console.log("Player iframe loaded:", urlOrLink);
                 showPlayerLoading(false);
            };
            videoPlayerIframe.onerror = (e) => {
                 console.error("Player iframe failed to load:", urlOrLink, e);
                 showPlayerLoading(false);
                 showError("加载播放器资源时出错。请检查链接或网络。");
            };

        } else {
            // --- Link requires parsing (from AI method search result) ---
            console.log("Opening player, needs parsing:", urlOrLink);
            if (parsingSelect.disabled) {
                 showPlayerLoading(false);
                 showError("请先在设置中添加至少一个视频解析接口。");
                 closePlayer();
                 return;
            }
            currentVideoLink = urlOrLink;
            parsingSelectorContainer.style.display = ''; // Show parsing selector
            updatePlayerWithParser(); // Set initial iframe src using parser

        }
        playerModal.style.display = 'block';
    };

    // (updatePlayerWithParser - no changes needed)
    const updatePlayerWithParser = () => {
        if (!currentVideoLink || parsingSelect.disabled) {
             console.warn("updatePlayerWithParser called without link or disabled select");
             videoPlayerIframe.src = 'about:blank';
             showPlayerLoading(false);
             return;
        }
        const selectedParserUrl = parsingSelect.value;
        if (selectedParserUrl) {
             const finalUrl = selectedParserUrl + encodeURIComponent(currentVideoLink);
             console.log("Using parser:", selectedParserUrl, "Final URL:", finalUrl);
             videoPlayerIframe.src = 'about:blank';
             showPlayerLoading(true);
             videoPlayerIframe.src = finalUrl;
             videoPlayerIframe.onload = () => { /* ... */ };
             videoPlayerIframe.onerror = (e) => { /* ... */ };
        } else { /* handle no parser selected */ }
    };

    // (closePlayer - no changes needed)
    const closePlayer = () => {
        playerModal.style.display = 'none';
        videoPlayerIframe.src = 'about:blank';
        playerTitle.textContent = '正在播放...';
        currentVideoLink = '';
        showPlayerLoading(false);
        parsingSelectorContainer.style.display = 'none';
        // If using HLS.js, destroy instance here: if (hls) { hls.destroy(); hls = null; }
    };

    // (performSearch - no changes needed)
    const performSearch = async () => { /* ... search logic ... */ };


    // --- Event Listeners ---
    // (No changes needed for search, settings, player close, parser select, window click)
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') performSearch(); });
    searchMethodRadios.forEach(radio => { /* ... change listener ... */ });
    settingsBtn.addEventListener('click', () => { /* ... open settings ... */ });
    closeSettingsBtn.addEventListener('click', () => { settingsModal.style.display = 'none'; });
    saveSettingsBtn.addEventListener('click', saveSettings);
     resetSettingsBtn.addEventListener('click', resetToDefaults);
     addInterfaceBtn.addEventListener('click', () => { /* ... add interface visually ... */ });
    closePlayerBtn.addEventListener('click', closePlayer);
    parsingSelect.addEventListener('change', () => {
        if (playerModal.style.display === 'block' && currentVideoLink && parsingSelectorContainer.style.display !== 'none') {
             updatePlayerWithParser();
        }
    });
    window.addEventListener('click', (event) => { /* ... close modals on outside click ... */ });

    // --- Initial Load ---
    loadSettings();

}); // End DOMContentLoaded
