import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrderTrackingPublisher } from './order-tracking.publisher';
import { TrackingGateway } from './tracking.gateway';
import { TrackingRepository } from './tracking.repository';
import { TrackingService } from './tracking.service';

@Module({
  imports: [AuthModule], // JwtService: the socket handshake verifies the same access token
  providers: [
    TrackingService,
    TrackingRepository,
    TrackingGateway,
    { provide: OrderTrackingPublisher, useExisting: TrackingGateway },
  ],
  exports: [OrderTrackingPublisher],
})
export class TrackingModule {}
