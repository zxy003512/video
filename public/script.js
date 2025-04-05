// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const resultsContainer = document.getElementById('results-container'); // Main container for both types
    const aiResultsArea = document.getElementById('ai-results-area'); // Target for AI results
    const yfspResultsArea = document.getElementById('yfsp-results-area'); // Target for YFSP results
    const yfspResultsGrid = document.getElementById('yfsp-results-grid'); // Grid within YFSP area
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
    const parsingSelectContainer = document.getElementById('player-parsing-selector'); // Container for selector in player
    const parsingSelect = document.getElementById('parsing-select');
    const videoPlayerIframe = document.getElementById('video-player');

    // --- State & Configuration ---
    let currentSettings = {};
    let defaultSettings = {
        defaultParsingInterfaces: [],
        defaultSearxngUrl: ''
    };
    let currentVideoLink = ''; // Store the link when opening player (for AI results parsing)

    // --- Functions ---

    const showLoading = (show, message = '正在智能分析中...') => { // Customizable message
        loadingIndicator.querySelector('p').textContent = message;
        loadingIndicator.style.display = show ? 'flex' : 'none'; // Using flex for center align
        searchBtn.disabled = show;
    };

    const showError = (message) => {
        errorMessageDiv.textContent = message;
        errorMessageDiv.style.display = 'block';
        setTimeout(() => {
             errorMessageDiv.style.display = 'none';
        }, 7000); // Longer display time
    };

    const clearError = () => {
        errorMessageDiv.style.display = 'none';
        errorMessageDiv.textContent = '';
    };

    const clearResults = () => {
        // Clear both result areas
        aiResultsArea.innerHTML = '';
        yfspResultsGrid.innerHTML = '';
        yfspResultsArea.style.display = 'none'; // Hide YFSP area initially
        resultsContainer.innerHTML = ''; // Clear the main container in case of "not found" message
    };

    // Load settings (Combined logic from previous version)
    const loadSettings = async () => {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('无法加载默认配置');
            defaultSettings = await response.json();
        } catch (error) {
            console.error("Error fetching default config:", error);
            showError("无法从服务器加载默认配置，将使用内置后备设置。");
             defaultSettings = {
                defaultParsingInterfaces: [
                    {"name": "接口1 - xmflv.com", "url": "https://jx.xmflv.com/?url="},
                    {"name": "接口2 - bd.jx.cn", "url": "https://bd.jx.cn/?url="},
                    {"name": "接口3 - xmflv.cc", "url": "https://jx.xmflv.cc/?url="},
                    {"name": "接口4 - hls.one", "url": "https://jx.hls.one/?url="},
                    {"name": "接口5 - 77flv.cc", "url": "https://jx.77flv.cc/?url="},
                    {"name": "接口6 - yemu.xyz", "url": "https://www.yemu.xyz/?url="}
                ],
                defaultSearxngUrl: "https://searxng.zetatechs.online/search" // Example default
             };
        }

        const savedSettings = localStorage.getItem('videoSearchPlayerSettings');
        if (savedSettings) {
            currentSettings = JSON.parse(savedSettings);
            // Ensure parsingInterfaces is always an array
            if (!Array.isArray(currentSettings.parsingInterfaces)) {
                currentSettings.parsingInterfaces = defaultSettings.defaultParsingInterfaces || [];
            }
             console.log("Loaded settings from localStorage:", currentSettings);
        } else {
            currentSettings = {
                aiApiUrl: '',
                aiApiKey: '',
                aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: defaultSettings.defaultParsingInterfaces ? JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces)) : [] // Deep copy defaults
            };
            console.log("Using default settings:", currentSettings);
        }
        populateSettingsForm();
        renderParsingInterfacesList();
        updateParsingSelect();
    };

    // Save settings (Combined logic)
    const saveSettings = () => {
        const newUrl = newInterfaceUrlInput.value.trim();
         if (newUrl && !newUrl.includes('?url=')) {
             showError("新解析接口URL应包含 '?url='");
             return;
         }
         if (newUrl && !newUrl.endsWith('=')) { // Keep this validation
             showError("新解析接口URL应以 '=' 结尾");
             return;
         }

        currentSettings = {
            aiApiUrl: aiApiUrlInput.value.trim(),
            aiApiKey: aiApiKeyInput.value.trim(),
            aiModel: aiModelInput.value.trim(),
            searxngUrl: searxngUrlInput.value.trim() || defaultSettings.defaultSearxngUrl,
            parsingInterfaces: currentSettings.parsingInterfaces || [] // Ensure interfaces are saved
        };
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
        console.log("Settings saved:", currentSettings);
        alert("设置已保存！");
        settingsModal.style.display = 'none';
        updateParsingSelect();
    };

    // Reset settings (Combined logic)
     const resetToDefaults = () => {
         if (confirm("确定要恢复所有设置为默认值吗？这将清除您自定义的API密钥和接口。")) {
             currentSettings = {
                aiApiUrl: '',
                aiApiKey: '',
                aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: defaultSettings.defaultParsingInterfaces ? JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces)) : [] // Deep copy defaults
             };
             localStorage.removeItem('videoSearchPlayerSettings');
             populateSettingsForm();
             renderParsingInterfacesList();
             updateParsingSelect();
             alert("设置已恢复为默认值。");
             settingsModal.style.display = 'none';
         }
    };

    // Populate settings form (Combined logic)
    const populateSettingsForm = () => {
        aiApiUrlInput.value = currentSettings.aiApiUrl || '';
        aiApiKeyInput.value = currentSettings.aiApiKey || '';
        aiModelInput.value = currentSettings.aiModel || '';
        searxngUrlInput.value = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl || '';
    };

    // Render parsing interfaces list (Combined logic)
    const renderParsingInterfacesList = () => {
        interfacesListDiv.innerHTML = '';
        if (!currentSettings.parsingInterfaces || currentSettings.parsingInterfaces.length === 0) {
             interfacesListDiv.innerHTML = '<p>没有配置解析接口。</p>';
             return;
        }
        currentSettings.parsingInterfaces.forEach((iface, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('interface-item');
            // Use danger-btn-small for styling the remove button
            itemDiv.innerHTML = `
                <span>${iface.name} (${iface.url})</span>
                <button data-index="${index}" class="remove-interface-btn danger-btn-small" aria-label="删除接口">&times;</button>
            `;
            interfacesListDiv.appendChild(itemDiv);
        });

        document.querySelectorAll('.remove-interface-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const indexToRemove = parseInt(e.target.closest('button').getAttribute('data-index'));
                removeParsingInterface(indexToRemove);
            });
        });
    };

    // Add parsing interface (Combined logic)
    const addParsingInterface = () => {
        const name = newInterfaceNameInput.value.trim();
        const url = newInterfaceUrlInput.value.trim();

        if (!name || !url) { showError("接口名称和URL不能为空"); return; }
        if (!url.includes('?url=')) { showError("URL 格式似乎不正确，应包含 '?url='"); return; }
         if (!url.endsWith('=')) { showError("URL 必须以 '=' 结尾"); return; }

        if (!currentSettings.parsingInterfaces) { currentSettings.parsingInterfaces = []; }
        // Check if URL already exists
        if (currentSettings.parsingInterfaces.some(iface => iface.url === url)) {
            showError("该接口 URL 已存在");
            return;
        }

        currentSettings.parsingInterfaces.push({ name, url });
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings)); // Save immediately
        renderParsingInterfacesList();
        updateParsingSelect();
        newInterfaceNameInput.value = '';
        newInterfaceUrlInput.value = '';
    };

    // Remove parsing interface (Combined logic)
    const removeParsingInterface = (index) => {
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces[index]) {
            currentSettings.parsingInterfaces.splice(index, 1);
            localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings)); // Save immediately
            renderParsingInterfacesList();
            updateParsingSelect();
        }
    };

    // Update parsing select dropdown (Combined logic)
    const updateParsingSelect = () => {
        parsingSelect.innerHTML = '';
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces.length > 0) {
            currentSettings.parsingInterfaces.forEach((iface) => {
                const option = document.createElement('option');
                option.value = iface.url;
                option.textContent = iface.name;
                parsingSelect.appendChild(option);
            });
            parsingSelect.disabled = false;
            if (parsingSelectContainer) parsingSelectContainer.style.display = 'block'; // Ensure visible if options exist
        } else {
            const option = document.createElement('option');
            option.textContent = '无可用解析接口';
            parsingSelect.appendChild(option);
            parsingSelect.disabled = true;
            if (parsingSelectContainer) parsingSelectContainer.style.display = 'none'; // Hide if no options
        }
    };

    // Display AI search results (Targets #ai-results-area)
    const displayResults = (results) => {
        aiResultsArea.innerHTML = ''; // Clear only AI results area
        if (!results || results.length === 0) {
            // Don't show "not found" here yet
            return;
        }

        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('result-card', 'ai-result-card'); // Specific class for AI results
            card.dataset.link = result.video_link;
            card.dataset.title = result.title;

            card.innerHTML = `
                <h3>${result.title}</h3>
                <p><span class="website-badge">${result.website || '未知来源'}</span></p>
                <p class="link-preview">${result.video_link.substring(0, 60)}${result.video_link.length > 60 ? '...' : ''}</p>
                 <button class="play-button" aria-label="播放 ${result.title}"><i class="fas fa-play"></i> 播放 (需解析)</button>
            `;
            // Add listener to the button specifically
            card.querySelector('.play-button').addEventListener('click', (e) => {
                e.stopPropagation();
                 if (parsingSelect.disabled) {
                     showError("请先在设置中添加至少一个视频解析接口才能播放此来源。");
                     return;
                 }
                currentVideoLink = result.video_link; // Store link for parsing
                openPlayer(currentVideoLink, result.title, false); // false = needs parsing
            });
            aiResultsArea.appendChild(card);
        });
    };

    // --- NEW: Display YFSP search results (Targets #yfsp-results-grid) ---
    const displayYfspResults = (results) => {
        yfspResultsGrid.innerHTML = ''; // Clear previous YFSP results
        if (!results || results.length === 0) {
            yfspResultsArea.style.display = 'none'; // Hide the whole YFSP section
            return;
        }

        yfspResultsArea.style.display = 'block'; // Show the YFSP section

        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('result-card', 'yfsp-result-card'); // Specific class for YFSP results
            card.dataset.playPageUrl = result.first_episode_play_page_url;
            card.dataset.title = result.title;

            card.innerHTML = `
                <div class="yfsp-card-content">
                    <div class="yfsp-cover">
                        <img src="${result.cover_img || 'loading.png'}" alt="${result.title} 封面" loading="lazy" onerror="this.src='loading.png'; this.onerror=null;">
                         ${result.note ? `<div class="yfsp-note">${result.note}</div>` : ''}
                    </div>
                    <div class="yfsp-info">
                         <h4>${result.title}</h4>
                         <button class="play-button yfsp-play-btn" aria-label="播放 ${result.title}"><i class="fas fa-play"></i> 直接播放</button>
                         <span class="yfsp-play-loading" style="display: none; margin-left: 10px;"><i class="fas fa-spinner fa-spin"></i></span>
                    </div>
                </div>
            `;

            const playButton = card.querySelector('.yfsp-play-btn');
            const loadingSpinner = card.querySelector('.yfsp-play-loading');

            playButton.addEventListener('click', async (e) => {
                e.stopPropagation();
                const playPageUrl = card.dataset.playPageUrl;
                const title = card.dataset.title;

                if (!playPageUrl) {
                    showError("无法获取播放页面地址。");
                    return;
                }

                // Show loading spinner next to button
                playButton.disabled = true;
                loadingSpinner.style.display = 'inline-block';

                try {
                    // Call backend endpoint to get the final player URL
                    const response = await fetch('/api/yfsp/episode', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ play_page_url: playPageUrl })
                    });

                    const data = await response.json();

                    if (!response.ok || data.error) {
                        throw new Error(data.error || `获取播放链接失败 (${response.status})`);
                    }

                    if (data.final_player_url) {
                        // Open player with the direct URL
                        openPlayer(data.final_player_url, title, true); // true = direct URL
                    } else {
                         throw new Error("未能获取到最终播放链接。");
                    }

                } catch (error) {
                    console.error("Error fetching YFSP direct link:", error);
                    showError(`播放 ${title} 时出错: ${error.message}`);
                } finally {
                     // Hide loading spinner and re-enable button
                     playButton.disabled = false;
                     loadingSpinner.style.display = 'none';
                }
            });

            yfspResultsGrid.appendChild(card);
        });
    };


    // Open the player modal (Handles both direct and parsable URLs)
    const openPlayer = (link, title, isDirectUrl = false) => {
        playerTitle.textContent = `正在播放: ${title}`;

        if (isDirectUrl) {
            // Direct URL (from YFSP) - Hide parser, set src directly
            console.log("Opening player with direct URL:", link);
            parsingSelectContainer.style.display = 'none'; // Hide parsing selector
            videoPlayerIframe.src = link;
        } else {
             // Needs parsing (from AI results) - Show parser, build URL
             console.log("Opening player, needs parsing for link:", link);
             if (parsingSelect.disabled) {
                 showError("请先在设置中添加至少一个视频解析接口。");
                 return; // Don't open if no parsers
             }
             currentVideoLink = link; // Store the raw link
             parsingSelectContainer.style.display = 'block'; // Show parsing selector
             const selectedParserUrl = parsingSelect.value;
             if (selectedParserUrl && currentVideoLink) {
                 videoPlayerIframe.src = selectedParserUrl + encodeURIComponent(currentVideoLink);
             } else {
                 videoPlayerIframe.src = 'about:blank'; // Clear src if error
                 showError("无法构建播放链接，请检查解析接口和视频链接。");
                 return; // Don't open if initial build fails
             }
        }

        playerModal.style.display = 'block';
    };

    // Close the player modal (Combined logic)
    const closePlayer = () => {
        playerModal.style.display = 'none';
        videoPlayerIframe.src = 'about:blank'; // Reset src to stop playback
        playerTitle.textContent = '正在播放...';
        currentVideoLink = '';
        // Reset parser visibility (it will be set correctly when opening again)
        parsingSelectContainer.style.display = 'block';
    };

    // Perform search (Handles combined AI & YFSP results)
    const performSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) {
            showError("请输入搜索内容");
            return;
        }

        clearError();
        clearResults(); // Clear both areas
        showLoading(true, '正在搜索和分析...'); // Updated message

        try {
            const requestBody = {
                 query: query,
                 settings: {
                     aiApiUrl: currentSettings.aiApiUrl,
                     aiApiKey: currentSettings.aiApiKey,
                     aiModel: currentSettings.aiModel,
                     searxngUrl: currentSettings.searxngUrl
                 }
             };

            console.log("Sending search request to backend:", requestBody);

            // Assume backend '/api/search' now returns an object with both results
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

             console.log("Backend Response Status:", response.status);
             const responseData = await response.json();
             console.log("Backend Response Data:", responseData);

            if (!response.ok) {
                 const errorMsg = responseData.error || `服务器错误 (代码: ${response.status})`;
                throw new Error(errorMsg);
            }

            // Extract results from the combined response object
            const aiResults = responseData.ai_results || [];
            const yfspResults = responseData.yfsp_results || [];

            displayResults(aiResults); // Display AI results into #ai-results-area
            displayYfspResults(yfspResults); // Display YFSP results into #yfsp-results-grid

            // Show "not found" message only if BOTH result sets are empty
            if (aiResults.length === 0 && yfspResults.length === 0) {
                 // Display the message within the main results container since both areas are empty
                 resultsContainer.innerHTML = '<p style="text-align: center; margin-top: 20px;">未能找到相关的影视播放链接。</p>';
            }


        } catch (error) {
            console.error("Search Error:", error);
            showError(`搜索或分析时出错: ${error.message}`);
            clearResults(); // Clear everything on error
        } finally {
            showLoading(false);
        }
    };


    // --- Event Listeners ---
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // Settings Modal Listeners (Combined logic)
    settingsBtn.addEventListener('click', () => {
        populateSettingsForm();
        renderParsingInterfacesList();
        settingsModal.style.display = 'block';
    });
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });
    saveSettingsBtn.addEventListener('click', saveSettings);
     resetSettingsBtn.addEventListener('click', resetToDefaults);
    addInterfaceBtn.addEventListener('click', addParsingInterface);

    // Player Modal Listeners (Combined logic)
    closePlayerBtn.addEventListener('click', closePlayer);
     // Update iframe src ONLY if the parsing selector is visible (i.e., for AI results)
    parsingSelect.addEventListener('change', () => {
        // Check if player is open AND the parser selector is visible (meaning it's an AI result)
        if (playerModal.style.display === 'block' && parsingSelectContainer.style.display === 'block' && currentVideoLink) {
             const selectedParserUrl = parsingSelect.value;
             if (selectedParserUrl) {
                  videoPlayerIframe.src = selectedParserUrl + encodeURIComponent(currentVideoLink);
             }
        }
    });

    // Close modals on outside click (Combined logic)
    window.addEventListener('click', (event) => {
        if (event.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
         if (event.target === playerModal) {
            closePlayer();
        }
    });

    // --- Initial Load ---
    loadSettings();

}); // End DOMContentLoaded
