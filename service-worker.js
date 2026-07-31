"use strict";

importScripts("core.js");

const {
  DEFAULT_SETTINGS,
  classifySignals,
  computeDuckPlan,
  normalizeSettings,
  overrideStorageKey
} = YTAA_CORE;

const YOUTUBE_URLS = ["https://www.youtube.com/*"];
const SESSION_BASELINE_KEY = "lastUserMusicVolume";

let recomputeTimer = null;
let requestedGeneration = 0;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get("settings");
  if (!stored.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "CLASSIFY_CURRENT") {
    classifyCurrentTab(sender)
      .then((classification) => sendResponse({ ok: true, classification }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "STATE_DIRTY") {
    scheduleRecompute();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "BASELINE_OBSERVED") {
    storeBaseline(message.volume)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener(() => scheduleRecompute());

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  const isYouTubeTab = typeof tab.url === "string" &&
    tab.url.startsWith("https://www.youtube.com/");
  const changedToYouTube = typeof changeInfo.url === "string" &&
    changeInfo.url.startsWith("https://www.youtube.com/");
  if (
    changedToYouTube ||
    (isYouTubeTab && changeInfo.status === "complete")
  ) {
    scheduleRecompute();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && Object.keys(changes).length > 0) {
    scheduleRecompute();
  }
});

async function classifyCurrentTab(sender) {
  const tabId = sender.tab && sender.tab.id;
  if (!Number.isInteger(tabId)) {
    throw new Error("Classification requires a YouTube tab.");
  }

  const injection = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: "MAIN",
    func: probeYouTubePlayer
  });
  const signals = injection[0] && injection[0].result
    ? injection[0].result
    : {};

  if (!signals.videoId && sender.tab.url) {
    signals.videoId = videoIdFromUrl(sender.tab.url);
  }

  const settingsResult = await chrome.storage.local.get("settings");
  const settings = normalizeSettings(settingsResult.settings);
  let override = null;

  if (signals.videoId) {
    const key = overrideStorageKey(signals.videoId);
    const storedOverride = await chrome.storage.local.get(key);
    override = storedOverride[key] || null;
  }

  return classifySignals({
    ...signals,
    override,
    unknownPolicy: settings.unknownPolicy
  });
}

function probeYouTubePlayer() {
  const player = document.querySelector("#movie_player");
  let response = null;

  try {
    response = player && typeof player.getPlayerResponse === "function"
      ? player.getPlayerResponse()
      : null;
  } catch (_error) {
    response = null;
  }

  if (!response && window.ytInitialPlayerResponse) {
    response = window.ytInitialPlayerResponse;
  }

  const currentUrl = new URL(location.href);
  const videoId = response?.videoDetails?.videoId || currentUrl.searchParams.get("v");
  const musicPath12 = "M5.5 1.383V6.88a2.25 2.25 0 101 1.871V4.6l2.743 1.647a.5.5 0 00.757-.43V3.485a.5.5 0 00-.243-.429l-3.5-2.1a.5.5 0 00-.757.427Z";
  const musicPath24 = "M11 2.766v10.99a4.5 4.5 0 101.994 3.976L13 17.5V9.2l5.485 3.292A1 1 0 0020 11.634V6.966a1 1 0 00-.485-.857l-7-4.2A1 1 0 0011 2.766Zm2 4.102V4.533l5 3v2.335l-5-3ZM8.5 15a2.5 2.5 0 110 5.001A2.5 2.5 0 018.5 15Z";
  let noteBadge = false;

  if (videoId) {
    const links = document.querySelectorAll(`a[href*="watch?v=${videoId}"]`);
    for (const link of links) {
      const card = link.closest(
        "ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer"
      );
      const path = card?.querySelector(
        "ytd-thumbnail-overlay-time-status-renderer svg path"
      )?.getAttribute("d");
      if (path === musicPath12 || path === musicPath24) {
        noteBadge = true;
        break;
      }
    }
  }

  return {
    videoId: videoId || null,
    title: response?.videoDetails?.title || document.title.replace(/ - YouTube$/, ""),
    category: response?.microformat?.playerMicroformatRenderer?.category || null,
    musicVideoType: response?.videoDetails?.musicVideoType || null,
    noteBadge
  };
}

function videoIdFromUrl(url) {
  try {
    return new URL(url).searchParams.get("v");
  } catch (_error) {
    return null;
  }
}

async function storeBaseline(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new Error("Invalid baseline volume.");
  }
  await chrome.storage.session.set({ [SESSION_BASELINE_KEY]: volume });
}

function scheduleRecompute() {
  requestedGeneration += 1;
  const generation = requestedGeneration;
  if (recomputeTimer !== null) {
    clearTimeout(recomputeTimer);
  }
  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    recomputeAllTabs(generation).catch(() => {});
  }, 60);
}

async function recomputeAllTabs(generation) {
  const [tabs, settingsResult, sessionResult] = await Promise.all([
    chrome.tabs.query({ url: YOUTUBE_URLS }),
    chrome.storage.local.get("settings"),
    chrome.storage.session.get(SESSION_BASELINE_KEY)
  ]);

  const settings = normalizeSettings(settingsResult.settings);
  const stateResults = await Promise.all(tabs.map(async (tab) => {
    try {
      const state = await chrome.tabs.sendMessage(tab.id, { type: "GET_STATE" });
      return state ? { ...state, tabId: tab.id } : null;
    } catch (_error) {
      return null;
    }
  }));

  if (generation !== requestedGeneration) {
    return;
  }

  const states = stateResults.filter(Boolean);
  const plan = computeDuckPlan(states, settings.enabled);
  const baselineHint = Number.isFinite(sessionResult[SESSION_BASELINE_KEY])
    ? sessionResult[SESSION_BASELINE_KEY]
    : null;

  await Promise.all(plan.decisions.map(async (decision) => {
    try {
      await chrome.tabs.sendMessage(decision.tabId, {
        type: "SET_DUCKED",
        ducked: decision.ducked,
        duckRatio: settings.duckRatio,
        fadeMs: settings.fadeMs,
        baselineHint: decision.ducked ? baselineHint : null
      });
    } catch (_error) {
      // The tab may have navigated or closed after the state snapshot.
    }
  }));
}
