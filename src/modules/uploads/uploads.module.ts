import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { AssetTokenService } from './asset-token.service';

@Module({
  controllers: [UploadsController],
  providers: [UploadsService, AssetTokenService],
  exports: [AssetTokenService],
})
export class UploadsModule {}
