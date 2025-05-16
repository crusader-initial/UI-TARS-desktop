/**
 * Parse proxy url to username and password
 * @param proxyUrl - proxy url
 * @returns username and password
 */
export function parseProxyUrl(proxyUrl: string) {
  const result = { username: '', password: '' };

  try {
    const url = new URL(proxyUrl);
    result.username = url.username || '';
    result.password = url.password || '';
  } catch (error) {
    try {
      if (proxyUrl.includes('@')) {
        const protocolIndex = proxyUrl.indexOf('://');
        if (protocolIndex !== -1) {
          const authStartIndex = protocolIndex + 3;
          const authEndIndex = proxyUrl.indexOf('@');

          if (authEndIndex > authStartIndex) {
            const authInfo = proxyUrl.substring(authStartIndex, authEndIndex);
            const authParts = authInfo.split(':');

            if (authParts.length >= 2) {
              result.username = authParts[0];
              result.password = authParts[1];
            }
          }
        }
      }
    } catch (fallbackError) {
      console.error('parse proxy url error:', fallbackError);
    }
  }

  return result;
}
