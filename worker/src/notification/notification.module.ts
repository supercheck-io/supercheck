import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { EmailTemplateModule } from '../email-template/email-template.module';

@Module({
  imports: [EmailTemplateModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
