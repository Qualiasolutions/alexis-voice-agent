import { describe, it, expect } from 'vitest';
import {
  escapeCdata,
  isValidOrderReference,
  isValidEmail,
  sanitizeSearchQuery,
  makeSpeechFriendly,
  shortenForListing,
  normalizeSearchQuery
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

describe('normalizeSearchQuery', () => {
  describe('basic normalization', () => {
    it('should return original query as first variation', () => {
      const result = normalizeSearchQuery('gaming laptop');
      expect(result.original).toBe('gaming laptop');
      expect(result.variations[0]).toBe('gaming laptop');
    });

    it('should extract significant terms', () => {
      const result = normalizeSearchQuery('I am looking for a gaming laptop');
      expect(result.terms).toContain('gaming');
      expect(result.terms).toContain('laptop');
      expect(result.terms).not.toContain('i');
      expect(result.terms).not.toContain('am');
      expect(result.terms).not.toContain('looking');
      expect(result.terms).not.toContain('for');
    });

    it('should handle empty and whitespace queries', () => {
      expect(normalizeSearchQuery('').variations).toHaveLength(0);
      expect(normalizeSearchQuery('   ').variations).toHaveLength(0);
    });

    it('should remove special characters but keep alphanumeric', () => {
      const result = normalizeSearchQuery('test!@#$%product');
      expect(result.variations[0]).toBe('test product');
    });
  });

  describe('GPU series patterns', () => {
    it('should expand RTX 50 series to specific models', () => {
      const result = normalizeSearchQuery('rtx 50 series');
      expect(result.variations).toContain('RTX 5060');
      expect(result.variations).toContain('RTX 5070');
      expect(result.variations).toContain('RTX 5080');
      expect(result.variations).toContain('RTX 5090');
      expect(result.variations).toContain('RTX 5070 ti');
    });

    it('should expand RTX 40 series to specific models', () => {
      const result = normalizeSearchQuery('rtx 40 series');
      expect(result.variations).toContain('RTX 4060');
      expect(result.variations).toContain('RTX 4070');
      expect(result.variations).toContain('RTX 4080');
      expect(result.variations).toContain('RTX 4090');
    });

    it('should expand GTX series', () => {
      const result = normalizeSearchQuery('gtx 16 series');
      expect(result.variations).toContain('GTX 1660');
      expect(result.variations).toContain('GTX 1670');
    });

    it('should handle series without "series" keyword', () => {
      const result = normalizeSearchQuery('rtx 50');
      // Should still work with just the number pattern
      expect(result.variations.some(v => v.includes('5070') || v.includes('5060'))).toBe(true);
    });
  });

  describe('memory/storage specs', () => {
    it('should generate variations for GB specs', () => {
      const result = normalizeSearchQuery('16gb ram');
      expect(result.variations).toContain('16GB');
      expect(result.variations).toContain('16 GB');
    });

    it('should generate variations for TB specs', () => {
      const result = normalizeSearchQuery('2tb ssd');
      expect(result.variations).toContain('2TB');
      expect(result.variations).toContain('2 TB');
    });

    it('should handle space between number and unit', () => {
      const result = normalizeSearchQuery('16 gb');
      expect(result.variations).toContain('16GB');
    });
  });

  describe('brand handling', () => {
    it('should preserve tech brands in terms', () => {
      const result = normalizeSearchQuery('asus rtx 4080');
      expect(result.terms).toContain('asus');
      expect(result.terms).toContain('rtx');
    });

    it('should generate brand + term combinations', () => {
      const result = normalizeSearchQuery('corsair ram 32gb');
      expect(result.variations.some(v => v.includes('corsair'))).toBe(true);
    });

    it('should recognize multiple common brands', () => {
      const brands = ['nvidia', 'amd', 'intel', 'asus', 'msi', 'gigabyte', 'corsair', 'samsung'];
      for (const brand of brands) {
        const result = normalizeSearchQuery(`${brand} product`);
        expect(result.terms).toContain(brand);
      }
    });
  });

  describe('stop words filtering', () => {
    it('should remove common stop words', () => {
      const result = normalizeSearchQuery('I want to find the best graphics card');
      expect(result.terms).not.toContain('i');
      expect(result.terms).not.toContain('want');
      expect(result.terms).not.toContain('to');
      expect(result.terms).not.toContain('find');
      expect(result.terms).not.toContain('the');
      expect(result.terms).toContain('best');
      expect(result.terms).toContain('graphics');
      expect(result.terms).toContain('card');
    });

    it('should remove "series", "line", "model" as stop words', () => {
      const result = normalizeSearchQuery('rtx 50 series line model');
      expect(result.terms).not.toContain('series');
      expect(result.terms).not.toContain('line');
      expect(result.terms).not.toContain('model');
    });
  });

  describe('real-world queries (from user issue)', () => {
    it('should handle "16gb rtx 50 series" - the original failing query', () => {
      const result = normalizeSearchQuery('16gb rtx 50 series');

      // Should have the original query
      expect(result.original).toBe('16gb rtx 50 series');

      // Should generate RTX 50 series expansions
      expect(result.variations.some(v => v.includes('5070'))).toBe(true);
      expect(result.variations.some(v => v.includes('5080'))).toBe(true);

      // Should generate 16GB variations
      expect(result.variations.some(v => v.includes('16GB') || v.includes('16 GB'))).toBe(true);

      // Should have rtx in terms (it's a brand)
      expect(result.terms).toContain('rtx');
    });

    it('should handle "graphics card rtx"', () => {
      const result = normalizeSearchQuery('graphics card rtx');
      expect(result.terms).toContain('graphics');
      expect(result.terms).toContain('card');
      expect(result.terms).toContain('rtx');
    });

    it('should handle "palit 5070"', () => {
      const result = normalizeSearchQuery('palit 5070');
      expect(result.terms).toContain('palit');
      expect(result.terms).toContain('5070');
    });
  });

  describe('deduplication', () => {
    it('should not have duplicate variations', () => {
      const result = normalizeSearchQuery('rtx rtx graphics');
      const uniqueVariations = new Set(result.variations);
      expect(result.variations.length).toBe(uniqueVariations.size);
    });
  });
});
