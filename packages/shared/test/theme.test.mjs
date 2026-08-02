import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  contrastRatio,
  readableTextOn,
  resolveTheme,
  deriveScale,
  THEME_PRESETS,
  hexToRgb,
} from '../dist/index.js';

test('contrast ratio is symmetric and bounded', () => {
  assert.equal(Math.round(contrastRatio('#ffffff', '#000000')), 21);
  assert.equal(contrastRatio('#ffffff', '#000000'), contrastRatio('#000000', '#ffffff'));
  assert.equal(contrastRatio('#123456', '#123456'), 1);
});

test('readable text auto-flips to keep WCAG AA on any accent', () => {
  // Pale yellow: white text would be unreadable, so black is chosen.
  assert.equal(readableTextOn('#f2e14a'), '#000000');
  // Deep blue: white clears AA.
  assert.equal(readableTextOn('#0f5da8'), '#ffffff');
  // Whatever is chosen must clear 4.5:1.
  for (const bg of ['#f2e14a', '#0f5da8', '#8b5cf6', '#ffffff', '#000000']) {
    assert.ok(contrastRatio(bg, readableTextOn(bg)) >= 4.5, `AA fails on ${bg}`);
  }
});

test('every preset yields a readable on-accent text colour', () => {
  for (const preset of THEME_PRESETS) {
    const onText = readableTextOn(preset.hex);
    assert.ok(contrastRatio(preset.hex, onText) >= 4.5, `${preset.name} fails AA`);
  }
});

test('resolveTheme fills defaults, normalises hex and computes onPrimary', () => {
  const t = resolveTheme({ primary: '0F5DA8' });
  assert.equal(t.primary, '#0f5da8');
  assert.equal(t.onPrimary, '#ffffff');
  assert.equal(t.sidebar, 'dark');
  assert.equal(t.radius, 'md');
  assert.equal(t.scale[500], '#0f5da8');
});

test('deriveScale spans light to dark from one primary', () => {
  const scale = deriveScale('#0f5da8');
  assert.equal(scale[500], '#0f5da8');
  // Tints are lighter (higher luminance), shades darker.
  assert.ok(hexToRgb(scale[50]).r > hexToRgb(scale[500]).r);
  assert.ok(hexToRgb(scale[900]).r < hexToRgb(scale[500]).r);
});

test('resolveTheme rejects a non-hex primary', () => {
  assert.throws(() => resolveTheme({ primary: 'blue' }));
});
