"use strict";

(() => {
  const languages = Object.freeze([
    { code: "zh", label: "简体中文", short: "中", locale: "zh-CN" },
    { code: "en", label: "English", short: "EN", locale: "en-US" },
    { code: "ja", label: "日本語", short: "日", locale: "ja-JP" },
    { code: "ko", label: "한국어", short: "한", locale: "ko-KR" },
    { code: "es", label: "Español", short: "ES", locale: "es-ES" },
    { code: "fr", label: "Français", short: "FR", locale: "fr-FR" },
    { code: "de", label: "Deutsch", short: "DE", locale: "de-DE" },
    { code: "pt", label: "Português", short: "PT", locale: "pt-BR" },
    { code: "tr", label: "Türkçe", short: "TR", locale: "tr-TR" },
  ]);

  const catalog = Object.freeze({
    ja: Object.freeze({
      "Recent calls": "最近の呼び出し", "Not signed in": "未ログイン", "Sign in to enable Online Host": "Online Host を有効にするにはログイン",
      "Codex API Console": "Codex API コンソール", "Create keys, call Codex, and track usage": "キー作成、Codex 呼び出し、使用量追跡", Connecting: "接続中", Local: "ローカル",
      "API Gateway Monitor": "API Gateway モニター", "Host enabled": "Host 有効", "Disable Host": "Host を無効化", "API Test Bench": "API テストベンチ",
      Running: "実行中", "Active connections": "アクティブ接続", "Cumulative calls": "累計呼び出し", "Success rate": "成功率", "Average latency": "平均待ち時間",
      "API call history": "API 呼び出し履歴", Monitor: "監視", Refresh: "更新", "Waiting for API calls": "API 呼び出しを待機中", Model: "モデル", Permission: "権限",
      "Latest call": "最終呼び出し", "Latest status": "最新状態", "Manage API keys": "API キーを管理", "Codex environment": "Codex 実行環境", Checking: "確認中", "Check again": "再確認",
      "Model API keys": "モデル API キー", "Advanced settings": "詳細設定", "Refresh keys": "キーを更新", "Create access key": "アクセスキーを作成", "Key name": "キー名",
      "File permissions": "ファイル権限", "Read only": "読み取り専用", "Project only": "プロジェクトのみ", Copy: "コピー", Hide: "隠す", "Created keys": "作成済みキー",
      "Codex Usage": "Codex 使用量", "Refresh statistics": "統計を更新", "Total tokens": "総 Token", "Total tasks": "総タスク", "Input tokens": "入力 Token", "Output tokens": "出力 Token",
      "What should Codex do?": "Codex に何をさせますか？", "Add images": "画像を追加", "Add files": "添付を追加", "Working directory": "作業ディレクトリ",
      "Choose folder": "フォルダーを選択", "Run status": "実行状態", "Waiting for a task": "タスク待機中", Settings: "設定", "Platform account": "プラットフォームアカウント",
      "Continue to Platform": "ブラウザーでログイン", "Sign out": "ログアウト", "Choose language": "言語を選択",
    }),
    ko: Object.freeze({
      "Recent calls": "최근 호출", "Not signed in": "로그인하지 않음", "Sign in to enable Online Host": "Online Host를 사용하려면 로그인",
      "Codex API Console": "Codex API 콘솔", "Create keys, call Codex, and track usage": "키 생성, Codex 호출 및 사용량 추적", Connecting: "연결 중", Local: "로컬",
      "API Gateway Monitor": "API Gateway 모니터", "Host enabled": "Host 켜짐", "Disable Host": "Host 끄기", "API Test Bench": "API 테스트 도구",
      Running: "실행 중", "Active connections": "활성 연결", "Cumulative calls": "누적 호출", "Success rate": "성공률", "Average latency": "평균 지연",
      "API call history": "API 호출 기록", Monitor: "모니터", Refresh: "새로고침", "Waiting for API calls": "API 호출 대기 중", Model: "모델", Permission: "권한",
      "Latest call": "마지막 호출", "Latest status": "최근 상태", "Manage API keys": "API 키 관리", "Codex environment": "Codex 실행 환경", Checking: "확인 중", "Check again": "다시 확인",
      "Model API keys": "모델 API 키", "Advanced settings": "고급 설정", "Refresh keys": "키 새로고침", "Create access key": "액세스 키 만들기", "Key name": "키 이름",
      "File permissions": "파일 권한", "Read only": "읽기 전용", "Project only": "프로젝트만", Copy: "복사", Hide: "숨기기", "Created keys": "생성된 키",
      "Codex Usage": "Codex 사용량", "Refresh statistics": "통계 새로고침", "Total tokens": "전체 Token", "Total tasks": "전체 작업", "Input tokens": "입력 Token", "Output tokens": "출력 Token",
      "What should Codex do?": "Codex가 무엇을 수행할까요?", "Add images": "이미지 추가", "Add files": "파일 추가", "Working directory": "작업 디렉터리", "Choose folder": "폴더 선택",
      "Run status": "실행 상태", "Waiting for a task": "작업 대기 중", Settings: "설정", "Platform account": "플랫폼 계정", "Continue to Platform": "브라우저로 로그인", "Sign out": "로그아웃", "Choose language": "언어 선택",
    }),
    es: Object.freeze({
      "Recent calls": "Llamadas recientes", "Not signed in": "Sin iniciar sesión", "Sign in to enable Online Host": "Inicia sesión para activar Online Host",
      "Codex API Console": "Consola de API de Codex", "Create keys, call Codex, and track usage": "Crea claves, llama a Codex y controla el uso", Connecting: "Conectando", Local: "Local",
      "API Gateway Monitor": "Monitor de API Gateway", "Host enabled": "Host activado", "Disable Host": "Desactivar Host", "API Test Bench": "Banco de pruebas API",
      Running: "En ejecución", "Active connections": "Conexiones activas", "Cumulative calls": "Llamadas acumuladas", "Success rate": "Tasa de éxito", "Average latency": "Latencia media",
      "API call history": "Historial de llamadas API", Monitor: "Supervisar", Refresh: "Actualizar", "Waiting for API calls": "Esperando llamadas API", Model: "Modelo", Permission: "Permiso",
      "Latest call": "Última llamada", "Latest status": "Estado reciente", "Manage API keys": "Gestionar claves API", "Codex environment": "Entorno de Codex", Checking: "Comprobando", "Check again": "Comprobar de nuevo",
      "Model API keys": "Claves API del modelo", "Advanced settings": "Opciones avanzadas", "Refresh keys": "Actualizar claves", "Create access key": "Crear clave de acceso", "Key name": "Nombre de clave",
      "File permissions": "Permisos de archivos", "Read only": "Solo lectura", "Project only": "Solo proyecto", Copy: "Copiar", Hide: "Ocultar", "Created keys": "Claves creadas",
      "Codex Usage": "Uso de Codex", "Refresh statistics": "Actualizar estadísticas", "Total tokens": "Tokens totales", "Total tasks": "Tareas totales", "Input tokens": "Tokens de entrada", "Output tokens": "Tokens de salida",
      "What should Codex do?": "¿Qué debe hacer Codex?", "Add images": "Añadir imágenes", "Add files": "Añadir archivos", "Working directory": "Directorio de trabajo", "Choose folder": "Elegir carpeta",
      "Run status": "Estado de ejecución", "Waiting for a task": "Esperando una tarea", Settings: "Ajustes", "Platform account": "Cuenta de plataforma", "Continue to Platform": "Entrar con el navegador", "Sign out": "Cerrar sesión", "Choose language": "Elegir idioma",
    }),
    fr: Object.freeze({
      "Recent calls": "Appels récents", "Not signed in": "Non connecté", "Sign in to enable Online Host": "Connectez-vous pour activer Online Host",
      "Codex API Console": "Console API Codex", "Create keys, call Codex, and track usage": "Créez des clés, appelez Codex et suivez l’utilisation", Connecting: "Connexion", Local: "Local",
      "API Gateway Monitor": "Moniteur API Gateway", "Host enabled": "Host activé", "Disable Host": "Désactiver le Host", "API Test Bench": "Banc de test API",
      Running: "En cours", "Active connections": "Connexions actives", "Cumulative calls": "Appels cumulés", "Success rate": "Taux de réussite", "Average latency": "Latence moyenne",
      "API call history": "Historique des appels API", Monitor: "Surveiller", Refresh: "Actualiser", "Waiting for API calls": "En attente d’appels API", Model: "Modèle", Permission: "Autorisation",
      "Latest call": "Dernier appel", "Latest status": "Dernier état", "Manage API keys": "Gérer les clés API", "Codex environment": "Environnement Codex", Checking: "Vérification", "Check again": "Vérifier à nouveau",
      "Model API keys": "Clés API du modèle", "Advanced settings": "Paramètres avancés", "Refresh keys": "Actualiser les clés", "Create access key": "Créer une clé d’accès", "Key name": "Nom de la clé",
      "File permissions": "Autorisations de fichiers", "Read only": "Lecture seule", "Project only": "Projet uniquement", Copy: "Copier", Hide: "Masquer", "Created keys": "Clés créées",
      "Codex Usage": "Utilisation de Codex", "Refresh statistics": "Actualiser les statistiques", "Total tokens": "Total des tokens", "Total tasks": "Total des tâches", "Input tokens": "Tokens d’entrée", "Output tokens": "Tokens de sortie",
      "What should Codex do?": "Que doit accomplir Codex ?", "Add images": "Ajouter des images", "Add files": "Ajouter des fichiers", "Working directory": "Dossier de travail", "Choose folder": "Choisir un dossier",
      "Run status": "État d’exécution", "Waiting for a task": "En attente d’une tâche", Settings: "Paramètres", "Platform account": "Compte plateforme", "Continue to Platform": "Se connecter avec le navigateur", "Sign out": "Se déconnecter", "Choose language": "Choisir la langue",
    }),
    de: Object.freeze({
      "Recent calls": "Letzte Aufrufe", "Not signed in": "Nicht angemeldet", "Sign in to enable Online Host": "Zum Aktivieren von Online Host anmelden",
      "Codex API Console": "Codex-API-Konsole", "Create keys, call Codex, and track usage": "Schlüssel erstellen, Codex aufrufen und Nutzung verfolgen", Connecting: "Verbindung wird hergestellt", Local: "Lokal",
      "API Gateway Monitor": "API-Gateway-Monitor", "Host enabled": "Host aktiviert", "Disable Host": "Host deaktivieren", "API Test Bench": "API-Testumgebung",
      Running: "Läuft", "Active connections": "Aktive Verbindungen", "Cumulative calls": "Aufrufe gesamt", "Success rate": "Erfolgsrate", "Average latency": "Mittlere Latenz",
      "API call history": "API-Aufrufverlauf", Monitor: "Überwachen", Refresh: "Aktualisieren", "Waiting for API calls": "Warten auf API-Aufrufe", Model: "Modell", Permission: "Berechtigung",
      "Latest call": "Letzter Aufruf", "Latest status": "Letzter Status", "Manage API keys": "API-Schlüssel verwalten", "Codex environment": "Codex-Umgebung", Checking: "Wird geprüft", "Check again": "Erneut prüfen",
      "Model API keys": "Modell-API-Schlüssel", "Advanced settings": "Erweiterte Einstellungen", "Refresh keys": "Schlüssel aktualisieren", "Create access key": "Zugriffsschlüssel erstellen", "Key name": "Schlüsselname",
      "File permissions": "Dateiberechtigungen", "Read only": "Nur Lesen", "Project only": "Nur Projekt", Copy: "Kopieren", Hide: "Ausblenden", "Created keys": "Erstellte Schlüssel",
      "Codex Usage": "Codex-Nutzung", "Refresh statistics": "Statistik aktualisieren", "Total tokens": "Token gesamt", "Total tasks": "Aufgaben gesamt", "Input tokens": "Eingabe-Token", "Output tokens": "Ausgabe-Token",
      "What should Codex do?": "Was soll Codex erledigen?", "Add images": "Bilder hinzufügen", "Add files": "Dateien hinzufügen", "Working directory": "Arbeitsverzeichnis", "Choose folder": "Ordner auswählen",
      "Run status": "Ausführungsstatus", "Waiting for a task": "Warten auf eine Aufgabe", Settings: "Einstellungen", "Platform account": "Plattformkonto", "Continue to Platform": "Im Browser anmelden", "Sign out": "Abmelden", "Choose language": "Sprache auswählen",
    }),
    pt: Object.freeze({
      "Recent calls": "Chamadas recentes", "Not signed in": "Não conectado", "Sign in to enable Online Host": "Entre para ativar o Online Host",
      "Codex API Console": "Console da API Codex", "Create keys, call Codex, and track usage": "Crie chaves, chame o Codex e acompanhe o uso", Connecting: "Conectando", Local: "Local",
      "API Gateway Monitor": "Monitor do API Gateway", "Host enabled": "Host ativado", "Disable Host": "Desativar Host", "API Test Bench": "Bancada de teste da API",
      Running: "Em execução", "Active connections": "Conexões ativas", "Cumulative calls": "Chamadas acumuladas", "Success rate": "Taxa de sucesso", "Average latency": "Latência média",
      "API call history": "Histórico de chamadas da API", Monitor: "Monitorar", Refresh: "Atualizar", "Waiting for API calls": "Aguardando chamadas da API", Model: "Modelo", Permission: "Permissão",
      "Latest call": "Última chamada", "Latest status": "Status recente", "Manage API keys": "Gerenciar chaves API", "Codex environment": "Ambiente Codex", Checking: "Verificando", "Check again": "Verificar novamente",
      "Model API keys": "Chaves API do modelo", "Advanced settings": "Configurações avançadas", "Refresh keys": "Atualizar chaves", "Create access key": "Criar chave de acesso", "Key name": "Nome da chave",
      "File permissions": "Permissões de arquivo", "Read only": "Somente leitura", "Project only": "Somente projeto", Copy: "Copiar", Hide: "Ocultar", "Created keys": "Chaves criadas",
      "Codex Usage": "Uso do Codex", "Refresh statistics": "Atualizar estatísticas", "Total tokens": "Total de tokens", "Total tasks": "Total de tarefas", "Input tokens": "Tokens de entrada", "Output tokens": "Tokens de saída",
      "What should Codex do?": "O que o Codex deve fazer?", "Add images": "Adicionar imagens", "Add files": "Adicionar arquivos", "Working directory": "Diretório de trabalho", "Choose folder": "Escolher pasta",
      "Run status": "Status da execução", "Waiting for a task": "Aguardando uma tarefa", Settings: "Configurações", "Platform account": "Conta da plataforma", "Continue to Platform": "Entrar pelo navegador", "Sign out": "Sair", "Choose language": "Escolher idioma",
    }),
    tr: Object.freeze({
      "Recent calls": "Son çağrılar", "Not signed in": "Oturum açılmadı", "Sign in to enable Online Host": "Online Host’u etkinleştirmek için giriş yapın",
      "Codex API Console": "Codex API Konsolu", "Create keys, call Codex, and track usage": "Anahtar oluşturun, Codex’i çağırın ve kullanımı izleyin", Connecting: "Bağlanıyor", Local: "Yerel",
      "API Gateway Monitor": "API Gateway izleyicisi", "Host enabled": "Host etkin", "Disable Host": "Host’u kapat", "API Test Bench": "API test tezgâhı",
      Running: "Çalışıyor", "Active connections": "Etkin bağlantılar", "Cumulative calls": "Toplam çağrı", "Success rate": "Başarı oranı", "Average latency": "Ortalama gecikme",
      "API call history": "API çağrı geçmişi", Monitor: "İzle", Refresh: "Yenile", "Waiting for API calls": "API çağrıları bekleniyor", Model: "Model", Permission: "İzin",
      "Latest call": "Son çağrı", "Latest status": "Son durum", "Manage API keys": "API anahtarlarını yönet", "Codex environment": "Codex ortamı", Checking: "Kontrol ediliyor", "Check again": "Yeniden kontrol et",
      "Model API keys": "Model API anahtarları", "Advanced settings": "Gelişmiş ayarlar", "Refresh keys": "Anahtarları yenile", "Create access key": "Erişim anahtarı oluştur", "Key name": "Anahtar adı",
      "File permissions": "Dosya izinleri", "Read only": "Salt okunur", "Project only": "Yalnızca proje", Copy: "Kopyala", Hide: "Gizle", "Created keys": "Oluşturulan anahtarlar",
      "Codex Usage": "Codex kullanımı", "Refresh statistics": "İstatistikleri yenile", "Total tokens": "Toplam Token", "Total tasks": "Toplam görev", "Input tokens": "Girdi Token", "Output tokens": "Çıktı Token",
      "What should Codex do?": "Codex ne yapsın?", "Add images": "Görsel ekle", "Add files": "Dosya ekle", "Working directory": "Çalışma dizini", "Choose folder": "Klasör seç",
      "Run status": "Çalışma durumu", "Waiting for a task": "Görev bekleniyor", Settings: "Ayarlar", "Platform account": "Platform hesabı", "Continue to Platform": "Tarayıcıyla giriş yap", "Sign out": "Çıkış yap", "Choose language": "Dil seçin",
    }),
  });
  const completionCatalog = Object.freeze({
    es: Object.freeze({
      "API GATEWAY MONITOR": "MONITOR DE API GATEWAY", "API KEY CONTROL": "CONTROL DE CLAVES API", "Auto-scroll": "Desplazamiento automático",
      "CODEX CONFIGURATION": "CONFIGURACIÓN DE CODEX", "CREATE TASK": "CREAR TAREA", "Check Public Host": "Comprobar Host público",
      "Check online": "Comprobar conexión", "Coding Agent": "Agente de código", DELIVERABLE: "ENTREGABLE", "DEVELOPER ACCESS": "ACCESO PARA DESARROLLADORES",
      "DEVELOPER TOOL": "HERRAMIENTA DE DESARROLLO", "EVENT STREAM": "FLUJO DE EVENTOS", Email: "Correo electrónico", "Enable Host": "Activar Host",
      "Environment ready": "Entorno listo", "Failed to cancel task": "No se pudo cancelar la tarea", "Failed to change Host status.": "No se pudo cambiar el estado del Host.",
      "Go online": "Conectarse", "Hashes only": "Solo hashes", LIVE: "EN VIVO", "LIVE STATUS": "ESTADO EN VIVO", "Local Host": "Host local",
      Minimal: "Mínimo", "Model API Keys": "Claves API del modelo", "ONLINE HOST": "HOST EN LÍNEA", "PLATFORM ACCOUNT": "CUENTA DE PLATAFORMA",
      "Public Host": "Host público", "Public Host online": "Host público en línea", "Public offline": "Servicio público sin conexión", Queued: "En cola",
      "Reasoning tokens": "Tokens de razonamiento", "Reconnecting event stream": "Reconectando el flujo de eventos", Reset: "Restablecer",
      "Run log": "Registro de ejecución", SETTINGS: "AJUSTES", STREAM: "FLUJO", "USAGE DASHBOARD": "PANEL DE USO",
      "View Public Host": "Ver Host público", "Xhigh effort": "Esfuerzo máximo"
    }),
    fr: Object.freeze({ "Codex live logs": "Journaux Codex en direct", STREAM: "FLUX" }),
    de: Object.freeze({
      "API GATEWAY MONITOR": "API-GATEWAY-MONITOR", "API advanced settings": "Erweiterte API-Einstellungen", "Auto-scroll": "Automatisch scrollen",
      "Close API Test Bench": "API-Testumgebung schließen", "Close API advanced settings": "Erweiterte API-Einstellungen schließen",
      "Close task history": "Aufgabenverlauf schließen", "Codex desktop app": "Codex-Desktop-App", "Fixed API port": "Fester API-Port",
      "Local-first:": "Lokal zuerst:", "Open task history": "Aufgabenverlauf öffnen", "Service offline": "Dienst offline", "Tool call": "Werkzeugaufruf"
    }),
    pt: Object.freeze({ STREAM: "FLUXO" }),
    tr: Object.freeze({
      "API GATEWAY MONITOR": "API GATEWAY İZLEYİCİSİ", "API KEY CONTROL": "API ANAHTARI KONTROLÜ", "Auto-scroll": "Otomatik kaydırma",
      "Monitor Codex calls, connections, status, latency, and tokens from other applications, filtered by API key.": "Diğer uygulamalardan gelen Codex çağrılarını, bağlantıları, durumu, gecikmeyi ve token kullanımını API anahtarına göre izleyin.",
      "Public Host checks are available only in the desktop app.": "Public Host denetimleri yalnızca masaüstü uygulamasında kullanılabilir.",
      "Live API Gateway metrics": "Canlı API Gateway ölçümleri", "External API tasks": "Harici API görevleri", "SELECTED API": "SEÇİLİ API",
      "Requests appear here after another application uses a Gateway key.": "Başka bir uygulama Gateway anahtarı kullandığında istekler burada görünür.",
      "Aggregates calls from external applications and excludes local API Test Bench tasks.": "Harici uygulamalardan gelen çağrıları toplar ve yerel API Test Bench görevlerini hariç tutar.",
      "Multiple models": "Birden çok model", "Configured per key": "Anahtar başına yapılandırılır", "None yet": "Henüz yok", "Waiting for calls": "Çağrı bekleniyor",
      "SYSTEM READINESS": "SİSTEM HAZIRLIĞI", "Automatically checks local components and login status. The default check never calls a model or consumes tokens.": "Yerel bileşenleri ve oturum durumunu otomatik olarak denetler. Varsayılan denetim modeli çağırmaz ve token tüketmez.",
      "Bundled Codex runtime": "Paketlenmiş Codex çalışma zamanı", "USAGE DASHBOARD": "KULLANIM PANELİ", "Share online": "Çevrimiçi paylaş",
      "Cached tokens": "Önbelleğe alınmış tokenlar", "Reasoning tokens": "Akıl yürütme tokenları", "Token breakdown": "Token dağılımı",
      "CREATE TASK": "GÖREV OLUŞTUR", Cancel: "İptal", "Cancel task": "Görevi iptal et", Cancelled: "İptal edildi", Cancelling: "İptal ediliyor",
      "Check Public Host": "Genel Hostu kontrol et", "Close API Test Bench": "API Test Panelini kapat", "Codex account": "Codex hesabı",
      "Codex runtime configuration": "Codex çalışma zamanı yapılandırması", "Coding Agent": "Kodlama Agentı", "Create account": "Hesap oluştur",
      "Cumulative tokens": "Toplam token", DELIVERABLE: "TESLİM", "DEVELOPER ACCESS": "GELİŞTİRİCİ ERİŞİMİ", "DEVELOPER TOOL": "GELİŞTİRİCİ ARACI",
      Dark: "Koyu", "Deleted key": "Silinen anahtar", "Deletion time": "Silinme zamanı", "EVENT STREAM": "OLAY AKIŞI",
      "Enable Host": "Hostu etkinleştir", "Enable Online Host": "Online Hostu etkinleştir", Event: "Olay", "Free public Host": "Ücretsiz genel Host",
      LIVE: "CANLI", "LIVE REQUESTS": "CANLI İSTEKLER", "LIVE STATUS": "CANLI DURUM", Minimal: "Asgari", "Model API Keys": "Model API anahtarları",
      "ONLINE HOST": "ÇEVRİMİÇİ HOST", "Online Host": "Çevrimiçi Host", "Open Platform": "Platformu aç", "PLATFORM ACCOUNT": "PLATFORM HESABI",
      Project: "Proje", "Project workspace": "Proje çalışma alanı", "Public Host": "Genel Host", "Public Host online": "Genel Host çevrimiçi",
      Queued: "Sırada", "Reconnecting event stream": "Olay akışına yeniden bağlanılıyor", Reset: "Sıfırla", Run: "Çalıştır", STREAM: "AKIŞ",
      "Save settings": "Ayarları kaydet", "Sign in or create an account": "Oturum açın veya hesap oluşturun", "Tool call": "Araç çağrısı",
      "Tool call completed": "Araç çağrısı tamamlandı", "Turn off public Host": "Genel Hostu kapat", "Unnamed key": "Adsız anahtar",
      "View Public Host": "Genel Hostu görüntüle", "View new version": "Yeni sürümü görüntüle", "Working directory mode": "Çalışma dizini modu"
    })
  });
  const generatedCatalog = window.AGENT_GATEWAY_GENERATED_TRANSLATIONS || Object.freeze({});
  const requiredTranslations = window.AGENT_GATEWAY_REQUIRED_TRANSLATIONS || Object.freeze([]);
  const generatedPatternCatalog = window.AGENT_GATEWAY_PATTERN_TRANSLATIONS || Object.freeze({});
  const patternCompletion = Object.freeze({
    es: Object.freeze({ "Token limit {0} / {1}": "Límite de tokens {0} / {1}", "{0} days ago": "hace {0} días", "{0} logs": "{0} registros" }),
    de: Object.freeze({ "Token limit {0} / {1}": "Token-Limit {0} / {1}", "Tool call · {0}": "Werkzeugaufruf · {0}" }),
    tr: Object.freeze({
      "Accumulating since {0}": "{0} tarihinden beri birikiyor", "Checked {0}": "{0} tarihinde kontrol edildi",
      "Combined file size cannot exceed {0}.": "Toplam dosya boyutu {0} değerini aşamaz.", "Current setting: Deletes {0}": "Geçerli ayar: {0} tarihinde silinir",
      "Deletes {0}": "{0} tarihinde silinir", "Host disabled; cancelled {0} external tasks and disconnected {1} clients.": "Host devre dışı bırakıldı; {0} harici görev iptal edildi ve {1} istemcinin bağlantısı kesildi.",
      "Remove file: {0}": "Dosyayı kaldır: {0}", "Remove image: {0}": "Görseli kaldır: {0}", "Request failed (HTTP {0})": "İstek başarısız (HTTP {0})",
      "Step {0}": "Adım {0}", "Task {0} created · Project workspace": "Görev {0} oluşturuldu · Proje çalışma alanı",
      "Task {0} created · Temporary projectless workspace": "Görev {0} oluşturuldu · Geçici projesiz çalışma alanı",
      "The file is too large. Maximum per file: {0}.": "Dosya çok büyük. Dosya başına en fazla: {0}.",
      "The file limit has been reached. Maximum {0} per task.": "Dosya sınırına ulaşıldı. Görev başına en fazla {0}.",
      "The image is too large. Maximum per image: {0}.": "Görsel çok büyük. Görsel başına en fazla: {0}.",
      "The image limit has been reached. Maximum {0} per task.": "Görsel sınırına ulaşıldı. Görev başına en fazla {0}.",
      "Tool call · {0}": "Araç çağrısı · {0}", "Uploading task file {0} / {1} · {2}": "Görev dosyası yükleniyor {0} / {1} · {2}",
      "Uploading task image {0} / {1} · {2}": "Görev görseli yükleniyor {0} / {1} · {2}", "Version {0}": "Sürüm {0}", "Version {0} · {1}": "Sürüm {0} · {1}",
      "{0} active · {1} created": "{0} etkin · {1} oluşturuldu", "{0} completed": "{0} tamamlandı",
      "{0} cumulative calls · {1} tokens": "{0} toplam çağrı · {1} token", "{0} cumulative tasks": "{0} toplam görev",
      "{0} days ago": "{0} gün önce", "{0} hr ago": "{0} saat önce", "{0} keys": "{0} anahtar", "{0} logs": "{0} günlük kaydı",
      "{0} min ago": "{0} dk önce", "{0} running": "{0} çalışıyor", "{0} tasks include token data": "{0} görev token verisi içeriyor",
      "{0} · Calculating tokens": "{0} · Tokenlar hesaplanıyor", "{0} · Host disabled": "{0} · Host devre dışı",
      "{0} · {1} cumulative calls": "{0} · {1} toplam çağrı", "{0} · {1} · No project": "{0} · {1} · Proje yok", "{0} · {1} · Project": "{0} · {1} · Proje"
    })
  });
  const patternCatalog = Object.freeze(Object.fromEntries(
    Object.keys(generatedPatternCatalog).map((code) => [code, Object.freeze({ ...(generatedPatternCatalog[code] || {}), ...(patternCompletion[code] || {}) })]),
  ));
  const dynamicPatterns = Object.keys(patternCatalog.ja || {}).map((template) => {
    const groupIndexes = [];
    let source = "^";
    let cursor = 0;
    for (const match of template.matchAll(/\{(\d+)\}/g)) {
      source += template.slice(cursor, match.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      source += "([\\s\\S]*?)";
      groupIndexes.push(Number(match[1]));
      cursor = match.index + match[0].length;
    }
    source += template.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
    return { template, expression: new RegExp(source), groupIndexes, literalLength: template.replace(/\{\d+\}/g, "").length };
  }).sort((left, right) => right.literalLength - left.literalLength);

  function normalize(value) {
    const code = String(value || "").toLowerCase().split(/[-_]/)[0];
    return languages.some((language) => language.code === code) ? code : null;
  }

  function locale(code) {
    return languages.find((language) => language.code === code)?.locale || "en-US";
  }

  function translate(source, code, englishFallback) {
    if (code === "zh") return source;
    if (code === "en") return englishFallback;
    return catalog[code]?.[englishFallback] || completionCatalog[code]?.[englishFallback] || generatedCatalog[code]?.[englishFallback] || englishFallback;
  }

  function hasTranslation(code, english) {
    return Object.prototype.hasOwnProperty.call(catalog[code] || {}, english)
      || Object.prototype.hasOwnProperty.call(completionCatalog[code] || {}, english)
      || Object.prototype.hasOwnProperty.call(generatedCatalog[code] || {}, english);
  }

  function translateDynamic(english, code) {
    if (code === "zh" || code === "en") return english;
    for (const pattern of dynamicPatterns) {
      const match = String(english).match(pattern.expression);
      if (!match) continue;
      const values = [];
      pattern.groupIndexes.forEach((index, group) => { values[index] = match[group + 1]; });
      const target = patternCatalog[code]?.[pattern.template];
      if (!target) return null;
      return target.replace(/\{(\d+)\}/g, (_, index) => {
        const value = values[Number(index)] ?? "";
        return translate(value, code, value);
      });
    }
    return null;
  }

  window.AGENT_GATEWAY_I18N = Object.freeze({ languages, normalize, locale, translate, translateDynamic, hasTranslation, requiredTranslations });
})();
