"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

const {
  DEFAULT_SETTINGS,
  KINDS,
  classifySignals,
  computeDuckPlan,
  interpolateVolume,
  normalizeSettings
} = core;

test("settings default to disabled with relative 20% ducking", () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
});

test("settings are clamped to safe UI ranges", () => {
  assert.deepEqual(normalizeSettings({
    enabled: true,
    duckRatio: 7,
    fadeMs: 10,
    unknownPolicy: "inactive"
  }), {
    enabled: true,
    duckRatio: 1,
    fadeMs: 100,
    unknownPolicy: "inactive"
  });
});

test("manual override takes precedence over YouTube metadata", () => {
  const result = classifySignals({
    videoId: "abc",
    override: KINDS.NON_MUSIC,
    category: "Music",
    musicVideoType: "MUSIC_VIDEO_TYPE_OMV"
  });
  assert.equal(result.effectiveKind, KINDS.NON_MUSIC);
  assert.equal(result.source, "manual-override");
});

test("musicVideoType and Music category classify music", () => {
  assert.equal(classifySignals({
    musicVideoType: "MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK"
  }).effectiveKind, KINDS.MUSIC);
  assert.equal(classifySignals({
    category: " music "
  }).effectiveKind, KINDS.MUSIC);
});

test("a non-music category classifies non-music", () => {
  const result = classifySignals({ category: "Education" });
  assert.equal(result.detectedKind, KINDS.NON_MUSIC);
  assert.equal(result.effectiveKind, KINDS.NON_MUSIC);
  assert.equal(result.source, "youtube-category");
});

test("unknown defaults to effective non-music", () => {
  const result = classifySignals({});
  assert.equal(result.detectedKind, KINDS.UNKNOWN);
  assert.equal(result.effectiveKind, KINDS.NON_MUSIC);
  assert.equal(result.source, "unknown-default");
});

test("only audible non-music playback triggers music ducking", () => {
  const states = [
    {
      tabId: 1,
      effectiveKind: KINDS.MUSIC,
      playing: true,
      muted: false,
      volume: 0.3
    },
    {
      tabId: 2,
      effectiveKind: KINDS.NON_MUSIC,
      playing: true,
      muted: false,
      volume: 0.8
    },
    {
      tabId: 3,
      effectiveKind: KINDS.MUSIC,
      playing: false,
      muted: false,
      volume: 0.5
    }
  ];
  const plan = computeDuckPlan(states, true);
  assert.equal(plan.triggerActive, true);
  assert.deepEqual(plan.decisions, [
    { tabId: 1, ducked: true },
    { tabId: 2, ducked: false },
    { tabId: 3, ducked: true }
  ]);
});

test("muted, zero-volume, paused, and disabled triggers do not duck", () => {
  for (const trigger of [
    { playing: true, muted: true, volume: 1 },
    { playing: true, muted: false, volume: 0 },
    { playing: false, muted: false, volume: 1 }
  ]) {
    const plan = computeDuckPlan([
      { tabId: 1, effectiveKind: KINDS.MUSIC, playing: true, volume: 1 },
      { tabId: 2, effectiveKind: KINDS.NON_MUSIC, ...trigger }
    ], true);
    assert.equal(plan.triggerActive, false);
  }

  assert.equal(computeDuckPlan([
    {
      tabId: 2,
      effectiveKind: KINDS.NON_MUSIC,
      playing: true,
      muted: false,
      volume: 1
    }
  ], false).triggerActive, false);
});

test("relative ducking turns a 30% baseline into 6%", () => {
  const baseline = 0.3;
  const target = baseline * 0.2;
  assert.ok(Math.abs(target - 0.06) < Number.EPSILON);
  assert.equal(interpolateVolume(baseline, target, 0), baseline);
  assert.equal(interpolateVolume(baseline, target, 1), target);
  assert.ok(interpolateVolume(baseline, target, 0.5) < baseline);
  assert.ok(interpolateVolume(baseline, target, 0.5) > target);
});
