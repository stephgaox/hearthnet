import { useEffect, useRef, useState } from 'react'
import {
  createAccount, createCategory,
  deleteAccount, deleteCategory,
  deleteAllTransactions,
  deleteTransactionsByFile,
  getAccounts, getCategories,
  getSourceFiles,
  getTransactions,
  reclassifyTransactions,
  updateAccount, updateCategory,
} from '../api/client'
import type { Transaction } from '../types'
import { useFocusTrap } from '../hooks/useFocusTrap'
import type { Account, Category } from '../types'
import ColorPicker from './ColorPicker'

type Tab = 'accounts' | 'categories' | 'danger'

interface Props {
  onClose: () => void
  onChanged: () => void
}

export default function ManageModal({ onClose, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('accounts')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [error, setError] = useState('')

  const [newAcct, setNewAcct] = useState({ name: '', type: 'credit_card', institution: '', last4: '', color: '#a67c52' })
  const [addingAcct, setAddingAcct] = useState(false)
  const [newCat, setNewCat] = useState({ name: '', color: '#a67c52' })
  const [addingCat, setAddingCat] = useState(false)

  // Inline account editing (full form)
  const [editingAcctId, setEditingAcctId] = useState<number | null>(null)
  const [editingAcct, setEditingAcct] = useState({ name: '', type: 'credit_card', last4: '' })
  const [savingAcct, setSavingAcct] = useState(false)

  // Inline category name editing
  const [editingId, setEditingId] = useState<{ type: 'category'; id: number } | null>(null)
  const [editingName, setEditingName] = useState('')

  // Merge confirmation (rename to existing name)
  const [mergeConfirm, setMergeConfirm] = useState<{ from: Category; to: Category } | null>(null)

  // Delete with reassign (category has transactions)
  const [deleteReassign, setDeleteReassign] = useState<Category | null>(null)
  const [deleteReassignTarget, setDeleteReassignTarget] = useState('')
  const [deleteReassigning, setDeleteReassigning] = useState(false)

  // Undo toast
  type UndoAction =
    | { kind: 'rename'; id: number; oldName: string; newName: string }
    | { kind: 'merge'; deleted: Category; intoName: string }
    | { kind: 'delete'; deleted: Category; reassignedTo: string | null }
  const [undoAction, setUndoAction] = useState<UndoAction | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pushUndo = (action: UndoAction) => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoAction(action)
    undoTimer.current = setTimeout(() => setUndoAction(null), 6000)
  }

  const handleUndo = async () => {
    if (!undoAction) return
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndoAction(null)
    try {
      if (undoAction.kind === 'rename') {
        const res = await updateCategory(undoAction.id, { name: undoAction.oldName })
        setCategories(prev => prev.map(c => c.id === undoAction.id ? { ...c, name: res.data.name } : c).sort((a, b) => a.name.localeCompare(b.name)))
        onChanged()
      } else if (undoAction.kind === 'merge') {
        // Recreate the deleted category and move its transactions back
        const res = await createCategory(undoAction.deleted.name, undoAction.deleted.color)
        await reclassifyTransactions(undoAction.intoName, undoAction.deleted.name)
        setCategories(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
        onChanged()
      } else if (undoAction.kind === 'delete') {
        // Recreate the deleted category
        const res = await createCategory(undoAction.deleted.name, undoAction.deleted.color)
        // If transactions were reassigned, move them back
        if (undoAction.reassignedTo) {
          await reclassifyTransactions(undoAction.reassignedTo, undoAction.deleted.name)
        }
        setCategories(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
        onChanged()
      }
    } catch (e) { setError(apiErr(e)) }
  }

  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearDone, setClearDone] = useState<number | null>(null)

  // Delete by file
  interface SourceFile { file_hash: string; source_file: string; count: number; min_date: string; max_date: string }
  const [sourceFiles, setSourceFiles] = useState<SourceFile[]>([])
  const [fileDeletePending, setFileDeletePending] = useState<SourceFile | null>(null)
  const [fileDeleting, setFileDeleting] = useState(false)

  // File preview
  const [previewHash, setPreviewHash] = useState<string | null>(null)
  const [previewTxs, setPreviewTxs] = useState<Transaction[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const togglePreview = (file_hash: string) => {
    if (previewHash === file_hash) {
      setPreviewHash(null)
      return
    }
    setPreviewHash(file_hash)
    setPreviewLoading(true)
    getTransactions({ file_hash })
      .then(r => setPreviewTxs(r.data))
      .finally(() => setPreviewLoading(false))
  }

  const trapRef = useFocusTrap(true, onClose)

  useEffect(() => {
    getAccounts().then(r => setAccounts(r.data.slice().sort((a, b) => a.name.localeCompare(b.name))))
    getCategories().then(r => setCategories(r.data.slice().sort((a, b) => a.name.localeCompare(b.name))))
  }, [])

  const apiErr = (e: unknown) =>
    (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'An error occurred'

  // Account inline edit handlers
  const startEditingAcct = (a: Account) => {
    setEditingAcctId(a.id)
    setEditingAcct({ name: a.name, type: a.type, last4: a.last4 ?? '' })
  }

  const commitEditAcct = async () => {
    if (editingAcctId === null) return
    const name = editingAcct.name.trim()
    if (!name) { setEditingAcctId(null); return }
    setSavingAcct(true)
    try {
      const res = await updateAccount(editingAcctId, {
        name,
        type: editingAcct.type as Account['type'],
        last4: editingAcct.last4.trim() || '',
      })
      setAccounts(prev => prev.map(a => a.id === editingAcctId ? res.data : a).sort((a, b) => a.name.localeCompare(b.name)))
      onChanged()
    } catch (e) { setError(apiErr(e)) }
    finally { setSavingAcct(false); setEditingAcctId(null) }
  }

  // Category inline name editing
  const startEditing = (type: 'category', id: number, name: string) => {
    setEditingId({ type, id })
    setEditingName(name)
  }

  const commitEdit = async () => {
    if (!editingId) return
    const name = editingName.trim()
    if (!name) { setEditingId(null); return }

    const existing = categories.find(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== editingId.id)
    const current = categories.find(c => c.id === editingId.id)
    if (existing && current) {
      setMergeConfirm({ from: current, to: existing })
      setEditingId(null)
      return
    }

    try {
      const oldName = categories.find(c => c.id === editingId.id)?.name ?? ''
      const res = await updateCategory(editingId.id, { name })
      if ((res.data as { merged?: boolean }).merged) {
        setCategories(prev => prev.filter(c => c.id !== editingId.id).sort((a, b) => a.name.localeCompare(b.name)))
      } else {
        setCategories(prev => prev.map(c => c.id === editingId.id ? { ...c, name: res.data.name } : c).sort((a, b) => a.name.localeCompare(b.name)))
        pushUndo({ kind: 'rename', id: editingId.id, oldName, newName: name })
      }
      onChanged()
    } catch (e) { setError(apiErr(e)) }
    setEditingId(null)
  }

  const confirmMerge = async () => {
    if (!mergeConfirm) return
    try {
      await updateCategory(mergeConfirm.from.id, { name: mergeConfirm.to.name })
      setCategories(prev => prev.filter(c => c.id !== mergeConfirm.from.id).sort((a, b) => a.name.localeCompare(b.name)))
      pushUndo({ kind: 'merge', deleted: mergeConfirm.from, intoName: mergeConfirm.to.name })
      onChanged()
    } catch (e) { setError(apiErr(e)) }
    setMergeConfirm(null)
  }

  const handleAcctColor = async (id: number, color: string) => {
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, color } : a))
    await updateAccount(id, { color })
    onChanged()
  }

  const handleAcctDelete = async (id: number) => {
    setError('')
    try {
      await deleteAccount(id)
      setAccounts(prev => prev.filter(a => a.id !== id))
      onChanged()
    } catch (e) { setError(apiErr(e)) }
  }

  const handleAddAccount = async () => {
    if (!newAcct.name.trim()) return
    setAddingAcct(true); setError('')
    try {
      const res = await createAccount({
        name: newAcct.name.trim(),
        type: newAcct.type,
        institution: newAcct.institution.trim() || undefined,
        last4: newAcct.last4.trim() || undefined,
        color: newAcct.color,
      })
      setAccounts(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewAcct({ name: '', type: 'credit_card', institution: '', last4: '', color: '#3b82f6' })
      onChanged()
    } catch (e) { setError(apiErr(e)) }
    finally { setAddingAcct(false) }
  }

  // Category actions
  const handleCatColor = async (id: number, color: string) => {
    setCategories(prev => prev.map(c => c.id === id ? { ...c, color } : c))
    await updateCategory(id, { color })
    onChanged()
  }

  const handleCatDelete = async (id: number) => {
    setError('')
    try {
      await deleteCategory(id)
      setCategories(prev => prev.filter(c => c.id !== id))
      onChanged()
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || ''
      // Backend blocked because transactions exist — open reassign dialog
      if (detail.includes('transaction')) {
        const cat = categories.find(c => c.id === id)
        if (cat) { setDeleteReassign(cat); setDeleteReassignTarget('') }
      } else {
        setError(detail || 'An error occurred')
      }
    }
  }

  const confirmDeleteReassign = async () => {
    if (!deleteReassign) return
    setDeleteReassigning(true)
    const reassignTo = deleteReassignTarget || undefined
    try {
      await deleteCategory(deleteReassign.id, reassignTo)
      setCategories(prev => prev.filter(c => c.id !== deleteReassign.id))
      pushUndo({ kind: 'delete', deleted: deleteReassign, reassignedTo: reassignTo ?? null })
      setDeleteReassign(null)
      onChanged()
    } catch (e) { setError(apiErr(e)) }
    finally { setDeleteReassigning(false) }
  }

  const handleFileDelete = async () => {
    if (!fileDeletePending) return
    setFileDeleting(true)
    try {
      await deleteTransactionsByFile(fileDeletePending.file_hash)
      setSourceFiles(prev => prev.filter(f => f.file_hash !== fileDeletePending.file_hash))
      setFileDeletePending(null)
      onChanged()
    } catch (e) { setError(apiErr(e)) }
    finally { setFileDeleting(false) }
  }

  const handleClearAll = async () => {
    setClearing(true)
    try {
      const res = await deleteAllTransactions()
      setClearDone(res.data.deleted)
      setClearConfirm(false)
      onChanged()
    } catch (e) { setError(apiErr(e)) }
    finally { setClearing(false) }
  }

  const handleAddCategory = async () => {
    if (!newCat.name.trim()) return
    setAddingCat(true); setError('')
    try {
      const res = await createCategory(newCat.name.trim(), newCat.color)
      setCategories(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewCat({ name: '', color: '#6b7280' })
      onChanged()
    } catch (e) { setError(apiErr(e)) }
    finally { setAddingCat(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Manage Accounts and Categories"
        className="relative bg-surface-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
      >

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-border">
          <div>
            <h2 className="text-lg font-semibold text-text">Manage</h2>
            <p className="text-xs text-text-muted mt-0.5">Accounts and categories</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-lg hover:bg-surface-hover text-text-faint">
            <svg aria-hidden="true" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-border">
          {(['accounts', 'categories'] as Tab[]).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(''); setEditingAcctId(null) }}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${tab === t
                ? 'border-b-2 border-primary text-primary'
                : 'text-text-muted hover:text-text'}`}>
              {t === 'accounts' ? '🏦 Accounts' : '🏷️ Categories'}
            </button>
          ))}
          <button onClick={() => { setTab('danger'); setError(''); setClearConfirm(false); setClearDone(null); setFileDeletePending(null); getSourceFiles().then(r => setSourceFiles(r.data)) }}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${tab === 'danger'
              ? 'border-b-2 border-expense text-expense'
              : 'text-text-muted hover:text-text'}`}>
            Files ⚠️
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-4 mt-3 p-3 bg-expense-light border border-expense/20 rounded-lg text-sm text-expense-text flex-shrink-0">
            {error}
          </div>
        )}

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto">

          {/* ── ACCOUNTS ── */}
          {tab === 'accounts' && (
            <div>
              <ul className="divide-y divide-surface-border">
                {accounts.map(a => (
                  <li key={a.id} className="flex flex-col">
                    {/* Row */}
                    <div className={`flex items-center gap-3 px-5 py-3 transition-colors ${editingAcctId === a.id ? 'bg-surface' : 'hover:bg-surface-hover'}`}>
                      <ColorPicker value={a.color} onChange={color => handleAcctColor(a.id, color)} />
                      <button
                        className="flex-1 min-w-0 text-left group"
                        onClick={() => editingAcctId === a.id ? setEditingAcctId(null) : startEditingAcct(a)}
                        aria-expanded={editingAcctId === a.id}
                      >
                        <p className="text-sm font-medium text-text truncate group-hover:text-primary transition-colors">
                          {a.name}
                          {a.last4 && <span className="text-text-faint font-normal"> ···{a.last4}</span>}
                        </p>
                        <p className="text-xs text-text-faint">
                          {a.type === 'credit_card' ? 'Credit Card' : a.type === 'investment' ? 'Investment' : 'Bank Account'}
                          {a.institution ? ` · ${a.institution}` : ''}
                          <span className="ml-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity">· edit</span>
                        </p>
                      </button>
                      <button onClick={() => handleAcctDelete(a.id)}
                        className="p-1.5 text-text-faint hover:text-expense hover:bg-expense-light rounded-lg transition-colors"
                        aria-label={`Delete account ${a.name}`}>
                        <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>

                    {/* Inline edit form */}
                    {editingAcctId === a.id && (
                      <div className="mx-4 mb-3 p-3 bg-surface-card border border-surface-border rounded-xl space-y-3">
                        <input
                          autoFocus
                          type="text"
                          value={editingAcct.name}
                          onChange={e => setEditingAcct(v => ({ ...v, name: e.target.value }))}
                          placeholder="Account name"
                          maxLength={100}
                          className="w-full text-sm border border-surface-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text"
                        />
                        <div className="flex gap-2">
                          <div className="flex rounded-lg border border-surface-border overflow-hidden text-xs flex-1">
                            {([['credit_card', '💳 Credit'], ['bank_account', '🏦 Bank'], ['investment', '📈 Invest']] as const).map(([val, label]) => (
                              <button key={val} type="button"
                                onClick={() => setEditingAcct(v => ({ ...v, type: val }))}
                                className={`flex-1 py-1.5 font-medium transition-colors ${editingAcct.type === val ? 'bg-primary text-white' : 'bg-surface-card text-text-muted hover:bg-surface-hover'}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                          <input
                            type="text"
                            placeholder="Last 4"
                            maxLength={4}
                            value={editingAcct.last4}
                            onChange={e => setEditingAcct(v => ({ ...v, last4: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                            className="w-16 text-sm border border-surface-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary bg-surface text-text font-mono tracking-widest"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setEditingAcctId(null)}
                            className="flex-1 py-1.5 rounded-lg text-xs text-text-muted border border-surface-border hover:bg-surface-hover transition-colors">
                            Cancel
                          </button>
                          <button type="button" onClick={commitEditAcct} disabled={savingAcct || !editingAcct.name.trim()}
                            className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition-colors">
                            {savingAcct ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
                {accounts.length === 0 && (
                  <li className="px-5 py-10 text-center text-sm text-text-faint">No accounts yet</li>
                )}
              </ul>

              <div className="border-t border-surface-border p-4 space-y-3 bg-surface">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Add Account</p>
                <div className="flex gap-2 items-center">
                  <ColorPicker value={newAcct.color} onChange={color => setNewAcct(a => ({ ...a, color }))} />
                  <input type="text" placeholder="Account name" value={newAcct.name}
                    onChange={e => setNewAcct(a => ({ ...a, name: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleAddAccount()}
                    className="flex-1 text-sm border border-surface-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary bg-surface-card" />
                </div>
                <div className="flex gap-2">
                  <div className="flex rounded-lg border border-surface-border overflow-hidden text-xs flex-1">
                    {([['credit_card', '💳 Credit'], ['bank_account', '🏦 Bank'], ['investment', '📈 Invest']] as const).map(([val, label]) => (
                      <button key={val} onClick={() => setNewAcct(a => ({ ...a, type: val }))}
                        className={`flex-1 py-1.5 font-medium transition-colors ${newAcct.type === val ? 'bg-primary text-white' : 'bg-surface-card text-text-muted hover:bg-surface-hover'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <input type="text" placeholder="Bank / Issuer" value={newAcct.institution}
                    onChange={e => setNewAcct(a => ({ ...a, institution: e.target.value }))}
                    className="w-28 text-sm border border-surface-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary bg-surface-card" />
                  <input type="text" placeholder="Last 4" maxLength={4} value={newAcct.last4}
                    onChange={e => setNewAcct(a => ({ ...a, last4: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    className="w-16 text-sm border border-surface-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary bg-surface-card font-mono tracking-widest" />
                </div>
                <button onClick={handleAddAccount} disabled={addingAcct || !newAcct.name.trim()}
                  className="w-full py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover disabled:opacity-50">
                  {addingAcct ? 'Adding…' : '+ Add Account'}
                </button>
              </div>
            </div>
          )}

          {/* ── CATEGORIES ── */}
          {tab === 'categories' && (
            <div>
              <ul className="divide-y divide-surface-border">
                {categories.map(c => (
                  <li key={c.id} className="flex flex-col">
                    <div className="flex items-center gap-3 px-5 py-3 hover:bg-surface-hover">
                      <ColorPicker value={c.color} onChange={color => handleCatColor(c.id, color)} />
                      {editingId?.type === 'category' && editingId.id === c.id ? (
                        <input
                          autoFocus
                          className="flex-1 text-sm font-medium border border-primary rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary bg-surface-card text-text"
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingId(null) }}
                        />
                      ) : (
                        <span className="flex-1 text-sm font-medium px-2.5 py-0.5 rounded-full text-white truncate cursor-pointer hover:opacity-80 transition-opacity"
                          style={{ backgroundColor: c.color }}
                          onClick={() => startEditing('category', c.id, c.name)}
                          title="Click to rename">
                          {c.name}
                        </span>
                      )}
                      <button onClick={() => handleCatDelete(c.id)}
                        className="p-1.5 text-text-faint hover:text-expense hover:bg-expense-light rounded-lg transition-colors"
                        aria-label={`Delete category ${c.name}`}>
                        <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>

                    {/* Merge confirmation — inline under this row */}
                    {mergeConfirm?.from.id === c.id && (
                      <div className="mx-4 mb-3 p-3 bg-primary-light border border-primary/20 rounded-lg space-y-2">
                        <p className="text-xs text-primary font-medium">
                          <span className="font-semibold">"{mergeConfirm.to.name}"</span> already exists.
                          Merge <span className="font-semibold">"{mergeConfirm.from.name}"</span> into it?
                          All linked transactions will move to <span className="font-semibold">"{mergeConfirm.to.name}"</span>.
                        </p>
                        <div className="flex gap-2">
                          <button onClick={() => setMergeConfirm(null)}
                            className="flex-1 py-1.5 rounded-lg text-xs text-text-muted border border-surface-border hover:bg-surface-hover transition-colors">
                            Cancel
                          </button>
                          <button onClick={confirmMerge}
                            className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:opacity-90 transition-opacity">
                            Yes, merge
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Delete with reassign — inline under this row */}
                    {deleteReassign?.id === c.id && (
                      <div className="mx-4 mb-3 p-3 bg-expense-light border border-expense/20 rounded-lg space-y-2">
                        <p className="text-xs text-expense font-medium">
                          <span className="font-semibold">"{deleteReassign.name}"</span> has linked transactions.
                          Reassign them before deleting?
                        </p>
                        <select
                          value={deleteReassignTarget}
                          onChange={e => setDeleteReassignTarget(e.target.value)}
                          className="w-full text-xs border border-surface-border rounded-lg px-2 py-1.5 bg-surface-card focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">— keep as-is (leave transactions with old name) —</option>
                          {categories.filter(cat => cat.id !== deleteReassign.id).map(cat => (
                            <option key={cat.id} value={cat.name}>{cat.name}</option>
                          ))}
                        </select>
                        <div className="flex gap-2">
                          <button onClick={() => setDeleteReassign(null)}
                            className="flex-1 py-1.5 rounded-lg text-xs text-text-muted border border-surface-border hover:bg-surface-hover transition-colors">
                            Cancel
                          </button>
                          <button onClick={() => confirmDeleteReassign()} disabled={deleteReassigning}
                            className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-expense text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                            {deleteReassigning ? 'Deleting…' : deleteReassignTarget ? 'Reassign & delete' : 'Delete anyway'}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
                {categories.length === 0 && (
                  <li className="px-5 py-10 text-center text-sm text-text-faint">No categories yet</li>
                )}
              </ul>

              <div className="border-t border-surface-border p-4 space-y-3 bg-surface">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Add Category</p>
                <div className="flex gap-2 items-center">
                  <ColorPicker value={newCat.color} onChange={color => setNewCat(c => ({ ...c, color }))} />
                  <input type="text" placeholder="Category name" value={newCat.name}
                    onChange={e => setNewCat(c => ({ ...c, name: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                    className="flex-1 text-sm border border-surface-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary bg-surface-card" />
                  <button onClick={handleAddCategory} disabled={addingCat || !newCat.name.trim()}
                    className="px-4 py-1.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover disabled:opacity-50 whitespace-nowrap">
                    {addingCat ? 'Adding…' : '+ Add'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── DANGER ZONE ── */}
          {tab === 'danger' && (
            <div className="p-5 space-y-4">

              {/* Delete by file */}
              <div className="rounded-xl border border-expense/25 bg-expense-light/30 p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <svg aria-hidden="true" className="w-5 h-5 text-expense flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-expense">Delete by Uploaded File</p>
                    <p className="text-xs text-text-muted mt-0.5">Remove all transactions from a specific upload. Cannot be undone.</p>
                  </div>
                </div>
                {sourceFiles.length === 0 ? (
                  <p className="text-xs text-text-faint text-center py-2">No uploaded files found</p>
                ) : (
                  <div className="space-y-2">
                    <ul className="divide-y divide-expense/10 rounded-lg overflow-hidden border border-expense/15">
                      {sourceFiles.slice(0, 5).map(f => (
                        <li key={f.file_hash} className="bg-surface-card">
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <button onClick={() => togglePreview(f.file_hash)} className="flex-1 min-w-0 text-left">
                              <p className="text-xs font-medium text-text truncate hover:text-primary transition-colors">
                                {previewHash === f.file_hash ? '▾' : '▸'} {f.source_file || 'Unknown file'}
                              </p>
                              <p className="text-xs text-text-faint pl-3">{f.count} transactions · {f.min_date} → {f.max_date}</p>
                            </button>
                            <button onClick={() => setFileDeletePending(f)} className="flex-shrink-0 px-2.5 py-1 text-xs border border-expense/40 text-expense rounded-lg hover:bg-expense-light font-medium transition-colors">Delete</button>
                          </div>
                          {previewHash === f.file_hash && (
                            <div className="border-t border-expense/10 bg-surface px-3 py-2 max-h-56 overflow-y-auto">
                              {previewLoading ? <p className="text-xs text-text-faint text-center py-3">Loading…</p> : previewTxs.length === 0 ? <p className="text-xs text-text-faint text-center py-3">No transactions found</p> : (
                                <table className="w-full text-xs">
                                  <thead><tr className="text-text-faint border-b border-surface-border"><th className="text-left pb-1 font-medium">Date</th><th className="text-left pb-1 font-medium">Description</th><th className="text-left pb-1 font-medium">Type</th><th className="text-right pb-1 font-medium">Amount</th></tr></thead>
                                  <tbody className="divide-y divide-surface-border">
                                    {previewTxs.slice(0, 20).map(t => (
                                      <tr key={t.id}>
                                        <td className="py-1 pr-2 text-text-faint whitespace-nowrap">{t.date}</td>
                                        <td className="py-1 pr-2 text-text truncate max-w-[140px]">{t.description}</td>
                                        <td className={`py-1 pr-2 ${t.type === 'income' || t.type === 'transfer_in' ? 'text-income-text' : t.type === 'transfer' || t.type === 'transfer_out' ? 'text-text-faint' : 'text-expense-text'}`}>{t.type}</td>
                                        <td className="py-1 text-right text-text tabular-nums">${t.amount.toFixed(2)}</td>
                                      </tr>
                                    ))}
                                    {previewTxs.length > 20 && (
                                      <tr><td colSpan={4} className="py-1.5 text-center text-xs text-text-faint">… and {previewTxs.length - 20} more</td></tr>
                                    )}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                    {sourceFiles.length > 5 && (
                      <p className="text-xs text-text-faint text-center pt-1">
                        Showing 5 most recent uploads. To view and manage all files for a specific account, open that account's statement view from the sidebar.
                      </p>
                    )}
                  </div>
                )}
                {fileDeletePending && (
                  <div className="border border-expense/20 rounded-lg bg-expense-light/50 p-3 space-y-2">
                    <p className="text-xs text-expense font-medium">
                      Delete <span className="font-semibold">{fileDeletePending.count}</span> transactions from &ldquo;{fileDeletePending.source_file || 'this file'}&rdquo;? This cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setFileDeletePending(null)}
                        className="flex-1 py-1.5 rounded-lg text-xs text-text-muted border border-surface-border hover:bg-surface-hover transition-colors">
                        Cancel
                      </button>
                      <button onClick={handleFileDelete} disabled={fileDeleting}
                        className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-expense text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                        {fileDeleting ? 'Deleting…' : 'Yes, delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-expense/25 bg-expense-light/30 p-5 space-y-4">
                {/* Header */}
                <div className="flex items-start gap-3">
                  <svg aria-hidden="true" className="w-5 h-5 text-expense flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-expense">Clear All Transactions</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      Permanently deletes every transaction in the database. Accounts and categories are kept.
                      This cannot be undone.
                    </p>
                  </div>
                </div>

                {/* Success state */}
                {clearDone !== null ? (
                  <p className="text-sm text-income font-medium">
                    Deleted {clearDone} transaction{clearDone !== 1 ? 's' : ''}. The dashboard is now empty.
                  </p>
                ) : !clearConfirm ? (
                  /* Step 1 — initial button */
                  <button onClick={() => setClearConfirm(true)}
                    className="w-full py-2 rounded-lg text-sm font-medium border border-expense text-expense hover:bg-expense-light transition-colors">
                    Delete all transactions…
                  </button>
                ) : (
                  /* Step 2 — confirmation */
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-expense text-center">
                      Are you sure? This will erase ALL transactions and cannot be undone.
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setClearConfirm(false)}
                        className="flex-1 py-2 rounded-lg text-sm font-medium text-text-muted hover:text-text hover:bg-surface-hover border border-surface-border transition-colors">
                        Cancel
                      </button>
                      <button onClick={handleClearAll} disabled={clearing}
                        className="flex-1 py-2 rounded-lg text-sm font-semibold bg-expense text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                        {clearing ? 'Deleting…' : 'Yes, delete everything'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Undo toast */}
      {undoAction && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-text text-surface-card px-4 py-3 rounded-xl shadow-2xl text-sm">
          <span>
            {undoAction.kind === 'rename' && <>Renamed to <strong>"{undoAction.newName}"</strong></>}
            {undoAction.kind === 'merge' && <>Merged <strong>"{undoAction.deleted.name}"</strong> into <strong>"{undoAction.intoName}"</strong></>}
            {undoAction.kind === 'delete' && <>Deleted <strong>"{undoAction.deleted.name}"</strong>{undoAction.reassignedTo ? <> · reassigned to <strong>"{undoAction.reassignedTo}"</strong></> : ''}</>}
          </span>
          <button
            onClick={handleUndo}
            className="ml-1 px-2.5 py-1 rounded-lg bg-surface-card text-text text-xs font-semibold hover:bg-surface-hover transition-colors"
          >
            Undo
          </button>
          <button onClick={() => setUndoAction(null)} aria-label="Dismiss" className="text-surface-card/60 hover:text-surface-card transition-colors">
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}
