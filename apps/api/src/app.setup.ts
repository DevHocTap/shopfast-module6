import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

export const API_PREFIX = 'api';

/** HTTP pipeline shared by main.ts and the integration/e2e tests. */
export function configureApp(app: NestExpressApplication): void {
  // Exactly one proxy (Nginx) in front: req.ip becomes the real client IP, spoofed hops are ignored.
  app.set('trust proxy', 1);
  app.setGlobalPrefix(API_PREFIX);
  // Only the httpOnly refresh-token cookie is read (AuthController).
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
}
