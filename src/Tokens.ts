export class TokenService {
  static base64URL(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  static randomToken(prefix: 'org' | 'addr' | 'enr' | 'resume' | 'runtime'): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return `${prefix}_${this.base64URL(bytes)}`;
  }

  static async sha256Hex(input: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}

