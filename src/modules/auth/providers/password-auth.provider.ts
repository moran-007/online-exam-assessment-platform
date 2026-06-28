import { UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../common/interfaces/request-context.interface';
import { UsersService } from '../../users/users.service';
import { LoginDto } from '../dto/login.dto';
import { AuthProvider } from './auth-provider.interface';

@Injectable()
export class PasswordAuthProvider implements AuthProvider {
  readonly provider = 'password';

  constructor(private readonly usersService: UsersService) {}

  async validate(dto: LoginDto, _context: RequestContext) {
    if (!dto.username || !dto.password) {
      throw new UnauthorizedException('账号或密码错误');
    }

    const user = await this.usersService.findByLogin(dto.username);
    const passwordMatched = user
      ? await bcrypt.compare(dto.password, user.passwordHash)
      : false;

    if (!user || !passwordMatched) {
      throw new UnauthorizedException('账号或密码错误');
    }

    if (user.status !== UserStatus.ACTIVE || user.deletedAt) {
      throw new UnauthorizedException('用户已被禁用');
    }

    await this.usersService.touchLastLogin(user.id);
    const authenticatedUser = await this.usersService.findAuthenticatedById(user.id);

    if (!authenticatedUser) {
      throw new UnauthorizedException('用户不存在或已禁用');
    }

    return authenticatedUser;
  }
}
