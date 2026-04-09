import type { CreativeSpec, Platform } from '../models/adops.js';

const CREATIVE_SPECS: CreativeSpec[] = [
  // Google Ads
  { platform: 'google', format: 'Responsive Search Ad', placement: 'Search Network',
    image_specs: null,
    video_specs: null,
    text_specs: { headline_max_chars: 30, description_max_chars: 90, cta_options: ['Learn More', 'Sign Up', 'Buy Now', 'Get Quote', 'Contact Us', 'Apply Now', 'Download', 'Book Now'] } },
  { platform: 'google', format: 'Responsive Display Ad', placement: 'Display Network',
    image_specs: { width: 1200, height: 628, aspect_ratio: '1.91:1', max_file_size_mb: 5, formats: ['jpg', 'png', 'gif'] },
    video_specs: null,
    text_specs: { headline_max_chars: 30, description_max_chars: 90, cta_options: ['Learn More', 'Shop Now', 'Sign Up', 'Get Offer'] } },
  { platform: 'google', format: 'YouTube Video Ad', placement: 'YouTube',
    image_specs: { width: 1280, height: 720, aspect_ratio: '16:9', max_file_size_mb: 5, formats: ['jpg', 'png'] },
    video_specs: { min_duration_sec: 6, max_duration_sec: 180, aspect_ratios: ['16:9'], max_file_size_mb: 256, formats: ['mp4', 'mov', 'avi'] },
    text_specs: { headline_max_chars: 15, description_max_chars: 70, cta_options: ['Visit Site', 'Learn More', 'Shop Now', 'Sign Up'] } },

  // Meta Ads
  { platform: 'meta', format: 'Single Image', placement: 'Feed',
    image_specs: { width: 1080, height: 1080, aspect_ratio: '1:1', max_file_size_mb: 30, formats: ['jpg', 'png'] },
    video_specs: null,
    text_specs: { headline_max_chars: 40, description_max_chars: 125, cta_options: ['Shop Now', 'Learn More', 'Sign Up', 'Download', 'Contact Us', 'Book Now', 'Get Offer', 'Subscribe'] } },
  { platform: 'meta', format: 'Video', placement: 'Feed',
    image_specs: null,
    video_specs: { min_duration_sec: 1, max_duration_sec: 240, aspect_ratios: ['1:1', '4:5', '16:9'], max_file_size_mb: 4000, formats: ['mp4', 'mov', 'gif'] },
    text_specs: { headline_max_chars: 40, description_max_chars: 125, cta_options: ['Shop Now', 'Learn More', 'Sign Up', 'Watch More'] } },
  { platform: 'meta', format: 'Stories/Reels', placement: 'Stories & Reels',
    image_specs: { width: 1080, height: 1920, aspect_ratio: '9:16', max_file_size_mb: 30, formats: ['jpg', 'png'] },
    video_specs: { min_duration_sec: 1, max_duration_sec: 60, aspect_ratios: ['9:16'], max_file_size_mb: 4000, formats: ['mp4', 'mov'] },
    text_specs: { headline_max_chars: 40, description_max_chars: 125, cta_options: ['Shop Now', 'Learn More', 'Swipe Up'] } },
  { platform: 'meta', format: 'Carousel', placement: 'Feed',
    image_specs: { width: 1080, height: 1080, aspect_ratio: '1:1', max_file_size_mb: 30, formats: ['jpg', 'png'] },
    video_specs: { min_duration_sec: 1, max_duration_sec: 240, aspect_ratios: ['1:1'], max_file_size_mb: 4000, formats: ['mp4', 'mov'] },
    text_specs: { headline_max_chars: 40, description_max_chars: 125, cta_options: ['Shop Now', 'Learn More', 'Sign Up'] } },
];

export function getCreativeSpecs(platform: Platform, format?: string): CreativeSpec[] {
  let specs = CREATIVE_SPECS.filter((s) => s.platform === platform);
  if (format) {
    specs = specs.filter((s) => s.format.toLowerCase().includes(format.toLowerCase()));
  }
  return specs;
}

export function getAllCreativeSpecs(): CreativeSpec[] {
  return CREATIVE_SPECS;
}
