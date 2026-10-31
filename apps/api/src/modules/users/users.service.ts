import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from '../../common/auth/role.enum';
import { AppError } from '../../common/errors/app-error';
import { UserEntity } from './user.entity';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  createdAt: Date;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  fullName: string;
  role?: Role;
}

@Injectable()
export class UsersService {
  constructor(@InjectRepository(UserEntity) private readonly users: Repository<UserEntity>) {}

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  async getById(id: string): Promise<UserEntity> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) {
      throw new AppError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.');
    }
    return user;
  }

  create(input: NewUser): Promise<UserEntity> {
    return this.users.save(
      this.users.create({
        email: input.email.trim().toLowerCase(),
        passwordHash: input.passwordHash,
        fullName: input.fullName.trim(),
        role: input.role ?? Role.CUSTOMER,
      }),
    );
  }

  static toProfile(user: UserEntity): UserProfile {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      createdAt: user.createdAt,
    };
  }
}
