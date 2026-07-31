"use strict";

(() => {
  const API_BASE = "/api/v1";
  const MODEL_OPTIONS = Object.freeze([
    "5.6 Sol",
    "5.6 Terra",
    "5.6 Luna",
    "5.5",
    "5.4",
    "5.4 Mini",
    "5.3 Codex Spark",
  ]);
  const EFFORT_OPTIONS = Object.freeze(["Low", "Medium", "High", "Xhigh"]);
  const SPEED_OPTIONS = Object.freeze(["Standard", "Fast"]);
  const DEFAULT_FILE_LIMITS = Object.freeze({
    maxFiles: 12,
    maxImages: 4,
    maxBytesPerFile: 25 * 1024 * 1024,
    maxTotalBytes: 100 * 1024 * 1024,
  });
  const IMAGE_MIME_BY_EXTENSION = Object.freeze({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" });
  const BLOCKED_ATTACHMENT_EXTENSIONS = new Set([
    "exe", "dll", "msi", "msp", "msix", "appx", "com", "scr", "cpl", "sys",
    "lnk", "url", "reg", "chm", "iso", "img", "vhd", "vhdx",
  ]);
  const DEFAULT_CONFIG = Object.freeze({ model: "5.6 Sol", effort: "Xhigh", speed: "Standard" });
  const ACTIVE_STATUSES = new Set(["queued", "pending", "starting", "running", "cancelling", "canceling"]);
  const FINISHED_STATUSES = new Set(["completed", "succeeded", "success", "failed", "error", "cancelled", "canceled"]);
  const STATUS_LABELS = Object.freeze({
    idle: "等待任务",
    queued: "等待执行",
    pending: "准备中",
    starting: "正在启动",
    running: "运行中",
    cancelling: "正在取消",
    canceling: "正在取消",
    cancelled: "已取消",
    canceled: "已取消",
    completed: "已完成",
    succeeded: "已完成",
    success: "已完成",
    failed: "执行失败",
    error: "发生错误",
  });
  const EVENT_MESSAGE_LABELS = Object.freeze({
    "Task queued.": "任务已进入执行队列。",
    "Codex worker started.": "Codex 运行进程已启动。",
    "Codex thread started.": "Codex 会话已建立。",
    "Codex is working.": "Codex 正在处理任务。",
    "Codex turn completed.": "Codex 本轮执行完成。",
    "Task completed.": "任务已完成。",
    "Task failed.": "任务执行失败。",
  });
  const LANGUAGE_STORAGE_KEY = "codex.language";
  const I18N = window.AGENT_GATEWAY_I18N;
  const CRITICAL_UI_TRANSLATIONS = Object.freeze({
    ja: Object.freeze({
      "FIRST-RUN CONFIRMATION · 2026-07-29": "初回起動の確認 · 2026-07-29",
      "API GATEWAY MONITOR": "API ゲートウェイ監視", "CREATE TASK": "タスク作成", "OPENAI HOST": "OpenAI Host", "REST API": "REST API",
      "All API keys": "すべての API キー",
      "Finished calls": "完了した呼び出し", "Host status unavailable": "Host の状態を取得できません", "Loading Host status": "Host 状態を読み込み中", "Waiting for calls": "呼び出し待ち",
      "DEVELOPER ACCESS": "開発者アクセス", "Model API keys": "モデル API キー",
      "Create Codex Gateway API keys for other applications. Each key locks the model, reasoning effort, speed, and file permissions; it is not an OpenAI API key.": "他のアプリケーションで使用する Codex Gateway API キーを作成します。各キーにはモデル、推論強度、速度、ファイル権限が固定されます。OpenAI API キーではありません。",
      "Hashes only": "ハッシュのみ", "Advanced settings": "詳細設定", "Refresh keys": "キーを更新", "Create access key": "アクセスキーを作成",
      "Callers only submit a prompt and project; the key enforces the runtime configuration.": "呼び出し側はプロンプトとプロジェクトだけを送信し、実行設定はキーによって強制されます。",
      "Generate API Key": "API キーを生成", "Created keys": "作成済みキー", "Use from other applications": "他のアプリケーションから使用",
      "Put the key in the Authorization header, not in the URL.": "キーは URL ではなく Authorization ヘッダーに指定します。", "Copy example": "例をコピー",
      "A valid Bearer token is required.": "有効な Bearer トークンが必要です。",
    }),
    ko: Object.freeze({
      "FIRST-RUN CONFIRMATION · 2026-07-29": "최초 실행 확인 · 2026-07-29",
      "CREATE TASK": "작업 생성", "Host status unavailable": "Host 상태를 확인할 수 없음", "Loading Host status": "Host 상태 불러오는 중",
      "DEVELOPER ACCESS": "개발자 액세스", "Model API keys": "모델 API 키",
      "Create Codex Gateway API keys for other applications. Each key locks the model, reasoning effort, speed, and file permissions; it is not an OpenAI API key.": "다른 애플리케이션에서 사용할 Codex Gateway API 키를 만듭니다. 각 키에는 모델, 추론 강도, 속도와 파일 권한이 고정되며 OpenAI API 키가 아닙니다.",
      "Hashes only": "해시만 저장", "Advanced settings": "고급 설정", "Refresh keys": "키 새로고침", "Create access key": "액세스 키 만들기",
      "Callers only submit a prompt and project; the key enforces the runtime configuration.": "호출자는 프롬프트와 프로젝트만 보내며 실행 설정은 키가 강제합니다.",
      "Generate API Key": "API 키 생성", "Created keys": "생성된 키", "Use from other applications": "다른 애플리케이션에서 사용",
      "Put the key in the Authorization header, not in the URL.": "키는 URL이 아니라 Authorization 헤더에 넣으세요.", "Copy example": "예제 복사",
      "A valid Bearer token is required.": "유효한 Bearer 토큰이 필요합니다.",
    }),
    es: Object.freeze({
      "FIRST-RUN CONFIRMATION · 2026-07-29": "CONFIRMACIÓN DEL PRIMER INICIO · 2026-07-29",
      "Host status unavailable": "Estado del Host no disponible", "Loading Host status": "Cargando el estado del Host",
      "DEVELOPER ACCESS": "ACCESO PARA DESARROLLADORES", "Model API keys": "Claves API del modelo", "Hashes only": "Solo hashes",
      "Advanced settings": "Opciones avanzadas", "Refresh keys": "Actualizar claves", "Create access key": "Crear clave de acceso",
      "Generate API Key": "Generar clave API", "Created keys": "Claves creadas", "Use from other applications": "Usar desde otras aplicaciones",
      "Put the key in the Authorization header, not in the URL.": "Coloca la clave en el encabezado Authorization, no en la URL.", "Copy example": "Copiar ejemplo",
      "A valid Bearer token is required.": "Se requiere un token Bearer válido.",
    }),
    fr: Object.freeze({
      "FIRST-RUN CONFIRMATION · 2026-07-29": "CONFIRMATION DU PREMIER DÉMARRAGE · 2026-07-29",
      "CREATE TASK": "CRÉER UNE TÂCHE", "Host status unavailable": "État du Host indisponible", "Loading Host status": "Chargement de l’état du Host",
      "DEVELOPER ACCESS": "ACCÈS DÉVELOPPEUR", "Model API keys": "Clés API du modèle", "Hashes only": "Hachages uniquement",
      "Advanced settings": "Paramètres avancés", "Refresh keys": "Actualiser les clés", "Create access key": "Créer une clé d’accès",
      "Generate API Key": "Générer une clé API", "Created keys": "Clés créées", "Use from other applications": "Utiliser depuis d’autres applications",
      "Put the key in the Authorization header, not in the URL.": "Placez la clé dans l’en-tête Authorization, pas dans l’URL.", "Copy example": "Copier l’exemple",
      "A valid Bearer token is required.": "Un jeton Bearer valide est requis.",
    }),
    de: Object.freeze({
      "FIRST-RUN CONFIRMATION · 2026-07-29": "BESTÄTIGUNG DES ERSTEN STARTS · 2026-07-29",
      "CREATE TASK": "AUFGABE ERSTELLEN", "Host status unavailable": "Host-Status nicht verfügbar", "Loading Host status": "Host-Status wird geladen",
      "DEVELOPER ACCESS": "ENTWICKLERZUGANG", "Model API keys": "Modell-API-Schlüssel", "Hashes only": "Nur Hashes",
      "Advanced settings": "Erweiterte Einstellungen", "Refresh keys": "Schlüssel aktualisieren", "Create access key": "Zugriffsschlüssel erstellen",
      "Generate API Key": "API-Schlüssel generieren", "Created keys": "Erstellte Schlüssel", "Use from other applications": "Aus anderen Anwendungen verwenden",
      "Put the key in the Authorization header, not in the URL.": "Den Schlüssel im Authorization-Header und nicht in der URL angeben.", "Copy example": "Beispiel kopieren",
      "A valid Bearer token is required.": "Ein gültiges Bearer-Token ist erforderlich.",
    }),
    pt: Object.freeze({
      "FIRST-RUN CONFIRMATION · 2026-07-29": "CONFIRMAÇÃO DA PRIMEIRA EXECUÇÃO · 2026-07-29",
      "CREATE TASK": "CRIAR TAREFA", "Host status unavailable": "Estado do Host indisponível", "Loading Host status": "Carregando o estado do Host",
      "DEVELOPER ACCESS": "ACESSO DO DESENVOLVEDOR", "Model API keys": "Chaves API do modelo", "Hashes only": "Somente hashes",
      "Advanced settings": "Configurações avançadas", "Refresh keys": "Atualizar chaves", "Create access key": "Criar chave de acesso",
      "Generate API Key": "Gerar chave API", "Created keys": "Chaves criadas", "Use from other applications": "Usar em outros aplicativos",
      "Put the key in the Authorization header, not in the URL.": "Coloque a chave no cabeçalho Authorization, não na URL.", "Copy example": "Copiar exemplo",
      "A valid Bearer token is required.": "É necessário um token Bearer válido.",
    }),
    tr: Object.freeze({
      "FIRST-RUN CONFIRMATION · 2026-07-29": "İLK ÇALIŞTIRMA ONAYI · 2026-07-29",
      "Host status unavailable": "Host durumu kullanılamıyor", "Loading Host status": "Host durumu yükleniyor", "OPENAI HOST": "OPENAI HOST", Token: "Token",
      "DEVELOPER ACCESS": "GELİŞTİRİCİ ERİŞİMİ", "Model API keys": "Model API anahtarları",
      "Create Codex Gateway API keys for other applications. Each key locks the model, reasoning effort, speed, and file permissions; it is not an OpenAI API key.": "Diğer uygulamalarda kullanmak için Codex Gateway API anahtarları oluşturun. Her anahtar modeli, akıl yürütme düzeyini, hızı ve dosya izinlerini sabitler; OpenAI API anahtarı değildir.",
      "Hashes only": "Yalnızca hashler", "Advanced settings": "Gelişmiş ayarlar", "Refresh keys": "Anahtarları yenile", "Create access key": "Erişim anahtarı oluştur",
      "Callers only submit a prompt and project; the key enforces the runtime configuration.": "Çağıran taraf yalnızca istemi ve projeyi gönderir; çalışma zamanı yapılandırmasını anahtar zorunlu kılar.",
      "Generate API Key": "API anahtarı oluştur", "Created keys": "Oluşturulan anahtarlar", "Use from other applications": "Diğer uygulamalardan kullan",
      "Put the key in the Authorization header, not in the URL.": "Anahtarı URL’ye değil Authorization başlığına koyun.", "Copy example": "Örneği kopyala",
      "A valid Bearer token is required.": "Geçerli bir Bearer token gereklidir.",
    }),
  });
  const THEME_STORAGE_KEY = "codex.theme";
  const LOCAL_TERMS_VERSION = "2026-07-29";
  const LOCAL_TERMS_STORAGE_KEY = "agent-gateway.local-terms.accepted-version";
  const EN_TEXT = Object.freeze({
    "设置": "Settings",
    "打开设置": "Open settings",
    "关闭设置": "Close settings",
    "在这里管理外观、本地 API 端口、免费公网 Host、更新和诊断。": "Manage appearance, the local API port, free public Host, updates, and diagnostics.",
    "在这里管理外观、本地 API 端口、更新和诊断；Online Host 由平台账号管理。": "Manage appearance, the local API port, updates, and diagnostics; Online Host is managed through your platform account.",
    "设置工具已就绪": "Settings tools are ready",
    "仅桌面应用支持更新与诊断。": "Updates and diagnostics are available in the desktop app only.",
    "最小化到托盘": "Minimize to tray",
    "关闭或最小化窗口后保持 Host 与本地 API 运行": "Keep the Host and local API running after closing or minimizing the window",
    "已开启托盘模式，关闭窗口后 Host 将继续运行。": "Tray mode enabled. The Host will keep running after the window closes.",
    "托盘模式已关闭，关闭窗口将退出程序。": "Tray mode disabled. Closing the window will exit the application.",
    "无法更新托盘设置。": "Unable to update the tray setting.",
    "固定 API 端口": "Fixed API port",
    "默认为 4310；修改后重启程序生效": "Defaults to 4310; restart the app after changing it",
    "当前由 CODEX_DESKTOP_PORT 覆盖；保存值将在移除变量后生效": "Currently overridden by CODEX_DESKTOP_PORT; the saved value applies after removing it",
    "保存": "Save",
    "免费公网 Host": "Free public Host",
    "正在检查 Tailscale 与 Funnel 状态…": "Checking Tailscale and Funnel status…",
    "刷新公网 Host 状态": "Refresh public Host status",
    "刷新": "Refresh",
    "开启公网": "Go online",
    "关闭公网": "Turn off public Host",
    "确认公开到互联网": "Confirm public access",
    "正在检查": "Checking",
    "正在开启…": "Going online…",
    "正在关闭…": "Turning off…",
    "已连接，等待开启": "Connected, ready to enable",
    "公网已开启": "Public Host online",
    "尚未安装": "Not installed",
    "等待 Tailscale 连接": "Waiting for Tailscale",
    "配置冲突": "Configuration conflict",
    "状态不可用": "Status unavailable",
    "安装 Tailscale": "Install Tailscale",
    "打开操作页面": "Open action page",
    "复制 base_url": "Copy base_url",
    "公网调用必须使用 ": "Public calls must use ",
    "；管理员凭据不会通过此处分享。电脑和本程序必须保持运行。": "; administrator credentials are never shared here. Keep this computer and app running.",
    "公网 base_url 已复制。": "Public base_url copied.",
    "公网 Host 已开启。请保持本程序运行。": "Public Host is online. Keep this app running.",
    "公网 Host 已关闭。": "Public Host is offline.",
    "本地 Host": "Local Host",
    "公网 Host": "Public Host",
    "公网未开启": "Public offline",
    "查看公网 Host": "View Public Host",
    "切换到本地 Host": "Switch to Local Host",
    "公网 Host 未开启": "Public Host is offline",
    "公网 Host 尚未开启，请在设置中开启。": "The Public Host is offline. Enable it in Settings.",
    "检查公网": "Check online",
    "检查公网 Host": "Check Public Host",
    "检查中…": "Checking…",
    "再次检查": "Check again",
    "仅桌面应用可以检查公网 Host。": "Public Host checks are available only in the desktop app.",
    "正在从外部地址检查公网 Host…": "Checking the Public Host through its external address…",
    "公网 Host 检查成功。": "Public Host check passed.",
    "公网 Host 检查失败。": "Public Host check failed.",
    "API Host 当前已关闭，公网请求仍会返回 503；请在首页重新开启 Host。": "The API Host is disabled, so public requests still return 503. Re-enable it on the dashboard.",
    "仅桌面应用支持一键 Tailscale Funnel。": "One-click Tailscale Funnel is available only in the desktop app.",
    "外观模式": "Appearance",
    "选择适合当前环境的界面颜色": "Choose interface colors for your environment",
    "暗色": "Dark",
    "亮色": "Light",
    "已切换为暗色模式。": "Dark mode enabled.",
    "已切换为亮色模式。": "Light mode enabled.",
    "正式版与本地数据": "Release & local data",
    "条款、隐私与安全": "Terms, privacy & security",
    "查看当前版本的本地法律和安全说明": "Review the current local legal and security notices",
    "使用 Agent Gateway 前请确认": "Before using Agent Gateway",
    "Agent Gateway 是个人维护的开源项目。默认服务仅监听本机；模型调用可能把提示词和你授权的文件交给所使用的 Coding Agent 与模型服务商处理。": "Agent Gateway is an individually maintained open-source project. The service listens locally by default; model calls may send prompts and files you authorize to the selected coding agent and model provider.",
    "本地优先：": "Local-first:",
    "安装本身不会自动公开你的电脑或 API。": "Installation alone does not expose your computer or API to the internet.",
    "保护密钥：": "Protect keys:",
    " 是敏感 Gateway Key，不是 OpenAI API Key。": " is a sensitive Gateway key, not an OpenAI API key.",
    "最低权限：": "Least privilege:",
    "AI Agent 可在授权范围内读取、修改或删除文件。": "An AI agent may read, change, or delete files within the permissions you grant.",
    "法律与安全文件": "Legal and security documents",
    "本地版使用条款": "Desktop Terms",
    "隐私说明": "Privacy Notice",
    "安全说明": "Security Policy",
    "我同意《本地版安装与使用确认》，并确认已阅读《隐私说明》和《安全说明》。": "I agree to the Desktop Installation and Use Terms and acknowledge the Privacy Notice and Security Policy.",
    "同意并进入 Agent Gateway": "Agree and open Agent Gateway",
    "如果不同意，请关闭本程序。新条款版本发布后可能需要再次确认。": "If you do not agree, close the application. A new terms version may require renewed acceptance.",
    "检查 GitHub 正式版本，安全备份本地 API Key 与用量，并导出不含密钥和提示词的诊断报告。": "Check GitHub releases, safely back up local API keys and usage, and export diagnostics without keys or prompts.",
    "当前版本": "Current version",
    "检查更新": "Check for updates",
    "连接 GitHub Releases，不会上传项目数据": "Connects to GitHub Releases without uploading project data",
    "查看新版本": "View new version",
    "打开 GitHub Release 页面": "Open the GitHub Release page",
    "导出备份": "Export backup",
    "API Key 使用 Windows 加密形式保存": "API keys remain encrypted with Windows secure storage",
    "恢复备份": "Restore backup",
    "恢复前自动创建回滚副本并重启": "Creates a rollback copy before restoring and restarting",
    "导出诊断": "Export diagnostics",
    "不包含提示词、附件内容或认证信息": "Excludes prompts, attachment contents, and authentication data",
    "正式版工具已就绪": "Release tools are ready",
    "升级与普通卸载不会删除本地数据": "Updates and normal uninstall keep local data",
    "正在检查 GitHub 更新…": "Checking GitHub for updates…",
    "当前已是最新版本。": "You are using the latest version.",
    "发现可用的新版本。": "A new version is available.",
    "仅桌面应用支持正式版工具。": "Release tools are available in the desktop app only.",
    "备份已导出。": "Backup exported.",
    "备份导出失败。": "Backup export failed.",
    "备份已恢复，应用正在重启。": "Backup restored. The app is restarting.",
    "备份恢复失败。": "Backup restore failed.",
    "诊断报告已导出。": "Diagnostics exported.",
    "诊断导出失败。": "Diagnostics export failed.",
    "更新检查失败。": "Update check failed.",
    "正在导出备份…": "Exporting backup…",
    "正在恢复备份…": "Restoring backup…",
    "正在导出诊断…": "Exporting diagnostics…",
    "任务历史": "Task history",
    "Agent Gateway 首页": "Agent Gateway home",
    "关闭任务历史": "Close task history",
    "新建任务": "New task",
    "API 测试台": "API Test Bench",
    "辅助诊断工具": "Secondary diagnostic tool",
    "关闭 API 测试台": "Close API Test Bench",
    "关闭测试台": "Close test bench",
    "最近调用": "Recent calls",
    "最近任务": "Recent tasks",
    "刷新历史任务": "Refresh task history",
    "刷新": "Refresh",
    "本地 API": "Local API",
    "API Key 与用量": "API Keys & Usage",
    "未登录": "Not signed in",
    "登录平台以启用 Online Host": "Sign in to enable Online Host",
    "平台账号": "Platform account",
    "登录后可通过平台启用 Online Host，无需安装 Tailscale。": "Sign in to enable Online Host through the platform without installing Tailscale.",
    "在浏览器中安全登录": "Sign in securely in your browser",
    "将在你的 Platform 页面打开登录或注册。验证成功后会自动返回本应用。": "Your Platform page will open for sign-in or registration, then return to this app automatically.",
    "打开 Platform": "Open Platform",
    "使用系统浏览器访问你的平台": "Visit your platform in the system browser",
    "登录或创建账号": "Sign in or create an account",
    "邮箱和密码只提交给平台服务器": "Your email and password are submitted only to the platform server",
    "自动返回": "Return automatically",
    "一次性授权完成后保持登录": "Stay signed in after one-time authorization",
    "前往 Platform 登录": "Continue to Platform",
    "正在等待浏览器授权…": "Waiting for browser authorization…",
    "应用不会接收你的平台密码；授权凭证将由 Windows 安全存储加密。": "The app never receives your platform password; authorization credentials are encrypted with Windows secure storage.",
    "浏览器授权成功。": "Browser authorization completed.",
    "无法完成浏览器授权。": "Could not complete browser authorization.",
    "关闭账号设置": "Close account settings",
    "账号操作": "Account action",
    "登录": "Sign in",
    "创建账号": "Create account",
    "邮箱": "Email",
    "密码": "Password",
    "登录信息将由 Windows 安全存储加密，下次启动无需重复登录。": "Your session is encrypted with Windows secure storage, so you stay signed in after restarting.",
    "已登录": "Signed in",
    "正在验证 Online Host…": "Verifying Online Host…",
    "Online Host 已启用": "Online Host enabled",
    "尚未启用": "Not enabled",
    "启用 Online Host": "Enable Online Host",
    "关闭 Online Host": "Disable Online Host",
    "退出登录": "Sign out",
    "正在连接平台…": "Connecting to platform…",
    "平台登录成功。": "Signed in to the platform.",
    "平台账号已创建。": "Platform account created.",
    "已退出平台账号。": "Signed out of the platform.",
    "Online Host 已通过平台启用。": "Online Host enabled through the platform.",
    "Online Host 已关闭。": "Online Host disabled.",
    "请先登录平台。": "Sign in to the platform first.",
    "仅桌面应用支持平台登录。": "Platform sign-in is available in the desktop app only.",
    "无法退出平台账号。": "Could not sign out of the platform account.",
    "连接平台失败。请确认本地 Platform 正在运行。": "Could not connect to the platform. Make sure the local Platform is running.",
    "打开任务历史": "Open task history",
    "Codex API 控制台": "Codex API Console",
    "生成密钥、调用 Codex、追踪用量": "Generate keys, run Codex, and track usage",
    "API Gateway 监控": "API Gateway Monitor",
    "监控其他程序对 Codex 的实时调用、连接、状态、耗时和 Token，用 API Key 筛选指定调用方。": "Monitor Codex calls, connections, status, latency, and tokens from other applications, filtered by API key.",
    "API Gateway 实时指标": "Live API Gateway metrics",
    "外部 API 任务": "External API tasks",
    "活动连接": "Active connections",
    "SSE 与 WebSocket": "SSE and WebSocket",
    "累计调用": "Cumulative calls",
    "累计 Token": "Cumulative tokens",
    "全部 API Key": "All API keys",
    "当前筛选范围": "Current filter",
    "平均耗时": "Average latency",
    "已结束调用": "Finished calls",
    "API 调用记录": "API call history",
    "监控": "Monitor",
    "选择要监控的 API Key": "Select an API key to monitor",
    "等待 API 调用": "Waiting for API calls",
    "其他程序使用 Gateway Key 后，请求会显示在这里。": "Requests appear here after another application uses a Gateway key.",
    "汇总所有外部程序调用，不包含本地 API 测试台任务。": "Aggregates calls from external applications and excludes local API Test Bench tasks.",
    "模型": "Model",
    "多个模型": "Multiple models",
    "权限": "Permission",
    "按 Key 配置": "Configured per key",
    "上次调用": "Latest call",
    "暂无": "None yet",
    "最近状态": "Latest status",
    "等待调用": "Waiting for calls",
    "Token 统计中": "Calculating tokens",
    "外部 API": "External API",
    "已删除的 Key": "Deleted key",
    "无项目": "No project",
    "项目": "Project",
    "管理 API Key": "Manage API keys",
    "Host 状态不可用": "Host status unavailable",
    "0 个任务含 Token 数据": "0 tasks include token data",
    "是敏感 Gateway Key，不是 OpenAI API Key。": "is a sensitive Gateway key, not an OpenAI API key.",
    "用于验证模型、项目、权限和附件链路；它不是首页的主要工作流。": "Use this to validate models, projects, permissions, and file flows; it is not the primary home workflow.",
    "正在连接": "Connecting",
    "本地用户": "Local user",
    "本地": "Local",
    "Codex 运行环境": "Codex environment",
    "自动检查本机组件和登录状态；默认检测不会调用模型，也不会消耗 Token。": "Automatically checks local components and login status. The default check never calls a model or consumes tokens.",
    "正在检测": "Checking",
    "重新检测": "Check again",
    "内置 Codex 运行组件": "Bundled Codex runtime",
    "验证打包组件与版本": "Validates the packaged component and version",
    "外部 Codex CLI": "External Codex CLI",
    "Codex 桌面 App": "Codex desktop app",
    "Codex 账号": "Codex account",
    "可选组件": "Optional component",
    "只检查登录状态，不读取密钥": "Checks login status only and never reads credentials",
    "首次使用指引": "First-use guide",
    "请先完成 Codex 登录，然后重新检测。": "Sign in to Codex, then run the check again.",
    "连接 ChatGPT": "Connect to ChatGPT",
    "正在连接 ChatGPT…": "Connecting to ChatGPT…",
    "点击连接 ChatGPT，在浏览器中完成登录；程序随后会自动重新检测。": "Select Connect to ChatGPT and complete sign-in in your browser. The app will then check again automatically.",
    "ChatGPT 已连接。": "Connected to ChatGPT.",
    "无法启动 ChatGPT 登录，请重试或复制 codex login 命令。": "Unable to start ChatGPT sign-in. Try again or copy the codex login command.",
    "仅桌面应用支持连接 ChatGPT。": "Connect to ChatGPT is available in the desktop app only.",
    "Codex 登录命令": "Codex login command",
    "复制登录命令": "Copy login command",
    "本地只读检测": "Local read-only check",
    "等待首次检测": "Waiting for the first check",
    "环境已就绪": "Environment ready",
    "需要登录": "Login required",
    "需要检查": "Needs attention",
    "环境不可用": "Environment unavailable",
    "系统不支持": "Unsupported system",
    "可用": "Available",
    "组件缺失": "Component missing",
    "组件异常": "Component error",
    "请重新安装完整版本": "Reinstall the complete application",
    "无法启动内置 Codex 运行组件": "The bundled Codex runtime could not start",
    "不支持当前系统架构": "This system architecture is not supported",
    "已安装": "Installed",
    "未安装（可选）": "Not installed (optional)",
    "不影响内置组件运行": "The bundled runtime can still work",
    "无法启动外部 Codex CLI": "The external Codex CLI could not start",
    "无法检测": "Could not check",
    "Windows 应用状态检测不可用": "Windows app detection is unavailable",
    "已登录": "Signed in",
    "未登录": "Not signed in",
    "状态未知": "Status unknown",
    "ChatGPT 登录": "Signed in with ChatGPT",
    "API Key 登录": "Signed in with API key",
    "Codex 认证可用": "Codex authentication available",
    "运行 codex login 后重新检测": "Run codex login, then check again",
    "登录状态无法确认，请重新检测": "Login status could not be confirmed. Check again.",
    "运行组件需要修复": "Runtime needs repair",
    "内置运行组件不完整，请重新安装完整版本。": "The bundled runtime is incomplete. Reinstall the complete application.",
    "登录后即可使用": "Sign in to continue",
    "在 PowerShell 中运行 codex login，完成登录后点击重新检测。": "Run codex login in PowerShell, then click Check again after signing in.",
    "需要确认登录状态": "Login status needs confirmation",
    "未能确认 Codex 登录状态，请稍后重新检测。": "Codex login status could not be confirmed. Try the check again later.",
    "仅桌面应用支持检测": "Checks are available in the desktop app only",
    "请通过 Agent Gateway 桌面应用运行环境检测。": "Run the environment check from the Agent Gateway desktop app.",
    "检测失败": "Check failed",
    "环境检测失败，请稍后重试。": "The environment check failed. Try again later.",
    "登录命令已复制。": "Login command copied.",
    "模型 API Key": "Model API Keys",
    "为其他程序创建 Codex Gateway API Key。每枚 Key 会锁定模型、推理强度、速度和文件权限；它不是 OpenAI API Key。": "Create Codex Gateway API keys for other applications. Each key locks the model, reasoning effort, speed, and file permissions; it is not an OpenAI API key.",
    "Host 已开启": "Host enabled",
    "Host 已关闭": "Host disabled",
    "关闭 Host": "Disable Host",
    "开启 Host": "Enable Host",
    "仅保存哈希": "Hashes only",
    "高级设置": "Advanced settings",
    "API 高级设置": "API advanced settings",
    "管理每枚 Gateway Key 的 Token 上限和自动销毁时间。": "Manage the token limit and automatic deletion time for each Gateway key.",
    "关闭 API 高级设置": "Close API advanced settings",
    "选择 API Key": "Select API key",
    "Token 上限": "Token limit",
    "达到上限后拒绝新的 AI 任务；留空表示不限制。": "New AI tasks are rejected after the limit is reached. Leave it blank for unlimited usage.",
    "最大累计 Token": "Maximum cumulative tokens",
    "不限制": "Unlimited",
    "当前用量：—": "Current usage: —",
    "到期销毁": "Disable after",
    "到期后永久删除 Key 和本机保存的加密副本。": "Permanently delete the key and its locally stored encrypted copy when it expires.",
    "销毁倒计时": "Disable after",
    "永不销毁": "Never",
    "1 小时后": "After 1 hour",
    "24 小时后": "After 24 hours",
    "7 天后": "After 7 days",
    "30 天后": "After 30 days",
    "90 天后": "After 90 days",
    "自定义时间": "Custom date and time",
    "销毁时间": "Deletion time",
    "当前设置：永不销毁": "Current setting: Never",
    "设置保存在 Host 电脑，并由服务端强制执行。": "Settings are stored on the Host computer and enforced by the server.",
    "取消": "Cancel",
    "保存设置": "Save settings",
    "尚未创建可管理的 API Key。": "No API keys are available to manage.",
    "API Key 高级设置已保存。": "API key advanced settings saved.",
    "无法保存 API Key 高级设置。": "Unable to save API key advanced settings.",
    "请输入有效的 Token 上限。": "Enter a valid token limit.",
    "请选择未来的销毁时间。": "Choose a deletion time in the future.",
    "管理此 API Key": "Manage this API key",
    "已达 Token 上限": "Token limit reached",
    "刷新密钥": "Refresh keys",
    "创建访问密钥": "Create access key",
    "调用方只需提交 prompt 和项目，运行配置由 Key 强制应用。": "Callers only submit a prompt and project; the key enforces the runtime configuration.",
    "密钥名称": "Key name",
    "例如：构建机器人": "For example: Build bot",
    "文件权限": "File permissions",
    "只读": "Read only",
    "仅项目": "Project only",
    "生成 API Key": "Generate API Key",
    "安全保存": "Secure storage",
    "之后可点击眼睛再次查看": "Use the eye button to view it again later",
    "新生成的 API Key": "Newly generated API key",
    "复制": "Copy",
    "隐藏": "Hide",
    "完整密钥已通过 Windows 安全存储加密保存在本机。": "The full key is encrypted locally with Windows secure storage.",
    "已创建的密钥": "Created keys",
    "正在读取…": "Loading…",
    "正在读取本机密钥…": "Loading local keys…",
    "其他程序调用": "Use from other applications",
    "把 Key 放入 Authorization 请求头，不要放在 URL 中。": "Put the key in the Authorization header, not in the URL.",
    "复制示例": "Copy example",
    "Codex 用量": "Codex Usage",
    "持续累计所有桌面任务和 API Key 调用，跨越程序重启保存，直到手动 Reset。": "Continuously totals all desktop tasks and API key calls, persists across restarts, and continues until manually reset.",
    "等待任务数据": "Waiting for task data",
    "再次确认": "Confirm again",
    "刷新统计": "Refresh stats",
    "总 Token": "Total tokens",
    "任务总数": "Total tasks",
    "成功率": "Success rate",
    "已结束任务": "Finished tasks",
    "输入 Token": "Input tokens",
    "包含缓存输入": "Includes cached input",
    "输出 Token": "Output tokens",
    "模型输出": "Model output",
    "缓存 Token": "Cached tokens",
    "输入缓存命中": "Input cache hits",
    "推理 Token": "Reasoning tokens",
    "输出中的推理用量": "Reasoning used in output",
    "Token 构成": "Token breakdown",
    "缓存是输入的一部分，推理是输出的一部分。": "Cached tokens are part of input; reasoning tokens are part of output.",
    "输入占比": "Input share",
    "输出占比": "Output share",
    "输入缓存率": "Input cache rate",
    "输出推理占比": "Output reasoning share",
    "模型用量": "Model usage",
    "显示全部有任务记录的模型，包含运行中与零 Token 任务。": "Shows every model with recorded tasks, including running and zero-token tasks.",
    "全部模型": "All models",
    "运行任务后显示模型分布": "Model distribution appears after tasks run",
    "想让 Codex 完成什么？": "What should Codex do?",
    "描述目标、约束和验收标准，剩下的交给 Codex。": "Describe the goal, constraints, and acceptance criteria, then leave the rest to Codex.",
    "本地优先": "Local first",
    "任务描述": "Task description",
    "已选择的图片": "Selected images",
    "已选择的附件": "Selected attachments",
    "添加图片": "Add images",
    "添加附件": "Add files",
    "添加图片（PNG、JPEG、WebP）": "Add images (PNG, JPEG, WebP)",
    "添加 PDF、Office、代码、文本、压缩包或图片": "Add PDF, Office, code, text, archive, or image files",
    "移除图片": "Remove image",
    "移除附件": "Remove attachment",
    "例如：分析这个项目，修复登录页面的状态同步问题，并为关键流程补充测试……": "For example: Analyze this project, fix state synchronization on the login page, and add tests for critical flows…",
    "运行": "Run",
    "工作目录": "Working directory",
    "工作目录模式": "Working directory mode",
    "使用项目": "Use project",
    "无项目": "No project",
    "选择 Codex 可访问的项目": "Select a project Codex can access",
    "选择目录": "Choose folder",
    "桌面端将打开 Windows 原生目录选择器": "The desktop app will open the native Windows folder picker",
    "文件修改权限": "File modification permission",
    "不修改文件": "Do not modify files",
    "推荐": "Recommended",
    "完全访问": "Full access",
    "谨慎使用": "Use with caution",
    "自动拒绝需确认操作": "Automatically reject approval-required actions",
    "SDK 非交互任务中，需要人工批准的敏感操作会被拒绝": "In non-interactive SDK tasks, sensitive actions that require human approval are rejected",
    "自动拒绝需要人工批准的操作": "Automatically reject actions requiring human approval",
    "Codex 运行配置": "Codex runtime configuration",
    "已就绪": "Ready",
    "为当前配置生成 API Key": "Generate an API key for this configuration",
    "选项": "Options",
    "运行任务": "Run task",
    "取消任务": "Cancel task",
    "任务运行信息": "Task execution information",
    "运行状态": "Run status",
    "等待任务": "Waiting for task",
    "已用时间": "Elapsed time",
    "当前任务": "Current task",
    "执行步骤": "Execution steps",
    "尚未开始": "Not started",
    "文件变更": "File changes",
    "已检测": "Detected",
    "当前模型": "Current model",
    "执行时间线": "Execution timeline",
    "尚无任务": "No task",
    "等待开始": "Waiting to start",
    "提交任务后，Codex 的执行步骤会显示在这里。": "After you submit a task, Codex execution steps will appear here.",
    "实时日志": "Live logs",
    "自动滚动": "Auto-scroll",
    "清空日志": "Clear logs",
    "Codex 实时日志": "Codex live logs",
    "日志流已就绪": "Log stream ready",
    "运行任务后，命令、工具调用和执行反馈将在这里实时出现。": "Commands, tool calls, and execution feedback will appear here in real time after a task starts.",
    "最终结果": "Final result",
    "结果将在任务完成后呈现": "The result will appear when the task is complete",
    "支持 Markdown 标题、列表、引用和代码块。": "Supports Markdown headings, lists, quotes, and code blocks.",
    "数据默认保留在本机": "Data stays on this device by default",
    "等待执行": "Queued",
    "准备中": "Preparing",
    "正在启动": "Starting",
    "运行中": "Running",
    "正在取消": "Cancelling",
    "已取消": "Cancelled",
    "已完成": "Completed",
    "执行失败": "Execution failed",
    "发生错误": "Error",
    "任务已进入执行队列。": "Task entered the execution queue.",
    "Codex 运行进程已启动。": "Codex worker started.",
    "Codex 会话已建立。": "Codex thread started.",
    "Codex 正在处理任务。": "Codex is working.",
    "Codex 本轮执行完成。": "Codex turn completed.",
    "任务已完成。": "Task completed.",
    "任务执行失败。": "Task failed.",
    "本地服务响应超时，请确认服务仍在运行。": "The local service timed out. Confirm that it is still running.",
    "无法连接本地 Codex 服务，请检查应用服务状态。": "Could not connect to the local Codex service. Check the application service status.",
    "关闭通知": "Dismiss notification",
    "本地服务在线": "Local service online",
    "服务离线": "Service offline",
    "模型设置已恢复默认值。": "Model settings restored to defaults.",
    "未命名任务": "Untitled task",
    "刚刚": "Just now",
    "等待统计数据": "Waiting for usage data",
    "还没有历史任务": "No task history yet",
    "运行第一个任务后，它会保留在这里。": "Your first task will appear here after it runs.",
    "日志流已就绪": "Log stream ready",
    "任务结束": "Task ended",
    "运行日志": "Run log",
    "步骤": "Step",
    "无法加载任务历史。": "Unable to load task history.",
    "无法读取累计用量。": "Unable to load cumulative usage.",
    "累计用量已重置，将从下一项新任务开始统计。": "Cumulative usage was reset and will resume with the next task.",
    "用量重置失败。": "Failed to reset usage.",
    "任务数据格式无效。": "Invalid task data format.",
    "无法读取任务详情。": "Unable to load task details.",
    "浏览器仅能提供目录名称；桌面应用可获取完整 Windows 路径": "The browser can only provide the folder name; the desktop app can obtain the full Windows path",
    "已选择：": "Selected:",
    "无项目 · 隔离临时工作区": "No project · Isolated temporary workspace",
    "每次任务使用全新的临时目录，任务结束后自动清理": "Each task uses a fresh temporary directory that is cleaned up when the task finishes",
    "可粘贴 Windows 完整路径，或使用原生目录选择器": "Paste a full Windows path or use the native folder picker",
    "请选择有效的项目目录。": "Choose a valid project directory.",
    "服务未返回有效的项目信息。": "The service did not return valid project information.",
    "无法注册项目目录，请确认路径存在且有权访问。": "Unable to register the project directory. Confirm the path exists and is accessible.",
    "项目目录已更新。": "Project directory updated.",
    "无法打开目录选择器。": "Unable to open the folder picker.",
    "浏览器无法读取完整路径；建议在桌面应用中选择项目。": "The browser cannot read the full path; choose the project in the desktop app.",
    "请先填写任务描述。": "Enter a task description first.",
    "请选择或填写项目目录。": "Choose or enter a project directory.",
    "提交任务": "Submit task",
    "正在将任务发送到本地 Codex 服务": "Sending the task to the local Codex service",
    "正在提交任务": "Submitting task",
    "服务未返回有效的任务 ID。": "The service did not return a valid task ID.",
    "等待 Codex 开始处理": "Waiting for Codex to start",
    "无项目临时工作区": "Temporary projectless workspace",
    "项目工作区": "Project workspace",
    "任务已开始运行。": "Task started.",
    "图片已添加。创建任务时会安全上传。": "Images added. They will be uploaded securely when the task is created.",
    "附件已添加。创建任务时会安全上传。": "Files added. They will be uploaded securely when the task is created.",
    "仅支持 PNG、JPEG 和 WebP 图片。": "Only PNG, JPEG, and WebP images are supported.",
    "图片数量已达到上限。": "The image limit has been reached.",
    "图片文件过大。": "The image file is too large.",
    "正在上传任务图片": "Uploading task images",
    "图片上传失败。": "Image upload failed.",
    "附件上传失败。": "File upload failed.",
    "不支持上传可执行文件、安装程序、快捷方式或磁盘镜像。": "Executables, installers, shortcuts, and disk images cannot be uploaded.",
    "正在上传任务附件": "Uploading task files",
    "# 可选附件：先 POST /external/uploads/files，再把返回的 file.id 放入 fileIds": "# Optional file: POST /external/uploads/files first, then put file.id into fileIds",
    "# fileIds = @($upload.file.id)": "# fileIds = @($upload.file.id)",
    "提交失败": "Submission failed",
    "任务提交失败": "Task submission failed",
    "任务提交失败。": "Task submission failed.",
    "正在请求取消任务…": "Requesting task cancellation…",
    "任务已取消": "Task cancelled",
    "已停止后续执行": "Further execution stopped",
    "已取消当前任务。": "Current task cancelled.",
    "取消任务失败": "Failed to cancel task",
    "取消任务失败。": "Failed to cancel task.",
    "工具调用": "Tool call",
    "事件": "Event",
    "开始执行": "Execution started",
    "正在分析任务与项目上下文": "Analyzing the task and project context",
    "更新执行计划": "Execution plan updated",
    "完成工具调用": "Tool call completed",
    "执行工具调用": "Running tool call",
    "任务完成": "Task complete",
    "最终结果已生成": "Final result generated",
    "任务已完成，最终结果已生成。": "Task completed and the final result is ready.",
    "执行已由用户停止": "Execution stopped by the user",
    "任务执行失败": "Task execution failed",
    "事件流已连接": "Event stream connected",
    "事件流重连中": "Reconnecting event stream",
    "服务未就绪": "Service not ready",
    "本地服务离线": "Local service offline",
    "本地服务不可用。": "Local service unavailable.",
    "当前任务仍在运行；请先取消或等待任务完成。": "A task is still running. Cancel it or wait for it to finish.",
    "结果已复制到剪贴板。": "Result copied to the clipboard.",
    "复制失败，请手动选择结果。": "Copy failed. Select the result manually.",
    "复制失败，请手动复制。": "Copy failed. Copy it manually.",
    "检查并修复这个项目": "Inspect and fix this project",
    "正在读取 Host 状态": "Loading Host status",
    "状态不可用": "Status unavailable",
    "无法读取 Host 状态。": "Unable to read Host status.",
    "再次点击关闭": "Click again to disable",
    "再次点击关闭 Host；正在运行的外部 API 任务会被取消。": "Click Disable Host again; running external API tasks will be cancelled.",
    "Host 已开启，现有 API Key 可以继续调用。": "Host enabled. Existing API keys can continue calling it.",
    "Host 状态修改失败。": "Failed to change Host status.",
    "尚未创建访问密钥": "No access keys created",
    "创建第一枚与模型配置绑定的 Gateway API Key": "Create your first Gateway API key bound to a model configuration",
    "未命名密钥": "Unnamed key",
    "重置后尚无调用": "No calls since reset",
    "有效": "Active",
    "查看完整密钥": "Reveal full key",
    "隐藏完整密钥": "Hide full key",
    "旧密钥无法查看，请删除后重新生成": "This legacy key cannot be revealed. Delete it and generate a new one.",
    "删除": "Delete",
    "确认删除": "Confirm delete",
    "读取失败": "Load failed",
    "服务端未返回新密钥。": "The service did not return a new key.",
    "API Key 已生成并安全保存，可随时点击眼睛查看。": "API key generated and securely saved. Use the eye button to reveal it at any time.",
    "生成失败。": "Generation failed.",
    "API Key 已永久删除。": "API key permanently deleted.",
    "删除失败。": "Deletion failed.",
    "无法查看此密钥。": "Unable to reveal this key.",
    "完全访问允许修改项目外文件，请确认任务来源可信。": "Full access can modify files outside the project. Confirm that the task source is trusted.",
    "API Key 已复制到剪贴板。": "API key copied to the clipboard.",
    "调用示例已复制。": "API example copied.",
    "网络不可用": "Network unavailable"
  });
  const EN_PATTERNS = Object.freeze([
    [/^请求失败（HTTP (\d+)）$/, (_, status) => `Request failed (HTTP ${status})`],
    [/^(\d+) 分钟前$/, (_, value) => `${value} min ago`],
    [/^(\d+) 小时前$/, (_, value) => `${value} hr ago`],
    [/^(\d+) 天前$/, (_, value) => `${value} days ago`],
    [/^累计自 (.+)$/, (_, value) => `Accumulating since ${value}`],
    [/^(\d+) 个累计任务$/, (_, value) => `${value} cumulative tasks`],
    [/^(\d+) 个任务含 Token 数据$/, (_, value) => `${value} tasks include token data`],
    [/^(\d+) 个运行中$/, (_, value) => `${value} running`],
    [/^(\d+) 条日志$/, (_, value) => `${value} logs`],
    [/^(\d+) 个已完成$/, (_, value) => `${value} completed`],
    [/^步骤 (\d+)$/, (_, value) => `Step ${value}`],
    [/^打开任务：(.+)$/, (_, value) => `Open task: ${value}`],
    [/^已选择：(.+)$/, (_, value) => `Selected: ${value}`],
    [/^任务 (.+) 已创建 · 无项目临时工作区$/, (_, value) => `Task ${value} created · Temporary projectless workspace`],
    [/^任务 (.+) 已创建 · 项目工作区$/, (_, value) => `Task ${value} created · Project workspace`],
    [/^(\d+) 个有效 · (\d+) 个已创建$/, (_, active, total) => `${active} active · ${total} created`],
    [/^(\d+) 个密钥$/, (_, value) => `${value} keys`],
    [/^版本 (.+)$/, (_, value) => `Version ${value}`],
    [/^版本 (.+) · (.+)$/, (_, version, arch) => `Version ${version} · ${arch}`],
    [/^检测于 (.+)$/, (_, value) => `Checked ${value}`],
    [/^(.+) · (\d+) 次累计调用$/, (_, key, tasks) => `${key} · ${tasks} cumulative calls`],
    [/^(.+) · Token 统计中$/, (_, source) => `${source} · Calculating tokens`],
    [/^(.+) · (.+) · 无项目$/, (_, key, model) => `${key} · ${model} · No project`],
    [/^(.+) · (.+) · 项目$/, (_, key, model) => `${key} · ${model} · Project`],
    [/^(\d+) 次累计调用 · (.+) Token$/, (_, tasks, tokens) => `${tasks} cumulative calls · ${tokens} tokens`],
    [/^Token 限额 (.+) \/ (.+) · 销毁于 (.+)$/, (_, used, limit, value) => `Token limit ${used} / ${limit} · Deletes ${value}`],
    [/^Token 限额 (.+) \/ (.+)$/, (_, used, limit) => `Token limit ${used} / ${limit}`],
    [/^销毁于 (.+)$/, (_, value) => `Deletes ${value}`],
    [/^当前用量：(.+) \/ (.+) Token$/, (_, used, limit) => `Current usage: ${used} / ${limit} tokens`],
    [/^当前用量：(.+) Token · 未设置上限$/, (_, used) => `Current usage: ${used} tokens · Unlimited`],
    [/^当前设置：销毁于 (.+)$/, (_, value) => `Current setting: Deletes ${value}`],
    [/^Host 已关闭；取消 (\d+) 个外部任务，断开 (\d+) 个连接。$/, (_, tasks, connections) => `Host disabled; cancelled ${tasks} external tasks and disconnected ${connections} clients.`],
    [/^移除图片：(.+)$/, (_, name) => `Remove image: ${name}`],
    [/^移除附件：(.+)$/, (_, name) => `Remove file: ${name}`],
    [/^图片文件过大。每张最大 (.+)。$/, (_, size) => `The image is too large. Maximum per image: ${size}.`],
    [/^附件文件过大。每个文件最大 (.+)。$/, (_, size) => `The file is too large. Maximum per file: ${size}.`],
    [/^附件总大小不能超过 (.+)。$/, (_, size) => `Combined file size cannot exceed ${size}.`],
    [/^附件数量已达到上限。每个任务最多 (\d+) 个。$/, (_, count) => `The file limit has been reached. Maximum ${count} per task.`],
    [/^图片数量已达到上限。每个任务最多 (\d+) 张。$/, (_, count) => `The image limit has been reached. Maximum ${count} per task.`],
    [/^正在上传任务图片 (\d+) \/ (\d+) · (.+)$/, (_, current, total, name) => `Uploading task image ${current} / ${total} · ${name}`],
    [/^正在上传任务附件 (\d+) \/ (\d+) · (.+)$/, (_, current, total, name) => `Uploading task file ${current} / ${total} · ${name}`],
    [/^(.+) · Host 已关闭$/, (_, address) => `${address} · Host disabled`],
    [/^(等待执行|准备中|正在启动|运行中|正在取消|已取消|已完成|执行失败|发生错误) · (.+)$/, (_, status, suffix) => `${EN_TEXT[status] || status} · ${suffix}`],
    [/^工具调用 · (.+)$/, (_, tool) => `Tool call · ${tool}`]
  ]);
  const LOCALIZABLE_ATTRIBUTES = Object.freeze(["aria-label", "title", "placeholder"]);
  const localizedTextNodes = new WeakMap();
  const localizedAttributes = new WeakMap();
  let localizationObserver = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const elements = {
    sidebar: $("#sidebar"),
    sidebarOpen: $("#sidebarOpen"),
    sidebarClose: $("#sidebarClose"),
    sidebarScrim: $("#sidebarScrim"),
    newTaskButton: $("#newTaskButton"),
    refreshHistory: $("#refreshHistory"),
    historyList: $("#historyList"),
    connectionChip: $("#connectionChip"),
    connectionText: $("#connectionText"),
    languageSwitch: $("#languageSwitch"),
    languageSelect: $("#languageSelect"),
    sidebarConnectionDot: $("#sidebarConnectionDot"),
    apiAddress: $("#apiAddress"),
    platformAccountButton: $("#platformAccountButton"),
    platformAccountAvatar: $("#platformAccountAvatar"),
    platformAccountName: $("#platformAccountName"),
    platformAccountEmail: $("#platformAccountEmail"),
    platformAccountDot: $("#platformAccountDot"),
    platformAccountDialog: $("#platformAccountDialog"),
    closePlatformAccountDialog: $("#closePlatformAccountDialog"),
    platformSignedOutView: $("#platformSignedOutView"),
    platformSignedInView: $("#platformSignedInView"),
    platformBrowserLoginButton: $("#platformBrowserLoginButton"),
    platformAuthError: $("#platformAuthError"),
    platformProfileAvatar: $("#platformProfileAvatar"),
    platformProfileName: $("#platformProfileName"),
    platformProfileEmail: $("#platformProfileEmail"),
    platformProfileStatus: $("#platformProfileStatus"),
    platformHostUrl: $("#platformHostUrl"),
    platformHostError: $("#platformHostError"),
    platformProfileOnlineButton: $("#platformProfileOnlineButton"),
    platformLogoutButton: $("#platformLogoutButton"),
    platformOnlineHostButton: $("#platformOnlineHostButton"),
    shareOnlineButton: $("#shareOnlineButton"),
    gatewayDashboard: $("#gatewayDashboard"),
    openApiTestBench: $("#openApiTestBench"),
    closeApiTestBench: $("#closeApiTestBench"),
    apiTestBench: $("#apiTestBench"),
    gatewayActiveTasks: $("#gatewayActiveTasks"),
    gatewayActiveConnections: $("#gatewayActiveConnections"),
    gatewayCallCount: $("#gatewayCallCount"),
    gatewayCallCountNote: $("#gatewayCallCountNote"),
    gatewaySuccessRate: $("#gatewaySuccessRate"),
    gatewayAverageLatency: $("#gatewayAverageLatency"),
    gatewayTokenCount: $("#gatewayTokenCount"),
    gatewayKeyFilter: $("#gatewayKeyFilter"),
    refreshGatewayMonitor: $("#refreshGatewayMonitor"),
    gatewayCallList: $("#gatewayCallList"),
    gatewayFocusTitle: $("#gatewayFocusTitle"),
    gatewayFocusDescription: $("#gatewayFocusDescription"),
    gatewayFocusToken: $("#gatewayFocusToken"),
    gatewayFocusModel: $("#gatewayFocusModel"),
    gatewayFocusPermission: $("#gatewayFocusPermission"),
    gatewayFocusLastCall: $("#gatewayFocusLastCall"),
    gatewayFocusLastStatus: $("#gatewayFocusLastStatus"),
    manageApiKeysButton: $("#manageApiKeysButton"),
    codexReadinessPanel: $("#codexReadinessPanel"),
    readinessOverall: $("#readinessOverall"),
    readinessOverallText: $("#readinessOverallText"),
    refreshCodexReadiness: $("#refreshCodexReadiness"),
    readinessRuntime: $("#readinessRuntime"),
    readinessRuntimeStatus: $("#readinessRuntimeStatus"),
    readinessRuntimeDetail: $("#readinessRuntimeDetail"),
    readinessCli: $("#readinessCli"),
    readinessCliStatus: $("#readinessCliStatus"),
    readinessCliDetail: $("#readinessCliDetail"),
    readinessApp: $("#readinessApp"),
    readinessAppStatus: $("#readinessAppStatus"),
    readinessAppDetail: $("#readinessAppDetail"),
    readinessAuth: $("#readinessAuth"),
    readinessAuthStatus: $("#readinessAuthStatus"),
    readinessAuthDetail: $("#readinessAuthDetail"),
    readinessGuide: $("#readinessGuide"),
    readinessGuideTitle: $("#readinessGuideTitle"),
    readinessGuideText: $("#readinessGuideText"),
    readinessLoginCommand: $("#readinessLoginCommand"),
    connectChatGpt: $("#connectChatGpt"),
    connectChatGptLabel: $("#connectChatGptLabel"),
    copyCodexLoginCommand: $("#copyCodexLoginCommand"),
    readinessCheckedAt: $("#readinessCheckedAt"),
    settingsButton: $("#settingsButton"),
    settingsDialog: $("#settingsDialog"),
    closeSettingsDialog: $("#closeSettingsDialog"),
    minimizeToTrayToggle: $("#minimizeToTrayToggle"),
    desktopPortForm: $("#desktopPortForm"),
    desktopPortInput: $("#desktopPortInput"),
    desktopPortHint: $("#desktopPortHint"),
    saveDesktopPort: $("#saveDesktopPort"),
    onlineHostPreference: $("#onlineHostPreference"),
    tailscaleFunnelStatus: $("#tailscaleFunnelStatus"),
    tailscaleFunnelIndicator: $("#tailscaleFunnelIndicator"),
    refreshTailscaleFunnel: $("#refreshTailscaleFunnel"),
    toggleTailscaleFunnel: $("#toggleTailscaleFunnel"),
    tailscaleFunnelUrlRow: $("#tailscaleFunnelUrlRow"),
    tailscaleFunnelBaseUrl: $("#tailscaleFunnelBaseUrl"),
    copyTailscaleBaseUrl: $("#copyTailscaleBaseUrl"),
    openTailscaleDownload: $("#openTailscaleDownload"),
    themeDarkButton: $("#themeDarkButton"),
    themeLightButton: $("#themeLightButton"),
    desktopAppVersion: $("#desktopAppVersion"),
    checkDesktopUpdates: $("#checkDesktopUpdates"),
    openDesktopRelease: $("#openDesktopRelease"),
    availableReleaseVersion: $("#availableReleaseVersion"),
    exportDiagnostics: $("#exportDiagnostics"),
    releaseStatus: $("#releaseStatus"),
    releaseStatusText: $("#releaseStatusText"),
    openLocalLegal: $("#openLocalLegal"),
    localTermsDialog: $("#localTermsDialog"),
    localTermsConsent: $("#localTermsConsent"),
    acceptLocalTerms: $("#acceptLocalTerms"),
    taskPrompt: $("#taskPrompt"),
    promptShell: $("#promptShell"),
    charCount: $("#charCount"),
    imageAttachmentTray: $("#imageAttachmentTray"),
    addImagesButton: $("#addImagesButton"),
    addFilesButton: $("#addFilesButton"),
    imageCount: $("#imageCount"),
    imageInput: $("#imageInput"),
    fileInput: $("#fileInput"),
    projectPath: $("#projectPath"),
    pathControl: $("#pathControl"),
    pickProjectButton: $("#pickProjectButton"),
    folderFallback: $("#folderFallback"),
    projectNote: $("#projectNote"),
    projectModeProject: $("#projectModeProject"),
    projectModeNone: $("#projectModeNone"),
    approvalToggle: $("#approvalToggle"),
    modelControl: $("#modelControl"),
    modelTrigger: $("#modelTrigger"),
    modelPopover: $("#modelPopover"),
    currentModel: $("#currentModel"),
    currentEffort: $("#currentEffort"),
    currentSpeed: $("#currentSpeed"),
    triggerModel: $("#triggerModel"),
    triggerEffort: $("#triggerEffort"),
    resetSettings: $("#resetSettings"),
    createKeyFromConfig: $("#createKeyFromConfig"),
    settingSubmenu: $("#settingSubmenu"),
    submenuTitle: $("#submenuTitle"),
    submenuOptions: $("#submenuOptions"),
    runButton: $("#runButton"),
    statusPill: $("#statusPill"),
    elapsedMetric: $("#elapsedMetric"),
    stepsMetric: $("#stepsMetric"),
    stepsCaption: $("#stepsCaption"),
    filesMetric: $("#filesMetric"),
    modelMetric: $("#modelMetric"),
    effortMetric: $("#effortMetric"),
    taskIdLabel: $("#taskIdLabel"),
    timeline: $("#timeline"),
    terminal: $("#terminal"),
    terminalEmpty: $("#terminalEmpty"),
    autoScroll: $("#autoScroll"),
    clearLog: $("#clearLog"),
    logCount: $("#logCount"),
    resultPanel: $("#resultPanel"),
    resultContent: $("#resultContent"),
    copyResult: $("#copyResult"),
    toastRegion: $("#toastRegion"),
    apiGatewayPanel: $("#apiGatewayPanel"),
    apiDocsButton: $("#apiDocsButton"),
    restEndpoint: $("#restEndpoint"),
    externalTaskEndpoint: $("#externalTaskEndpoint"),
    openAiHostEndpoint: $("#openAiHostEndpoint"),
    openAiHostCheck: $("#openAiHostCheck"),
    openAiHostCheckLabel: $("#openAiHostCheckLabel"),
    openAiHostCheckStatus: $("#openAiHostCheckStatus"),
    openAiHostViewToggle: $("#openAiHostViewToggle"),
    openAiHostViewLabel: $("#openAiHostViewLabel"),
    gatewayHostStatus: $("#gatewayHostStatus"),
    gatewayHostStatusText: $("#gatewayHostStatusText"),
    gatewayHostToggle: $("#gatewayHostToggle"),
    apiKeyForm: $("#apiKeyForm"),
    apiKeyName: $("#apiKeyName"),
    apiKeyModel: $("#apiKeyModel"),
    apiKeyEffort: $("#apiKeyEffort"),
    apiKeySpeed: $("#apiKeySpeed"),
    apiKeyPermission: $("#apiKeyPermission"),
    generateApiKey: $("#generateApiKey"),
    apiKeyReveal: $("#apiKeyReveal"),
    apiKeySecret: $("#apiKeySecret"),
    copyApiKey: $("#copyApiKey"),
    hideApiKeySecret: $("#hideApiKeySecret"),
    apiKeyList: $("#apiKeyList"),
    apiKeyCount: $("#apiKeyCount"),
    openApiKeyAdvancedSettings: $("#openApiKeyAdvancedSettings"),
    apiKeyAdvancedDialog: $("#apiKeyAdvancedDialog"),
    closeApiKeyAdvancedSettings: $("#closeApiKeyAdvancedSettings"),
    cancelApiKeyAdvancedSettings: $("#cancelApiKeyAdvancedSettings"),
    apiKeyAdvancedForm: $("#apiKeyAdvancedForm"),
    apiKeyAdvancedSelect: $("#apiKeyAdvancedSelect"),
    apiKeyTokenLimit: $("#apiKeyTokenLimit"),
    apiKeyTokenLimitStatus: $("#apiKeyTokenLimitStatus"),
    apiKeyDisableAfter: $("#apiKeyDisableAfter"),
    apiKeyCustomExpirationRow: $("#apiKeyCustomExpirationRow"),
    apiKeyCustomExpiration: $("#apiKeyCustomExpiration"),
    apiKeyExpirationStatus: $("#apiKeyExpirationStatus"),
    saveApiKeyAdvancedSettings: $("#saveApiKeyAdvancedSettings"),
    refreshApiKeys: $("#refreshApiKeys"),
    apiExampleCode: $("#apiExampleCode"),
    copyApiExample: $("#copyApiExample"),
    refreshUsageDashboard: $("#refreshUsageDashboard"),
    resetUsageDashboard: $("#resetUsageDashboard"),
    usageUpdatedAt: $("#usageUpdatedAt"),
    usageTotalTokens: $("#usageTotalTokens"),
    usageCoverage: $("#usageCoverage"),
    usageTaskCount: $("#usageTaskCount"),
    usageActiveCount: $("#usageActiveCount"),
    usageSuccessRate: $("#usageSuccessRate"),
    usageInputTokens: $("#usageInputTokens"),
    usageOutputTokens: $("#usageOutputTokens"),
    usageCachedTokens: $("#usageCachedTokens"),
    usageReasoningTokens: $("#usageReasoningTokens"),
    usageInputShare: $("#usageInputShare"),
    usageOutputShare: $("#usageOutputShare"),
    usageCachedShare: $("#usageCachedShare"),
    usageReasoningShare: $("#usageReasoningShare"),
    usageInputBar: $("#usageInputBar"),
    usageOutputBar: $("#usageOutputBar"),
    usageCachedBar: $("#usageCachedBar"),
    usageReasoningBar: $("#usageReasoningBar"),
    usageModelList: $("#usageModelList"),
  };

  const state = {
    language: "zh",
    theme: "dark",
    config: { ...DEFAULT_CONFIG },
    modelIds: new Map(),
    modelCatalog: MODEL_OPTIONS.map((label) => ({ id: label, label })),
    apiKeys: [],
    gatewayEnabled: true,
    gatewayStatusLoaded: false,
    gatewaySnapshot: { activeTasks: 0, activeConnections: 0 },
    gatewayKeyFilter: "all",
    gatewayMonitorPending: false,
    gatewayMonitorTimer: null,
    gatewayConfirmTimer: null,
    usageSummary: null,
    revealedApiKey: "",
    advancedApiKeyId: null,
    projects: [],
    selectedProject: null,
    projectPathDraft: "",
    projectless: false,
    selectedImages: [],
    fileLimits: { ...DEFAULT_FILE_LIMITS },
    imageDragDepth: 0,
    tasks: [],
    currentTask: null,
    logs: [],
    steps: [],
    result: "",
    elapsedTimer: null,
    startedAt: null,
    endedAt: null,
    socket: null,
    socketConnected: false,
    socketRetry: null,
    socketRetries: 0,
    streamFallbackTimer: null,
    eventSource: null,
    subscribedTaskId: null,
    eventSignatures: new Map(),
    activeSubmenu: null,
    runRequestPending: false,
    connectionOkay: false,
    codexReadiness: null,
    readinessChecking: false,
    codingAgentConnectPending: false,
    releaseToolsAvailable: false,
    releaseActionPending: false,
    releaseUrl: null,
    tailscaleFunnel: null,
    tailscaleFunnelPending: false,
    tailscaleFunnelConfirmTimer: null,
    tailscaleHelpUrl: "https://tailscale.com/download/windows",
    openAiHostMode: null,
    onlineHostCheck: null,
    onlineHostCheckPending: false,
    onlineHostMonitorTimer: null,
    platformAccount: { signedIn: false, online: false, user: null, host: null },
    platformAccountPending: false,
  };

  function activeLocale() {
    return I18N?.locale(state.language) || (state.language === "zh" ? "zh-CN" : "en-US");
  }

  function translateToEnglish(value) {
    const source = String(value ?? "");
    const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match || !match[2]) return source;
    const [, leading, content, trailing] = match;
    let translated = EN_TEXT[content];
    if (!translated) {
      for (const [pattern, replacement] of EN_PATTERNS) {
        if (!pattern.test(content)) continue;
        translated = content.replace(pattern, replacement);
        break;
      }
    }
    if (!translated) {
      const embedded = content
        .replaceAll("检查并修复这个项目", "Inspect and fix this project")
        .replaceAll(
          "# 可选附件：先 POST /external/uploads/files，再把返回的 file.id 放入 fileIds",
          "# Optional file: POST /external/uploads/files first, then put file.id into fileIds",
        );
      if (embedded !== content) translated = embedded;
    }
    return translated ? `${leading}${translated}${trailing}` : source;
  }

  function translateLocalized(value) {
    const source = String(value ?? "");
    if (state.language === "zh") return source;
    const english = translateToEnglish(source);
    if (state.language === "en" || !I18N) return english;
    const sourceMatch = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const englishMatch = english.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!sourceMatch || !englishMatch || !sourceMatch[2]) return english;
    if (MODEL_OPTIONS.includes(englishMatch[2])) return `${sourceMatch[1]}${englishMatch[2]}${sourceMatch[3]}`;
    const message = englishMatch[2];
    const translated = CRITICAL_UI_TRANSLATIONS[state.language]?.[message]
      ?? (I18N.hasTranslation?.(state.language, message)
        ? I18N.translate(sourceMatch[2], state.language, message)
        : I18N.translateDynamic?.(message, state.language))
      ?? I18N.translate(sourceMatch[2], state.language, message);
    return `${sourceMatch[1]}${translated}${sourceMatch[3]}`;
  }

  function shouldSkipLocalization(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return !element || Boolean(element.closest("script, style, [data-i18n-ignore]"));
  }

  function localizeTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || shouldSkipLocalization(node)) return;
    const current = node.nodeValue || "";
    let record = localizedTextNodes.get(node);
    if (!record) record = { source: current, rendered: current };
    else if (current !== record.rendered && current !== record.source) record.source = current;
    const next = state.language === "zh" ? record.source : translateLocalized(record.source);
    record.rendered = next;
    localizedTextNodes.set(node, record);
    if (current !== next) node.nodeValue = next;
  }

  function localizeAttribute(element, attribute) {
    if (!element?.hasAttribute?.(attribute) || shouldSkipLocalization(element)) return;
    const current = element.getAttribute(attribute) || "";
    let records = localizedAttributes.get(element);
    if (!records) {
      records = new Map();
      localizedAttributes.set(element, records);
    }
    let record = records.get(attribute);
    if (!record) record = { source: current, rendered: current };
    else if (current !== record.rendered && current !== record.source) record.source = current;
    const next = state.language === "zh" ? record.source : translateLocalized(record.source);
    record.rendered = next;
    records.set(attribute, record);
    if (current !== next) element.setAttribute(attribute, next);
  }

  function localizeSubtree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      localizeTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      LOCALIZABLE_ATTRIBUTES.forEach((attribute) => localizeAttribute(root, attribute));
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) localizeTextNode(walker.currentNode);
    root.querySelectorAll?.("*").forEach((element) => {
      LOCALIZABLE_ATTRIBUTES.forEach((attribute) => localizeAttribute(element, attribute));
    });
  }

  function updateLanguageControl() {
    const label = state.language === "zh" ? "选择语言" : (I18N?.translate("选择语言", state.language, "Choose language") || "Choose language");
    elements.languageSelect.value = state.language;
    elements.languageSelect.setAttribute("aria-label", label);
    elements.languageSwitch.setAttribute("title", label);
  }

  function refreshLocalizedViews() {
    updateConfigLabels();
    updateProjectMode({ persist: false });
    renderHistory();
    renderUsageDashboard();
    renderApiKeys();
    if (elements.apiKeyAdvancedDialog.open) renderApiKeyAdvancedSettings();
    renderCodexReadiness(state.codexReadiness);
    renderPlatformAccount();
    renderTailscaleFunnel();
    renderTimeline();
    renderAllLogs();
    setResult(state.result);
    updateApiExample();
    const status = state.currentTask ? normalizeStatus(state.currentTask.status) : "idle";
    setStatus(status, state.currentTask);
    localizeSubtree(document.body);
  }

  function setLanguage(language, { persist = true, refresh = true } = {}) {
    state.language = I18N?.normalize(language) || I18N?.normalize(navigator.language) || "en";
    document.documentElement.lang = activeLocale();
    if (persist) setStoredValue(LANGUAGE_STORAGE_KEY, state.language);
    if (refresh) refreshLocalizedViews();
    else localizeSubtree(document.body);
    updateLanguageControl();
  }

  function initializeLocalization() {
    setLanguage(getStoredValue(LANGUAGE_STORAGE_KEY), { persist: false, refresh: false });
    localizationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "characterData") localizeTextNode(mutation.target);
        if (mutation.type === "attributes") localizeAttribute(mutation.target, mutation.attributeName);
        mutation.addedNodes?.forEach((node) => localizeSubtree(node));
      });
    });
    localizationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: LOCALIZABLE_ATTRIBUTES,
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("`", "&#096;");
  }

  function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value == null) return [];
    return [value];
  }

  function unwrapPayload(payload) {
    if (!payload || typeof payload !== "object") return payload;
    if (payload.data !== undefined && Object.keys(payload).length <= 4) return payload.data;
    return payload;
  }

  function extractList(payload, keys) {
    const source = unwrapPayload(payload);
    if (Array.isArray(source)) return source;
    if (!source || typeof source !== "object") return [];
    for (const key of keys) {
      if (Array.isArray(source[key])) return source[key];
      if (source[key] && Array.isArray(source[key].items)) return source[key].items;
    }
    if (Array.isArray(source.items)) return source.items;
    return [];
  }

  function extractTask(payload) {
    let source = unwrapPayload(payload);
    if (!source || typeof source !== "object") return null;
    if (source.task && typeof source.task === "object") source = source.task;
    return source;
  }

  function messageFromErrorPayload(payload, fallback) {
    if (typeof payload === "string" && payload.trim()) return payload.trim();
    if (!payload || typeof payload !== "object") return fallback;
    const candidate = payload.message || payload.error?.message || payload.error || payload.detail || payload.title;
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : fallback;
  }

  function setTheme(value, { persist = true, notify = false } = {}) {
    const theme = value === "light" ? "light" : "dark";
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    elements.themeDarkButton.classList.toggle("active", theme === "dark");
    elements.themeLightButton.classList.toggle("active", theme === "light");
    elements.themeDarkButton.setAttribute("aria-pressed", String(theme === "dark"));
    elements.themeLightButton.setAttribute("aria-pressed", String(theme === "light"));
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "light" ? "#f4f6fa" : "#0c0d10",
    );
    if (persist) setStoredValue(THEME_STORAGE_KEY, theme);
    if (notify) showToast(theme === "light" ? "已切换为亮色模式。" : "已切换为暗色模式。", "success");
  }

  function initializeTheme() {
    setTheme(getStoredValue(THEME_STORAGE_KEY), { persist: false, notify: false });
  }

  function setReadinessItem(element, statusElement, detailElement, tone, status, detail) {
    element.className = `readiness-item ${tone}`;
    statusElement.textContent = status;
    detailElement.textContent = detail;
  }

  function renderCodexReadiness(readiness = state.codexReadiness) {
    if (!elements.codexReadinessPanel) return;
    elements.connectChatGpt.disabled = state.codingAgentConnectPending;
    elements.connectChatGptLabel.textContent = state.codingAgentConnectPending ? "正在连接 ChatGPT…" : "连接 ChatGPT";
    if (state.readinessChecking || !readiness) {
      elements.readinessOverall.className = "readiness-overall checking";
      elements.readinessOverallText.textContent = state.readinessChecking ? "正在检测" : "等待首次检测";
      [
        [elements.readinessRuntime, elements.readinessRuntimeStatus, elements.readinessRuntimeDetail, "验证打包组件与版本"],
        [elements.readinessCli, elements.readinessCliStatus, elements.readinessCliDetail, "可选组件"],
        [elements.readinessApp, elements.readinessAppStatus, elements.readinessAppDetail, "可选组件"],
        [elements.readinessAuth, elements.readinessAuthStatus, elements.readinessAuthDetail, "只检查登录状态，不读取密钥"],
      ].forEach(([item, status, detail, description]) => {
        setReadinessItem(item, status, detail, "checking", "正在检测", description);
      });
      elements.readinessGuide.hidden = true;
      elements.readinessCheckedAt.textContent = "等待首次检测";
      return;
    }

    const runtime = readiness.runtime || {};
    if (runtime.status === "available") {
      setReadinessItem(
        elements.readinessRuntime,
        elements.readinessRuntimeStatus,
        elements.readinessRuntimeDetail,
        "ready",
        "可用",
        runtime.version ? `版本 ${runtime.version} · ${runtime.arch || "Windows"}` : (runtime.arch || "Windows"),
      );
    } else if (runtime.status === "unsupported") {
      setReadinessItem(elements.readinessRuntime, elements.readinessRuntimeStatus, elements.readinessRuntimeDetail, "error", "系统不支持", "不支持当前系统架构");
    } else if (runtime.status === "broken") {
      setReadinessItem(elements.readinessRuntime, elements.readinessRuntimeStatus, elements.readinessRuntimeDetail, "error", "组件异常", "无法启动内置 Codex 运行组件");
    } else {
      setReadinessItem(elements.readinessRuntime, elements.readinessRuntimeStatus, elements.readinessRuntimeDetail, "error", "组件缺失", "请重新安装完整版本");
    }

    const cli = readiness.cli || {};
    if (cli.status === "available") {
      setReadinessItem(elements.readinessCli, elements.readinessCliStatus, elements.readinessCliDetail, "ready", "已安装", cli.version ? `版本 ${cli.version}` : "Codex CLI");
    } else if (cli.status === "broken") {
      setReadinessItem(elements.readinessCli, elements.readinessCliStatus, elements.readinessCliDetail, "warning", "组件异常", "无法启动外部 Codex CLI");
    } else if (cli.status === "unsupported") {
      setReadinessItem(elements.readinessCli, elements.readinessCliStatus, elements.readinessCliDetail, "optional", "系统不支持", "可选组件");
    } else {
      setReadinessItem(elements.readinessCli, elements.readinessCliStatus, elements.readinessCliDetail, "optional", "未安装（可选）", "不影响内置组件运行");
    }

    const desktopApp = readiness.app || {};
    if (desktopApp.status === "available") {
      setReadinessItem(elements.readinessApp, elements.readinessAppStatus, elements.readinessAppDetail, "ready", "已安装", desktopApp.version ? `版本 ${desktopApp.version}` : "Codex App");
    } else if (desktopApp.status === "missing") {
      setReadinessItem(elements.readinessApp, elements.readinessAppStatus, elements.readinessAppDetail, "optional", "未安装（可选）", "不影响内置组件运行");
    } else if (desktopApp.status === "unsupported") {
      setReadinessItem(elements.readinessApp, elements.readinessAppStatus, elements.readinessAppDetail, "optional", "系统不支持", "可选组件");
    } else {
      setReadinessItem(elements.readinessApp, elements.readinessAppStatus, elements.readinessAppDetail, "warning", "无法检测", "Windows 应用状态检测不可用");
    }

    const auth = readiness.auth || {};
    if (auth.status === "logged-in") {
      const method = auth.method === "chatgpt" ? "ChatGPT 登录" : auth.method === "api-key" ? "API Key 登录" : "Codex 认证可用";
      setReadinessItem(elements.readinessAuth, elements.readinessAuthStatus, elements.readinessAuthDetail, "ready", "已登录", method);
    } else if (auth.status === "logged-out") {
      setReadinessItem(elements.readinessAuth, elements.readinessAuthStatus, elements.readinessAuthDetail, "warning", "未登录", "运行 codex login 后重新检测");
    } else {
      setReadinessItem(elements.readinessAuth, elements.readinessAuthStatus, elements.readinessAuthDetail, "warning", "状态未知", "登录状态无法确认，请重新检测");
    }

    const overall = readiness.overall;
    let overallClass = "attention";
    let overallText = "需要检查";
    if (overall === "ready") {
      overallClass = "ready";
      overallText = "环境已就绪";
    } else if (overall === "login-required") {
      overallText = "需要登录";
    } else if (["unavailable", "unsupported"].includes(overall)) {
      overallClass = "unavailable";
      overallText = overall === "unsupported" ? "系统不支持" : "环境不可用";
    } else if (overall === "desktop-only") {
      overallText = "仅桌面应用支持检测";
    } else if (overall === "error") {
      overallClass = "unavailable";
      overallText = "检测失败";
    }
    elements.readinessOverall.className = `readiness-overall ${overallClass}`;
    elements.readinessOverallText.textContent = overallText;

    elements.readinessGuide.hidden = overall === "ready";
    elements.readinessLoginCommand.hidden = overall !== "login-required";
    if (overall === "login-required") {
      elements.readinessGuideTitle.textContent = "登录后即可使用";
      elements.readinessGuideText.textContent = "点击连接 ChatGPT，在浏览器中完成登录；程序随后会自动重新检测。";
    } else if (["unavailable", "unsupported"].includes(overall)) {
      elements.readinessGuideTitle.textContent = "运行组件需要修复";
      elements.readinessGuideText.textContent = "内置运行组件不完整，请重新安装完整版本。";
    } else if (overall === "desktop-only") {
      elements.readinessGuideTitle.textContent = "仅桌面应用支持检测";
      elements.readinessGuideText.textContent = "请通过 Agent Gateway 桌面应用运行环境检测。";
    } else if (overall === "error") {
      elements.readinessGuideTitle.textContent = "检测失败";
      elements.readinessGuideText.textContent = "环境检测失败，请稍后重试。";
    } else {
      elements.readinessGuideTitle.textContent = "需要确认登录状态";
      elements.readinessGuideText.textContent = "未能确认 Codex 登录状态，请稍后重新检测。";
    }

    const checkedAt = Date.parse(readiness.checkedAt || "");
    elements.readinessCheckedAt.textContent = Number.isFinite(checkedAt)
      ? `检测于 ${new Date(checkedAt).toLocaleString(activeLocale(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
      : "等待首次检测";
    if (state.language !== "zh") localizeSubtree(elements.codexReadinessPanel);
  }

  async function checkCodexReadiness({ quiet = false } = {}) {
    if (state.readinessChecking) return;
    state.readinessChecking = true;
    elements.refreshCodexReadiness.disabled = true;
    renderCodexReadiness();
    try {
      if (typeof window.codexDesktop?.checkCodexReadiness !== "function") {
        state.codexReadiness = {
          checkedAt: new Date().toISOString(),
          overall: "desktop-only",
          runtime: { status: "missing" },
          cli: { status: "missing" },
          app: { status: "unknown" },
          auth: { status: "unknown" },
          consumesTokens: false,
        };
        return;
      }
      const result = await window.codexDesktop.checkCodexReadiness();
      if (!result || typeof result !== "object" || result.consumesTokens !== false) {
        throw new Error("Invalid Codex readiness response.");
      }
      state.codexReadiness = result;
      setStoredValue("codex.readinessChecked", "1");
    } catch (error) {
      state.codexReadiness = {
        checkedAt: new Date().toISOString(),
        overall: "error",
        runtime: { status: "broken" },
        cli: { status: "missing" },
        app: { status: "unknown" },
        auth: { status: "unknown" },
        consumesTokens: false,
      };
      if (!quiet) showToast(error?.message || "环境检测失败，请稍后重试。", "error", 6_000);
    } finally {
      state.readinessChecking = false;
      elements.refreshCodexReadiness.disabled = false;
      renderCodexReadiness();
    }
  }

  async function connectChatGpt() {
    if (state.codingAgentConnectPending) return;
    if (typeof window.codexDesktop?.connectCodingAgent !== "function") {
      showToast("仅桌面应用支持连接 ChatGPT。", "error", 6_000);
      return;
    }
    state.codingAgentConnectPending = true;
    renderCodexReadiness();
    try {
      const providerId = elements.connectChatGpt.dataset.providerId || "chatgpt-codex";
      const result = await window.codexDesktop.connectCodingAgent(providerId);
      if (result?.readiness && typeof result.readiness === "object") {
        state.codexReadiness = result.readiness;
      } else {
        await checkCodexReadiness({ quiet: true });
      }
      showToast("ChatGPT 已连接。", "success");
    } catch {
      showToast("无法启动 ChatGPT 登录，请重试或复制 codex login 命令。", "error", 7_000);
    } finally {
      state.codingAgentConnectPending = false;
      renderCodexReadiness();
    }
  }

  async function apiFetch(path, options = {}) {
    const { timeout = 15_000, silent = false, root = false, ...fetchOptions } = options;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    const headers = new Headers(fetchOptions.headers || {});
    if (fetchOptions.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");

    try {
      const response = await fetch(root ? path : `${API_BASE}${path}`, {
        cache: "no-store",
        credentials: "same-origin",
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") || "";
      let payload = null;
      if (response.status !== 204) {
        payload = contentType.includes("application/json")
          ? await response.json().catch(() => null)
          : await response.text().catch(() => "");
      }
      if (!response.ok) {
        const error = new Error(messageFromErrorPayload(payload, `请求失败（HTTP ${response.status}）`));
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("本地服务响应超时，请确认服务仍在运行。");
      }
      if (error instanceof TypeError && !silent) {
        throw new Error("无法连接本地 Codex 服务，请检查应用服务状态。");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function showToast(message, type = "info", duration = 4_000) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.setAttribute("role", type === "error" ? "alert" : "status");
    const text = document.createElement("span");
    text.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "关闭通知");
    close.textContent = "×";
    const indicator = document.createElement("span");
    indicator.className = "toast-indicator";
    toast.append(indicator, text, close);
    elements.toastRegion.append(toast);

    let timeoutId = null;
    const dismiss = () => {
      if (!toast.isConnected) return;
      toast.classList.add("leaving");
      window.setTimeout(() => toast.remove(), 190);
      if (timeoutId) clearTimeout(timeoutId);
    };
    close.addEventListener("click", dismiss);
    const scheduleDismiss = () => {
      if (duration > 0) timeoutId = window.setTimeout(dismiss, duration);
    };
    toast.addEventListener("mouseenter", () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
    });
    toast.addEventListener("mouseleave", scheduleDismiss);
    scheduleDismiss();
    return dismiss;
  }

  function setConnection(status, label) {
    const normalized = status === "online" ? "online" : status === "offline" ? "offline" : "checking";
    elements.connectionChip.className = `connection-chip ${normalized}`;
    elements.connectionText.textContent = label || (normalized === "online" ? "本地服务在线" : normalized === "offline" ? "服务离线" : "正在连接");
    if (elements.sidebarConnectionDot) elements.sidebarConnectionDot.className = `connection-dot ${normalized}`;
    state.connectionOkay = normalized === "online";
  }

  function getStoredValue(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function setStoredValue(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage can be disabled in a hardened webview; the UI remains functional.
    }
  }

  function loadStoredPreferences() {
    const path = getStoredValue("codex.projectPath");
    if (path) {
      elements.projectPath.value = path;
      state.projectPathDraft = path;
      state.selectedProject = { path };
    }
    state.projectless = getStoredValue("codex.projectless") === "true";
    const savedConfig = getStoredValue("codex.runConfig");
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        if (typeof parsed.model === "string" && parsed.model.trim() && parsed.model.length <= 128) {
          state.config.model = parsed.model.trim();
        }
        const storedEffort = parsed.effort === "Ultra" ? "Xhigh" : parsed.effort;
        if (EFFORT_OPTIONS.includes(storedEffort)) state.config.effort = storedEffort;
        if (SPEED_OPTIONS.includes(parsed.speed)) state.config.speed = parsed.speed;
      } catch {
        // Ignore malformed preferences.
      }
    }
    updateProjectMode({ persist: false });
    updateConfigLabels();
  }

  function storeConfig() {
    setStoredValue("codex.runConfig", JSON.stringify(state.config));
  }

  function updateConfigLabels() {
    elements.currentModel.textContent = state.config.model;
    elements.currentEffort.textContent = state.config.effort;
    elements.currentSpeed.textContent = state.config.speed;
    elements.triggerModel.textContent = state.config.model;
    elements.triggerEffort.textContent = state.config.effort;
    if (!state.currentTask || !ACTIVE_STATUSES.has(normalizeStatus(state.currentTask.status))) {
      elements.modelMetric.textContent = state.config.model;
      elements.effortMetric.textContent = `${state.config.effort} effort`;
    }
  }

  function toggleModelPopover(force) {
    const shouldOpen = force ?? elements.modelPopover.hidden;
    elements.modelPopover.hidden = !shouldOpen;
    elements.modelTrigger.setAttribute("aria-expanded", String(shouldOpen));
    if (!shouldOpen) closeSubmenu();
    return shouldOpen;
  }

  function closeSubmenu(focusParent = false) {
    const previous = state.activeSubmenu;
    state.activeSubmenu = null;
    elements.settingSubmenu.hidden = true;
    $$(".setting-row", elements.modelPopover).forEach((row) => {
      row.classList.remove("open");
      row.setAttribute("aria-expanded", "false");
    });
    if (focusParent && previous) $(`.setting-row[data-setting="${previous}"]`, elements.modelPopover)?.focus();
  }

  function openSubmenu(setting, focusOption = false) {
    const definitions = {
      model: { title: "Model", options: state.modelCatalog.map((model) => model.label), selected: state.config.model },
      effort: { title: "Effort", options: EFFORT_OPTIONS, selected: state.config.effort },
      speed: { title: "Speed", options: SPEED_OPTIONS, selected: state.config.speed },
    };
    const definition = definitions[setting];
    if (!definition) return;
    state.activeSubmenu = setting;
    elements.submenuTitle.textContent = definition.title;
    elements.submenuOptions.replaceChildren();
    definition.options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `submenu-option${option === definition.selected ? " selected" : ""}`;
      button.setAttribute("role", "menuitemradio");
      button.setAttribute("aria-checked", String(option === definition.selected));
      button.dataset.value = option;
      button.textContent = option;
      button.addEventListener("click", () => selectSetting(setting, option));
      button.addEventListener("keydown", handleSubmenuKeydown);
      elements.submenuOptions.append(button);
    });
    elements.settingSubmenu.hidden = false;
    $$(".setting-row", elements.modelPopover).forEach((row) => {
      const open = row.dataset.setting === setting;
      row.classList.toggle("open", open);
      row.setAttribute("aria-expanded", String(open));
    });
    if (focusOption) {
      requestAnimationFrame(() => ($(".submenu-option.selected", elements.settingSubmenu) || $(".submenu-option", elements.settingSubmenu))?.focus());
    }
  }

  function selectSetting(setting, value) {
    if (setting === "model" && state.modelCatalog.some((model) => model.label === value)) state.config.model = value;
    if (setting === "effort" && EFFORT_OPTIONS.includes(value)) state.config.effort = value;
    if (setting === "speed" && SPEED_OPTIONS.includes(value)) state.config.speed = value;
    updateConfigLabels();
    storeConfig();
    toggleModelPopover(false);
    elements.modelTrigger.focus();
  }

  function resetSettings() {
    state.config = { ...DEFAULT_CONFIG };
    updateConfigLabels();
    storeConfig();
    toggleModelPopover(false);
    showToast("模型设置已恢复默认值。", "success");
    elements.modelTrigger.focus();
  }

  function moveFocusWithin(items, current, direction) {
    if (!items.length) return;
    const currentIndex = Math.max(0, items.indexOf(current));
    const nextIndex = (currentIndex + direction + items.length) % items.length;
    items[nextIndex].focus();
  }

  function handleMainMenuKeydown(event) {
    const items = $$(".setting-row, .reset-setting", elements.modelPopover).filter((node) => !node.hidden);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocusWithin(items, event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "ArrowRight" && event.currentTarget.dataset.setting) {
      event.preventDefault();
      openSubmenu(event.currentTarget.dataset.setting, true);
    } else if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      toggleModelPopover(false);
      elements.modelTrigger.focus();
    }
  }

  function handleSubmenuKeydown(event) {
    const items = $$(".submenu-option", elements.settingSubmenu);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocusWithin(items, event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      closeSubmenu(true);
    }
  }

  function normalizeStatus(status) {
    const value = String(status || "idle").toLowerCase().replaceAll("_", "-");
    if (value === "in-progress" || value === "inprogress" || value === "active") return "running";
    if (value === "done") return "completed";
    if (value === "waiting") return "queued";
    return value;
  }

  function statusLabel(status) {
    const normalized = normalizeStatus(status);
    return STATUS_LABELS[normalized] || status || "等待任务";
  }

  function isTaskActive(task = state.currentTask) {
    return Boolean(task && ACTIVE_STATUSES.has(normalizeStatus(task.status)));
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
  }

  function localizeEventMessage(value) {
    const message = String(value ?? "");
    return EVENT_MESSAGE_LABELS[message] || message;
  }

  function usageNumber(...values) {
    const value = firstDefined(...values);
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
  }

  function normalizeUsage(raw, resultValue) {
    const source = firstDefined(raw?.usage, raw?.tokenUsage, raw?.token_usage, resultValue?.usage);
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return { input: 0, cached: 0, output: 0, reasoning: 0, total: 0, reported: false };
    }
    const input = usageNumber(source.input_tokens, source.inputTokens, source.input);
    const cached = usageNumber(source.cached_input_tokens, source.cachedInputTokens, source.cached);
    const output = usageNumber(source.output_tokens, source.outputTokens, source.output);
    const reasoning = usageNumber(source.reasoning_output_tokens, source.reasoningOutputTokens, source.reasoning);
    const reported = [
      "input_tokens", "inputTokens", "input",
      "cached_input_tokens", "cachedInputTokens", "cached",
      "output_tokens", "outputTokens", "output",
      "reasoning_output_tokens", "reasoningOutputTokens", "reasoning",
    ].some((key) => Object.prototype.hasOwnProperty.call(source, key));
    return { input, cached, output, reasoning, total: input + output, reported };
  }

  function normalizeTask(raw) {
    if (!raw || typeof raw !== "object") return null;
    const options = raw.options || raw.config || raw.request || {};
    const project = raw.project || {};
    const resultValue = firstDefined(raw.result, raw.finalResult, raw.final_result, raw.output, raw.answer);
    const result = typeof resultValue === "object" && resultValue
      ? firstDefined(resultValue.markdown, resultValue.content, resultValue.text, resultValue.message, JSON.stringify(resultValue, null, 2))
      : resultValue;
    const fileValue = firstDefined(raw.filesChanged, raw.files_changed, raw.changedFiles, raw.changes);
    const events = asArray(firstDefined(raw.events, raw.timeline, []));
    const storedLogs = asArray(firstDefined(raw.logs, raw.logEntries, raw.log_entries, []));
    const eventLogs = events
      .filter((event) => ["log", "error"].includes(String(event?.type || "").toLowerCase()))
      .map((event) => ({
        ...(event.data && typeof event.data === "object" ? event.data : {}),
        level: event.type,
        timestamp: event.timestamp,
      }));
    return {
      ...raw,
      id: String(firstDefined(raw.id, raw.taskId, raw.task_id, raw.uuid, "")),
      prompt: String(firstDefined(raw.prompt, raw.promptPreview, raw.prompt_preview, raw.instructions, raw.input, raw.title) ?? ""),
      status: normalizeStatus(firstDefined(raw.status, raw.state, "idle")),
      createdAt: firstDefined(raw.createdAt, raw.created_at, raw.timestamp),
      startedAt: firstDefined(raw.startedAt, raw.started_at, raw.createdAt, raw.created_at),
      endedAt: firstDefined(raw.endedAt, raw.ended_at, raw.completedAt, raw.completed_at, raw.updatedAt, raw.updated_at),
      projectPath: String(firstDefined(raw.projectPath, raw.project_path, project.path, options.projectPath) ?? ""),
      projectId: firstDefined(raw.projectId, raw.project_id, project.id, options.projectId),
      projectless: raw.projectless === true || project.projectless === true,
      credentialId: String(firstDefined(raw.credentialId, raw.credential_id) ?? ""),
      model: String(firstDefined(raw.modelLabel, raw.model_label, raw.model, options.modelLabel, options.model, DEFAULT_CONFIG.model)),
      effort: String(firstDefined(raw.effortLabel, raw.effort_label, raw.effort, options.effort, DEFAULT_CONFIG.effort)),
      speed: String(firstDefined(raw.speedLabel, raw.speed_label, raw.speed, options.speed, DEFAULT_CONFIG.speed)),
      result: result == null ? "" : String(result),
      logs: storedLogs.length ? storedLogs : eventLogs,
      steps: asArray(firstDefined(raw.steps, events)),
      filesChanged: Array.isArray(fileValue) ? fileValue.length : Number(fileValue || 0),
      error: firstDefined(raw.error?.message, raw.error, raw.failureReason, raw.failure_reason),
      usage: normalizeUsage(raw, resultValue),
    };
  }

  function taskTitle(task) {
    const text = String(task?.prompt || task?.title || "未命名任务").trim().replace(/\s+/g, " ");
    return text.length > 48 ? `${text.slice(0, 48)}…` : text || "未命名任务";
  }

  function formatRelativeTime(value) {
    const date = value ? new Date(value) : null;
    const english = state.language !== "zh";
    if (!date || Number.isNaN(date.getTime())) return english ? "Just now" : "刚刚";
    const seconds = Math.round((Date.now() - date.getTime()) / 1_000);
    if (seconds < 45) return english ? "Just now" : "刚刚";
    if (seconds < 3_600) {
      const minutes = Math.max(1, Math.floor(seconds / 60));
      return english ? `${minutes} min ago` : `${minutes} 分钟前`;
    }
    if (seconds < 86_400) {
      const hours = Math.floor(seconds / 3_600);
      return english ? `${hours} hr ago` : `${hours} 小时前`;
    }
    if (seconds < 604_800) {
      const days = Math.floor(seconds / 86_400);
      return english ? `${days} ${days === 1 ? "day" : "days"} ago` : `${days} 天前`;
    }
    return new Intl.DateTimeFormat(activeLocale(), { month: "numeric", day: "numeric" }).format(date);
  }

  function formatClock(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "--:--:--";
    return new Intl.DateTimeFormat(activeLocale(), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  }

  function formatElapsed(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1_000));
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatTokenCount(value) {
    return new Intl.NumberFormat(activeLocale(), { maximumFractionDigits: 0 }).format(Math.max(0, Number(value) || 0));
  }

  function percentage(value, total) {
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round((Number(value) / Number(total)) * 100)));
  }

  function emptyUsageSummary() {
    return {
      resetAt: null,
      updatedAt: null,
      tasks: 0,
      active: 0,
      finished: 0,
      succeeded: 0,
      reported: 0,
      input: 0,
      cached: 0,
      output: 0,
      reasoning: 0,
      total: 0,
      models: new Map(),
      credentials: new Map(),
    };
  }

  function normalizedUsageAggregate(record = {}) {
    return {
      tasks: usageNumber(record.tasks),
      input: usageNumber(record.inputTokens, record.input_tokens),
      cached: usageNumber(record.cachedInputTokens, record.cached_input_tokens),
      output: usageNumber(record.outputTokens, record.output_tokens),
      reasoning: usageNumber(record.reasoningOutputTokens, record.reasoning_output_tokens),
      total: usageNumber(record.totalTokens, record.total_tokens),
    };
  }

  function normalizeUsageSnapshot(payload) {
    const source = unwrapPayload(payload);
    if (!source || typeof source !== "object") return emptyUsageSummary();
    const models = new Map(asArray(source.models).map((record) => {
      const model = String(record?.model || record?.modelLabel || "Unknown");
      const aggregate = normalizedUsageAggregate(record);
      return [model, { model, ...aggregate, tokens: aggregate.total }];
    }));
    const credentials = new Map(asArray(source.credentials).map((record) => [
      String(record?.credentialId || ""),
      normalizedUsageAggregate(record),
    ]).filter(([credentialId]) => credentialId));
    return {
      resetAt: source.resetAt || source.reset_at || null,
      updatedAt: source.updatedAt || source.updated_at || null,
      tasks: usageNumber(source.taskCount, source.task_count),
      active: usageNumber(source.activeCount, source.active_count),
      finished: usageNumber(source.finishedCount, source.finished_count),
      succeeded: usageNumber(source.completedCount, source.completed_count),
      reported: usageNumber(source.tasksWithUsage, source.tasks_with_usage),
      input: usageNumber(source.inputTokens, source.input_tokens),
      cached: usageNumber(source.cachedInputTokens, source.cached_input_tokens),
      output: usageNumber(source.outputTokens, source.output_tokens),
      reasoning: usageNumber(source.reasoningOutputTokens, source.reasoning_output_tokens),
      total: usageNumber(source.totalTokens, source.total_tokens),
      models,
      credentials,
    };
  }

  function gatewayKeyById(id) {
    return state.apiKeys.find((key) => key.id === id) || null;
  }

  function apiTasksForCurrentFilter() {
    return state.tasks.filter((task) => (
      task.credentialId
      && (state.gatewayKeyFilter === "all" || task.credentialId === state.gatewayKeyFilter)
    ));
  }

  function gatewayUsageForCurrentFilter() {
    const summary = state.usageSummary || emptyUsageSummary();
    if (state.gatewayKeyFilter !== "all") {
      return summary.credentials.get(state.gatewayKeyFilter) || normalizedUsageAggregate();
    }
    return [...summary.credentials.values()].reduce((total, record) => ({
      tasks: total.tasks + record.tasks,
      input: total.input + record.input,
      cached: total.cached + record.cached,
      output: total.output + record.output,
      reasoning: total.reasoning + record.reasoning,
      total: total.total + record.total,
    }), normalizedUsageAggregate());
  }

  function taskLatency(task) {
    const started = new Date(task.startedAt || task.createdAt || 0).getTime();
    const ended = new Date(task.endedAt || task.completedAt || task.updatedAt || 0).getTime();
    return Number.isFinite(started) && Number.isFinite(ended) && started > 0 && ended >= started
      ? ended - started
      : 0;
  }

  function formatGatewayLatency(milliseconds) {
    const value = Math.max(0, Number(milliseconds) || 0);
    if (!value) return "—";
    if (value < 1_000) return `${Math.round(value)} ms`;
    if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
    return formatElapsed(value);
  }

  function taskTokenLabel(task) {
    if (task?.usage?.reported) return `${formatTokenCount(task.usage.total)} Token`;
    return isTaskActive(task) ? "Token 统计中" : "0 Token";
  }

  function updateGatewayKeyFilter() {
    if (!elements.gatewayKeyFilter) return;
    const selected = state.gatewayKeyFilter;
    elements.gatewayKeyFilter.replaceChildren();
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "全部 API Key";
    elements.gatewayKeyFilter.append(all);
    state.apiKeys.forEach((key) => {
      const option = document.createElement("option");
      option.value = key.id;
      option.textContent = key.name || key.preset?.modelLabel || "未命名密钥";
      elements.gatewayKeyFilter.append(option);
    });
    state.gatewayKeyFilter = selected === "all" || state.apiKeys.some((key) => key.id === selected)
      ? selected
      : "all";
    elements.gatewayKeyFilter.value = state.gatewayKeyFilter;
  }

  function renderGatewayCalls(tasks) {
    elements.gatewayCallList.replaceChildren();
    if (!tasks.length) {
      const empty = document.createElement("div");
      empty.className = "gateway-call-empty";
      empty.innerHTML = "<strong>等待 API 调用</strong><span>其他程序使用 Gateway Key 后，请求会显示在这里。</span>";
      elements.gatewayCallList.append(empty);
      return;
    }

    tasks.slice(0, 16).forEach((task) => {
      const key = gatewayKeyById(task.credentialId);
      const status = normalizeStatus(task.status);
      const row = document.createElement("button");
      row.type = "button";
      row.className = `gateway-call-row ${status}`;
      row.setAttribute("aria-label", `打开任务：${taskTitle(task)}`);

      const statusNode = document.createElement("span");
      statusNode.className = `gateway-call-status ${status}`;
      statusNode.setAttribute("aria-hidden", "true");

      const identity = document.createElement("span");
      identity.className = "gateway-call-identity";
      const title = document.createElement("strong");
      title.textContent = taskTitle(task);
      const meta = document.createElement("small");
      const projectLabel = task.projectless
        ? "无项目"
        : String(task.projectPath || "项目").split(/[\\/]/).filter(Boolean).at(-1) || "项目";
      meta.textContent = `${key?.name || "已删除的 Key"} · ${displayModelName(task.model)} · ${projectLabel}`;
      identity.append(title, meta);

      const metrics = document.createElement("span");
      metrics.className = "gateway-call-metrics";
      const latency = document.createElement("strong");
      latency.textContent = isTaskActive(task) ? statusLabel(status) : formatGatewayLatency(taskLatency(task));
      const tokens = document.createElement("small");
      tokens.textContent = `${formatTokenCount(task.usage?.total || 0)} Token · ${formatRelativeTime(task.createdAt || task.startedAt)}`;
      metrics.append(latency, tokens);

      row.append(statusNode, identity, metrics);
      row.addEventListener("click", () => void loadTask(task.id));
      elements.gatewayCallList.append(row);
    });
  }

  function renderGatewayMonitor() {
    if (!elements.gatewayDashboard) return;
    updateGatewayKeyFilter();
    const tasks = apiTasksForCurrentFilter();
    const usage = gatewayUsageForCurrentFilter();
    const finished = tasks.filter((task) => FINISHED_STATUSES.has(normalizeStatus(task.status)));
    const succeeded = finished.filter((task) => ["completed", "succeeded", "success"].includes(normalizeStatus(task.status)));
    const latencies = finished.map(taskLatency).filter((value) => value > 0);
    const active = tasks.filter((task) => isTaskActive(task)).length;
    const selectedKey = state.gatewayKeyFilter === "all" ? null : gatewayKeyById(state.gatewayKeyFilter);
    const lastTask = tasks[0] || null;

    elements.gatewayActiveTasks.textContent = formatTokenCount(active);
    elements.gatewayActiveConnections.textContent = formatTokenCount(state.gatewaySnapshot.activeConnections);
    elements.gatewayCallCount.textContent = formatTokenCount(usage.tasks);
    elements.gatewayCallCountNote.textContent = selectedKey?.name || "全部 API Key";
    elements.gatewaySuccessRate.textContent = finished.length ? `${percentage(succeeded.length, finished.length)}%` : "—";
    elements.gatewayAverageLatency.textContent = latencies.length
      ? formatGatewayLatency(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : "—";
    elements.gatewayTokenCount.textContent = formatTokenCount(usage.total);

    elements.gatewayFocusTitle.textContent = selectedKey?.name || "全部 API Key";
    elements.gatewayFocusDescription.textContent = selectedKey
      ? selectedKey.maskedKey || "ccc_live_••••"
      : "汇总所有外部程序调用，不包含本地 API 测试台任务。";
    elements.gatewayFocusToken.textContent = formatTokenCount(usage.total);
    elements.gatewayFocusModel.textContent = selectedKey?.preset?.modelLabel || selectedKey?.preset?.model || "多个模型";
    elements.gatewayFocusPermission.textContent = selectedKey
      ? permissionDisplay(selectedKey.preset?.permission)
      : "按 Key 配置";
    elements.gatewayFocusLastCall.textContent = lastTask
      ? formatRelativeTime(lastTask.createdAt || lastTask.startedAt)
      : "暂无";
    elements.gatewayFocusLastStatus.textContent = lastTask
      ? statusLabel(lastTask.status)
      : "等待调用";

    renderGatewayCalls(tasks);
  }

  function formatUsageStart(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "等待统计数据";
    return `累计自 ${new Intl.DateTimeFormat(activeLocale(), {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date)}`;
  }

  function renderUsageModels(summary) {
    elements.usageModelList.replaceChildren();
    const models = [...summary.models.values()]
      .filter((item) => item.tasks > 0 || item.tokens > 0)
      .sort((left, right) => (
        right.tokens - left.tokens
        || right.tasks - left.tasks
        || left.model.localeCompare(right.model, activeLocale())
      ));
    if (!models.length) {
      const empty = document.createElement("div");
      empty.className = "usage-empty";
      empty.textContent = "运行任务后显示模型分布";
      elements.usageModelList.append(empty);
      return;
    }
    const maximum = Math.max(...models.map((item) => item.tokens), 1);
    models.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "usage-model-row";
      const label = document.createElement("div");
      label.innerHTML = `<span>${index + 1}</span><div><strong>${escapeHtml(item.model)}</strong><small>${item.tasks} 个累计任务</small></div>`;
      const amount = document.createElement("code");
      amount.textContent = formatTokenCount(item.tokens);
      const track = document.createElement("i");
      const fill = document.createElement("b");
      fill.style.width = item.tokens > 0
        ? `${Math.max(4, percentage(item.tokens, maximum))}%`
        : "0%";
      track.append(fill);
      row.append(label, amount, track);
      elements.usageModelList.append(row);
    });
  }

  function renderUsageDashboard() {
    const summary = state.usageSummary || emptyUsageSummary();
    elements.usageTotalTokens.textContent = formatTokenCount(summary.total);
    elements.usageCoverage.textContent = `${summary.reported} 个任务含 Token 数据`;
    elements.usageTaskCount.textContent = formatTokenCount(summary.tasks);
    elements.usageActiveCount.textContent = `${summary.active} 个运行中`;
    elements.usageSuccessRate.textContent = summary.finished
      ? `${percentage(summary.succeeded, summary.finished)}%`
      : "—";
    elements.usageInputTokens.textContent = formatTokenCount(summary.input);
    elements.usageOutputTokens.textContent = formatTokenCount(summary.output);
    elements.usageCachedTokens.textContent = formatTokenCount(summary.cached);
    elements.usageReasoningTokens.textContent = formatTokenCount(summary.reasoning);

    const inputShare = percentage(summary.input, summary.total);
    const outputShare = percentage(summary.output, summary.total);
    const cachedShare = percentage(summary.cached, summary.input);
    const reasoningShare = percentage(summary.reasoning, summary.output);
    elements.usageInputShare.textContent = `${inputShare}%`;
    elements.usageOutputShare.textContent = `${outputShare}%`;
    elements.usageCachedShare.textContent = `${cachedShare}%`;
    elements.usageReasoningShare.textContent = `${reasoningShare}%`;
    elements.usageInputBar.style.width = `${inputShare}%`;
    elements.usageOutputBar.style.width = `${outputShare}%`;
    elements.usageCachedBar.style.width = `${cachedShare}%`;
    elements.usageReasoningBar.style.width = `${reasoningShare}%`;
    elements.usageUpdatedAt.textContent = formatUsageStart(summary.resetAt);
    renderUsageModels(summary);
    renderGatewayMonitor();
  }

  function updateElapsed() {
    if (!state.startedAt) {
      elements.elapsedMetric.textContent = "00:00";
      return;
    }
    const start = new Date(state.startedAt).getTime();
    const end = state.endedAt ? new Date(state.endedAt).getTime() : Date.now();
    elements.elapsedMetric.textContent = formatElapsed(Math.max(0, end - start));
  }

  function startElapsedTimer() {
    if (state.elapsedTimer) clearInterval(state.elapsedTimer);
    updateElapsed();
    if (isTaskActive()) state.elapsedTimer = window.setInterval(updateElapsed, 1_000);
  }

  function stopElapsedTimer() {
    if (state.elapsedTimer) clearInterval(state.elapsedTimer);
    state.elapsedTimer = null;
    updateElapsed();
  }

  function setStatus(status, taskPatch = {}) {
    const normalized = normalizeStatus(status);
    if (state.currentTask) state.currentTask = { ...state.currentTask, ...taskPatch, status: normalized };
    elements.statusPill.className = `status-pill ${normalized}`;
    $("b", elements.statusPill).textContent = statusLabel(normalized);
    const active = ACTIVE_STATUSES.has(normalized);
    elements.runButton.classList.toggle("running", active);
    elements.runButton.setAttribute("aria-label", active ? "取消当前任务" : "运行任务");
    if (FINISHED_STATUSES.has(normalized)) {
      state.endedAt = firstDefined(taskPatch.endedAt, state.currentTask?.endedAt, new Date().toISOString());
      stopElapsedTimer();
      closeTaskStreams();
    } else if (active && !state.elapsedTimer) {
      startElapsedTimer();
    }
    if (state.currentTask) upsertTask(state.currentTask, false);
    syncImageControls();
  }

  function renderHistory() {
    renderUsageDashboard();
    elements.historyList.replaceChildren();
    if (!state.tasks.length) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.innerHTML = "<strong>还没有历史任务</strong><span>运行第一个任务后，它会保留在这里。</span>";
      elements.historyList.append(empty);
      return;
    }
    state.tasks.slice(0, 60).forEach((task) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `history-item${state.currentTask?.id === task.id ? " active" : ""}`;
      button.dataset.taskId = task.id;
      button.setAttribute("aria-label", `打开任务：${taskTitle(task)}`);
      const status = normalizeStatus(task.status);
      const source = task.credentialId
        ? (gatewayKeyById(task.credentialId)?.name || "外部 API")
        : "API 测试台";
      button.innerHTML = `
        <span class="history-status ${escapeAttribute(status)}" aria-hidden="true"></span>
        <span class="history-content"><strong>${escapeHtml(taskTitle(task))}</strong><small>${escapeHtml(source)} · ${escapeHtml(taskTokenLabel(task))}</small></span>
        <span class="history-time">${escapeHtml(formatRelativeTime(task.createdAt || task.startedAt))}</span>`;
      button.addEventListener("click", () => loadTask(task.id));
      elements.historyList.append(button);
    });
  }

  function upsertTask(rawTask, rerender = true) {
    const task = normalizeTask(rawTask);
    if (!task?.id) return;
    const index = state.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) state.tasks[index] = { ...state.tasks[index], ...task };
    else state.tasks.unshift(task);
    state.tasks.sort((a, b) => new Date(b.createdAt || b.startedAt || 0) - new Date(a.createdAt || a.startedAt || 0));
    if (rerender) renderHistory();
    else renderUsageDashboard();
  }

  function normalizeLogEntry(entry) {
    if (typeof entry === "string") return { message: entry, level: "info", timestamp: new Date().toISOString() };
    const source = entry && typeof entry === "object" ? entry : {};
    return {
      message: String(firstDefined(source.message, source.text, source.content, source.output, source.command, source.detail) ?? ""),
      level: String(firstDefined(source.level, source.severity, source.kind, source.type, "info")).toLowerCase(),
      timestamp: firstDefined(source.timestamp, source.time, source.createdAt, source.created_at, new Date().toISOString()),
    };
  }

  function normalizeLogLevel(level) {
    const value = String(level || "info").toLowerCase();
    if (value.includes("err") || value === "stderr") return "error";
    if (value.includes("warn")) return "warn";
    if (value.includes("success") || value.includes("complete") || value === "stdout") return value === "stdout" ? "info" : "success";
    if (value.includes("command") || value.includes("tool") || value.includes("exec")) return "command";
    return "info";
  }

  function appendLog(entry, options = {}) {
    const normalized = normalizeLogEntry(entry);
    if (!normalized.message.trim()) return;
    const level = normalizeLogLevel(normalized.level);
    const key = options.key || `${normalized.timestamp}|${level}|${normalized.message}`;
    if (state.logs.some((item) => item.key === key)) return;
    state.logs.push({ ...normalized, level, key });
    if (state.logs.length > 1_000) state.logs.splice(0, state.logs.length - 1_000);
    renderLogLine(state.logs.at(-1));
    elements.logCount.textContent = `${state.logs.length} 条日志`;
  }

  function logSymbol(level) {
    return { error: "×", warn: "!", success: "✓", command: "$", info: "›" }[level] || "›";
  }

  function renderLogLine(entry) {
    elements.terminalEmpty?.remove();
    const line = document.createElement("div");
    line.className = `log-line ${entry.level}`;
    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = formatClock(entry.timestamp);
    const symbol = document.createElement("span");
    symbol.className = "log-symbol";
    symbol.textContent = logSymbol(entry.level);
    const message = document.createElement("span");
    message.className = "log-message";
    message.textContent = entry.message;
    line.append(time, symbol, message);
    elements.terminal.append(line);
    if (elements.autoScroll.checked) elements.terminal.scrollTop = elements.terminal.scrollHeight;
  }

  function renderAllLogs() {
    elements.terminal.replaceChildren();
    if (!state.logs.length) {
      const empty = document.createElement("div");
      empty.className = "terminal-empty";
      empty.id = "terminalEmpty";
      empty.innerHTML = '<span class="terminal-logo">›_</span><strong>日志流已就绪</strong><p>运行任务后，命令、工具调用和执行反馈将在这里实时出现。</p>';
      elements.terminal.append(empty);
      elements.terminalEmpty = empty;
    } else {
      state.logs.forEach(renderLogLine);
    }
    elements.logCount.textContent = `${state.logs.length} 条日志`;
  }

  function clearLogs() {
    state.logs = [];
    renderAllLogs();
  }

  function normalizeStep(step, index = 0) {
    if (typeof step === "string") {
      return { id: `step-${index}-${step}`, title: step, description: "", status: "completed", timestamp: null };
    }
    const source = step && typeof step === "object" ? step : {};
    const data = source.data && typeof source.data === "object" ? source.data : {};
    const type = String(firstDefined(source.type, source.kind, "step")).toLowerCase();
    const eventStatus = normalizeStatus(firstDefined(
      data.status,
      source.status,
      type === "error" ? "failed" : type === "done" ? "completed" : "completed",
    ));
    const fallbackTitle = type === "status"
      ? statusLabel(eventStatus)
      : type === "error" ? "执行失败"
        : type === "done" ? "任务结束"
          : type === "log" ? "运行日志" : type === "step" ? "执行步骤" : type;
    return {
      id: String(firstDefined(source.id, source.stepId, source.step_id, `${index}-${source.timestamp || Date.now()}`)),
      title: String(firstDefined(source.title, source.name, source.label, fallbackTitle, `步骤 ${index + 1}`)),
      description: localizeEventMessage(firstDefined(source.description, data.message, data.text, source.detail, source.text, source.content)),
      status: eventStatus,
      timestamp: firstDefined(source.timestamp, data.timestamp, source.time, source.startedAt, source.started_at),
    };
  }

  function addStep(rawStep) {
    const step = normalizeStep(rawStep, state.steps.length);
    const existing = state.steps.findIndex((item) => item.id === step.id);
    if (existing >= 0) state.steps[existing] = { ...state.steps[existing], ...step };
    else state.steps.push(step);
    if (state.steps.length > 120) state.steps.splice(0, state.steps.length - 120);
    renderTimeline();
  }

  function renderTimeline() {
    elements.timeline.replaceChildren();
    if (!state.steps.length) {
      const item = document.createElement("li");
      item.className = "timeline-empty";
      item.innerHTML = '<span class="timeline-node"></span><div><strong>等待开始</strong><p>提交任务后，Codex 的执行步骤会显示在这里。</p></div>';
      elements.timeline.append(item);
    } else {
      state.steps.forEach((step) => {
        const item = document.createElement("li");
        item.className = step.status;
        item.innerHTML = `<span class="timeline-node" aria-hidden="true"></span><div><strong>${escapeHtml(step.title)}</strong>${step.description ? `<p>${escapeHtml(step.description)}</p>` : ""}</div>${step.timestamp ? `<time>${escapeHtml(formatClock(step.timestamp))}</time>` : ""}`;
        elements.timeline.append(item);
      });
      elements.timeline.scrollTop = elements.timeline.scrollHeight;
    }
    elements.stepsMetric.textContent = String(state.steps.length);
    elements.stepsCaption.textContent = state.steps.length ? `${state.steps.filter((item) => ["completed", "success", "succeeded"].includes(item.status)).length} 个已完成` : "尚未开始";
  }

  function inlineMarkdown(text) {
    let escaped = escapeHtml(text);
    const codeSlots = [];
    escaped = escaped.replace(/`([^`\n]+)`/g, (_, code) => {
      const token = `@@INLINECODE${codeSlots.length}@@`;
      codeSlots.push(`<code>${code}</code>`);
      return token;
    });
    escaped = escaped
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
    codeSlots.forEach((html, index) => {
      escaped = escaped.replace(`@@INLINECODE${index}@@`, html);
    });
    return escaped;
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    let inCode = false;
    let codeLanguage = "";
    let codeLines = [];
    let listType = null;
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!listType) return;
      html.push(`</${listType}>`);
      listType = null;
    };
    const openList = (type) => {
      if (listType === type) return;
      closeList();
      flushParagraph();
      listType = type;
      html.push(`<${type}>`);
    };
    const flushCode = () => {
      html.push(`<pre${codeLanguage ? ` data-language="${escapeAttribute(codeLanguage)}"` : ""}><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      codeLines = [];
      codeLanguage = "";
    };

    lines.forEach((line) => {
      const fence = line.match(/^\s*```\s*([^\s`]*)/);
      if (fence) {
        if (inCode) {
          inCode = false;
          flushCode();
        } else {
          flushParagraph();
          closeList();
          inCode = true;
          codeLanguage = fence[1] || "";
        }
        return;
      }
      if (inCode) {
        codeLines.push(line);
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        return;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        return;
      }
      if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
        flushParagraph();
        closeList();
        html.push("<hr>");
        return;
      }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        flushParagraph();
        closeList();
        html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
        return;
      }
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      if (unordered) {
        openList("ul");
        let item = unordered[1];
        item = item.replace(/^\[x\]\s*/i, '<span class="md-check">✓</span> ').replace(/^\[ \]\s*/, "○ ");
        html.push(`<li>${inlineMarkdown(item).replaceAll("&lt;span class=&quot;md-check&quot;&gt;✓&lt;/span&gt;", '<span class="md-check">✓</span>')}</li>`);
        return;
      }
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (ordered) {
        openList("ol");
        html.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
        return;
      }
      if (listType) closeList();
      paragraph.push(line.trim());
    });

    if (inCode) flushCode();
    flushParagraph();
    closeList();
    return html.join("\n");
  }

  function setResult(markdown, append = false) {
    const next = String(markdown ?? "");
    state.result = append ? `${state.result}${next}` : next;
    if (!state.result.trim()) {
      elements.resultContent.className = "result-content empty";
      elements.resultContent.innerHTML = '<div class="result-placeholder"><span aria-hidden="true"><svg viewBox="0 0 28 28"><path d="M6 3.5h11l5 5v16H6v-21Z"></path><path d="M17 3.5v5h5M10 13h8M10 17h8M10 21h5"></path></svg></span><strong>结果将在任务完成后呈现</strong><p>支持 Markdown 标题、列表、引用和代码块。</p></div>';
      elements.copyResult.disabled = true;
      return;
    }
    elements.resultContent.className = "result-content";
    elements.resultContent.innerHTML = `<article class="markdown-body">${markdownToHtml(state.result)}</article>`;
    elements.copyResult.disabled = false;
  }

  function resetTaskView() {
    closeTaskStreams();
    state.currentTask = null;
    state.logs = [];
    state.steps = [];
    state.result = "";
    state.startedAt = null;
    state.endedAt = null;
    stopElapsedTimer();
    elements.taskIdLabel.textContent = "尚无任务";
    elements.filesMetric.textContent = "0";
    elements.stepsMetric.textContent = "0";
    elements.stepsCaption.textContent = "尚未开始";
    setStatus("idle");
    renderAllLogs();
    renderTimeline();
    setResult("");
    renderGatewayMonitor();
    updateConfigLabels();
    renderHistory();
  }

  function populateTaskView(rawTask) {
    const task = normalizeTask(rawTask);
    if (!task?.id) return;
    state.currentTask = task;
    state.logs = task.logs.map((entry, index) => ({ ...normalizeLogEntry(entry), key: `stored-${index}` }));
    state.logs = state.logs.map((entry) => ({ ...entry, level: normalizeLogLevel(entry.level) }));
    state.steps = task.steps.map(normalizeStep);
    state.result = task.result;
    state.startedAt = task.startedAt || task.createdAt || new Date().toISOString();
    state.endedAt = FINISHED_STATUSES.has(task.status) ? task.endedAt : null;
    elements.taskIdLabel.textContent = task.id ? `#${task.id.slice(0, 12)}` : "尚无任务";
    elements.filesMetric.textContent = String(task.filesChanged || 0);
    elements.modelMetric.textContent = displayModelName(task.model);
    elements.effortMetric.textContent = `${capitalize(task.effort)} effort`;
    setStatus(task.status, task);
    renderAllLogs();
    renderTimeline();
    setResult(task.result);
    upsertTask(task);
    startElapsedTimer();
    if (isTaskActive(task)) subscribeToTask(task.id);
  }

  function displayModelName(model) {
    const value = String(model || "");
    for (const [label, id] of state.modelIds.entries()) {
      if (id === value) return label;
    }
    return value || DEFAULT_CONFIG.model;
  }

  function capitalize(value) {
    const text = String(value || "");
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  async function loadHistory({ quiet = false } = {}) {
    elements.refreshHistory.disabled = true;
    try {
      const payload = await apiFetch("/tasks?limit=200", { silent: quiet });
      const tasks = extractList(payload, ["tasks", "history", "results"])
        .map(normalizeTask)
        .filter((task) => task?.id);
      state.tasks = tasks.sort((a, b) => new Date(b.createdAt || b.startedAt || 0) - new Date(a.createdAt || a.startedAt || 0));
      renderHistory();
      if (state.apiKeys.length) renderApiKeys();
    } catch (error) {
      if (!quiet) showToast(error.message || "无法加载任务历史。", "error");
      if (!state.tasks.length) renderHistory();
    } finally {
      elements.refreshHistory.disabled = false;
    }
  }

  async function loadUsageDashboard({ quiet = false } = {}) {
    elements.refreshUsageDashboard.disabled = true;
    try {
      const payload = await apiFetch("/usage", { silent: quiet, timeout: 8_000 });
      state.usageSummary = normalizeUsageSnapshot(payload);
      renderUsageDashboard();
      if (state.apiKeys.length) renderApiKeys();
    } catch (error) {
      if (!quiet) showToast(error.message || "无法读取累计用量。", "error");
      if (!state.usageSummary) renderUsageDashboard();
    } finally {
      elements.refreshUsageDashboard.disabled = false;
    }
  }

  async function resetUsageStatistics(button = elements.resetUsageDashboard) {
    if (button.dataset.confirm !== "true") {
      button.dataset.confirm = "true";
      button.classList.add("armed");
      button.textContent = "再次确认";
      window.setTimeout(() => {
        if (!button.isConnected || button.disabled) return;
        button.dataset.confirm = "false";
        button.classList.remove("armed");
        button.textContent = "Reset";
      }, 4_000);
      return;
    }
    button.disabled = true;
    try {
      const payload = await apiFetch("/usage/reset", { method: "POST", body: "{}" });
      state.usageSummary = normalizeUsageSnapshot(payload);
      renderUsageDashboard();
      renderApiKeys();
      showToast("累计用量已重置，将从下一项新任务开始统计。", "success", 5_000);
    } catch (error) {
      showToast(error.message || "用量重置失败。", "error", 6_000);
    } finally {
      button.disabled = false;
      button.dataset.confirm = "false";
      button.classList.remove("armed");
      button.textContent = "Reset";
    }
  }

  async function loadTask(taskId) {
    if (!taskId) return;
    closeSidebar();
    showApiTestBench();
    const cached = state.tasks.find((task) => task.id === taskId);
    if (cached) populateTaskView(cached);
    try {
      const payload = await apiFetch(`/tasks/${encodeURIComponent(taskId)}`);
      const task = extractTask(payload);
      if (!task) throw new Error("任务数据格式无效。");
      populateTaskView(task);
    } catch (error) {
      showToast(error.message || "无法读取任务详情。", "error");
    }
  }

  function normalizeProject(value) {
    if (typeof value === "string") return { path: value, name: value.split(/[\\/]/).filter(Boolean).at(-1) || value };
    if (!value || typeof value !== "object") return null;
    const source = unwrapPayload(value);
    const project = source?.project || source;
    const path = firstDefined(project?.path, project?.projectPath, project?.project_path, project?.directory);
    if (!path) return null;
    return {
      ...project,
      id: firstDefined(project.id, project.projectId, project.project_id),
      path: String(path),
      name: String(firstDefined(project.name, String(path).split(/[\\/]/).filter(Boolean).at(-1), path)),
    };
  }

  function selectProject(project, source = "desktop") {
    const normalized = normalizeProject(project);
    if (!normalized) return false;
    state.selectedProject = normalized;
    state.projectPathDraft = normalized.path;
    if (!state.projectless) elements.projectPath.value = normalized.path;
    setStoredValue("codex.projectPath", normalized.path);
    elements.projectNote.textContent = source === "browser"
      ? "浏览器仅能提供目录名称；桌面应用可获取完整 Windows 路径"
      : `已选择：${normalized.name}`;
    return true;
  }

  function updateProjectMode({ persist = true } = {}) {
    const projectless = state.projectless === true;
    elements.projectModeProject.classList.toggle("active", !projectless);
    elements.projectModeNone.classList.toggle("active", projectless);
    elements.projectModeProject.setAttribute("aria-pressed", String(!projectless));
    elements.projectModeNone.setAttribute("aria-pressed", String(projectless));
    elements.pathControl.classList.toggle("projectless", projectless);
    elements.projectPath.disabled = projectless;
    elements.pickProjectButton.disabled = projectless;
    elements.projectPath.value = projectless
      ? "无项目 · 隔离临时工作区"
      : state.projectPathDraft;
    elements.projectNote.textContent = projectless
      ? "每次任务使用全新的临时目录，任务结束后自动清理"
      : state.selectedProject?.name
        ? `已选择：${state.selectedProject.name}`
        : "可粘贴 Windows 完整路径，或使用原生目录选择器";
    if (persist) setStoredValue("codex.projectless", String(projectless));
  }

  function setProjectlessMode(projectless) {
    if (state.projectless === Boolean(projectless)) return;
    if (!state.projectless) state.projectPathDraft = elements.projectPath.value.trim();
    state.projectless = Boolean(projectless);
    updateProjectMode();
  }

  async function registerProject(project, { required = false } = {}) {
    if (!project?.path) {
      if (required) throw new Error("请选择有效的项目目录。");
      return null;
    }
    try {
      const payload = await apiFetch("/projects", {
        method: "POST",
        body: JSON.stringify({ path: project.path, name: project.name }),
        timeout: 8_000,
        silent: true,
      });
      const registered = normalizeProject(payload);
      if (!registered) throw new Error("服务未返回有效的项目信息。");
      selectProject(registered, "desktop");
      return registered;
    } catch (error) {
      if (required) {
        throw new Error(error?.message || "无法注册项目目录，请确认路径存在且有权访问。");
      }
      return null;
    }
  }

  async function pickProject() {
    elements.pickProjectButton.disabled = true;
    try {
      if (window.codexDesktop?.pickProject) {
        const result = await window.codexDesktop.pickProject();
        if (result && selectProject(result, "desktop")) {
          await registerProject(state.selectedProject);
          showToast("项目目录已更新。", "success");
        }
        return;
      }

      try {
        const payload = await apiFetch("/projects/select", {
          method: "POST",
          body: "{}",
          timeout: 30_000,
          silent: true,
        });
        if (selectProject(payload, "desktop")) {
          showToast("项目目录已更新。", "success");
          return;
        }
      } catch {
        // A regular browser cannot open the native desktop dialog; use directory input below.
      }
      elements.folderFallback.click();
    } catch (error) {
      showToast(error.message || "无法打开目录选择器。", "error");
    } finally {
      elements.pickProjectButton.disabled = false;
    }
  }

  function handleBrowserFolder(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const rootName = file.webkitRelativePath?.split("/")[0] || file.name;
    selectProject({ path: rootName, name: rootName }, "browser");
    showToast("浏览器无法读取完整路径；建议在桌面应用中选择项目。", "warning", 6_000);
    event.target.value = "";
  }

  function attachmentMimeType(file) {
    const declared = String(file?.type || "").toLowerCase();
    const extension = String(file?.name || "").split(".").at(-1)?.toLowerCase();
    return declared || IMAGE_MIME_BY_EXTENSION[extension] || "application/octet-stream";
  }

  function attachmentExtension(file) {
    return String(file?.name || "").split(".").at(-1)?.toLowerCase() || "";
  }

  function isImageAttachment(file) {
    return ["image/png", "image/jpeg", "image/webp"].includes(attachmentMimeType(file))
      || Object.hasOwn(IMAGE_MIME_BY_EXTENSION, attachmentExtension(file));
  }

  function attachmentKind(file) {
    const extension = attachmentExtension(file);
    if (isImageAttachment(file)) return "IMG";
    if (extension === "pdf") return "PDF";
    if (["doc", "docx", "odt", "rtf"].includes(extension)) return "DOC";
    if (["xls", "xlsx", "ods", "csv", "tsv"].includes(extension)) return "SHEET";
    if (["ppt", "pptx", "odp"].includes(extension)) return "SLIDE";
    if (["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"].includes(extension)) return "ZIP";
    if (["txt", "md", "json", "xml", "yaml", "yml", "toml", "log"].includes(extension)) return "TEXT";
    return extension ? extension.slice(0, 6).toUpperCase() : "FILE";
  }

  function formatImageSize(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function syncImageControls() {
    const count = state.selectedImages.length;
    const maximum = state.fileLimits.maxFiles || DEFAULT_FILE_LIMITS.maxFiles;
    const imageCount = state.selectedImages.filter((entry) => isImageAttachment(entry.file)).length;
    const maximumImages = state.fileLimits.maxImages || DEFAULT_FILE_LIMITS.maxImages;
    elements.imageCount.textContent = `${count} / ${maximum}`;
    elements.imageAttachmentTray.hidden = count === 0;
    elements.promptShell.classList.toggle("has-images", count > 0);
    const locked = state.runRequestPending || isTaskActive();
    elements.addImagesButton.disabled = locked || count >= maximum || imageCount >= maximumImages;
    elements.addFilesButton.disabled = locked || count >= maximum;
    elements.imageInput.disabled = locked || count >= maximum || imageCount >= maximumImages;
    elements.fileInput.disabled = locked || count >= maximum;
    $$(".image-remove-button", elements.imageAttachmentTray).forEach((button) => {
      button.disabled = locked;
    });
  }

  function renderSelectedImages() {
    elements.imageAttachmentTray.replaceChildren();
    state.selectedImages.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "image-attachment";

      let preview;
      if (entry.previewUrl) {
        preview = document.createElement("img");
        preview.src = entry.previewUrl;
        preview.alt = "";
      } else {
        preview = document.createElement("span");
        preview.className = "attachment-file-icon";
        preview.textContent = attachmentKind(entry.file);
        preview.setAttribute("aria-hidden", "true");
      }

      const info = document.createElement("div");
      info.className = "image-attachment-info";
      const name = document.createElement("strong");
      name.textContent = entry.file.name;
      name.title = entry.file.name;
      const size = document.createElement("small");
      size.textContent = `${attachmentKind(entry.file)} · ${formatImageSize(entry.file.size)}`;
      info.append(name, size);

      const remove = document.createElement("button");
      remove.className = "image-remove-button";
      remove.type = "button";
      remove.dataset.imageKey = entry.key;
      remove.setAttribute("aria-label", `移除附件：${entry.file.name}`);
      remove.title = "移除附件";
      remove.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8"></path></svg>';
      remove.addEventListener("click", () => removeSelectedImage(entry.key));
      card.append(preview, info, remove);
      elements.imageAttachmentTray.append(card);
    });
    syncImageControls();
  }

  function removeSelectedImage(key) {
    if (state.runRequestPending || isTaskActive()) return;
    const index = state.selectedImages.findIndex((entry) => entry.key === key);
    if (index < 0) return;
    const [removed] = state.selectedImages.splice(index, 1);
    if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    renderSelectedImages();
  }

  function clearSelectedImages() {
    state.selectedImages.forEach((entry) => {
      if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
    state.selectedImages = [];
    elements.imageInput.value = "";
    elements.fileInput.value = "";
    renderSelectedImages();
  }

  function addSelectedImages(files) {
    if (state.runRequestPending || isTaskActive()) return;
    const maximum = state.fileLimits.maxFiles || DEFAULT_FILE_LIMITS.maxFiles;
    const maximumImages = state.fileLimits.maxImages || DEFAULT_FILE_LIMITS.maxImages;
    const maxBytes = state.fileLimits.maxBytesPerFile || DEFAULT_FILE_LIMITS.maxBytesPerFile;
    const maxTotalBytes = state.fileLimits.maxTotalBytes || DEFAULT_FILE_LIMITS.maxTotalBytes;
    let blocked = false;
    let oversized = false;
    let tooManyImages = false;
    let totalTooLarge = false;
    let added = 0;
    let currentBytes = state.selectedImages.reduce((total, entry) => total + entry.file.size, 0);
    let currentImages = state.selectedImages.filter((entry) => isImageAttachment(entry.file)).length;
    for (const file of [...files]) {
      if (state.selectedImages.length >= maximum) break;
      const extension = attachmentExtension(file);
      if (BLOCKED_ATTACHMENT_EXTENSIONS.has(extension)) {
        blocked = true;
        continue;
      }
      if (file.size > maxBytes) {
        oversized = true;
        continue;
      }
      if (currentBytes + file.size > maxTotalBytes) {
        totalTooLarge = true;
        continue;
      }
      const image = isImageAttachment(file);
      if (image && currentImages >= maximumImages) {
        tooManyImages = true;
        continue;
      }
      const duplicate = state.selectedImages.some((entry) => entry.file.name === file.name
        && entry.file.size === file.size && entry.file.lastModified === file.lastModified);
      if (duplicate) continue;
      state.selectedImages.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        mimeType: attachmentMimeType(file),
        previewUrl: image ? URL.createObjectURL(file) : null,
      });
      currentBytes += file.size;
      if (image) currentImages += 1;
      added += 1;
    }
    elements.imageInput.value = "";
    elements.fileInput.value = "";
    renderSelectedImages();
    if (blocked) showToast("不支持上传可执行文件、安装程序、快捷方式或磁盘镜像。", "warning", 6_000);
    else if (oversized) showToast(`附件文件过大。每个文件最大 ${formatImageSize(maxBytes)}。`, "warning");
    else if (totalTooLarge) showToast(`附件总大小不能超过 ${formatImageSize(maxTotalBytes)}。`, "warning");
    else if (tooManyImages) showToast(`图片数量已达到上限。每个任务最多 ${maximumImages} 张。`, "warning");
    else if (added) showToast("附件已添加。创建任务时会安全上传。", "success");
    if (state.selectedImages.length >= maximum && [...files].length > added) {
      showToast(`附件数量已达到上限。每个任务最多 ${maximum} 个。`, "warning");
    }
  }

  async function discardUploadedImages(fileIds) {
    await Promise.allSettled(fileIds.map((id) => apiFetch(`/uploads/files/${encodeURIComponent(id)}`, {
      method: "DELETE",
      silent: true,
      timeout: 5_000,
    })));
  }

  async function uploadSelectedImages() {
    const uploaded = [];
    try {
      for (const [index, entry] of state.selectedImages.entries()) {
        appendLog({
          message: `正在上传任务附件 ${index + 1} / ${state.selectedImages.length} · ${entry.file.name}`,
          level: "info",
        });
        const payload = await apiFetch("/uploads/files", {
          method: "POST",
          headers: {
            "Content-Type": entry.mimeType,
            "X-File-Name": encodeURIComponent(entry.file.name),
          },
          body: entry.file,
          timeout: 45_000,
        });
        const file = payload?.file ?? payload;
        if (!file?.id) throw new Error("附件上传失败。");
        uploaded.push(file);
      }
      return uploaded;
    } catch (error) {
      await discardUploadedImages(uploaded.map((file) => file.id));
      throw error;
    }
  }

  function readPermission() {
    return $("input[name='permission']:checked")?.value || "workspace-write";
  }

  function resolveModelId(label) {
    return state.modelIds.get(label) || label;
  }

  function validateTaskInput() {
    const prompt = elements.taskPrompt.value.trim();
    const projectPath = state.projectless ? "" : elements.projectPath.value.trim();
    if (!prompt) {
      elements.promptShell.classList.remove("invalid");
      requestAnimationFrame(() => elements.promptShell.classList.add("invalid"));
      elements.taskPrompt.focus();
      showToast("请先填写任务描述。", "warning");
      return null;
    }
    if (!state.projectless && !projectPath) {
      elements.projectPath.focus();
      showToast("请选择或填写项目目录。", "warning");
      return null;
    }
    elements.promptShell.classList.remove("invalid");
    return { prompt, projectPath, projectless: state.projectless };
  }

  function buildTaskRequest(input) {
    const permission = readPermission();
    return {
      prompt: input.prompt,
      projectless: input.projectless === true,
      ...(input.projectless ? {} : {
        projectPath: input.projectPath,
        projectId: state.selectedProject?.id || undefined,
      }),
      model: resolveModelId(state.config.model),
      modelLabel: state.config.model,
      effort: state.config.effort.toLowerCase(),
      effortLabel: state.config.effort,
      speed: state.config.speed.toLowerCase(),
      speedLabel: state.config.speed,
      sandboxMode: permission,
      permission,
      approvalPolicy: elements.approvalToggle.checked ? "untrusted" : "never",
    };
  }

  async function startTask() {
    if (state.runRequestPending) return;
    if (isTaskActive()) {
      await cancelTask();
      return;
    }
    const input = validateTaskInput();
    if (!input) return;
    state.runRequestPending = true;
    elements.runButton.disabled = true;
    syncImageControls();
    clearLogs();
    state.steps = [];
    renderTimeline();
    setResult("");
    elements.filesMetric.textContent = "0";
    addStep({ id: "submitting", title: "提交任务", description: "正在将任务发送到本地 Codex 服务", status: "running", timestamp: new Date().toISOString() });
    appendLog({ message: `正在提交任务 · ${state.config.model} · ${state.config.effort}`, level: "info" });

    let uploadedFileIds = [];
    try {
      let request;
      if (input.projectless) {
        request = buildTaskRequest(input);
      } else {
        const registeredProject = await registerProject({
          path: input.projectPath,
          name: input.projectPath.split(/[\\/]/).filter(Boolean).at(-1),
        }, { required: true });
        request = buildTaskRequest({ ...input, projectPath: registeredProject.path });
      }
      const uploadedFiles = await uploadSelectedImages();
      uploadedFileIds = uploadedFiles.map((file) => file.id);
      if (uploadedFileIds.length) request.fileIds = uploadedFileIds;
      const payload = await apiFetch("/tasks", {
        method: "POST",
        body: JSON.stringify(request),
        timeout: 35_000,
      });
      let task = normalizeTask(extractTask(payload));
      if (!task?.id) throw new Error("服务未返回有效的任务 ID。");
      uploadedFileIds = [];
      clearSelectedImages();
      task = {
        ...task,
        prompt: task.prompt || request.prompt,
        projectPath: task.projectPath || request.projectPath || "",
        projectless: request.projectless,
        model: state.config.model,
        effort: state.config.effort,
        speed: state.config.speed,
        status: ACTIVE_STATUSES.has(task.status) ? task.status : "queued",
      };
      state.currentTask = task;
      state.startedAt = task.startedAt || task.createdAt || new Date().toISOString();
      state.endedAt = null;
      state.steps = [];
      state.logs = [];
      state.result = "";
      elements.taskIdLabel.textContent = `#${task.id.slice(0, 12)}`;
      elements.modelMetric.textContent = state.config.model;
      elements.effortMetric.textContent = `${state.config.effort} effort`;
      addStep({ id: "submitted", title: "任务已提交", description: "等待 Codex 开始处理", status: "completed", timestamp: new Date().toISOString() });
      appendLog({ message: `任务 ${task.id} 已创建 · ${request.projectless ? "无项目临时工作区" : "项目工作区"}`, level: "success" });
      setStatus(task.status, task);
      upsertTask(task);
      subscribeToTask(task.id);
      void loadUsageDashboard({ quiet: true });
      showToast("任务已开始运行。", "success");
    } catch (error) {
      if (uploadedFileIds.length) await discardUploadedImages(uploadedFileIds);
      addStep({ id: "submit-error", title: "提交失败", description: error.message, status: "error", timestamp: new Date().toISOString() });
      appendLog({ message: error.message || "任务提交失败", level: "error" });
      setStatus("error");
      showToast(error.message || "任务提交失败。", "error", 6_000);
    } finally {
      state.runRequestPending = false;
      elements.runButton.disabled = false;
      syncImageControls();
    }
  }

  async function cancelTask() {
    const taskId = state.currentTask?.id;
    if (!taskId || !isTaskActive()) return;
    if (state.runRequestPending) return;
    state.runRequestPending = true;
    elements.runButton.disabled = true;
    setStatus("cancelling");
    appendLog({ message: "正在请求取消任务…", level: "warn" });
    try {
      const payload = await apiFetch(`/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: "POST",
        body: "{}",
        timeout: 15_000,
      });
      const task = normalizeTask(extractTask(payload));
      if (task?.id) populateTaskView({ ...state.currentTask, ...task });
      else setStatus("cancelled", { endedAt: new Date().toISOString() });
      addStep({ id: `cancel-${Date.now()}`, title: "任务已取消", description: "已停止后续执行", status: "error", timestamp: new Date().toISOString() });
      appendLog({ message: "任务已取消", level: "warn" });
      showToast("已取消当前任务。", "success");
      void loadHistory({ quiet: true });
      void loadUsageDashboard({ quiet: true });
    } catch (error) {
      setStatus("running");
      appendLog({ message: error.message || "取消任务失败", level: "error" });
      showToast(error.message || "取消任务失败。", "error");
    } finally {
      state.runRequestPending = false;
      elements.runButton.disabled = false;
    }
  }

  function eventSignature(event) {
    const data = event?.data || event?.payload || event;
    const nested = event?.event && typeof event.event === "object"
      ? event.event
      : data?.event && typeof data.event === "object" ? data.event : null;
    const type = firstDefined(
      typeof event?.type === "string" ? event.type : undefined,
      typeof event?.event === "string" ? event.event : undefined,
      event?.kind,
      nested?.type,
      "message",
    );
    const explicitId = firstDefined(event?.id, event?.eventId, event?.event_id, data?.id);
    const nestedId = firstDefined(nested?.id, nested?.item?.id, nested?.thread_id, nested?.turn_id);
    const timestamp = firstDefined(event?.timestamp, data?.timestamp, nested?.timestamp, "");
    const message = firstDefined(data?.message, data?.text, data?.status, nested?.message, nested?.item?.text, "");
    let fingerprint = "";
    if (!explicitId && !nestedId && !timestamp && !message) {
      try { fingerprint = JSON.stringify(nested || data).slice(0, 600); } catch { fingerprint = String(nested || data); }
    }
    return `${type}|${explicitId || ""}|${nestedId || ""}|${timestamp}|${message}|${fingerprint}`;
  }

  function rememberEvent(event) {
    const signature = eventSignature(event);
    if (state.eventSignatures.has(signature)) return false;
    state.eventSignatures.set(signature, Date.now());
    if (state.eventSignatures.size > 400) {
      const oldest = [...state.eventSignatures.entries()].sort((a, b) => a[1] - b[1]).slice(0, 100);
      oldest.forEach(([key]) => state.eventSignatures.delete(key));
    }
    return true;
  }

  function extractEventTaskId(event) {
    const data = event?.data || event?.payload || {};
    return String(firstDefined(event?.taskId, event?.task_id, data?.taskId, data?.task_id, data?.task?.id, event?.task?.id, ""));
  }

  function eventData(event) {
    const data = firstDefined(event?.data, event?.payload, event?.detail, event);
    return data && typeof data === "object" ? data : { message: String(data ?? "") };
  }

  function eventMessage(data) {
    const value = firstDefined(data.message, data.text, data.content, data.output, data.delta, data.detail, data.error?.message, data.error);
    if (typeof value === "string") return localizeEventMessage(value);
    if (value && typeof value === "object") return localizeEventMessage(firstDefined(value.text, value.content, value.message, JSON.stringify(value)));
    return "";
  }

  function taskFromEvent(event, data) {
    return normalizeTask(firstDefined(data.task, event.task, data.result?.task, null));
  }

  function inferSdkEventDescription(data) {
    const item = data.item || data.event?.item || data;
    const itemType = String(firstDefined(item.type, data.event?.type, data.type, "")).replaceAll("_", " ");
    const command = firstDefined(item.command, item.tool, item.name);
    const text = firstDefined(item.text, item.message, item.content);
    if (command) return `${itemType || "工具调用"} · ${command}`;
    if (typeof text === "string") return text.length > 140 ? `${text.slice(0, 140)}…` : text;
    return itemType || "Codex 事件";
  }

  function handleRealtimeEvent(rawEvent, source = "stream") {
    if (Array.isArray(rawEvent)) {
      rawEvent.forEach((entry) => handleRealtimeEvent(entry, source));
      return;
    }
    if (!rawEvent || typeof rawEvent !== "object") return;
    if (!rememberEvent(rawEvent)) return;

    const type = String(firstDefined(
      typeof rawEvent.type === "string" ? rawEvent.type : undefined,
      typeof rawEvent.event === "string" ? rawEvent.event : undefined,
      rawEvent.kind,
      "message",
    )).toLowerCase();
    if (["welcome", "connected", "ping", "pong", "subscribed"].includes(type)) return;
    const data = eventData(rawEvent);
    const taskId = extractEventTaskId(rawEvent);
    const activeTaskId = state.currentTask?.id;

    const eventTask = taskFromEvent(rawEvent, data);
    if (eventTask?.id) upsertTask(eventTask);
    if (taskId && activeTaskId && taskId !== activeTaskId) return;
    if (!activeTaskId && taskId) return;

    const nestedEvent = data.event && typeof data.event === "object" ? data.event : null;
    if (nestedEvent && nestedEvent !== rawEvent) {
      handleRealtimeEvent({
        ...nestedEvent,
        taskId: taskId || activeTaskId,
        id: firstDefined(nestedEvent.id, rawEvent.id ? `${rawEvent.id}:${nestedEvent.type || "nested"}` : undefined),
      }, source);
    }

    const flatStatus = firstDefined(data.status, rawEvent.status, eventTask?.status);
    if (flatStatus) setStatus(flatStatus, eventTask || {});
    if (type === "status" && flatStatus) {
      addStep({
        id: rawEvent.id,
        title: statusLabel(flatStatus),
        description: eventMessage(data),
        status: flatStatus,
        timestamp: firstDefined(rawEvent.timestamp, data.timestamp, new Date().toISOString()),
      });
    }

    if (type.includes("created") || type.includes("queued")) {
      setStatus("queued");
    }
    const isLifecycleStart = type === "started"
      || type === "running"
      || type === "task.started"
      || type === "thread.started"
      || type === "turn.started"
      || type.endsWith(".task.started");
    if (isLifecycleStart) {
      setStatus("running", { startedAt: firstDefined(data.startedAt, data.timestamp, rawEvent.timestamp, state.startedAt) });
      addStep({
        id: firstDefined(data.id, rawEvent.id, "codex-started"),
        title: "Codex 开始执行",
        description: "正在分析任务与项目上下文",
        status: "running",
        timestamp: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()),
      });
    }

    if (type.includes("log") || type.includes("stdout") || type.includes("stderr") || type === "message") {
      const message = eventMessage(data);
      if (message) appendLog({ message, level: firstDefined(data.level, type), timestamp: firstDefined(data.timestamp, rawEvent.timestamp) }, { key: eventSignature(rawEvent) });
    }

    if (type.includes("step") || type.includes("plan")) {
      const step = data.step || data;
      addStep({
        ...step,
        id: firstDefined(step.id, rawEvent.id, `${type}-${Date.now()}`),
        title: firstDefined(step.title, step.name, step.message, type.includes("plan") ? "更新执行计划" : "执行步骤"),
        description: firstDefined(step.description, step.detail, step.text, ""),
        status: firstDefined(step.status, data.status, type.includes("completed") ? "completed" : "running"),
        timestamp: firstDefined(step.timestamp, rawEvent.timestamp, new Date().toISOString()),
      });
    }

    if (type.includes("item.") || type.includes("tool") || type.includes("command")) {
      const isComplete = type.includes("completed") || type.includes("finished");
      const description = inferSdkEventDescription(data);
      addStep({
        id: firstDefined(data.item?.id, data.id, rawEvent.id, `${type}-${Date.now()}`),
        title: isComplete ? "完成工具调用" : "执行工具调用",
        description,
        status: isComplete ? "completed" : "running",
        timestamp: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()),
      });
      appendLog({ message: description, level: "command", timestamp: firstDefined(data.timestamp, rawEvent.timestamp) }, { key: `${eventSignature(rawEvent)}-sdk` });
      const item = data.item || data.event?.item;
      if (isComplete && item?.type === "agent_message" && typeof item.text === "string") setResult(item.text);
    }

    const fileCount = firstDefined(data.filesChanged, data.files_changed, data.changedFiles?.length, eventTask?.filesChanged);
    if (fileCount !== undefined) elements.filesMetric.textContent = String(Array.isArray(fileCount) ? fileCount.length : Number(fileCount) || 0);

    const isResultDelta = type.includes("result.delta") || type.includes("output.delta") || type.includes("text.delta");
    if (isResultDelta) {
      const delta = eventMessage(data);
      if (delta) setResult(delta, true);
    } else if (type.includes("result") || type.includes("output")) {
      const content = firstDefined(data.markdown, data.result?.markdown, data.result?.content, data.result?.text, data.result, data.output, data.content, data.text);
      if (typeof content === "string" && content) setResult(content);
    }

    const doneStatus = normalizeStatus(firstDefined(data.status, eventTask?.status, ""));
    const isTaskCompletion = type === "completed"
      || type === "succeeded"
      || type === "success"
      || (type === "done" && ["completed", "succeeded", "success"].includes(doneStatus))
      || type === "task.completed"
      || type === "task.succeeded"
      || type === "turn.completed"
      || type.endsWith(".task.completed");
    if (isTaskCompletion) {
      const content = firstDefined(eventTask?.result, data.markdown, data.result?.markdown, data.result?.content, data.result?.text, typeof data.result === "string" ? data.result : undefined, data.output, data.finalResult, data.final_result);
      if (typeof content === "string" && content) setResult(content);
      setStatus(eventTask?.status || "completed", { ...eventTask, endedAt: firstDefined(data.endedAt, data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
      addStep({ id: firstDefined(rawEvent.id, "task-completed"), title: "任务完成", description: "最终结果已生成", status: "completed", timestamp: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
      appendLog({ message: "任务已完成", level: "success", timestamp: firstDefined(data.timestamp, rawEvent.timestamp) }, { key: `${eventSignature(rawEvent)}-done` });
      showToast("任务已完成，最终结果已生成。", "success");
      void refreshCurrentTask();
      void loadUsageDashboard({ quiet: true });
    }

    const isTaskCancellation = type === "cancelled"
      || type === "canceled"
      || (type === "done" && ["cancelled", "canceled"].includes(doneStatus))
      || type === "task.cancelled"
      || type === "task.canceled"
      || type.endsWith(".task.cancelled");
    if (isTaskCancellation) {
      setStatus("cancelled", { endedAt: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
      addStep({ id: firstDefined(rawEvent.id, "task-cancelled"), title: "任务已取消", description: "执行已由用户停止", status: "error", timestamp: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
      void loadUsageDashboard({ quiet: true });
    }

    const isTaskFailure = type === "failed"
      || type === "error"
      || type === "task.failed"
      || type === "turn.failed"
      || type === "task.error"
      || type.endsWith(".task.failed");
    if (isTaskFailure) {
      const message = eventMessage(data) || "任务执行失败";
      setStatus("failed", { error: message, endedAt: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
      addStep({ id: firstDefined(rawEvent.id, "task-failed"), title: "执行失败", description: message, status: "error", timestamp: firstDefined(data.timestamp, rawEvent.timestamp, new Date().toISOString()) });
      appendLog({ message, level: "error", timestamp: firstDefined(data.timestamp, rawEvent.timestamp) }, { key: `${eventSignature(rawEvent)}-error` });
      showToast(message, "error", 6_000);
      void refreshCurrentTask();
      void loadUsageDashboard({ quiet: true });
    }

    if (state.currentTask) upsertTask(state.currentTask);
  }

  async function refreshCurrentTask() {
    const taskId = state.currentTask?.id;
    if (!taskId) return;
    try {
      const payload = await apiFetch(`/tasks/${encodeURIComponent(taskId)}`, { silent: true });
      const task = extractTask(payload);
      if (task) populateTaskView(task);
    } catch {
      void loadHistory({ quiet: true });
    }
  }

  function parseEventPayload(value) {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return { type: "log", data: { message: trimmed } };
    }
  }

  function socketUrl() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}/ws`;
  }

  function connectWebSocket() {
    if (!("WebSocket" in window) || state.socket?.readyState === WebSocket.OPEN || state.socket?.readyState === WebSocket.CONNECTING) return;
    if (state.socketRetry) clearTimeout(state.socketRetry);
    try {
      const socket = new WebSocket(socketUrl());
      state.socket = socket;
      socket.addEventListener("open", () => {
        if (state.socket !== socket) return;
        state.socketConnected = true;
        state.socketRetries = 0;
        setConnection("online", "事件流已连接");
        if (state.currentTask?.id && isTaskActive()) {
          sendSocketSubscription(state.currentTask.id);
          closeEventSource();
        }
      });
      socket.addEventListener("message", (event) => {
        const payload = parseEventPayload(event.data);
        if (payload) handleRealtimeEvent(payload, "websocket");
      });
      socket.addEventListener("error", () => {
        if (state.socket !== socket) return;
        state.socketConnected = false;
      });
      socket.addEventListener("close", () => {
        if (state.socket !== socket) return;
        state.socketConnected = false;
        state.socket = null;
        if (state.currentTask?.id && isTaskActive()) openEventSource(state.currentTask.id);
        scheduleSocketReconnect();
      });
    } catch {
      state.socketConnected = false;
      scheduleSocketReconnect();
    }
  }

  function scheduleSocketReconnect() {
    if (state.socketRetry || document.hidden) return;
    state.socketRetries += 1;
    const delay = Math.min(30_000, 1_200 * (2 ** Math.min(state.socketRetries, 4)));
    state.socketRetry = window.setTimeout(() => {
      state.socketRetry = null;
      connectWebSocket();
    }, delay);
  }

  function sendSocketSubscription(taskId) {
    if (state.socket?.readyState !== WebSocket.OPEN || !taskId) return false;
    try {
      state.socket.send(JSON.stringify({ type: "subscribe", taskId }));
      state.subscribedTaskId = taskId;
      return true;
    } catch {
      return false;
    }
  }

  function closeEventSource() {
    if (state.eventSource) state.eventSource.close();
    state.eventSource = null;
  }

  function openEventSource(taskId) {
    if (!("EventSource" in window) || !taskId || state.eventSource) return;
    const stream = new EventSource(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/events`);
    state.eventSource = stream;
    const receive = (event) => {
      const payload = parseEventPayload(event.data);
      if (!payload) return;
      if (event.type && event.type !== "message" && payload.type == null) payload.type = event.type;
      handleRealtimeEvent(payload, "sse");
    };
    stream.onopen = () => setConnection("online", "事件流已连接");
    stream.onmessage = receive;
    ["status", "step", "log", "result", "done", "error", "task.created", "task.started", "task.completed", "task.failed", "task.cancelled", "task.event", "task.sdk", "task.log", "task.status", "task.result"].forEach((eventName) => {
      stream.addEventListener(eventName, receive);
    });
    stream.onerror = () => {
      if (FINISHED_STATUSES.has(normalizeStatus(state.currentTask?.status))) {
        closeEventSource();
        return;
      }
      if (stream.readyState === EventSource.CLOSED && !state.socketConnected) {
        setConnection("offline", "事件流重连中");
      }
    };
  }

  function subscribeToTask(taskId) {
    if (!taskId) return;
    state.subscribedTaskId = taskId;
    state.eventSignatures.clear();
    if (state.streamFallbackTimer) clearTimeout(state.streamFallbackTimer);
    if (sendSocketSubscription(taskId)) return;
    connectWebSocket();
    state.streamFallbackTimer = window.setTimeout(() => {
      state.streamFallbackTimer = null;
      if (!state.socketConnected && state.currentTask?.id === taskId && isTaskActive()) openEventSource(taskId);
    }, 650);
  }

  function closeTaskStreams() {
    if (state.streamFallbackTimer) clearTimeout(state.streamFallbackTimer);
    state.streamFallbackTimer = null;
    closeEventSource();
    state.subscribedTaskId = null;
  }

  async function checkHealth({ quiet = true } = {}) {
    try {
      const payload = await apiFetch("/health", { root: true, timeout: 5_000, silent: quiet });
      const health = unwrapPayload(payload) || {};
      const status = String(firstDefined(health.status, health.state, health.ok === false ? "offline" : "ok")).toLowerCase();
      if (["ok", "healthy", "ready", "online", "true"].includes(status) || health.ok === true) {
        setConnection("online", state.socketConnected || state.eventSource ? "事件流已连接" : "本地服务在线");
      } else {
        setConnection("offline", "服务未就绪");
      }
    } catch (error) {
      setConnection("offline", "本地服务离线");
      if (!quiet) showToast(error.message || "本地服务不可用。", "error");
    }
  }

  async function loadModels() {
    try {
      const payload = await apiFetch("/models", { silent: true, timeout: 7_000 });
      const modelPayload = unwrapPayload(payload) || {};
      const fileLimits = modelPayload.fileLimits || modelPayload.file_limits;
      if (fileLimits && typeof fileLimits === "object") {
        const values = {
          maxFiles: Number(fileLimits.maxFiles ?? fileLimits.max_files),
          maxImages: Number(fileLimits.maxImages ?? fileLimits.max_images),
          maxBytesPerFile: Number(fileLimits.maxBytesPerFile ?? fileLimits.max_bytes_per_file),
          maxTotalBytes: Number(fileLimits.maxTotalBytes ?? fileLimits.max_total_bytes),
        };
        state.fileLimits = {
          maxFiles: Number.isInteger(values.maxFiles) && values.maxFiles > 0 ? values.maxFiles : DEFAULT_FILE_LIMITS.maxFiles,
          maxImages: Number.isInteger(values.maxImages) && values.maxImages > 0 ? values.maxImages : DEFAULT_FILE_LIMITS.maxImages,
          maxBytesPerFile: Number.isInteger(values.maxBytesPerFile) && values.maxBytesPerFile > 0
            ? values.maxBytesPerFile
            : DEFAULT_FILE_LIMITS.maxBytesPerFile,
          maxTotalBytes: Number.isInteger(values.maxTotalBytes) && values.maxTotalBytes > 0
            ? values.maxTotalBytes
            : DEFAULT_FILE_LIMITS.maxTotalBytes,
        };
        syncImageControls();
      }
      const models = extractList(payload, ["models", "availableModels", "available_models"]);
      const discovered = [];
      models.forEach((model) => {
        if (typeof model === "string") {
          const value = model.trim();
          if (value) discovered.push({ id: value, label: value });
          return;
        }
        if (!model || typeof model !== "object") return;
        const label = String(firstDefined(model.label, model.displayName, model.display_name, model.name, ""));
        const id = String(firstDefined(model.id, model.value, model.model, label));
        if (label.trim() && id.trim()) discovered.push({ id: id.trim(), label: label.trim() });
      });
      if (discovered.length) {
        state.modelCatalog = discovered.filter((model, index, list) => (
          list.findIndex((candidate) => candidate.id === model.id) === index
        ));
        state.modelIds.clear();
        state.modelCatalog.forEach((model) => state.modelIds.set(model.label, model.id));
        if (!state.modelCatalog.some((model) => model.label === state.config.model)) {
          state.config.model = state.modelCatalog[0].label;
          storeConfig();
        }
        updateConfigLabels();
        populateApiKeyModelOptions();
      }
    } catch {
      // The exact UI model catalog remains available even when discovery is offline.
    }
  }

  async function loadProjects() {
    try {
      const payload = await apiFetch("/projects", { silent: true, timeout: 7_000 });
      state.projects = extractList(payload, ["projects", "recentProjects", "recent_projects"])
        .map(normalizeProject)
        .filter(Boolean);
      if (!state.projectless && !state.projectPathDraft && state.projects[0]) selectProject(state.projects[0], "desktop");
    } catch {
      // A manually entered project path is always accepted by the form.
    }
  }

  function updateCharCount() {
    const count = elements.taskPrompt.value.length;
    elements.charCount.textContent = `${count.toLocaleString(activeLocale())} / 20,000`;
    elements.charCount.classList.toggle("warning", count > 18_000);
  }

  function newTask() {
    if (isTaskActive()) {
      showToast("当前任务仍在运行；请先取消或等待任务完成。", "warning");
      return;
    }
    resetTaskView();
    clearSelectedImages();
    elements.taskPrompt.value = "";
    updateCharCount();
    closeSidebar();
    showApiTestBench({ focus: true });
  }

  function showApiTestBench({ focus = false } = {}) {
    elements.apiTestBench.hidden = false;
    document.body.classList.add("api-test-bench-visible");
    closeSidebar();
    elements.apiTestBench.scrollIntoView({ behavior: "smooth", block: "start" });
    if (focus) requestAnimationFrame(() => elements.taskPrompt.focus());
  }

  function hideApiTestBench() {
    if (isTaskActive()) {
      showToast("当前任务仍在运行；请先取消或等待任务完成。", "warning");
      return;
    }
    elements.apiTestBench.hidden = true;
    document.body.classList.remove("api-test-bench-visible");
    elements.gatewayDashboard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openSidebar() {
    document.body.classList.add("sidebar-visible");
    elements.sidebarOpen.setAttribute("aria-expanded", "true");
    if (window.innerWidth <= 960) requestAnimationFrame(() => elements.platformAccountButton?.focus());
  }

  function closeSidebar() {
    document.body.classList.remove("sidebar-visible");
    elements.sidebarOpen.setAttribute("aria-expanded", "false");
  }

  async function copyResult() {
    if (!state.result) return;
    try {
      await navigator.clipboard.writeText(state.result);
      showToast("结果已复制到剪贴板。", "success");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = state.result;
      textarea.className = "clipboard-fallback";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      showToast(copied ? "结果已复制到剪贴板。" : "复制失败，请手动选择结果。", copied ? "success" : "error");
    }
  }

  async function copyPlainText(value, successMessage) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showToast(successMessage, "success");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.className = "clipboard-fallback";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      showToast(copied ? successMessage : "复制失败，请手动复制。", copied ? "success" : "error");
    }
  }

  function effortDisplay(value) {
    const labels = { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Xhigh" };
    return labels[String(value || "").toLowerCase()] || capitalize(value);
  }

  function permissionDisplay(value) {
    return value === "read-only" ? "只读" : value === "workspace-write" ? "仅项目" : String(value || "");
  }

  function formatKeyDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(activeLocale(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  function populateApiKeyModelOptions(preferredId) {
    if (!elements.apiKeyModel) return;
    const previous = preferredId || elements.apiKeyModel.value || resolveModelId(state.config.model);
    elements.apiKeyModel.replaceChildren();
    state.modelCatalog.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.label;
      elements.apiKeyModel.append(option);
    });
    const available = [...elements.apiKeyModel.options].some((option) => option.value === previous);
    elements.apiKeyModel.value = available ? previous : (elements.apiKeyModel.options[0]?.value || "");
  }

  function updateApiExample() {
    const endpoint = `${location.origin}${API_BASE}/external/tasks`;
    elements.externalTaskEndpoint.textContent = endpoint;
    elements.apiExampleCode.textContent = [
      '$headers = @{ Authorization = "Bearer $env:CODEX_GATEWAY_KEY" }',
      '$body = @{',
      '  prompt = "检查并修复这个项目"',
      '  projectless = $true',
      '  # 可选附件：先 POST /external/uploads/files，再把返回的 file.id 放入 fileIds',
      '  # fileIds = @($upload.file.id)',
      '} | ConvertTo-Json',
      '',
      '$task = Invoke-RestMethod `',
      '  -Method Post `',
      `  -Uri "${endpoint}" \``,
      '  -Headers $headers `',
      '  -ContentType "application/json" `',
      '  -Body $body',
      '',
      '$task | ConvertTo-Json -Depth 6',
    ].join("\n");
  }

  function syncApiKeyFormToCurrentConfig() {
    populateApiKeyModelOptions(resolveModelId(state.config.model));
    elements.apiKeyEffort.value = state.config.effort;
    elements.apiKeySpeed.value = state.config.speed;
    const permission = readPermission();
    elements.apiKeyPermission.value = permission === "read-only" ? "read-only" : "workspace-write";
    updateApiExample();
  }

  function clearRevealedApiKey() {
    state.revealedApiKey = "";
    elements.apiKeySecret.value = "";
    elements.apiKeyReveal.hidden = true;
  }

  function renderGatewayHostStatus() {
    const enabled = state.gatewayEnabled;
    const activeKeyCount = state.apiKeys.filter((key) => key.active !== false && !key.revokedAt).length;
    elements.gatewayHostStatus.classList.toggle("online", enabled);
    elements.gatewayHostStatus.classList.toggle("offline", !enabled);
    elements.gatewayHostStatusText.textContent = state.gatewayStatusLoaded
      ? (enabled ? "Host 已开启" : "Host 已关闭")
      : "正在读取 Host";
    elements.gatewayHostToggle.disabled = !state.gatewayStatusLoaded;
    elements.gatewayHostToggle.setAttribute("aria-pressed", String(enabled));
    elements.gatewayHostToggle.classList.toggle("enable-host", !enabled);
    if (elements.gatewayHostToggle.dataset.confirm !== "true") {
      elements.gatewayHostToggle.textContent = enabled ? "关闭 Host" : "开启 Host";
    }
    elements.apiGatewayPanel.classList.toggle("gateway-offline", state.gatewayStatusLoaded && !enabled);
    elements.gatewayDashboard.classList.toggle("gateway-offline", state.gatewayStatusLoaded && !enabled);
    elements.externalTaskEndpoint.closest(".gateway-endpoints")
      ?.setAttribute("aria-disabled", String(state.gatewayStatusLoaded && !enabled));
    if (elements.apiAddress) {
      elements.apiAddress.textContent = state.gatewayStatusLoaded && !enabled
        ? `${location.host || "127.0.0.1"} · Host 已关闭`
        : `${location.host || "127.0.0.1"} · ${activeKeyCount} Keys`;
    }
    renderGatewayMonitor();
  }

  function disarmGatewayHostToggle() {
    if (state.gatewayConfirmTimer) clearTimeout(state.gatewayConfirmTimer);
    state.gatewayConfirmTimer = null;
    elements.gatewayHostToggle.dataset.confirm = "false";
    elements.gatewayHostToggle.classList.remove("armed");
    elements.gatewayHostToggle.textContent = state.gatewayEnabled ? "关闭 Host" : "开启 Host";
  }

  async function loadGatewayHost({ quiet = false } = {}) {
    try {
      const payload = await apiFetch("/gateway", { silent: quiet, timeout: 8_000 });
      state.gatewayEnabled = payload?.enabled !== false;
      state.gatewaySnapshot = {
        activeTasks: usageNumber(payload?.activeTasks, payload?.active_tasks),
        activeConnections: usageNumber(payload?.activeConnections, payload?.active_connections),
      };
      state.gatewayStatusLoaded = true;
      renderGatewayHostStatus();
    } catch (error) {
      state.gatewayStatusLoaded = false;
      elements.gatewayHostStatus.classList.remove("online");
      elements.gatewayHostStatus.classList.add("offline");
      elements.gatewayHostStatusText.textContent = "Host 状态不可用";
      elements.gatewayHostToggle.disabled = true;
      if (!quiet) showToast(error.message || "无法读取 Host 状态。", "error");
    }
  }

  async function refreshGatewayMonitorData({ quiet = true, includeUsage = true, includeKeys = false } = {}) {
    if (state.gatewayMonitorPending) return;
    state.gatewayMonitorPending = true;
    elements.refreshGatewayMonitor.disabled = true;
    try {
      const requests = [
        loadHistory({ quiet }),
        loadGatewayHost({ quiet }),
      ];
      if (includeUsage) requests.push(loadUsageDashboard({ quiet }));
      if (includeKeys) requests.push(loadApiKeys({ quiet }));
      await Promise.allSettled(requests);
      renderGatewayMonitor();
    } finally {
      state.gatewayMonitorPending = false;
      elements.refreshGatewayMonitor.disabled = false;
    }
  }

  async function toggleGatewayHost() {
    if (!state.gatewayStatusLoaded || elements.gatewayHostToggle.disabled) return;
    const nextEnabled = !state.gatewayEnabled;
    if (!nextEnabled && elements.gatewayHostToggle.dataset.confirm !== "true") {
      elements.gatewayHostToggle.dataset.confirm = "true";
      elements.gatewayHostToggle.classList.add("armed");
      elements.gatewayHostToggle.textContent = "再次点击关闭";
      showToast("再次点击关闭 Host；正在运行的外部 API 任务会被取消。", "warning", 5_000);
      state.gatewayConfirmTimer = window.setTimeout(disarmGatewayHostToggle, 5_000);
      return;
    }
    disarmGatewayHostToggle();
    elements.gatewayHostToggle.disabled = true;
    try {
      const payload = await apiFetch("/gateway", {
        method: "POST",
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      state.gatewayEnabled = payload?.enabled !== false;
      state.gatewaySnapshot = {
        activeTasks: usageNumber(payload?.activeTasks, payload?.active_tasks),
        activeConnections: usageNumber(payload?.activeConnections, payload?.active_connections),
      };
      state.gatewayStatusLoaded = true;
      renderGatewayHostStatus();
      if (state.gatewayEnabled) {
        showToast("Host 已开启，现有 API Key 可以继续调用。", "success");
      } else {
        const cancelled = Number(payload?.cancelledTasks) || 0;
        const closed = Number(payload?.closedConnections) || 0;
        showToast(`Host 已关闭；取消 ${cancelled} 个外部任务，断开 ${closed} 个连接。`, "success", 6_000);
      }
    } catch (error) {
      renderGatewayHostStatus();
      showToast(error.message || "Host 状态修改失败。", "error", 6_000);
    }
  }

  function renderApiKeys() {
    elements.apiKeyList.replaceChildren();
    elements.apiKeyCount.textContent = state.apiKeys.length
      ? `${state.apiKeys.length} 个密钥`
      : "尚未创建访问密钥";
    elements.openApiKeyAdvancedSettings.disabled = state.apiKeys.length === 0;
    renderGatewayHostStatus();

    if (!state.apiKeys.length) {
      const empty = document.createElement("div");
      empty.className = "api-key-empty";
      empty.textContent = "创建第一枚与模型配置绑定的 Gateway API Key";
      elements.apiKeyList.append(empty);
      if (elements.apiKeyAdvancedDialog.open) renderApiKeyAdvancedSettings();
      return;
    }

    state.apiKeys.forEach((key) => {
      const row = document.createElement("div");
      row.className = "api-key-row";

      const identity = document.createElement("div");
      identity.className = "key-identity";
      const name = document.createElement("strong");
      name.textContent = key.name || "未命名密钥";
      const masked = document.createElement("code");
      masked.textContent = `${key.maskedKey || "ccc_live_••••"}${key.createdAt ? ` · ${formatKeyDate(key.createdAt)}` : ""}`;
      const keyUsage = state.usageSummary?.credentials?.get(key.id) || normalizedUsageAggregate();
      const usage = document.createElement("span");
      usage.className = "key-usage";
      usage.textContent = keyUsage.tasks
        ? `${keyUsage.tasks} 次累计调用 · ${formatTokenCount(keyUsage.total)} Token`
        : "重置后尚无调用";
      const policy = document.createElement("span");
      policy.className = "key-policy";
      const policyParts = [];
      if (Number.isFinite(Number(key.tokenLimit)) && Number(key.tokenLimit) > 0) {
        policyParts.push(`Token 限额 ${formatTokenCount(key.tokensUsed)} / ${formatTokenCount(key.tokenLimit)}`);
      }
      if (key.expiresAt) policyParts.push(`销毁于 ${formatKeyDateTime(key.expiresAt)}`);
      policy.textContent = policyParts.join(" · ");
      policy.hidden = policyParts.length === 0;
      identity.append(name, masked, usage, policy);

      const preset = document.createElement("div");
      preset.className = "key-preset";
      const values = [
        key.preset?.modelLabel || key.preset?.model,
        effortDisplay(key.preset?.effort),
        capitalize(key.preset?.speed),
        permissionDisplay(key.preset?.permission),
      ].filter(Boolean);
      values.forEach((value) => {
        const pill = document.createElement("span");
        pill.className = "preset-pill";
        pill.textContent = value;
        preset.append(pill);
      });

      const action = document.createElement("div");
      action.className = "key-action";
      const status = document.createElement("span");
      status.className = "key-status";
      if (key.limitReached) {
        status.classList.add("limit-reached");
        status.textContent = "已达 Token 上限";
      } else {
        status.textContent = "有效";
      }
      action.append(status);

      const settings = document.createElement("button");
      settings.type = "button";
      settings.className = "key-settings";
      settings.setAttribute("aria-label", "管理此 API Key");
      settings.setAttribute("title", "管理此 API Key");
      settings.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.3 2.8h3.4l.5 1.8c.5.2 1 .5 1.4.8l1.8-.5 1.7 2.9-1.3 1.3c.1.6.1 1.1 0 1.7l1.3 1.3-1.7 2.9-1.8-.5c-.4.4-.9.6-1.4.8l-.5 1.8H8.3l-.5-1.8c-.5-.2-1-.5-1.4-.8l-1.8.5-1.7-2.9 1.3-1.3a7 7 0 0 1 0-1.7L2.9 7.8l1.7-2.9 1.8.5c.4-.4.9-.6 1.4-.8l.5-1.8Z"/><circle cx="10" cy="10" r="2.2"/></svg>';
      settings.addEventListener("click", () => void openApiKeyAdvancedSettings(key.id));
      action.append(settings);

      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.className = "key-reveal";
      reveal.setAttribute("aria-label", "查看完整密钥");
      reveal.setAttribute("title", key.revealable ? "查看完整密钥" : "旧密钥无法查看，请删除后重新生成");
      reveal.disabled = !key.revealable;
      reveal.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.2 10s2.8-4.6 7.8-4.6 7.8 4.6 7.8 4.6-2.8 4.6-7.8 4.6S2.2 10 2.2 10Z"/><circle cx="10" cy="10" r="2.3"/></svg>';
      action.append(reveal);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "key-delete";
      remove.textContent = "删除";
      remove.addEventListener("click", () => void deleteApiKey(key.id, remove));
      action.append(remove);

      const secretPanel = document.createElement("div");
      secretPanel.className = "key-secret-inline";
      secretPanel.hidden = true;
      const secretInput = document.createElement("input");
      secretInput.type = "password";
      secretInput.readOnly = true;
      secretInput.setAttribute("aria-label", "完整 API Key");
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "key-copy";
      copy.textContent = "复制";
      copy.addEventListener("click", () => {
        void copyPlainText(secretInput.value, "API Key 已复制到剪贴板。");
      });
      secretPanel.append(secretInput, copy);

      reveal.addEventListener("click", () => void toggleApiKeySecret(key.id, reveal, secretPanel, secretInput));
      row.append(identity, preset, action, secretPanel);
      elements.apiKeyList.append(row);
    });
    if (elements.apiKeyAdvancedDialog.open) renderApiKeyAdvancedSettings();
  }

  function requireLocalTermsAcceptance() {
    if (getStoredValue(LOCAL_TERMS_STORAGE_KEY) === LOCAL_TERMS_VERSION) return Promise.resolve();
    const dialog = elements.localTermsDialog;
    const consent = elements.localTermsConsent;
    const accept = elements.acceptLocalTerms;
    if (!dialog || !consent || !accept) return Promise.reject(new Error("Local terms confirmation is unavailable."));

    consent.checked = false;
    accept.disabled = true;
    consent.onchange = () => { accept.disabled = !consent.checked; };

    return new Promise((resolve) => {
      const preventCancel = (event) => event.preventDefault();
      dialog.addEventListener("cancel", preventCancel);
      accept.onclick = () => {
        if (!consent.checked) return;
        setStoredValue(LOCAL_TERMS_STORAGE_KEY, LOCAL_TERMS_VERSION);
        dialog.removeEventListener("cancel", preventCancel);
        dialog.close();
        resolve();
      };
      dialog.showModal();
      consent.focus();
    });
  }

  function formatKeyDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(activeLocale(), {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function dateTimeLocalValue(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function selectedAdvancedApiKey() {
    return state.apiKeys.find((key) => key.id === state.advancedApiKeyId) || null;
  }

  function renderApiKeyAdvancedSettings(preferredId = null) {
    const previousId = preferredId || state.advancedApiKeyId || elements.apiKeyAdvancedSelect.value;
    const selected = state.apiKeys.find((key) => key.id === previousId) || state.apiKeys[0] || null;
    state.advancedApiKeyId = selected?.id || null;

    elements.apiKeyAdvancedSelect.replaceChildren();
    state.apiKeys.forEach((key) => {
      const option = document.createElement("option");
      option.value = key.id;
      option.textContent = `${key.name || "未命名密钥"} · ${key.maskedKey || "ccc_live_••••"}`;
      option.selected = key.id === state.advancedApiKeyId;
      elements.apiKeyAdvancedSelect.append(option);
    });

    const disabled = !selected;
    elements.apiKeyAdvancedSelect.disabled = disabled;
    elements.apiKeyTokenLimit.disabled = disabled;
    elements.apiKeyDisableAfter.disabled = disabled;
    elements.apiKeyCustomExpiration.disabled = disabled;
    elements.saveApiKeyAdvancedSettings.disabled = disabled;
    if (!selected) {
      elements.apiKeyTokenLimit.value = "";
      elements.apiKeyDisableAfter.value = "never";
      elements.apiKeyCustomExpirationRow.hidden = true;
      elements.apiKeyCustomExpiration.value = "";
      elements.apiKeyTokenLimitStatus.textContent = "尚未创建可管理的 API Key。";
      elements.apiKeyExpirationStatus.textContent = "当前设置：永不销毁";
      localizeSubtree(elements.apiKeyAdvancedDialog);
      return;
    }

    elements.apiKeyTokenLimit.value = Number.isFinite(Number(selected.tokenLimit)) && Number(selected.tokenLimit) > 0
      ? String(Math.round(Number(selected.tokenLimit)))
      : "";
    const tokensUsed = formatTokenCount(selected.tokensUsed);
    if (Number.isFinite(Number(selected.tokenLimit)) && Number(selected.tokenLimit) > 0) {
      elements.apiKeyTokenLimitStatus.textContent = `当前用量：${tokensUsed} / ${formatTokenCount(selected.tokenLimit)} Token`;
    } else {
      elements.apiKeyTokenLimitStatus.textContent = `当前用量：${tokensUsed} Token · 未设置上限`;
    }
    elements.apiKeyTokenLimitStatus.classList.toggle("limit-reached", Boolean(selected.limitReached));

    if (selected.expiresAt) {
      elements.apiKeyDisableAfter.value = "custom";
      elements.apiKeyCustomExpirationRow.hidden = false;
      elements.apiKeyCustomExpiration.value = dateTimeLocalValue(selected.expiresAt);
      elements.apiKeyExpirationStatus.textContent = `当前设置：销毁于 ${formatKeyDateTime(selected.expiresAt)}`;
    } else {
      elements.apiKeyDisableAfter.value = "never";
      elements.apiKeyCustomExpirationRow.hidden = true;
      elements.apiKeyCustomExpiration.value = "";
      elements.apiKeyExpirationStatus.textContent = "当前设置：永不销毁";
    }
    localizeSubtree(elements.apiKeyAdvancedDialog);
  }

  function updateAdvancedExpirationDraft() {
    const custom = elements.apiKeyDisableAfter.value === "custom";
    elements.apiKeyCustomExpirationRow.hidden = !custom;
    if (custom && !elements.apiKeyCustomExpiration.value) {
      elements.apiKeyCustomExpiration.value = dateTimeLocalValue(Date.now() + 24 * 60 * 60 * 1_000);
    }
  }

  async function openApiKeyAdvancedSettings(keyId = null) {
    if (!state.apiKeys.length) await loadApiKeys({ quiet: true });
    if (!state.apiKeys.length) {
      showToast("尚未创建可管理的 API Key。", "warning");
      return;
    }
    renderApiKeyAdvancedSettings(keyId);
    elements.apiKeyAdvancedDialog.showModal();
  }

  function closeApiKeyAdvancedSettings() {
    if (elements.apiKeyAdvancedDialog.open) elements.apiKeyAdvancedDialog.close();
  }

  async function saveApiKeyAdvancedSettings(event) {
    event.preventDefault();
    const key = selectedAdvancedApiKey();
    if (!key || elements.saveApiKeyAdvancedSettings.disabled) return;

    const rawLimit = elements.apiKeyTokenLimit.value.trim();
    const tokenLimit = rawLimit === "" ? null : Number(rawLimit);
    if (tokenLimit !== null && (!Number.isSafeInteger(tokenLimit) || tokenLimit < 1 || tokenLimit > 1_000_000_000_000)) {
      showToast("请输入有效的 Token 上限。", "error");
      elements.apiKeyTokenLimit.focus();
      return;
    }

    let expiresAt = null;
    const disableAfter = elements.apiKeyDisableAfter.value;
    if (disableAfter === "custom") {
      const timestamp = new Date(elements.apiKeyCustomExpiration.value).getTime();
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
        showToast("请选择未来的销毁时间。", "error");
        elements.apiKeyCustomExpiration.focus();
        return;
      }
      expiresAt = new Date(timestamp).toISOString();
    } else if (disableAfter !== "never") {
      const seconds = Number(disableAfter);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        showToast("请选择未来的销毁时间。", "error");
        return;
      }
      expiresAt = new Date(Date.now() + seconds * 1_000).toISOString();
    }

    elements.saveApiKeyAdvancedSettings.disabled = true;
    try {
      await apiFetch(`/api-keys/${encodeURIComponent(key.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ tokenLimit, expiresAt }),
      });
      await loadApiKeys({ quiet: true });
      closeApiKeyAdvancedSettings();
      showToast("API Key 高级设置已保存。", "success");
    } catch (error) {
      showToast(error.message || "无法保存 API Key 高级设置。", "error", 6_000);
    } finally {
      elements.saveApiKeyAdvancedSettings.disabled = false;
    }
  }

  async function loadApiKeys({ quiet = false } = {}) {
    try {
      const payload = await apiFetch("/api-keys", { silent: quiet, timeout: 8_000 });
      state.apiKeys = extractList(payload, ["apiKeys", "api_keys", "keys"]);
      renderApiKeys();
    } catch (error) {
      elements.apiKeyCount.textContent = "读取失败";
      elements.apiKeyList.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "api-key-empty";
      empty.textContent = error.message || "无法读取 API Key。";
      elements.apiKeyList.append(empty);
      if (!quiet) showToast(error.message || "无法读取 API Key。", "error");
    }
  }

  async function createApiKey(event) {
    event.preventDefault();
    if (elements.generateApiKey.disabled) return;
    elements.generateApiKey.disabled = true;
    try {
      const payload = await apiFetch("/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: elements.apiKeyName.value.trim() || undefined,
          model: elements.apiKeyModel.value,
          effort: elements.apiKeyEffort.value.toLowerCase(),
          speed: elements.apiKeySpeed.value.toLowerCase(),
          permission: elements.apiKeyPermission.value,
        }),
      });
      if (!payload?.key) throw new Error("服务端未返回新密钥。");
      state.revealedApiKey = payload.key;
      elements.apiKeySecret.value = payload.key;
      elements.apiKeyReveal.hidden = false;
      elements.apiKeyName.value = "";
      await loadApiKeys({ quiet: true });
      elements.apiKeySecret.focus();
      elements.apiKeySecret.select();
      showToast("API Key 已生成并安全保存，可随时点击眼睛查看。", "success", 6_000);
    } catch (error) {
      showToast(error.message || "API Key 生成失败。", "error", 6_000);
    } finally {
      elements.generateApiKey.disabled = false;
    }
  }

  async function toggleApiKeySecret(id, button, panel, input) {
    if (!panel.hidden) {
      input.value = "";
      input.type = "password";
      panel.hidden = true;
      button.classList.remove("active");
      button.setAttribute("aria-label", "查看完整密钥");
      button.setAttribute("title", "查看完整密钥");
      return;
    }
    button.disabled = true;
    try {
      const payload = await apiFetch(`/api-keys/${encodeURIComponent(id)}/secret`, { timeout: 8_000 });
      if (!payload?.key) throw new Error("无法查看此密钥。");
      input.value = payload.key;
      input.type = "text";
      panel.hidden = false;
      button.classList.add("active");
      button.setAttribute("aria-label", "隐藏完整密钥");
      button.setAttribute("title", "隐藏完整密钥");
      input.focus();
      input.select();
    } catch (error) {
      showToast(error.message || "无法查看此密钥。", "error", 6_000);
    } finally {
      button.disabled = false;
    }
  }

  async function deleteApiKey(id, button) {
    if (button.dataset.confirm !== "true") {
      button.dataset.confirm = "true";
      button.classList.add("armed");
      button.textContent = "确认删除";
      window.setTimeout(() => {
        if (!button.isConnected) return;
        button.dataset.confirm = "false";
        button.classList.remove("armed");
        button.textContent = "删除";
      }, 4_000);
      return;
    }
    button.disabled = true;
    try {
      await apiFetch(`/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadApiKeys({ quiet: true });
      await loadUsageDashboard({ quiet: true });
      showToast("API Key 已永久删除。", "success");
    } catch (error) {
      button.disabled = false;
      showToast(error.message || "删除失败。", "error");
    }
  }

  function focusApiKeyPanel() {
    syncApiKeyFormToCurrentConfig();
    toggleModelPopover(false);
    closeSidebar();
    elements.apiGatewayPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    elements.apiGatewayPanel.classList.remove("attention");
    requestAnimationFrame(() => elements.apiGatewayPanel.classList.add("attention"));
    window.setTimeout(() => elements.apiGatewayPanel.classList.remove("attention"), 1_100);
    void loadApiKeys({ quiet: true });
  }

  function accountInitials(user) {
    const value = String(user?.displayName || user?.email || "?").trim();
    return (value[0] || "?").toUpperCase();
  }

  function platformOnlineVerified(account = state.platformAccount) {
    return account?.signedIn === true && account?.online === true && account?.verification?.ok === true;
  }

  function renderPlatformAccount() {
    if (!elements.platformAccountButton) return;
    const account = state.platformAccount || {};
    const signedIn = account.signedIn === true;
    const online = platformOnlineVerified(account);
    const user = account.user || {};
    const initials = accountInitials(user);

    elements.platformAccountButton.classList.toggle("signed-out", !signedIn);
    elements.platformAccountButton.classList.toggle("signed-in", signedIn);
    elements.platformAccountButton.classList.toggle("online", online);
    elements.platformAccountAvatar.textContent = initials;
    elements.platformAccountName.textContent = signedIn ? (user.displayName || user.email) : "未登录";
    elements.platformAccountEmail.textContent = signedIn
      ? (online ? "Online Host 已启用" : user.email)
      : "登录平台以启用 Online Host";

    elements.platformSignedOutView.hidden = signedIn;
    elements.platformSignedInView.hidden = !signedIn;
    elements.platformProfileAvatar.textContent = initials;
    elements.platformProfileName.textContent = user.displayName || user.email || "—";
    elements.platformProfileEmail.textContent = user.email || "—";
    elements.platformProfileStatus.classList.toggle("online", online);
    elements.platformProfileStatus.classList.toggle("offline", !online);
    elements.platformProfileStatus.querySelector("span:last-child").textContent = online
      ? "Online Host 已启用"
      : state.platformAccountPending ? "正在验证 Online Host…" : "已登录";
    elements.platformHostUrl.textContent = online ? account.host.openAiBaseUrl : "尚未启用";
    const hostFailure = account.verification?.ok === false
      ? account.verification
      : account.error ? { error: account.error } : null;
    elements.platformHostError.hidden = !hostFailure;
    elements.platformHostError.textContent = hostFailure ? onlineHostFailureMessage(hostFailure) : "";
    elements.platformProfileOnlineButton.textContent = online ? "关闭 Online Host" : "启用 Online Host";
    elements.platformProfileOnlineButton.disabled = state.platformAccountPending;
    elements.platformLogoutButton.disabled = state.platformAccountPending;
    elements.platformBrowserLoginButton.disabled = state.platformAccountPending;

    [elements.platformOnlineHostButton, elements.shareOnlineButton].forEach((button) => {
      if (!button) return;
      button.disabled = state.platformAccountPending;
      button.classList.toggle("online", online);
      button.setAttribute("aria-pressed", String(online));
    });
    if (elements.platformOnlineHostButton) elements.platformOnlineHostButton.textContent = "Online Host";
    if (elements.shareOnlineButton) elements.shareOnlineButton.textContent = online ? "Stop sharing" : "Share online";
    renderOpenAiHostEndpoint();
  }

  async function openPlatformAccountDialog() {
    if (!elements.platformAccountDialog.open) elements.platformAccountDialog.showModal();
    if (state.platformAccountPending) return;
    state.platformAccountPending = true;
    state.platformAccount = { ...(state.platformAccount || {}), online: false, verification: null };
    renderPlatformAccount();
    try {
      await refreshPlatformAccount({ quiet: false });
    } finally {
      state.platformAccountPending = false;
      renderPlatformAccount();
      requestAnimationFrame(() => {
        if (state.platformAccount?.signedIn) elements.platformProfileOnlineButton.focus();
        else elements.platformBrowserLoginButton.focus();
      });
    }
  }

  function closePlatformAccountDialog() {
    if (elements.platformAccountDialog.open) elements.platformAccountDialog.close();
  }

  async function refreshPlatformAccount({ quiet = false } = {}) {
    const desktop = window.codexDesktop;
    if (!desktop?.getPlatformAccount) {
      state.platformAccount = { signedIn: false, online: false, user: null, host: null };
      renderPlatformAccount();
      return state.platformAccount;
    }
    try {
      state.platformAccount = await desktop.getPlatformAccount();
      if (state.platformAccount?.error && !quiet) {
        showToast(onlineHostFailureMessage(state.platformAccount.verification), "error", 8_000);
      }
    } catch (error) {
      state.platformAccount = {
        ...(state.platformAccount || {}),
        error: { message: error?.message || "连接平台失败。请确认本地 Platform 正在运行。" },
      };
      if (!quiet) showToast("连接平台失败。请确认本地 Platform 正在运行。", "error", 7_000);
    }
    renderPlatformAccount();
    return state.platformAccount;
  }

  async function loginWithPlatformBrowser() {
    if (state.platformAccountPending) return;
    const desktop = window.codexDesktop;
    if (!desktop?.platformBrowserLogin) {
      elements.platformAuthError.textContent = "仅桌面应用支持平台登录。";
      elements.platformAuthError.hidden = false;
      return;
    }
    state.platformAccountPending = true;
    elements.platformAuthError.hidden = true;
    elements.platformBrowserLoginButton.querySelector("span").textContent = "正在等待浏览器授权…";
    renderPlatformAccount();
    try {
      state.platformAccount = await desktop.platformBrowserLogin();
      showToast("浏览器授权成功。", "success");
    } catch (error) {
      elements.platformAuthError.textContent = error?.message || "无法完成浏览器授权。";
      elements.platformAuthError.hidden = false;
    } finally {
      state.platformAccountPending = false;
      elements.platformBrowserLoginButton.querySelector("span").textContent = "前往 Platform 登录";
      renderPlatformAccount();
    }
  }

  async function setPlatformOnline(requested) {
    if (state.platformAccountPending) return;
    if (!state.platformAccount?.signedIn) {
      openPlatformAccountDialog();
      showToast("请先登录平台。", "warning", 5_000);
      return;
    }
    const desktop = window.codexDesktop;
    if (!desktop?.setPlatformHostEnabled) return;
    const enabled = typeof requested === "boolean" ? requested : !platformOnlineVerified();
    state.platformAccountPending = true;
    renderPlatformAccount();
    try {
      const nextAccount = await desktop.setPlatformHostEnabled(enabled);
      state.platformAccount = nextAccount;
      if (enabled && (nextAccount?.online !== true || nextAccount?.verification?.ok !== true)) {
        state.openAiHostMode = "local";
        state.onlineHostCheck = nextAccount?.verification || {
          ok: false,
          error: nextAccount?.error || { code: "ONLINE_HOST_CHECK_FAILED", message: "公网 Host 检查失败。" },
        };
        showToast(onlineHostFailureMessage(state.onlineHostCheck), "error", 8_000);
        return;
      }
      state.openAiHostMode = enabled ? "online" : "local";
      state.onlineHostCheck = enabled ? nextAccount.verification : null;
      showToast(enabled ? "Online Host 已通过平台启用。" : "Online Host 已关闭。", "success");
    } catch (error) {
      showToast(error?.message || "连接平台失败。请确认本地 Platform 正在运行。", "error", 8_000);
    } finally {
      state.platformAccountPending = false;
      renderPlatformAccount();
    }
  }

  async function logoutPlatformAccount() {
    if (state.platformAccountPending || !window.codexDesktop?.platformLogout) return;
    state.platformAccountPending = true;
    renderPlatformAccount();
    try {
      state.platformAccount = await window.codexDesktop.platformLogout();
      state.openAiHostMode = "local";
      closePlatformAccountDialog();
      showToast("已退出平台账号。", "success");
    } catch (error) {
      showToast(error?.message || "无法退出平台账号。", "error");
    } finally {
      state.platformAccountPending = false;
      renderPlatformAccount();
    }
  }

  function tailscaleFunnelMessage(status) {
    if (state.language === "zh") return status?.message || "正在检查 Tailscale 与 Funnel 状态…";
    if (!status) return "Checking Tailscale and Funnel status…";
    if (!status.installed) return "Tailscale was not detected. Install and sign in before enabling the public Host.";
    if (status.conflict) return "Port 443 is already used by another local Funnel service. This app will not overwrite it.";
    if (status.active) return "The public Host is online. Other devices can use the base_url below.";
    if (status.connected) return "Tailscale is connected and ready to enable the free public Host.";
    if (/needslogin/i.test(status.backendState || "")) return "Tailscale is installed but not signed in. Continue to connect and sign in.";
    return "Tailscale is installed but not connected. Continue to connect and enable the public Host.";
  }

  function renderOpenAiHostEndpoint() {
    if (!elements.openAiHostEndpoint || !elements.openAiHostViewToggle || !elements.openAiHostViewLabel) return;
    const publicBaseUrl = platformOnlineVerified() && typeof state.platformAccount?.host?.openAiBaseUrl === "string"
      ? state.platformAccount.host.openAiBaseUrl
      : "";
    const showingOnline = state.openAiHostMode === "online";
    const localBaseUrl = `${location.origin}/v1`;
    elements.openAiHostEndpoint.textContent = showingOnline
      ? (publicBaseUrl || "公网 Host 未开启")
      : localBaseUrl;
    elements.openAiHostEndpoint.title = showingOnline
      ? (publicBaseUrl || "公网 Host 未开启")
      : localBaseUrl;
    elements.openAiHostViewToggle.classList.toggle("local", !showingOnline);
    elements.openAiHostViewToggle.classList.toggle("online", showingOnline && Boolean(publicBaseUrl));
    elements.openAiHostViewToggle.classList.toggle("unavailable", showingOnline && !publicBaseUrl);
    elements.openAiHostViewToggle.setAttribute("aria-pressed", String(showingOnline));
    const actionLabel = showingOnline ? "切换到本地 Host" : "查看公网 Host";
    elements.openAiHostViewToggle.setAttribute("aria-label", actionLabel);
    elements.openAiHostViewToggle.setAttribute("title", actionLabel);
    elements.openAiHostViewLabel.textContent = showingOnline
      ? (publicBaseUrl ? "公网 Host" : "公网未开启")
      : "本地 Host";
    renderOnlineHostCheck();
  }

  function onlineHostFailureMessage(result) {
    if (state.language === "zh") return result?.error?.message || "公网 Host 检查失败。";
    const messages = {
      DESKTOP_SERVER_OFFLINE: "The local API is not running.",
      ONLINE_HOST_PROVIDER_UNKNOWN: "The selected Public Host provider is unknown.",
      ONLINE_HOST_INACTIVE: "The Public Host is not enabled.",
      ONLINE_HOST_NOT_PUBLIC: "The platform returned only a local development address. Deploy the platform with a public HTTPS domain first.",
      ONLINE_HOST_PUBLIC_DNS_FAILED: "Public DNS did not return a routable Funnel address.",
      ONLINE_HOST_PUBLIC_TLS_FAILED: "The real public TLS handshake failed.",
      OPENAI_ROUTE_PUBLIC_TLS_FAILED: "The public TLS route became unstable during verification.",
      ONLINE_HOST_REPAIR_FAILED: "Public TLS failed repeatedly and automatic Funnel repair did not complete.",
      ONLINE_HOST_TIMEOUT: "The public request timed out.",
      ONLINE_HOST_UNREACHABLE: "The Public Host is unreachable.",
      OPENAI_ROUTE_TIMEOUT: "The compatible API route timed out.",
      OPENAI_ROUTE_UNREACHABLE: "The compatible API route is unreachable.",
      ONLINE_HOST_NOT_ALLOWED: "The public hostname is not in the local Host allowlist.",
      ONLINE_HOST_HEALTH_FAILED: "The public health endpoint returned an unexpected response.",
      ONLINE_HOST_AUTH_BYPASSED: "The public API accepted a request without a Gateway key.",
      ONLINE_HOST_AUTH_INVALID: "The public API authentication response is incompatible.",
      ONLINE_HOST_REQUEST_ID_MISSING: "The public API response did not include a valid Request ID.",
    };
    return messages[result?.error?.code] || "Public Host check failed.";
  }

  function renderOnlineHostCheck() {
    if (!elements.openAiHostCheck || !elements.openAiHostCheckLabel || !elements.openAiHostCheckStatus) return;
    const result = state.onlineHostCheck;
    const supported = typeof window.codexDesktop?.checkOnlineHost === "function";
    elements.openAiHostCheck.disabled = state.onlineHostCheckPending || !supported;
    elements.openAiHostCheck.classList.toggle("pending", state.onlineHostCheckPending);
    elements.openAiHostCheck.classList.toggle("success", !state.onlineHostCheckPending && result?.ok === true);
    elements.openAiHostCheck.classList.toggle("failed", !state.onlineHostCheckPending && result?.ok === false);

    const buttonLabel = state.onlineHostCheckPending
      ? (state.language !== "zh" ? "Checking…" : "检查中…")
      : result
        ? (state.language !== "zh" ? "Check again" : "再次检查")
        : (state.language !== "zh" ? "Check online" : "检查公网");
    elements.openAiHostCheckLabel.textContent = buttonLabel;
    const actionLabel = supported
      ? (state.language !== "zh" ? "Check Public Host" : "检查公网 Host")
      : (state.language !== "zh" ? "Public Host checks are available only in the desktop app." : "仅桌面应用可以检查公网 Host。");
    elements.openAiHostCheck.setAttribute("aria-label", actionLabel);
    elements.openAiHostCheck.setAttribute("title", actionLabel);

    if (state.onlineHostCheckPending) {
      elements.openAiHostCheckStatus.hidden = false;
      elements.openAiHostCheckStatus.className = "online-host-check-status";
      elements.openAiHostCheckStatus.textContent = state.language !== "zh"
        ? "Checking the Public Host through its external address…"
        : "正在从外部地址检查公网 Host…";
      return;
    }
    if (!result) {
      elements.openAiHostCheckStatus.hidden = true;
      elements.openAiHostCheckStatus.textContent = "";
      elements.openAiHostCheckStatus.className = "online-host-check-status";
      return;
    }

    elements.openAiHostCheckStatus.hidden = false;
    elements.openAiHostCheckStatus.className = `online-host-check-status ${result.ok ? "success" : "failed"}`;
    if (result.ok) {
      const repaired = result.repair?.succeeded === true;
      const routeDescription = result.providerId === "coding-agent-platform"
        ? (state.language !== "zh" ? "platform route, authentication, and Request ID verified" : "平台路由、鉴权与 Request ID 正常")
        : (state.language !== "zh" ? "real public edge, authentication, and Request ID verified" : "真实公网边缘、鉴权与 Request ID 正常");
      elements.openAiHostCheckStatus.textContent = state.language !== "zh"
        ? `Online · ${result.providerLabel || result.providerId} · ${result.latencyMs} ms · ${routeDescription}${repaired ? " · Funnel repaired" : ""}`
        : `已在线 · ${result.providerLabel || result.providerId} · ${result.latencyMs} ms · ${routeDescription}${repaired ? " · Funnel 已自动修复" : ""}`;
      return;
    }
    const failure = onlineHostFailureMessage(result);
    elements.openAiHostCheckStatus.textContent = state.language !== "zh" ? `Failed · ${failure}` : `失败 · ${failure}`;
  }

  async function runOnlineHostCheck({ quiet = false } = {}) {
    const desktop = window.codexDesktop;
    if (state.onlineHostCheckPending) return;
    if (!desktop?.checkOnlineHost) {
      if (!quiet) showToast("仅桌面应用可以检查公网 Host。", "warning", 5_000);
      return;
    }
    state.onlineHostCheckPending = true;
    state.onlineHostCheck = null;
    renderOpenAiHostEndpoint();
    try {
      const providerId = "coding-agent-platform";
      const result = await desktop.checkOnlineHost(providerId);
      state.onlineHostCheck = result;
      if (result?.ok && result?.baseUrl && result.providerId === "coding-agent-platform") {
        state.openAiHostMode = "online";
      } else if (result?.providerId === "coding-agent-platform") {
        state.openAiHostMode = "local";
        state.platformAccount = await desktop.getPlatformAccount();
        renderPlatformAccount();
      }
      if (!quiet || result?.repair?.attempted) {
        const repaired = result?.repair?.succeeded === true;
        showToast(
          repaired
            ? (state.language !== "zh"
              ? "The public TLS route was repaired automatically and passed the real public check."
              : "公网 TLS 路由已自动修复并通过真实公网检查。")
            : result?.ok
              ? (state.language !== "zh" ? "Public Host check passed." : "公网 Host 检查成功。")
              : onlineHostFailureMessage(result),
          result?.ok ? "success" : "error",
          result?.ok ? 5_000 : 8_000,
        );
      }
    } catch (error) {
      state.onlineHostCheck = {
        ok: false,
        error: { code: "ONLINE_HOST_CHECK_FAILED", message: error?.message || "公网 Host 检查失败。" },
      };
      if (!quiet) showToast(error?.message || "公网 Host 检查失败。", "error", 8_000);
    } finally {
      state.onlineHostCheckPending = false;
      renderOpenAiHostEndpoint();
    }
  }

  async function toggleOpenAiHostView() {
    const showingOnline = state.openAiHostMode === "online";
    if (showingOnline) {
      state.openAiHostMode = "local";
      renderOpenAiHostEndpoint();
      return;
    }
    if (!state.platformAccount?.signedIn) {
      showToast("请先登录平台。", "warning", 5_000);
      void openPlatformAccountDialog();
      return;
    }
    const account = await refreshPlatformAccount({ quiet: false });
    if (account?.online === true && account?.verification?.ok === true) {
      state.openAiHostMode = "online";
    } else {
      state.openAiHostMode = "local";
      showToast(onlineHostFailureMessage(account?.verification), "error", 8_000);
    }
    renderOpenAiHostEndpoint();
  }

  function disarmTailscaleFunnelToggle() {
    if (state.tailscaleFunnelConfirmTimer) clearTimeout(state.tailscaleFunnelConfirmTimer);
    state.tailscaleFunnelConfirmTimer = null;
    if (!elements.toggleTailscaleFunnel) return;
    elements.toggleTailscaleFunnel.dataset.confirm = "false";
    elements.toggleTailscaleFunnel.classList.remove("armed");
    renderTailscaleFunnel();
  }

  function renderTailscaleFunnel() {
    if (!elements.tailscaleFunnelStatus || !elements.tailscaleFunnelIndicator) return;
    const status = state.tailscaleFunnel;
    const desktopAvailable = Boolean(
      window.codexDesktop?.getTailscaleFunnelStatus
      && window.codexDesktop?.setTailscaleFunnelEnabled,
    );
    let tone = "checking";
    let label = "正在检查";
    if (!desktopAvailable) {
      tone = "warning";
      label = "状态不可用";
    } else if (!state.tailscaleFunnelPending && status) {
      if (status.active) {
        tone = "online";
        label = "公网已开启";
      } else if (status.conflict) {
        tone = "warning";
        label = "配置冲突";
      } else if (status.installed && status.connected) {
        tone = "ready";
        label = "已连接，等待开启";
      } else if (status.installed) {
        tone = "warning";
        label = "等待 Tailscale 连接";
      } else {
        tone = "error";
        label = "尚未安装";
      }
    }

    elements.tailscaleFunnelStatus.textContent = desktopAvailable
      ? tailscaleFunnelMessage(status)
      : "仅桌面应用支持一键 Tailscale Funnel。";
    elements.tailscaleFunnelIndicator.className = `online-host-indicator ${tone}`;
    elements.tailscaleFunnelIndicator.querySelector("span").textContent = state.tailscaleFunnelPending
      ? (status?.active ? "正在关闭…" : "正在开启…")
      : label;

    const baseUrl = status?.active && typeof status.baseUrl === "string" ? status.baseUrl : "";
    elements.tailscaleFunnelUrlRow.hidden = !baseUrl;
    elements.tailscaleFunnelBaseUrl.textContent = baseUrl || "—";
    elements.copyTailscaleBaseUrl.disabled = state.tailscaleFunnelPending || !baseUrl;

    elements.refreshTailscaleFunnel.disabled = state.tailscaleFunnelPending || !desktopAvailable;
    elements.toggleTailscaleFunnel.disabled = state.tailscaleFunnelPending
      || !desktopAvailable
      || !status?.installed
      || status?.conflict === true;
    elements.toggleTailscaleFunnel.classList.toggle("online", status?.active === true);
    elements.toggleTailscaleFunnel.setAttribute("aria-pressed", String(status?.active === true));
    if (elements.toggleTailscaleFunnel.dataset.confirm !== "true") {
      elements.toggleTailscaleFunnel.textContent = status?.active ? "关闭公网" : "开启公网";
    }

    const showHelp = desktopAvailable && (!status?.installed || Boolean(status?.error?.actionUrl));
    elements.openTailscaleDownload.hidden = !showHelp;
    elements.openTailscaleDownload.textContent = status?.error?.actionUrl ? "打开操作页面" : "安装 Tailscale";
    renderOpenAiHostEndpoint();
  }

  async function refreshTailscaleFunnel({ quiet = false } = {}) {
    const desktop = window.codexDesktop;
    if (!desktop?.getTailscaleFunnelStatus || state.tailscaleFunnelPending) {
      renderTailscaleFunnel();
      return;
    }
    let checkPublicRoute = false;
    state.tailscaleFunnelPending = true;
    renderTailscaleFunnel();
    try {
      const status = await desktop.getTailscaleFunnelStatus();
      const wasActive = state.tailscaleFunnel?.active === true;
      if (state.onlineHostCheck?.baseUrl && state.onlineHostCheck.baseUrl !== status?.baseUrl) {
        state.onlineHostCheck = null;
      }
      state.tailscaleFunnel = status;
      if (state.openAiHostMode === null || (!wasActive && status?.active)) {
        state.openAiHostMode = status?.active && status?.baseUrl ? "online" : "local";
      }
      checkPublicRoute = status?.active === true && Boolean(status?.baseUrl);
      if (status?.error?.actionUrl) state.tailscaleHelpUrl = status.error.actionUrl;
    } catch (error) {
      state.tailscaleFunnel = {
        installed: false,
        connected: false,
        active: false,
        online: false,
        message: error?.message || "无法检查 Tailscale Funnel 状态。",
      };
      if (!quiet) showToast(error?.message || "无法检查 Tailscale Funnel 状态。", "error", 6_000);
    } finally {
      state.tailscaleFunnelPending = false;
      renderTailscaleFunnel();
    }
    if (checkPublicRoute) void runOnlineHostCheck({ quiet: true });
  }

  async function toggleTailscaleFunnel() {
    const desktop = window.codexDesktop;
    if (!desktop?.setTailscaleFunnelEnabled || state.tailscaleFunnelPending) return;
    const enable = state.tailscaleFunnel?.active !== true;
    if (enable && elements.toggleTailscaleFunnel.dataset.confirm !== "true") {
      elements.toggleTailscaleFunnel.dataset.confirm = "true";
      elements.toggleTailscaleFunnel.classList.add("armed");
      elements.toggleTailscaleFunnel.textContent = "确认公开到互联网";
      state.tailscaleFunnelConfirmTimer = window.setTimeout(disarmTailscaleFunnelToggle, 6_000);
      return;
    }
    disarmTailscaleFunnelToggle();
    state.tailscaleFunnelPending = true;
    renderTailscaleFunnel();
    try {
      const result = await desktop.setTailscaleFunnelEnabled(enable);
      if (!result?.ok) {
        if (result?.error?.actionUrl) state.tailscaleHelpUrl = result.error.actionUrl;
        state.tailscaleFunnel = {
          ...(state.tailscaleFunnel || {}),
          error: result?.error || null,
          message: result?.error?.message || state.tailscaleFunnel?.message,
        };
        throw new Error(result?.error?.message || "Tailscale Funnel 操作失败。");
      }
      state.tailscaleFunnel = result.status;
      state.onlineHostCheck = null;
      state.openAiHostMode = enable && result.status?.active ? "online" : "local";
      showToast(enable ? "公网 Host 已开启。请保持本程序运行。" : "公网 Host 已关闭。", "success", 6_000);
      if (enable && !state.gatewayEnabled) {
        showToast("API Host 当前已关闭，公网请求仍会返回 503；请在首页重新开启 Host。", "warning", 8_000);
      }
    } catch (error) {
      showToast(error?.message || "Tailscale Funnel 操作失败。", "error", 8_000);
    } finally {
      state.tailscaleFunnelPending = false;
      renderTailscaleFunnel();
    }
  }

  async function openTailscaleHelp() {
    if (!window.codexDesktop?.openExternal) return;
    try {
      await window.codexDesktop.openExternal(state.tailscaleHelpUrl || "https://tailscale.com/download/windows");
    } catch (error) {
      showToast(error?.message || "无法打开 Tailscale 页面。", "error");
    }
  }

  function setReleaseStatus(text, tone = "idle") {
    if (!elements.releaseStatus || !elements.releaseStatusText) return;
    const normalizedTone = ["idle", "success", "warning", "error", "checking"].includes(tone) ? tone : "idle";
    elements.releaseStatus.className = `release-status ${normalizedTone}`;
    elements.releaseStatusText.textContent = text;
  }

  function setReleaseBusy(busy) {
    state.releaseActionPending = Boolean(busy);
    const disabled = state.releaseActionPending || !state.releaseToolsAvailable;
    [
      elements.checkDesktopUpdates,
      elements.openDesktopRelease,
      elements.exportDiagnostics,
    ].forEach((button) => {
      if (button) button.disabled = disabled;
    });
  }

  function openSettingsDialog() {
    if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
    void refreshPlatformAccount({ quiet: true });
  }

  function closeSettingsDialog() {
    if (elements.settingsDialog.open) elements.settingsDialog.close();
  }

  async function checkDesktopUpdates() {
    if (state.releaseActionPending || !state.releaseToolsAvailable) return;
    setReleaseBusy(true);
    setReleaseStatus("正在检查 GitHub 更新…", "checking");
    try {
      const result = await window.codexDesktop.checkForUpdates();
      const available = Boolean(result?.available && result?.releaseUrl && result?.latestVersion);
      state.releaseUrl = available ? result.releaseUrl : null;
      elements.openDesktopRelease.hidden = !available;
      elements.availableReleaseVersion.textContent = available
        ? `版本 ${result.latestVersion}`
        : "打开 GitHub Release 页面";
      setReleaseStatus(available ? "发现可用的新版本。" : "当前已是最新版本。", available ? "warning" : "success");
    } catch (error) {
      state.releaseUrl = null;
      elements.openDesktopRelease.hidden = true;
      setReleaseStatus("更新检查失败。", "error");
      showToast(error?.message || "更新检查失败。", "error", 6_000);
    } finally {
      setReleaseBusy(false);
    }
  }

  async function openDesktopRelease() {
    if (state.releaseActionPending || !state.releaseToolsAvailable || !state.releaseUrl) return;
    try {
      await window.codexDesktop.openExternal(state.releaseUrl);
    } catch (error) {
      showToast(error?.message || "无法打开 GitHub Release 页面。", "error");
    }
  }

  async function exportDesktopDiagnostics() {
    if (state.releaseActionPending || !state.releaseToolsAvailable) return;
    setReleaseBusy(true);
    setReleaseStatus("正在导出诊断…", "checking");
    try {
      const result = await window.codexDesktop.exportDiagnostics();
      if (result?.canceled) {
        setReleaseStatus("设置工具已就绪", "idle");
      } else {
        setReleaseStatus("诊断报告已导出。", "success");
        showToast(result?.fileName ? `诊断报告已导出：${result.fileName}` : "诊断报告已导出。", "success");
      }
    } catch (error) {
      setReleaseStatus("诊断导出失败。", "error");
      showToast(error?.message || "诊断导出失败。", "error", 6_000);
    } finally {
      setReleaseBusy(false);
    }
  }

  async function initializeReleaseTools() {
    const desktop = window.codexDesktop;
    if (!desktop?.getPlatform || !desktop?.checkForUpdates || !desktop?.openExternal || !desktop?.exportDiagnostics) {
      state.releaseToolsAvailable = false;
      elements.desktopAppVersion.textContent = "Web";
      setReleaseBusy(false);
      setReleaseStatus("仅桌面应用支持更新与诊断。", "warning");
      return;
    }
    try {
      const platform = await desktop.getPlatform();
      elements.desktopAppVersion.textContent = platform?.appVersion ? `v${platform.appVersion}` : "—";
      state.releaseToolsAvailable = true;
      setReleaseBusy(false);
      setReleaseStatus("设置工具已就绪", "success");
    } catch (error) {
      state.releaseToolsAvailable = false;
      setReleaseBusy(false);
      setReleaseStatus("仅桌面应用支持更新与诊断。", "error");
    }
  }

  async function initializeDesktopPreferences() {
    const desktop = window.codexDesktop;
    elements.minimizeToTrayToggle.disabled = true;
    elements.desktopPortInput.disabled = true;
    elements.saveDesktopPort.disabled = true;
    if (!desktop?.getPreferences) return;
    try {
      const preferences = await desktop.getPreferences();
      elements.minimizeToTrayToggle.checked = preferences?.minimizeToTray === true;
      elements.minimizeToTrayToggle.disabled = !desktop?.setMinimizeToTray;
      const savedPort = Number(preferences?.port);
      elements.desktopPortInput.value = Number.isInteger(savedPort) && savedPort > 0 ? String(savedPort) : "4310";
      const managed = preferences?.portManagedByEnvironment === true;
      elements.desktopPortHint.textContent = managed
        ? "当前由 CODEX_DESKTOP_PORT 覆盖；保存值将在移除变量后生效"
        : "默认为 4310；修改后重启程序生效";
      elements.desktopPortInput.disabled = !desktop?.setDesktopPort;
      elements.saveDesktopPort.disabled = !desktop?.setDesktopPort;
    } catch {
      elements.minimizeToTrayToggle.checked = false;
      elements.desktopPortInput.value = "4310";
    }
  }

  async function updateDesktopPort(event) {
    event.preventDefault();
    const desktop = window.codexDesktop;
    if (!desktop?.setDesktopPort || elements.desktopPortInput.disabled) return;
    const port = Number(elements.desktopPortInput.value);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      showToast(state.language !== "zh" ? "Enter a port between 1 and 65535." : "请输入 1 到 65535 之间的端口。", "error", 6_000);
      elements.desktopPortInput.focus();
      return;
    }
    elements.desktopPortInput.disabled = true;
    elements.saveDesktopPort.disabled = true;
    try {
      const preferences = await desktop.setDesktopPort(port);
      elements.desktopPortInput.value = String(preferences?.port ?? port);
      showToast(
        preferences?.restartRequired
          ? (state.language !== "zh" ? `Port ${port} saved. Restart the app to apply it.` : `端口 ${port} 已保存，重启程序后生效。`)
          : (state.language !== "zh" ? `Port ${port} is already active.` : `端口 ${port} 已经生效。`),
        "success",
        6_000,
      );
    } catch (error) {
      let message = error?.message || "无法保存 API 端口。";
      if (state.language !== "zh") {
        message = /占用/.test(message)
          ? `Port ${port} is already in use. Choose another port.`
          : "Unable to save the API port.";
      }
      showToast(message, "error", 6_000);
    } finally {
      elements.desktopPortInput.disabled = false;
      elements.saveDesktopPort.disabled = false;
    }
  }

  async function updateTrayPreference() {
    const desktop = window.codexDesktop;
    if (!desktop?.setMinimizeToTray || elements.minimizeToTrayToggle.disabled) return;
    const previous = !elements.minimizeToTrayToggle.checked;
    const requested = elements.minimizeToTrayToggle.checked;
    elements.minimizeToTrayToggle.disabled = true;
    try {
      const preferences = await desktop.setMinimizeToTray(requested);
      const enabled = preferences?.minimizeToTray === true;
      elements.minimizeToTrayToggle.checked = enabled;
      showToast(
        enabled ? "已开启托盘模式，关闭窗口后 Host 将继续运行。" : "托盘模式已关闭，关闭窗口将退出程序。",
        "success",
      );
    } catch (error) {
      elements.minimizeToTrayToggle.checked = previous;
      showToast(error?.message || "无法更新托盘设置。", "error", 6_000);
    } finally {
      elements.minimizeToTrayToggle.disabled = false;
    }
  }

  function bindEvents() {
    elements.settingsButton.addEventListener("click", openSettingsDialog);
    elements.closeSettingsDialog.addEventListener("click", closeSettingsDialog);
    elements.settingsDialog.addEventListener("click", (event) => {
      if (event.target === elements.settingsDialog) closeSettingsDialog();
    });
    elements.minimizeToTrayToggle.addEventListener("change", () => void updateTrayPreference());
    elements.desktopPortForm.addEventListener("submit", (event) => void updateDesktopPort(event));
    elements.refreshTailscaleFunnel?.addEventListener("click", () => void refreshTailscaleFunnel());
    elements.toggleTailscaleFunnel?.addEventListener("click", () => void toggleTailscaleFunnel());
    elements.copyTailscaleBaseUrl?.addEventListener("click", () => {
      const baseUrl = state.tailscaleFunnel?.baseUrl;
      if (baseUrl) void copyPlainText(baseUrl, "公网 base_url 已复制。");
    });
    elements.openTailscaleDownload?.addEventListener("click", () => void openTailscaleHelp());
    elements.platformAccountButton.addEventListener("click", openPlatformAccountDialog);
    elements.closePlatformAccountDialog.addEventListener("click", closePlatformAccountDialog);
    elements.platformAccountDialog.addEventListener("click", (event) => {
      if (event.target === elements.platformAccountDialog) closePlatformAccountDialog();
    });
    elements.platformBrowserLoginButton.addEventListener("click", () => void loginWithPlatformBrowser());
    elements.platformLogoutButton.addEventListener("click", () => void logoutPlatformAccount());
    elements.platformProfileOnlineButton.addEventListener("click", () => void setPlatformOnline());
    elements.platformOnlineHostButton.addEventListener("click", () => void setPlatformOnline());
    elements.shareOnlineButton.addEventListener("click", () => void setPlatformOnline());
    elements.themeDarkButton.addEventListener("click", () => setTheme("dark", { notify: true }));
    elements.themeLightButton.addEventListener("click", () => setTheme("light", { notify: true }));
    elements.languageSelect.addEventListener("change", (event) => {
      setLanguage(event.target.value);
    });
    elements.refreshCodexReadiness.addEventListener("click", () => void checkCodexReadiness({ quiet: false }));
    elements.connectChatGpt.addEventListener("click", () => void connectChatGpt());
    elements.copyCodexLoginCommand.addEventListener("click", () => {
      void copyPlainText("codex login", "登录命令已复制。");
    });
    elements.checkDesktopUpdates.addEventListener("click", () => void checkDesktopUpdates());
    elements.openDesktopRelease.addEventListener("click", () => void openDesktopRelease());
    elements.exportDiagnostics.addEventListener("click", () => void exportDesktopDiagnostics());
    elements.openLocalLegal?.addEventListener("click", () => {
      window.location.href = "/legal/index.html#terms";
    });
    elements.taskPrompt.addEventListener("input", updateCharCount);
    elements.taskPrompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void startTask();
      }
    });
    elements.addImagesButton.addEventListener("click", () => elements.imageInput.click());
    elements.addFilesButton.addEventListener("click", () => elements.fileInput.click());
    elements.imageInput.addEventListener("change", (event) => addSelectedImages(event.target.files || []));
    elements.fileInput.addEventListener("change", (event) => addSelectedImages(event.target.files || []));
    ["dragenter", "dragover"].forEach((type) => {
      elements.promptShell.addEventListener(type, (event) => {
        if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
        event.preventDefault();
        if (type === "dragenter") state.imageDragDepth += 1;
        if (!state.runRequestPending && !isTaskActive()) elements.promptShell.classList.add("dragging-images");
      });
    });
    elements.promptShell.addEventListener("dragleave", () => {
      state.imageDragDepth = Math.max(0, state.imageDragDepth - 1);
      if (!state.imageDragDepth) elements.promptShell.classList.remove("dragging-images");
    });
    elements.promptShell.addEventListener("drop", (event) => {
      if (![...(event.dataTransfer?.types || [])].includes("Files")) return;
      event.preventDefault();
      state.imageDragDepth = 0;
      elements.promptShell.classList.remove("dragging-images");
      addSelectedImages(event.dataTransfer?.files || []);
    });
    elements.projectPath.addEventListener("input", () => {
      state.projectPathDraft = elements.projectPath.value.trim();
      state.selectedProject = { path: state.projectPathDraft };
      setStoredValue("codex.projectPath", state.projectPathDraft);
      elements.projectNote.textContent = "可粘贴 Windows 完整路径，或使用原生目录选择器";
    });
    elements.projectModeProject.addEventListener("click", () => setProjectlessMode(false));
    elements.projectModeNone.addEventListener("click", () => setProjectlessMode(true));
    elements.pickProjectButton.addEventListener("click", () => void pickProject());
    elements.folderFallback.addEventListener("change", handleBrowserFolder);
    elements.runButton.addEventListener("click", () => void startTask());
    elements.newTaskButton?.addEventListener("click", newTask);
    elements.openApiTestBench.addEventListener("click", newTask);
    elements.closeApiTestBench.addEventListener("click", hideApiTestBench);
    elements.refreshHistory.addEventListener("click", () => void loadHistory());
    elements.clearLog.addEventListener("click", clearLogs);
    elements.copyResult.addEventListener("click", () => void copyResult());
    elements.sidebarOpen.addEventListener("click", openSidebar);
    elements.sidebarClose.addEventListener("click", closeSidebar);
    elements.sidebarScrim.addEventListener("click", closeSidebar);

    elements.modelTrigger.addEventListener("click", () => {
      const opened = toggleModelPopover();
      if (opened) requestAnimationFrame(() => $(".setting-row", elements.modelPopover)?.focus());
    });
    elements.modelTrigger.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        toggleModelPopover(true);
        const rows = $$(".setting-row, .reset-setting", elements.modelPopover);
        requestAnimationFrame(() => rows[event.key === "ArrowDown" ? 0 : rows.length - 1]?.focus());
      }
    });
    $$(".setting-row", elements.modelPopover).forEach((row) => {
      row.addEventListener("click", () => openSubmenu(row.dataset.setting, true));
      row.addEventListener("keydown", handleMainMenuKeydown);
    });
    elements.resetSettings.addEventListener("click", resetSettings);
    elements.resetSettings.addEventListener("keydown", handleMainMenuKeydown);
    elements.createKeyFromConfig.addEventListener("click", focusApiKeyPanel);
    elements.createKeyFromConfig.addEventListener("keydown", handleMainMenuKeydown);
    document.addEventListener("pointerdown", (event) => {
      if (!elements.modelPopover.hidden && !elements.modelControl.contains(event.target)) toggleModelPopover(false);
    });

    $$('input[name="permission"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked && input.value === "danger-full-access") {
          showToast("完全访问允许修改项目外文件，请确认任务来源可信。", "warning", 6_000);
        }
      });
    });

    elements.apiDocsButton?.addEventListener("click", focusApiKeyPanel);
    elements.manageApiKeysButton.addEventListener("click", focusApiKeyPanel);
    elements.gatewayHostToggle.addEventListener("click", () => void toggleGatewayHost());
    elements.openAiHostCheck.addEventListener("click", () => void runOnlineHostCheck());
    elements.openAiHostViewToggle.addEventListener("click", toggleOpenAiHostView);
    elements.gatewayKeyFilter.addEventListener("change", () => {
      state.gatewayKeyFilter = elements.gatewayKeyFilter.value || "all";
      renderGatewayMonitor();
    });
    elements.refreshGatewayMonitor.addEventListener("click", () => {
      void refreshGatewayMonitorData({ quiet: false, includeUsage: true, includeKeys: true });
    });
    elements.apiKeyForm.addEventListener("submit", (event) => void createApiKey(event));
    elements.openApiKeyAdvancedSettings.addEventListener("click", () => void openApiKeyAdvancedSettings());
    elements.closeApiKeyAdvancedSettings.addEventListener("click", closeApiKeyAdvancedSettings);
    elements.cancelApiKeyAdvancedSettings.addEventListener("click", closeApiKeyAdvancedSettings);
    elements.apiKeyAdvancedDialog.addEventListener("click", (event) => {
      if (event.target === elements.apiKeyAdvancedDialog) closeApiKeyAdvancedSettings();
    });
    elements.apiKeyAdvancedForm.addEventListener("submit", (event) => void saveApiKeyAdvancedSettings(event));
    elements.apiKeyAdvancedSelect.addEventListener("change", () => {
      state.advancedApiKeyId = elements.apiKeyAdvancedSelect.value || null;
      renderApiKeyAdvancedSettings(state.advancedApiKeyId);
    });
    elements.apiKeyDisableAfter.addEventListener("change", updateAdvancedExpirationDraft);
    elements.copyApiKey.addEventListener("click", () => {
      void copyPlainText(state.revealedApiKey, "API Key 已复制到剪贴板。");
    });
    elements.hideApiKeySecret.addEventListener("click", clearRevealedApiKey);
    elements.copyApiExample.addEventListener("click", () => {
      void copyPlainText(elements.apiExampleCode.textContent, "调用示例已复制。");
    });
    elements.refreshApiKeys.addEventListener("click", () => void loadApiKeys({ quiet: false }));
    elements.resetUsageDashboard.addEventListener("click", () => void resetUsageStatistics());
    elements.refreshUsageDashboard.addEventListener("click", () => void loadUsageDashboard({ quiet: false }));

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (!elements.settingSubmenu.hidden) {
          event.preventDefault();
          closeSubmenu(true);
        } else if (!elements.modelPopover.hidden) {
          event.preventDefault();
          toggleModelPopover(false);
          elements.modelTrigger.focus();
        } else if (elements.apiKeyAdvancedDialog.open) {
          closeApiKeyAdvancedSettings();
        } else if (document.body.classList.contains("sidebar-visible")) {
          closeSidebar();
        }
      }
      if ((event.ctrlKey || event.metaKey) && ["n", "t"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        newTask();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        connectWebSocket();
        void checkHealth();
        void loadGatewayHost({ quiet: true });
        void refreshGatewayMonitorData({ quiet: true, includeUsage: true });
        if (state.currentTask?.id && isTaskActive()) void refreshCurrentTask();
      }
    });
    window.addEventListener("online", () => {
      void checkHealth({ quiet: false });
      connectWebSocket();
      if (platformOnlineVerified()) void runOnlineHostCheck({ quiet: true });
    });
    window.addEventListener("offline", () => setConnection("offline", "网络不可用"));
    window.addEventListener("beforeunload", () => {
      state.selectedImages.forEach((entry) => {
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      });
      localizationObserver?.disconnect();
      closeTaskStreams();
      if (state.tailscaleFunnelConfirmTimer) clearTimeout(state.tailscaleFunnelConfirmTimer);
      if (state.gatewayMonitorTimer) clearInterval(state.gatewayMonitorTimer);
      if (state.onlineHostMonitorTimer) clearInterval(state.onlineHostMonitorTimer);
      if (state.socketRetry) clearTimeout(state.socketRetry);
      state.socket?.close();
    });
  }

  async function initialize() {
    initializeTheme();
    initializeLocalization();
    await requireLocalTermsAcceptance();
    if (elements.apiAddress) elements.apiAddress.textContent = location.host || "127.0.0.1";
    elements.restEndpoint.textContent = `${location.origin}${API_BASE}`;
    renderOpenAiHostEndpoint();
    renderPlatformAccount();
    populateApiKeyModelOptions();
    loadStoredPreferences();
    syncApiKeyFormToCurrentConfig();
    bindEvents();
    updateCharCount();
    renderSelectedImages();
    renderAllLogs();
    renderTimeline();
    setResult("");
    setConnection("checking", "正在连接");
    connectWebSocket();
    // This performs local process/file checks only. It is intentionally not
    // awaited so first paint and the rest of the dashboard remain responsive.
    void checkCodexReadiness({ quiet: true });
    void initializeReleaseTools();
    void initializeDesktopPreferences();
    void refreshPlatformAccount({ quiet: true });

    const results = await Promise.allSettled([
      checkHealth({ quiet: true }),
      loadModels(),
      loadProjects(),
      loadHistory({ quiet: true }),
      loadApiKeys({ quiet: true }),
      loadUsageDashboard({ quiet: true }),
      loadGatewayHost({ quiet: true }),
    ]);
    if (results[0].status === "rejected") setConnection("offline", "本地服务离线");
    window.setInterval(() => void checkHealth({ quiet: true }), 30_000);
    state.gatewayMonitorTimer = window.setInterval(() => {
      if (!document.hidden) void refreshGatewayMonitorData({ quiet: true, includeUsage: false });
    }, 5_000);
    state.onlineHostMonitorTimer = window.setInterval(() => {
      if (!document.hidden && platformOnlineVerified()) void runOnlineHostCheck({ quiet: true });
    }, 5 * 60_000);
    window.setInterval(() => {
      if (!document.hidden) void loadUsageDashboard({ quiet: true });
    }, 15_000);
  }

  void initialize();
})();
