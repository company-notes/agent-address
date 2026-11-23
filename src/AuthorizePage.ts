import type { AuthRequest } from '@cloudflare/workers-oauth-provider';

export type FormValues = {
  intent: 'signin' | 'signup';
  email: string;
  organizationSlug: string;
  organizationDisplayName: string;
  error: string | null;
  needsRegistrationKey: boolean;
};

export class AuthorizePage {
  static readonly HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
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
      color-scheme: light;
      font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
        "Noto Sans TC", Arial, sans-serif;
      font-synthesis: none;
      --ink: #193331;
      --muted: #59706d;
      --green: #126857;
      --cream: #f7f8f3;
      --line: #dce6e0;
      background: var(--cream);
      color: var(--ink);
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; line-height: 1.65; }
    .masthead {
      border-bottom: 1px solid var(--line);
      background: rgba(247, 248, 243, .97);
    }
    .masthead-inner {
      max-width: 1220px; margin: auto; padding: 17px 28px;
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
    }
    .brand {
      display: inline-flex; align-items: center; gap: 11px;
      color: var(--ink); font-size: 23px; font-weight: 800;
      letter-spacing: -.07em; text-decoration: none;
    }
    .brand small { font-size: 16px; color: var(--muted); font-weight: 500; letter-spacing: -.02em; }
    .brand-mark {
      display: grid; place-items: center; width: 34px; height: 34px;
      border-radius: 12px 4px 12px 4px; background: var(--green); color: white;
      font-size: 20px; transform: rotate(-7deg);
    }
    .masthead-note { color: var(--muted); font-size: 13px; font-weight: 600; }
    .language-picker { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
    .language-picker label { margin: 0; white-space: nowrap; }
    .language-picker select {
      border: 1px solid #bed3c5; background: white; color: var(--ink);
      border-radius: 9px; padding: 7px 9px; font: inherit; font-size: 13px;
    }
    .language-picker select:focus-visible { outline: 3px solid #6fb9a5; outline-offset: 2px; }
    .layout {
      max-width: 1220px; margin: 0 auto; padding: 54px 28px 80px;
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 480px);
      align-items: start; gap: clamp(32px, 5vw, 70px);
    }
    .intro {
      background: #14392f; color: #f6fff9;
      border-radius: 23px; min-height: 620px;
      padding: clamp(36px, 4vw, 65px);
      position: relative; overflow: hidden;
    }
    .intro::after {
      content: ""; position: absolute; width: 340px; height: 340px;
      top: -160px; right: -160px; border-radius: 50%;
      background: rgba(67, 139, 109, .28); filter: blur(45px);
      pointer-events: none;
    }
    .eyebrow { color: #a4e6cf; font-size: 12px; letter-spacing: .14em; font-weight: 850; }
    h1 { font-size: clamp(40px, 4.7vw, 62px); line-height: 1.16; letter-spacing: -.07em; margin: 28px 0 23px; }
    .accent { color: #c6f3a5; }
    .lead { max-width: 32rem; color: #d5e7de; font-size: 17px; line-height: 1.9; }
    .architecture {
      display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 37px;
      color: #e5f3ea; font-size: 13px; font-weight: 700;
    }
    .architecture span:not(.arrow) {
      background: rgba(255, 255, 255, .09); border: 1px solid #5c8f7d;
      padding: 11px 13px; border-radius: 11px;
    }
    .arrow { color: #a8d7bf; }
    .hero-note { color: #b1d3c0; font-size: 13px; margin-top: 42px; max-width: 29rem; }
    .forms { min-width: 0; }
    .panel {
      border: 1px solid var(--line); border-radius: 19px;
      background: white; box-shadow: 0 18px 55px rgba(34, 67, 53, .08); overflow: hidden;
    }
    .panel-header { background: #edf4ef; border-bottom: 1px solid var(--line); padding: 27px 30px 22px; }
    .panel-header h2 { font-size: 25px; margin: 0 0 7px; letter-spacing: -.045em; }
    .panel-header p { margin: 0; color: var(--muted); font-size: 14px; }
    .auth-card { margin: 0; padding: 22px 30px 28px; }
    .auth-card h3 { font-size: 17px; margin: 0 0 8px; }
    label { display: block; margin: 14px 0 6px; font-size: 13px; font-weight: 750; color: var(--ink); }
    input:not([type="hidden"]) {
      width: 100%; min-height: 46px; padding: 11px 13px;
      border: 1px solid #bed1c6; border-radius: 9px; background: #fff; color: var(--ink);
      font: inherit; transition: border-color .15s ease, box-shadow .15s ease;
    }
    input::placeholder { color: #849991; }
    input:focus-visible, button:focus-visible, summary:focus-visible {
      outline: 3px solid #6fb9a5; outline-offset: 2px;
    }
    button {
      width: 100%; min-height: 46px; margin-top: 20px; padding: 11px 16px;
      border: none; border-radius: 10px; background: #126857; color: white;
      font: inherit; font-size: 15px; font-weight: 800; cursor: pointer;
      transition: background .15s ease;
    }
    button:hover { background: #0d5143; }
    .secondary-button { background: #c6f3a5; color: #14392f; }
    .secondary-button:hover { background: #b6e895; }
    .signup-disclosure { border-top: 1px solid var(--line); }
    .signup-disclosure summary {
      padding: 19px 30px; cursor: pointer; font-size: 14px; font-weight: 800;
      color: var(--green); background: #fafcf9;
    }
    .signup-disclosure[open] summary { border-bottom: 1px solid var(--line); background: #edf4ef; }
    .signup-disclosure .auth-card { padding-top: 24px; }
    .subtext { font-size: 12px; margin: 7px 0 0; line-height: 1.65; color: var(--muted); }
    .error {
      margin: 20px 30px 0; padding: 13px 15px; border: 1px solid #e8b8ab;
      border-radius: 10px; background: #fff2ee; color: #8d3324; line-height: 1.55;
    }
    .footnote { text-align: center; margin: 20px 0 0; color: var(--muted); font-size: 12px; }
    @media (max-width: 950px) {
      .layout { max-width: 660px; grid-template-columns: 1fr; padding: 28px 22px 60px; gap: 24px; }
      .intro { min-height: auto; padding: 31px; }
      h1 { margin: 17px 0 12px; }
      .architecture { margin-top: 22px; }
      .hero-note { margin-top: 24px; }
    }
    @media (max-width: 480px) {
      .masthead-inner { padding: 14px 20px; }
      .masthead-note { display: none; }
      .brand { font-size: 19px; }
      .brand small { font-size: 12px; }
      .language-picker label { display: none; }
      .intro { padding: 26px 23px; }
      .layout { padding: 18px 14px 48px; }
      .auth-card { padding: 20px; }
      .signup-disclosure summary { padding: 18px 20px; }
      .panel-header { padding: 22px 20px; }
      .error { margin: 18px 20px 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      button, input { transition: none; }
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
      <label for="su-org-name">Organization name</label>
      <input id="su-org-name" name="organizationDisplayName" type="text" autocomplete="organization"
        placeholder="Your company or team name" maxlength="120" required value="${values.intent === 'signup'
          ? AuthorizePage.escape(values.organizationDisplayName) : ''}">
      <label for="su-org-slug">Organization address handle</label>
      <input id="su-org-slug" name="organizationSlug" type="text" autocomplete="off"
        placeholder="e.g. nuwainfo" minlength="1" maxlength="63"
        pattern="[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?" required value="${values.intent === 'signup'
          ? AuthorizePage.escape(values.organizationSlug) : ''}">
      <p class="subtext">Your Agent addresses will start with this unique handle. Names and handles cannot belong to another Organization.</p>
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
<title>Agent Address</title><style>${AuthorizePage.STYLE}</style>
<script defer src="/ui/language.js"></script><script defer src="/ui/authorize-language.js"></script></head>
<body><header class="masthead"><div class="masthead-inner">
  <div class="brand"><span class="brand-mark">N</span> Nuwa <small>Agent Address</small></div>
  <span class="masthead-note">Secure identity · One Organization, many Agents</span>
  <div class="language-picker"><label for="language">語言 / Language</label>
    <select id="language" aria-label="Language"><option value="zh-Hant">繁體中文</option>
    <option value="zh-Hans">简体中文</option><option value="en">English</option></select>
  </div>
</div></header><main class="layout">
  <section class="intro" aria-labelledby="welcome">
    <div class="eyebrow">NUWA · IDENTITY &amp; CONNECTIONS</div>
    <h1 id="welcome">An address for <span class="accent">every Agent.</span></h1>
    <p class="lead">Give your AI team an address that lasts. Create your Organization once, then connect Agents and Sessions across platforms.</p>
    <div class="architecture" aria-label="Identity hierarchy">
      <span>Organization</span><span class="arrow" aria-hidden="true">/</span>
      <span>Agent</span><span class="arrow" aria-hidden="true">/</span><span>Session</span>
    </div>
    <p class="hero-note">Choose your Organization name and address handle when you register. Your team starts with the identity you want.</p>
  </section>
  <section class="forms" aria-label="Account authentication">
    <div class="panel">
      <div class="panel-header"><h2>Welcome to Nuwa</h2><p>Sign in to continue, or create an account and its Organization together.</p></div>
      ${error}${this.signInForm(values)}
      <details class="signup-disclosure" ${values.intent === 'signup' ? 'open' : ''}>
        <summary>Create a new account &amp; Organization</summary>
        ${this.signUpForm(values)}
      </details>
    </div>
    <p class="footnote">Protected by OAuth authorization and private Runtime leases.</p>
  </section>
</main></body></html>`;

    return new Response(html, { status: values.error ? 400 : 200, headers: AuthorizePage.HEADERS });
  }
}

