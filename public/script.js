// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const resultsContainer = document.getElementById('results-container');
    const aiResultsArea = document.getElementById('ai-results-area');
    const yfspResultsArea = document.getElementById('yfsp-results-area');
    const yfspResultsGrid = document.getElementById('yfsp-results-grid');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessageDiv = document.getElementById('error-message');

    // Settings Modal Elements
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

    // Player Modal Elements
    const playerModal = document.getElementById('player-modal');
    const closePlayerBtn = playerModal.querySelector('.close-player-btn');
    const playerTitle = document.getElementById('player-title');
    const parsingSelectContainer = document.getElementById('player-parsing-selector');
    const parsingSelect = document.getElementById('parsing-select');
    const videoPlayerIframe = document.getElementById('video-player');

    // --- NEW: Episode Modal Elements ---
    const episodeModal = document.getElementById('episode-modal');
    const closeEpisodeBtn = episodeModal.querySelector('.close-episode-btn');
    const episodeListTitle = document.getElementById('episode-list-title');
    const episodeListArea = document.getElementById('episode-list-area');
    const episodeListLoading = document.getElementById('episode-list-loading');
    const episodeListError = document.getElementById('episode-list-error');


    // --- State & Configuration ---
    let currentSettings = {};
    let defaultSettings = {
        defaultParsingInterfaces: [],
        defaultSearxngUrl: ''
    };
    let currentVideoLink = ''; // For AI result parsing

    // --- Functions ---

    const showLoading = (show, element = loadingIndicator, message = '正在处理中...') => {
        element.querySelector('p').textContent = message;
        element.style.display = show ? 'flex' : 'none';
        if (element === loadingIndicator) { // Only disable main search btn for main loading
             searchBtn.disabled = show;
        }
    };

    const hideLoading = (element = loadingIndicator) => {
         element.style.display = 'none';
         if (element === loadingIndicator) {
              searchBtn.disabled = false;
         }
    };

    const showError = (message, element = errorMessageDiv) => {
        element.textContent = message;
        element.style.display = 'block';
        // Hide automatically, unless it's the episode error div (keep it visible)
        if (element === errorMessageDiv) {
            setTimeout(() => {
                 element.style.display = 'none';
            }, 7000);
        }
    };

    const clearError = (element = errorMessageDiv) => {
        element.style.display = 'none';
        element.textContent = '';
    };

    const clearResults = () => {
        aiResultsArea.innerHTML = '';
        yfspResultsGrid.innerHTML = '';
        yfspResultsArea.style.display = 'none';
        const notFoundMsg = resultsContainer.querySelector('.not-found-message');
        if (notFoundMsg) {
            resultsContainer.removeChild(notFoundMsg);
        }
    };

    // --- Settings Functions (Keep existing load, save, reset, render, add, remove, updateParsingSelect) ---
    const loadSettings = async () => { // (Keep existing code)
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('无法加载默认配置');
            defaultSettings = await response.json();
        } catch (error) {
            console.error("Error fetching default config:", error);
            showError("无法从服务器加载默认配置，将使用内置后备设置。", errorMessageDiv); // Ensure main error div
             defaultSettings = { // Keep fallback defaults
                defaultParsingInterfaces: [/*...*/], defaultSearxngUrl: "..."
             };
        }
        const savedSettings = localStorage.getItem('videoSearchPlayerSettings');
        currentSettings = savedSettings ? JSON.parse(savedSettings) : { /* default structure */ };
        // Ensure defaults are applied correctly if loading fails or no saved settings
        currentSettings.searxngUrl = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl;
        currentSettings.parsingInterfaces = currentSettings.parsingInterfaces && Array.isArray(currentSettings.parsingInterfaces) ? currentSettings.parsingInterfaces : (defaultSettings.defaultParsingInterfaces ? JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces)) : []);

        populateSettingsForm();
        renderParsingInterfacesList();
        updateParsingSelect();
    };
    const saveSettings = () => { // (Keep existing code)
         // ... validation ...
         currentSettings = { /* update from form */ };
         localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
         alert("设置已保存！");
         settingsModal.style.display = 'none';
         updateParsingSelect();
    };
     const resetToDefaults = () => { // (Keep existing code)
          if (confirm("...")) {
              currentSettings = { /* reset structure */ };
              localStorage.removeItem('videoSearchPlayerSettings');
              populateSettingsForm();
              renderParsingInterfacesList();
              updateParsingSelect();
              alert("设置已恢复为默认值。");
              settingsModal.style.display = 'none';
          }
     };
    const populateSettingsForm = () => { // (Keep existing code)
         aiApiUrlInput.value = currentSettings.aiApiUrl || '';
         aiApiKeyInput.value = currentSettings.aiApiKey || '';
         aiModelInput.value = currentSettings.aiModel || '';
         searxngUrlInput.value = currentSettings.searxngUrl || '';
    };
    const renderParsingInterfacesList = () => { // (Keep existing code)
         interfacesListDiv.innerHTML = '';
         if (!currentSettings.parsingInterfaces || currentSettings.parsingInterfaces.length === 0) { /*...*/ return; }
         currentSettings.parsingInterfaces.forEach((iface, index) => { /* create item */ });
         document.querySelectorAll('.remove-interface-btn').forEach(button => { /* add listener */ });
    };
    const addParsingInterface = () => { // (Keep existing code)
         // ... validation ...
         if (!currentSettings.parsingInterfaces) currentSettings.parsingInterfaces = [];
         if (currentSettings.parsingInterfaces.some(iface => iface.url === url)) { /*...*/ return; }
         currentSettings.parsingInterfaces.push({ name, url });
         localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
         renderParsingInterfacesList(); updateParsingSelect(); /* clear inputs */
    };
    const removeParsingInterface = (index) => { // (Keep existing code)
         if (currentSettings.parsingInterfaces?.[index]) {
             currentSettings.parsingInterfaces.splice(index, 1);
             localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
             renderParsingInterfacesList(); updateParsingSelect();
         }
    };
    const updateParsingSelect = () => { // (Keep existing code)
         parsingSelect.innerHTML = '';
         if (currentSettings.parsingInterfaces?.length > 0) {
             currentSettings.parsingInterfaces.forEach(iface => { /* add option */ });
             parsingSelect.disabled = false;
             parsingSelectContainer.style.display = 'block';
         } else {
             /* add disabled option */; parsingSelect.disabled = true;
             parsingSelectContainer.style.display = 'none';
         }
    };
    // --- End Settings Functions ---

    // Display AI search results (No change needed here)
    const displayAiResults = (results) => {
        if (!results || results.length === 0) return;
        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('result-card', 'ai-result-card');
            card.dataset.link = result.video_link;
            card.dataset.title = result.title;
            card.innerHTML = `
                <h3>${result.title}</h3>
                <p><span class="website-badge">${result.website || '未知来源'}</span></p>
                <p class="link-preview">${result.video_link.substring(0, 60)}${result.video_link.length > 60 ? '...' : ''}</p>
                 <button class="play-button ai-play-btn" aria-label="播放 ${result.title}"><i class="fas fa-play"></i> 播放 (需解析)</button>
            `;
            card.querySelector('.ai-play-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                 if (parsingSelect.disabled) {
                     showError("请先在设置中添加至少一个视频解析接口才能播放此来源。", errorMessageDiv);
                     return;
                 }
                currentVideoLink = result.video_link;
                openPlayer(currentVideoLink, result.title, false); // false = needs parsing
            });
            aiResultsArea.appendChild(card);
        });
    };

    // --- MODIFIED: Display YFSP search results ---
    const displayYfspResults = (results) => {
        if (!results || results.length === 0) {
            yfspResultsArea.style.display = 'none';
            return;
        }
        yfspResultsArea.style.display = 'block';

        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('result-card', 'yfsp-result-card');
            // --- Store video_id and title for fetching episodes ---
            card.dataset.videoId = result.video_id;
            card.dataset.title = result.title;

            card.innerHTML = `
                <div class="yfsp-card-content">
                    <div class="yfsp-cover">
                        <img src="${result.cover_img || 'loading.png'}" alt="${result.title} 封面" loading="lazy" onerror="this.src='loading.png'; this.onerror=null;">
                         ${result.note ? `<div class="yfsp-note">${result.note}</div>` : ''}
                    </div>
                    <div class="yfsp-info">
                         <h4>${result.title}</h4>
                         <!-- MODIFIED: Button now fetches episodes -->
                         <button class="play-button yfsp-episode-btn" aria-label="查看 ${result.title} 的剧集">
                             <i class="fas fa-list-ul"></i> 查看剧集
                         </button>
                    </div>
                </div>
            `;

            const episodeButton = card.querySelector('.yfsp-episode-btn');
            episodeButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const videoId = card.dataset.videoId;
                const title = card.dataset.title;
                if (videoId) {
                    openEpisodeModal(videoId, title); // Open modal to fetch/show episodes
                } else {
                    showError("无法获取此影片的ID，无法加载剧集。", errorMessageDiv);
                }
            });
            yfspResultsGrid.appendChild(card);
        });
    };

    // --- NEW: Open Episode Modal and Fetch Episodes ---
    const openEpisodeModal = async (videoId, title) => {
         episodeListTitle.textContent = `剧集列表: ${title}`;
         episodeListArea.innerHTML = ''; // Clear previous episodes
         clearError(episodeListError); // Clear previous errors in modal
         episodeModal.style.display = 'block'; // Show modal first
         showLoading(true, episodeListLoading, '正在加载剧集...'); // Show loading inside modal

         try {
             const response = await fetch('/api/yfsp/episodes', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ video_id: videoId })
             });
             const data = await response.json();

             hideLoading(episodeListLoading); // Hide loading

             if (!response.ok || data.error) {
                 throw new Error(data.error || `加载剧集失败 (${response.status})`);
             }

             displayEpisodes(data.episodes || [], title); // Pass title for player

         } catch (error) {
              hideLoading(episodeListLoading); // Hide loading on error
              console.error("Error fetching episodes:", error);
              showError(`无法加载剧集: ${error.message}`, episodeListError); // Show error inside modal
         }
    }

    // --- NEW: Display Episodes in Modal ---
    const displayEpisodes = (episodes, showTitle) => {
        episodeListArea.innerHTML = ''; // Clear again just in case
        if (!episodes || episodes.length === 0) {
            episodeListArea.innerHTML = '<p style="text-align: center; padding: 20px;">未能找到可播放的剧集。</p>';
            return;
        }

        episodes.forEach(episode => {
            const button = document.createElement('button');
            button.classList.add('episode-button');
            button.dataset.playPageUrl = episode.play_page_url;
            button.dataset.episodeName = episode.episode_name;
            button.textContent = episode.episode_name;

            button.addEventListener('click', async (e) => {
                const targetButton = e.currentTarget;
                const playPageUrl = targetButton.dataset.playPageUrl;
                const episodeName = targetButton.dataset.episodeName;
                const fullTitle = `${showTitle} - ${episodeName}`; // Combine show title and episode name

                if (!playPageUrl) {
                    showError("无效的剧集链接", episodeListError);
                    return;
                }

                // Disable button and show spinner inside
                targetButton.disabled = true;
                targetButton.innerHTML = `${episodeName} <div class="spinner-small"></div>`;

                try {
                     console.log(`Fetching final URL for: ${playPageUrl}`);
                     const response = await fetch('/api/yfsp/play', {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify({ play_page_url: playPageUrl })
                     });
                     const data = await response.json();

                     if (!response.ok || data.error) {
                         throw new Error(data.error || `获取播放地址失败 (${response.status})`);
                     }

                     if (data.final_player_url) {
                         // Success! Close episode modal and open player
                         episodeModal.style.display = 'none';
                         openPlayer(data.final_player_url, fullTitle, true); // true = direct URL
                     } else {
                         throw new Error("未能获取到最终播放地址。");
                     }

                } catch (error) {
                     console.error("Error getting final play URL:", error);
                     showError(`播放 "${episodeName}" 出错: ${error.message}`, episodeListError);
                } finally {
                     // Re-enable button and remove spinner
                     targetButton.disabled = false;
                     targetButton.textContent = episodeName; // Restore original text
                }
            });
            episodeListArea.appendChild(button);
        });
    }


    // Open the player modal (Handles both direct and parsable URLs) - No change needed
    const openPlayer = (link, title, isDirectUrl = false) => {
        playerTitle.textContent = `正在播放: ${title}`;
        if (isDirectUrl) {
            parsingSelectContainer.style.display = 'none';
            videoPlayerIframe.src = link;
        } else {
             if (parsingSelect.disabled) {
                 showError("请先在设置中添加至少一个视频解析接口。", errorMessageDiv);
                 return;
             }
             currentVideoLink = link;
             parsingSelectContainer.style.display = 'block';
             const selectedParserUrl = parsingSelect.value;
             if (selectedParserUrl && currentVideoLink) {
                 videoPlayerIframe.src = selectedParserUrl + encodeURIComponent(currentVideoLink);
             } else {
                 videoPlayerIframe.src = 'about:blank';
                 showError("无法构建播放链接，请检查解析接口和视频链接。", errorMessageDiv);
                 return;
             }
        }
        playerModal.style.display = 'block';
    };

    // Close the player modal (No change needed)
    const closePlayer = () => {
        playerModal.style.display = 'none';
        videoPlayerIframe.src = 'about:blank';
        playerTitle.textContent = '正在播放...';
        currentVideoLink = '';
        parsingSelectContainer.style.display = 'block';
    };

    // --- MODIFIED: Perform search (Calls separate APIs) ---
    const performSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) {
            showError("请输入搜索内容", errorMessageDiv);
            return;
        }

        clearError(errorMessageDiv);
        clearResults();
        showLoading(true, loadingIndicator, '正在搜索和分析...');

        const settingsPayload = {
             aiApiUrl: currentSettings.aiApiUrl,
             aiApiKey: currentSettings.aiApiKey,
             aiModel: currentSettings.aiModel,
             searxngUrl: currentSettings.searxngUrl
         };

        // --- Call APIs concurrently ---
        try {
            const [aiResponse, yfspResponse] = await Promise.all([
                fetch('/api/ai-search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: query, settings: settingsPayload })
                }).then(res => res.json()), // Parse JSON immediately
                fetch('/api/yfsp-search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: query })
                }).then(res => res.json()) // Parse JSON immediately
            ]);

             console.log("AI Search Response:", aiResponse);
             console.log("YFSP Search Response:", yfspResponse);

             // Process AI Results
             if (aiResponse.error) {
                 console.error("AI Search Error:", aiResponse.error);
                 // Optionally show a non-blocking warning for AI errors
                 // showError(`AI搜索部分失败: ${aiResponse.error}`, errorMessageDiv);
             } else {
                 displayAiResults(aiResponse.ai_results || []);
             }

             // Process YFSP Results
             if (yfspResponse.error) {
                 console.error("YFSP Search Error:", yfspResponse.error);
                  // Optionally show a non-blocking warning for YFSP errors
                  // showError(`YFSP搜索部分失败: ${yfspResponse.error}`, errorMessageDiv);
             } else {
                 displayYfspResults(yfspResponse.yfsp_results || []);
             }

             // Check if BOTH results are empty AFTER processing both responses
             const aiIsEmpty = !(aiResponse.ai_results && aiResponse.ai_results.length > 0);
             const yfspIsEmpty = !(yfspResponse.yfsp_results && yfspResponse.yfsp_results.length > 0);

             if (aiIsEmpty && yfspIsEmpty) {
                 // Display the message within the main results container
                 const notFoundMsg = document.createElement('p');
                 notFoundMsg.classList.add('not-found-message');
                 notFoundMsg.style.textAlign = 'center';
                 notFoundMsg.style.marginTop = '20px';
                 notFoundMsg.textContent = '未能找到相关的影视播放链接或资源。';
                 resultsContainer.appendChild(notFoundMsg);
             }

        } catch (error) {
            // Catch network errors or errors during Promise.all/parsing
            console.error("Combined Search Error:", error);
            showError(`搜索时发生错误: ${error.message}`, errorMessageDiv);
            clearResults(); // Clear everything on major error
        } finally {
            hideLoading(loadingIndicator);
        }
    };


    // --- Event Listeners ---
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // Settings Modal Listeners (Keep existing)
    settingsBtn.addEventListener('click', () => { /*...*/ settingsModal.style.display = 'block'; });
    closeSettingsBtn.addEventListener('click', () => { settingsModal.style.display = 'none'; });
    saveSettingsBtn.addEventListener('click', saveSettings);
    resetSettingsBtn.addEventListener('click', resetToDefaults);
    addInterfaceBtn.addEventListener('click', addParsingInterface);

    // Player Modal Listeners (Keep existing)
    closePlayerBtn.addEventListener('click', closePlayer);
    parsingSelect.addEventListener('change', () => { /* update iframe src if needed */ });

    // --- NEW: Episode Modal Listener ---
    closeEpisodeBtn.addEventListener('click', () => {
        episodeModal.style.display = 'none';
        episodeListArea.innerHTML = ''; // Clear content on close
        clearError(episodeListError); // Clear errors on close
    });

    // Close modals on outside click (Add episode modal)
    window.addEventListener('click', (event) => {
        if (event.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
        if (event.target === playerModal) {
            closePlayer();
        }
        // --- NEW: Close episode modal on outside click ---
        if (event.target === episodeModal) {
             episodeModal.style.display = 'none';
             episodeListArea.innerHTML = '';
             clearError(episodeListError);
        }
    });

    // --- Initial Load ---
    loadSettings();

}); // End DOMContentLoaded
