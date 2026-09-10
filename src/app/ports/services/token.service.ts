export interface TokenPayload {
  name: string;
  master?: boolean;
  organization?: string;
}

export interface TokenService {
  generate(payload:TokenPayload): string;
  verify(token:string): Promise<TokenPayload>;
}
