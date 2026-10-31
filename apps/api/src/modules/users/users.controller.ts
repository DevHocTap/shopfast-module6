import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/auth/decorators';
import { UserProfile, UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async me(@CurrentUser() user: AuthUser): Promise<UserProfile> {
    return UsersService.toProfile(await this.usersService.getById(user.id));
  }
}
