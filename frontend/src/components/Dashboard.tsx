import { useEffect, useState } from 'react'
import { getCategories, getCCMonthly, getCCPaymentsByCard, getMonthlyContext, getMonthlyDashboard, getYearlyCategories, getYearlyDashboard } from '../api/client'
import type { AccountTypeBreakdown, CCMonthlyItem, CCPaymentMonthItem, Category, CategoryAmount, MonthlyContextItem, MonthlyData, MonthlySummary } from '../types'
import SummaryCards from './SummaryCards'
import CategoryPieChart from './charts/CategoryPieChart'
import CCPaymentsBarChart from './charts/CCPaymentsBarChart'
import CCTrendLineChart from './charts/CCTrendLineChart'
import MonthlyBarChart from './charts/MonthlyBarChart'
import TransactionList from './TransactionList'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]


interface Props {
  year: number
  month: number
  viewMode: 'month' | 'year'
}

export default function Dashboard({ year, month, viewMode }: Props) {
  const [summary, setSummary] = useState<MonthlySummary | null>(null)
  const [byAccountType, setByAccountType] = useState<AccountTypeBreakdown | null>(null)
  const [missingCCWarning, setMissingCCWarning] = useState(false)
  const [ccPaymentsTotal, setCcPaymentsTotal] = useState(0)
  const [categories, setCategories] = useState<CategoryAmount[]>([])
  const [categoriesBank, setCategoriesBank] = useState<CategoryAmount[]>([])
  const [categoriesCC, setCategoriesCC] = useState<CategoryAmount[]>([])
  const [categoryDefs, setCategoryDefs] = useState<Category[]>([])
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([])
  const [contextData, setContextData] = useState<MonthlyContextItem[]>([])
  const [ccMonthlyData, setCCMonthlyData] = useState<CCMonthlyItem[]>([])
  const [ccPaymentsByCard, setCCPaymentsByCard] = useState<CCPaymentMonthItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>()
  const [filterCat, setFilterCat] = useState<string | undefined>()
  const [filterAccount, setFilterAccount] = useState<number | undefined>()
  const [loading, setLoading] = useState(true)
  const [txRefresh, setTxRefresh] = useState(0)

  // Load DB category definitions once (for colors)
  useEffect(() => {
    getCategories().then(r => setCategoryDefs(r.data))
  }, [])

  useEffect(() => {
    setLoading(true)

    if (viewMode === 'month') {
      // 1 call for monthly summary + categories
      getMonthlyDashboard(year, month)
        .then((r) => {
          setSummary(r.data.summary)
          setCategories(r.data.categories)
          setCategoriesBank(r.data.categories_bank ?? [])
          setCategoriesCC(r.data.categories_cc ?? [])
          setCcPaymentsTotal(r.data.cc_payments_total ?? 0)
          setByAccountType(r.data.by_account_type ?? null)
          setMissingCCWarning(r.data.missing_cc_warning ?? false)
        })
        .finally(() => setLoading(false))

      // 1 call for context chart — last 6 months
      getMonthlyContext(year, month, 6).then(r => setContextData(r.data))
      // CC monthly trend — last 6 months
      getCCMonthly(year, month, 6).then(r => setCCMonthlyData(r.data))
      getCCPaymentsByCard(year, month, 6).then(r => setCCPaymentsByCard(r.data))
    } else {
      setMissingCCWarning(false)
      // 2 calls for yearly view (was 13 before)
      getCCMonthly(year).then(r => setCCMonthlyData(r.data))
      getCCPaymentsByCard(year).then(r => setCCPaymentsByCard(r.data))
      Promise.all([
        getYearlyDashboard(year),
        getYearlyCategories(year),
      ]).then(([yearly, cats]) => {
        setSummary(yearly.data.totals)
        setMonthlyData(yearly.data.months)
        setByAccountType(yearly.data.by_account_type ?? null)
        setCategories(cats.data.all)
        setCategoriesBank(cats.data.bank)
        setCategoriesCC(cats.data.cc)
        const ccPmts = cats.data.bank.find((c: { name: string; amount: number }) => c.name === 'CC Payments')
        setCcPaymentsTotal(ccPmts?.amount ?? 0)
      }).finally(() => setLoading(false))
    }
  }, [year, month, viewMode])

  const handleCategoryClick = (cat: string) => {
    setSelectedCategory((prev) => (prev === cat ? undefined : cat))
    setTxRefresh((k) => k + 1)
  }

  const refreshCharts = () => {
    if (viewMode === 'month') {
      getMonthlyDashboard(year, month).then(r => {
        setSummary(r.data.summary)
        setCategories(r.data.categories)
        setCategoriesBank(r.data.categories_bank ?? [])
        setCategoriesCC(r.data.categories_cc ?? [])
        setCcPaymentsTotal(r.data.cc_payments_total ?? 0)
        setByAccountType(r.data.by_account_type ?? null)
        setMissingCCWarning(r.data.missing_cc_warning ?? false)
      })
      getMonthlyContext(year, month, 6).then(r => setContextData(r.data))
      getCCMonthly(year, month, 6).then(r => setCCMonthlyData(r.data))
      getCCPaymentsByCard(year, month, 6).then(r => setCCPaymentsByCard(r.data))
    } else {
      getCCMonthly(year).then(r => setCCMonthlyData(r.data))
      getCCPaymentsByCard(year).then(r => setCCPaymentsByCard(r.data))
      Promise.all([getYearlyDashboard(year), getYearlyCategories(year)]).then(([yearly, cats]) => {
        setSummary(yearly.data.totals)
        setMonthlyData(yearly.data.months)
        setByAccountType(yearly.data.by_account_type ?? null)
        setCategories(cats.data.all)
        setCategoriesBank(cats.data.bank)
        setCategoriesCC(cats.data.cc)
        const ccPmts = cats.data.bank.find((c: { name: string; amount: number }) => c.name === 'CC Payments')
        setCcPaymentsTotal(ccPmts?.amount ?? 0)
      })
    }
  }

  const label = viewMode === 'month' ? `${MONTH_NAMES[month - 1]} ${year}` : `${year}`

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const emptySummary: MonthlySummary = { income: 0, expenses: 0, net: 0, savings_rate: 0 }

  return (
    <div>
      {/* Row 1: 5 KPI cards */}
      <SummaryCards
        key={viewMode === 'month' ? `month-${year}-${month}` : `year-${year}`}
        summary={summary || emptySummary}
        label={label}
        year={year}
        month={viewMode === 'month' ? month : undefined}
        byAccountType={byAccountType}
        missingCCWarning={viewMode === 'month' ? missingCCWarning : false}
      />

      <hr className="section-rule" />

      {/* Row 2: Bar chart (left) + Credit Card Trend (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MonthlyBarChart
          data={viewMode === 'year' ? monthlyData : contextData}
          currentMonth={viewMode === 'year' ? month : contextData.length}
        />
        <CCTrendLineChart data={ccMonthlyData} />
      </div>

      <hr className="section-rule" />

      {/* Row 3: CC Payments (left) + Spending categories pie chart (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CCPaymentsBarChart data={ccPaymentsByCard} />
        <CategoryPieChart
          data={categories}
          dataBank={categoriesBank}
          dataCC={categoriesCC}
          categoryDefs={categoryDefs}
          onCategoryClick={handleCategoryClick}
          selectedCategory={selectedCategory}
          ccPaymentsTotal={ccPaymentsTotal}
        />
      </div>

      <hr className="section-rule" />

      {/* Transaction list */}
      <div>
        <TransactionList
          year={year}
          month={viewMode === 'month' ? month : undefined}
          filterCategory={selectedCategory}
          onClearFilter={() => setSelectedCategory(undefined)}
          filterCat={filterCat}
          onFilterCatChange={setFilterCat}
          filterAccount={filterAccount}
          onFilterAccountChange={setFilterAccount}
          refreshKey={txRefresh}
          onDataChanged={refreshCharts}
        />
      </div>
    </div>
  )
}
