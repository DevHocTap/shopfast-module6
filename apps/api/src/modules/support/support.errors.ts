import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';

export const SupportErrors = {
  notFound: () =>
    new AppError(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'Không tìm thấy yêu cầu hỗ trợ.'),
  orderNotFound: () =>
    new AppError(
      HttpStatus.BAD_REQUEST,
      'TICKET_ORDER_INVALID',
      'Đơn hàng đính kèm không tồn tại hoặc không thuộc tài khoản của bạn.',
    ),
  closed: () =>
    new AppError(
      HttpStatus.CONFLICT,
      'TICKET_CLOSED',
      'Yêu cầu này đã đóng. Vui lòng tạo yêu cầu mới nếu bạn cần hỗ trợ thêm.',
    ),
};
