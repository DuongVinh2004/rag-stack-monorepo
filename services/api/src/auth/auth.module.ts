import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import {
  getJwtAccessTtl,
  getJwtAudience,
  getJwtIssuer,
  getJwtSecret,
} from '../config/runtime-config';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: async () => ({
        secret: getJwtSecret(),
        signOptions: {
          audience: getJwtAudience(),
          expiresIn: getJwtAccessTtl(),
          issuer: getJwtIssuer(),
        },
        verifyOptions: {
          audience: getJwtAudience(),
          issuer: getJwtIssuer(),
        },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
