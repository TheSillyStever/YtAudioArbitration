(function initializeCore(root) {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    duckRatio: 0.2,
    fadeMs: 600,
    unknownPolicy: "nonMusic"
  });

  const KINDS = Object.freeze({
    MUSIC: "music",
    NON_MUSIC: "nonMusic",
    UNKNOWN: "unknown"
  });

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function normalizeSettings(candidate) {
    const source = candidate && typeof candidate === "object" ? candidate : {};
    return {
      enabled: typeof source.enabled === "boolean"
        ? source.enabled
        : DEFAULT_SETTINGS.enabled,
      duckRatio: Number.isFinite(source.duckRatio)
        ? clamp(source.duckRatio, 0, 1)
        : DEFAULT_SETTINGS.duckRatio,
      fadeMs: Number.isFinite(source.fadeMs)
        ? Math.round(clamp(source.fadeMs, 100, 3000))
        : DEFAULT_SETTINGS.fadeMs,
      unknownPolicy: source.unknownPolicy === "inactive"
        ? "inactive"
        : DEFAULT_SETTINGS.unknownPolicy
    };
  }

  function overrideStorageKey(videoId) {
    return `override:${videoId}`;
  }

  function normalizeOverride(value) {
    return value === KINDS.MUSIC || value === KINDS.NON_MUSIC ? value : null;
  }

  function classifySignals(signals) {
    const source = signals && typeof signals === "object" ? signals : {};
    const override = normalizeOverride(source.override);
    let detectedKind = KINDS.UNKNOWN;
    let effectiveKind = KINDS.NON_MUSIC;
    let reason = "unknown-default";

    if (override) {
      detectedKind = override;
      effectiveKind = override;
      reason = "manual-override";
    } else if (
      typeof source.musicVideoType === "string" &&
      source.musicVideoType.startsWith("MUSIC_VIDEO_TYPE_") &&
      !source.musicVideoType.endsWith("UNKNOWN")
    ) {
      detectedKind = KINDS.MUSIC;
      effectiveKind = KINDS.MUSIC;
      reason = "music-video-type";
    } else if (
      typeof source.category === "string" &&
      source.category.trim().toLowerCase() === "music"
    ) {
      detectedKind = KINDS.MUSIC;
      effectiveKind = KINDS.MUSIC;
      reason = "youtube-category";
    } else if (source.noteBadge === true) {
      detectedKind = KINDS.MUSIC;
      effectiveKind = KINDS.MUSIC;
      reason = "music-note-badge";
    } else if (typeof source.category === "string" && source.category.trim()) {
      detectedKind = KINDS.NON_MUSIC;
      effectiveKind = KINDS.NON_MUSIC;
      reason = "youtube-category";
    } else if (source.unknownPolicy === "inactive") {
      effectiveKind = KINDS.UNKNOWN;
      reason = "unknown-inactive";
    }

    return {
      videoId: typeof source.videoId === "string" ? source.videoId : null,
      title: typeof source.title === "string" ? source.title : "",
      detectedKind,
      effectiveKind,
      source: reason
    };
  }

  function isAudibleNonMusic(state) {
    return Boolean(
      state &&
      state.effectiveKind === KINDS.NON_MUSIC &&
      state.playing === true &&
      state.muted !== true &&
      Number(state.volume) > 0
    );
  }

  function computeDuckPlan(states, enabled) {
    const safeStates = Array.isArray(states) ? states : [];
    const triggerActive = Boolean(enabled) && safeStates.some(isAudibleNonMusic);
    return {
      triggerActive,
      decisions: safeStates.map((state) => ({
        tabId: state.tabId,
        ducked: Boolean(triggerActive && state.effectiveKind === KINDS.MUSIC)
      }))
    };
  }

  function smoothstep(progress) {
    const value = clamp(Number(progress) || 0, 0, 1);
    return value * value * (3 - (2 * value));
  }

  function interpolateVolume(start, target, progress) {
    const eased = smoothstep(progress);
    return clamp(start + ((target - start) * eased), 0, 1);
  }

  const api = Object.freeze({
    DEFAULT_SETTINGS,
    KINDS,
    clamp,
    normalizeSettings,
    overrideStorageKey,
    normalizeOverride,
    classifySignals,
    isAudibleNonMusic,
    computeDuckPlan,
    smoothstep,
    interpolateVolume
  });

  root.YTAA_CORE = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
}(globalThis));
