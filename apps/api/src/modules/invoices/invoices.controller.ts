import { Controller, Get, Header, HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { OrdersService } from '../orders/orders.service';
import { InvoicesRepository } from './invoices.repository';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class InvoicesController {
  constructor(
    private readonly orders: OrdersService,
    private readonly invoices: InvoicesRepository,
  ) {}

  /** Printable HTML invoice. Same access rule as the order: owner or staff. */
  @Get(':id/invoice')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  async invoice(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<string> {
    await this.orders.getForUser(user, id);
    const invoice = await this.invoices.findByOrder(id);
    if (!invoice) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'INVOICE_NOT_READY',
        'Hoá đơn đang được tạo, vui lòng thử lại sau ít giây.',
      );
    }
    return invoice.html;
  }
}
