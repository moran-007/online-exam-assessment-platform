import { IsOptional, IsString, ValidateIf } from 'class-validator';

export class LoginDto {
  @IsOptional()
  @IsString()
  provider = 'password';

  @ValidateIf((data: LoginDto) => !data.provider || data.provider === 'password')
  @IsString()
  username?: string;

  @ValidateIf((data: LoginDto) => !data.provider || data.provider === 'password')
  @IsString()
  password?: string;
}
