import { cleanApiUrl } from './config';

describe('cleanApiUrl', () => {
  test('leaves a normal address alone', () => {
    expect(cleanApiUrl('https://field.example.com')).toBe('https://field.example.com');
  });
  test('removes spaces, trailing slashes and a trailing /v1', () => {
    expect(cleanApiUrl('  https://field.example.com/  ')).toBe('https://field.example.com');
    expect(cleanApiUrl('https://field.example.com/v1')).toBe('https://field.example.com');
    expect(cleanApiUrl('https://field.example.com/v1/')).toBe('https://field.example.com');
    expect(cleanApiUrl('https://field.example.com/V1///')).toBe('https://field.example.com');
  });
  test('keeps a path that only contains v1 inside it', () => {
    expect(cleanApiUrl('https://example.com/api/v1x')).toBe('https://example.com/api/v1x');
  });
  test('no address means demo mode', () => {
    expect(cleanApiUrl(undefined)).toBe('');
    expect(cleanApiUrl('   ')).toBe('');
  });
});
