import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  REGISTRATION_KEY?: string;
  ADMIN_ACCESS_TEAM_NAME?: string;
  ADMIN_ACCESS_AUDIENCE?: string;
  ADMIN_ALLOWED_EMAILS?: string;
  MCP_OBJECT: DurableObjectNamespace;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
}
