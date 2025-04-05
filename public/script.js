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
        // Automatically hide after a delay
        setTimeout(() => {
             // Check if the message is still the same before hiding
             if (errorMessageDiv.textContent === message) {
                 errorMessageDiv.style.display = 'none';
             }
        }, 7000); // Longer display time
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
            console.log("Fetched default settings:", defaultSettings);
        } catch (error) {
            console.error("Error fetching default config:", error);
            showError("无法从服务器加载默认配置，将使用内置后备设置。");
            // Hardcoded fallbacks ONLY if fetch fails catastrophically
            defaultSettings = {
                defaultParsingInterfaces: [
                    {"name": "接口1 - xmflv.com", "url": "https://jx.xmflv.com/?url="},
                    {"name": "接口2 - bd.jx.cn", "url": "https://bd.jx.cn/?url="},
                    {"name": "接口3 - xmflv.cc", "url": "https://jx.xmflv.cc/?url="},
                    {"name": "接口4 - hls.one", "url": "https://jx.hls.one/?url="},
                    {"name": "接口5 - 77flv.cc", "url": "https://jx.77flv.cc/?url="},
                    {"name": "接口6 - yemu.xyz", "url": "https://www.yemu.xyz/?url="}
                ],
                defaultSearxngUrl: "https://searxng.zetatechs.online/search" // Example fallback
             };
        }

        const savedSettings = localStorage.getItem('videoSearchPlayerSettings');
        if (savedSettings) {
            try {
                currentSettings = JSON.parse(savedSettings);
                // Ensure essential keys exist, merge with defaults if necessary
                currentSettings.parsingInterfaces = currentSettings.parsingInterfaces || defaultSettings.defaultParsingInterfaces || [];
                currentSettings.searxngUrl = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl || '';
                console.log("Loaded settings from localStorage:", currentSettings);
            } catch (e) {
                 console.error("Error parsing saved settings, resetting to default:", e);
                 localStorage.removeItem('videoSearchPlayerSettings'); // Clear corrupted data
                 currentSettings = {
                     aiApiUrl: '', aiApiKey: '', aiModel: '',
                     searxngUrl: defaultSettings.defaultSearxngUrl,
                     parsingInterfaces: defaultSettings.defaultParsingInterfaces
                 };
            }
        } else {
            // No saved settings, use defaults
            currentSettings = {
                aiApiUrl: '', aiApiKey: '', aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: defaultSettings.defaultParsingInterfaces || [] // Ensure it's an array
            };
            console.log("Using default settings:", currentSettings);
        }

        // Load saved search method or default to 'ai'
        currentSearchMethod = localStorage.getItem('videoSearchMethod') || 'ai';
        try {
            const radioToCheck = document.querySelector(`input[name="search-method"][value="${currentSearchMethod}"]`);
            if (radioToCheck) {
                 radioToCheck.checked = true;
            } else {
                // If saved value is invalid, default to 'ai'
                document.querySelector(`input[name="search-method"][value="ai"]`).checked = true;
                currentSearchMethod = 'ai';
                localStorage.setItem('videoSearchMethod', currentSearchMethod);
            }
        } catch (e) {
             console.error("Error setting search method radio:", e);
             // Default to 'ai' if querySelector fails
             document.querySelector(`input[name="search-method"][value="ai"]`).checked = true;
             currentSearchMethod = 'ai';
        }

        populateSettingsForm();
        renderParsingInterfacesList();
        updateParsingSelect(); // Update player dropdown
    };

    // Save settings to localStorage
    const saveSettings = () => {
         // Validation for new interface (optional but good)
         const newName = newInterfaceNameInput.value.trim();
         const newUrl = newInterfaceUrlInput.value.trim();
         if (newName || newUrl) { // Only validate if user tried to add one
             if (!newName || !newUrl) {
                 showError("如果要添加新接口，名称和 URL 都不能为空。");
                 return;
             }
             if (!newUrl.includes('?url=')) {
                 showError("新解析接口 URL 格式似乎不正确，应包含 '?url='");
                 return;
             }
              if (!newUrl.endsWith('=')) {
                 // Many interfaces don't end with '=', allow flexibility?
                 // showError("新解析接口 URL 最好以 '=' 结尾");
                 // return;
             }
             // If validation passed or user didn't try to add, proceed with saving
             if (newName && newUrl) {
                 addParsingInterface(newName, newUrl, false); // Add but don't clear fields yet
                 newInterfaceNameInput.value = ''; // Clear fields after potential successful add
                 newInterfaceUrlInput.value = '';
             }
         }


        currentSettings = {
            aiApiUrl: aiApiUrlInput.value.trim(),
            aiApiKey: aiApiKeyInput.value.trim(),
            aiModel: aiModelInput.value.trim(),
            searxngUrl: searxngUrlInput.value.trim() || defaultSettings.defaultSearxngUrl, // Fallback to default if empty
            parsingInterfaces: currentSettings.parsingInterfaces || [] // Ensure it exists
        };
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
        localStorage.setItem('videoSearchMethod', currentSearchMethod); // Save search method too
        console.log("Settings saved:", currentSettings);
        alert("设置已保存！");
        settingsModal.style.display = 'none';
        updateParsingSelect(); // Update dropdown in player
    };

     // Reset settings to defaults fetched from backend
    const resetToDefaults = () => {
         if (confirm("确定要恢复所有设置为默认值吗？这将清除您自定义的AI密钥、模型、搜索引擎地址和解析接口。")) {
             // Use deep copy for arrays/objects from defaults
             currentSettings = {
                aiApiUrl: '', aiApiKey: '', aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces || [])) // Deep copy default interfaces
             };
             localStorage.removeItem('videoSearchPlayerSettings'); // Remove saved settings

             currentSearchMethod = 'ai'; // Reset search method to default
             localStorage.setItem('videoSearchMethod', currentSearchMethod);
             document.querySelector(`input[name="search-method"][value="ai"]`).checked = true;

             populateSettingsForm(); // Update form fields
             renderParsingInterfacesList(); // Update interface list display
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
        searxngUrlInput.value = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl; // Use default as placeholder too
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
            // Make sure name and URL are displayed safely
            const nameSpan = document.createElement('span');
            nameSpan.textContent = `${iface.name} (${iface.url})`;
            nameSpan.title = `${iface.name} (${iface.url})`; // Tooltip for long URLs

            const removeButton = document.createElement('button');
            removeButton.dataset.index = index;
            removeButton.classList.add('remove-interface-btn');
            removeButton.setAttribute('aria-label', `删除接口 ${iface.name}`);
            removeButton.innerHTML = '&times;'; // Use HTML entity for 'x'

            itemDiv.appendChild(nameSpan);
            itemDiv.appendChild(removeButton);
            interfacesListDiv.appendChild(itemDiv);
        });

        // Add event listeners AFTER creating all buttons
        document.querySelectorAll('.remove-interface-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const indexToRemove = parseInt(e.target.getAttribute('data-index'));
                removeParsingInterface(indexToRemove);
            });
        });
    };

    // Add a new parsing interface (modified to be called by save/add buttons)
    const addParsingInterface = (name, url, updateUI = true) => {
        if (!name || !url) {
            showError("接口名称和URL不能为空");
            return false; // Indicate failure
        }
        // Basic validation (already done in saveSettings, but good to have here too)
        if (!url.includes('?url=')) {
             // Relaxing this based on previous thought: some might not have it
             // showError("URL 格式似乎不正确，应包含 '?url='"); return false;
             console.warn(`Adding interface URL without '?url=': ${url}`);
        }

        if (!currentSettings.parsingInterfaces) { currentSettings.parsingInterfaces = []; } // Initialize if needed

        // Check for duplicates (optional)
        const exists = currentSettings.parsingInterfaces.some(iface => iface.url === url);
        if (exists) {
             showError(`接口 URL "${url}" 已存在。`);
             return false;
        }

        currentSettings.parsingInterfaces.push({ name, url });

        if (updateUI) {
             // Don't save to localStorage here, let saveSettings handle final save
             renderParsingInterfacesList();
             updateParsingSelect();
             // Clear input fields only if called directly from add button
             newInterfaceNameInput.value = '';
             newInterfaceUrlInput.value = '';
        }
        return true; // Indicate success
    };

    // Remove a parsing interface
    const removeParsingInterface = (index) => {
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces[index]) {
            const removedInterface = currentSettings.parsingInterfaces.splice(index, 1);
            console.log("Removed interface:", removedInterface[0]);
            // Don't save to localStorage immediately, let saveSettings handle it
            renderParsingInterfacesList(); // Update the list display
            updateParsingSelect(); // Update the player dropdown
        }
    };

     // Update the <select> dropdown in the player modal
    const updateParsingSelect = () => {
        parsingSelect.innerHTML = ''; // Clear existing options
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces.length > 0) {
            currentSettings.parsingInterfaces.forEach((iface) => {
                const option = document.createElement('option');
                option.value = iface.url;
                option.textContent = iface.name;
                option.title = iface.url; // Show URL on hover
                parsingSelect.appendChild(option);
            });
            parsingSelect.disabled = false;
             // Container visibility is handled by openPlayer based on context
             // parsingSelectorContainer.style.display = ''; // Don't force show here
        } else {
            const option = document.createElement('option');
            option.textContent = '没有可用的解析接口';
            option.disabled = true; // Make the placeholder unselectable
            parsingSelect.appendChild(option);
            parsingSelect.disabled = true;
            // Container visibility handled by openPlayer
             // parsingSelectorContainer.style.display = ''; // Don't force show here
        }
    };

    // --- Display Search Results (Handles AI and YFSP) ---
    const displayResults = (results) => {
        clearResults(); // Clear previous results
        if (!results || results.length === 0) {
            resultsContainer.innerHTML = `<p style="text-align: center;">未能找到相关资源。请尝试更换关键词或搜索方式。</p>`;
            return;
        }

        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('result-card');
            card.dataset.title = result.title; // Store title for player/logging

            if (result.method === 'yfsp' && result.id && result.base_url) {
                // --- YFSP Card ---
                card.classList.add('yfsp-card'); // Add specific class
                card.dataset.id = result.id;
                card.dataset.baseUrl = result.base_url;
                card.dataset.method = 'yfsp'; // Store method

                const coverDiv = document.createElement('div');
                coverDiv.classList.add('yfsp-cover');
                const img = document.createElement('img');
                img.src = result.cover || ''; // Handle potentially missing cover
                img.alt = `${result.title} Cover`;
                img.loading = 'lazy';
                img.onerror = () => { // Handle image loading errors
                    img.style.display = 'none'; // Hide broken image
                    coverDiv.style.backgroundColor = '#eee'; // Show placeholder bg
                    // Optionally add text placeholder
                    const placeholder = document.createElement('span');
                    placeholder.textContent = '封面加载失败';
                    placeholder.style.cssText = 'display:flex; align-items:center; justify-content:center; height:100%; color:#aaa; font-size:0.9em;';
                    coverDiv.appendChild(placeholder);
                 };
                coverDiv.appendChild(img);

                const infoDiv = document.createElement('div');
                infoDiv.classList.add('yfsp-info');
                const titleH3 = document.createElement('h3');
                titleH3.textContent = result.title;
                titleH3.title = result.title; // Tooltip for long titles

                // Container for buttons/episode list
                const actionContainer = document.createElement('div');
                actionContainer.classList.add('yfsp-action-container'); // Add class for styling

                const selectEpisodeBtn = document.createElement('button');
                selectEpisodeBtn.classList.add('select-episode-btn'); // New class for the button
                selectEpisodeBtn.innerHTML = '<i class="fas fa-list-ul"></i> 选择剧集';
                selectEpisodeBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent card click if needed
                    showEpisodeList(result.id, result.base_url, result.title, card, selectEpisodeBtn);
                });

                actionContainer.appendChild(selectEpisodeBtn);
                infoDiv.appendChild(titleH3);
                infoDiv.appendChild(actionContainer); // Add button container to info div
                card.appendChild(coverDiv);
                card.appendChild(infoDiv);

            } else if (result.method === 'ai' && result.video_link) {
                // --- AI Card (Original - requires parsing) ---
                 card.classList.add('ai-card');
                 card.dataset.link = result.video_link;
                 card.dataset.method = 'ai'; // Store method
                 card.innerHTML = `
                    <h3>${result.title}</h3>
                    <p><span class="website-badge" title="来源: ${result.website || '未知'}">${result.website || '未知来源'}</span></p>
                    <p class="link-preview" title="${result.video_link}">${result.video_link.substring(0, 60)}${result.video_link.length > 60 ? '...' : ''}</p>
                    <span class="play-hint"><i class="fas fa-play-circle"></i> 点击播放 (使用解析接口)</span>
                 `;
                 // Add event listener for the whole card to open AI player
                 card.addEventListener('click', () => {
                    if (parsingSelect.disabled) {
                         showError("请先在设置中添加至少一个视频解析接口才能播放此链接。");
                         return;
                    }
                    openPlayer(result.video_link, result.title, false); // false indicates not a direct URL, needs parsing
                 });
            } else {
                 console.warn("Skipping result with unexpected structure:", result);
                 return; // Skip rendering this card
            }
            resultsContainer.appendChild(card);
        });
    };

    // --- NEW: Function to Fetch and Display YFSP Episode List ---
    const showEpisodeList = async (id, baseUrl, title, cardElement, buttonElement) => {
         console.log(`Fetching episode list for YFSP: id=${id}, title=${title}`);
         const actionContainer = cardElement.querySelector('.yfsp-action-container');
         if (!actionContainer) return; // Should not happen

         // Show loading state on the button
         const originalButtonHTML = buttonElement.innerHTML;
         buttonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 加载剧集...`;
         buttonElement.disabled = true;
         clearError(); // Clear previous errors

         try {
             const response = await fetch('/api/get_yfsp_episode_list', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ id: id, base_url: baseUrl })
             });

             const episodes = await response.json();

             if (!response.ok) {
                 // Try to get error message from JSON response, else use status text
                 const errorMsg = episodes.error || `服务器错误 (${response.status})`;
                 throw new Error(errorMsg);
             }

             // Clear the action container (remove the 'Select Episode' button)
             actionContainer.innerHTML = '';

             if (!episodes || episodes.length === 0) {
                 actionContainer.innerHTML = '<p class="no-episodes-msg">未能获取到剧集列表。</p>';
                 return;
             }

             // Create the episode list container
             const episodeListDiv = document.createElement('div');
             episodeListDiv.classList.add('episode-list'); // Add class for styling

             episodes.forEach(ep => {
                 const episodeButton = document.createElement('button');
                 episodeButton.classList.add('episode-button');
                 episodeButton.textContent = ep.episode; // Display episode number/name
                 episodeButton.title = `播放 ${title} - ${ep.episode}`; // Tooltip
                 // Store necessary data on the button itself
                 episodeButton.dataset.episodeNum = ep.episode; // Store the episode identifier AI returned

                 episodeButton.addEventListener('click', (e) => {
                      e.stopPropagation();
                      // Pass the actual episode number/identifier to the play function
                      playYfspEpisode(id, baseUrl, title, ep.episode, episodeButton);
                 });
                 episodeListDiv.appendChild(episodeButton);
             });

             // Append the list to the action container
             actionContainer.appendChild(episodeListDiv);

         } catch (error) {
             console.error("Error fetching/displaying YFSP episode list:", error);
             showError(`获取剧集列表时出错: ${error.message}`);
             // Restore the original button if list fetching failed
             buttonElement.innerHTML = originalButtonHTML;
             buttonElement.disabled = false;
             // Optionally add the button back to the container if it was removed
             if (!actionContainer.contains(buttonElement)) {
                 actionContainer.innerHTML = ''; // Clear potential error messages
                 actionContainer.appendChild(buttonElement);
             }
         }
         // No finally block needed for button state, handled in catch or on success
    };


    // --- MODIFIED: Function to handle playing a SPECIFIC YFSP episode ---
    const playYfspEpisode = async (id, baseUrl, title, episodeNum, clickedButtonElement) => {
        // episodeNum is now the specific episode identifier (e.g., "01", "52")
        console.log(`Attempting to play YFSP: id=${id}, ep=${episodeNum}, title=${title}`);

        // Show loading state ON THE CLICKED EPISODE BUTTON
        const originalButtonText = clickedButtonElement.textContent; // Store text content
        clickedButtonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`; // Show spinner
        clickedButtonElement.disabled = true;
        clearError(); // Clear previous errors

        try {
            const response = await fetch('/api/get_episode_details', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ id: id, episode: episodeNum, base_url: baseUrl }) // Pass the correct episode number
            });

            const data = await response.json();

            if (!response.ok) {
                 // Try to get error message from JSON response, else use status text
                 const errorMsg = data.error || `服务器错误 (${response.status})`;
                 throw new Error(errorMsg);
            }

            if (data.player_url) {
                 // Open player with the direct URL obtained for this specific episode
                 openPlayer(data.player_url, `${title} - ${episodeNum}`, true); // true indicates direct URL
            } else {
                // This case might happen if backend logic changes but 'ok' is true
                throw new Error(`未能从服务器获取到有效的播放链接`);
            }

        } catch (error) {
             console.error("Error fetching/playing YFSP episode:", error);
             showError(`播放剧集 ${episodeNum} 时出错: ${error.message}`);
        } finally {
             // Restore button state AFTER attempting to play
             clickedButtonElement.innerHTML = originalButtonText; // Restore original text
             clickedButtonElement.disabled = false;
        }
    };


    // Open the player modal - Handles both direct URLs and links needing parsing
    const openPlayer = (urlOrLink, title, isDirectUrl = false) => {
        playerTitle.textContent = title; // Set title

        // Reset player state
        videoPlayerIframe.src = 'about:blank'; // Clear previous content immediately
        showPlayerLoading(true); // Show loading indicator inside player

        if (isDirectUrl) {
            // --- Direct URL (from YFSP episode detail) ---
            console.log("Opening player with direct URL:", urlOrLink);
            currentVideoLink = ''; // Clear parsing link state
            parsingSelectorContainer.style.display = 'none'; // Hide parsing selector for direct links
            videoPlayerIframe.src = urlOrLink; // Set iframe src directly

            // Setup load/error handlers for the iframe
             videoPlayerIframe.onload = () => {
                 console.log("Player iframe loaded:", urlOrLink);
                 showPlayerLoading(false);
             };
             videoPlayerIframe.onerror = (e) => {
                 console.error("Player iframe failed to load:", urlOrLink, e);
                 showPlayerLoading(false);
                 showError("加载播放器资源时出错。请检查链接或网络。");
                 // Optionally try to provide more info if possible from 'e'
             };

        } else {
            // --- Link requires parsing (from AI method search result) ---
            console.log("Opening player, needs parsing:", urlOrLink);
            if (parsingSelect.disabled) {
                 showPlayerLoading(false); // Hide loading as we can't proceed
                 showError("请先在设置中添加至少一个视频解析接口。");
                 closePlayer(); // Close the modal if we can't play
                 return; // Exit if no parsers available
            }

            currentVideoLink = urlOrLink; // Store the raw video link that needs parsing
            parsingSelectorContainer.style.display = ''; // Show parsing selector
            updatePlayerWithParser(); // Call helper to set initial iframe src

        }
        playerModal.style.display = 'block'; // Show the modal
    };

    // Helper function to set player source based on selected parser
    const updatePlayerWithParser = () => {
        if (!currentVideoLink || parsingSelect.disabled) {
             // Should not happen if openPlayer logic is correct, but safety check
             console.warn("updatePlayerWithParser called without link or disabled select");
             videoPlayerIframe.src = 'about:blank';
             showPlayerLoading(false);
             return;
        }

        const selectedParserUrl = parsingSelect.value;
        if (selectedParserUrl) {
             const finalUrl = selectedParserUrl + encodeURIComponent(currentVideoLink);
             console.log("Using parser:", selectedParserUrl, "Final URL:", finalUrl);
             videoPlayerIframe.src = 'about:blank'; // Clear first
             showPlayerLoading(true); // Show loading for parser change
             videoPlayerIframe.src = finalUrl; // Set new source

             // Re-attach load/error handlers as src changes
             videoPlayerIframe.onload = () => {
                  console.log("Player iframe loaded with parser:", finalUrl);
                  showPlayerLoading(false);
             };
             videoPlayerIframe.onerror = (e) => {
                  console.error("Player iframe failed to load with parser:", finalUrl, e);
                  showPlayerLoading(false);
                  showError("加载解析接口或视频时出错。请尝试更换接口或检查网络。");
             };
        } else {
            // This case means the select is enabled but somehow no value selected (shouldn't happen)
            showPlayerLoading(false);
            videoPlayerIframe.src = 'about:blank';
            showError("无法构建播放链接，未选择有效的解析接口。");
        }
    };


    // Close the player modal
    const closePlayer = () => {
        playerModal.style.display = 'none';
        videoPlayerIframe.src = 'about:blank'; // Stop video playback and clear iframe
        playerTitle.textContent = '正在播放...'; // Reset title
        currentVideoLink = ''; // Clear the link that required parsing
        showPlayerLoading(false); // Ensure player loading is hidden
        parsingSelectorContainer.style.display = 'none'; // Hide selector when closed
    };

    // Perform search by calling the backend API
    const performSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) {
            showError("请输入搜索内容");
            return;
        }

        // Get selected search method
        const selectedMethodRadio = document.querySelector('input[name="search-method"]:checked');
        const selectedMethod = selectedMethodRadio ? selectedMethodRadio.value : 'ai'; // Default to 'ai' if somehow none selected
        currentSearchMethod = selectedMethod; // Update state
        localStorage.setItem('videoSearchMethod', currentSearchMethod); // Save preference

        clearError();
        clearResults();
        showLoading(true, selectedMethod); // Pass method to loading text

        try {
            // Prepare request body
            const requestBody = {
                 query: query,
                 method: selectedMethod,
                 // Always send settings, backend decides if needed based on method
                 settings: {
                     aiApiUrl: currentSettings.aiApiUrl,
                     aiApiKey: currentSettings.aiApiKey,
                     aiModel: currentSettings.aiModel,
                     searxngUrl: currentSettings.searxngUrl
                     // Do NOT send parsingInterfaces here
                 }
             };

            console.log("Sending search request to backend:", requestBody);

            // Make the API call
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            });

             console.log("Backend Response Status:", response.status, response.statusText);
             const responseData = await response.json(); // Read response body once

             if (!response.ok) {
                 // Use error message from responseData if available, otherwise create one
                 const errorMsg = responseData?.error || `搜索请求失败 (${response.status})`;
                 console.error("Backend Error Response:", responseData);
                 throw new Error(errorMsg);
             }

             console.log("Backend Response Data:", responseData);
             // Backend should now add 'method' property to results
             displayResults(responseData); // Display results

        } catch (error) {
            console.error("Search Error:", error);
            // Display the error message from the caught error
            showError(`搜索或分析时出错: ${error.message}`);
            clearResults(); // Clear results area on error
        } finally {
            showLoading(false); // Hide loading indicator regardless of success/failure
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
            if (e.target.checked) {
                currentSearchMethod = e.target.value;
                localStorage.setItem('videoSearchMethod', currentSearchMethod); // Save preference immediately
                console.log("Search method changed to:", currentSearchMethod);
                // Optional: Clear results when method changes? Or keep them? Let's keep them for now.
                // clearResults();
                // clearError();
            }
        });
    });


    // Settings Modal Listeners
    settingsBtn.addEventListener('click', () => {
        populateSettingsForm(); // Load current settings into form
        renderParsingInterfacesList(); // Render current interfaces
        settingsModal.style.display = 'block';
    });
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });
    saveSettingsBtn.addEventListener('click', saveSettings); // Save settings
     resetSettingsBtn.addEventListener('click', resetToDefaults); // Reset settings
     // Add button for new interface within settings modal
     addInterfaceBtn.addEventListener('click', () => {
         const name = newInterfaceNameInput.value.trim();
         const url = newInterfaceUrlInput.value.trim();
         addParsingInterface(name, url, true); // Add and update UI immediately
         // Note: This adds visually but doesn't *save* until 'Save Settings' is clicked
         // Consider if this UX is clear, or if add should push directly and save?
         // Current setup: Add is temporary until Save Settings.
     });

    // Player Modal Listeners
    closePlayerBtn.addEventListener('click', closePlayer); // Close player

     // Update iframe src when user changes parsing interface in the player
    parsingSelect.addEventListener('change', () => {
        // Only re-parse if the player is open AND it's currently using a parsing link (currentVideoLink is set)
        // AND the parsing selector is actually visible (meaning it's an AI result)
        if (playerModal.style.display === 'block' && currentVideoLink && parsingSelectorContainer.style.display !== 'none') {
             console.log("Parser selection changed.");
             updatePlayerWithParser(); // Use helper to update player source
        }
    });


    // Global listener to close modals if clicked outside the content area
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

