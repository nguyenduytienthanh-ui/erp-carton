export interface FinancialSummary {
  date: string;
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  
  // Operational
  total_revenue: number;
  total_cogs: number;
  total_operating_expenses: number;
  gross_profit: number;
  operating_profit: number;
  net_profit: number;
  
  // Cash
  cash_balance: number;
  accounts_receivable: number;
  inventory_value: number;
  accounts_payable: number;
  
  // Ratios
  profit_margin?: number;
  gross_margin?: number;
  current_ratio?: number;
  debt_to_equity?: number;
}

export interface FinancialTrend {
  period: string;
  revenue: number;
  cogs: number;
  profit: number;
  cash_balance: number;
}
