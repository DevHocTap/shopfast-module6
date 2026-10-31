import { OrderForEmail } from '../notifications/notifications.repository';

const vnd = (amount: number) =>
  new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** INV-20261031-SF7KQ2M9XA: date of issue + order code, unique because the order code is. */
export function invoiceNumber(orderCode: string, issuedAt: Date): string {
  const day = issuedAt.toISOString().slice(0, 10).replace(/-/g, '');
  return `INV-${day}-${orderCode.replace('SF-', 'SF')}`;
}

/**
 * Self-contained printable HTML (UTF-8, no external assets). The browser's "Print → Save as PDF"
 * turns it into a PDF with correct Vietnamese text, without embedding fonts on the server.
 */
export function renderInvoice(order: OrderForEmail, number: string, issuedAt: Date): string {
  const rows = order.items
    .map(
      (item, index) =>
        `<tr><td>${index + 1}</td><td>${escapeHtml(item.name)}</td><td class="num">${item.quantity}</td><td class="num">${vnd(item.lineTotal / item.quantity)}</td><td class="num">${vnd(item.lineTotal)}</td></tr>`,
    )
    .join('');
  const subtotal = order.items.reduce((sum, item) => sum + item.lineTotal, 0);
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Hoá đơn ${number}</title>
<style>
body{font-family:Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;max-width:760px;margin:32px auto;padding:0 16px}
h1{font-size:24px;margin:0}.muted{color:#64748b}.num{text-align:right;white-space:nowrap}
table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:8px;border-bottom:1px solid #e2e8f0;text-align:left}
th{font-size:14px;color:#64748b}.total td{font-weight:600;border-bottom:none}
@media print{body{margin:0}}
</style></head><body>
<p style="font-weight:600;color:#4338ca">ShopFast</p>
<h1>Hoá đơn bán hàng</h1>
<p class="muted">Số: ${number} · Ngày lập: ${issuedAt.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · Đơn hàng: ${escapeHtml(order.code)}</p>
<p>Khách hàng: <strong>${escapeHtml(order.customerName)}</strong> (${escapeHtml(order.customerEmail)})</p>
<table><thead><tr><th>#</th><th>Sản phẩm</th><th class="num">SL</th><th class="num">Đơn giá</th><th class="num">Thành tiền</th></tr></thead>
<tbody>${rows}
<tr><td colspan="4" class="num">Tạm tính</td><td class="num">${vnd(subtotal)}</td></tr>
${order.discount ? `<tr><td colspan="4" class="num">Giảm giá</td><td class="num">−${vnd(order.discount)}</td></tr>` : ''}
<tr class="total"><td colspan="4" class="num">Tổng thanh toán</td><td class="num">${vnd(order.total)}</td></tr>
</tbody></table>
<p class="muted" style="margin-top:32px">Hoá đơn điện tử được tạo tự động. In trang này (Ctrl+P) để lưu dạng PDF.</p>
</body></html>`;
}
