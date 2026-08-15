import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from './entities/user.entity';

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): User => context.switchToHttp().getRequest().authUser,
);
