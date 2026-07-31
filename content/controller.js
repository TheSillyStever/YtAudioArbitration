(function initializeController() {
  "use strict";

  const {
    DEFAULT_SETTINGS,
    KINDS,
    clamp,
    interpolateVolume,
    normalizeSettings,
    overrideStorageKey
  } = YTAA_CORE;

  let settings = DEFAULT_SETTINGS;
  let classification = unknownClassification();
  let video = null;
  let detachVideoListeners = null;
  let fadeTimer = null;
  let fadeToken = 0;
  let baseVolume = null;
  let duckRequested = false;
  let activeDuckRatio = DEFAULT_SETTINGS.duckRatio;
  let activeFadeMs = DEFAULT_SETTINGS.fadeMs;
  let lastProgrammaticVolume = null;
  let programmaticUntil = 0;
  let observedVolume = null;
  let classifyGeneration = 0;
  let refreshTimer = null;
  let rebindObserver = null;
  let stateDirtyTimer = null;

  void start();

  async function start() {
    const stored = await chrome.storage.local.get("settings");
    settings = normalizeSettings(stored.settings);
    bindDocumentEvents();
    bindRuntimeEvents();
    rebindVideo();
    scheduleClassification(0);
    markStateDirty();
  }

  function bindDocumentEvents() {
    document.addEventListener("yt-navigate-finish", handleYouTubeNavigation, true);
    document.addEventListener("yt-player-updated", handlePlayerUpdated, true);
    window.addEventListener("pagehide", handlePageHide, { capture: true });
    window.addEventListener("pageshow", handlePageShow, { capture: true });
  }

  function bindRuntimeEvents() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== "string") {
        return false;
      }

      if (message.type === "GET_STATE") {
        sendResponse(currentState());
        return false;
      }

      if (message.type === "SET_DUCKED") {
        activeDuckRatio = clamp(Number(message.duckRatio), 0, 1);
        activeFadeMs = clamp(Number(message.fadeMs), 100, 3000);
        const shouldDuck = Boolean(
          message.ducked &&
          settings.enabled &&
          classification.effectiveKind === KINDS.MUSIC
        );
        applyDuckState(shouldDuck, message.baselineHint);
        sendResponse({ ok: true });
        return false;
      }

      return false;
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      if (changes.settings) {
        settings = normalizeSettings(changes.settings.newValue);
        if (!settings.enabled) {
          applyDuckState(false, null);
        }
        markStateDirty();
      }

      const videoId = classification.videoId || currentUrlVideoId();
      if (videoId && changes[overrideStorageKey(videoId)]) {
        scheduleClassification(0);
      }
    });
  }

  function handleYouTubeNavigation() {
    classification = unknownClassification(currentUrlVideoId());
    rebindVideo();
    scheduleClassification(0);
    markStateDirty();
  }

  function handlePlayerUpdated() {
    rebindVideo();
    scheduleClassification(80);
  }

  function rebindVideo() {
    const nextVideo = document.querySelector("video.html5-main-video") ||
      document.querySelector("#movie_player video");

    if (nextVideo === video) {
      return;
    }

    if (detachVideoListeners) {
      detachVideoListeners();
      detachVideoListeners = null;
    }

    if (video && baseVolume !== null) {
      setVolumeDirect(video, baseVolume);
    }

    video = nextVideo || null;
    if (!video) {
      observedVolume = null;
      observeBrieflyForVideo();
      return;
    }

    stopRebindObserver();
    observedVolume = video.volume;
    const onPlaybackState = () => markStateDirty();
    const onVolumeChange = handleVolumeChange;
    video.addEventListener("play", onPlaybackState);
    video.addEventListener("pause", onPlaybackState);
    video.addEventListener("ended", onPlaybackState);
    video.addEventListener("volumechange", onVolumeChange);
    detachVideoListeners = () => {
      video?.removeEventListener("play", onPlaybackState);
      video?.removeEventListener("pause", onPlaybackState);
      video?.removeEventListener("ended", onPlaybackState);
      video?.removeEventListener("volumechange", onVolumeChange);
    };

    if (duckRequested && classification.effectiveKind === KINDS.MUSIC) {
      fadeTo(relativeTarget(), activeFadeMs);
    }
    markStateDirty();
  }

  function observeBrieflyForVideo() {
    if (rebindObserver || !document.body) {
      return;
    }
    rebindObserver = new MutationObserver(() => {
      if (document.querySelector("video.html5-main-video, #movie_player video")) {
        stopRebindObserver();
        rebindVideo();
      }
    });
    rebindObserver.observe(document.body, { childList: true, subtree: true });
    setTimeout(stopRebindObserver, 2500);
  }

  function stopRebindObserver() {
    if (rebindObserver) {
      rebindObserver.disconnect();
      rebindObserver = null;
    }
  }

  function handleVolumeChange() {
    if (!video) {
      return;
    }

    const isProgrammatic =
      performance.now() <= programmaticUntil &&
      lastProgrammaticVolume !== null &&
      Math.abs(video.volume - lastProgrammaticVolume) < 0.002;
    const volumeChanged = observedVolume === null ||
      Math.abs(video.volume - observedVolume) >= 0.002;
    observedVolume = video.volume;
    if (isProgrammatic) {
      return;
    }

    if (!volumeChanged) {
      markStateDirty();
      return;
    }

    if (classification.effectiveKind === KINDS.MUSIC) {
      clearFade();
      if (duckRequested) {
        baseVolume = video.volume;
        reportBaseline(baseVolume);
        fadeTo(relativeTarget(), activeFadeMs);
      } else {
        baseVolume = null;
        reportBaseline(video.volume);
      }
    }
    markStateDirty();
  }

  function applyDuckState(shouldDuck, baselineHint) {
    duckRequested = shouldDuck;
    if (!video) {
      return;
    }

    if (shouldDuck) {
      if (baseVolume === null) {
        const hint = Number(baselineHint);
        const validHint = Number.isFinite(hint) && hint >= 0 && hint <= 1;
        const inheritedDuckTarget = validHint ? hint * activeDuckRatio : null;
        const looksAlreadyDucked = validHint &&
          Math.abs(video.volume - inheritedDuckTarget) < 0.015;
        baseVolume = looksAlreadyDucked ? hint : video.volume;
        reportBaseline(baseVolume);
      }
      fadeTo(relativeTarget(), activeFadeMs);
      return;
    }

    if (baseVolume !== null) {
      const restoreTarget = baseVolume;
      fadeTo(restoreTarget, activeFadeMs, () => {
        if (!duckRequested && baseVolume === restoreTarget) {
          baseVolume = null;
          reportBaseline(restoreTarget);
        }
      });
    }
  }

  function relativeTarget() {
    const baseline = baseVolume === null ? (video?.volume || 0) : baseVolume;
    return clamp(baseline * activeDuckRatio, 0, 1);
  }

  function fadeTo(target, duration, onComplete) {
    clearFade();
    if (!video) {
      return;
    }

    const controlledVideo = video;
    const startVolume = controlledVideo.volume;
    const safeTarget = clamp(Number(target), 0, 1);
    const safeDuration = clamp(Number(duration), 100, 3000);
    const startedAt = performance.now();
    const token = ++fadeToken;

    if (Math.abs(startVolume - safeTarget) < 0.001) {
      setVolumeDirect(controlledVideo, safeTarget);
      onComplete?.();
      return;
    }

    fadeTimer = setInterval(() => {
      if (token !== fadeToken || controlledVideo !== video) {
        clearFade();
        return;
      }
      const progress = (performance.now() - startedAt) / safeDuration;
      setVolumeDirect(
        controlledVideo,
        interpolateVolume(startVolume, safeTarget, progress)
      );
      if (progress >= 1) {
        clearFade();
        setVolumeDirect(controlledVideo, safeTarget);
        onComplete?.();
      }
    }, 50);
  }

  function clearFade() {
    fadeToken += 1;
    if (fadeTimer !== null) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }

  function setVolumeDirect(targetVideo, value) {
    const safeVolume = clamp(Number(value), 0, 1);
    lastProgrammaticVolume = safeVolume;
    programmaticUntil = performance.now() + 250;
    if (targetVideo === video) {
      observedVolume = safeVolume;
    }
    targetVideo.volume = safeVolume;
  }

  function restoreImmediately() {
    clearFade();
    duckRequested = false;
    if (video && baseVolume !== null) {
      setVolumeDirect(video, baseVolume);
      baseVolume = null;
    }
  }

  function handlePageHide() {
    restoreImmediately();
    chrome.runtime.sendMessage({ type: "STATE_DIRTY" }).catch(() => {});
  }

  function handlePageShow() {
    rebindVideo();
    scheduleClassification(0);
    markStateDirty();
  }

  function scheduleClassification(delay) {
    classifyGeneration += 1;
    const generation = classifyGeneration;
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      requestClassification(generation, 0);
    }, delay);
  }

  async function requestClassification(generation, attempt) {
    try {
      const response = await chrome.runtime.sendMessage({ type: "CLASSIFY_CURRENT" });
      if (generation !== classifyGeneration) {
        return;
      }

      const result = response?.ok ? response.classification : null;
      const urlVideoId = currentUrlVideoId();
      if (result && (!urlVideoId || !result.videoId || result.videoId === urlVideoId)) {
        const wasMusic = classification.effectiveKind === KINDS.MUSIC;
        classification = result;
        if (wasMusic && classification.effectiveKind !== KINDS.MUSIC) {
          applyDuckState(false, null);
        }
        markStateDirty();
        return;
      }
    } catch (_error) {
      // The extension may have been reloaded while this page stayed open.
    }

    const retryDelays = [250, 750, 1500];
    if (generation === classifyGeneration && attempt < retryDelays.length) {
      setTimeout(
        () => requestClassification(generation, attempt + 1),
        retryDelays[attempt]
      );
    }
  }

  function currentState() {
    const activeVideo = video;
    return {
      videoId: classification.videoId || currentUrlVideoId(),
      title: classification.title || document.title.replace(/ - YouTube$/, ""),
      detectedKind: classification.detectedKind,
      effectiveKind: classification.effectiveKind,
      classificationSource: classification.source,
      playing: Boolean(activeVideo && !activeVideo.paused && !activeVideo.ended),
      muted: Boolean(activeVideo?.muted),
      volume: activeVideo ? activeVideo.volume : 0,
      baseVolume,
      ducked: duckRequested && baseVolume !== null
    };
  }

  function currentUrlVideoId() {
    const url = new URL(location.href);
    if (url.pathname === "/watch") {
      return url.searchParams.get("v");
    }
    const shortsMatch = url.pathname.match(/^\/shorts\/([^/?]+)/);
    return shortsMatch ? shortsMatch[1] : null;
  }

  function unknownClassification(videoId = currentUrlVideoId()) {
    return {
      videoId,
      title: document.title.replace(/ - YouTube$/, ""),
      detectedKind: KINDS.UNKNOWN,
      effectiveKind: KINDS.NON_MUSIC,
      source: "unknown-default"
    };
  }

  function markStateDirty() {
    if (stateDirtyTimer !== null) {
      clearTimeout(stateDirtyTimer);
    }
    stateDirtyTimer = setTimeout(() => {
      stateDirtyTimer = null;
      chrome.runtime.sendMessage({ type: "STATE_DIRTY" }).catch(() => {});
    }, 30);
  }

  function reportBaseline(volume) {
    chrome.runtime.sendMessage({
      type: "BASELINE_OBSERVED",
      volume
    }).catch(() => {});
  }
}());
