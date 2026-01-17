import { describe, it, expect } from 'vitest';
import {
  escapeCdata,
  isValidOrderReference,
  isValidEmail,
  sanitizeSearchQuery,
  makeSpeechFriendly,
  shortenForListing
} from '../../src/index';

describe('escapeCdata', () => {
  it('should escape CDATA breakout sequences', () => {
    expect(escapeCdata('Hello ]]> world')).toBe('Hello ]]]]><![CDATA[> world');
  });

  it('should handle multiple breakout sequences', () => {
    expect(escapeCdata(']]>test]]>')).toBe(']]]]><![CDATA[>test]]]]><![CDATA[>');
  });

  it('should return unchanged text when no breakout sequences', () => {
    expect(escapeCdata('Normal text')).toBe('Normal text');
  });

  it('should handle empty string', () => {
    expect(escapeCdata('')).toBe('');
  });
});

describe('isValidOrderReference', () => {
  it('should accept valid 9-char alphanumeric references', () => {
    expect(isValidOrderReference('ABCDEFGHI')).toBe(true);
    expect(isValidOrderReference('123456789')).toBe(true);
    expect(isValidOrderReference('ABC123DEF')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isValidOrderReference('abcdefghi')).toBe(true);
    expect(isValidOrderReference('AbCdEfGhI')).toBe(true);
  });

  it('should reject references with wrong length', () => {
    expect(isValidOrderReference('ABCDEFGH')).toBe(false);  // 8 chars
    expect(isValidOrderReference('ABCDEFGHIJ')).toBe(false); // 10 chars
    expect(isValidOrderReference('')).toBe(false);
  });

  it('should reject references with special characters', () => {
    expect(isValidOrderReference('ABC-DEF-G')).toBe(false);
    expect(isValidOrderReference('ABC_DEFGH')).toBe(false);
    expect(isValidOrderReference('ABC DEFGH')).toBe(false);
  });
});

describe('isValidEmail', () => {
  it('should accept valid email addresses', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('user.name@domain.org')).toBe(true);
    expect(isValidEmail('user+tag@example.co.uk')).toBe(true);
  });

  it('should reject invalid email addresses', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('@missing-local.com')).toBe(false);
    expect(isValidEmail('missing-domain@')).toBe(false);
    expect(isValidEmail('has spaces@example.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});

describe('sanitizeSearchQuery', () => {
  it('should remove filter injection characters', () => {
    expect(sanitizeSearchQuery('normal query')).toBe('normal query');
    expect(sanitizeSearchQuery('[test]')).toBe('test');
    expect(sanitizeSearchQuery('value|other')).toBe('valueother');
    expect(sanitizeSearchQuery('one,two,three')).toBe('onetwothree');
  });

  it('should trim whitespace', () => {
    expect(sanitizeSearchQuery('  trimmed  ')).toBe('trimmed');
  });

  it('should handle mixed injection attempts', () => {
    expect(sanitizeSearchQuery('[1|5]')).toBe('15');
    expect(sanitizeSearchQuery('[1,10]')).toBe('110');
  });

  it('should handle empty string', () => {
    expect(sanitizeSearchQuery('')).toBe('');
  });
});

describe('makeSpeechFriendly', () => {
  it('should convert GB to gigabytes', () => {
    expect(makeSpeechFriendly('16GB RAM')).toBe('16 gigabytes RAM');
    expect(makeSpeechFriendly('256GB SSD')).toBe('256 gigabytes S S D');
  });

  it('should convert TB to terabytes', () => {
    expect(makeSpeechFriendly('2TB HDD')).toBe('2 terabytes H D D');
  });

  it('should space out DDR', () => {
    expect(makeSpeechFriendly('DDR4')).toBe('D D R 4');
    expect(makeSpeechFriendly('DDR5 Memory')).toBe('D D R 5 Memory');
  });

  it('should handle processor names', () => {
    expect(makeSpeechFriendly('Intel i5-1145G7')).toBe('Intel i5 1145 G 7');
    expect(makeSpeechFriendly('Core i7-12700')).toBe('Core i7 12700');
  });

  it('should space out common abbreviations', () => {
    expect(makeSpeechFriendly('SSD')).toBe('S S D');
    expect(makeSpeechFriendly('USB')).toBe('U S B');
    expect(makeSpeechFriendly('HDMI')).toBe('H D M I');
    expect(makeSpeechFriendly('LED')).toBe('L E D');
    expect(makeSpeechFriendly('LCD')).toBe('L C D');
  });

  it('should fix G model numbers', () => {
    expect(makeSpeechFriendly('LG G8')).toBe('LG G 8');
  });
});

describe('shortenForListing', () => {
  it('should keep brand and model', () => {
    expect(shortenForListing('Apple iPhone 14 Pro')).toBe('Apple iPhone 14 Pro');
  });

  it('should truncate at technical specs', () => {
    expect(shortenForListing('Dell Laptop 15inch 16GB RAM 512GB SSD')).toBe('Dell Laptop 15inch');
  });

  it('should keep at least 3 words', () => {
    expect(shortenForListing('Samsung 256GB SSD Internal')).toBe('Samsung 256GB SSD');
  });

  it('should handle products with dimensions', () => {
    expect(shortenForListing('LG Monitor 27inch 1920x1080 LED')).toBe('LG Monitor 27inch');
  });

  it('should cap at 5 words before specs', () => {
    expect(shortenForListing('Brand Model Series Pro Max Edition 2024'))
      .toBe('Brand Model Series Pro Max');
  });
});
