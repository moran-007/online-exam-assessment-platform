import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UseRateLimitProfile } from '../../common/decorators/rate-limit-profile.decorator';
import { RequestContext } from '../../common/interfaces/request-context.interface';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

type HttpRequest = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @UseRateLimitProfile('login')
  login(@Body() dto: LoginDto, @Req() request: HttpRequest) {
    return this.authService.login(dto, this.toContext(request));
  }

  @Public()
  @Post('refresh')
  @UseRateLimitProfile('refresh')
  refresh(@Body() dto: RefreshTokenDto, @Req() request: HttpRequest) {
    return this.authService.refresh(dto.refreshToken, this.toContext(request));
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.authService.me(user);
  }

  @ApiBearerAuth()
  @Post('activity')
  activity() {
    return this.authService.activity();
  }

  @ApiBearerAuth()
  @Post('logout')
  logout(
    @CurrentUser() user: RequestUser,
    @Body() dto: LogoutDto,
    @Req() request: HttpRequest,
  ) {
    return this.authService.logout(user, this.toContext(request), dto.refreshToken);
  }

  private toContext(request: HttpRequest): RequestContext {
    const userAgent = request.headers['user-agent'];

    return {
      ip: request.ip,
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    };
  }
}
