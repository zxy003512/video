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
    let currentVideoLink = ''; // To store the link for AI method results needing parsing
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
        console.error("Error Displayed:", message); // Log error to console as well
        // Sanitize message slightly before displaying
        const cleanMessage = message.replace(/<|>/g, ""); // Basic tag removal
        errorMessageDiv.textContent = cleanMessage;
        errorMessageDiv.style.display = 'block';
        // Auto-hide after some time
        setTimeout(() => {
             errorMessageDiv.style.display = 'none';
        }, 8000); // Longer display time (8 seconds)
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
            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`无法加载默认配置 (${response.status}): ${errorData}`);
            }
            defaultSettings = await response.json();
            console.log("Fetched default settings:", defaultSettings);
        } catch (error) {
            console.error("Error fetching default config:", error);
            showError("无法从服务器加载默认配置，将使用内置后备设置。");
            // Use hardcoded fallbacks only if fetch fails completely
            defaultSettings = {
                defaultParsingInterfaces: [
                    {"name": "接口1 - xmflv.com", "url": "https://jx.xmflv.com/?url=", "restricted_mobile": true},
                    {"name": "接口2 - bd.jx.cn", "url": "https://bd.jx.cn/?url=", "restricted_mobile": False},
                    {"name": "接口3 - xmflv.cc", "url": "https://jx.xmflv.cc/?url=", "restricted_mobile": True},
                    {"name": "接口4 - hls.one", "url": "https://jx.hls.one/?url=", "restricted_mobile": False},
                    {"name": "接口5 - 77flv.cc", "url": "https://jx.77flv.cc/?url=", "restricted_mobile": False},
                    {"name": "接口6 - yemu.xyz", "url": "https://www.yemu.xyz/?url=", "restricted_mobile": True}
                ],
                defaultSearxngUrl: "https://searxng.zetatechs.online/search"
             };
        }

        const savedSettings = localStorage.getItem('videoSearchPlayerSettings');
        if (savedSettings) {
            try {
                currentSettings = JSON.parse(savedSettings);
                // Ensure essential keys exist after loading from storage
                currentSettings.aiApiUrl = currentSettings.aiApiUrl || '';
                currentSettings.aiApiKey = currentSettings.aiApiKey || '';
                currentSettings.aiModel = currentSettings.aiModel || '';
                currentSettings.searxngUrl = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl;
                currentSettings.parsingInterfaces = currentSettings.parsingInterfaces || defaultSettings.defaultParsingInterfaces;
                console.log("Loaded settings from localStorage:", currentSettings);
            } catch (e) {
                 console.error("Error parsing saved settings:", e);
                 // If parsing fails, revert to defaults
                 currentSettings = {
                     aiApiUrl: '', aiApiKey: '', aiModel: '',
                     searxngUrl: defaultSettings.defaultSearxngUrl,
                     parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces)) // Deep copy
                 };
                 localStorage.removeItem('videoSearchPlayerSettings'); // Clear corrupted data
            }
        } else {
            // No saved settings, use defaults (deep copy interfaces)
            currentSettings = {
                aiApiUrl: '', aiApiKey: '', aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl,
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces)) // Deep copy
            };
            console.log("Using default settings:", currentSettings);
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
             localStorage.setItem('videoSearchMethod', currentSearchMethod);
        }

        populateSettingsForm();
        renderParsingInterfacesList();
        updateParsingSelect();
    };

    // Save settings to localStorage
    const saveSettings = () => {
        // Validate new interface URL before adding to currentSettings if fields are filled
        const newInterfaceName = newInterfaceNameInput.value.trim();
        const newInterfaceUrl = newInterfaceUrlInput.value.trim();
        if (newInterfaceName && newInterfaceUrl) {
            if (!newInterfaceUrl.includes('?url=')) {
                 showError("新解析接口URL格式似乎不正确，应包含 '?url='");
                 return; // Prevent saving if new URL is invalid and user tried to add
             }
             if (!newInterfaceUrl.endsWith('=')) {
                 showError("新解析接口URL应以 '=' 结尾");
                 return; // Prevent saving
             }
             // If validation passes, add it before saving
             addParsingInterface(false); // Add without alerting "saved" yet
        } else if (newInterfaceName || newInterfaceUrl) {
             // If only one field is filled
             showError("请同时填写新接口的名称和URL");
             return;
        }


        currentSettings = {
            aiApiUrl: aiApiUrlInput.value.trim(),
            aiApiKey: aiApiKeyInput.value.trim(),
            aiModel: aiModelInput.value.trim(),
            searxngUrl: searxngUrlInput.value.trim() || defaultSettings.defaultSearxngUrl,
            parsingInterfaces: currentSettings.parsingInterfaces || [] // Use existing interfaces array
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
         if (confirm("确定要恢复所有设置为默认值吗？这将清除您自定义的API密钥和接口。")) {
             // Reset to defaults obtained from /api/config
             currentSettings = {
                aiApiUrl: '', // Clear custom AI settings
                aiApiKey: '',
                aiModel: '',
                searxngUrl: defaultSettings.defaultSearxngUrl, // Reset SearXNG URL
                parsingInterfaces: JSON.parse(JSON.stringify(defaultSettings.defaultParsingInterfaces)) // Deep copy default interfaces
             };
             localStorage.removeItem('videoSearchPlayerSettings'); // Remove saved settings

             // Reset search method to default ('ai')
             currentSearchMethod = 'ai';
             localStorage.setItem('videoSearchMethod', currentSearchMethod);
             const aiRadio = document.querySelector(`input[name="search-method"][value="ai"]`);
             if(aiRadio) aiRadio.checked = true;

             // Update UI elements
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
        searxngUrlInput.value = currentSettings.searxngUrl || defaultSettings.defaultSearxngUrl || '';
        // Clear new interface fields when opening settings
        newInterfaceNameInput.value = '';
        newInterfaceUrlInput.value = '';
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
            // Display URL safely (prevent potential XSS if name contains HTML)
            const nameSpan = document.createElement('span');
            nameSpan.textContent = `${iface.name} (${iface.url})`;
            itemDiv.appendChild(nameSpan);

            const removeBtn = document.createElement('button');
            removeBtn.dataset.index = index;
            removeBtn.classList.add('remove-interface-btn');
            removeBtn.setAttribute('aria-label', '删除接口');
            removeBtn.innerHTML = '&times;'; // Use HTML entity for 'x'
            itemDiv.appendChild(removeBtn);

            interfacesListDiv.appendChild(itemDiv);
        });

        // Add event listeners after elements are in the DOM
        document.querySelectorAll('.remove-interface-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                // Use currentTarget in case the click hits the icon inside button etc.
                const indexToRemove = parseInt(e.currentTarget.getAttribute('data-index'));
                removeParsingInterface(indexToRemove);
            });
        });
    };

    // Add a new parsing interface (can be called internally by saveSettings)
    const addParsingInterface = (alertSaved = true) => {
        const name = newInterfaceNameInput.value.trim();
        const url = newInterfaceUrlInput.value.trim();

        if (!name || !url) {
            if (alertSaved) showError("接口名称和URL不能为空"); // Only show error if called directly by button
            return false; // Indicate failure
        }
        if (!url.includes('?url=')) {
            if (alertSaved) showError("URL 格式似乎不正确，应包含 '?url='");
            return false;
        }
        // Allow URLs that don't end with '=' if needed by some parsers
        // if (!url.endsWith('=')) {
        //     if (alertSaved) showError("URL 最好以 '=' 结尾");
        //     // return false; // Don't enforce strictly
        // }

        // Ensure parsingInterfaces array exists
        if (!currentSettings.parsingInterfaces) {
            currentSettings.parsingInterfaces = [];
        }
        // Check if interface with the same URL already exists
        if (currentSettings.parsingInterfaces.some(iface => iface.url === url)) {
             if (alertSaved) showError("具有相同 URL 的接口已存在。");
             return false;
        }

        currentSettings.parsingInterfaces.push({ name, url });
        // No need to save to localStorage here, saveSettings will handle it
        renderParsingInterfacesList();
        updateParsingSelect(); // Update dropdown immediately
        newInterfaceNameInput.value = ''; // Clear fields after adding
        newInterfaceUrlInput.value = '';
        if (alertSaved) {
             // Alert only if called directly from button, not from saveSettings
             // alert("接口已添加，请点击“保存设置”以永久保存。"); // Maybe confusing, let save handle saving alert
        }
        return true; // Indicate success
    };

    // Remove a parsing interface
    const removeParsingInterface = (index) => {
        if (currentSettings.parsingInterfaces && currentSettings.parsingInterfaces[index]) {
            const removedInterface = currentSettings.parsingInterfaces.splice(index, 1);
            console.log("Removed interface:", removedInterface[0]);
            // No need to save to localStorage here, saveSettings will handle it
            renderParsingInterfacesList(); // Re-render the list in settings
            updateParsingSelect(); // Update the dropdown in player
            // alert("接口已移除，请点击“保存设置”以永久保存更改。"); // Maybe confusing
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
                parsingSelect.appendChild(option);
            });
            parsingSelect.disabled = false;
            // Selector container visibility is handled by openPlayer based on context
        } else {
            const option = document.createElement('option');
            option.textContent = '没有可用的解析接口';
            option.disabled = true; // Make the placeholder unselectable
            parsingSelect.appendChild(option);
            parsingSelect.disabled = true;
            // Keep selector container hidden until needed
            // parsingSelectorContainer.style.display = 'none';
        }
    };

    // Display search results - Handles both AI and YFSP results
    const displayResults = (results) => {
        clearResults(); // Clear previous results
        clearError(); // Clear any previous errors

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
                card.classList.add('yfsp-card');
                card.dataset.id = result.id;
                card.dataset.baseUrl = result.base_url;
                card.dataset.method = 'yfsp';

                // Create cover image element safely
                const coverDiv = document.createElement('div');
                coverDiv.classList.add('yfsp-cover');
                if (result.cover) {
                    const img = document.createElement('img');
                    img.src = result.cover;
                    img.alt = `${result.title} Cover`;
                    img.loading = 'lazy'; // Lazy load images
                    img.onerror = (e) => { e.target.style.display = 'none'; }; // Hide if image fails to load
                    coverDiv.appendChild(img);
                } else {
                     coverDiv.innerHTML = '<span class="no-cover">无封面</span>'; // Placeholder if no cover
                }
                card.appendChild(coverDiv);

                // Create info section
                const infoDiv = document.createElement('div');
                infoDiv.classList.add('yfsp-info');

                const titleH3 = document.createElement('h3');
                titleH3.textContent = result.title;
                infoDiv.appendChild(titleH3);

                // Create "Select Episode" button
                const selectEpisodeBtn = document.createElement('button');
                selectEpisodeBtn.classList.add('select-episode-btn'); // New class for styling
                selectEpisodeBtn.innerHTML = '<i class="fas fa-list-ul"></i> 选择剧集';
                // Store data needed for fetching episodes on the button itself
                selectEpisodeBtn.dataset.id = result.id;
                selectEpisodeBtn.dataset.baseUrl = result.base_url;
                selectEpisodeBtn.dataset.title = result.title; // Pass title along
                infoDiv.appendChild(selectEpisodeBtn);

                // Add placeholder for episode list (will be populated on click)
                const episodeListDiv = document.createElement('div');
                episodeListDiv.classList.add('episode-list'); // Class for styling the container
                episodeListDiv.style.display = 'none'; // Initially hidden
                infoDiv.appendChild(episodeListDiv);

                card.appendChild(infoDiv);

                // Add event listener for the "Select Episode" button
                selectEpisodeBtn.addEventListener('click', handleSelectEpisodeClick);

            } else if (result.method === 'ai' && result.video_link) {
                // --- AI Card (Original) ---
                 card.classList.add('ai-card');
                 card.dataset.link = result.video_link;
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
                    // Check if interfaces exist before opening
                    if (!currentSettings.parsingInterfaces || currentSettings.parsingInterfaces.length === 0) {
                        showError("没有配置视频解析接口，请在设置中添加。");
                        return;
                    }
                    openPlayer(result.video_link, result.title, false); // false indicates not a direct URL, needs parsing
                 });
            } else {
                 console.warn("Skipping result due to missing data:", result);
                 // Optionally create a basic card indicating skipped result
            }
            resultsContainer.appendChild(card);
        });
    };

    // --- NEW: Handle click on "Select Episode" button ---
    const handleSelectEpisodeClick = async (event) => {
        const button = event.currentTarget;
        const card = button.closest('.yfsp-card'); // Find the parent card
        const episodeListDiv = card.querySelector('.episode-list');
        const videoId = button.dataset.id;
        const baseUrl = button.dataset.baseUrl;
        const title = button.dataset.title; // Get title

        if (!videoId || !baseUrl || !card || !episodeListDiv) {
            showError("无法获取视频信息以加载剧集列表。");
            return;
        }

        // Toggle episode list visibility or fetch if first time
        if (episodeListDiv.style.display === 'block') {
            episodeListDiv.style.display = 'none'; // Hide if already visible
            button.innerHTML = '<i class="fas fa-list-ul"></i> 选择剧集'; // Reset button text/icon
            return;
        }

        // Show loading state on the button
        const originalButtonHTML = button.innerHTML;
        button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> 加载中...`;
        button.disabled = true;
        clearError(); // Clear previous errors

        try {
            console.log(`Fetching episode list for ID: ${videoId}, Base URL: ${baseUrl}`);
            const response = await fetch('/api/get_yfsp_episode_list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: videoId, base_url: baseUrl })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `服务器错误 (${response.status})`);
            }

            // Display episodes
            displayEpisodeSelection(data, episodeListDiv, card); // Pass card to know where to put list
            episodeListDiv.style.display = 'block'; // Show the list
            button.innerHTML = '<i class="fas fa-chevron-up"></i> 收起列表'; // Change button state

        } catch (error) {
            console.error("Error fetching YFSP episode list:", error);
            showError(`加载剧集列表失败: ${error.message}`);
            episodeListDiv.innerHTML = '<p class="episode-error">加载失败</p>'; // Show error within list div
            episodeListDiv.style.display = 'block'; // Show error message area
            button.innerHTML = '<i class="fas fa-exclamation-circle"></i> 加载失败'; // Indicate failure on button
        } finally {
            // Only re-enable button if it didn't become "收起列表"
            if (button.innerHTML.includes('fa-spinner') || button.innerHTML.includes('fa-exclamation-circle')) {
                 button.disabled = false;
                 // Optionally revert to original HTML if failed completely
                 // if (button.innerHTML.includes('fa-exclamation-circle')) {
                 //    button.innerHTML = originalButtonHTML;
                 // }
            } else {
                button.disabled = false; // Re-enable "收起列表" button
            }
        }
    };

    // --- NEW: Display Episode Selection Buttons ---
    const displayEpisodeSelection = (episodes, containerDiv, cardElement) => {
        containerDiv.innerHTML = ''; // Clear previous content (like loading/error messages)

        if (!episodes || episodes.length === 0) {
            containerDiv.innerHTML = '<p class="no-episodes">未找到剧集信息（可能为电影）。</p>';
            return;
        }

        // Get data needed for playYfspEpisode from the card/button dataset
        const videoId = cardElement.dataset.id;
        const baseUrl = cardElement.dataset.baseUrl;
        const title = cardElement.dataset.title; // Ensure title is available

        episodes.forEach(episode => {
            const epButton = document.createElement('button');
            epButton.classList.add('episode-select-btn');
            epButton.textContent = episode.num; // Display episode number
            epButton.dataset.episodeNum = episode.num; // Store number for click handler

            epButton.addEventListener('click', (e) => {
                 // Prevent the "Select Episode" button click event
                e.stopPropagation();
                const selectedEpisodeNum = e.currentTarget.dataset.episodeNum;
                console.log(`Episode button clicked: ID=${videoId}, BaseURL=${baseUrl}, Title=${title}, Episode=${selectedEpisodeNum}`);
                // Call the existing play function with all necessary data
                playYfspEpisode(videoId, baseUrl, title, selectedEpisodeNum, e.currentTarget); // Pass button for loading state
            });
            containerDiv.appendChild(epButton);
        });
    };


    // Function to handle playing YFSP episode (NOW called by individual episode buttons)
    const playYfspEpisode = async (id, baseUrl, title, episodeNum, buttonElement) => {
        console.log(`Attempting to play YFSP: id=${id}, ep=${episodeNum}, title=${title}`);

        // Show loading state ON THE CLICKED EPISODE BUTTON
        const originalButtonText = buttonElement.textContent; // Store original text (number)
        buttonElement.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`; // Show spinner
        buttonElement.disabled = true;
        clearError(); // Clear general error message

        // Find the main "Select/Hide" button to potentially disable it too
        const mainSelectButton = buttonElement.closest('.yfsp-info').querySelector('.select-episode-btn');
        if(mainSelectButton) mainSelectButton.disabled = true;


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
                 // Open player with DIRECT URL (isDirectUrl = true)
                 openPlayer(data.player_url, `${title} - 第 ${episodeNum} 集`, true);
            } else {
                throw new Error(`未能从服务器获取到剧集 ${episodeNum} 的有效播放链接`);
            }

        } catch (error) {
             console.error("Error fetching/playing YFSP episode:", error);
             showError(`播放剧集 ${episodeNum} 时出错: ${error.message}`);
        } finally {
             // Restore button state for the specific episode button
             buttonElement.innerHTML = originalButtonText; // Restore episode number
             buttonElement.disabled = false;
             // Re-enable the main "Select/Hide" button
             if(mainSelectButton) mainSelectButton.disabled = false;
        }
    };


    // Open the player modal - Handles both direct URLs and links needing parsing
    const openPlayer = (urlOrLink, title, isDirectUrl = false) => {
        playerTitle.textContent = title; // Set title

        // Reset player state
        videoPlayerIframe.src = 'about:blank'; // Clear previous content immediately
        showPlayerLoading(true); // Show loading indicator inside player

        if (isDirectUrl) {
            // --- Direct URL (from YFSP after AI parsing the episode page) ---
            console.log("Opening player with direct URL:", urlOrLink);
            currentVideoLink = ''; // Clear parsing link state
            parsingSelectorContainer.style.display = 'none'; // Hide parsing selector for direct URLs
            videoPlayerIframe.src = urlOrLink; // Set iframe src directly

            // Hide player loading when iframe content starts loading (onload event)
            // Add error handling for iframe loading itself
            videoPlayerIframe.onload = () => {
                console.log("Player iframe loaded (direct URL).");
                showPlayerLoading(false);
            };
            videoPlayerIframe.onerror = () => {
                 console.error("Player iframe failed to load (direct URL):", urlOrLink);
                 showPlayerLoading(false);
                 showError("加载播放器资源时出错。请检查链接或网络。");
                 closePlayer(); // Close modal on catastrophic iframe error
            };
        } else {
            // --- Link requires parsing (from AI method search results) ---
            console.log("Opening player, needs parsing:", urlOrLink);
            if (parsingSelect.disabled) {
                 showPlayerLoading(false); // Hide loading as we can't proceed
                 showError("请先在设置中添加至少一个视频解析接口。");
                 return; // Exit if no parsers available
            }
            currentVideoLink = urlOrLink; // Store the raw video link to be parsed
            parsingSelectorContainer.style.display = ''; // Ensure parsing selector is VISIBLE

            const selectedParserUrl = parsingSelect.value;
            if (selectedParserUrl && currentVideoLink) {
                 const finalUrl = selectedParserUrl + encodeURIComponent(currentVideoLink);
                 console.log("Using parser:", selectedParserUrl, "Final URL:", finalUrl);
                 videoPlayerIframe.src = finalUrl;

                 videoPlayerIframe.onload = () => {
                     console.log("Player iframe loaded (via parsing interface).");
                     showPlayerLoading(false);
                 };
                 videoPlayerIframe.onerror = () => {
                      console.error("Player iframe failed to load (via parsing interface):", finalUrl);
                      showPlayerLoading(false);
                      showError("加载解析接口或视频时出错。尝试更换接口或检查原视频链接。");
                      // Don't close automatically, user might want to try another interface
                 };
            } else {
                 // This case should ideally not happen if parsingSelect.disabled is checked
                 showPlayerLoading(false);
                 videoPlayerIframe.src = 'about:blank';
                 showError("无法构建播放链接，请选择一个有效的解析接口。");
                 return; // Exit if link construction fails
            }
        }
        playerModal.style.display = 'block'; // Show the modal
    };


    // Close the player modal
    const closePlayer = () => {
        playerModal.style.display = 'none';
        videoPlayerIframe.src = 'about:blank'; // Stop video playback and clear iframe
        playerTitle.textContent = '正在播放...';
        currentVideoLink = ''; // Clear stored link for parsing
        showPlayerLoading(false); // Ensure player loading is hidden
        // Reset parsing selector visibility (hide it by default)
        parsingSelectorContainer.style.display = 'none';
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
        if (!selectedMethodRadio) {
             showError("请选择一个搜索方式"); // Should not happen normally
             return;
        }
        const selectedMethod = selectedMethodRadio.value;
        currentSearchMethod = selectedMethod; // Update state
        localStorage.setItem('videoSearchMethod', currentSearchMethod); // Save preference

        clearError();
        clearResults();
        showLoading(true, selectedMethod); // Pass method to loading text

        try {
            // Prepare request body including necessary settings
            const requestBody = {
                 query: query,
                 method: selectedMethod,
                 settings: { // Send essential settings for the selected method
                     // AI method needs these:
                     aiApiUrl: currentSettings.aiApiUrl,
                     aiApiKey: currentSettings.aiApiKey,
                     aiModel: currentSettings.aiModel,
                     searxngUrl: currentSettings.searxngUrl,
                     // YFSP method doesn't directly need these for search,
                     // but backend uses defaults for episode details parsing.
                 }
             };

            console.log("Sending search request to backend:", requestBody);

            const response = await fetch('/api/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json' // Indicate expected response type
                },
                body: JSON.stringify(requestBody),
            });

             console.log("Backend Response Status:", response.status);
             const responseData = await response.json(); // Always try to parse JSON first

            if (!response.ok) {
                 // Use error message from JSON response if available, otherwise construct one
                 const errorMsg = responseData?.error || `服务器返回错误 (代码: ${response.status})`;
                 console.error("Backend Error Response:", responseData);
                 throw new Error(errorMsg);
            }

            console.log("Backend Response Data:", responseData);
            // displayResults expects results to have a 'method' property which backend adds
            displayResults(responseData);

        } catch (error) {
            console.error("Search Error:", error);
            // Display the error message from the caught error
            showError(`搜索或分析时出错: ${error.message}`);
            clearResults(); // Clear results area on error
        } finally {
            showLoading(false); // Hide loading indicator regardless of success/failure
        }
    };

    // --- Helper: Escape HTML ---
    function escapeHtml(unsafe) {
        if (!unsafe) return ""; // Handle null or undefined
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }


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
            if (e.target.checked) { // Ensure it's the checked one changing state
                currentSearchMethod = e.target.value;
                localStorage.setItem('videoSearchMethod', currentSearchMethod); // Save preference immediately
                console.log("Search method changed to:", currentSearchMethod);
            }
        });
    });


    // Settings Modal Listeners
    settingsBtn.addEventListener('click', () => {
        loadSettings().then(() => { // Ensure settings are loaded before showing modal
             populateSettingsForm(); // Populate with potentially updated defaults/saved values
             renderParsingInterfacesList();
             settingsModal.style.display = 'block';
        });
    });
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });
    saveSettingsBtn.addEventListener('click', saveSettings);
    resetSettingsBtn.addEventListener('click', resetToDefaults);
    // Add listener for the "Add Interface" button in settings
    addInterfaceBtn.addEventListener('click', () => {
         addParsingInterface(true); // Call with alertSaved = true
    });

    // Player Modal Listeners
    closePlayerBtn.addEventListener('click', closePlayer);
     // Update iframe src when user changes parsing interface (only applies when parsing is active)
    parsingSelect.addEventListener('change', () => {
        // Only re-parse if:
        // 1. Player modal is visible
        // 2. There's a currentVideoLink stored (meaning it's an AI result needing parsing)
        // 3. The parsing selector is actually visible (confirming it's the right mode)
        if (playerModal.style.display === 'block' && currentVideoLink && parsingSelectorContainer.style.display !== 'none') {
             const selectedParserUrl = parsingSelect.value;
             if (selectedParserUrl) {
                  const finalUrl = selectedParserUrl + encodeURIComponent(currentVideoLink);
                  console.log("Parser changed, new URL:", finalUrl);
                  // Show loading, clear iframe, set new source
                  videoPlayerIframe.src = 'about:blank';
                  showPlayerLoading(true);
                  videoPlayerIframe.src = finalUrl;
                  // onload/onerror handlers should still be active from the initial openPlayer call
             }
        }
    });


    // Close modals if clicked outside the content area (on the backdrop)
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
