export interface User {
  id: number
  name: string
  avatar_color: string
  has_passcode: boolean
  token?: string
}

export interface Category {
  id: number
  name: string
  color: string
}

export interface Account {
  id: number
  name: string
  type: 'credit_card' | 'bank_account' | 'investment'
  institution?: string
  last4?: string
  color: string
}

export interface AccountHint {
  last4?: string
  institution?: string
  account_type: 'credit_card' | 'bank_account'
  suggested_name: string
  color: string
}

export type TransactionType = 'income' | 'expense' | 'transfer_in' | 'transfer_out' | 'transfer'

export interface Transaction {
  id: number
  date: string
  description: string
  amount: number
  type: TransactionType
  category: string
  account?: string
  account_id?: number
  notes?: string
  source_file?: string
  file_hash?: string
  created_at?: string
}

export interface ParsedTransaction {
  date: string
  description: string
  amount: number
  type: TransactionType
  category: string
  account?: string
  account_id?: number
}

export interface MonthlySummary {
  income: number
  expenses: number
  net: number
  savings_rate: number
}

export interface CategoryAmount {
  name: string
  amount: number
}

export interface MonthlyData {
  month: number
  income: number
  expenses: number
  net: number
}

export interface MonthlyContextItem extends MonthlyData {
  year: number
}

export interface AccountTypeBreakdown {
  bank_income: number
  bank_spending: number
  cc_spending: number
  cc_refunds: number
  net_cc: number
}

export type PieSource = 'all' | 'bank' | 'cc'

export interface MonthlyDashboard {
  summary: MonthlySummary
  categories: CategoryAmount[]
  categories_bank: CategoryAmount[]
  categories_cc: CategoryAmount[]
  cc_payments_total: number
  cc_net_charges: number
  by_account_type: AccountTypeBreakdown | null
  missing_cc_warning: boolean
}

export interface YearlyCategoryDashboard {
  all: CategoryAmount[]
  bank: CategoryAmount[]
  cc: CategoryAmount[]
}

export interface YearlyDashboard {
  months: MonthlyData[]
  totals: MonthlySummary
  by_account_type: AccountTypeBreakdown | null
}

export interface CCPaymentCard {
  id: string
  name: string
  color: string
  amount: number
}

export interface CCPaymentMonthItem {
  month: number
  year: number
  total: number
  cards: CCPaymentCard[]
}

export interface CCAccountBreakdown {
  name: string
  last4: string | null
  color: string
  cc_spending: number
  cc_refunds: number
  net_cc: number
}

export interface CCMonthlyItem {
  month: number
  year: number
  cc_spending: number
  cc_refunds: number
  net_cc: number
  accounts: CCAccountBreakdown[]
}
