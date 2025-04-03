import { describe, it, expect } from 'vitest';
import { SearchRequestSchema, ErrorResponseSchema } from '../schema';

describe('SearchRequestSchema validation', () => {
  it('should accept valid input', () => {
    const validInput = {
      publicationUrls: ['https://example.com'],
      region: 'US',
      dateRangeOption: 'Past Week',
      maxQueriesPerPublication: 5
    };
    
    const result = SearchRequestSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });
  
  it('should require at least one publication URL', () => {
    const invalidInput = {
      publicationUrls: [],
      region: 'US'
    };
    
    const result = SearchRequestSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('At least one publication URL');
    }
  });
  
  it('should validate URLs', () => {
    const invalidInput = {
      publicationUrls: ['not-a-url'],
      region: 'US'
    };
    
    const result = SearchRequestSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('valid URL');
    }
  });
  
  it('should validate region values', () => {
    const invalidInput = {
      publicationUrls: ['https://example.com'],
      region: 'INVALID'
    };
    
    const result = SearchRequestSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Invalid enum value');
    }
  });
  
  it('should require customTbs when dateRangeOption is Custom', () => {
    const invalidInput = {
      publicationUrls: ['https://example.com'],
      region: 'US',
      dateRangeOption: 'Custom'
    };
    
    const result = SearchRequestSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('customTbs');
    }
  });
  
  it('should validate customTbs format', () => {
    const invalidInput = {
      publicationUrls: ['https://example.com'],
      region: 'US',
      dateRangeOption: 'Custom',
      customTbs: 'invalid-format'
    };
    
    const result = SearchRequestSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('tbs=cdr:1,cd_min:');
    }
  });
});

describe('ErrorResponseSchema', () => {
  it('should validate error responses', () => {
    const validError = { error: 'An error occurred' };
    const result = ErrorResponseSchema.safeParse(validError);
    expect(result.success).toBe(true);
    
    const invalidError = { message: 'An error occurred' };
    const invalidResult = ErrorResponseSchema.safeParse(invalidError);
    expect(invalidResult.success).toBe(false);
  });
});