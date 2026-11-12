import type { AuthRequest } from '@cloudflare/workers-oauth-provider';

export type FormValues = {
  intent: 'signin' | 'signup';
  email: string;
  error: string | null;
  needsRegistrationKey: boolean;
};

export class AuthorizePage {
  static readonly HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  };

  private static escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private static readonly STYLE = `
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      font-synthesis: none;
      background: #070e1d;
      color: #eef3ff;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(ellipse 65% 75% at 7% 20%, rgba(56, 99, 215, .23), transparent 70%),
        radial-gradient(ellipse 48% 55% at 95% 85%, rgba(25, 145, 177, .14), transparent 72%),
        #070e1d;
    }

    .layout {
      width: min(1090px, calc(100% - 48px));
      margin: 0 auto;
      min-height: 100vh;
      display: grid;
      grid-template-columns: minmax(0, .95fr) minmax(350px, 1.05fr);
      align-items: center;
      gap: clamp(32px, 7vw, 105px);
      padding: 68px 0;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      padding: 8px 13px;
      border: 1px solid #36517d;
      border-radius: 100px;
      color: #bdcffb;
      background: rgba(41, 65, 113, .28);
      font-size: .74rem;
      font-weight: 750;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    .brand-mark {
      display: inline-grid;
      place-items: center;
      width: 23px;
      height: 23px;
      background: #a9e8ee;
      color: #0a233b;
      border-radius: 7px;
      font-size: .78rem;
      font-weight: 900;
    }

    h1 {
      font-size: clamp(2.5rem, 4.8vw, 4.4rem);
      line-height: 1.13;
      letter-spacing: -.06em;
      margin: 28px 0 20px;
      font-weight: 780;
    }

    .accent { color: #a9e8ee; }

    .lead {
      max-width: 28rem;
      color: #adbbd7;
      line-height: 1.75;
      font-size: 1.06rem;
    }

    .architecture {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-top: 31px;
      font-size: .81rem;
      color: #c0ceea;
      font-weight: 650;
    }

    .architecture span:not(.arrow) {
      padding: 9px 12px;
      border: 1px solid #263d62;
      border-radius: 10px;
      background: rgba(19, 36, 69, .72);
    }

    .arrow { color: #6481b6; }

    .forms { min-width: 0; }

    .panel {
      border: 1px solid #2d4164;
      background: rgba(15, 28, 53, .93);
      border-radius: 24px;
      box-shadow: 0 24px 80px rgba(0, 5, 20, .38);
      overflow: hidden;
    }

    .panel-header {
      border-bottom: 1px solid #263956;
      padding: 27px 30px 17px;
    }

    .panel-header h2 { font-size: 1.45rem; letter-spacing: -.035em; margin: 0 0 7px; }

    .panel-header p { color: #9eafcd; font-size: .88rem; line-height: 1.6; margin: 0; }

    .auth-card { margin: 0; padding: 24px 30px 28px; }

    .auth-card + .auth-card {
      border-top: 1px solid #293b5a;
      background: rgba(10, 20, 40, .42);
    }

    .auth-card h3 {
      margin: 0 0 14px;
      color: #e5edff;
      font-size: 1.03rem;
      letter-spacing: -.01em;
    }

    label {
      display: block;
      margin: 13px 0 7px;
      font-size: .84rem;
      color: #c9d5ec;
      font-weight: 600;
    }

    input:not([type="hidden"]) {
      width: 100%;
      border-radius: 11px;
      border: 1px solid #405476;
      background: #101d35;
      color: #fff;
      padding: 11px 14px;
      min-height: 44px;
      font: inherit;
      transition: border-color .15s ease, box-shadow .15s ease;
    }

    input:not([type="hidden"]):focus-visible {
      outline: 0;
      border-color: #9de5ec;
      box-shadow: 0 0 0 3px rgba(109, 226, 240, .18);
    }

    input::placeholder { color: #8194b4; }

    button {
      width: 100%;
      margin-top: 20px;
      border: 0;
      border-radius: 11px;
      min-height: 45px;
      background: #a9e8ee;
      color: #10253e;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
      transition: background .15s ease, transform .15s ease;
    }

    button:hover { background: #cdf7f9; }
    button:active { transform: translateY(1px); }

    .secondary-button {
      background: #233858;
      color: #e1edff;
      border: 1px solid #435c82;
    }

    .secondary-button:hover { background: #2d4770; }

    .subtext {
      margin: 9px 0 0;
      font-size: .78rem;
      line-height: 1.6;
      color: #9eaeca;
    }

    .error {
      padding: 13px 15px;
      background: #491e34;
      border: 1px solid #ac5478;
      color: #ffe4ee;
      border-radius: 11px;
      margin: 0 0 16px;
      line-height: 1.5;
    }

    .footnote { margin-top: 20px; text-align: center; font-size: .75rem; color: #8598b8; }

    @media (max-width: 850px) {
      .layout { grid-template-columns: 1fr; width: min(530px, calc(100% - 32px)); gap: 22px; padding: 38px 0 44px; min-height: auto; }
      h1 { margin-top: 20px; margin-bottom: 12px; font-size: 2.4rem; }
      .lead { margin-bottom: 10px; }
      .architecture { margin-top: 16px; }
    }

    @media (max-width: 480px) {
      .panel-header { padding: 23px 20px 16px; }
      .auth-card { padding: 20px; }
    }

    @media (prefers-reduced-motion: reduce) {
      button, input { transition: none !important; }
    }
  `;

  constructor(private readonly oauthRequest: AuthRequest) {}

  private hiddenFields(intent: string): string {
    const encoded = AuthorizePage.escape(JSON.stringify(this.oauthRequest));

    return `<input type="hidden" name="oauthRequest" value="${encoded}"><input type="hidden" name="intent" value="${intent}">`;
  }

  private signInForm(values: FormValues): string {
    return `<form method="post" action="/authorize" class="auth-card">
      <h3>Sign in to your account</h3>${this.hiddenFields('signin')}
      <label for="si-email">Email</label>
      <input id="si-email" name="email" type="email" autocomplete="username" inputmode="email" placeholder="you@example.com" required value="${
        values.intent === 'signin' ? AuthorizePage.escape(values.email) : ''
      }">
      <label for="si-password">Password</label>
      <input id="si-password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in securely</button>
    </form>`;
  }

  private signUpForm(values: FormValues): string {
    const registrationKey = values.needsRegistrationKey
      ? `<label for="su-key">Registration key</label>
         <input id="su-key" name="registrationKey" type="password" autocomplete="off" required>`
      : '';

    return `<form method="post" action="/authorize" class="auth-card">
      <h3>Create an account</h3>${this.hiddenFields('signup')}
      <label for="su-email">Email</label>
      <input id="su-email" name="email" type="email" autocomplete="username" inputmode="email" placeholder="you@example.com" required value="${
        values.intent === 'signup' ? AuthorizePage.escape(values.email) : ''
      }">
      <label for="su-password">Password (10+ characters)</label>
      <input id="su-password" name="password" type="password" autocomplete="new-password" minlength="10" maxlength="256" required>
      <label for="su-confirm-password">Confirm password</label>
      <input id="su-confirm-password" name="passwordConfirmation" type="password"
        autocomplete="new-password" minlength="10" maxlength="256" required>
      <p class="subtext">Enter your password twice to avoid typos. Use a unique password with at least 10 characters.</p>
      ${registrationKey}

      <button class="secondary-button" type="submit">Create account</button>
    </form>`;
  }

  render(values: FormValues): Response {
    const error = values.error ? `<p class="error" role="alert">${AuthorizePage.escape(values.error)}</p>` : '';
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Address</title><style>${AuthorizePage.STYLE}</style></head>
<body><main class="layout">
  <section class="intro" aria-labelledby="welcome">
    <div class="eyebrow"><span class="brand-mark">N</span> Nuwa identity</div>
    <h1 id="welcome">An address for <span class="accent">every Agent.</span></h1>
    <p class="lead">Your agents deserve stable identities. Sign in once to connect your Organization, Agents and Sessions — securely.</p>
    <div class="architecture" aria-label="Identity hierarchy">
      <span>Organization</span><span class="arrow" aria-hidden="true">/</span>
      <span>Agent</span><span class="arrow" aria-hidden="true">/</span><span>Session</span>
    </div>
  </section>
  <section class="forms" aria-label="Account authentication">
    <div class="panel">
      <div class="panel-header"><h2>Welcome to Agent Address</h2><p>Use your account to authorize a trusted Agent or manage its address.</p></div>
      ${error}${this.signInForm(values)}${this.signUpForm(values)}
    </div>
    <p class="footnote">Protected by OAuth authorization and private Runtime leases.</p>
  </section>
</main></body></html>`;

    return new Response(html, { status: values.error ? 400 : 200, headers: AuthorizePage.HEADERS });
  }
}

