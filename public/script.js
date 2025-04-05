// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const resultsContainer = document.getElementById('results-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const loadingText = document.getElementById('loading-text');
    const errorMessageDiv = document.getElementById('error-message');
    const searchMethodRadios = document.querySelectorAll('input[name="search-method"]');

    // Settings Modal
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = settingsModal.querySelector('.close-settings-btn');
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
    const parsingSelectorContainer = document.getElementById('parsing-selector-container');
    const parsingSelect = document.getElementById('parsing-select');
    const videoPlayerIframe = document.getElementById('video-player');
    const playerLoadingIndicator = document.getElementById('player-loading-indicator');

    // Episode Selector Modal (New)
    const episodeSelectorModal = document.getElementById('episode-selector-modal');
    const closeEpisodeSelectorBtn = episodeSelectorModal.querySelector('.close-episode-selector-btn');
    const episodeSelectorTitle = document.getElementById('episode-selector-title');
    const episodeListContainer = document.getElementById('episode-list-container');
    const episodeLoadingIndicator = document.getElementById('episode-loading-indicator');
    const episodeErrorMessage = document.getElementById('episode-error-message');


    // --- State & Configuration ---
    let currentSettings = {};
    let defaultSettings = {
        defaultParsingInterfaces: [],
        defaultSearxngUrl: ''
    };
    let currentVideoLink = ''; // Stores the video link for AI method playback requiring parsing
    let currentSearchMethod = 'ai'; // Default search method

    // --- Helper Functions ---

    const showLoading = (show, method = 'ai') => {
        if (show) {
            loadingText.textContent = method === 'ai' ? '正在智能分析中...' : '正在搜索 YFSP 资源...';
            loadingIndicator.style.display = 'flex';
            clearResults(); // Clear previous results when loading starts
        } else {
            loadingIndicator.style.display = 'none';
        }
        searchBtn.disabled = show;
    };

    const showPlayerLoading = (show) => {
        playerLoadingIndicator.style.display = show ? 'flex' : 'none';
        videoPlayerIframe.style.opacity = show ? '0' : '1';
    };

    // Show loading/error state within the episode selector modal
    const showEpisodeLoading = (show) => {
        episodeLoadingIndicator.style.display = show ? 'flex' : 'none';
        episodeListContainer.style.display = show ? 'none' : 'grid'; // Use grid for buttons
        episodeErrorMessage.style.display = 'none'; // Hide error when loading
    };

    const showEpisodeError = (message) => {
        episodeErrorMessage.textContent = message;
        episodeErrorMessage.style.display = 'block';
        episodeLoadingIndicator.style.display = 'none';
        episodeListContainer.style.display = 'none'; // Hide button grid on error
    };

    const clearEpisodeError = () => {
        episodeErrorMessage.style.display = 'none';
    };

    const showError = (message) => {
        errorMessageDiv.textContent = message;
        errorMessageDiv.style.display = 'block';
        setTimeout(() => {
            errorMessageDiv.style.display = 'none';
        }, 6000);
    };

    const clearError = () => {
        errorMessageDiv.style.display = 'none';
        errorMessageDiv.textContent = '';
    };

    const clearResults = () => {
        resultsContainer.innerHTML = '';
    };

    // --- Settings Management ---

    const loadSettings = async () => {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error(`无法加载默认配置 (${response.status})`);
            defaultSettings = await response.json();
            console.log("Fetched default config:", defaultSettings);
        } catch (error) {
            console.error("Error fetching default config:", error);
            showError(`无法从服务器加载默认配置: ${error.message}`);
            // Hardcoded fallbacks if API fails catastrophically
            defaultSettings = {
                defaultParsingInterfaces: [
                    {"name": "接口1 - xmflv.com", "url": "https://jx.xmflv.com/?url="}, {"name": "接口2 - bd.jx.cn", "url": "https://bd.jx.cn/?url="},
                    {"name": "接口3 - xmflv.cc", "url": "https://jx.xmflv.cc/?url="}, {"name": "接口4 - hls.one", "url": "https://jx.hls.one/?url="},
                    {"name": "接口5 - 77flv.cc", "url": "https://jx.77flv.cc/?url="}, {"name": "接口6 - yemu.xyz", "url": "https://www.yemu.xyz/?url="}
                ],
                defaultSearxngUrl: "https://searxng.example.com/search" // Use a generic example
             };
        }

        const savedSettings = localStorage.getItem('videoSearchPlayerSettings');
        if (savedSettings) {
            currentSettings = JSON.parse(savedSettings);
            // Ensure essential keys exist, merge with defaults if partial save
            currentSettings.searxngUrl = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl;
            currentSettings.parsingInterfaces = currentSettings.parsingInterfaces || defaultSettings.defaultParsingInterfaces;
            console.log("Loaded settings from localStorage:", currentSettings);
        } else {
            // Initialize with defaults if nothing is saved
            currentSettings = {
                aiApiUrl: '', aiApiKey: '', aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                // Make a deep copy of interfaces to avoid modifying defaults later
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces))
            };
            console.log("Using default settings:", currentSettings);
        }

        currentSearchMethod = localStorage.getItem('videoSearchMethod') || 'ai';
        const radioToCheck = document.querySelector(`input[name="search-method"][value="${currentSearchMethod}"]`);
        if (radioToCheck) radioToCheck.checked = true;

        populateSettingsForm();
        renderParsingInterfacesList();
        updateParsingSelect();
    };

    const saveSettings = () => {
        // Basic validation for new interface URL
         const newUrl = newInterfaceUrlInput.value.trim();
         const newName = newInterfaceNameInput.value.trim();
         if ((newName || newUrl) && (!newName || !newUrl)) {
            showError("添加新接口需要同时提供名称和 URL。");
            return;
         }
         if (newUrl && !newUrl.includes('?url=')) {
             showError("新解析接口 URL 格式似乎不正确，应包含 '?url='");
             return;
         }
         if (newUrl && !newUrl.endsWith('=')) {
             showError("新解析接口 URL 通常应以 '=' 结尾");
             // return; // Make it a warning, not a hard error
         }
         // If validation passes and fields are populated, add the interface first
         if (newName && newUrl) {
             addParsingInterface(newName, newUrl); // Add first, then save all
         }


        currentSettings = {
            aiApiUrl: aiApiUrlInput.value.trim(),
            aiApiKey: aiApiKeyInput.value.trim(),
            aiModel: aiModelInput.value.trim(),
            searxngUrl: searxngUrlInput.value.trim() || defaultSettings.defaultSearxngUrl,
            parsingInterfaces: currentSettings.parsingInterfaces || []
        };
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
        localStorage.setItem('videoSearchMethod', currentSearchMethod);
        console.log("Settings saved:", currentSettings);
        alert("设置已保存！");
        settingsModal.style.display = 'none';
        updateParsingSelect(); // Update dropdown in case interfaces changed
    };

    const resetToDefaults = () => {
         if (confirm("确定要恢复所有设置为默认值吗？这将清除您自定义的AI密钥、模型、搜索引擎地址和解析接口。")) {
             currentSettings = {
                aiApiUrl: '', aiApiKey: '', aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces))
             };
             localStorage.removeItem('videoSearchPlayerSettings');
             currentSearchMethod = 'ai'; // Reset search method to default
             localStorage.setItem('videoSearchMethod', currentSearchMethod);
             const radioToReset = document.querySelector(`input[name="search-method"][value="ai"]`);
             if (radioToReset) radioToReset.checked = true;

             populateSettingsForm();
             renderParsingInterfacesList();
             updateParsingSelect();
             alert("设置已恢复为默认值。");
             settingsModal.style.display = 'none';
         }
    };

    const populateSettingsForm = () => {
        aiApiUrlInput.value = currentSettings.aiApiUrl || '';
        aiApiKeyInput.value = currentSettings.aiApiKey || '';
        aiModelInput.value = currentSettings.aiModel || '';
        searxngUrlInput.value = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl;
    };

    const renderParsingInterfacesList = () => {
        interfacesListDiv.innerHTML = '';
        if (!currentSettings.parsingInterfaces || currentSettings.parsingInterfaces.length === 0) {
             interfacesListDiv.innerHTML = '<p>没有配置解析接口。</p>';
             return;
        }
        currentSettings.parsingInterfaces.forEach((iface, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('interface-item');
            itemDiv.innerHTML = `
                <span title="${iface.url}">${iface.name} (${iface.url.length > 50 ? iface.url.substring(0, 50) + '...' : iface.url})</span>
                <button data-index="${index}" class="remove-interface-btn" aria-label="删除接口 ${iface.name}">&times;</button>
            `;
            interfacesListDiv.appendChild(itemDiv);

            // Add listener inside the loop where itemDiv is defined
             itemDiv.querySelector('.remove-interface-btn').addEventListener('click', (e) => {
                 const indexToRemove = parseInt(e.target.getAttribute('data-index'));
                 removeParsingInterface(indexToRemove);
             });
        });
    };

    const addParsingInterface = (name, url) => {
        // Assumes validation already happened in saveSettings
        if (!currentSettings.parsingInterfaces) { currentSettings.parsingInterfaces = []; }

        // Check for duplicates
         const exists = currentSettings.parsingInterfaces.some(iface => iface.url === url || iface.name === name);
         if (exists) {
             showError(`已存在相同名称或 URL 的接口: ${name}`);
             return;
         }

        currentSettings.parsingInterfaces.push({ name, url });
        renderParsingInterfacesList(); // Update UI list immediately
        updateParsingSelect(); // Update dropdown
        newInterfaceNameInput.value = ''; // Clear input fields after successful add
        newInterfaceUrlInput.value = '';
        // Note: Actual saving happens when 'Save Settings' is clicked
    };

    const removeParsingInterface = (index) => {
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces[index]) {
            const removed = currentSettings.parsingInterfaces.splice(index, 1);
            console.log("Removed interface:", removed[0]);
            renderParsingInterfacesList();
            updateParsingSelect();
            // Note: Actual saving happens when 'Save Settings' is clicked
        }
    };

    const updateParsingSelect = () => {
        parsingSelect.innerHTML = ''; // Clear existing options
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces.length > 0) {
            currentSettings.parsingInterfaces.forEach((iface) => {
                const option = document.createElement('option');
                option.value = iface.url;
                option.textContent = iface.name;
                parsingSelect.appendChild(option);
            });
            parsingSelect.disabled = false;
        } else {
            const option = document.createElement('option');
            option.textContent = '没有可用的解析接口';
            option.value = '';
            parsingSelect.appendChild(option);
            parsingSelect.disabled = true;
        }
        // Show/hide based on whether AI method is selected and interfaces exist
        parsingSelectorContainer.style.display = (currentSearchMethod === 'ai' && !parsingSelect.disabled) ? '' : 'none';
    };

    // --- Search & Results Display ---

    const displayResults = (results) => {
        clearResults();
        if (!results || results.length === 0) {
            resultsContainer.innerHTML = `<p class="no-results">未能找到相关资源。请尝试更换关键词或搜索方式。</p>`;
            return;
        }

        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('result-card');
            card.dataset.title = result.title;

            if (result.method === 'yfsp') {
                // --- YFSP Card ---
                card.classList.add('yfsp-card');
                card.dataset.id = result.id;
                card.dataset.baseUrl = result.base_url;
                card.dataset.method = 'yfsp';
                card.innerHTML = `
                    <div class="yfsp-cover">
                        <img src="${result.cover || ''}" alt="${result.title || '封面'} Cover" loading="lazy" onerror="this.parentElement.style.display='none';">
                    </div>
                    <div class="yfsp-info">
                         <h3>${result.title || '未知标题'}</h3>
                         ${result.description ? `<p class="yfsp-desc">${result.description}</p>` : ''}
                         <button class="select-episode-btn action-btn"><i class="fas fa-list-ol"></i> 选择剧集</button>
                    </div>
                `;
                const selectButton = card.querySelector('.select-episode-btn');
                 if (selectButton) {
                     selectButton.addEventListener('click', (e) => {
                         e.stopPropagation();
                         showEpisodeSelector(result.id, result.base_url, result.title, selectButton);
                     });
                 }
            } else {
                // --- AI Card ---
                 card.classList.add('ai-card');
                 card.dataset.link = result.video_link;
                 card.dataset.method = 'ai';
                 const website = result.website || '未知来源';
                 card.innerHTML = `
                    <h3>${result.title}</h3>
                    <p><span class="website-badge" title="${website}">${website.length > 20 ? website.substring(0, 18)+'...' : website}</span></p>
                    <p class="link-preview" title="${result.video_link}">${result.video_link.substring(0, 60)}${result.video_link.length > 60 ? '...' : ''}</p>
                    <button class="play-ai-btn action-btn"><i class="fas fa-play-circle"></i> 点击播放</button>
                 `;
                 const playButton = card.querySelector('.play-ai-btn');
                 if (playButton) {
                     playButton.addEventListener('click', (e) => {
                         e.stopPropagation(); // Prevent potential card-level listener if added later
                         if (parsingSelect.disabled) {
                             showError("请先在设置中添加并保存至少一个视频解析接口才能播放此链接。");
                             return;
                         }
                         openPlayer(result.video_link, result.title, false); // false = requires parsing
                     });
                 }
            }
            resultsContainer.appendChild(card);
        });
    };

    // --- Episode Selection & Playback (YFSP) ---

    const showEpisodeSelector = async (videoId, baseUrl, title, buttonElement) => {
        console.log(`Fetching episodes for YFSP: id=${videoId}, title=${title}`);
        episodeSelectorTitle.textContent = `选择剧集 - ${title}`;
        episodeListContainer.innerHTML = ''; // Clear previous buttons
        clearEpisodeError();
        showEpisodeLoading(true);
        episodeSelectorModal.style.display = 'block';

        // Disable original button while loading episodes
        if (buttonElement) {
            buttonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 加载...`;
            buttonElement.disabled = true;
        }

        try {
            const response = await fetch('/api/get_episodes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: videoId, base_url: baseUrl })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `无法获取剧集列表 (${response.status})`);
            }

            if (!data.episodes || data.episodes.length === 0) {
                throw new Error("未能找到任何剧集信息");
            }

            // Populate episode buttons
            episodeListContainer.innerHTML = ''; // Clear again just in case
            data.episodes.forEach(ep => {
                const epButton = document.createElement('button');
                epButton.classList.add('episode-button');
                epButton.textContent = ep.num_text; // Display text like "01", "高清版 02" etc.
                epButton.dataset.videoId = videoId;
                epButton.dataset.baseUrl = baseUrl;
                epButton.dataset.title = title;
                epButton.dataset.episodeNum = ep.num; // Use the actual number for the API call
                epButton.dataset.href = ep.href; // Store href for potential future use
                epButton.addEventListener('click', (e) => {
                    const btn = e.currentTarget;
                    playYfspEpisode(
                        btn.dataset.videoId,
                        btn.dataset.baseUrl,
                        btn.dataset.title,
                        btn.dataset.episodeNum, // Pass the episode number
                        btn // Pass the button itself for loading state
                    );
                });
                episodeListContainer.appendChild(epButton);
            });
            showEpisodeLoading(false); // Show buttons

        } catch (error) {
            console.error("Error fetching/displaying episodes:", error);
            showEpisodeError(`加载剧集时出错: ${error.message}`);
        } finally {
            // Re-enable original button
            if (buttonElement) {
                buttonElement.innerHTML = `<i class="fas fa-list-ol"></i> 选择剧集`;
                buttonElement.disabled = false;
            }
        }
    };

    // Function to handle playing a SPECIFIC YFSP episode
    // Now called from the episode selector modal buttons
    const playYfspEpisode = async (videoId, baseUrl, title, episodeNum, buttonElement) => {
        console.log(`Attempting to play YFSP: id=${videoId}, ep=${episodeNum}, title=${title}`);

        // Close the episode selector modal FIRST
        closeEpisodeSelector();

        // Show loading indicator in the main player modal immediately
        openPlayer(null, `${title} - 第 ${episodeNum} 集`, true); // Open player frame, but show loading
        showPlayerLoading(true);

        // Temporarily disable the clicked episode button (if passed)
        let originalButtonText;
        if (buttonElement) {
            originalButtonText = buttonElement.innerHTML;
            buttonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
            buttonElement.disabled = true;
        }

        clearError(); // Clear main error area

        try {
            const response = await fetch('/api/get_episode_details', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ id: videoId, episode: episodeNum, base_url: baseUrl })
            });

            const data = await response.json();

            if (!response.ok) {
                 throw new Error(data.error || `无法获取剧集 ${episodeNum} 的播放信息 (${response.status})`);
            }

            if (data.player_url) {
                 console.log("Received player_url:", data.player_url);
                 // Update the already open player modal's iframe src
                 videoPlayerIframe.src = data.player_url;
                 // Loading will hide on iframe load/error event
            } else {
                throw new Error(`未能从服务器获取到有效的播放链接`);
            }

        } catch (error) {
             console.error("Error fetching/playing YFSP episode:", error);
             showError(`播放剧集 ${episodeNum} 时出错: ${error.message}`);
             // If fetching fails, close the player modal
             closePlayer();
        } finally {
             // Restore episode button state if it was passed
             if (buttonElement && originalButtonText) {
                 buttonElement.innerHTML = originalButtonText;
                 buttonElement.disabled = false;
             }
             // Loading indicator in player is handled by iframe load/error
        }
    };

    // --- Player Modal ---

    const openPlayer = (urlOrLink, title, isDirectUrl = false) => {
        playerTitle.textContent = title;
        videoPlayerIframe.src = 'about:blank'; // Clear previous content
        showPlayerLoading(true); // Show loading

        // Configure based on URL type
        if (isDirectUrl) {
            // --- Direct URL (from YFSP or potentially future methods) ---
            console.log("Opening player with direct URL:", urlOrLink);
            currentVideoLink = ''; // Clear parsing link state
            parsingSelectorContainer.style.display = 'none'; // Hide parsing selector
            if (urlOrLink) { // Only set src if URL is provided (allows opening modal just for loading)
                 videoPlayerIframe.src = urlOrLink;
            } else {
                console.log("Opening player modal in loading state (no initial URL)");
                // Keep src="about:blank", loading indicator is already shown
            }
        } else {
            // --- Link requires parsing (from AI method) ---
            console.log("Opening player, needs parsing:", urlOrLink);
            if (parsingSelect.disabled) {
                showPlayerLoading(false);
                showError("请先在设置中添加并保存至少一个视频解析接口。");
                return;
            }
            currentVideoLink = urlOrLink; // Store the raw video link needing parsing
            parsingSelectorContainer.style.display = ''; // Show parsing selector
            updatePlayerWithParser(); // Call function to set initial parsed URL
        }

        // Add load/error handlers AFTER potentially setting src
        videoPlayerIframe.onload = () => {
            console.log("Player iframe loaded.");
            showPlayerLoading(false);
        };
        videoPlayerIframe.onerror = () => {
            console.error("Player iframe failed to load.");
            showPlayerLoading(false);
            showError("加载播放器资源时出错。请尝试更换解析接口（如果可用）或检查链接。");
            // Optionally clear the iframe src on error
            // videoPlayerIframe.src = 'about:blank';
        };


        playerModal.style.display = 'block'; // Show the modal at the end
    };

    // Helper to set iframe source based on selected parser (for AI method)
    const updatePlayerWithParser = () => {
        if (!currentVideoLink || parsingSelect.disabled || parsingSelectorContainer.style.display === 'none') {
             console.log("Parser update skipped (no link, selector disabled/hidden)");
             return;
        }
        const selectedParserUrl = parsingSelect.value;
        if (selectedParserUrl) {
            const finalUrl = selectedParserUrl + encodeURIComponent(currentVideoLink);
            console.log("Updating player with parser:", selectedParserUrl, "Final URL:", finalUrl);
            videoPlayerIframe.src = 'about:blank'; // Clear first
            showPlayerLoading(true);
            videoPlayerIframe.src = finalUrl; // Set new source
        } else {
            console.warn("No parser selected, cannot update player.");
            showError("请选择一个解析接口。");
            videoPlayerIframe.src = 'about:blank';
            showPlayerLoading(false);
        }
    };


    const closePlayer = () => {
        playerModal.style.display = 'none';
        videoPlayerIframe.src = 'about:blank'; // Stop playback & clear
        playerTitle.textContent = '正在播放...';
        currentVideoLink = ''; // Clear stored link for parsing
        showPlayerLoading(false); // Ensure loading is hidden
    };

    const closeEpisodeSelector = () => {
         episodeSelectorModal.style.display = 'none';
         episodeListContainer.innerHTML = ''; // Clear buttons
         episodeSelectorTitle.textContent = '选择剧集';
         clearEpisodeError();
         showEpisodeLoading(false); // Hide loading indicator
    }

    // --- Main Search Function ---

    const performSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) {
            showError("请输入搜索内容");
            return;
        }

        const selectedMethod = document.querySelector('input[name="search-method"]:checked').value;
        currentSearchMethod = selectedMethod;
        localStorage.setItem('videoSearchMethod', currentSearchMethod);
        updateParsingSelect(); // Update visibility of parser dropdown based on method

        clearError();
        clearResults();
        showLoading(true, selectedMethod);

        try {
            const requestBody = {
                 query: query,
                 method: selectedMethod,
                 settings: { // Send relevant settings
                     // AI settings are only strictly needed if method is 'ai', but backend handles it
                     aiApiUrl: currentSettings.aiApiUrl,
                     aiApiKey: currentSettings.aiApiKey,
                     aiModel: currentSettings.aiModel,
                     searxngUrl: currentSettings.searxngUrl
                 }
             };

            console.log("Sending search request to backend:", JSON.stringify(requestBody, null, 2));

            const response = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify(requestBody),
            });

            console.log("Backend Response Status:", response.status);
            const responseData = await response.json();
            // console.log("Backend Response Data:", responseData); // Might be very large

            if (!response.ok) {
                const errorMsg = responseData.error || `搜索失败 (${response.status})`;
                throw new Error(errorMsg);
            }

            // Display results expects array, backend should always return array or error
            if (Array.isArray(responseData)) {
                console.log(`Received ${responseData.length} results from backend.`);
                displayResults(responseData);
            } else {
                // Should not happen if backend is correct, but handle defensively
                console.error("Backend returned non-array response:", responseData);
                throw new Error("收到的响应格式不正确");
            }

        } catch (error) {
            console.error("Search Error:", error);
            showError(`搜索或分析时出错: ${error.message}`);
            clearResults(); // Clear results area on error
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

    searchMethodRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentSearchMethod = e.target.value;
            localStorage.setItem('videoSearchMethod', currentSearchMethod);
            console.log("Search method changed to:", currentSearchMethod);
            updateParsingSelect(); // Show/hide parser dropdown based on selection
        });
    });

    // Settings Modal
    settingsBtn.addEventListener('click', () => {
        populateSettingsForm(); // Load current settings into form
        renderParsingInterfacesList(); // Render list based on current settings
        settingsModal.style.display = 'block';
    });
    closeSettingsBtn.addEventListener('click', () => { settingsModal.style.display = 'none'; });
    saveSettingsBtn.addEventListener('click', saveSettings);
    resetSettingsBtn.addEventListener('click', resetToDefaults);
    addInterfaceBtn.addEventListener('click', (e) => {
         e.preventDefault(); // Prevent potential form submission
         const name = newInterfaceNameInput.value.trim();
         const url = newInterfaceUrlInput.value.trim();
         if (!name || !url) {
             showError("添加新接口需要同时提供名称和 URL。");
             return;
         }
          if (!url.includes('?url=')) {
             showError("新解析接口 URL 格式似乎不正确，应包含 '?url='");
             return;
         }
         if (!url.endsWith('=')) {
              showError("新解析接口 URL 通常应以 '=' 结尾");
             // return; // Warning only
         }
         addParsingInterface(name, url);
    });

    // Player Modal
    closePlayerBtn.addEventListener('click', closePlayer);
    parsingSelect.addEventListener('change', updatePlayerWithParser); // Update iframe when parser changes for AI links

    // Episode Selector Modal
    closeEpisodeSelectorBtn.addEventListener('click', closeEpisodeSelector);

    // Global Click Listener for Closing Modals
    window.addEventListener('click', (event) => {
        if (event.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
        if (event.target === playerModal) {
            closePlayer();
        }
         if (event.target === episodeSelectorModal) {
             closeEpisodeSelector();
         }
    });

    // --- Initial Load ---
    loadSettings(); // Load settings and initialize UI state

}); // End DOMContentLoaded
