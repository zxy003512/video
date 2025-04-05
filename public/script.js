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
    const videoPlayerIframe = document.getElementById('video-player');
    const playerLoadingIndicator = document.getElementById('player-loading-indicator');
    const episodeListContainer = document.getElementById('episode-list-container'); // Container for episode list
    const episodeListDiv = document.getElementById('episode-list'); // Where episode buttons go

    // --- State & Configuration ---
    let currentSettings = {};
    let defaultSettings = {
        defaultParsingInterfaces: [],
        defaultSearxngUrl: ''
        // defaultAiApiUrl: '', // Optionally load defaults from backend
        // defaultAiModel: '',
    };
    let currentVideoLink = ''; // Stores the link needing parsing (AI method)
    let currentYfspData = null; // Stores {id, baseUrl, title} for current YFSP item
    let currentSearchMethod = 'ai';
    let currentEpisodeList = []; // Stores the fetched episode list for YFSP

    // --- Functions ---

    const showLoading = (show, method = 'ai') => {
        loadingText.textContent = method === 'ai' ? '正在智能分析中...' : '正在搜索 YFSP 资源...';
        loadingIndicator.style.display = show ? 'flex' : 'none';
        searchBtn.disabled = show;
    };

    const showPlayerLoading = (show) => {
        playerLoadingIndicator.style.display = show ? 'flex' : 'none';
        videoPlayerIframe.style.opacity = show ? '0.3' : '1'; // Dim iframe while loading
    };

    const showError = (message) => {
        errorMessageDiv.textContent = message;
        errorMessageDiv.style.display = 'block';
        // Auto-hide after a while, but allow manual dismissal if needed
        // Consider adding a close button to the error message div in HTML/CSS
        setTimeout(() => {
             // Check if the message is still the same before hiding
             if (errorMessageDiv.textContent === message) {
                errorMessageDiv.style.display = 'none';
             }
        }, 8000); // Longer display time
    };

    const clearError = () => {
        errorMessageDiv.style.display = 'none';
        errorMessageDiv.textContent = '';
    };

    const clearResults = () => {
        resultsContainer.innerHTML = '';
    };

    // Load settings from localStorage or fetch defaults from backend
    const loadSettings = async () => {
        console.log("Fetching default config from /api/config...");
        try {
            const response = await fetch('/api/config');
            if (!response.ok) {
                throw new Error(`无法加载默认配置 (${response.status})`);
            }
            defaultSettings = await response.json();
            console.log("Default config loaded:", defaultSettings);
        } catch (error) {
            console.error("Error fetching default config:", error);
            showError("无法从服务器加载默认配置，将使用内置后备设置。请检查后端服务是否运行。");
            // Hardcoded fallbacks ONLY if fetch fails
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
            console.log("Loaded settings from localStorage:", currentSettings);
            // Ensure parsingInterfaces is always an array
            if (!Array.isArray(currentSettings.parsingInterfaces)) {
                currentSettings.parsingInterfaces = defaultSettings.defaultParsingInterfaces || [];
            }
        } else {
            // Initialize with defaults if nothing is saved
            currentSettings = {
                aiApiUrl: '', // User must provide or backend must have default
                aiApiKey: '', // User must provide or backend must have default
                aiModel: '', // User must provide or backend must have default
                searxngUrl: defaultSettings.defaultSearxngUrl,
                // Deep copy default interfaces to avoid mutation issues
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces || []))
            };
            console.log("Using default settings structure:", currentSettings);
        }

        // Load saved search method or default to 'ai'
        currentSearchMethod = localStorage.getItem('videoSearchMethod') || 'ai';
        const currentMethodRadio = document.querySelector(`input[name="search-method"][value="${currentSearchMethod}"]`);
        if (currentMethodRadio) {
            currentMethodRadio.checked = true;
        } else {
            // Fallback if saved value is invalid
            document.querySelector(`input[name="search-method"][value="ai"]`).checked = true;
            currentSearchMethod = 'ai';
        }

        populateSettingsForm();
        renderParsingInterfacesList();
        updateParsingSelect();
    };

    // Save settings to localStorage
    const saveSettings = () => {
        // Basic validation for new interface URL before adding (if fields aren't empty)
         const newName = newInterfaceNameInput.value.trim();
         const newUrl = newInterfaceUrlInput.value.trim();
         if (newName || newUrl) { // Only validate if user tried to add something
             if (!newName || !newUrl) {
                 showError("如果要添加新接口，名称和 URL 都不能为空。");
                 return;
             }
             if (!newUrl.includes('?url=')) {
                 showError("新解析接口 URL 格式似乎不正确，应包含 '?url='");
                 return;
             }
             if (!newUrl.endsWith('=')) {
                 // Be a bit lenient, some might forget the final =
                 // showError("新解析接口URL通常以 '=' 结尾");
                 console.warn("新解析接口URL最好以 '=' 结尾");
                // return;
             }
             // If validation passes, add it before saving
             addParsingInterface(false); // Add without showing alert
         }


        currentSettings = {
            aiApiUrl: aiApiUrlInput.value.trim(),
            aiApiKey: aiApiKeyInput.value.trim(), // Save user's key (even if empty)
            aiModel: aiModelInput.value.trim(),
            searxngUrl: searxngUrlInput.value.trim() || defaultSettings.defaultSearxngUrl, // Fallback to default if empty
            parsingInterfaces: currentSettings.parsingInterfaces || [] // Ensure it's an array
        };
        localStorage.setItem('videoSearchPlayerSettings', JSON.stringify(currentSettings));
        localStorage.setItem('videoSearchMethod', currentSearchMethod); // Save current search method too
        console.log("Settings saved:", currentSettings);
        alert("设置已保存！");
        settingsModal.style.display = 'none';
        updateParsingSelect(); // Update player dropdown in case interfaces changed
    };

     // Reset settings to defaults fetched from backend
    const resetToDefaults = () => {
         if (confirm("确定要恢复所有设置为默认值吗？这将清除您自定义的API密钥、模型、搜索引擎地址和解析接口。")) {
             currentSettings = {
                aiApiUrl: '', // Clear user overrides
                aiApiKey: '',
                aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl, // Reset to fetched default
                // Deep copy default interfaces again
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces || []))
             };
             localStorage.removeItem('videoSearchPlayerSettings'); // Remove saved settings

             // Reset search method to default ('ai')
             currentSearchMethod = 'ai';
             localStorage.setItem('videoSearchMethod', currentSearchMethod);
             const aiRadio = document.querySelector(`input[name="search-method"][value="ai"]`);
             if(aiRadio) aiRadio.checked = true;

             populateSettingsForm(); // Update form fields
             renderParsingInterfacesList(); // Update interface list in settings
             updateParsingSelect(); // Update player dropdown
             alert("设置已恢复为默认值。");
             settingsModal.style.display = 'none'; // Close modal
         }
    };

    // Populate the settings form fields based on currentSettings
    const populateSettingsForm = () => {
        aiApiUrlInput.value = currentSettings.aiApiUrl || ''; // Use defaults if available? No, let user provide.
        aiApiKeyInput.value = currentSettings.aiApiKey || '';
        aiModelInput.value = currentSettings.aiModel || '';
        searxngUrlInput.value = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl || ''; // Use fetched default if user's is empty
    };

    // Render the list of parsing interfaces in the settings modal
    const renderParsingInterfacesList = () => {
        interfacesListDiv.innerHTML = ''; // Clear existing list
        const interfaces = currentSettings.parsingInterfaces || [];
        if (interfaces.length === 0) {
             interfacesListDiv.innerHTML = '<p>没有配置解析接口。</p>';
             return;
        }
        interfaces.forEach((iface, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.classList.add('interface-item');
            itemDiv.innerHTML = `
                <span>${iface.name || '未命名接口'} (${iface.url || '无效URL'})</span>
                <button data-index="${index}" class="remove-interface-btn" aria-label="删除接口 ${iface.name}">&times;</button>
            `;
            interfacesListDiv.appendChild(itemDiv);

            // Add event listener directly to the button
            itemDiv.querySelector('.remove-interface-btn').addEventListener('click', (e) => {
                 // Prevent click bubbling if needed, though likely not necessary here
                 // e.stopPropagation();
                const indexToRemove = parseInt(e.target.getAttribute('data-index'));
                removeParsingInterface(indexToRemove);
            });
        });
    };

    // Add a new parsing interface (called by saveSettings or Add button)
    const addParsingInterface = (showAlert = true) => {
        const name = newInterfaceNameInput.value.trim();
        const url = newInterfaceUrlInput.value.trim();

        // Validation is done in saveSettings or button listener now
        if (!name || !url) {
            if (showAlert) showError("接口名称和URL不能为空");
            return;
        }
        // Basic validation (can be enhanced)
        if (!url.includes('?url=')) {
             if (showAlert) showError("URL 格式似乎不正确，应包含 '?url='");
             return;
        }

        if (!currentSettings.parsingInterfaces) { currentSettings.parsingInterfaces = []; }
        currentSettings.parsingInterfaces.push({ name, url });
        // Note: We don't save to localStorage here, saveSettings does that
        renderParsingInterfacesList(); // Update display in settings modal
        updateParsingSelect(); // Update player dropdown
        newInterfaceNameInput.value = ''; // Clear input fields
        newInterfaceUrlInput.value = '';
        if (showAlert) {
             alert("接口已添加，请记得点击“保存设置”来持久化更改。");
        }
    };


    // Remove a parsing interface
    const removeParsingInterface = (index) => {
        const interfaces = currentSettings.parsingInterfaces || [];
        if (interfaces[index]) {
            const removedName = interfaces[index].name;
            interfaces.splice(index, 1); // Remove the item
            // Note: We don't save to localStorage here, saveSettings does that
            renderParsingInterfacesList(); // Update display in settings modal
            updateParsingSelect(); // Update player dropdown
            // alert(`接口 "${removedName}" 已移除。请记得保存设置。`); // Maybe too noisy
            console.log(`Interface "${removedName}" removed from list (pending save).`);
        } else {
            console.error("Attempted to remove interface at invalid index:", index);
        }
    };

     // Update the <select> dropdown in the player modal for AI method links
    const updateParsingSelect = () => {
        parsingSelect.innerHTML = ''; // Clear existing options
        const interfaces = currentSettings.parsingInterfaces || [];
        if (interfaces.length > 0) {
            interfaces.forEach((iface) => {
                const option = document.createElement('option');
                option.value = iface.url;
                option.textContent = iface.name;
                parsingSelect.appendChild(option);
            });
            parsingSelect.disabled = false;
            // parsingSelectorContainer.style.display = ''; // Let openPlayer control visibility
        } else {
            // No interfaces configured
            const option = document.createElement('option');
            option.textContent = '没有可用的解析接口';
            option.value = '';
            option.disabled = true; // Make the placeholder unselectable
            parsingSelect.appendChild(option);
            parsingSelect.disabled = true;
            // parsingSelectorContainer.style.display = 'none'; // Hide if no options? Or show disabled? Let openPlayer decide.
        }
    };

    // Display search results (Handles both AI and YFSP)
    const displayResults = (results) => {
        clearResults();
        if (!results || results.length === 0) {
            resultsContainer.innerHTML = `<p class="no-results-message">未能找到相关资源。请尝试更换关键词或搜索方式。</p>`;
            return;
        }

        results.forEach(result => {
            const card = document.createElement('div');
            card.classList.add('result-card');
            card.dataset.title = result.title; // Store title

            if (result.method === 'yfsp' && result.id && result.base_url && result.cover) {
                // --- YFSP Card ---
                card.classList.add('yfsp-card');
                card.dataset.id = result.id;
                card.dataset.baseUrl = result.base_url;
                card.dataset.method = 'yfsp';
                card.innerHTML = `
                    <div class="yfsp-cover">
                        <img src="${result.cover}" alt="${result.title || '封面'}" loading="lazy" onerror="this.parentElement.innerHTML='<p>无法加载封面</p>';">
                    </div>
                    <div class="yfsp-info">
                         <h3>${result.title || '未知标题'}</h3>
                         <button class="play-btn play-episode-btn" data-initial="true"><i class="fas fa-list-ul"></i> 选择剧集</button>
                    </div>
                `;
                // Add event listener FOR THE BUTTON
                const playButton = card.querySelector('.play-episode-btn');
                playButton.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent card click if necessary
                    const buttonElement = e.currentTarget;
                    // Request details for the first episode to get the list
                    playYfspEpisode(result.id, result.base_url, result.title, 1, buttonElement);
                });
            } else if (result.method === 'ai' && result.video_link) {
                // --- AI Card ---
                 card.classList.add('ai-card');
                 card.dataset.link = result.video_link;
                 card.dataset.method = 'ai';
                 card.innerHTML = `
                    <h3>${result.title || '未知标题'}</h3>
                    <p><span class="website-badge">${result.website || getDomainFromUrl(result.video_link) || '未知来源'}</span></p>
                    <p class="link-preview" title="${result.video_link}">${result.video_link.substring(0, 60)}${result.video_link.length > 60 ? '...' : ''}</p>
                    <button class="play-btn play-ai-btn"><i class="fas fa-play-circle"></i> 点击播放</button>
                 `;
                 // Add event listener FOR THE BUTTON
                 const playButton = card.querySelector('.play-ai-btn');
                 playButton.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (parsingSelect.disabled || !parsingSelect.value) {
                         showError("请先在设置中添加并选择一个视频解析接口才能播放此链接。");
                         settingsBtn.click(); // Open settings modal
                         return;
                    }
                    openPlayer(result.video_link, result.title, false); // false = requires parsing
                 });
            } else {
                console.warn("Skipping result due to missing data:", result);
            }
            // Only append card if it was populated correctly
            if (card.innerHTML.trim() !== '') {
                 resultsContainer.appendChild(card);
            }
        });
    };

    // Helper to get domain for display if AI missed it
    const getDomainFromUrl = (url) => {
        try {
            return new URL(url).hostname.replace(/^www\./, '');
        } catch (e) {
            return null;
        }
    };

    // Fetch YFSP episode details and potentially open player
    const playYfspEpisode = async (id, baseUrl, title, episodeNum, buttonElement) => {
        console.log(`Requesting YFSP details: id=${id}, ep=${episodeNum}, title=${title}`);
        const isInitialClick = buttonElement && buttonElement.dataset.initial === 'true';
        let originalButtonHTML = '';
        if (buttonElement) {
             originalButtonHTML = buttonElement.innerHTML;
             buttonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 加载中...`;
             buttonElement.disabled = true;
             delete buttonElement.dataset.initial; // Remove flag after first click
        } else {
            // If called without button (e.g., switching episode in modal), show player loading
            showPlayerLoading(true);
        }
        clearError();

        try {
            const response = await fetch('/api/get_episode_details', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ id: id, episode: episodeNum, base_url: baseUrl })
            });

            const data = await response.json();

            if (!response.ok) {
                 throw new Error(data.error || `无法获取剧集 ${episodeNum} 的播放信息 (HTTP ${response.status})`);
            }

            if (data.player_url) {
                 console.log(`Received player URL: ${data.player_url}, Episodes:`, data.episodes);
                 currentYfspData = { id, baseUrl, title }; // Store context for episode switching
                 currentEpisodeList = data.episodes || []; // Store episode list

                 // Open player with the fetched URL and episode list
                 openPlayer(data.player_url, `${title} - 第 ${episodeNum} 集`, true, currentEpisodeList, episodeNum); // true = direct URL
            } else {
                throw new Error(data.error || `未能从服务器获取到有效的播放链接`);
            }

        } catch (error) {
             console.error("Error fetching/playing YFSP episode:", error);
             showError(`播放剧集 ${episodeNum} 时出错: ${error.message}`);
             if (!isInitialClick) showPlayerLoading(false); // Hide loading if it was inside player
        } finally {
             // Restore button state ONLY if it was the initial click from the card
             if (buttonElement && isInitialClick) {
                 buttonElement.innerHTML = originalButtonHTML; // Restore original text/icon
                 buttonElement.disabled = false;
             }
             // Loading indicator inside player is handled by openPlayer/iframe load
        }
    };

    // Open the player modal
    // isDirectUrl: true for YFSP, false for AI links needing parsing
    // episodes: array of episode objects for YFSP
    // currentEpisodeNum: The number of the episode initially loaded (for highlighting)
    const openPlayer = (urlOrLink, title, isDirectUrl = false, episodes = [], currentEpisodeNum = null) => {
        playerTitle.textContent = title;
        videoPlayerIframe.src = 'about:blank'; // Clear previous content
        episodeListDiv.innerHTML = ''; // Clear previous episode list
        currentVideoLink = ''; // Reset AI link state
        showPlayerLoading(true); // Show loading indicator

        if (isDirectUrl) {
            // --- Direct URL (from YFSP) ---
            console.log("Opening player (YFSP - Direct):", urlOrLink);
            parsingSelectorContainer.style.display = 'none'; // Hide parsing selector
            episodeListContainer.style.display = 'none'; // Hide episode list initially

            if (episodes && episodes.length > 0) {
                episodeListContainer.style.display = ''; // Show episode container
                renderEpisodeList(episodes, currentEpisodeNum); // Populate episode list
            } else {
                console.log("No episodes provided or list is empty.");
            }

            videoPlayerIframe.src = urlOrLink; // Set iframe src directly

        } else {
            // --- Link requires parsing (from AI method) ---
            console.log("Opening player (AI - Needs Parsing):", urlOrLink);
            episodeListContainer.style.display = 'none'; // Hide episode list for AI sources

            if (parsingSelect.disabled || !parsingSelect.value) {
                 showPlayerLoading(false);
                 showError("请先在设置中添加并选择一个视频解析接口。");
                 // Optionally open settings modal here: settingsBtn.click();
                 return; // Exit if no parsers available
            }

            currentVideoLink = urlOrLink; // Store the raw video link for the parser
            parsingSelectorContainer.style.display = ''; // Show parsing selector
            updatePlayerWithParser(); // Call function to set initial parser URL

        }

        // Common iframe load/error handling
        videoPlayerIframe.onload = () => {
            console.log("Iframe loaded:", videoPlayerIframe.src);
            showPlayerLoading(false);
        }
        videoPlayerIframe.onerror = () => {
             console.error("Iframe failed to load:", videoPlayerIframe.src);
             showPlayerLoading(false);
             showError("加载播放器资源时出错。可能是链接已失效、需要特定地区或解析接口不支持。");
        };

        playerModal.style.display = 'block'; // Show the modal
    };

    // Sets or updates the iframe source based on the selected parser (for AI links)
    const updatePlayerWithParser = () => {
         if (!currentVideoLink || parsingSelect.disabled || !parsingSelect.value) {
             console.warn("Cannot update player with parser: missing link or parser.");
             showPlayerLoading(false); // Hide loading if we can't proceed
             // showError("无法更新播放器，缺少视频链接或解析接口。"); // Maybe too noisy
             return;
         }
         const selectedParserUrl = parsingSelect.value;
         const finalUrl = selectedParserUrl + encodeURIComponent(currentVideoLink);
         console.log("Updating player with parser:", selectedParserUrl, "Final URL:", finalUrl);

         // Avoid reloading if the src is already the same
         if (videoPlayerIframe.src !== finalUrl) {
             showPlayerLoading(true); // Show loading before changing source
             videoPlayerIframe.src = finalUrl;
             // onload/onerror handlers attached in openPlayer will handle hiding loading
         }
    };

    // Render episode list inside the player modal for YFSP
    const renderEpisodeList = (episodes, currentNum) => {
        episodeListDiv.innerHTML = ''; // Clear previous
        if (!episodes || episodes.length === 0) return;

        console.log(`Rendering ${episodes.length} episodes, current: ${currentNum}`);

        episodes.forEach(ep => {
            const button = document.createElement('button');
            button.classList.add('episode-button');
            button.textContent = ep.num || '??'; // Display episode number
            button.dataset.epNum = ep.link_num || ep.num; // Use number from link if available, fallback to text
            button.dataset.title = currentYfspData?.title || '视频'; // Get base title from stored data

            // Highlight the currently playing episode
            // Convert both to string for comparison, as currentNum might be number, ep.num might be string
            if (String(ep.num) === String(currentNum) || String(ep.link_num) === String(currentNum)) {
                button.classList.add('active');
            }

            button.addEventListener('click', () => {
                const targetEpNum = button.dataset.epNum;
                const baseTitle = button.dataset.title;
                if (targetEpNum && currentYfspData) {
                    console.log(`Episode button clicked: switching to ${targetEpNum}`);
                    // Update title immediately (visual feedback)
                    playerTitle.textContent = `${baseTitle} - 第 ${targetEpNum} 集 (加载中...)`;
                    // Call backend to get the new player URL and reload
                    // Pass null for buttonElement as this isn't the initial card click
                    playYfspEpisode(currentYfspData.id, currentYfspData.baseUrl, baseTitle, targetEpNum, null);
                } else {
                    console.error("Cannot switch episode: missing data", {targetEpNum, currentYfspData});
                    showError("切换剧集时出错：缺少必要信息。");
                }
            });
            episodeListDiv.appendChild(button);
        });

        // Scroll the current episode into view if possible
        const activeButton = episodeListDiv.querySelector('.episode-button.active');
        if (activeButton) {
             // Use scrollIntoView with options for smoother behavior
             activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
    };

    // Close the player modal
    const closePlayer = () => {
        playerModal.style.display = 'none';
        videoPlayerIframe.src = 'about:blank'; // Stop video playback and clear iframe
        playerTitle.textContent = '正在播放...';
        episodeListDiv.innerHTML = ''; // Clear episode list
        currentVideoLink = ''; // Clear AI link state
        currentYfspData = null; // Clear YFSP context
        currentEpisodeList = [];
        showPlayerLoading(false); // Ensure player loading is hidden
    };

    // Perform search by calling the backend API
    const performSearch = async () => {
        const query = searchInput.value.trim();
        if (!query) {
            showError("请输入搜索内容");
            return;
        }

        // Get selected search method at the time of search
        const selectedMethod = document.querySelector('input[name="search-method"]:checked').value;
        currentSearchMethod = selectedMethod; // Update state
        localStorage.setItem('videoSearchMethod', currentSearchMethod); // Save preference

        clearError();
        clearResults();
        showLoading(true, selectedMethod); // Pass method to loading text

        try {
            const requestBody = {
                 query: query,
                 method: selectedMethod,
                 // Send current settings, backend decides what to use based on method
                 settings: {
                     aiApiUrl: currentSettings.aiApiUrl,
                     aiApiKey: currentSettings.aiApiKey, // Send user's key (or empty string)
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
            // console.log("Backend Response Data:", responseData); // Log data only if needed

            if (!response.ok) {
                const errorMsg = responseData.error || `搜索失败 (代码: ${response.status})`;
                throw new Error(errorMsg);
            }

            // Backend adds 'method' property, displayResults handles it
            displayResults(responseData);

        } catch (error) {
            console.error("Search Error:", error);
            showError(`搜索时出错: ${error.message}`);
            clearResults(); // Clear any partial results/loading state
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
            localStorage.setItem('videoSearchMethod', currentSearchMethod);
             console.log("Search method changed to:", currentSearchMethod);
             // Maybe clear results when method changes? Optional.
             // clearResults();
             // clearError();
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
    saveSettingsBtn.addEventListener('click', saveSettings);
    resetSettingsBtn.addEventListener('click', resetToDefaults);
    addInterfaceBtn.addEventListener('click', () => addParsingInterface(true)); // Add button triggers add with alert

    // Player Modal Listeners
    closePlayerBtn.addEventListener('click', closePlayer);

     // Update iframe src when user changes parsing interface (only for AI links)
    parsingSelect.addEventListener('change', () => {
        // Only update if the player is open AND it's currently showing an AI link (parsing selector is visible)
        if (playerModal.style.display === 'block' && parsingSelectorContainer.style.display !== 'none' && currentVideoLink) {
             updatePlayerWithParser();
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
