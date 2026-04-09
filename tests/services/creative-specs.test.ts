import { describe, it, expect } from 'vitest';
import { getCreativeSpecs, getAllCreativeSpecs } from '../../src/services/creative-specs.js';

describe('Creative Specs', () => {
  it('should return all specs', () => {
    const all = getAllCreativeSpecs();
    expect(all.length).toBeGreaterThan(5);
  });

  it('should filter by google platform', () => {
    const google = getCreativeSpecs('google');
    expect(google.length).toBeGreaterThan(0);
    expect(google.every((s) => s.platform === 'google')).toBe(true);
  });

  it('should filter by meta platform', () => {
    const meta = getCreativeSpecs('meta');
    expect(meta.length).toBeGreaterThan(0);
    expect(meta.every((s) => s.platform === 'meta')).toBe(true);
  });

  it('should filter by format', () => {
    const stories = getCreativeSpecs('meta', 'stories');
    expect(stories.length).toBe(1);
    expect(stories[0].image_specs?.aspect_ratio).toBe('9:16');
  });

  it('should have correct Google Search specs', () => {
    const search = getCreativeSpecs('google', 'search');
    expect(search.length).toBe(1);
    expect(search[0].text_specs.headline_max_chars).toBe(30);
    expect(search[0].text_specs.description_max_chars).toBe(90);
    expect(search[0].image_specs).toBeNull();
  });

  it('should have correct Meta Feed specs', () => {
    const feed = getCreativeSpecs('meta', 'image');
    expect(feed.length).toBe(1);
    expect(feed[0].image_specs?.width).toBe(1080);
    expect(feed[0].image_specs?.height).toBe(1080);
  });

  it('should return empty for non-existent format', () => {
    const none = getCreativeSpecs('google', 'tiktok');
    expect(none).toHaveLength(0);
  });
});
