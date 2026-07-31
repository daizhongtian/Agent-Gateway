import { useEffect, useState } from 'react'
import { GENERATED_CATALOG, REQUIRED_TRANSLATION_KEYS } from './generated-translations'

export type Language = 'zh' | 'en' | 'ja' | 'ko' | 'es' | 'fr' | 'de' | 'pt' | 'tr'

export const LANGUAGE_STORAGE_KEY = 'agent-gateway-language'

export const LANGUAGES: ReadonlyArray<{ code: Language; label: string; short: string; locale: string }> = [
  { code: 'zh', label: '简体中文', short: '中', locale: 'zh-CN' },
  { code: 'en', label: 'English', short: 'EN', locale: 'en-US' },
  { code: 'ja', label: '日本語', short: '日', locale: 'ja-JP' },
  { code: 'ko', label: '한국어', short: '한', locale: 'ko-KR' },
  { code: 'es', label: 'Español', short: 'ES', locale: 'es-ES' },
  { code: 'fr', label: 'Français', short: 'FR', locale: 'fr-FR' },
  { code: 'de', label: 'Deutsch', short: 'DE', locale: 'de-DE' },
  { code: 'pt', label: 'Português', short: 'PT', locale: 'pt-BR' },
  { code: 'tr', label: 'Türkçe', short: 'TR', locale: 'tr-TR' },
]

