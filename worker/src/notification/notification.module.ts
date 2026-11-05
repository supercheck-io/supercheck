import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { EmailTemplateModule } from '../email-template/email-template.module';
import { DbModule } from '../db/db.module';

@Module({
  imports: [EmailTemplateModule, DbModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
