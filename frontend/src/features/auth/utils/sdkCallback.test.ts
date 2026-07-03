import { describe, expect, it } from 'vitest';
import { apiBaseUrl, isAllowedSdkCallback } from './sdkCallback';

describe('apiBaseUrl', () => {
  it('keeps an absolute API base', () => {
    expect(apiBaseUrl('http://localhost:8000', 'http://localhost:5173')).toBe(
      'http://localhost:8000'
    );
    expect(apiBaseUrl('https://api.example.org/', 'https://app.example.org')).toBe(
      'https://api.example.org'
    );
  });

  it('resolves an empty or relative base to the app origin', () => {
    expect(apiBaseUrl('', 'https://app.example.org')).toBe('https://app.example.org');
    expect(apiBaseUrl('/', 'https://app.example.org')).toBe('https://app.example.org');
  });
});

describe('isAllowedSdkCallback', () => {
  it('accepts loopback callback urls with any port', () => {
    expect(isAllowedSdkCallback('http://127.0.0.1:8123/callback')).toBe(true);
    expect(isAllowedSdkCallback('http://localhost:49152/callback')).toBe(true);
    expect(isAllowedSdkCallback('http://127.0.0.1/callback')).toBe(true);
  });

  it('rejects non-loopback hosts', () => {
    expect(isAllowedSdkCallback('http://evil.example.com/callback')).toBe(false);
    expect(isAllowedSdkCallback('http://127.0.0.1.evil.com/callback')).toBe(false);
    expect(isAllowedSdkCallback('http://192.168.1.5:8123/callback')).toBe(false);
  });

  it('rejects other protocols', () => {
    expect(isAllowedSdkCallback('https://127.0.0.1:8123/callback')).toBe(false);
    expect(isAllowedSdkCallback('ftp://127.0.0.1/callback')).toBe(false);
  });

  it('rejects other paths', () => {
    expect(isAllowedSdkCallback('http://127.0.0.1:8123/')).toBe(false);
    expect(isAllowedSdkCallback('http://127.0.0.1:8123/steal')).toBe(false);
  });

  it('rejects garbage', () => {
    expect(isAllowedSdkCallback('')).toBe(false);
    expect(isAllowedSdkCallback('not a url')).toBe(false);
  });
});
