import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordAuthProvider } from './providers/password-auth.provider';
import { TokenService } from './token.service';

@Module({
  imports: [AuditModule, JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService, PasswordAuthProvider],
  exports: [JwtModule, TokenService],
})
export class AuthModule {}
