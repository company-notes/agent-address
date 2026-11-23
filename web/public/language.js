/* Shared visitor-facing language service for Agent Address OAuth and Portal. */
(function () {
  'use strict';

  var STORAGE_KEY = 'nuwa.relay.language';
  var textTranslations = {
    "Agent Address · Organization Portal": ["Agent Address · 組織管理", "Agent Address · 组织管理"],
    "Organization sign-in": ["組織登入", "组织登录"],
    "Sign in with your Agent Address email account to manage your Agents and Sessions.": ["使用 Agent Address 帳號登入，以管理您的 Agent 和 Session。", "使用 Agent Address 账号登录，管理您的 Agent 和 Session。"],
    "Sign in or create an account": ["登入或建立帳號", "登录或创建账号"],
    "Sign out": ["登出", "退出登录"],
    "Register your Organization": ["登記您的組織", "注册您的组织"],
    "Organization handle": ["組織識別碼", "组织标识码"],
    "Display name": ["顯示名稱", "显示名称"],
    "Register Organization": ["登記組織", "注册组织"],
    "Organization": ["組織", "组织"],
    "Your Agents": ["您的 Agents", "您的 Agents"],
    "Sessions": ["Sessions", "Sessions"],
    "Edit Agent": ["編輯 Agent", "编辑 Agent"],
    "Archive this Agent?": ["要封存這個 Agent 嗎？", "要归档这个 Agent 吗？"],
    "All Sessions will be archived and their Runtime leases revoked.": ["所有 Session 都將被封存，Runtime 租約也會撤銷。", "所有 Session 都将被归档，Runtime 租约也将撤销。"],
    "Archive Agent": ["封存 Agent", "归档 Agent"],
    "Create an Agent": ["建立 Agent", "创建 Agent"],
    "Agent handle (optional)": ["Agent 識別碼（選填）", "Agent 标识码（选填）"],
    "Agent display name (optional)": ["Agent 顯示名稱（選填）", "Agent 显示名称（选填）"],
    "Default Session handle (optional)": ["預設 Session 識別碼（選填）", "默认 Session 标识码（选填）"],
    "Default Session display name (optional)": ["預設 Session 顯示名稱（選填）", "默认 Session 显示名称（选填）"],
    "Create Agent": ["建立 Agent", "创建 Agent"],
    "Default Session": ["預設 Session", "默认 Session"],
    "Active Runtime": ["執行中的 Runtime", "运行中的 Runtime"],
    "Unnamed": ["未命名", "未命名"],
    "Available": ["可用", "可用"],
    "Edit Session": ["編輯 Session", "编辑 Session"],
    "Make Default": ["設為預設", "设为默认"],
    "Replace this Session's resume token?": ["要替換此 Session 的恢復權杖嗎？", "要替换此 Session 的恢复令牌吗？"],
    "The previous resume token will stop working immediately.": ["舊恢復權杖將立即失效。", "旧恢复令牌将立即失效。"],
    "Rotate Token": ["輪換權杖", "轮换令牌"],
    "Rotate Resume Token": ["輪換恢復權杖", "轮换恢复令牌"],
    "Archive this Session?": ["要封存此 Session 嗎？", "要归档此 Session 吗？"],
    "This permanently revokes its Runtime lease and resume capability.": ["這將永久撤銷其 Runtime 租約與恢復能力。", "这将永久撤销其 Runtime 租约和恢复能力。"],
    "Archive Session": ["封存 Session", "归档 Session"],
    "New Session handle (optional)": ["新 Session 識別碼（選填）", "新 Session 标识码（选填）"],
    "New Session display name (optional)": ["新 Session 顯示名稱（選填）", "新 Session 显示名称（选填）"],
    "Create Session": ["建立 Session", "创建 Session"],
    "Choose an Agent to inspect its Sessions.": ["請選擇 Agent 以檢視其 Sessions。", "请选择 Agent 以查看其 Sessions。"],
    "Resume token replaced": ["恢復權杖已替換", "恢复令牌已替换"],
    "Created": ["已建立", "已创建"],
    "Save this one-time resume token securely. A Runtime needs it to resume this Session.": ["請妥善保存這個只顯示一次的恢復權杖。Runtime 需要它才能恢復此 Session。", "请妥善保存这个仅显示一次的恢复令牌。Runtime 需要它才能恢复此 Session。"],
    "Session": ["Session", "Session"],
    "Resume token": ["恢復權杖", "恢复令牌"],
    "Agent address handle": ["Agent 地址識別碼", "Agent 地址标识码"],
    "Session address handle": ["Session 地址識別碼", "Session 地址标识码"],
    "An address handle is required.": ["請填寫地址識別碼。", "请填写地址标识码。"],
    "Edit address handle": ["編輯地址識別碼", "编辑地址标识码"],
    "Edit display name": ["編輯顯示名稱", "编辑显示名称"],
    "Changing a handle changes the canonical address immediately. Old addresses will not be aliased.": ["變更識別碼會立即更新正式地址，舊地址不會保留別名。", "更改标识码会立即更新规范地址，旧地址不会保留别名。"],
    "Save changes": ["儲存變更", "保存更改"],
    "Organization display name": ["組織顯示名稱", "组织显示名称"],
    "Changing the address handle keeps the same Agents and Sessions. Previous handles remain reserved for this Organization.": ["變更地址識別碼不影響既有 Agent 與 Session；舊識別碼仍由此組織保留。", "更改地址标识码不会影响现有 Agent 和 Session；旧标识码仍由此组织保留。"],
    "Save Organization": ["儲存組織", "保存组织"],
    "Sign in before managing your Organization.": ["請先登入才能管理您的組織。", "请先登录后再管理您的组织。"],
    "Unable to register the Portal OAuth client.": ["無法註冊 Portal OAuth 用戶端。", "无法注册 Portal OAuth 客户端。"],
    "OAuth authorization callback is incomplete or invalid.": ["OAuth 授權回呼不完整或無效。", "OAuth 授权回调不完整或无效。"],
    "Unable to exchange OAuth authorization code.": ["無法交換 OAuth 授權碼。", "无法交换 OAuth 授权码。"],
    "Unable to load the Portal.": ["無法載入管理頁面。", "无法加载管理页面。"],
    "The operation failed.": ["操作失敗。", "操作失败。"],
    "Sign in to your account": ["登入您的帳號", "登录您的账号"],
    "Email": ["電子郵件", "电子邮箱"],
    "Password": ["密碼", "密码"],
    "Sign in securely": ["安全登入", "安全登录"],
    "Create an account": ["建立帳號", "创建账号"],
    "Organization name": ["組織名稱", "组织名称"],
    "Your company or team name": ["您的公司或團隊名稱", "您的公司或团队名称"],
    "Organization address handle": ["組織地址識別碼", "组织地址标识码"],
    "Your Agent addresses will start with this unique handle. Names and handles cannot belong to another Organization.": ["您的 Agent 地址將以此唯一識別碼開頭。組織名稱及識別碼不可與其他組織重複。", "您的 Agent 地址将以此唯一标识码开头。组织名称和标识码不能与其他组织重复。"],
    "Password (10+ characters)": ["密碼（至少 10 個字元）", "密码（至少 10 个字符）"],
    "Confirm password": ["確認密碼", "确认密码"],
    "Enter your password twice to avoid typos. Use a unique password with at least 10 characters.": ["請輸入兩次密碼以避免打錯，並使用至少 10 個字元的專屬密碼。", "请重复输入密码以避免错误，并使用至少 10 个字符的独立密码。"],
    "Registration key": ["註冊金鑰", "注册密钥"],
    "Create account": ["建立帳號", "创建账号"],
    "Secure identity · One Organization, many Agents": ["安全身分 · 一個組織、多個 Agent", "安全身份 · 一个组织、多个 Agent"],
    "An address for": ["一個專屬地址，給", "一个专属地址，给"],
    "every Agent.": ["每個 Agent。", "每个 Agent。"],
    "Give your AI team an address that lasts. Create your Organization once, then connect Agents and Sessions across platforms.": ["為您的 AI 團隊建立持久的地址。先建立組織，再跨平台連結 Agent 和 Session。", "为您的 AI 团队创建持久地址。先创建组织，再跨平台连接 Agent 和 Session。"],
    "Identity hierarchy": ["身分層級", "身份层级"],
    "Agent": ["Agent", "Agent"],
    "Choose your Organization name and address handle when you register. Your team starts with the identity you want.": ["註冊時就能自訂組織名稱與地址識別碼，讓團隊從一開始就使用您選擇的身分。", "注册时即可自定义组织名称和地址标识码，让团队从一开始就使用您选择的身份。"],
    "Account authentication": ["帳號驗證", "账号验证"],
    "Welcome to Nuwa": ["歡迎使用 Nuwa", "欢迎使用 Nuwa"],
    "Sign in to continue, or create an account and its Organization together.": ["登入以繼續，或同時建立新帳號與組織。", "登录以继续，或同时创建新账号和组织。"],
    "Create a new account & Organization": ["建立新帳號與組織", "创建新账号和组织"],
    "Protected by OAuth authorization and private Runtime leases.": ["透過 OAuth 授權與私有 Runtime 租約保護。", "通过 OAuth 授权与私有 Runtime 租约保护。"],
    "Passwords do not match. Please try again.": ["密碼不一致，請重試。", "密码不一致，请重试。"],
    "Confirm your password before creating an account.": ["建立帳號前請確認密碼。", "创建账号前请确认密码。"],
    "Email or password is incorrect.": ["電子郵件或密碼不正確。", "电子邮箱或密码不正确。"],
    "An account with that email already exists.": ["此電子郵件已註冊帳號。", "此电子邮箱已注册账号。"],
    "Organization name is already registered.": ["組織名稱已被使用。", "组织名称已被使用。"],
    "Sign-up requires a valid registration key.": ["註冊需要有效的註冊金鑰。", "注册需要有效的注册密钥。"],
    "Enter a valid email address.": ["請輸入有效的電子郵件地址。", "请输入有效的电子邮箱地址。"],
    "Organization name must contain 1-120 characters.": ["組織名稱需為 1 至 120 個字元。", "组织名称需为 1 至 120 个字符。"],
    "Org slug must be 1-63 lowercase letters, numbers, or hyphens, and cannot start/end with a hyphen.": ["組織識別碼需為 1 至 63 個小寫英文字母、數字或連字號，且不能以連字號開頭或結尾。", "组织标识码需为 1 至 63 个小写英文字母、数字或连字符，且不能以连字符开头或结尾。"],
    "Password must be at least 10 characters.": ["密碼至少需要 10 個字元。", "密码至少需要 10 个字符。"],
    "Account already belongs to an Organization.": ["此帳號已屬於某個組織。", "此账号已属于某个组织。"],
    "Register your Organization first.": ["請先登記您的組織。", "请先注册您的组织。"],
    "The authorization request is malformed.": ["授權要求格式錯誤。", "授权请求格式错误。"],
    "Invalid authorization request.": ["無效的授權要求。", "无效的授权请求。"],
    "Unknown authorization form intent.": ["不支援的授權表單操作。", "不支持的授权表单操作。"],
    "Resource not found.": ["找不到資源。", "找不到资源。"],
    "Language": ["語言", "语言"],
  };

  class NuwaLanguageService {
    constructor() {
      this.listeners = new Set();
      this.originalText = new WeakMap();
      this.originalAttributes = new WeakMap();
      this.locale = this.detect();
    }

    parse(code) {
      var tag = String(code || '').toLowerCase();
      if (tag === 'zh-hans' || /^zh-(cn|sg|my)(-|$)/.test(tag)) return 'zh-Hans';
      if (tag === 'zh-hant' || /^zh-(tw|hk|mo)(-|$)/.test(tag) || tag === 'zh') return 'zh-Hant';
      if (tag === 'en' || /^en-/.test(tag)) return 'en';

      return null;
    }

    detect() {
      var saved = null;
      try {
        saved = window.localStorage.getItem(STORAGE_KEY);
      } catch (error) {
        // Browser privacy settings can disable persistent storage.
      }

      if (saved === 'zh-Hant' || saved === 'zh-Hans' || saved === 'en') return saved;

      var languages = navigator.languages && navigator.languages.length
        ? navigator.languages : [navigator.language];
      for (var code of languages) {
        var locale = this.parse(code);
        if (locale) return locale;
      }

      return navigator.language ? 'en' : 'zh-Hant';
    }

    current() {
      return this.locale;
    }

    t(english) {
      if (this.locale === 'en') return english;
      var translated = textTranslations[english];

      return translated ? translated[this.locale === 'zh-Hant' ? 0 : 1] : english;
    }

    subscribe(listener) {
      this.listeners.add(listener);

      return () => this.listeners.delete(listener);
    }

    change(next) {
      if (next !== 'zh-Hant' && next !== 'zh-Hans' && next !== 'en') {
        throw new Error('Unsupported Agent Address language.');
      }
      if (next === this.locale) return;

      this.locale = next;
      document.documentElement.lang = next;

      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch (error) {
        // Manual switching still works in browsers that block storage.
      }

      this.listeners.forEach((listener) => listener());
    }

    translateDocument() {
      document.documentElement.lang = this.locale;

      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        if (!this.originalText.has(node)) this.originalText.set(node, node.nodeValue);

        var original = this.originalText.get(node);
        var label = original.trim();
        if (textTranslations[label]) {
          node.nodeValue = original.replace(label, this.t(label));
        }
      }

      document.querySelectorAll('[placeholder], [aria-label], [title]').forEach((element) => {
        if (!this.originalAttributes.has(element)) {
          var original = {};
          for (var name of ['placeholder', 'aria-label', 'title']) {
            if (element.hasAttribute(name)) original[name] = element.getAttribute(name);
          }
          this.originalAttributes.set(element, original);
        }

        var attributes = this.originalAttributes.get(element);
        for (var name in attributes) {
          if (textTranslations[attributes[name]]) {
            element.setAttribute(name, this.t(attributes[name]));
          }
        }
      });
    }
  }

  window.NuwaLanguage = new NuwaLanguageService();
})();