const CATALOG: Partial<Record<Language, Record<string, string>>> = {
  ja: {
    'Primary navigation': 'メインナビゲーション', Overview: '概要', Connect: '接続', Security: 'セキュリティ',
    'Create account': 'アカウント作成', 'Sign in': 'ログイン', Username: 'ユーザー名', Password: 'パスワード',
    'Email (optional)': 'メール（任意）', 'Welcome back': 'おかえりなさい', 'Open dashboard': 'ダッシュボードを開く',
    'Create your account': 'アカウントを作成', 'Set up your first Host device': '最初の Host デバイスを設定',
    'Download for Windows': 'Windows 版をダウンロード', 'Sign in to platform': 'プラットフォームにログイン',
    'Your coding agent.': 'あなたの Coding Agent を、', 'Any application.': 'あらゆるアプリから。',
    'What it does': '機能', 'Connect your agent': 'Agent を接続', 'Security boundaries': 'セキュリティ境界',
    'Copy': 'コピー', 'Code copied': 'コードをコピーしました', 'Clipboard unavailable': 'クリップボードを利用できません',
    'Account & security': 'アカウントとセキュリティ', 'Good evening,': 'こんばんは、', 'Connection overview': '接続概要',
    'Check again': '再確認', 'Open Agent Gateway': 'Agent Gateway を開く', 'Download Windows': 'Windows をダウンロード',
    'Status alerts': 'ステータス通知', 'Sign out': 'ログアウト', 'Back home': 'ホームへ戻る',
    'Users': 'ユーザー', 'Devices': 'デバイス', 'Hosts': 'Hosts', 'Audit log': '監査ログ', 'Refresh': '更新',
    'Database users': 'データベースのユーザー', 'active accounts': '有効なアカウント', 'Hosts online now': '現在オンラインの Host',
    'Aggregate count only': '集計数のみ表示', 'User overview': 'ユーザー概要', 'View platform users.': 'プラットフォームユーザーを確認。',
    'View user accounts in the database and the aggregate count of Hosts currently online.': 'データベース内のユーザーアカウントと、現在オンラインの Host の集計数を表示します。',
    'Read-only account list': '読み取り専用のアカウント一覧',
  },
  ko: {
    'Primary navigation': '주요 탐색', Overview: '개요', Connect: '연결', Security: '보안',
    'Create account': '계정 만들기', 'Sign in': '로그인', Username: '사용자 이름', Password: '비밀번호',
    'Email (optional)': '이메일(선택)', 'Welcome back': '다시 오신 것을 환영합니다', 'Open dashboard': '대시보드 열기',
    'Create your account': '계정 만들기', 'Set up your first Host device': '첫 번째 Host 기기 설정',
    'Download for Windows': 'Windows용 다운로드', 'Sign in to platform': '플랫폼 로그인',
    'Your coding agent.': '당신의 Coding Agent를,', 'Any application.': '모든 앱에서.',
    'What it does': '기능', 'Connect your agent': 'Agent 연결', 'Security boundaries': '보안 경계',
    Copy: '복사', 'Code copied': '코드가 복사되었습니다', 'Clipboard unavailable': '클립보드를 사용할 수 없습니다',
    'Account & security': '계정 및 보안', 'Good evening,': '안녕하세요,', 'Connection overview': '연결 개요',
    'Check again': '다시 확인', 'Open Agent Gateway': 'Agent Gateway 열기', 'Download Windows': 'Windows 다운로드',
    'Status alerts': '상태 알림', 'Sign out': '로그아웃', 'Back home': '홈으로',
    Users: '사용자', Devices: '기기', Hosts: 'Hosts', 'Audit log': '감사 로그', Refresh: '새로고침',
    'Database users': '데이터베이스 사용자', 'active accounts': '활성 계정', 'Hosts online now': '현재 온라인 Host',
    'Aggregate count only': '집계 수만 표시', 'User overview': '사용자 개요', 'View platform users.': '플랫폼 사용자 보기.',
    'View user accounts in the database and the aggregate count of Hosts currently online.': '데이터베이스의 사용자 계정과 현재 온라인 상태인 Host의 집계 수를 표시합니다.',
    'Read-only account list': '읽기 전용 계정 목록',
  },
  es: {
    'Primary navigation': 'Navegación principal', Overview: 'Resumen', Connect: 'Conectar', Security: 'Seguridad',
    'Create account': 'Crear cuenta', 'Sign in': 'Iniciar sesión', Username: 'Usuario', Password: 'Contraseña',
    'Email (optional)': 'Correo (opcional)', 'Welcome back': 'Te damos la bienvenida', 'Open dashboard': 'Abrir panel',
    'Create your account': 'Crea tu cuenta', 'Set up your first Host device': 'Configura tu primer dispositivo Host',
    'Download for Windows': 'Descargar para Windows', 'Sign in to platform': 'Entrar en la plataforma',
    'Your coding agent.': 'Tu agente de código.', 'Any application.': 'Cualquier aplicación.',
    'What it does': 'Funciones', 'Connect your agent': 'Conecta tu agente', 'Security boundaries': 'Límites de seguridad',
    Copy: 'Copiar', 'Code copied': 'Código copiado', 'Clipboard unavailable': 'Portapapeles no disponible',
    'Account & security': 'Cuenta y seguridad', 'Good evening,': 'Buenas tardes,', 'Connection overview': 'Resumen de conexión',
    'Check again': 'Comprobar de nuevo', 'Open Agent Gateway': 'Abrir Agent Gateway', 'Download Windows': 'Descargar Windows',
    'Status alerts': 'Avisos de estado', 'Sign out': 'Cerrar sesión', 'Back home': 'Volver al inicio',
    Users: 'Usuarios', Devices: 'Dispositivos', Hosts: 'Hosts', 'Audit log': 'Registro de auditoría', Refresh: 'Actualizar',
    'Database users': 'Usuarios en la base de datos', 'active accounts': 'cuentas activas', 'Hosts online now': 'Hosts conectados ahora',
    'Aggregate count only': 'Solo se muestra el total', 'User overview': 'Resumen de usuarios', 'View platform users.': 'Ver usuarios de la plataforma.',
    'View user accounts in the database and the aggregate count of Hosts currently online.': 'Consulta las cuentas de usuario de la base de datos y el total de Hosts conectados actualmente.',
    'Read-only account list': 'Lista de cuentas de solo lectura',
  },
  fr: {
    'Primary navigation': 'Navigation principale', Overview: 'Vue d’ensemble', Connect: 'Connexion', Security: 'Sécurité',
    'Create account': 'Créer un compte', 'Sign in': 'Se connecter', Username: 'Nom d’utilisateur', Password: 'Mot de passe',
    'Email (optional)': 'E-mail (facultatif)', 'Welcome back': 'Bon retour', 'Open dashboard': 'Ouvrir le tableau de bord',
    'Create your account': 'Créez votre compte', 'Set up your first Host device': 'Configurez votre premier appareil Host',
    'Download for Windows': 'Télécharger pour Windows', 'Sign in to platform': 'Se connecter à la plateforme',
    'Your coding agent.': 'Votre agent de code.', 'Any application.': 'Toute application.',
    'What it does': 'Fonctions', 'Connect your agent': 'Connectez votre agent', 'Security boundaries': 'Limites de sécurité',
    Copy: 'Copier', 'Code copied': 'Code copié', 'Clipboard unavailable': 'Presse-papiers indisponible',
    'Account & security': 'Compte et sécurité', 'Good evening,': 'Bonsoir,', 'Connection overview': 'Vue des connexions',
    'Check again': 'Vérifier à nouveau', 'Open Agent Gateway': 'Ouvrir Agent Gateway', 'Download Windows': 'Télécharger Windows',
    'Status alerts': 'Alertes d’état', 'Sign out': 'Se déconnecter', 'Back home': 'Retour à l’accueil',
    Users: 'Utilisateurs', Devices: 'Appareils', Hosts: 'Hosts', 'Audit log': 'Journal d’audit', Refresh: 'Actualiser',
    'Database users': 'Utilisateurs de la base de données', 'active accounts': 'comptes actifs', 'Hosts online now': 'Hosts en ligne actuellement',
    'Aggregate count only': 'Nombre agrégé uniquement', 'User overview': 'Vue des utilisateurs', 'View platform users.': 'Afficher les utilisateurs de la plateforme.',
    'View user accounts in the database and the aggregate count of Hosts currently online.': 'Affichez les comptes utilisateur de la base de données et le nombre agrégé de Hosts actuellement en ligne.',
    'Read-only account list': 'Liste de comptes en lecture seule',
  },
  de: {
    'Primary navigation': 'Hauptnavigation', Overview: 'Übersicht', Connect: 'Verbinden', Security: 'Sicherheit',
    'Create account': 'Konto erstellen', 'Sign in': 'Anmelden', Username: 'Benutzername', Password: 'Passwort',
    'Email (optional)': 'E-Mail (optional)', 'Welcome back': 'Willkommen zurück', 'Open dashboard': 'Dashboard öffnen',
    'Create your account': 'Konto erstellen', 'Set up your first Host device': 'Erstes Host-Gerät einrichten',
    'Download for Windows': 'Für Windows herunterladen', 'Sign in to platform': 'Bei der Plattform anmelden',
    'Your coding agent.': 'Dein Coding Agent.', 'Any application.': 'Jede Anwendung.',
    'What it does': 'Funktionen', 'Connect your agent': 'Agent verbinden', 'Security boundaries': 'Sicherheitsgrenzen',
    Copy: 'Kopieren', 'Code copied': 'Code kopiert', 'Clipboard unavailable': 'Zwischenablage nicht verfügbar',
    'Account & security': 'Konto und Sicherheit', 'Good evening,': 'Guten Abend,', 'Connection overview': 'Verbindungsübersicht',
    'Check again': 'Erneut prüfen', 'Open Agent Gateway': 'Agent Gateway öffnen', 'Download Windows': 'Windows herunterladen',
    'Status alerts': 'Statushinweise', 'Sign out': 'Abmelden', 'Back home': 'Zur Startseite',
    Users: 'Benutzer', Devices: 'Geräte', Hosts: 'Hosts', 'Audit log': 'Auditprotokoll', Refresh: 'Aktualisieren',
    'Database users': 'Datenbankbenutzer', 'active accounts': 'aktive Konten', 'Hosts online now': 'Derzeit online Hosts',
    'Aggregate count only': 'Nur Gesamtzahl', 'User overview': 'Benutzerübersicht', 'View platform users.': 'Plattformbenutzer anzeigen.',
    'View user accounts in the database and the aggregate count of Hosts currently online.': 'Zeigt Benutzerkonten in der Datenbank und die Gesamtzahl der derzeit online verfügbaren Hosts.',
    'Read-only account list': 'Schreibgeschützte Kontoliste',
  },
  pt: {
    'Primary navigation': 'Navegação principal', Overview: 'Visão geral', Connect: 'Conectar', Security: 'Segurança',
    'Create account': 'Criar conta', 'Sign in': 'Entrar', Username: 'Nome de usuário', Password: 'Senha',
    'Email (optional)': 'E-mail (opcional)', 'Welcome back': 'Boas-vindas', 'Open dashboard': 'Abrir painel',
    'Create your account': 'Crie sua conta', 'Set up your first Host device': 'Configure seu primeiro dispositivo Host',
    'Download for Windows': 'Baixar para Windows', 'Sign in to platform': 'Entrar na plataforma',
    'Your coding agent.': 'Seu agente de código.', 'Any application.': 'Qualquer aplicativo.',
    'What it does': 'Recursos', 'Connect your agent': 'Conecte seu agente', 'Security boundaries': 'Limites de segurança',
    Copy: 'Copiar', 'Code copied': 'Código copiado', 'Clipboard unavailable': 'Área de transferência indisponível',
    'Account & security': 'Conta e segurança', 'Good evening,': 'Boa noite,', 'Connection overview': 'Visão das conexões',
    'Check again': 'Verificar novamente', 'Open Agent Gateway': 'Abrir Agent Gateway', 'Download Windows': 'Baixar Windows',
    'Status alerts': 'Alertas de status', 'Sign out': 'Sair', 'Back home': 'Voltar ao início',
    Users: 'Usuários', Devices: 'Dispositivos', Hosts: 'Hosts', 'Audit log': 'Registro de auditoria', Refresh: 'Atualizar',
    'Database users': 'Usuários do banco de dados', 'active accounts': 'contas ativas', 'Hosts online now': 'Hosts online agora',
    'Aggregate count only': 'Somente contagem agregada', 'User overview': 'Visão geral dos usuários', 'View platform users.': 'Ver usuários da plataforma.',
    'View user accounts in the database and the aggregate count of Hosts currently online.': 'Veja as contas de usuário no banco de dados e a contagem agregada de Hosts atualmente online.',
    'Read-only account list': 'Lista de contas somente leitura',
  },
  tr: {
    'Primary navigation': 'Ana gezinme', Overview: 'Genel bakış', Connect: 'Bağlan', Security: 'Güvenlik',
    'Create account': 'Hesap oluştur', 'Sign in': 'Giriş yap', Username: 'Kullanıcı adı', Password: 'Parola',
    'Email (optional)': 'E-posta (isteğe bağlı)', 'Welcome back': 'Tekrar hoş geldiniz', 'Open dashboard': 'Paneli aç',
    'Create your account': 'Hesabınızı oluşturun', 'Set up your first Host device': 'İlk Host cihazınızı kurun',
    'Download for Windows': 'Windows için indir', 'Sign in to platform': 'Platforma giriş yap',
    'Your coding agent.': 'Coding Agent’ınız.', 'Any application.': 'Her uygulamada.',
    'What it does': 'Özellikler', 'Connect your agent': 'Agent’ınızı bağlayın', 'Security boundaries': 'Güvenlik sınırları',
    Copy: 'Kopyala', 'Code copied': 'Kod kopyalandı', 'Clipboard unavailable': 'Pano kullanılamıyor',
    'Account & security': 'Hesap ve güvenlik', 'Good evening,': 'İyi akşamlar,', 'Connection overview': 'Bağlantı özeti',
    'Check again': 'Yeniden kontrol et', 'Open Agent Gateway': 'Agent Gateway’i aç', 'Download Windows': 'Windows’u indir',
    'Status alerts': 'Durum uyarıları', 'Sign out': 'Çıkış yap', 'Back home': 'Ana sayfaya dön',
    Users: 'Kullanıcılar', Devices: 'Cihazlar', Hosts: 'Hosts', 'Audit log': 'Denetim günlüğü', Refresh: 'Yenile',
    'Database users': 'Veritabanı kullanıcıları', 'active accounts': 'etkin hesap', 'Hosts online now': 'Şu anda çevrimiçi Hostlar',
    'Aggregate count only': 'Yalnızca toplam sayı gösterilir', 'User overview': 'Kullanıcı özeti', 'View platform users.': 'Platform kullanıcılarını görüntüleyin.',
    'View user accounts in the database and the aggregate count of Hosts currently online.': 'Veritabanındaki kullanıcı hesaplarını ve şu anda çevrimiçi olan Hostların toplam sayısını görüntüleyin.',
    'Read-only account list': 'Salt okunur hesap listesi',
  },
}

