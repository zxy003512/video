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
    let currentVideoLink = ''; // To store the link for AI method results
    let currentSearchMethod = 'ai'; // Default search method

    // --- Functions ---

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
             errorMessageDiv.style.display = 'none';
        }, 6000); // Longer display time
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
            if (!response.ok) throw new Error('无法加载默认配置');
            defaultSettings = await response.json();
        } catch (error) {
            console.error("Error fetching default config:", error);
            showError("无法从服务器加载默认配置，将使用内置后备设置。");
            defaultSettings = { // Hardcoded fallbacks
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
            console.log("Loaded settings from localStorage:", currentSettings);
        } else {
            currentSettings = {
                aiApiUrl: '', aiApiKey: '', aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: defaultSettings.defaultParsingInterfaces
            };
            console.log("Using default settings:", currentSettings);
        }

        // Load saved search method or default to 'ai'
        currentSearchMethod = localStorage.getItem('videoSearchMethod') || 'ai';
        document.querySelector(`input[name="search-method"][value="${currentSearchMethod}"]`).checked = true;


        populateSettingsForm();
        renderParsingInterfacesList();
        updateParsingSelect();
    };

    // Save settings to localStorage
    const saveSettings = () => {
        const newUrl = newInterfaceUrlInput.value.trim();
         if (newUrl && !newUrl.includes('?url=')) { // Basic validation for new interface URL
             showError("新解析接口URL格式似乎不正确，应包含 '?url='");
             return;
         }
         if (newUrl && !newUrl.endsWith('=')) {
             showError("新解析接口URL应以 '=' 结尾");
             return;
         }

        currentSettings = {
            aiApiUrl: aiApiUrlInput.value.trim(),
            aiApiKey: aiApiKeyInput.value.trim(),
            aiModel: aiModelInput.value.trim(),
            searxngUrl: searxngUrlInput.value.trim() || defaultSettings.defaultSearxngUrl,
            parsingInterfaces: currentSettings.parsingInterfaces || [] // Ensure it exists
        };
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
        localStorage.setItem('videoSearchMethod', currentSearchMethod); // Save search method too
        console.log("Settings saved:", currentSettings);
        alert("设置已保存！");
        settingsModal.style.display = 'none';
        updateParsingSelect();
    };

     // Reset settings to defaults fetched from backend
    const resetToDefaults = () => {
         if (confirm("确定要恢复所有设置为默认值吗？这将清除您自定义的API密钥和接口。")) {
             currentSettings = {
                aiApiUrl: '', aiApiKey: '', aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces))
             };
             localStorage.removeItem('videoSearchPlayerSettings');
             currentSearchMethod = 'ai'; // Reset search method to default
             localStorage.setItem('videoSearchMethod', currentSearchMethod);
             document.querySelector(`input[name="search-method"][value="ai"]`).checked = true;

             populateSettingsForm();
             renderParsingInterfacesList();
             updateParsingSelect();
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
                <span>${iface.name} (${iface.url})</span>
                <button data-index="${index}" class="remove-interface-btn" aria-label="删除接口">&times;</button>
            `;
            interfacesListDiv.appendChild(itemDiv);
        });

        document.querySelectorAll('.remove-interface-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const indexToRemove = parseInt(e.target.getAttribute('data-index'));
                removeParsingInterface(indexToRemove);
            });
        });
    };

    // Add a new parsing interface
    const addParsingInterface = () => {
        const name = newInterfaceNameInput.value.trim();
        const url = newInterfaceUrlInput.value.trim();

        if (!name || !url) { showError("接口名称和URL不能为空"); return; }
        if (!url.includes('?url=')) { showError("URL 格式似乎不正确，应包含 '?url='"); return; }
        if (!url.endsWith('=')) { showError("URL 必须以 '=' 结尾"); return; }

        if (!currentSettings.parsingInterfaces) { currentSettings.parsingInterfaces = []; }
        currentSettings.parsingInterfaces.push({ name, url });
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings)); // Persist change
        renderParsingInterfacesList();
        updateParsingSelect();
        newInterfaceNameInput.value = ''; newInterfaceUrlInput.value = '';
    };

    // Remove a parsing interface
    const removeParsingInterface = (index) => {
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces[index]) {
            currentSettings.parsingInterfaces.splice(index, 1);
            localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings)); // Persist change
            renderParsingInterfacesList();
            updateParsingSelect();
        }
    };

     // Update the <select> dropdown in the player modal
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
            parsingSelectorContainer.style.display = ''; // Show selector
        } else {
            const option = document.createElement('option');
            option.textContent = '没有可用的解析接口';
            parsingSelect.appendChild(option);
            parsingSelect.disabled = true;
            // Keep selector visible but disabled if no interfaces configured
             parsingSelectorContainer.style.display = '';
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

            if (result.method === 'yfsp') {
                // --- YFSP Card ---
                card.classList.add('yfsp-card'); // Add specific class
                card.dataset.id = result.id;
                card.dataset.baseUrl = result.base_url;
                card.dataset.method = 'yfsp'; // Explicitly set method
                card.innerHTML = `
                    <div class="yfsp-cover">
                        <img src="${result.cover}" alt="${result.title} Cover" loading="lazy" onerror="this.style.display='none'">
                    </div>
                    <div class="yfsp-info">
                         <h3>${result.title}</h3>
                         <button class="play-episode-btn" data-episode="1"><i class="fas fa-play"></i> 播放第一集</button>
                    </div>
                `;
                // Add event listener specifically for the play button on this card
                card.querySelector('.play-episode-btn').addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent card click event
                    const btn = e.currentTarget;
                    const episodeNum = btn.dataset.episode;
                    playYfspEpisode(result.id, result.base_url, result.title, episodeNum, btn);
                });
            } else {
                // --- AI Card (Original) ---
                 card.classList.add('ai-card');
                 card.dataset.link = result.video_link;
                 card.dataset.method = 'ai'; // Explicitly set method
                 card.innerHTML = `
                    <h3>${result.title}</h3>
                    <p><span class="website-badge">${result.website || '未知来源'}</span></p>
                    <p class="link-preview" title="${result.video_link}">${result.video_link.substring(0, 60)}${result.video_link.length > 60 ? '...' : ''}</p>
                    <span class="play-hint"><i class="fas fa-play-circle"></i> 点击播放 (使用解析接口)</span>
                 `;
                 // Add event listener for the whole card to open AI player
                 card.addEventListener('click', () => {
                    if (parsingSelect.disabled) {
                         showError("请先在设置中添加至少一个视频解析接口才能播放此链接。");
                         return;
                    }
                    openPlayer(result.video_link, result.title, false); // false indicates not a direct URL
                 });
            }
            resultsContainer.appendChild(card);
        });
    };

    // Function to handle playing YFSP episode
    const playYfspEpisode = async (id, baseUrl, title, episodeNum, buttonElement) => {
        console.log(`Attempting to play YFSP: id=${id}, ep=${episodeNum}, title=${title}`);
        const originalButtonText = buttonElement.innerHTML;
        buttonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 加载中...`;
        buttonElement.disabled = true;
        clearError();

        try {
            const response = await fetch('/api/get_episode_details', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ id: id, episode: episodeNum, base_url: baseUrl })
            });

            const data = await response.json();

            if (!response.ok) {
                 throw new Error(data.error || `无法获取剧集 ${episodeNum} 的播放信息`);
            }

            if (data.player_url) {
                 openPlayer(data.player_url, `${title} - 第 ${episodeNum} 集`, true); // true indicates direct URL
            } else {
                throw new Error(`未能从服务器获取到有效的播放链接`);
            }

        } catch (error) {
             console.error("Error fetching/playing YFSP episode:", error);
             showError(`播放剧集 ${episodeNum} 时出错: ${error.message}`);
        } finally {
             // Restore button state
             buttonElement.innerHTML = originalButtonText;
             buttonElement.disabled = false;
        }
    };


    // Open the player modal - Handles both direct URLs and links needing parsing
    const openPlayer = (urlOrLink, title, isDirectUrl = false) => {
        playerTitle.textContent = title; // Set title regardless of type

        // Reset player state
        videoPlayerIframe.src = 'about:blank'; // Clear previous content immediately
        showPlayerLoading(true); // Show loading indicator inside player

        if (isDirectUrl) {
            // --- Direct URL (from YFSP) ---
            console.log("Opening player with direct URL:", urlOrLink);
            currentVideoLink = ''; // Clear parsing link state
            parsingSelectorContainer.style.display = 'none'; // Hide parsing selector
            videoPlayerIframe.src = urlOrLink; // Set iframe src directly
            // Hide player loading when iframe starts loading (may still take time for video)
            videoPlayerIframe.onload = () => showPlayerLoading(false);
            videoPlayerIframe.onerror = () => {
                 showPlayerLoading(false);
                 showError("加载播放器资源时出错。");
            };
        } else {
            // --- Link requires parsing (from AI method) ---
            console.log("Opening player, needs parsing:", urlOrLink);
            if (parsingSelect.disabled) {
                 showPlayerLoading(false); // Hide loading as we can't proceed
                 showError("请先在设置中添加至少一个视频解析接口。");
                 return; // Exit if no parsers available
            }
            currentVideoLink = urlOrLink; // Store the raw video link
            parsingSelectorContainer.style.display = ''; // Ensure parsing selector is visible
            const selectedParserUrl = parsingSelect.value;
            if (selectedParserUrl && currentVideoLink) {
                 const finalUrl = selectedParserUrl + encodeURIComponent(currentVideoLink);
                 console.log("Using parser:", selectedParserUrl, "Final URL:", finalUrl);
                 videoPlayerIframe.src = finalUrl;
                 videoPlayerIframe.onload = () => showPlayerLoading(false);
                 videoPlayerIframe.onerror = () => {
                      showPlayerLoading(false);
                      showError("加载解析接口或视频时出错。");
                 };
            } else {
                 showPlayerLoading(false);
                 videoPlayerIframe.src = 'about:blank';
                 showError("无法构建播放链接，请检查解析接口和视频链接。");
                 return; // Exit if link construction fails
            }
        }
        playerModal.style.display = 'block';
    };


    // Close the player modal
    const closePlayer = () => {
        playerModal.style.display = 'none';
        videoPlayerIframe.src = 'about:blank'; // Stop video playback and clear iframe
        playerTitle.textContent = '正在播放...';
        currentVideoLink = '';
        showPlayerLoading(false); // Ensure player loading is hidden
    };

    // Perform search by calling the backend API
    const performSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) {
            showError("请输入搜索内容");
            return;
        }

        // Get selected search method
        const selectedMethod = document.querySelector('input[name="search-method"]:checked').value;
        currentSearchMethod = selectedMethod; // Update state
        localStorage.setItem('videoSearchMethod', currentSearchMethod); // Save preference


        clearError();
        clearResults();
        showLoading(true, selectedMethod); // Pass method to loading text

        try {
            const requestBody = {
                 query: query,
                 method: selectedMethod, // Send selected method to backend
                 settings: { // Send AI settings regardless, backend decides if needed
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

             console.log("Backend Response Status:", response.status);
             const responseData = await response.json();
             console.log("Backend Response Data:", responseData);


            if (!response.ok) {
                 const errorMsg = responseData.error || `服务器错误 (代码: ${response.status})`;
                throw new Error(errorMsg);
            }

            // displayResults expects results to have a 'method' property
            // Backend now adds this property before sending
            displayResults(responseData);

        } catch (error) {
            console.error("Search Error:", error);
            showError(`搜索或分析时出错: ${error.message}`);
            clearResults();
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

    // Update search method state when radio button changes
    searchMethodRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentSearchMethod = e.target.value;
            localStorage.setItem('videoSearchMethod', currentSearchMethod); // Save preference immediately
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
     // Update iframe src when user changes parsing interface (only applicable for AI method results)
    parsingSelect.addEventListener('change', () => {
        // Only re-parse if the player is open AND it's currently using a parsing link (not a direct URL)
        if (playerModal.style.display === 'block' && currentVideoLink && parsingSelectorContainer.style.display !== 'none') {
             const selectedParserUrl = parsingSelect.value;
             if (selectedParserUrl) {
                  const finalUrl = selectedParserUrl + encodeURIComponent(currentVideoLink);
                  console.log("Parser changed, new URL:", finalUrl);
                  videoPlayerIframe.src = 'about:blank'; // Clear first
                  showPlayerLoading(true);
                  videoPlayerIframe.src = finalUrl; // Set new source
                  // onload/onerror handlers should still be active from openPlayer call
             }
        }
    });


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
