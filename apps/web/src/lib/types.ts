/** Response shapes of the ShopFast API (apps/api). */

export type Role = 'CUSTOMER' | 'SUPPORT' | 'WAREHOUSE' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt: string;
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface Named {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  inStock: boolean;
  version: number;
  category: Named;
  brand: Named;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CartItem {
  productId: string;
  sku: string;
  name: string;
  unitPrice: number;
  quantity: number;
  isActive: boolean;
  stock: number;
  lineTotal: number;
  available: boolean;
}

export interface Cart {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  hasUnavailableItems: boolean;
}

export type OrderStatus =
  'PENDING_PAYMENT' | 'PAID' | 'PACKING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export interface OrderSummary {
  id: string;
  code: string;
  status: OrderStatus;
  total: number;
  itemCount: number;
  version: number;
  createdAt: string;
  customer: { id: string; email: string; fullName: string };
}

export interface OrderDetail extends OrderSummary {
  subtotal: number;
  discount: number;
  updatedAt: string;
  items: {
    productId: string;
    productName: string;
    sku: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  history: { from: OrderStatus | null; to: OrderStatus; at: string }[];
  payment: { amount: number; method: string; paidAt: string } | null;
}

export interface StockLevel {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  version: number;
  updatedAt: string;
}