const COMPLETION_CATALOG: Partial<Record<Language, Record<string, string>>> = {
  ja: {
    Account: 'アカウント', Action: '操作', active: 'アクティブ', 'Admin control': '管理者コントロール',
    'Administrative actions only': '管理操作のみ', Created: '作成日時', Disable: '無効化', disabled: '無効', Enable: '有効化',
    'Effective information': '発効情報', 'Keep the platform under control.': 'プラットフォームを安全に管理。',
    'Minimum Admin Dashboard': '管理者ダッシュボード', 'Ready for Coding Agent requests': 'Coding Agent リクエストを受け付け可能',
    revoked: '失効済み', Role: '役割', Status: '状態', User: 'ユーザー',
    Connected: '接続済み', 'Contact channels': '連絡先', 'Credential separation': '認証情報の分離',
    '6. Credential separation': '6. 認証情報の分離',
    'Credential separation and minimum exposure': '認証情報の分離と最小限の公開',
    Legal: '法的文書', 'Platform Privacy Notice': 'プラットフォーム・プライバシー通知',
    'Platform Terms': 'プラットフォーム利用規約', Privacy: 'プライバシー',
    'Privacy Notice': 'プライバシー通知', 'Read the Platform Privacy Notice': 'プラットフォーム・プライバシー通知を読む',
    'Read the Platform Terms': 'プラットフォーム利用規約を読む', 'Security baseline': 'セキュリティ基準',
    'Session active': 'セッション有効', Terms: '利用規約',
  },
  ko: {
    Connected: '연결됨', 'Contact channels': '연락처', 'Credential separation': '인증 정보 분리',
    '6. Credential separation': '6. 인증 정보 분리',
    'Credential separation and minimum exposure': '인증 정보 분리 및 최소 노출',
    Legal: '법적 문서', 'Platform Privacy Notice': '플랫폼 개인정보 처리방침',
    'Platform Terms': '플랫폼 이용약관', Privacy: '개인정보 보호', 'Privacy Notice': '개인정보 처리방침',
    'Read the Platform Privacy Notice': '플랫폼 개인정보 처리방침 읽기', 'Read the Platform Terms': '플랫폼 이용약관 읽기',
    'Security baseline': '보안 기준', 'Session active': '세션 활성', Terms: '이용약관',
  },
  es: {
    'Call standard endpoints': 'Llamar a endpoints estándar', 'Coding Agent': 'Agente de código', 'Host online': 'Host en línea',
    Connected: 'Conectado', 'Credential separation': 'Separación de credenciales',
    '6. Credential separation': '6. Separación de credenciales', Legal: 'Documentos legales',
    Latency: 'Latencia', 'Live Host': 'Host en vivo', 'Local-first': 'Prioridad local', Loopback: 'Bucle local',
    'MIT licensed': 'Licencia MIT', 'OpenAI compatible': 'Compatible con OpenAI', 'OpenAI-compatible Host': 'Host compatible con OpenAI',
    'Per key': 'Por clave', 'Platform Relay': 'Relay de plataforma', 'Public Relay': 'Relay público',
    'RELAY DEPLOYMENT REQUIRED': 'SE REQUIERE DESPLEGAR EL RELAY', 'Relay pending': 'Relay pendiente',
    'The action completed and was written to the audit log.': 'La acción se completó y se registró en el historial de auditoría.',
    'Windows Portable': 'Windows portátil', 'Windows installer': 'Instalador de Windows',
  },
  fr: {
    'Credential separation': 'Séparation des identifiants', '6. Credential separation': '6. Séparation des identifiants',
    Legal: 'Documents juridiques', Loopback: 'Boucle locale', 'V3 Source': 'Source V3', 'Windows Portable': 'Windows portable',
  },
  de: {
    'Credential separation': 'Trennung der Zugangsdaten', '6. Credential separation': '6. Trennung der Zugangsdaten',
    'Credential separation and minimum exposure': 'Trennung der Zugangsdaten und minimale Offenlegung', Legal: 'Rechtliche Dokumente',
    Download: 'Herunterladen', 'Download Windows': 'Windows herunterladen', Downloads: 'Downloads', 'Host online': 'Host online',
    'Live Host': 'Live-Host', Loopback: 'Loopback-Adresse', 'OPENAI SDK READY': 'OPENAI SDK BEREIT', Offline: 'Offline', Online: 'Online',
    'Open Agent Gateway': 'Agent Gateway öffnen', 'SSE streaming': 'SSE-Streaming', 'Windows Portable': 'Windows Portable',
    'Windows installer': 'Windows-Installationsprogramm', 'open source': 'Open Source',
  },
  tr: {
    '5. Data processed': '5. İşlenen veriler', 'Admin control': 'Yönetici kontrolü', 'Back to platform': 'Platforma dön',
    Cancel: 'İptal', Checking: 'Kontrol ediliyor', 'Close sign-in dialog': 'Oturum açma penceresini kapat',
    'Codex runtime': 'Codex çalışma zamanı', 'Coding Agent': 'Kodlama Agentı', Connect: 'Bağlan', Connected: 'Bağlandı',
    'Contact channels': 'İletişim kanalları', 'Credential separation': 'Kimlik bilgilerinin ayrılması',
    '6. Credential separation': '6. Kimlik bilgilerinin ayrılması',
    'Credential separation and minimum exposure': 'Kimlik bilgilerinin ayrılması ve en az düzeyde açığa çıkarılması',
    'Create account': 'Hesap oluştur', 'Data processed': 'İşlenen veriler', Device: 'Cihaz', Download: 'İndir', Downloads: 'İndirilenler',
    Enable: 'Etkinleştir', 'Enable API Host': 'API Hostunu etkinleştir', 'Enable Online Host': 'Online Hostu etkinleştir', Future: 'Gelecek',
    'Host online': 'Host çevrimiçi', Latency: 'Gecikme', Loopback: 'Geri döngü', 'Minimum Admin Dashboard': 'Minimum Yönetici Paneli',
    Model: 'Model', Observability: 'Gözlemlenebilirlik', Offline: 'Çevrimdışı', Online: 'Çevrimiçi', 'Online Hosts': 'Çevrimiçi Hostlar',
    'Open Agent Gateway': 'Agent Gateway’i aç', 'Open dashboard': 'Paneli aç', 'OpenAI-compatible Host': 'OpenAI uyumlu Host',
    Pending: 'Bekliyor', 'Per key': 'Anahtar başına', Platform: 'Platform', 'Platform overview': 'Platform özeti', Public: 'Genel',
    'Public Relay': 'Genel Relay', 'RELAY DEPLOYMENT REQUIRED': 'RELAY DAĞITIMI GEREKLİ',
    'Repository, support and deletion requests': 'Depo, destek ve silme talepleri', Revoke: 'İptal et', Revoked: 'İptal edildi',
    revoked: 'iptal edildi', 'SSE streaming': 'SSE akışı', 'Sign out': 'Çıkış yap', 'Source access': 'Kaynak erişimi',
    Legal: 'Yasal belgeler', 'Platform Privacy Notice': 'Platform Gizlilik Bildirimi', 'Platform Terms': 'Platform Koşulları',
    Privacy: 'Gizlilik', 'Privacy Notice': 'Gizlilik Bildirimi', 'Security baseline': 'Güvenlik temeli',
    'Session active': 'Oturum etkin', Terms: 'Koşullar',
    'User dashboard': 'Kullanıcı paneli', Username: 'Kullanıcı adı', 'V3 Source': 'V3 Kaynağı', Version: 'Sürüm',
    'Windows Portable': 'Taşınabilir Windows', 'Windows installer': 'Windows yükleyicisi',
  },
}

