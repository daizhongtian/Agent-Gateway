import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type {
  AdminAuditEvent,
  AdminDevice,
  AdminHost,
  AdminOverview,
  AdminUser,
  PlatformConfig,
  User,
} from './types'

type Language = 'zh' | 'en'
type Tab = 'users' | 'devices' | 'hosts' | 'audit'
type Action = {
  kind: 'disable-user' | 'enable-user' | 'revoke-device' | 'disable-host'
  id: string
  label: string
} | null

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

function Glyph({ name }: { name: 'users' | 'device' | 'host' | 'audit' | 'refresh' | 'logout' | 'back' }) {
  const paths = {
    users: <><circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.6-4.2 2.6-6.3 5.5-6.3s4.9 2.1 5.5 6.3M14 14.5c3.9-.9 6.4 1 7 5.5"/></>,
    device: <><rect x="4" y="3" width="16" height="13" rx="2"/><path d="M2 20h20M9 16v4m6-4v4"/></>,
    host: <><rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 6.5h.01M8 17.5h.01M12 6.5h5M12 17.5h5"/></>,
    audit: <><path d="M12 3 4 6v5c0 5 3.2 8.4 8 10 4.8-1.6 8-5 8-10V6l-8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M18.2 15a7 7 0 1 1-.4-7.6L20 11"/></>,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4m4-4H9"/></>,
    back: <><path d="m15 18-6-6 6-6M9 12h11"/></>,
  }
  return <svg className="admin-glyph" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

export default function AdminDashboard({ user, config, onSignedOut }: { user: User; config: PlatformConfig; onSignedOut: () => void }) {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem('agent-gateway-admin-language') === 'en' ? 'en' : 'zh')
  const [tab, setTab] = useState<Tab>('users')
  const [overview, setOverview] = useState(emptyOverview)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [devices, setDevices] = useState<AdminDevice[]>([])
  const [hosts, setHosts] = useState<AdminHost[]>([])
  const [audit, setAudit] = useState<AdminAuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [action, setAction] = useState<Action>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const t = (zh: string, en: string) => language === 'zh' ? zh : en

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextOverview, nextUsers, nextDevices, nextHosts, nextAudit] = await Promise.all([
        api.adminOverview(), api.adminUsers(), api.adminDevices(), api.adminHosts(), api.adminAuditEvents(),
      ])
      setOverview(nextOverview)
      setUsers(nextUsers.items)
      setDevices(nextDevices.items)
      setHosts(nextHosts.items)
      setAudit(nextAudit.items)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) onSignedOut()
      else setError(caught instanceof Error ? caught.message : t('无法加载管理员数据。', 'Could not load administrator data.'))
    } finally {
      setLoading(false)
    }
  }, [onSignedOut, language])

  useEffect(() => { void load() }, [load])

  function switchLanguage() {
    const next = language === 'zh' ? 'en' : 'zh'
    localStorage.setItem('agent-gateway-admin-language', next)
    setLanguage(next)
  }

  async function signOut() {
    try { await api.logout() } finally { onSignedOut() }
  }

  async function confirmAction() {
    if (!action) return
    setSaving(true)
    setError('')
    try {
      if (action.kind === 'disable-user') await api.adminDisableUser(action.id, reason)
      if (action.kind === 'enable-user') await api.adminEnableUser(action.id, reason)
      if (action.kind === 'revoke-device') await api.adminRevokeDevice(action.id, reason)
      if (action.kind === 'disable-host') await api.adminDisableHost(action.id, reason)
      setNotice(t('操作已完成并写入审计记录。', 'The action completed and was written to the audit log.'))
      setAction(null)
      setReason('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('管理员操作失败。', 'The administrator action failed.'))
    } finally {
      setSaving(false)
    }
  }

  const summary = [
    { label: t('全部用户', 'Total users'), value: overview.totalUsers, detail: `${overview.activeUsers} ${t('活跃', 'active')}`, glyph: 'users' as const },
    { label: t('活跃设备', 'Active devices'), value: overview.activeDevices, detail: `${overview.revokedDevices} ${t('已撤销', 'revoked')}`, glyph: 'device' as const },
    { label: t('在线 Host', 'Online Hosts'), value: overview.onlineHosts, detail: `${overview.disabledHosts} ${t('已停用', 'disabled')}`, glyph: 'host' as const },
    { label: t('审计事件', 'Audit events'), value: overview.auditEvents, detail: t('只记录管理操作', 'Administrative actions only'), glyph: 'audit' as const },
  ]

  return <div className="admin-shell">
    <header className="admin-topbar">
      <a href="/" className="admin-brand" aria-label={t('返回平台', 'Back to platform')}><span>A</span><div><strong>AGENT GATEWAY</strong><small>ADMIN CONTROL</small></div></a>
      <div className="admin-top-actions">
        <span className="admin-identity"><b>{user.displayName}</b><small>@{user.username}</small></span>
        <button type="button" onClick={switchLanguage}>{language === 'zh' ? 'EN' : '中文'}</button>
        <button type="button" onClick={() => void signOut()}><Glyph name="logout"/>{t('退出', 'Sign out')}</button>
      </div>
    </header>

    <main className="admin-main">
      <section className="admin-hero">
        <div><span className="admin-eyebrow">MINIMUM ADMIN DASHBOARD · V{config.platformVersion}</span><h1>{t('保持平台可控。', 'Keep the platform under control.')}</h1><p>{t('管理账号、设备和 Online Host，并查看每一次管理员操作。', 'Manage accounts, devices, and Online Hosts, with an audit trail for every administrator action.')}</p></div>
        <div className="admin-hero-actions"><a href="/"><Glyph name="back"/>{t('用户平台', 'User dashboard')}</a><button type="button" onClick={() => void load()} disabled={loading}><Glyph name="refresh"/>{loading ? t('刷新中', 'Refreshing') : t('刷新数据', 'Refresh')}</button></div>
      </section>

      {error && <div className="admin-alert admin-alert-error" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
      {notice && <div className="admin-alert admin-alert-success" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}

      <section className="admin-summary" aria-label={t('平台概览', 'Platform overview')}>
        {summary.map((item) => <article key={item.label}><span><Glyph name={item.glyph}/></span><div><small>{item.label}</small><strong>{item.value.toLocaleString()}</strong><p>{item.detail}</p></div></article>)}
      </section>

      <section className="admin-workspace">
        <nav className="admin-tabs" aria-label={t('管理资源', 'Administration resources')}>
          {([
            ['users', 'users', t('用户', 'Users'), overview.totalUsers],
            ['devices', 'device', t('设备', 'Devices'), devices.length],
            ['hosts', 'host', 'Online Hosts', hosts.length],
            ['audit', 'audit', t('审计记录', 'Audit log'), overview.auditEvents],
          ] as const).map(([id, glyph, label, count]) => <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Glyph name={glyph}/><span>{label}</span><b>{count}</b></button>)}
        </nav>

        <div className="admin-table-wrap" aria-busy={loading}>
          {tab === 'users' && <table><thead><tr><th>{t('账号', 'Account')}</th><th>{t('角色', 'Role')}</th><th>{t('状态', 'Status')}</th><th>{t('创建时间', 'Created')}</th><th>{t('操作', 'Action')}</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}><td><strong>{item.displayName}</strong><small>@{item.username}{item.email ? ` · ${item.email}` : ''}</small></td><td><Status value={item.role}/></td><td><Status value={item.status}/></td><td>{date(item.createdAt, language)}</td><td>{item.id === user.id ? <span className="admin-self">{t('当前管理员', 'Current admin')}</span> : item.status === 'active' ? <button className="admin-danger" onClick={() => setAction({ kind: 'disable-user', id: item.id, label: item.username })}>{t('停用', 'Disable')}</button> : <button onClick={() => setAction({ kind: 'enable-user', id: item.id, label: item.username })}>{t('恢复', 'Enable')}</button>}</td></tr>)}</tbody></table>}
          {tab === 'devices' && <table><thead><tr><th>{t('设备', 'Device')}</th><th>{t('所有者', 'Owner')}</th><th>{t('状态', 'Status')}</th><th>{t('最后活动', 'Last seen')}</th><th>{t('操作', 'Action')}</th></tr></thead><tbody>{devices.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.platform}{item.appVersion ? ` · v${item.appVersion}` : ''}</small></td><td>{item.userUsername ? `@${item.userUsername}` : item.userEmail ?? '—'}</td><td><Status value={item.status}/></td><td>{date(item.lastSeenAt, language)}</td><td><button className="admin-danger" disabled={item.status === 'revoked'} onClick={() => setAction({ kind: 'revoke-device', id: item.id, label: item.name })}>{item.status === 'revoked' ? t('已撤销', 'Revoked') : t('撤销', 'Revoke')}</button></td></tr>)}</tbody></table>}
          {tab === 'hosts' && <table><thead><tr><th>Host</th><th>{t('所有者', 'Owner')}</th><th>{t('状态', 'Status')}</th><th>{t('最后心跳', 'Last heartbeat')}</th><th>{t('操作', 'Action')}</th></tr></thead><tbody>{hosts.map((item) => <tr key={item.id}><td><strong>{item.displayName}</strong><small>{shortId(item.id)}</small></td><td>{item.userUsername ? `@${item.userUsername}` : item.userEmail ?? '—'}</td><td><Status value={item.status}/></td><td>{date(item.lastHeartbeatAt, language)}</td><td><button className="admin-danger" disabled={item.status === 'disabled'} onClick={() => setAction({ kind: 'disable-host', id: item.id, label: item.displayName })}>{item.status === 'disabled' ? t('已停用', 'Disabled') : t('停用', 'Disable')}</button></td></tr>)}</tbody></table>}
          {tab === 'audit' && <table><thead><tr><th>{t('操作', 'Action')}</th><th>{t('管理员', 'Administrator')}</th><th>{t('目标', 'Target')}</th><th>{t('原因', 'Reason')}</th><th>{t('时间', 'Time')}</th></tr></thead><tbody>{audit.map((item) => <tr key={item.id}><td><strong>{item.action}</strong><small>{item.requestId ?? '—'}</small></td><td>{item.actorUsername ? `@${item.actorUsername}` : item.actorEmail ?? t('系统', 'System')}</td><td>{item.targetType ? `${item.targetType} · ${shortId(item.targetId)}` : '—'}</td><td>{item.reason ?? '—'}</td><td>{date(item.createdAt, language)}</td></tr>)}</tbody></table>}
          {!loading && ((tab === 'users' && !users.length) || (tab === 'devices' && !devices.length) || (tab === 'hosts' && !hosts.length) || (tab === 'audit' && !audit.length)) && <div className="admin-empty">{t('还没有可显示的数据。', 'There is no data to display yet.')}</div>}
        </div>
      </section>
    </main>

    {action && <div className="admin-modal-backdrop" role="presentation"><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-action-title"><span className="admin-eyebrow">CONFIRM ADMIN ACTION</span><h2 id="admin-action-title">{actionTitle(action.kind, language)}</h2><p>{t('目标：', 'Target: ')}<strong>{action.label}</strong></p><label>{t('原因（可选，将写入审计记录）', 'Reason (optional, stored in the audit log)')}<textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label><div><button type="button" onClick={() => { setAction(null); setReason('') }} disabled={saving}>{t('取消', 'Cancel')}</button><button type="button" className="admin-danger-solid" onClick={() => void confirmAction()} disabled={saving}>{saving ? t('处理中…', 'Working…') : t('确认操作', 'Confirm action')}</button></div></section></div>}
  </div>
}

function Status({ value }: { value: string }) {
  return <span className={`admin-status admin-status-${value}`}><i/>{value}</span>
}

function shortId(value: string | null) {
  return value ? `${value.slice(0, 8)}…` : '—'
}

function date(value: string | null, language: Language) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function actionTitle(kind: NonNullable<Action>['kind'], language: Language) {
  const copy = {
    'disable-user': ['停用这个用户？', 'Disable this user?'],
    'enable-user': ['恢复这个用户？', 'Enable this user?'],
    'revoke-device': ['永久撤销这个设备？', 'Permanently revoke this device?'],
    'disable-host': ['停用这个 Online Host？', 'Disable this Online Host?'],
  }
  return copy[kind][language === 'zh' ? 0 : 1]
}
