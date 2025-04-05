// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('search-btn');
    const resultsContainer = document.getElementById('results-container');
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

    // Player Modal
    const playerModal = document.getElementById('player-modal');
    const closePlayerBtn = playerModal.querySelector('.close-player-btn');
    const playerTitle = document.getElementById('player-title');
    const parsingSelect = document.getElementById('parsing-select');
    const videoPlayerIframe = document.getElementById('video-player');

    // --- State & Configuration ---
    let currentSettings = {};
    let defaultSettings = { // Will be populated by /api/config
        defaultParsingInterfaces: [],
        defaultSearxngUrl: ''
    };
    let currentVideoLink = ''; // To store the link when opening player

    // --- Functions ---

    const showLoading = (show) => {
        loadingIndicator.style.display = show ? 'block' : 'none';
        searchBtn.disabled = show;
    };

    const showError = (message) => {
        errorMessageDiv.textContent = message;
        errorMessageDiv.style.display = 'block';
        // Hide after some time
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
    };

    // Load settings from localStorage or fetch defaults
    const loadSettings = async () => {
        try {
            // Fetch default config (only non-sensitive defaults) from backend
            const response = await fetch('/api/config');
            if (!response.ok) throw new Error('无法加载默认配置');
            defaultSettings = await response.json();
        } catch (error) {
            console.error("Error fetching default config:", error);
            showError("无法从服务器加载默认配置，将使用内置后备设置。");
            // Use hardcoded fallbacks if /api/config fails
             defaultSettings = {
                defaultParsingInterfaces: [
                    {"name": "接口1 - xmflv.com", "url": "https://jx.xmflv.com/?url="},
                    {"name": "接口2 - bd.jx.cn", "url": "https://bd.jx.cn/?url="},
                    {"name": "接口3 - xmflv.cc", "url": "https://jx.xmflv.cc/?url="},
                    {"name": "接口4 - hls.one", "url": "https://jx.hls.one/?url="},
                    {"name": "接口5 - 77flv.cc", "url": "https://jx.77flv.cc/?url="},
                    {"name": "接口6 - yemu.xyz", "url": "https://www.yemu.xyz/?url="}
                ],
                defaultSearxngUrl: "https://searxng.zetatechs.online/search"
             };
        }

        const savedSettings = localStorage.getItem('videoSearchPlayerSettings');
        if (savedSettings) {
            currentSettings = JSON.parse(savedSettings);
            console.log("Loaded settings from localStorage:", currentSettings);
        } else {
            // Use defaults fetched from backend or hardcoded fallbacks
            currentSettings = {
                aiApiUrl: '', // User must provide or backend uses its default
                aiApiKey: '',
                aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: defaultSettings.defaultParsingInterfaces
            };
            console.log("Using default settings:", currentSettings);
        }
        populateSettingsForm();
        renderParsingInterfacesList();
        updateParsingSelect(); // Update player dropdown initially
    };

    // Save settings to localStorage
    const saveSettings = () => {
        // Basic validation
        const newUrl = newInterfaceUrlInput.value.trim();
         if (newUrl && !newUrl.endsWith('=')) {
             showError("新解析接口URL应以 '=' 结尾");
             return; // Don't save if invalid
         }

        currentSettings = {
            aiApiUrl: aiApiUrlInput.value.trim(),
            aiApiKey: aiApiKeyInput.value.trim(), // Store user's key if they enter one
            aiModel: aiModelInput.value.trim(),
            searxngUrl: searxngUrlInput.value.trim() || defaultSettings.defaultSearxngUrl, // Fallback to default if empty
            // parsingInterfaces are managed separately by add/remove functions
        };
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
        console.log("Settings saved:", currentSettings);
        alert("设置已保存！"); // Simple feedback
        settingsModal.style.display = 'none';
        updateParsingSelect(); // Update player dropdown after save
    };

     // Reset settings to defaults fetched from backend
    const resetToDefaults = () => {
         if (confirm("确定要恢复所有设置为默认值吗？这将清除您自定义的API密钥和接口。")) {
             currentSettings = {
                aiApiUrl: '', // Clear user overrides
                aiApiKey: '',
                aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces)) // Deep copy defaults
             };
             localStorage.removeItem('videoSearchPlayerSettings'); // Clear local storage
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
        interfacesListDiv.innerHTML = ''; // Clear existing list
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

        // Add event listeners to remove buttons
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

        if (!name || !url) {
            showError("接口名称和URL不能为空");
            return;
        }
        if (!url.includes('?url=')) { // Basic check
            showError("URL 格式似乎不正确，应包含 '?url='");
            return;
        }
         if (!url.endsWith('=')) {
             showError("URL 必须以 '=' 结尾");
             return;
         }


        if (!currentSettings.parsingInterfaces) {
            currentSettings.parsingInterfaces = [];
        }
        currentSettings.parsingInterfaces.push({ name, url });

        // Persist immediately after adding
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));

        renderParsingInterfacesList(); // Re-render the list in settings
        updateParsingSelect(); // Update player dropdown
        newInterfaceNameInput.value = ''; // Clear form
        newInterfaceUrlInput.value = '';
    };

    // Remove a parsing interface
    const removeParsingInterface = (index) => {
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces[index]) {
            currentSettings.parsingInterfaces.splice(index, 1);

             // Persist immediately after removing
            localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));

            renderParsingInterfacesList(); // Re-render the list in settings
            updateParsingSelect(); // Update player dropdown
        }
    };

     // Update the <select> dropdown in the player modal
    const updateParsingSelect = () => {
        parsingSelect.innerHTML = ''; // Clear existing options
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces.length > 0) {
            currentSettings.parsingInterfaces.forEach((iface, index) => {
                const option = document.createElement('option');
                option.value = iface.url;
                option.textContent = iface.name;
                parsingSelect.appendChild(option);
            });
            parsingSelect.disabled = false;
        } else {
            const option = document.createElement('option');
            option.textContent = '没有可用的解析接口';
            parsingSelect.appendChild(option);
            parsingSelect.disabled = true;
        }
    };


    // Display search results as cards
    const displayResults = (results) => {
        clearResults();
        if (!results || results.length === 0) {
            resultsContainer.innerHTML = '<p style="text-align: center;">未能找到相关影视播放链接。</p>';
            return;
        }

        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('result-card');
            card.dataset.link = result.video_link; // Store link in data attribute
            card.dataset.title = result.title; // Store title

            card.innerHTML = `
                <h3>${result.title}</h3>
                <p><span class="website-badge">${result.website || '未知来源'}</span></p>
                <!-- <p class="description">${result.description || '暂无描述'}</p> -->
                 <p class="link-preview">${result.video_link.substring(0, 60)}${result.video_link.length > 60 ? '...' : ''}</p>

            `;
            card.addEventListener('click', () => {
                openPlayer(result.video_link, result.title);
            });
            resultsContainer.appendChild(card);
        });
    };

    // Open the player modal
    const openPlayer = (videoLink, title) => {
        if (parsingSelect.disabled) {
             showError("请先在设置中添加至少一个视频解析接口。");
             return;
        }
        currentVideoLink = videoLink; // Store the raw video link
        playerTitle.textContent = `正在播放: ${title}`;

        // Set iframe src based on currently selected parsing interface
        const selectedParserUrl = parsingSelect.value;
        if (selectedParserUrl && currentVideoLink) {
             videoPlayerIframe.src = selectedParserUrl + encodeURIComponent(currentVideoLink);
        } else {
             videoPlayerIframe.src = ''; // Clear src if no parser/link
             showError("无法构建播放链接，请检查解析接口和视频链接。")
        }

        playerModal.style.display = 'block';
    };

    // Close the player modal
    const closePlayer = () => {
        playerModal.style.display = 'none';
        videoPlayerIframe.src = ''; // Stop video playback
        playerTitle.textContent = '正在播放...';
        currentVideoLink = '';
    };

    // Perform search by calling the backend API
    const performSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) {
            showError("请输入搜索内容");
            return;
        }

        clearError();
        clearResults();
        showLoading(true);

        try {
            // Send current user settings along with the query
            // Backend will use these or fall back to its environment defaults
            const requestBody = {
                 query: query,
                 settings: {
                     aiApiUrl: currentSettings.aiApiUrl,
                     aiApiKey: currentSettings.aiApiKey, // Send user's key if they entered one
                     aiModel: currentSettings.aiModel,
                     searxngUrl: currentSettings.searxngUrl
                 }
             };

            console.log("Sending search request to backend:", requestBody);


            const response = await fetch('/api/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

             console.log("Backend Response Status:", response.status);
             const responseData = await response.json();
             console.log("Backend Response Data:", responseData);


            if (!response.ok) {
                // Try to get error message from backend response
                 const errorMsg = responseData.error || `服务器错误 (代码: ${response.status})`;
                throw new Error(errorMsg);
            }

            displayResults(responseData); // responseData should be the list of results

        } catch (error) {
            console.error("Search Error:", error);
            showError(`搜索或分析时出错: ${error.message}`);
            clearResults(); // Clear any partial results
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

    // Settings Modal Listeners
    settingsBtn.addEventListener('click', () => {
        populateSettingsForm(); // Ensure form shows current values
        renderParsingInterfacesList(); // Render current interfaces
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
     // Update iframe src when user changes parsing interface while player is open
    parsingSelect.addEventListener('change', () => {
        if (playerModal.style.display === 'block' && currentVideoLink) {
             const selectedParserUrl = parsingSelect.value;
             if (selectedParserUrl) {
                  videoPlayerIframe.src = selectedParserUrl + encodeURIComponent(currentVideoLink);
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
