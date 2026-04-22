import { useEffect, useState } from 'react'
import { getAccountDateRanges, getAccounts, getAvailableYears, getStoredUser, setAuthToken, setCurrentUser } from './api/client'
import type { Account, User } from './types'
import Dashboard from './components/Dashboard'
import EditProfileModal from './components/EditProfileModal'
import ManageModal from './components/ManageModal'
import StatementsView from './components/StatementsView'
import UploadModal from './components/UploadModal'
import UserSwitcher from './components/UserSwitcher'

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

type DateRange = { min_date: string; max_date: string }

function fmtDateRange(min: string, max: string): string {
  const d1 = new Date(min + 'T00:00:00')
  const d2 = new Date(max + 'T00:00:00')
  const m1 = MONTH_NAMES[d1.getMonth()], y1 = d1.getFullYear()
  const m2 = MONTH_NAMES[d2.getMonth()], y2 = d2.getFullYear()
  if (y1 === y2 && d1.getMonth() === d2.getMonth()) return `${m1} ${y1}`
  if (y1 === y2) return `${m1} – ${m2} ${y1}`
  return `${m1} ${y1} – ${m2} ${y2}`
}

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

type AppView = { mode: 'dashboard' } | { mode: 'statements'; account: Account }

export default function App() {
  const today = new Date()

  // ── Auth state ──────────────────────────────────────────────────────────────
  const [currentUser, setCurrentUserState] = useState<User | null>(() => {
    const stored = getStoredUser()
    const token = localStorage.getItem('auth_token')
    return stored && token ? stored : null
  })

  // Listen for 401 events dispatched by the Axios interceptor
  useEffect(() => {
    const onLogout = () => setCurrentUserState(null)
    window.addEventListener('auth:logout', onLogout)
    return () => window.removeEventListener('auth:logout', onLogout)
  }, [])

  function handleLogin(user: User) {
    setCurrentUserState(user)
  }

  function handleSwitchUser() {
    setAuthToken(null)
    setCurrentUser(null)
    setCurrentUserState(null)
  }

  // ── Dashboard state ─────────────────────────────────────────────────────────
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [initialDateSet, setInitialDateSet] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showManage, setShowManage] = useState(false)
  const [showEditProfile, setShowEditProfile] = useState(false)
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [availableYears, setAvailableYears] = useState<number[]>([today.getFullYear()])
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month')
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme')
    return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  const [showScrollTop, setShowScrollTop] = useState(false)
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [dateRanges, setDateRanges] = useState<Record<number, DateRange>>({})
  const [appView, setAppView] = useState<AppView>({ mode: 'dashboard' })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }, [isDark])

  useEffect(() => {
    if (!currentUser) return
    getAvailableYears().then((r) => {
      const years = r.data.years
      if (years.length) {
        setAvailableYears(years)
        if (!initialDateSet) {
          setYear(r.data.latest_year ?? years[0])
          setMonth(r.data.latest_month ?? today.getMonth() + 1)
          setInitialDateSet(true)
        }
      }
    })
    getAccounts().then(r => setAccounts(r.data))
    getAccountDateRanges().then(r => {
      const map: Record<number, DateRange> = {}
      r.data.forEach(d => { map[d.account_id] = { min_date: d.min_date, max_date: d.max_date } })
      setDateRanges(map)
    })
  }, [refreshKey, currentUser])

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const handleUploadDone = (jumpTo?: { year: number; month: number }) => {
    setShowUpload(false)
    setRefreshKey(k => k + 1)
    if (jumpTo) {
      setYear(jumpTo.year)
      setMonth(jumpTo.month)
      setViewMode('month')
    }
  }

  const openStatements = (account: Account) => {
    setAppView({ mode: 'statements', account })
    setSidebarOpen(false)
  }

  const goToDashboard = () => setAppView({ mode: 'dashboard' })
  const isStatements = appView.mode === 'statements'

  // ── Show user switcher if not logged in ────────────────────────────────────
  if (!currentUser) {
    return <UserSwitcher onLogin={handleLogin} />
  }

  return (
    <div className="min-h-screen bg-surface">

      {/* Sidebar backdrop */}
      <div
        className={`fixed inset-0 z-30 bg-black/20 transition-opacity duration-200 ${
          sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        aria-label="Site navigation"
        className={`fixed top-0 left-0 h-full w-64 z-40 bg-surface-card border-r border-surface-border flex flex-col transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 h-16 border-b border-surface-border flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <svg aria-hidden="true" className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-text">HearthNet</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-3 rounded-lg hover:bg-surface-hover text-text-muted"
            aria-label="Close menu"
          >
            <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4">
          <div className="px-2 mb-2">
            <button
              onClick={() => { goToDashboard(); setSidebarOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                appView.mode === 'dashboard'
                  ? 'bg-primary-light text-primary font-medium'
                  : 'text-text hover:bg-surface-hover'
              }`}
            >
              <svg aria-hidden="true" className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Dashboard
            </button>
          </div>

          <div className="mx-4 mt-3 mb-3 border-t border-surface-border" />
          <div className="px-4 pb-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">Statements</p>
          </div>
          <div className="px-2 space-y-0.5">
            {accounts.length === 0 ? (
              <p className="px-3 py-2 text-xs text-text-faint">No accounts yet — upload a statement.</p>
            ) : (
              accounts.map(acct => {
                const range = dateRanges[acct.id]
                const isActive = appView.mode === 'statements' && appView.account.id === acct.id
                return (
                  <button
                    key={acct.id}
                    onClick={() => openStatements(acct)}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                      isActive ? 'bg-primary-light text-primary' : 'text-text hover:bg-surface-hover'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: acct.color }} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate leading-tight">
                        {acct.name}{acct.last4 ? ` ···${acct.last4}` : ''}
                      </p>
                      {range && (
                        <p className="text-[11px] text-text-faint mt-0.5 leading-tight">
                          {fmtDateRange(range.min_date, range.max_date)}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>

          <div className="px-4 pt-5 pb-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">Coming Soon</p>
          </div>
          <div className="px-2 space-y-0.5">
            {['Budget Goals', 'Reports'].map(label => (
              <div
                key={label}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-sm text-text-faint cursor-not-allowed select-none"
              >
                <span>{label}</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-surface rounded-full border border-surface-border text-text-faint">soon</span>
              </div>
            ))}
          </div>
        </nav>

        {/* Current user + actions at sidebar bottom */}
        <div className="px-4 py-3 border-t border-surface-border flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
            style={{ backgroundColor: currentUser.avatar_color }}
          >
            {getInitials(currentUser.name)}
          </div>
          <span className="text-sm text-text truncate flex-1">{currentUser.name}</span>
          <button
            onClick={() => { setSidebarOpen(false); setShowEditProfile(true) }}
            className="text-xs text-text-muted hover:text-text transition-colors px-2 py-1 rounded-md hover:bg-surface-hover"
            aria-label="Edit profile"
          >
            Edit
          </button>
          <button
            onClick={() => { setSidebarOpen(false); handleSwitchUser() }}
            className="text-xs text-text-muted hover:text-text transition-colors px-2 py-1 rounded-md hover:bg-surface-hover"
            aria-label="Switch profile"
          >
            Switch
          </button>
        </div>
      </aside>

      {/* Header */}
      <header className="bg-surface-card border-b-[3px] border-primary sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(o => !o)}
                aria-label="Open menu"
                className="p-2.5 md:p-2 rounded-lg hover:bg-surface-hover text-text-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <svg aria-hidden="true" className="w-6 h-6 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div
                className="flex items-center gap-2.5 cursor-pointer"
                onClick={() => { goToDashboard(); setSidebarOpen(false) }}
              >
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <svg aria-hidden="true" className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-serif font-bold text-text tracking-tight">HearthNet</h1>
              </div>
            </div>

            {!isStatements && (
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-surface-border overflow-hidden" role="group" aria-label="View mode">
                  <button
                    onClick={() => setViewMode('month')}
                    aria-pressed={viewMode === 'month'}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      viewMode === 'month' ? 'bg-primary text-white' : 'bg-surface-card text-text-muted hover:bg-surface-hover'
                    }`}
                  >Month</button>
                  <button
                    onClick={() => setViewMode('year')}
                    aria-pressed={viewMode === 'year'}
                    className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                      viewMode === 'year' ? 'bg-primary text-white' : 'bg-surface-card text-text-muted hover:bg-surface-hover'
                    }`}
                  >Year</button>
                </div>

                {viewMode === 'month' ? (
                  <div className="flex items-center gap-1">
                    <button onClick={prevMonth} className="p-2.5 md:p-1.5 rounded-lg hover:bg-surface-hover text-text-muted focus:outline-none focus:ring-2 focus:ring-primary" aria-label="Previous month">
                      <svg aria-hidden="true" className="w-5 h-5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <select value={month} onChange={e => setMonth(Number(e.target.value))}
                      className="text-sm font-semibold text-text border border-surface-border rounded-lg px-2 py-1.5 bg-surface-card focus:outline-none focus:ring-2 focus:ring-primary">
                      {MONTH_NAMES.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
                    </select>
                    <select value={year} onChange={e => setYear(Number(e.target.value))}
                      className="text-sm font-semibold text-text border border-surface-border rounded-lg px-2 py-1.5 bg-surface-card focus:outline-none focus:ring-2 focus:ring-primary">
                      {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <button onClick={nextMonth} className="p-2.5 md:p-1.5 rounded-lg hover:bg-surface-hover text-text-muted focus:outline-none focus:ring-2 focus:ring-primary" aria-label="Next month">
                      <svg aria-hidden="true" className="w-5 h-5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <select value={year} onChange={e => setYear(Number(e.target.value))}
                    className="text-sm font-medium border border-surface-border rounded-lg px-3 py-1.5 bg-surface-card text-text focus:outline-none focus:ring-2 focus:ring-primary">
                    {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              {/* Current user avatar in header — click to open menu */}
              <div className="relative">
                <button
                  onClick={() => setAvatarMenuOpen(o => !o)}
                  title={currentUser.name}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary"
                  style={{ backgroundColor: currentUser.avatar_color }}
                >
                  {getInitials(currentUser.name)}
                </button>
                {avatarMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-20" onClick={() => setAvatarMenuOpen(false)} aria-hidden="true" />
                    <div className="absolute right-0 top-10 z-30 w-44 bg-surface-card border border-surface-border rounded-xl shadow-lg py-1 overflow-hidden">
                      <div className="px-3 py-2 border-b border-surface-border">
                        <p className="text-xs font-semibold text-text truncate">{currentUser.name}</p>
                      </div>
                      <button
                        onClick={() => { setAvatarMenuOpen(false); setShowEditProfile(true) }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-surface-hover transition-colors text-left"
                      >
                        <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 112.828 2.828L11.828 15.828A2 2 0 0110 16H8v-2a2 2 0 01.586-1.414z" />
                        </svg>
                        Edit Profile
                      </button>
                      <button
                        onClick={() => { setAvatarMenuOpen(false); handleSwitchUser() }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-text hover:bg-surface-hover transition-colors text-left"
                      >
                        <svg className="w-4 h-4 text-text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        Switch User
                      </button>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={() => setIsDark(d => !d)}
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="p-2.5 md:p-2 rounded-lg border border-surface-border text-text-muted hover:bg-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {isDark ? (
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => setShowManage(true)}
                aria-label="Manage accounts and categories"
                className="p-2 rounded-lg border border-surface-border text-text-muted hover:bg-surface-hover transition-colors"
              >
                <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                onClick={() => setShowUpload(true)}
                className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
              >
                <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload Statement
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {appView.mode === 'statements' ? (
          <StatementsView account={appView.account} onBack={goToDashboard} />
        ) : (
          <Dashboard key={refreshKey} year={year} month={month} viewMode={viewMode} />
        )}
      </main>

      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} onDone={handleUploadDone} />
      )}
      {showManage && (
        <ManageModal onClose={() => setShowManage(false)} onChanged={() => setRefreshKey(k => k + 1)} />
      )}
      {showEditProfile && currentUser && (
        <EditProfileModal
          user={currentUser}
          onClose={() => setShowEditProfile(false)}
          onUpdated={updated => setCurrentUserState(updated)}
        />
      )}

      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="Back to top"
        className={`fixed bottom-6 right-6 z-20 w-10 h-10 bg-surface-card border border-surface-border rounded-full shadow-md flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text transition-all duration-200 ${
          showScrollTop ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
      >
        <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
    </div>
  )
}
