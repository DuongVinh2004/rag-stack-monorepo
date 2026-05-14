import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { LoginDto, RefreshTokenDto, RegisterDto } from './dto/auth.dto';
import {
  getBcryptRounds,
  getJwtRefreshTtl,
} from '../config/runtime-config';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, pass: string): Promise<any> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (user && user.status === 'ACTIVE' && await bcrypt.compare(pass, user.passwordHash)) {
      const { passwordHash: _passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokenPair = await this.issueTokenPair(user);
    return {
      ...tokenPair,
      user,
    };
  }

  async refresh(dto: RefreshTokenDto) {
    const payload = await this.verifyRefreshToken(dto.refreshToken);
    if (payload.tokenType !== 'refresh' || !payload.sessionId || !payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        user: true,
      },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.user.status !== 'ACTIVE' ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.tokenHash !== this.hashToken(dto.refreshToken)
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = session.user;
    const tokenPair = await this.prisma.$transaction(async (tx) => {
      await tx.refreshSession.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
          lastUsedAt: new Date(),
        },
      });

      return this.issueTokenPair(user, tx);
    });

    const { passwordHash: _passwordHash, ...safeUser } = user;
    return {
      ...tokenPair,
      user: safeUser,
    };
  }

  async register(registerDto: RegisterDto) {
    const normalizedEmail = this.normalizeEmail(registerDto.email);
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const hash = await bcrypt.hash(registerDto.password, getBcryptRounds());
    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: hash,
      },
    });
    const { passwordHash: _passwordHash, ...result } = user;
    return result;
  }

  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const { passwordHash: _passwordHash, ...result } = user;
    return result;
  }

  async logout(userId: string) {
    await this.prisma.refreshSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date(),
      },
    });

    return { message: 'Logged out successfully' };
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private async issueTokenPair(
    user: { id: string; email: string },
    prisma: Pick<PrismaService, 'refreshSession'> = this.prisma,
  ) {
    const accessToken = this.jwtService.sign({
      email: user.email,
      sub: user.id,
      tokenType: 'access',
    });
    const sessionId = crypto.randomUUID();
    const refreshToken = this.jwtService.sign(
      {
        email: user.email,
        sub: user.id,
        tokenType: 'refresh',
        sessionId,
      },
      {
        expiresIn: getJwtRefreshTtl(),
      },
    );

    await prisma.refreshSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: this.resolveTokenExpiration(refreshToken),
      },
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  private async verifyRefreshToken(refreshToken: string) {
    try {
      return await this.jwtService.verifyAsync<{
        sub?: string;
        email?: string;
        tokenType?: string;
        sessionId?: string;
      }>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private resolveTokenExpiration(token: string) {
    const decoded = this.jwtService.decode(token) as { exp?: number } | null;
    if (!decoded?.exp) {
      throw new UnauthorizedException('Invalid token expiry');
    }

    return new Date(decoded.exp * 1000);
  }

  private hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
