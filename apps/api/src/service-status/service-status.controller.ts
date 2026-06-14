import { Controller, Get } from '@nestjs/common';
import { ServiceStatusService } from './service-status.service';

@Controller('service-status')
export class ServiceStatusController {
  constructor(private readonly serviceStatusService: ServiceStatusService) {}

  @Get()
  getServiceStatus() {
    return this.serviceStatusService.getServiceStatus();
  }
}
