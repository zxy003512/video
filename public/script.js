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
    const parsingSelectorContainer = document.getElementById('parsing-selector-container');
    const parsingSelect = document.getElementById('parsing-select');
    const episodeListContainer = document.getElementById('episode-list-container'); // New container for episodes
    const videoPlayerIframe = document.getElementById('video-player');
    const playerLoadingIndicator = document.getElementById('player-loading-indicator');

    // --- State & Configuration ---
    let currentSettings = {};
    let defaultSettings = {
        defaultParsingInterfaces: [],
        defaultSearxngUrl: ''
    };
    let currentVideoLink = ''; // Store the link for AI method results needing parsing
    let currentYfspBaseUrl = ''; // Store base URL for YFSP episode fetching
    let currentEpisodes = []; // Store fetched episode list for YFSP
    let currentSearchMethod = 'ai'; // Default search method

    // --- Functions ---

    const showLoading = (show, method = 'ai') => {
        if (show) {
            loadingText.textContent = method === 'ai' ? '正在智能分析中...' : '正在搜索 YFSP 资源...';
            loadingIndicator.style.display = 'flex';
        } else {
            loadingIndicator.style.display = 'none';
        }
        searchBtn.disabled = show;
    };

    const showPlayerLoading = (show) => {
         playerLoadingIndicator.style.display = show ? 'flex' : 'none';
         videoPlayerIframe.style.opacity = show ? '0' : '1'; // Hide iframe while loading
    };

    const showError = (message, isPlayerError = false) => {
        if (isPlayerError) {
            // Show error near player, maybe overlay? For now, use main error div.
            console.error("Player Error:", message);
        }
        errorMessageDiv.textContent = message;
        errorMessageDiv.style.display = 'block';
        // Auto-hide after a while, except maybe for critical player errors?
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

    // Load settings from localStorage or fetch defaults
    const loadSettings = async () => {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error(`无法加载默认配置 (${response.status})`);
            defaultSettings = await response.json();
        } catch (error) {
            console.error("Error fetching default config:", error);
            showError(`无法从服务器加载默认配置: ${error.message}。将使用内置后备设置。`);
            // Use hardcoded fallbacks only if fetch fails catastrophically
            defaultSettings = {
                defaultParsingInterfaces: [
                    {"name": "接口1 - xmflv.com", "url": "https://jx.xmflv.com/?url="}, {"name": "接口2 - bd.jx.cn", "url": "https://bd.jx.cn/?url="},
                    {"name": "接口3 - xmflv.cc", "url": "https://jx.xmflv.cc/?url="}, {"name": "接口4 - hls.one", "url": "https://jx.hls.one/?url="},
                    {"name": "接口5 - 77flv.cc", "url": "https://jx.77flv.cc/?url="}, {"name": "接口6 - yemu.xyz", "url": "https://www.yemu.xyz/?url="}
                ],
                defaultSearxngUrl: "https://searxng.zetatechs.online/search"
             };
        }

        const savedSettings = localStorage.getItem('videoSearchPlayerSettings');
        if (savedSettings) {
            currentSettings = JSON.parse(savedSettings);
            // Ensure essential keys exist after loading
            currentSettings.parsingInterfaces = currentSettings.parsingInterfaces || [];
            currentSettings.searxngUrl = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl;
            console.log("Loaded settings from localStorage:", currentSettings);
        } else {
            currentSettings = {
                aiApiUrl: '', aiApiKey: '', aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                // Deep copy default interfaces to avoid modification issues
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces || []))
            };
            console.log("Using default settings:", currentSettings);
        }

        currentSearchMethod = localStorage.getItem('videoSearchMethod') || 'ai';
        document.querySelector(`input[name="search-method"][value="${currentSearchMethod}"]`).checked = true;

        populateSettingsForm();
        renderParsingInterfacesList();
        updateParsingSelect();
    };

    // Save settings to localStorage
    const saveSettings = () => {
         // Basic validation moved inside addParsingInterface
         // Just update currentSettings from form
        currentSettings = {
            aiApiUrl: aiApiUrlInput.value.trim(),
            aiApiKey: aiApiKeyInput.value.trim(),
            aiModel: aiModelInput.value.trim(),
            searxngUrl: searxngUrlInput.value.trim() || defaultSettings.defaultSearxngUrl,
            // parsingInterfaces is managed separately by add/remove functions
            parsingInterfaces: currentSettings.parsingInterfaces || []
        };
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
        localStorage.setItem('videoSearchMethod', currentSearchMethod);
        console.log("Settings saved:", currentSettings);
        alert("设置已保存！");
        settingsModal.style.display = 'none';
        updateParsingSelect(); // Update player dropdown if interfaces changed
    };

     // Reset settings to defaults fetched from backend
    const resetToDefaults = () => {
         if (confirm("确定要恢复所有设置为默认值吗？这将清除您自定义的AI密钥、搜索引擎地址和解析接口。")) {
             currentSettings = {
                aiApiUrl: '', aiApiKey: '', aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                // Deep copy default interfaces
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces || []))
             };
             localStorage.removeItem('videoSearchPlayerSettings'); // Remove saved settings
             currentSearchMethod = 'ai'; // Reset search method to default
             localStorage.setItem('videoSearchMethod', currentSearchMethod);
             document.querySelector(`input[name="search-method"][value="ai"]`).checked = true;

             populateSettingsForm(); // Update form fields
             renderParsingInterfacesList(); // Update interface list in settings
             updateParsingSelect(); // Update player dropdown
             alert("设置已恢复为默认值。");
             settingsModal.style.display = 'none';
         }
    };

    // Populate the settings form fields
    const populateSettingsForm = () => {
        aiApiUrlInput.value = currentSettings.aiApiUrl || '';
        aiApiKeyInput.value = currentSettings.aiApiKey || '';
        aiModelInput.value = currentSettings.aiModel || '';
        searxngUrlInput.value = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl;
    };

    // Render the list of parsing interfaces in the settings modal
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
                <span>${escapeHtml(iface.name)} (${escapeHtml(iface.url)})</span>
                <button data-index="${index}" class="remove-interface-btn" aria-label="删除接口">&times;</button>
            `;
            interfacesListDiv.appendChild(itemDiv);
        });

        // Re-attach event listeners after rendering
        document.querySelectorAll('.remove-interface-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const indexToRemove = parseInt(e.target.dataset.index); // Use dataset
                removeParsingInterface(indexToRemove);
            });
        });
    };

     // Helper to escape HTML to prevent XSS from interface names/URLs
     const escapeHtml = (unsafe) => {
        if (!unsafe) return '';
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
     }

    // Add a new parsing interface
    const addParsingInterface = () => {
        const name = newInterfaceNameInput.value.trim();
        const url = newInterfaceUrlInput.value.trim();

        if (!name || !url) { showError("接口名称和URL不能为空"); return; }
        // Basic check for format, allow flexibility but require placeholder
        if (!url.includes('?url=') && !url.includes('{url}')) { // Allow different placeholder styles
             showError("URL 格式似乎不正确，应包含 '?url=' 或 '{url}' 占位符");
             return;
        }
        // We won't enforce ending with '=' anymore, as some templates might differ

        if (!currentSettings.parsingInterfaces) { currentSettings.parsingInterfaces = []; }
        currentSettings.parsingInterfaces.push({ name, url });
        // Immediately save to localStorage after adding
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
        renderParsingInterfacesList(); // Update display in settings
        updateParsingSelect(); // Update dropdown in player
        newInterfaceNameInput.value = ''; newInterfaceUrlInput.value = ''; // Clear input fields
        console.log("Added interface, current interfaces:", currentSettings.parsingInterfaces);
    };

    // Remove a parsing interface
    const removeParsingInterface = (index) => {
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces[index]) {
            currentSettings.parsingInterfaces.splice(index, 1);
            // Immediately save to localStorage after removing
            localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
            renderParsingInterfacesList(); // Update display in settings
            updateParsingSelect(); // Update dropdown in player
            console.log("Removed interface, current interfaces:", currentSettings.parsingInterfaces);
        }
    };

     // Update the <select> dropdown in the player modal
    const updateParsingSelect = () => {
        parsingSelect.innerHTML = ''; // Clear existing options
        console.log("Updating parsing select with interfaces:", currentSettings.parsingInterfaces);
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces.length > 0) {
            currentSettings.parsingInterfaces.forEach((iface) => {
                const option = document.createElement('option');
                option.value = iface.url;
                option.textContent = iface.name;
                parsingSelect.appendChild(option);
            });
            parsingSelect.disabled = false;
            // Visibility is handled by openPlayer based on method
        } else {
            const option = document.createElement('option');
            option.textContent = '没有可用的解析接口';
            option.value = '';
            option.disabled = true; // Disable the placeholder option
            parsingSelect.appendChild(option);
            parsingSelect.disabled = true;
            // Visibility is handled by openPlayer
        }
    };


    // Display search results - Handles both AI and YFSP results
    const displayResults = (results) => {
        clearResults();
        if (!results || results.length === 0) {
            resultsContainer.innerHTML = `<p style="text-align: center;">未能找到相关资源。请尝试更换关键词或搜索方式。</p>`;
            return;
        }

        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('result-card');
            card.dataset.title = result.title; // Store title for player

            if (result.method === 'yfsp' && result.id && result.base_url && result.cover) {
                // --- YFSP Card ---
                card.classList.add('yfsp-card');
                card.dataset.id = result.id;
                card.dataset.baseUrl = result.base_url;
                card.dataset.method = 'yfsp';
                card.innerHTML = `
                    <div class="yfsp-cover">
                        <img src="${escapeHtml(result.cover)}" alt="${escapeHtml(result.title)} Cover" loading="lazy" onerror="this.parentElement.style.display='none';">
                    </div>
                    <div class="yfsp-info">
                         <h3>${escapeHtml(result.title)}</h3>
                         <button class="select-episode-btn"><i class="fas fa-list-ul"></i> 选择剧集</button>
                    </div>
                `;
                // Add event listener for the "Select Episode" button
                card.querySelector('.select-episode-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const btn = e.currentTarget;
                    // Store data needed for fetching episodes
                    btn.dataset.id = result.id;
                    btn.dataset.baseUrl = result.base_url;
                    btn.dataset.title = result.title;
                    openYfspPlayer(btn); // Pass the button itself for loading state
                });

            } else if (result.method === 'ai' && result.video_link) {
                // --- AI Card (Original) ---
                 card.classList.add('ai-card');
                 card.dataset.link = result.video_link; // The link needing parsing
                 card.dataset.method = 'ai';
                 card.innerHTML = `
                    <h3>${escapeHtml(result.title)}</h3>
                    <p><span class="website-badge">${escapeHtml(result.website || '未知来源')}</span></p>
                    <p class="link-preview" title="${escapeHtml(result.video_link)}">${escapeHtml(result.video_link.substring(0, 60))}${result.video_link.length > 60 ? '...' : ''}</p>
                    <span class="play-hint"><i class="fas fa-play-circle"></i> 点击播放 (使用解析接口)</span>
                 `;
                 // Add event listener for the whole card to open AI player
                 card.addEventListener('click', () => {
                    if (parsingSelect.disabled) {
                         showError("请先在设置中添加至少一个视频解析接口才能播放此链接。");
                         return;
                    }
                    // Open player for AI result, needs parsing
                    openPlayer(result.video_link, result.title, 'ai');
                 });
            } else {
                console.warn("Skipping result with invalid structure:", result);
            }
            resultsContainer.appendChild(card);
        });
    };

    // --- YFSP Specific Player Handling ---

    // Step 1: User clicks "Select Episode" -> Fetch episode list
    const openYfspPlayer = async (buttonElement) => {
        const videoId = buttonElement.dataset.id;
        const baseUrl = buttonElement.dataset.baseUrl;
        const title = buttonElement.dataset.title;

        if (!videoId || !baseUrl || !title) {
            showError("卡片数据不完整，无法加载剧集。");
            return;
        }

        console.log(`YFSP: Fetching episodes for id=${videoId}, title=${title}`);
        const originalButtonHtml = buttonElement.innerHTML;
        buttonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 加载列表...`;
        buttonElement.disabled = true;
        clearError();
        // Reset player state before opening
        resetPlayer();

        try {
            const response = await fetch('/api/get_episode_list', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ id: videoId, base_url: baseUrl })
            });
            const data = await response.json();

            if (!response.ok) {
                 throw new Error(data.error || `无法获取剧集列表 (${response.status})`);
            }

            if (!Array.isArray(data) || data.length === 0) {
                throw new Error("未能获取到有效的剧集列表数据。");
            }

            currentEpisodes = data; // Store episode list
            currentYfspBaseUrl = baseUrl; // Store base URL for later use

            // Open the player modal, display episodes, and try loading the first one
            openPlayer(null, title, 'yfsp'); // Pass null link, type 'yfsp'

        } catch (error) {
             console.error("Error fetching/preparing YFSP episodes:", error);
             showError(`加载剧集列表时出错: ${error.message}`);
             resetPlayer(); // Ensure player is closed/reset on error
        } finally {
             // Restore button state on the card
             buttonElement.innerHTML = originalButtonHtml;
             buttonElement.disabled = false;
        }
    };

    // Step 2: Populate episode list in the modal and load a specific episode's M3U8
    const displayAndLoadYfspEpisode = (episodeLink, episodeNumText) => {
        if (!episodeLink) {
             showError("无效的剧集链接。", true);
             showPlayerLoading(false);
             return;
        }

        console.log(`YFSP: Loading episode "${episodeNumText}" with link: ${episodeLink}`);
        videoPlayerIframe.src = 'about:blank'; // Clear previous video
        showPlayerLoading(true); // Show loading indicator for iframe

        fetch('/api/get_episode_details', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Send the RELATIVE link path
            body: JSON.stringify({ episode_link: episodeLink, base_url: currentYfspBaseUrl })
        })
        .then(response => response.json().then(data => ({ ok: response.ok, status: response.status, data })))
        .then(({ ok, status, data }) => {
            if (!ok) {
                throw new Error(data.error || `获取播放链接失败 (${status})`);
            }
            if (data.player_url) {
                console.log("YFSP: Received player URL:", data.player_url);
                videoPlayerIframe.src = data.player_url; // Set iframe source
                // Loading indicator will be hidden by iframe's onload/onerror
            } else {
                throw new Error("未能获取到有效的播放链接");
            }
             // Update active state on buttons
             updateEpisodeButtonActiveState(episodeLink);
        })
        .catch(error => {
            console.error("Error fetching YFSP episode details:", error);
            showError(`加载剧集 ${episodeNumText} 时出错: ${error.message}`, true);
            showPlayerLoading(false); // Hide loading on error
            videoPlayerIframe.src = 'about:blank'; // Clear iframe on error
             updateEpisodeButtonActiveState(null); // Clear active state on error
        });
    };

    // Step 3: Helper to populate the episode list container
    const populateEpisodeList = () => {
        episodeListContainer.innerHTML = ''; // Clear previous content
        if (!currentEpisodes || currentEpisodes.length === 0) {
            episodeListContainer.innerHTML = '<p>未能加载剧集列表。</p>';
            return;
        }

        currentEpisodes.forEach((episode, index) => {
            if (!episode || !episode.num || !episode.link) return; // Skip invalid entries

            const button = document.createElement('button');
            button.classList.add('episode-button');
            button.textContent = escapeHtml(episode.num);
            button.dataset.link = episode.link; // Store the relative link path

            button.addEventListener('click', () => {
                 // Don't reload if already active? Optional.
                 // if (button.classList.contains('active')) return;

                // Get stored link and display text
                const linkToLoad = button.dataset.link;
                const numText = button.textContent;
                displayAndLoadYfspEpisode(linkToLoad, numText);
            });
            episodeListContainer.appendChild(button);

            // Automatically load the first episode when the list is first populated
            if (index === 0) {
                console.log("YFSP: Auto-loading first episode:", episode);
                // Use timeout to ensure the DOM is updated before triggering load
                setTimeout(() => displayAndLoadYfspEpisode(episode.link, episode.num), 0);
            }
        });
    };

    // Step 4: Helper to update the visual active state of episode buttons
    const updateEpisodeButtonActiveState = (activeLink) => {
        const buttons = episodeListContainer.querySelectorAll('.episode-button');
        buttons.forEach(button => {
            if (button.dataset.link === activeLink) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    };


    // --- Generic Player Opening / Closing ---

    // Open the player modal - handles different types (AI, YFSP)
    const openPlayer = (link, title, methodType) => {
        console.log(`Opening player for: ${title}, Method: ${methodType}, Link: ${link}`);
        resetPlayer(); // Reset state before opening
        playerTitle.textContent = title; // Set title

        if (methodType === 'yfsp') {
            // --- YFSP Method ---
            currentVideoLink = ''; // Clear AI parsing link
            parsingSelectorContainer.style.display = 'none'; // Hide AI parsing selector
            episodeListContainer.style.display = 'block'; // Show episode list area
            populateEpisodeList(); // Fill episode list (will also trigger loading first episode)
            // Loading indicator shown by displayAndLoadYfspEpisode

        } else if (methodType === 'ai') {
            // --- AI Method (requires parsing) ---
            currentEpisodes = []; // Clear episodes
            currentYfspBaseUrl = '';
            episodeListContainer.style.display = 'none'; // Hide episode list area

            if (parsingSelect.disabled) {
                showError("请先在设置中添加至少一个视频解析接口。");
                resetPlayer();
                return;
            }
            parsingSelectorContainer.style.display = 'block'; // Show parsing selector
            currentVideoLink = link; // Store the raw video link to be parsed

            const selectedParserUrl = parsingSelect.value;
            if (selectedParserUrl && currentVideoLink) {
                // Construct final URL using selected parser
                const finalUrl = selectedParserUrl.includes('{url}')
                    ? selectedParserUrl.replace('{url}', encodeURIComponent(currentVideoLink))
                    : selectedParserUrl + encodeURIComponent(currentVideoLink);

                console.log("AI: Using parser:", selectedParserUrl, "Final URL:", finalUrl);
                videoPlayerIframe.src = finalUrl;
                showPlayerLoading(true); // Show loading for iframe
            } else {
                showError("无法构建播放链接，请检查解析接口和视频链接。", true);
                showPlayerLoading(false);
                videoPlayerIframe.src = 'about:blank';
                return;
            }
        } else {
             console.error("Unknown method type for openPlayer:", methodType);
             showError("未知的播放类型。", true);
             return; // Don't open modal if type is wrong
        }

        playerModal.style.display = 'block'; // Show the modal
    };


    // Close the player modal and reset state
    const closePlayer = () => {
        playerModal.style.display = 'none';
        resetPlayer();
    };

    // Reset player state completely
    const resetPlayer = () => {
        videoPlayerIframe.src = 'about:blank'; // Stop video/loading
        playerTitle.textContent = '正在播放...';
        showPlayerLoading(false); // Ensure loading indicator is hidden
        episodeListContainer.innerHTML = ''; // Clear episode list
        episodeListContainer.style.display = 'none'; // Hide episode container
        parsingSelectorContainer.style.display = 'none'; // Hide parsing selector
        currentVideoLink = '';
        currentYfspBaseUrl = '';
        currentEpisodes = [];
    };


    // Perform search by calling the backend API
    const performSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) {
            showError("请输入搜索内容");
            return;
        }

        const selectedMethod = document.querySelector('input[name="search-method"]:checked').value;
        currentSearchMethod = selectedMethod;
        localStorage.setItem('videoSearchMethod', currentSearchMethod);

        clearError();
        clearResults();
        showLoading(true, selectedMethod);

        try {
            const requestBody = {
                 query: query,
                 method: selectedMethod,
                 settings: { // Send user's AI settings (backend uses defaults for YFSP parsing)
                     aiApiUrl: currentSettings.aiApiUrl,
                     aiApiKey: currentSettings.aiApiKey,
                     aiModel: currentSettings.aiModel,
                     searxngUrl: currentSettings.searxngUrl
                 }
             };

            console.log("Sending search request to backend:", requestBody);
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify(requestBody),
            });

             const responseData = await response.json();
             console.log("Backend Response Status:", response.status);
             // console.log("Backend Response Data:", responseData); // Can be very large

             // Check for specific error key from backend first
             if (responseData.error) {
                 throw new Error(responseData.error);
             }
             // Then check generic HTTP status
             if (!response.ok) {
                throw new Error(`服务器错误 (代码: ${response.status})`);
             }

             // Backend now returns array directly, or {error: msg, results: []}
             const results = Array.isArray(responseData) ? responseData : responseData.results;
             displayResults(results || []); // Ensure results is always an array

        } catch (error) {
            console.error("Search Error:", error);
            showError(`搜索或分析时出错: ${error.message}`);
            clearResults(); // Clear potentially partial results on error
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
        });
    });

    // Settings Modal Listeners
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

    // Player Modal Listeners
    closePlayerBtn.addEventListener('click', closePlayer);

    // Update iframe src when user changes parsing interface (only for AI method links)
    parsingSelect.addEventListener('change', () => {
        // Only re-parse if the player is open AND it's currently showing the AI parsing selector
        if (playerModal.style.display === 'block' && currentVideoLink && parsingSelectorContainer.style.display === 'block') {
             const selectedParserUrl = parsingSelect.value;
             if (selectedParserUrl) {
                // Construct final URL using selected parser (handle different placeholders)
                const finalUrl = selectedParserUrl.includes('{url}')
                    ? selectedParserUrl.replace('{url}', encodeURIComponent(currentVideoLink))
                    : selectedParserUrl + encodeURIComponent(currentVideoLink);

                  console.log("Parser changed (AI method), new URL:", finalUrl);
                  videoPlayerIframe.src = 'about:blank'; // Clear first
                  showPlayerLoading(true);
                  videoPlayerIframe.src = finalUrl; // Set new source
                  // onload/onerror handlers need to be re-attached or managed carefully
             }
        }
    });

    // Iframe load/error handling (attach once)
    videoPlayerIframe.onload = () => {
         console.log("Iframe loaded:", videoPlayerIframe.src);
         showPlayerLoading(false); // Hide loading indicator on successful load
    };
    videoPlayerIframe.onerror = () => {
         console.error("Iframe failed to load:", videoPlayerIframe.src);
         showPlayerLoading(false); // Hide loading indicator on error
         // Avoid showing generic error if specific episode load error was already shown
         // showError("加载播放器资源时出错。", true);
    };


    // Close modals if clicked outside the content area
    window.addEventListener('click', (event) => {
        if (event.target === settingsModal) {
            settingsModal.style.display = 'none';
        }
         if (event.target === playerModal) {
            closePlayer();
        }
    });

    // --- Initial Load ---
    loadSettings(); // Load settings when the page loads

}); // End DOMContentLoaded
