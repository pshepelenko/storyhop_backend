import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggingModule } from '../logging/logging.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSession } from './entities/auth-session.entity';
import { ChildProfile } from './entities/child-profile.entity';
import { UserPreference } from './entities/user-preference.entity';
import { User } from './entities/user.entity';
import { SessionAuthGuard } from './session-auth.guard';
import { SeasonOwnerGuard } from './season-owner.guard';
import { Season } from '../seasons/entities/season.entity';
import { UsersService } from './users.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User, AuthSession, ChildProfile, UserPreference, Season]), LoggingModule],
  controllers: [AuthController],
  providers: [UsersService, AuthService, SessionAuthGuard, SeasonOwnerGuard],
  exports: [UsersService, AuthService, SessionAuthGuard, SeasonOwnerGuard, TypeOrmModule],
})
export class UsersModule {}
