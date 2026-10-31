import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { AppConfigService } from '../../infra/config/config.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService, PASSWORD_HASHER } from './auth.service';
import { OtpService } from './otp.service';
import { PasswordHasher } from './password-hasher';
import { RefreshTokenEntity } from './refresh-token.entity';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([RefreshTokenEntity]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', issuer: 'shopfast' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'shopfast' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    { provide: PASSWORD_HASHER, useClass: PasswordHasher },
    // Order matters: authenticate, then rate-limit (per user when known, else per IP), then roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: RateLimitGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
