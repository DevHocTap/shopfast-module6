import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfigModule } from './infra/config/config.module';
import { DatabaseModule } from './infra/database/database.module';
import { LoggerModule } from './infra/logger/logger.module';
import { RedisModule } from './infra/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { UsersModule } from './modules/users/users.module';

/** Modules loaded by the `api` process (HTTP + WebSocket). */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    HealthModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    InventoryModule,
    CartModule,
    OrdersModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
