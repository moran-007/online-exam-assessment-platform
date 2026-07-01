import { Module } from '@nestjs/common';
import { ReviewRulesController } from './review-rules.controller';
import { ReviewRulesService } from './review-rules.service';

@Module({
  controllers: [ReviewRulesController],
  providers: [ReviewRulesService],
})
export class ReviewRulesModule {}
