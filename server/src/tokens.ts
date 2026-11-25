import jwt from 'jsonwebtoken';

export interface TokenClaims {
  officerId: string;
  branchCode: string;
  deviceId: string;
  kind: 'access' | 'refresh';
}

export class Tokens {
  constructor(
    private readonly secret: string,
    private readonly accessTtl: number,
    private readonly refreshTtl: number,
  ) {}

  issue(claims: Omit<TokenClaims, 'kind'>): { accessToken: string; refreshToken: string; expiresInSeconds: number } {
    return {
      accessToken: jwt.sign({ ...claims, kind: 'access' }, this.secret, { expiresIn: this.accessTtl, algorithm: 'HS256' }),
      refreshToken: jwt.sign({ ...claims, kind: 'refresh' }, this.secret, { expiresIn: this.refreshTtl, algorithm: 'HS256' }),
      expiresInSeconds: this.accessTtl,
    };
  }

  verify(token: string, kind: 'access' | 'refresh'): TokenClaims | null {
    try {
      const decoded = jwt.verify(token, this.secret, { algorithms: ['HS256'] }) as TokenClaims;
      return decoded.kind === kind ? decoded : null;
    } catch {
      return null;
    }
  }
}
