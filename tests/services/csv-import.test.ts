import { describe, it, expect } from 'vitest';
import { importGoogleAdsCsv } from '../../src/services/csv-import/google-ads.js';
import { importMetaAdsCsv } from '../../src/services/csv-import/meta-ads.js';
import { parseCsv, parseNumber, detectDelimiter } from '../../src/utils/csv.js';

describe('CSV parser utility', () => {
  it('parses basic CSV with headers', () => {
    const csv = 'a,b,c\n1,2,3\n4,5,6';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('handles quoted fields with embedded commas', () => {
    const csv = 'name,age\n"Smith, John",42';
    const rows = parseCsv(csv);
    expect(rows[0].name).toBe('Smith, John');
    expect(rows[0].age).toBe('42');
  });

  it('handles escaped quotes inside quoted fields', () => {
    const csv = 'quote,author\n"She said ""hello""",Mary';
    const rows = parseCsv(csv);
    expect(rows[0].quote).toBe('She said "hello"');
  });

  it('strips UTF-8 BOM', () => {
    const csv = '﻿col1,col2\nval1,val2';
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual({ col1: 'val1', col2: 'val2' });
  });

  it('skips empty lines by default', () => {
    const csv = 'a,b\n1,2\n\n3,4\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
  });

  it('parseNumber handles US formatting', () => {
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('$99.00')).toBe(99);
  });

  it('parseNumber handles European formatting', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('€50,00')).toBe(50);
  });

  it('parseNumber handles Google Ads no-data marker', () => {
    expect(parseNumber('--')).toBe(0);
    expect(parseNumber('')).toBe(0);
    expect(parseNumber('n/a')).toBe(0);
  });

  it('parseNumber strips percent sign', () => {
    expect(parseNumber('12.5%')).toBe(12.5);
  });

  it('detectDelimiter finds semicolon in European exports', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('detectDelimiter defaults to comma', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
  });
});

