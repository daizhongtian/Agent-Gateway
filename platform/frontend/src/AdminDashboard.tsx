import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type {
  AdminOverview,
  AdminUser,
  PlatformConfig,
  User,
} from './types'
import { LanguageSelect, languageLocale, translate, useLanguage, type Language } from './i18n'

const emptyOverview: AdminOverview = {
  totalUsers: 0,
  activeUsers: 0,
  disabledUsers: 0,
  activeDevices: 0,
  revokedDevices: 0,
  onlineHosts: 0,
  disabledHosts: 0,
  auditEvents: 0,
}

function Glyph({ name }: { name: 'users' | 'host' | 'refresh' | 'logout' | 'back' }) {
  const paths = {
    users: <><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.6-4.2 2.6-6.3 5.5-6.3s4.9 2.1 5.5 6.3M14 14.5c3.9-.9 6.4 1 7 5.5"/></>,
    host: <><rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 6.5h.01M8 17.5h.01M12 6.5h5M12 17.5h5"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M18.2 15a7 7 0 1 1-.4-7.6L20 11"/></>,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4m4-4H9"/></>,
    back: <><path d="m15 18-6-6 6-6M9 12h11"/></>,
  }
  return <svg className="admin-glyph" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

export default function AdminDashboard({ user, config, onSignedOut }: { user: User; config: PlatformConfig; onSignedOut: () => void }) {
  const [language, setLanguage] = useLanguage()
  const [overview, setOverview] = useState(emptyOverview)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const t = (zh: string, en: string) => translate(language, zh, en)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextOverview, nextUsers] = await Promise.all([api.adminOverview(), api.adminUsers()])
      setOverview(nextOverview)
      setUsers(nextUsers.items)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onSignedOut()
      else setError(caught instanceof Error ? caught.message : t('无法加载管理员数据。', 'Could not load administrator data.'))
    } finally {
      setLoading(false)
    }
  }, [onSignedOut, language])

  useEffect(() => { void load() }, [load])

  async function signOut() {
    try { await api.logout() } finally { onSignedOut() }
  }

  const summary = [
    { label: t('数据库用户', 'Database users'), value: overview.totalUsers, detail: `${overview.activeUsers} ${t('个活跃账号', 'active accounts')}`, glyph: 'users' as const },
    { label: t('当前在线 Host', 'Hosts online now'), value: overview.onlineHosts, detail: t('仅显示汇总数量', 'Aggregate count only'), glyph: 'host' as const },
  ]

  return <div className="admin-shell">
    <header className="admin-topbar">
      <a href="/" className="admin-brand" aria-label={t('返回平台', 'Back to platform')}><span>A</span><div><strong>AGENT GATEWAY</strong><small>{t('管理员控制', 'Admin control')}</small></div></a>
      <div className="admin-top-actions">
        <span className="admin-identity"><b>{user.displayName}</b><small>@{user.username}</small></span>
        <LanguageSelect language={language} onChange={setLanguage}/>
        <button type="button" onClick={() => void signOut()}><Glyph name="logout"/>{t('退出', 'Sign out')}</button>
      </div>
    </header>

    <main className="admin-main">
      <section className="admin-hero">
        <div><span className="admin-eyebrow">{t('用户概览', 'User overview')} · V{config.platformVersion}</span><h1>{t('查看平台用户。', 'View platform users.')}</h1><p>{t('查看数据库中的用户账号，以及当前在线 Host 的汇总数量。', 'View user accounts in the database and the aggregate count of Hosts currently online.')}</p></div>
        <div className="admin-hero-actions"><a href="/"><Glyph name="back"/>{t('用户平台', 'User dashboard')}</a><button type="button" onClick={() => void load()} disabled={loading}><Glyph name="refresh"/>{loading ? t('刷新中', 'Refreshing') : t('刷新数据', 'Refresh')}</button></div>
      </section>

      {error && <div className="admin-alert admin-alert-error" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
      <section className="admin-summary" aria-label={t('平台概览', 'Platform overview')}>
        {summary.map((item) => <article key={item.label}><span><Glyph name={item.glyph}/></span><div><small>{item.label}</small><strong>{item.value.toLocaleString()}</strong><p>{item.detail}</p></div></article>)}
      </section>

      <section className="admin-workspace">
        <header className="admin-resource-heading"><div><Glyph name="users"/><span><strong>{t('用户', 'Users')}</strong><small>{t('只读账号列表', 'Read-only account list')}</small></span></div><b>{overview.totalUsers}</b></header>

        <div className="admin-table-wrap" aria-busy={loading}>
          <table><thead><tr><th>{t('账号', 'Account')}</th><th>{t('角色', 'Role')}</th><th>{t('状态', 'Status')}</th><th>{t('创建时间', 'Created')}</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td><strong>{item.displayName}</strong><small>@{item.username}{item.email ? ` · ${item.email}` : ''}</small></td><td><Status value={item.role} language={language}/></td><td><Status value={item.status} language={language}/></td><td>{date(item.createdAt, language)}</td></tr>)}</tbody></table>
          {!loading && !users.length && <div className="admin-empty">{t('还没有可显示的数据。', 'There is no data to display yet.')}</div>}
        </div>
      </section>
    </main>
  </div>
}

function Status({ value, language }: { value: string; language: Language }) {
  return <span className={`admin-status admin-status-${value}`}><i/>{statusLabel(value, language)}</span>
}

function date(value: string | null, language: Language) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(languageLocale(language), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function statusLabel(value: string, language: Language) {
  const labels: Record<string, [string, string]> = {
    active: ['活跃', 'Active'], admin: ['管理员', 'Administrator'], user: ['用户', 'User'],
    disabled: ['已停用', 'Disabled'], revoked: ['已撤销', 'Revoked'], online: ['在线', 'Online'], offline: ['离线', 'Offline'],
  }
  const label = labels[value.toLowerCase()]
  return label ? translate(language, label[0], label[1]) : value
}
