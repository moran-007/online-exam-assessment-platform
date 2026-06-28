import { LoginDto } from '../dto/login.dto';
import { RequestContext } from '../../../common/interfaces/request-context.interface';
import { RequestUser } from '../../../common/interfaces/request-user.interface';

export interface AuthProvider {
  readonly provider: string;
  validate(dto: LoginDto, context: RequestContext): Promise<RequestUser>;
}
