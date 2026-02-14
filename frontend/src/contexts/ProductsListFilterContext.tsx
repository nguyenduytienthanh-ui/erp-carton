import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'DISCONTINUED';

export type FilterKey =
  | 'category'
  | 'unit'
  | 'status'
  | 'wave'
  | 'box_type'
  | 'code'
  | 'name'
  | 'cost_price'
  | 'sale_price'
  | 'size_po_dai'
  | 'size_po_rong'
  | 'size_po_cao'
  | 'size_sx_dai'
  | 'size_sx_rong'
  | 'size_sx_cao'
  | 'waterproof'
  | 'co_cm'
  | 'note';

export interface FilterValues {
  category: number | null;
  unit: number | null;
  status: ProductStatus | null;
  wave: number | null;
  box_type: number | null;
  code: string | null;
  name: string | null;
  min_cost_price: number | null;
  max_cost_price: number | null;
  min_sale_price: number | null;
  max_sale_price: number | null;
  size_po_dai: number | null;
  size_po_rong: number | null;
  size_po_cao: number | null;
  size_sx_dai: number | null;
  size_sx_rong: number | null;
  size_sx_cao: number | null;
  waterproof: string | null;
  co_cm: boolean | null;
  note: string | null;
}

export const EMPTY_FILTER_VALUES: FilterValues = {
  category: null,
  unit: null,
  status: null,
  wave: null,
  box_type: null,
  code: null,
  name: null,
  min_cost_price: null,
  max_cost_price: null,
  min_sale_price: null,
  max_sale_price: null,
  size_po_dai: null,
  size_po_rong: null,
  size_po_cao: null,
  size_sx_dai: null,
  size_sx_rong: null,
  size_sx_cao: null,
  waterproof: null,
  co_cm: null,
  note: null,
};

export interface PaginationState {
  current: number;
  pageSize: number;
  total: number;
}

const DEFAULT_PAGE_SIZE = 20;

export interface ProductsListFilterState {
  searchInput: string;
  search: string;
  activeFilters: FilterKey[];
  filterValues: FilterValues;
  pagination: PaginationState;
}

const defaultState: ProductsListFilterState = {
  searchInput: '',
  search: '',
  activeFilters: [],
  filterValues: EMPTY_FILTER_VALUES,
  pagination: { current: 1, pageSize: DEFAULT_PAGE_SIZE, total: 0 },
};

type SetState = React.Dispatch<React.SetStateAction<ProductsListFilterState>>;

const ProductsListFilterContext = createContext<{
  state: ProductsListFilterState;
  setState: SetState;
  setSearchInput: (v: string) => void;
  setSearch: (v: string) => void;
  setActiveFilters: (v: FilterKey[] | ((prev: FilterKey[]) => FilterKey[])) => void;
  setFilterValues: (v: FilterValues | ((prev: FilterValues) => FilterValues)) => void;
  setPagination: (v: PaginationState | ((prev: PaginationState) => PaginationState)) => void;
} | null>(null);

export function ProductsListFilterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProductsListFilterState>(defaultState);

  const setSearchInput = useCallback((v: string) => {
    setState((s) => ({ ...s, searchInput: v }));
  }, []);
  const setSearch = useCallback((v: string) => {
    setState((s) => ({ ...s, search: v }));
  }, []);
  const setActiveFilters = useCallback((v: FilterKey[] | ((prev: FilterKey[]) => FilterKey[])) => {
    setState((s) => ({ ...s, activeFilters: typeof v === 'function' ? v(s.activeFilters) : v }));
  }, []);
  const setFilterValues = useCallback((v: FilterValues | ((prev: FilterValues) => FilterValues)) => {
    setState((s) => ({ ...s, filterValues: typeof v === 'function' ? v(s.filterValues) : v }));
  }, []);
  const setPagination = useCallback((v: PaginationState | ((prev: PaginationState) => PaginationState)) => {
    setState((s) => ({ ...s, pagination: typeof v === 'function' ? v(s.pagination) : v }));
  }, []);

  return (
    <ProductsListFilterContext.Provider
      value={{
        state,
        setState,
        setSearchInput,
        setSearch,
        setActiveFilters,
        setFilterValues,
        setPagination,
      }}
    >
      {children}
    </ProductsListFilterContext.Provider>
  );
}

export function useProductsListFilter() {
  const ctx = useContext(ProductsListFilterContext);
  if (!ctx) throw new Error('useProductsListFilter must be used inside ProductsListFilterProvider');
  return ctx;
}
