import { expect, describe, it } from 'vitest';
import { parseProxyUrl } from '../src/utils';

describe('parseProxyUrl', () => {
  it('should parse proxy url', () => {
    expect(parseProxyUrl('http://user:pass@proxy.com:8080')).toEqual({
      username: 'user',
      password: 'pass',
    });
  });
  it('should parse proxy url with abnormal proxy url', () => {
    expect(parseProxyUrl('http://user:pass@proxy.com:81111')).toEqual({
      username: 'user',
      password: 'pass',
    });
  });
  it('should parse proxy url with no username and password', () => {
    expect(parseProxyUrl('http://proxy.com:8080')).toEqual({
      username: '',
      password: '',
    });
  });
  it('should parse socks5 proxy url with no username and password', () => {
    expect(parseProxyUrl('socks5://proxy.com:8080')).toEqual({
      username: '',
      password: '',
    });
  });
});
