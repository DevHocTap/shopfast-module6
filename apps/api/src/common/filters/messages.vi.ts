import { HttpStatus } from '@nestjs/common';

/** User-facing fallback messages per HTTP status. Domain errors provide their own message. */
export const DEFAULT_MESSAGES_VI: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Dữ liệu gửi lên không hợp lệ.',
  [HttpStatus.UNAUTHORIZED]: 'Bạn cần đăng nhập để tiếp tục.',
  [HttpStatus.FORBIDDEN]: 'Bạn không có quyền thực hiện thao tác này.',
  [HttpStatus.NOT_FOUND]: 'Không tìm thấy nội dung yêu cầu.',
  [HttpStatus.CONFLICT]: 'Dữ liệu đã thay đổi hoặc bị trùng. Vui lòng tải lại và thử lại.',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Dữ liệu gửi lên quá lớn.',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Hệ thống đang bận. Vui lòng thử lại sau ít phút.',
};

export const INTERNAL_ERROR_MESSAGE_VI = 'Đã có lỗi xảy ra phía hệ thống. Vui lòng thử lại sau.';
