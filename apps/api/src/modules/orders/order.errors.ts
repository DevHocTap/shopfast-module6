import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { OrderStatus, STATUS_LABELS_VI } from './order-state-machine';

export const OrderErrors = {
  notFound: () => new AppError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.'),
  cartEmpty: () =>
    new AppError(HttpStatus.BAD_REQUEST, 'CART_EMPTY', 'Giỏ hàng đang trống, chưa thể đặt hàng.'),
  productUnavailable: (name: string) =>
    new AppError(
      HttpStatus.CONFLICT,
      'PRODUCT_UNAVAILABLE',
      `Sản phẩm "${name}" đã ngừng bán. Vui lòng xoá khỏi giỏ hàng.`,
    ),
  outOfStock: (productId: string, name: string) =>
    new AppError(
      HttpStatus.CONFLICT,
      'OUT_OF_STOCK',
      `Sản phẩm "${name}" không còn đủ hàng. Vui lòng giảm số lượng hoặc chọn sản phẩm khác.`,
      { productId },
    ),
  invalidTransition: (from: OrderStatus, to: OrderStatus) =>
    new AppError(
      HttpStatus.CONFLICT,
      'INVALID_TRANSITION',
      `Không thể chuyển đơn từ "${STATUS_LABELS_VI[from]}" sang "${STATUS_LABELS_VI[to]}".`,
      { from, to },
    ),
  stale: () =>
    new AppError(
      HttpStatus.CONFLICT,
      'STALE_ORDER',
      'Đơn hàng vừa được người khác cập nhật. Vui lòng tải lại để xem trạng thái mới nhất.',
    ),
  missingIdempotencyKey: () =>
    new AppError(
      HttpStatus.BAD_REQUEST,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Thiếu header Idempotency-Key (8–64 ký tự) để chống đặt trùng đơn.',
    ),
};
