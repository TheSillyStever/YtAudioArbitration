(function initializePopup() {
  "use strict";

  const {
    DEFAULT_SETTINGS,
    KINDS,
    normalizeSettings,
    overrideStorageKey
  } = YTAA_CORE;

  const elements = {
    enabled: document.querySelector("#enabled"),
    enabledDescription: document.querySelector("#enabled-description"),
    duckRatio: document.querySelector("#duck-ratio"),
    duckRatioOutput: document.querySelector("#duck-ratio-output"),
    fadeMs: document.querySelector("#fade-ms"),
    fadeMsOutput: document.querySelector("#fade-ms-output"),
    relativeExample: document.querySelector("#relative-example"),
    badge: document.querySelector("#classification-badge"),
    title: document.querySelector("#video-title"),
    detail: document.querySelector("#classification-detail"),
    override: document.querySelector("#override"),
    saveStatus: document.querySelector("#save-status")
  };

  let settings = DEFAULT_SETTINGS;
  let activeTabId = null;
  let activeState = null;
  let statusTimer = null;

  void start();

  async function start() {
    const stored = await chrome.storage.local.get("settings");
    settings = normalizeSettings(stored.settings);
    renderSettings();
    bindControls();
    await loadActiveVideo();
  }

  function bindControls() {
    elements.enabled.addEventListener("change", async () => {
      settings = { ...settings, enabled: elements.enabled.checked };
      await saveSettings();
    });

    elements.duckRatio.addEventListener("input", () => {
      updateDuckRatioLabels(Number(elements.duckRatio.value));
    });
    elements.duckRatio.addEventListener("change", async () => {
      settings = {
        ...settings,
        duckRatio: Number(elements.duckRatio.value) / 100
      };
      await saveSettings();
    });

    elements.fadeMs.addEventListener("input", () => {
      elements.fadeMsOutput.value = `${elements.fadeMs.value} ms`;
    });
    elements.fadeMs.addEventListener("change", async () => {
      settings = { ...settings, fadeMs: Number(elements.fadeMs.value) };
      await saveSettings();
    });

    elements.override.addEventListener("change", saveOverride);
  }

  function renderSettings() {
    elements.enabled.checked = settings.enabled;
    elements.enabledDescription.textContent = settings.enabled
      ? "Enabled for YouTube tabs"
      : "Off until you enable it";
    elements.duckRatio.value = String(Math.round(settings.duckRatio * 100));
    elements.fadeMs.value = String(settings.fadeMs);
    elements.fadeMsOutput.value = `${settings.fadeMs} ms`;
    updateDuckRatioLabels(Math.round(settings.duckRatio * 100));
  }

  function updateDuckRatioLabels(percent) {
    elements.duckRatioOutput.value = `${percent}%`;
    const example = Math.round(30 * (percent / 100) * 10) / 10;
    elements.relativeExample.textContent =
      `30% becomes ${example}%, then returns to 30%.`;
  }

  async function saveSettings() {
    settings = normalizeSettings(settings);
    await chrome.storage.local.set({ settings });
    renderSettings();
    showSaved("Settings saved");
  }

  async function loadActiveVideo() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    activeTabId = activeTab?.id || null;
    if (!activeTabId || !activeTab.url?.startsWith("https://www.youtube.com/")) {
      renderNoVideo("Open a YouTube video to classify it.");
      return;
    }

    try {
      activeState = await chrome.tabs.sendMessage(activeTabId, { type: "GET_STATE" });
    } catch (_error) {
      renderNoVideo("Reload this YouTube tab after loading the extension.");
      return;
    }

    if (!activeState?.videoId) {
      renderNoVideo("Open a YouTube watch page or Short.");
      return;
    }

    const key = overrideStorageKey(activeState.videoId);
    const stored = await chrome.storage.local.get(key);
    elements.override.value = stored[key] || "auto";
    elements.override.disabled = false;
    renderClassification();
  }

  function renderClassification() {
    const effectiveKind = activeState.effectiveKind;
    const detectedKind = activeState.detectedKind;
    elements.title.textContent = activeState.title || activeState.videoId;
    elements.badge.className = "badge";

    if (effectiveKind === KINDS.MUSIC) {
      elements.badge.textContent = activeState.ducked ? "Music · ducked" : "Music";
      elements.badge.classList.add("music");
    } else {
      elements.badge.textContent = detectedKind === KINDS.UNKNOWN
        ? "Unknown → non-music"
        : "Non-music";
      elements.badge.classList.add("non-music");
    }

    const sourceLabels = {
      "manual-override": "Manual override",
      "music-video-type": "YouTube music-video type",
      "youtube-category": "YouTube category",
      "music-note-badge": "YouTube music-note badge",
      "unknown-default": "No category exposed; using the non-music fallback"
    };
    const source = sourceLabels[activeState.classificationSource] || "Awaiting metadata";
    const baseline = Number.isFinite(activeState.baseVolume)
      ? activeState.baseVolume
      : activeState.volume;
    const target = baseline * settings.duckRatio;
    elements.detail.textContent = effectiveKind === KINDS.MUSIC
      ? `${source}. ${percent(baseline)} → ${percent(target)} while ducked.`
      : source;
  }

  async function saveOverride() {
    if (!activeState?.videoId) {
      return;
    }
    const key = overrideStorageKey(activeState.videoId);
    if (elements.override.value === "auto") {
      await chrome.storage.local.remove(key);
    } else {
      await chrome.storage.local.set({ [key]: elements.override.value });
    }
    showSaved("Classification saved");
    setTimeout(loadActiveVideo, 120);
  }

  function renderNoVideo(message) {
    activeState = null;
    elements.title.textContent = message;
    elements.detail.textContent = "";
    elements.badge.textContent = "No video";
    elements.badge.className = "badge neutral";
    elements.override.value = "auto";
    elements.override.disabled = true;
  }

  function showSaved(message) {
    elements.saveStatus.textContent = message;
    if (statusTimer !== null) {
      clearTimeout(statusTimer);
    }
    statusTimer = setTimeout(() => {
      elements.saveStatus.textContent = "";
    }, 1400);
  }

  function percent(value) {
    return `${Math.round(Number(value) * 1000) / 10}%`;
  }
}());
