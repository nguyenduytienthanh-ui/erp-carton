export interface QuoteMetrics {
  total_quotes: number;
  total_value: number;
  converted_quotes: number;
  conversion_rate: number;
  rejected_quotes: number;
  expired_quotes: number;
  average_conversion_time?: number;
  average_deal_size?: number;
}

export interface QuoteConversion {
  id?: number;
  quote_id: number;
  quote_code: string;
  order_id: number;
  order_code: string;
  conversion_date: string;
  customer_name?: string;
  quote_value: number;
  order_value: number;
  conversion_rate: number;
}

export interface QuoteAnalytics {
  period: string;
  metrics: QuoteMetrics;
  conversions: QuoteConversion[];
  trend?: Record<string, unknown> | Array<Record<string, unknown>> | null;
}
