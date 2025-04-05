// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const resultsContainer = document.getElementById('results-container'); // For AI results
    const yfspResultsContainer = document.getElementById('yfsp-results-container'); // For YFSP results
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageDiv = document.getElementById('error-message');

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

    // Player Modal (Existing)
    const playerModal = document.getElementById('player-modal');
    const closePlayerBtn = playerModal.querySelector('.close-player-btn');
    const playerTitle = document.getElementById('player-title');
    const parsingSelect = document.getElementById('parsing-select'); // Used for AI results
    const videoPlayerIframe = document.getElementById('video-player');

    // NEW: Episode Modal
    const episodeModal = document.getElementById('episode-modal');
    const closeEpisodeBtn = episodeModal.querySelector('.close-episode-btn');
    const episodeModalTitle = document.getElementById('episode-modal-title');
    const episodeListDiv = document.getElementById('episode-list');


    // --- State & Configuration ---
    let currentSettings = {};
    let defaultSettings = {
        defaultParsingInterfaces: [],
        defaultSearxngUrl: ''
    };
    let currentVideoLink = ''; // Stores the link for AI results playback
    let isFetching = false; // Prevent multiple simultaneous fetches

    // --- Functions ---

    const showLoading = (show, message = "正在智能分析中...") => {
        loadingIndicator.querySelector('p').textContent = message;
        loadingIndicator.style.display = show ? 'flex' : 'none'; // Use flex for center alignment
        searchBtn.disabled = show;
        isFetching = show; // Update fetch state
    };

    const showError = (message) => {
        errorMessageDiv.textContent = message;
        errorMessageDiv.style.display = 'block';
        setTimeout(() => {
             errorMessageDiv.style.display = 'none';
        }, 5000);
    };

    const clearError = () => {
        errorMessageDiv.style.display = 'none';
        errorMessageDiv.textContent = '';
    };

    const clearResults = () => {
        resultsContainer.innerHTML = '';
        yfspResultsContainer.innerHTML = ''; // Also clear YFSP results
         // Optionally hide the YFSP heading if containers exist
        const yfspHeading = yfspResultsContainer.previousElementSibling; // Adjust if structure changes
        if (yfspHeading && yfspHeading.tagName === 'H2' && yfspHeading.classList.contains('yfsp-heading')) {
            yfspHeading.style.display = 'none';
        }
    };

    // --- Settings Management (Largely Unchanged) ---
    const loadSettings = async () => {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('无法加载默认配置');
            defaultSettings = await response.json();
        } catch (error) {
            console.error("Error fetching default config:", error);
            showError("无法从服务器加载默认配置，将使用内置后备设置。");
             defaultSettings = { // Hardcoded fallback
                defaultParsingInterfaces: [/*...*/], // Keep your fallback interfaces
                defaultSearxngUrl: "https://searxng.zetatechs.online/search" // Example fallback
             };
        }
        // Rest of loadSettings remains the same...
        const savedSettings = localStorage.getItem('videoSearchPlayerSettings');
        if (savedSettings) {
            currentSettings = JSON.parse(savedSettings);
        } else {
            currentSettings = {
                aiApiUrl: '', aiApiKey: '', aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: defaultSettings.defaultParsingInterfaces || []
            };
        }
        populateSettingsForm();
        renderParsingInterfacesList();
        updateParsingSelect();
    };

    const saveSettings = () => { /* Unchanged */
        const newUrl = newInterfaceUrlInput.value.trim();
         if (newUrl && !newUrl.includes('?url=')) { // Check if it seems like a parsing URL
             showError("新解析接口URL似乎缺少 '?url=' 部分");
             // return; // Optional: enforce '?url='
         }
         if (newUrl && !newUrl.endsWith('=')) {
             // Maybe just a warning, some interfaces might not end with =
             // showError("新解析接口URL通常应以 '=' 结尾");
             // return;
         }

        currentSettings = {
            aiApiUrl: aiApiUrlInput.value.trim(),
            aiApiKey: aiApiKeyInput.value.trim(),
            aiModel: aiModelInput.value.trim(),
            searxngUrl: searxngUrlInput.value.trim() || defaultSettings.defaultSearxngUrl,
            parsingInterfaces: currentSettings.parsingInterfaces // Managed separately
        };
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
        console.log("Settings saved:", currentSettings);
        alert("设置已保存！");
        settingsModal.style.display = 'none';
        updateParsingSelect();
    };
    const resetToDefaults = () => { /* Unchanged */
        if (confirm("确定要恢复所有设置为默认值吗？这将清除您自定义的API密钥和接口。")) {
             currentSettings = {
                aiApiUrl: '', aiApiKey: '', aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces || []))
             };
             localStorage.removeItem('videoSearchPlayerSettings');
             populateSettingsForm();
             renderParsingInterfacesList();
             updateParsingSelect();
             alert("设置已恢复为默认值。");
             settingsModal.style.display = 'none';
         }
    };
    const populateSettingsForm = () => { /* Unchanged */
        aiApiUrlInput.value = currentSettings.aiApiUrl || '';
        aiApiKeyInput.value = currentSettings.aiApiKey || '';
        aiModelInput.value = currentSettings.aiModel || '';
        searxngUrlInput.value = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl || '';
    };
    const renderParsingInterfacesList = () => { /* Unchanged */
        interfacesListDiv.innerHTML = '';
        if (!currentSettings.parsingInterfaces || currentSettings.parsingInterfaces.length === 0) {
             interfacesListDiv.innerHTML = '<p>没有配置解析接口。</p>';
             return;
        }
        currentSettings.parsingInterfaces.forEach((iface, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('interface-item');
            itemDiv.innerHTML = `
                <span>${iface.name} (${iface.url})</span>
                <button data-index="${index}" class="remove-interface-btn" aria-label="删除接口">&times;</button>
            `;
            interfacesListDiv.appendChild(itemDiv);
        });
        document.querySelectorAll('.remove-interface-btn').forEach(button => {
            button.addEventListener('click', (e) => removeParsingInterface(parseInt(e.target.getAttribute('data-index'))));
        });
    };
    const addParsingInterface = () => { /* Unchanged */
        const name = newInterfaceNameInput.value.trim();
        const url = newInterfaceUrlInput.value.trim();
        if (!name || !url) { showError("接口名称和URL不能为空"); return; }
        // Basic validation moved to saveSettings
        if (!currentSettings.parsingInterfaces) currentSettings.parsingInterfaces = [];
        currentSettings.parsingInterfaces.push({ name, url });
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
        renderParsingInterfacesList();
        updateParsingSelect();
        newInterfaceNameInput.value = ''; newInterfaceUrlInput.value = '';
    };
    const removeParsingInterface = (index) => { /* Unchanged */
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces[index]) {
            currentSettings.parsingInterfaces.splice(index, 1);
            localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
            renderParsingInterfacesList();
            updateParsingSelect();
        }
    };
    const updateParsingSelect = () => { /* Unchanged, still needed for AI results */
        parsingSelect.innerHTML = '';
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces.length > 0) {
            currentSettings.parsingInterfaces.forEach((iface) => {
                const option = document.createElement('option');
                option.value = iface.url;
                option.textContent = iface.name;
                parsingSelect.appendChild(option);
            });
            parsingSelect.disabled = false;
        } else {
            const option = document.createElement('option'); option.textContent = '没有可用的解析接口'; parsingSelect.appendChild(option);
            parsingSelect.disabled = true;
        }
    };

    // --- Display AI Search Results (Largely Unchanged) ---
    const displayResults = (results) => {
        resultsContainer.innerHTML = ''; // Clear only AI results
        if (!results || results.length === 0) {
             // Don't show message here if YFSP might have results
             // resultsContainer.innerHTML = '<p style="text-align: center;">未能找到相关 AI 精选播放链接。</p>';
             return;
        }

        // Optional: Add a heading for AI results
        const heading = document.createElement('h2');
        heading.textContent = 'AI 精选结果';
        heading.style.textAlign = 'center';
        heading.style.marginBottom = '20px';
        heading.style.color = 'var(--secondary-color)';
        resultsContainer.appendChild(heading);


        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('result-card'); // Use existing class
            card.dataset.link = result.video_link;
            card.dataset.title = result.title;

            card.innerHTML = `
                <h3>${result.title}</h3>
                <p><span class="website-badge">${result.website || '未知来源'}</span></p>
                <p class="link-preview">${result.video_link.substring(0, 60)}${result.video_link.length > 60 ? '...' : ''}</p>
            `;
            // Click opens player using PARSING INTERFACE
            card.addEventListener('click', () => {
                openPlayerWithParsingInterface(result.video_link, result.title);
            });
            resultsContainer.appendChild(card);
        });
    };

    // --- NEW: Display YFSP Search Results ---
    const displayYfspResults = (results) => {
        yfspResultsContainer.innerHTML = ''; // Clear only YFSP results
        if (!results || results.length === 0) {
            // Don't show message if AI might have results
            // yfspResultsContainer.innerHTML = '<p style="text-align: center;">未能找到相关 YFSP 资源。</p>';
            return;
        }

         // Optional: Add heading via CSS :before pseudo-element is better


        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('yfsp-result-card'); // Use new class for different styling
            card.dataset.videoId = result.video_id; // Store video ID
            card.dataset.title = result.title;     // Store title for episode modal

            // Fallback image if cover_img is missing
            const coverSrc = result.cover_img || 'placeholder.png'; // Add a placeholder image URL or leave empty

            card.innerHTML = `
                <div class="yfsp-cover-container">
                     <img src="${coverSrc}" alt="${result.title}封面" loading="lazy" onerror="this.style.display='none'; this.parentElement.style.backgroundColor='#ccc';"> {/* Handle broken images */}
                </div>
                <div class="yfsp-card-content">
                    <h3>${result.title}</h3>
                    <p class="yfsp-note">${result.note || ' '}</p> {/* Show note */}
                </div>
            `;
            // Click fetches EPISODES
            card.addEventListener('click', () => {
                fetchYfspEpisodes(result.video_id, result.title);
            });
            yfspResultsContainer.appendChild(card);
        });
    };


    // --- Open Player (Existing - for AI results using parsing interface) ---
    const openPlayerWithParsingInterface = (videoLink, title) => {
        if (parsingSelect.disabled) {
             showError("请先在设置中添加至少一个视频解析接口。");
             return;
        }
        currentVideoLink = videoLink;
        playerTitle.textContent = `正在播放 (接口解析): ${title}`;
        const selectedParserUrl = parsingSelect.value;
        if (selectedParserUrl && currentVideoLink) {
             videoPlayerIframe.src = selectedParserUrl + encodeURIComponent(currentVideoLink);
             playerModal.style.display = 'block';
        } else {
             videoPlayerIframe.src = '';
             showError("无法构建播放链接，请检查解析接口和视频链接。");
        }
    };

    // --- NEW: Fetch YFSP Episodes ---
    const fetchYfspEpisodes = async (videoId, title) => {
        if (isFetching) return; // Prevent concurrent fetches
        console.log(`Fetching episodes for YFSP ID: ${videoId}, Title: ${title}`);
        showLoading(true, "正在获取剧集列表...");
        clearError();
        episodeListDiv.innerHTML = '<p>正在加载剧集...</p>'; // Show loading inside modal
        episodeModalTitle.textContent = `选择剧集: ${title}`;
        episodeModal.style.display = 'block'; // Show modal early

        try {
            const response = await fetch('/api/yfsp/episodes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ video_id: videoId }),
            });
            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || `获取剧集失败 (${response.status})`);
            }

            if (!data.episodes || data.episodes.length === 0) {
                episodeListDiv.innerHTML = '<p>未找到该资源的剧集信息。</p>';
            } else {
                displayEpisodes(data.episodes, title); // Pass title for context
            }

        } catch (error) {
            console.error("Error fetching episodes:", error);
            showError(`获取剧集列表时出错: ${error.message}`);
            episodeListDiv.innerHTML = `<p>获取剧集失败: ${error.message}</p>`; // Show error inside modal
        } finally {
            showLoading(false);
        }
    };

    // --- NEW: Display YFSP Episodes in Modal ---
    const displayEpisodes = (episodes, showTitle) => {
        episodeListDiv.innerHTML = ''; // Clear loading/previous content
        if (!episodes || episodes.length === 0) {
            episodeListDiv.innerHTML = '<p>未找到剧集。</p>';
            return;
        }

        episodes.forEach(episode => {
            const episodeItem = document.createElement('button'); // Use button for better accessibility
            episodeItem.classList.add('episode-item');
            episodeItem.textContent = episode.episode_name;
            episodeItem.dataset.playUrl = episode.play_page_url;
            episodeItem.dataset.episodeName = episode.episode_name; // Store name for player title

            episodeItem.addEventListener('click', () => {
                playYfspEpisode(episode.play_page_url, episode.episode_name, showTitle);
            });
            episodeListDiv.appendChild(episodeItem);
        });
    };

    // --- NEW: Play YFSP Episode (Directly uses backend-generated URL) ---
    const playYfspEpisode = async (playUrl, episodeName, showTitle) => {
        if (isFetching) return;
        console.log(`Requesting play URL for: ${playUrl}`);
        showLoading(true, "正在获取播放链接...");
        clearError();
        episodeModal.style.display = 'none'; // Close episode modal

        try {
            const response = await fetch('/api/yfsp/play', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ play_page_url: playUrl }),
            });
            const data = await response.json();

            if (!response.ok || data.error) {
                throw new Error(data.error || `获取播放链接失败 (${response.status})`);
            }

            if (data.final_player_url) {
                playerTitle.textContent = `正在播放 (YFSP): ${showTitle} - ${episodeName}`;
                videoPlayerIframe.src = data.final_player_url; // Load the direct player URL
                playerModal.style.display = 'block';          // Show the player modal
            } else {
                throw new Error("后端未能返回有效的播放链接。");
            }

        } catch (error) {
            console.error("Error getting YFSP play URL:", error);
            showError(`无法播放: ${error.message}`);
            // Ensure player is cleared if it fails
             videoPlayerIframe.src = '';
             playerModal.style.display = 'none';
        } finally {
            showLoading(false);
        }
    };


    // --- Close Player Modal (Modified slightly for clarity) ---
    const closePlayer = () => {
        playerModal.style.display = 'none';
        videoPlayerIframe.src = 'about:blank'; // More reliable way to stop playback
        playerTitle.textContent = '正在播放...';
        currentVideoLink = ''; // Clear link used by AI playback
    };

     // --- NEW: Close Episode Modal ---
    const closeEpisodeModalFunc = () => {
         episodeModal.style.display = 'none';
         episodeListDiv.innerHTML = ''; // Clear list when closing
         episodeModalTitle.textContent = '选择剧集';
    };


    // --- Perform Search (MODIFIED to trigger both AI and YFSP searches) ---
    const performSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) { showError("请输入搜索内容"); return; }
        if (isFetching) { console.log("Fetch in progress, skipping new search."); return; } // Prevent overlap

        clearError();
        clearResults();
        showLoading(true, "正在搜索资源..."); // General search message

        const aiSearchRequest = {
             query: query,
             settings: {
                 aiApiUrl: currentSettings.aiApiUrl,
                 aiApiKey: currentSettings.aiApiKey,
                 aiModel: currentSettings.aiModel,
                 searxngUrl: currentSettings.searxngUrl
             }
         };
        const yfspSearchRequest = { query: query };

        try {
            // Perform both searches in parallel
            const [aiPromise, yfspPromise] = await Promise.allSettled([
                fetch('/api/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(aiSearchRequest),
                }),
                 fetch('/api/yfsp-search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(yfspSearchRequest),
                })
            ]);

            let aiResults = [];
            let yfspResults = [];
            let errors = [];

            // Process AI Search results
            if (aiPromise.status === 'fulfilled') {
                const response = aiPromise.value;
                const data = await response.json();
                if (!response.ok) {
                    errors.push(`AI搜索错误: ${data.error || response.status}`);
                } else {
                    aiResults = data; // Expecting a list directly
                }
            } else {
                errors.push(`AI请求失败: ${aiPromise.reason}`);
            }

             // Process YFSP Search results
            if (yfspPromise.status === 'fulfilled') {
                const response = yfspPromise.value;
                const data = await response.json();
                if (!response.ok) {
                     errors.push(`YFSP搜索错误: ${data.error || response.status}`);
                } else {
                    yfspResults = data.yfsp_results || []; // Expecting {"yfsp_results": [...]}
                }
            } else {
                 errors.push(`YFSP请求失败: ${yfspPromise.reason}`);
            }

            // Display results
            displayResults(aiResults);       // Display AI results
            displayYfspResults(yfspResults); // Display YFSP results

            // Show combined errors if any
            if (errors.length > 0) {
                showError(errors.join('; '));
            }

            // Show no results message only if BOTH searches yielded nothing
            if (aiResults.length === 0 && yfspResults.length === 0 && errors.length === 0) {
                 resultsContainer.innerHTML = '<p style="text-align: center; margin-top: 20px;">未能找到任何相关资源。</p>';
            }


        } catch (error) { // Catch unexpected errors during fetch setup or Promise.allSettled
            console.error("Search Orchestration Error:", error);
            showError(`搜索过程中发生意外错误: ${error.message}`);
            clearResults();
        } finally {
            showLoading(false);
        }
    };


    // --- Event Listeners ---
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performSearch();
    });

    // Settings Modal Listeners (Unchanged)
    settingsBtn.addEventListener('click', () => { populateSettingsForm(); renderParsingInterfacesList(); settingsModal.style.display = 'block'; });
    closeSettingsBtn.addEventListener('click', () => { settingsModal.style.display = 'none'; });
    saveSettingsBtn.addEventListener('click', saveSettings);
    resetSettingsBtn.addEventListener('click', resetToDefaults);
    addInterfaceBtn.addEventListener('click', addParsingInterface);

    // Player Modal Listeners (Unchanged for AI results)
    closePlayerBtn.addEventListener('click', closePlayer);
    parsingSelect.addEventListener('change', () => { // This updates the player if parsing interface changes *while AI result is playing*
        if (playerModal.style.display === 'block' && currentVideoLink && !videoPlayerIframe.src.includes('yfsp')) { // Check if it's not a YFSP link
             const selectedParserUrl = parsingSelect.value;
             if (selectedParserUrl) {
                  videoPlayerIframe.src = selectedParserUrl + encodeURIComponent(currentVideoLink);
             }
        }
    });

    // NEW: Episode Modal Listeners
    closeEpisodeBtn.addEventListener('click', closeEpisodeModalFunc);


    // Close modals if clicked outside the content area
    window.addEventListener('click', (event) => {
        if (event.target === settingsModal) settingsModal.style.display = 'none';
        if (event.target === playerModal) closePlayer();
        if (event.target === episodeModal) closeEpisodeModalFunc(); // Close episode modal too
    });

    // --- Initial Load ---
    loadSettings();

}); // End DOMContentLoaded
