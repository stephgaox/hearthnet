import { useEffect, useState } from 'react'
import { updateUser, setCurrentUser } from '../api/client'
import type { User } from '../types'
import { useFocusTrap } from '../hooks/useFocusTrap'

const AVATAR_COLORS = [
  '#5a7a8a', '#c0522a', '#4a7c59', '#7a5a82',
  '#b07030', '#2a8a82', '#9a4848', '#b88820',
]

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

interface Props {
  user: User
  onClose: () => void
  onUpdated: (user: User) => void
}

export default function EditProfileModal({ user, onClose, onUpdated }: Props) {
  const [name, setName] = useState(user.name)
  const [avatarColor, setAvatarColor] = useState(user.avatar_color)
  const [newPasscode, setNewPasscode] = useState('')
  const [confirmPasscode, setConfirmPasscode] = useState('')
  const [removePasscode, setRemovePasscode] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const modalRef = useFocusTrap(true, onClose)

  // Reset passcode confirm when new passcode is cleared
  useEffect(() => {
    if (!newPasscode) setConfirmPasscode('')
  }, [newPasscode])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const trimmedName = name.trim()
    if (!trimmedName) { setError('Name is required'); return }

    if (newPasscode) {
      if (newPasscode !== confirmPasscode) { setError('Passcodes do not match'); return }
    }

    setSaving(true)
    try {
      const payload: { name?: string; avatar_color?: string; passcode?: string } = {}

      if (trimmedName !== user.name) payload.name = trimmedName
      if (avatarColor !== user.avatar_color) payload.avatar_color = avatarColor

      if (removePasscode) {
        payload.passcode = ''
      } else if (newPasscode) {
        payload.passcode = newPasscode
      }

      const res = await updateUser(user.id, payload)
      const updated: User = { ...res.data, token: undefined }
      setCurrentUser(updated)
      onUpdated(updated)
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? 'Could not save changes')
    } finally {
      setSaving(false)
    }
  }

  const previewName = name.trim() || user.name

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-label="Edit profile"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={modalRef}
        className="bg-surface-card border border-surface-border rounded-2xl shadow-xl w-full max-w-sm"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-base font-semibold text-text">Edit Profile</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-surface-hover text-text-muted transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSave} className="px-5 py-5 space-y-5">

          {/* Avatar preview + color picker */}
          <div className="flex flex-col items-center gap-3">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-sm transition-colors"
              style={{ backgroundColor: avatarColor }}
            >
              {getInitials(previewName)}
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              {AVATAR_COLORS.map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setAvatarColor(color)}
                  aria-label={`Avatar color ${color}`}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                  style={{ backgroundColor: color, outline: color === avatarColor ? `3px solid ${color}` : undefined, outlineOffset: color === avatarColor ? '2px' : undefined }}
                />
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={50}
              className="w-full px-3 py-2 rounded-lg border border-surface-border bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Passcode section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text-muted">
                {user.has_passcode ? 'Change passcode' : 'Add passcode'}
                <span className="text-text-faint font-normal ml-1">(optional)</span>
              </label>
              {user.has_passcode && !removePasscode && (
                <button
                  type="button"
                  onClick={() => { setRemovePasscode(true); setNewPasscode(''); setConfirmPasscode('') }}
                  className="text-xs text-expense hover:underline"
                >
                  Remove passcode
                </button>
              )}
              {removePasscode && (
                <button
                  type="button"
                  onClick={() => setRemovePasscode(false)}
                  className="text-xs text-text-muted hover:underline"
                >
                  Keep passcode
                </button>
              )}
            </div>

            {removePasscode ? (
              <p className="text-xs text-text-faint bg-surface rounded-lg px-3 py-2 border border-surface-border">
                Passcode will be removed on save.
              </p>
            ) : (
              <>
                <input
                  type="password"
                  value={newPasscode}
                  onChange={e => setNewPasscode(e.target.value)}
                  placeholder={user.has_passcode ? 'New passcode' : 'Set a passcode'}
                  inputMode="numeric"
                  maxLength={20}
                  className="w-full px-3 py-2 rounded-lg border border-surface-border bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {newPasscode && (
                  <input
                    type="password"
                    value={confirmPasscode}
                    onChange={e => setConfirmPasscode(e.target.value)}
                    placeholder="Confirm passcode"
                    inputMode="numeric"
                    maxLength={20}
                    className="w-full px-3 py-2 rounded-lg border border-surface-border bg-surface text-text text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                )}
              </>
            )}
          </div>

          {error && <p className="text-xs text-expense">{error}</p>}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-surface-border text-sm text-text-muted hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex-1 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
