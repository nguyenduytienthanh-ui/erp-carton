export type OutboundShipmentStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PACKED' | 'IN_TRANSIT' | 'DELIVERED' | 'RETURNED' | 'CANCELLED';

export interface ShipmentLine {
  id?: number;
  line_number: number;
  product: number;
  product_name?: string;
  product_code?: string;
  qty_ordered: number;
  qty_shipped: number;
  qty_received?: number;
  unit_price: number;
  discount_pct?: number;
  tax_pct?: number;
  weight_per_unit?: number;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OutboundShipment {
  id?: number;
  code?: string;
  sales_order?: number | null;
  sales_order_code?: string | null;
  customer: number;
  customer_name?: string;
  shipment_date: string;
  status: OutboundShipmentStatus;
  reference?: string;
  carrier?: string;
  tracking_number?: string;
  shipping_address?: string;
  expected_delivery_date?: string;
  actual_delivery_date?: string | null;
  delivered_by?: string;
  delivery_notes?: string;
  submitted_by?: number | null;
  submitted_by_name?: string;
  submitted_at?: string | null;
  approved_by?: number | null;
  approved_by_name?: string;
  approved_at?: string | null;
  packed_by?: number | null;
  packed_by_name?: string;
  packed_at?: string | null;
  delivered_by_user?: number | null;
  delivered_by_user_name?: string;
  total_qty: number;
  total_weight_kg?: number;
  notes?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: number;
  created_by_name?: string;
  lines?: ShipmentLine[];
}
