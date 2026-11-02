import { guardReply, UNVERIFIED_ORDER_REPLY } from './output-guard';

describe('guardReply', () => {
  const looked = new Set(['SF-7KQ2M9XA']);

  it('keeps an answer about an order that was looked up in this turn', () => {
    const text = 'Đơn SF-7KQ2M9XA đang ở trạng thái "Đang giao".';
    expect(guardReply(text, looked)).toEqual({ text, guarded: false });
  });

  it.each([
    'Đơn SF-AAAAAAAA đã giao thành công hôm qua.',
    'Đơn SF-AAAAAAAA đang giao, bạn chờ thêm nhé.',
    'Đơn SF-AAAAAAAA đã hủy.', // other spelling of "huỷ"
    'Order SF-AAAAAAAA is SHIPPED.',
  ])('replaces a status claim about an order nobody looked up: %s', (text) => {
    expect(guardReply(text, looked)).toEqual({ text: UNVERIFIED_ORDER_REPLY, guarded: true });
  });

  it('lets an answer mention an unknown code without claiming anything about it', () => {
    const text = 'Không tìm thấy đơn SF-AAAAAAAA. Bạn kiểm tra lại mã giúp mình nhé.';
    expect(guardReply(text, new Set())).toEqual({ text, guarded: false });
  });

  it('leaves answers without order codes alone', () => {
    const text = 'Tôi chỉ hỗ trợ được các việc chăm sóc khách hàng của ShopFast.';
    expect(guardReply(text, new Set())).toEqual({ text, guarded: false });
  });
});
