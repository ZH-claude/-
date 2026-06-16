import { Controller, Get, Inject } from '@nestjs/common';
import { ServiceStatusService } from './service-status.service';

@Controller('service-status')
export class ServiceStatusController {
  constructor(@Inject(ServiceStatusService) private readonly serviceStatusService: ServiceStatusService) {}

  @Get()
  getServiceStatus() {
    return this.serviceStatusService.getServiceStatus();
  }
}