describe('Google Ads CSV import', () => {
  it('imports a minimal campaigns report', () => {
    const csv = [
      'Campaign,Campaign state,Campaign type,Budget,Impressions,Clicks,Cost,Conversions,Conv. value,Currency',
      'Brand Search,Enabled,Search,100,50000,1250,850.50,42,5400,USD',
      'Display Prospecting,Paused,Display,80,120000,480,200.25,6,720,USD',
    ].join('\n');

    const result = importGoogleAdsCsv(csv);
    expect(result.summary.campaigns_imported).toBe(2);
    expect(result.summary.metrics_imported).toBe(2);
    expect(result.connection.platform).toBe('google');
    expect(result.campaigns[0].name).toBe('Brand Search');
    expect(result.campaigns[0].status).toBe('active');
    expect(result.campaigns[1].status).toBe('paused');
  });

  it('calculates CTR, CPC, CPM, ROAS correctly', () => {
    const csv = [
      'Campaign,Impressions,Clicks,Cost,Conversions,Conv. value',
      'Test Campaign,10000,100,50,10,500',
    ].join('\n');

    const result = importGoogleAdsCsv(csv);
    const m = result.metrics[0];
    expect(m.ctr).toBeCloseTo(1.0); // 100/10000 * 100
    expect(m.cpc).toBeCloseTo(0.5); // 50/100
    expect(m.cpm).toBeCloseTo(5); // 50/10000 * 1000
    expect(m.roas).toBeCloseTo(10); // 500/50
    expect(m.cpa).toBeCloseTo(5); // 50/10
    expect(m.conversion_rate).toBeCloseTo(10); // 10/100 * 100
  });

  it('detects Day-segmented reports', () => {
    const csv = [
      'Campaign,Day,Impressions,Clicks,Cost',
      'Brand,2026-04-19,1000,30,15',
      'Brand,2026-04-20,1200,35,18',
      'Brand,2026-04-21,1100,32,17',
    ].join('\n');

    const result = importGoogleAdsCsv(csv);
    expect(result.summary.has_time_segmentation).toBe(true);
    expect(result.summary.campaigns_imported).toBe(1); // Same campaign, 3 days
    expect(result.summary.metrics_imported).toBe(3);
  });

  it('handles European decimal comma', () => {
    // European format: "125,50" = 125.50 (comma as decimal separator)
    // Integer thousands (e.g. "10.000" for 10,000) require semicolon-delimited CSV
    // to disambiguate from decimal — documented behavior.
    const csv = [
      'Campaign,Impressions,Clicks,Cost',
      'EU Campaign,10000,250,"125,50"',
    ].join('\n');

    const result = importGoogleAdsCsv(csv);
    expect(result.metrics[0].spend).toBeCloseTo(125.5);
    expect(result.metrics[0].impressions).toBe(10000);
  });

  it('maps campaign type to objective', () => {
    const csv = [
      'Campaign,Campaign type,Impressions,Clicks,Cost',
      'Search,Search Network,100,5,2',
      'Shopping,Shopping,200,10,3',
      'Video,YouTube Videos,500,20,5',
      'Display,Display Network,1000,30,4',
    ].join('\n');

    const result = importGoogleAdsCsv(csv);
    const byName = Object.fromEntries(result.campaigns.map((c) => [c.name, c.objective]));
    expect(byName['Search']).toBe('conversions');
    expect(byName['Shopping']).toBe('sales');
    expect(byName['Video']).toBe('video_views');
    expect(byName['Display']).toBe('awareness');
  });

  it('adds warning for empty CSV', () => {
    const csv = 'Campaign,Impressions';
    expect(() => importGoogleAdsCsv(csv)).not.toThrow();
    const result = importGoogleAdsCsv(csv);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('throws on truly empty input', () => {
    expect(() => importGoogleAdsCsv('')).toThrow(/empty or malformed/);
  });
});

describe('Meta Ads CSV import', () => {
  it('imports a minimal campaigns report', () => {
    const csv = [
      'Campaign name,Delivery status,Campaign objective,Impressions,Link clicks,"Amount spent (USD)",Results,Purchases conversion value',
      'Prospecting Carousel,Active,Conversions,50000,1000,450.00,25,3200',
      'Retargeting,Paused,Sales,20000,800,300.00,40,5000',
    ].join('\n');

    const result = importMetaAdsCsv(csv);
    expect(result.summary.campaigns_imported).toBe(2);
    expect(result.summary.metrics_imported).toBe(2);
    expect(result.summary.detected_currency).toBe('USD');
    expect(result.connection.platform).toBe('meta');
    expect(result.campaigns[0].status).toBe('active');
    expect(result.campaigns[1].status).toBe('paused');
  });

  it('detects non-USD currency from column header', () => {
    const csv = [
      'Campaign name,Impressions,Link clicks,"Amount spent (EUR)",Results',
      'EU Campaign,10000,250,85.00,12',
    ].join('\n');

    const result = importMetaAdsCsv(csv);
    expect(result.summary.detected_currency).toBe('EUR');
    expect(result.campaigns[0].currency).toBe('EUR');
  });

  it('maps objective correctly', () => {
    const csv = [
      'Campaign name,Campaign objective,Impressions,Link clicks,"Amount spent (USD)"',
      'Brand Awareness,Brand Awareness,10000,100,50',
      'Traffic Campaign,Traffic,20000,500,75',
      'Lead Gen,Lead generation,5000,250,40',
      'Sales Push,Sales,15000,800,200',
    ].join('\n');

    const result = importMetaAdsCsv(csv);
    const byName = Object.fromEntries(result.campaigns.map((c) => [c.name, c.objective]));
    expect(byName['Brand Awareness']).toBe('awareness');
    expect(byName['Traffic Campaign']).toBe('traffic');
    expect(byName['Lead Gen']).toBe('leads');
    expect(byName['Sales Push']).toBe('sales');
  });

  it('captures Meta-specific reach and frequency', () => {
    const csv = [
      'Campaign name,Impressions,Reach,Frequency,Link clicks,"Amount spent (USD)"',
      'Test,10000,4000,2.5,150,50',
    ].join('\n');

    const result = importMetaAdsCsv(csv);
    expect(result.metrics[0].reach).toBe(4000);
    expect(result.metrics[0].frequency).toBeCloseTo(2.5);
    expect(result.metrics[0].quality_score).toBeNull(); // Google-only
  });

  it('skips rows with no campaign name', () => {
    const csv = [
      'Campaign name,Impressions,"Amount spent (USD)"',
      ',100,10',
      'Valid Campaign,200,20',
      ',300,30',
    ].join('\n');

    const result = importMetaAdsCsv(csv);
    expect(result.summary.campaigns_imported).toBe(1);
    expect(result.summary.rows_skipped).toBe(2);
  });
});
