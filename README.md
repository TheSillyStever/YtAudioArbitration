# YouTube Audio Arbiter

An unpacked Manifest V3 Chromium extension that lowers music videos relative to
their current user volume while another audible, non-music YouTube video plays.

If a music tab is at 30% and the duck level is 20%, it fades to 6%. When the
non-music video pauses, mutes, reaches zero volume, closes, or navigates away,
the music tab returns to exactly 30%.

## Load the unpacked extension

1. Open `chrome://extensions` in Chrome, Edge, Brave, or another compatible
   Chromium browser.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Pin **YouTube Audio Arbiter** if you want its controls directly on the
   toolbar.
5. Click the extension icon and enable **Automatic ducking** once. The setting
   persists across browser restarts.
6. Reload YouTube tabs that were already open when the extension was loaded.

The popup never opens automatically and the extension adds no controls to the
YouTube page.

## Classification

The extension reads metadata already present in YouTube's active player. It
prefers YouTube's music-video type and category, with the duration music-note
badge as a fallback. It does not call the YouTube API, download metadata,
capture audio, or analyze media.

If metadata is unavailable, the video is treated as non-music so speech remains
clear. Use the popup's **Auto / Music / Non-music** selector to correct the
current video. Only explicit corrections are persisted; automatic video
history is not stored.

## Resource behavior

- The service worker reconstructs state only after playback, navigation,
  settings, or tab lifecycle events and is allowed to sleep while idle.
- There is no permanent tab registry, heartbeat, audio graph, or polling loop.
- A 50 ms timer exists only during a 100-3000 ms volume fade.
- One session-only number remembers the last genuine music baseline to prevent
  YouTube's saved ducked volume from compounding in a newly opened tab.
- Page exit restores the captured baseline immediately whenever Chromium gives
  the content script an unload opportunity.

## Development checks

The extension has no runtime or build dependencies. With Node.js installed:

```powershell
npm test
npm run check
```

To inspect classification, click the toolbar icon while viewing a YouTube video.
The popup displays the effective type and which YouTube signal produced it.
