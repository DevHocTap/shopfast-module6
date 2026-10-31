import { MailMessage } from '../../infra/mail/mail.transport';

export interface OrderEmailData {
  code: string;
  customerName: string;
  customerEmail: string;
  total: number;
  discount: number;
  items: { name: string; quantity: number; lineTotal: number }[];
}

const vnd = (amount: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** One simple, inline-styled layout: email clients ignore stylesheets. */
function layout(title: string, body: string): string {
  return `<!doctype html><html lang="vi"><body style="margin:0;background:#f8fafc;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
<p style="font-size:18px;font-weight:600;color:#4338ca;margin:0 0 24px">ShopFast</p>
<div style="background:#ffffff;border-radius:12px;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${body}
</div>
<p style="font-size:13px;color:#64748b;margin:24px 0 0">Email tự động từ ShopFast, vui lòng không trả lời.</p>
</div></body></html>`;
}

function itemsTable(order: OrderEmailData): string {
  const rows = order.items
    .map(
      (item) =>
        `<tr><td style="padding:8px 0">${escapeHtml(item.name)} × ${item.quantity}</td><td style="padding:8px 0;text-align:right">${vnd(item.lineTotal)}</td></tr>`,
    )
    .join('');
  const discount = order.discount
    ? `<tr><td style="padding:8px 0;color:#64748b">Giảm giá</td><td style="padding:8px 0;text-align:right;color:#64748b">−${vnd(order.discount)}</td></tr>`
    : '';
  return `<table style="width:100%;border-collapse:collapse;font-size:15px">${rows}${discount}
<tr><td style="padding:12px 0 0;font-weight:600;border-top:1px solid #e2e8f0">Tổng cộng</td><td style="padding:12px 0 0;text-align:right;font-weight:600;border-top:1px solid #e2e8f0">${vnd(order.total)}</td></tr></table>`;
}

const button = (url: string, label: string) =>
  `<p style="margin:24px 0 0"><a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${escapeHtml(label)}</a></p>`;

export function orderConfirmationEmail(order: OrderEmailData, orderUrl: string): MailMessage {
  return {
    to: order.customerEmail,
    subject: `Xác nhận đơn hàng ${order.code}`,
    html: layout(
      `Cảm ơn ${order.customerName}, đơn ${order.code} đã được ghi nhận`,
      `<p style="margin:0 0 16px">Đơn hàng đang chờ thanh toán. Bạn có thể theo dõi trạng thái bất cứ lúc nào.</p>${itemsTable(order)}${button(orderUrl, 'Xem đơn hàng')}`,
    ),
    text: `Đơn ${order.code} đã được ghi nhận. Tổng cộng ${vnd(order.total)}. Xem đơn: ${orderUrl}`,
  };
}

export function paymentReminderEmail(order: OrderEmailData, orderUrl: string): MailMessage {
  return {
    to: order.customerEmail,
    subject: `Đơn ${order.code} đang chờ thanh toán`,
    html: layout(
      `Đơn ${order.code} chưa được thanh toán`,
      `<p style="margin:0 0 16px">Bạn đã đặt đơn nhưng chưa thanh toán. Hoàn tất thanh toán để chúng tôi chuẩn bị hàng sớm nhất.</p>${itemsTable(order)}${button(orderUrl, 'Thanh toán ngay')}`,
    ),
    text: `Đơn ${order.code} (${vnd(order.total)}) đang chờ thanh toán: ${orderUrl}`,
  };
}

export function otpEmail(to: string, code: string): MailMessage {
  return {
    to,
    subject: `Mã xác thực ShopFast: ${code}`,
    html: layout(
      'Mã xác thực của bạn',
      `<p style="margin:0 0 16px">Nhập mã sau để xác thực. Mã có hiệu lực trong 5 phút.</p>
<p style="font-size:28px;font-weight:600;letter-spacing:6px;margin:0">${escapeHtml(code)}</p>
<p style="margin:16px 0 0;color:#64748b;font-size:14px">Nếu bạn không yêu cầu mã này, hãy bỏ qua email.</p>`,
    ),
    text: `Mã xác thực ShopFast: ${code} (hiệu lực 5 phút).`,
  };
}

export function dailyReportEmail(
  to: string,
  report: { date: string; orderCount: number; revenue: number },
): MailMessage {
  return {
    to,
    subject: `Báo cáo doanh thu ngày ${report.date}`,
    html: layout(
      `Doanh thu ngày ${report.date}`,
      `<table style="width:100%;font-size:15px"><tr><td style="padding:8px 0">Số đơn (không tính đơn huỷ)</td><td style="text-align:right">${report.orderCount}</td></tr>
<tr><td style="padding:8px 0;font-weight:600">Doanh thu</td><td style="text-align:right;font-weight:600">${vnd(report.revenue)}</td></tr></table>`,
    ),
    text: `Ngày ${report.date}: ${report.orderCount} đơn, doanh thu ${vnd(report.revenue)}.`,
  };
}
