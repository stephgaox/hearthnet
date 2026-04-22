import { useEffect, useRef, useState } from 'react'
import { createUser, getUsers, loginUser, setAuthToken, setCurrentUser } from '../api/client'
import type { User } from '../types'

interface Props {
  onLogin: (user: User) => void
}

export default function UserSwitcher({ onLogin }: Props) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<User | null>(null)
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPasscode, setNewPasscode] = useState('')
  const [newPasscodeConfirm, setNewPasscodeConfirm] = useState('')
  const [addError, setAddError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const passcodeRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getUsers()
      .then(r => setUsers(r.data))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (selected?.has_passcode && passcodeRef.current) {
      passcodeRef.current.focus()
    }
  }, [selected])

  useEffect(() => {
    if (showAdd && nameRef.current) {
      nameRef.current.focus()
    }
  }, [showAdd])

  async function handleSelectUser(user: User) {
    if (!user.has_passcode) {
      // No passcode — log in directly
      await doLogin(user, '')
    } else {
      setSelected(user)
      setPasscode('')
      setError('')
    }
  }

  async function doLogin(user: User, code: string) {
    setSubmitting(true)
    setError('')
    try {
      const res = await loginUser(user.id, code)
      const loggedIn = res.data
      setAuthToken(loggedIn.token!)
      setCurrentUser(loggedIn)
      onLogin(loggedIn)
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      setError(detail ?? (e?.response ? 'Incorrect passcode' : 'Cannot reach server — is the backend running?'))
      setPasscode('')
      passcodeRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePasscodeSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    await doLogin(selected, passcode)
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) { setAddError('Name is required'); return }
    if (newPasscode && newPasscode !== newPasscodeConfirm) {
      setAddError('Passcodes do not match'); return
    }
    setSubmitting(true)
    setAddError('')
    try {
      const res = await createUser(name, newPasscode || undefined)
      const created = res.data
      setAuthToken(created.token!)
      setCurrentUser(created)
      onLogin(created)
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      setAddError(detail ?? (e?.response ? 'Could not create profile' : 'Cannot reach server — is the backend running?'))
      setSubmitting(false)
    }
  }

  function getInitials(name: string) {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-sm">
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-3xl font-serif font-bold text-text tracking-tight">HearthNet</h1>
      </div>

      {loading ? (
        <div className="text-text-muted text-sm">Loading profiles…</div>
      ) : showAdd ? (
        /* ── Add new profile form ── */
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold text-text text-center mb-6">New Profile</h2>
          <form onSubmit={handleAddUser} className="bg-surface-card border border-surface-border rounded-2xl p-6 space-y-4 shadow-sm">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">Name</label>
              <input
                ref={nameRef}
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Alex"
                maxLength={50}
                className="w-full px-3 py-2 rounded-lg border border-surface-border bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1.5">
                Passcode <span className="text-text-faint font-normal">(optional)</span>
              </label>
              <input
                type="password"
                value={newPasscode}
                onChange={e => setNewPasscode(e.target.value)}
                placeholder="Leave blank for no lock"
                inputMode="numeric"
                maxLength={20}
                className="w-full px-3 py-2 rounded-lg border border-surface-border bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {newPasscode && (
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1.5">Confirm passcode</label>
                <input
                  type="password"
                  value={newPasscodeConfirm}
                  onChange={e => setNewPasscodeConfirm(e.target.value)}
                  inputMode="numeric"
                  maxLength={20}
                  className="w-full px-3 py-2 rounded-lg border border-surface-border bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            )}
            {addError && <p className="text-xs text-expense">{addError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowAdd(false); setAddError(''); setNewName(''); setNewPasscode(''); setNewPasscodeConfirm('') }}
                className="flex-1 px-4 py-2 rounded-lg border border-surface-border text-sm text-text-muted hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !newName.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      ) : selected?.has_passcode ? (
        /* ── Passcode entry ── */
        <div className="w-full max-w-xs">
          <div className="flex flex-col items-center mb-6">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold mb-3 shadow-sm"
              style={{ backgroundColor: selected.avatar_color }}
            >
              {getInitials(selected.name)}
            </div>
            <h2 className="text-lg font-semibold text-text">{selected.name}</h2>
            <p className="text-sm text-text-muted mt-0.5">Enter your passcode</p>
          </div>
          <form onSubmit={handlePasscodeSubmit} className="space-y-3">
            <input
              ref={passcodeRef}
              type="password"
              value={passcode}
              onChange={e => setPasscode(e.target.value)}
              inputMode="numeric"
              maxLength={20}
              placeholder="Passcode"
              className="w-full px-4 py-3 rounded-xl border border-surface-border bg-surface-card text-text text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {error && <p className="text-xs text-expense text-center">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !passcode}
              className="w-full px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {submitting ? 'Checking…' : 'Continue'}
            </button>
            <button
              type="button"
              onClick={() => { setSelected(null); setError('') }}
              className="w-full px-4 py-2 text-sm text-text-muted hover:text-text transition-colors"
            >
              ← Back to profiles
            </button>
          </form>
        </div>
      ) : (
        /* ── Profile grid ── */
        <div className="w-full max-w-lg">
          <h2 className="text-xl font-semibold text-text text-center mb-8">Who's tracking today?</h2>
          <div className="flex flex-wrap justify-center gap-6">
            {users.map(user => (
              <button
                key={user.id}
                onClick={() => handleSelectUser(user)}
                className="flex flex-col items-center gap-2.5 group focus:outline-none"
              >
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-sm ring-2 ring-transparent group-hover:ring-primary group-focus-visible:ring-primary transition-all"
                  style={{ backgroundColor: user.avatar_color }}
                >
                  {getInitials(user.name)}
                </div>
                <span className="text-sm font-medium text-text group-hover:text-primary transition-colors max-w-[80px] truncate">
                  {user.name}
                </span>
                {user.has_passcode && (
                  <svg className="w-3.5 h-3.5 text-text-faint -mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                )}
              </button>
            ))}

            {/* Add profile button */}
            <button
              onClick={() => setShowAdd(true)}
              className="flex flex-col items-center gap-2.5 group focus:outline-none"
            >
              <div className="w-20 h-20 rounded-full flex items-center justify-center bg-surface-card border-2 border-dashed border-surface-border text-text-faint group-hover:border-primary group-hover:text-primary group-focus-visible:border-primary transition-colors">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <span className="text-sm font-medium text-text-faint group-hover:text-primary transition-colors">
                Add Profile
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