export function normalizeLanguage(value: string | null | undefined): Language | null {
  if (!value) return null
  const code = value.toLowerCase().split(/[-_]/)[0] as Language
  return LANGUAGES.some((language) => language.code === code) ? code : null
}

export function preferredLanguage(): Language {
  return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY))
    ?? normalizeLanguage(window.navigator.language)
    ?? 'en'
}

export function languageLocale(language: Language): string {
  return LANGUAGES.find((item) => item.code === language)?.locale ?? 'en-US'
}

export function translate(language: Language, chinese: string, english: string): string {
  if (language === 'zh') return chinese
  if (language === 'en') return english
  return CATALOG[language]?.[english] ?? COMPLETION_CATALOG[language]?.[english] ?? GENERATED_CATALOG[language]?.[english] ?? english
}

export function hasTranslation(language: Exclude<Language, 'zh' | 'en'>, english: string): boolean {
  return Object.prototype.hasOwnProperty.call(CATALOG[language] ?? {}, english)
    || Object.prototype.hasOwnProperty.call(COMPLETION_CATALOG[language] ?? {}, english)
    || Object.prototype.hasOwnProperty.call(GENERATED_CATALOG[language] ?? {}, english)
}

export { REQUIRED_TRANSLATION_KEYS }

export function useLanguage(initialLanguage?: Language): [Language, (language: Language) => void] {
  const [language, updateLanguage] = useState<Language>(() => initialLanguage ?? preferredLanguage())

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    document.documentElement.lang = languageLocale(language)
  }, [language])

  return [language, updateLanguage]
}

export function LanguageSelect({ language, onChange, className = '' }: { language: Language; onChange: (language: Language) => void; className?: string }) {
  const label = translate(language, '选择语言', 'Choose language')
  return <label className={`locale-select ${className}`.trim()} title={label}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
    <select aria-label={label} value={language} onChange={(event) => onChange(event.target.value as Language)}>
      {LANGUAGES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
    </select>
    <span aria-hidden="true">⌄</span>
  </label>
}
