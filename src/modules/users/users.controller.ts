import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { UsersService } from './users.service';

@ApiTags('User')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('students')
  @Permissions('exam:read')
  students() {
    return this.usersService.listStudents();
  }

  @Get('teachers')
  @Permissions('class:read')
  teachers() {
    return this.usersService.listTeachers();
  }
}
