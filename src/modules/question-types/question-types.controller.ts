import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { QuestionTypeRegistry } from './question-type-registry.service';

@ApiTags('Question Type')
@Controller('question-types')
export class QuestionTypesController {
  constructor(private readonly registry: QuestionTypeRegistry) {}

  @Public()
  @Get()
  list() {
    return this.registry.descriptors();
  }
}
