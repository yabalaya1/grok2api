(() => {
  const generateBtn = document.getElementById('generateBtn');
  const stopBtn = document.getElementById('stopBtn');
  const promptInput = document.getElementById('promptInput');
  const ratioSelect = document.getElementById('ratioSelect');
  const lengthSelect = document.getElementById('lengthSelect');
  const resolutionSelect = document.getElementById('resolutionSelect');
  const presetSelect = document.getElementById('presetSelect');
  const streamToggle = document.getElementById('streamToggle');
  const statusText = document.getElementById('statusText');
  const statusRatio = document.getElementById('statusRatio');
  const statusLength = document.getElementById('statusLength');
  const statusResolution = document.getElementById('statusResolution');
  const statusPreset = document.getElementById('statusPreset');
  const videoEmpty = document.getElementById('videoEmpty');
  const videoProgress = document.getElementById('videoProgress');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const videoPlayer = document.getElementById('videoPlayer');
  const videoElement = document.getElementById('videoElement');
  const videoHtmlContainer = document.getElementById('videoHtmlContainer');
  const videoMeta = document.getElementById('videoMeta');
  const metaPrompt = document.getElementById('metaPrompt');
  const metaElapsed = document.getElementById('metaElapsed');
  const historyEmpty = document.getElementById('historyEmpty');
  const historyList = document.getElementById('historyList');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  const HISTORY_KEY = 'grok2api_video_history';
  const MAX_HISTORY = 20;

  let isGenerating = false;
  let abortController = null;
  let generateStartTime = 0;

  function toast(message, type) {
    if (typeof showToast === 'function') {
      showToast(message, type);
    }
  }

  function setStatus(state, text) {
    if (!statusText) return;
    statusText.textContent = text;
    statusText.classList.remove('connected', 'connecting', 'error');
    if (state) statusText.classList.add(state);
  }

  function setButtons(generating) {
    if (!generateBtn || !stopBtn) return;
    if (generating) {
      generateBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
    } else {
      generateBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
      generateBtn.disabled = false;
    }
  }

  function updateStatusPanel() {
    if (statusRatio) statusRatio.textContent = ratioSelect ? ratioSelect.value : '-';
    if (statusLength) statusLength.textContent = lengthSelect ? lengthSelect.value + 's' : '-';
    if (statusResolution) statusResolution.textContent = resolutionSelect ? resolutionSelect.value : '-';
    if (statusPreset) statusPreset.textContent = presetSelect ? presetSelect.value : '-';
  }

  function showEmpty() {
    if (videoEmpty) videoEmpty.classList.remove('hidden');
    if (videoProgress) videoProgress.classList.add('hidden');
    if (videoPlayer) videoPlayer.classList.add('hidden');
    if (videoHtmlContainer) videoHtmlContainer.classList.add('hidden');
    if (videoMeta) videoMeta.classList.add('hidden');
  }

  function showProgress(text) {
    if (videoEmpty) videoEmpty.classList.add('hidden');
    if (videoPlayer) videoPlayer.classList.add('hidden');
    if (videoHtmlContainer) videoHtmlContainer.classList.add('hidden');
    if (videoMeta) videoMeta.classList.add('hidden');
    if (videoProgress) videoProgress.classList.remove('hidden');
    if (progressFill) {
      progressFill.style.width = '0%';
      progressFill.classList.add('indeterminate');
    }
    if (progressText) progressText.textContent = text || '准备中...';
  }

  function updateProgress(text) {
    if (progressText) progressText.textContent = text;
  }

  function sanitizeVideoHtml(html) {
    // 仅允许 video/source 标签及安全属性，防止 XSS
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const videos = doc.querySelectorAll('video');
    if (videos.length === 0) return null;

    const container = document.createDocumentFragment();
    videos.forEach(srcVideo => {
      const video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.style.width = '100%';
      video.style.borderRadius = '8px';

      // 复制安全属性
      if (srcVideo.getAttribute('poster')) {
        video.poster = srcVideo.getAttribute('poster');
      }
      if (srcVideo.getAttribute('src')) {
        video.src = srcVideo.getAttribute('src');
      }

      // 复制 source 子元素
      srcVideo.querySelectorAll('source').forEach(srcSource => {
        const source = document.createElement('source');
        if (srcSource.getAttribute('src')) source.src = srcSource.getAttribute('src');
        if (srcSource.getAttribute('type')) source.type = srcSource.getAttribute('type');
        video.appendChild(source);
      });

      container.appendChild(video);
    });
    return container;
  }

  function showVideo(url, isHtml) {
    if (videoEmpty) videoEmpty.classList.add('hidden');
    if (videoProgress) videoProgress.classList.add('hidden');

    if (isHtml) {
      if (videoPlayer) videoPlayer.classList.add('hidden');
      if (videoHtmlContainer) {
        videoHtmlContainer.innerHTML = '';
        const safeContent = sanitizeVideoHtml(url);
        if (safeContent) {
          videoHtmlContainer.appendChild(safeContent);
        } else {
          // 无法解析出 video 标签，尝试提取 URL
          const urlMatch = url.match(/https?:\/\/[^\s"'<>]+/i);
          if (urlMatch) {
            showVideo(urlMatch[0], false);
            return;
          }
          videoHtmlContainer.textContent = '无法解析视频内容';
        }
        videoHtmlContainer.classList.remove('hidden');
      }
    } else {
      if (videoHtmlContainer) videoHtmlContainer.classList.add('hidden');
      if (videoPlayer) videoPlayer.classList.remove('hidden');
      if (videoElement) {
        videoElement.src = url;
        videoElement.load();
      }
    }
  }

  function showMeta(prompt, elapsed) {
    if (videoMeta) videoMeta.classList.remove('hidden');
    if (metaPrompt) metaPrompt.textContent = prompt;
    if (metaElapsed) metaElapsed.textContent = elapsed ? elapsed + 'ms' : '';
  }

  // --- History ---
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      // 限制每条记录的 content 大小，避免 localStorage 溢出
      const trimmed = history.slice(0, MAX_HISTORY).map(item => {
        const copy = { ...item };
        if (copy.content && copy.content.length > 2000) {
          // 对于过长的 HTML 内容，仅保留 URL
          const urlMatch = copy.content.match(/https?:\/\/[^\s"'<>]+/i);
          if (urlMatch) {
            copy.content = urlMatch[0];
            copy.type = 'url';
          } else {
            copy.content = copy.content.substring(0, 2000);
          }
        }
        return copy;
      });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    } catch (e) {
      // 存储满时清理最旧的记录
      try {
        const reduced = history.slice(0, Math.floor(MAX_HISTORY / 2));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(reduced));
      } catch (e2) {
        // ignore
      }
    }
  }

  function addToHistory(item) {
    const history = loadHistory();
    history.unshift(item);
    saveHistory(history);
    renderHistory();
  }

  function clearHistory() {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch (e) {
      // ignore
    }
    renderHistory();
    toast('历史记录已清空', 'success');
  }

  function renderHistory() {
    const history = loadHistory();
    if (!historyList) return;
    historyList.innerHTML = '';

    if (history.length === 0) {
      if (historyEmpty) historyEmpty.style.display = '';
      return;
    }
    if (historyEmpty) historyEmpty.style.display = 'none';

    history.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = 'video-history-item';
      el.dataset.index = index;

      const icon = document.createElement('div');
      icon.className = 'video-history-icon';
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

      const info = document.createElement('div');
      info.className = 'video-history-info';

      const promptEl = document.createElement('div');
      promptEl.className = 'video-history-prompt';
      promptEl.textContent = item.prompt || '(无提示词)';

      const timeEl = document.createElement('div');
      timeEl.className = 'video-history-time';
      const date = new Date(item.timestamp);
      timeEl.textContent = date.toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
      if (item.elapsed) {
        timeEl.textContent += ' · ' + item.elapsed + 'ms';
      }

      info.appendChild(promptEl);
      info.appendChild(timeEl);
      el.appendChild(icon);
      el.appendChild(info);

      el.addEventListener('click', () => {
        const isHtml = item.type === 'html';
        showVideo(item.content, isHtml);
        showMeta(item.prompt, item.elapsed);

        historyList.querySelectorAll('.video-history-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
      });

      historyList.appendChild(el);
    });
  }

  // --- API ---
  async function generateVideo() {
    const prompt = promptInput ? promptInput.value.trim() : '';
    if (!prompt) {
      toast('请输入提示词', 'error');
      return;
    }

    const apiKey = await ensureApiKey();
    if (apiKey === null) {
      toast('请先登录后台', 'error');
      return;
    }

    if (isGenerating) {
      toast('正在生成中', 'warning');
      return;
    }

    isGenerating = true;
    generateStartTime = Date.now();
    abortController = new AbortController();

    const stream = streamToggle ? streamToggle.checked : true;
    const videoConfig = {
      aspect_ratio: ratioSelect ? ratioSelect.value : '3:2',
      video_length: lengthSelect ? parseInt(lengthSelect.value, 10) : 6,
      resolution_name: resolutionSelect ? resolutionSelect.value : '480p',
      preset: presetSelect ? presetSelect.value : 'custom'
    };

    updateStatusPanel();
    setStatus('connecting', '连接中...');
    setButtons(true);
    showProgress('正在连接服务...');

    const body = {
      model: 'grok-imagine-1.0-video',
      messages: [{ role: 'user', content: prompt }],
      stream: stream,
      video_config: videoConfig
    };

    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(apiKey),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: abortController.signal
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      setStatus('connected', '生成中...');
      updateProgress('视频生成中，请耐心等待...');

      if (stream) {
        await handleStreamResponse(res, prompt);
      } else {
        await handleNonStreamResponse(res, prompt);
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        setStatus('', '已停止');
        showEmpty();
        toast('已停止生成', 'info');
      } else {
        setStatus('error', '生成失败');
        updateProgress('生成失败: ' + e.message);
        toast('生成失败: ' + e.message, 'error');
      }
    } finally {
      isGenerating = false;
      abortController = null;
      setButtons(false);
    }
  }

  async function handleStreamResponse(res, prompt) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
          if (delta && delta.content) {
            fullContent += delta.content;
            updateProgress('视频生成中...');
          }
        } catch (e) {
          // ignore parse errors
        }
      }
    }

    handleVideoResult(fullContent, prompt);
  }

  async function handleNonStreamResponse(res, prompt) {
    const data = await res.json();
    let content = '';
    if (data.choices && data.choices[0]) {
      const msg = data.choices[0].message;
      if (msg && msg.content) {
        content = msg.content;
      }
    }
    handleVideoResult(content, prompt);
  }

  function handleVideoResult(content, prompt) {
    const elapsed = Date.now() - generateStartTime;

    if (!content) {
      setStatus('error', '无结果');
      updateProgress('未获取到视频内容');
      toast('未获取到视频内容', 'error');
      return;
    }

    const isHtml = content.trim().startsWith('<');
    const isUrl = /^https?:\/\//.test(content.trim());

    if (isHtml) {
      showVideo(content, true);
    } else if (isUrl) {
      showVideo(content.trim(), false);
    } else {
      // Try to extract URL from content
      const urlMatch = content.match(/https?:\/\/[^\s"'<>]+\.(mp4|webm|mov)[^\s"'<>]*/i);
      if (urlMatch) {
        showVideo(urlMatch[0], false);
      } else {
        // Treat as HTML content
        showVideo(content, true);
      }
    }

    showMeta(prompt, elapsed);
    setStatus('connected', '生成完成');
    toast('视频生成完成', 'success');

    addToHistory({
      prompt: prompt,
      content: content,
      type: isHtml ? 'html' : 'url',
      timestamp: Date.now(),
      elapsed: elapsed,
      params: {
        aspect_ratio: ratioSelect ? ratioSelect.value : '3:2',
        video_length: lengthSelect ? lengthSelect.value : '6',
        resolution_name: resolutionSelect ? resolutionSelect.value : '480p',
        preset: presetSelect ? presetSelect.value : 'custom'
      }
    });
  }

  function stopGeneration() {
    if (abortController) {
      abortController.abort();
    }
  }

  // --- Event Listeners ---
  if (generateBtn) {
    generateBtn.addEventListener('click', () => generateVideo());
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => stopGeneration());
  }

  if (promptInput) {
    promptInput.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        generateVideo();
      }
    });
  }

  // Update status panel when selects change
  [ratioSelect, lengthSelect, resolutionSelect, presetSelect].forEach(sel => {
    if (sel) {
      sel.addEventListener('change', updateStatusPanel);
    }
  });

  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', clearHistory);
  }

  // Init
  updateStatusPanel();
  renderHistory();
})();
