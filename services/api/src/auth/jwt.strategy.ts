import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getJwtAudience, getJwtIssuer, getJwtSecret } from '../config/runtime-config';

type AccessTokenPayload = {
  sub?: string;
  email?: string;
  tokenType?: string;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      audience: getJwtAudience(),
      issuer: getJwtIssuer(),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: AccessTokenPayload) {
    if (!payload?.sub || payload.tokenType !== 'access') {
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { UserRole: { include: { role: true } } },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException();
    }
    return user;
  }
}
