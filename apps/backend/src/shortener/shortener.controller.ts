import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ShortenerDto } from './dto';
import { Request } from 'express';
import { ShortenerService } from './shortener.service';
import { UserContext } from '../auth/interfaces/user-context';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { AppLoggerService } from '@reduced.to/logger';
import { ShortenerProducer } from './producer/shortener.producer';
import { ClientDetails, IClientDetails } from '../shared/decorators/client-details/client-details.decorator';
import { SafeUrlService } from '@reduced.to/safe-url';
import { AppConfigService } from '@reduced.to/config';
import { Link } from '@prisma/client';
import { addUtmParams } from '@reduced.to/utils';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { UsageService } from '@reduced.to/subscription-manager';
import { GuardFields } from './guards/feature.guard';

interface LinkResponse extends Partial<Link> {
  url: string;
  key: string;
}

@Controller({
  path: 'shortener',
  version: '1',
})
export class ShortenerController {
  constructor(
    private readonly configService: AppConfigService,
    private readonly logger: AppLoggerService,
    private readonly shortenerService: ShortenerService,
    private readonly shortenerProducer: ShortenerProducer,
    private readonly safeUrlService: SafeUrlService,
    private readonly usageService: UsageService
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('random')
  async random(): Promise<string> {
    return this.shortenerService.createRandomShortenedUrl();
  }

  @Get(':key')
  async findOne(
    @ClientDetails() clientDetails: IClientDetails,
    @Param('key') key: string,
    @Query('pw') password = '', // Add optional password query parameter
    @Req() req: Request
  ): Promise<LinkResponse> {
    const data = await this.shortenerService.getLink(key);

    if (!data) {
      throw new BadRequestException('Shortened url is wrong or expired');
    }

    if (data.password && (await this.shortenerService.verifyPassword(data.password, password)) === false) {
      throw new UnauthorizedException('Incorrect password for this url!');
    }

    try {
      await this.shortenerProducer.publish({
        ...clientDetails,
        referer: req.headers.referer,
        key: data.key,
        url: data.url,
      });
    } catch (err) {
      this.logger.error(`Error while publishing shortened url: ${err.message}`);
    }

    return {
      url: addUtmParams(data.url, data.utm),
      key: data.key,
    };
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  async shortener(@GuardFields() @Body() shortenerDto: ShortenerDto, @Req() req: Request): Promise<{ key: string }> {
    const user = req.user as UserContext;

    // Check if the url is safe
    if (this.configService.getConfig().safeUrl.enable) {
      const isSafeUrl = await this.safeUrlService.isSafeUrl(shortenerDto.url);
      if (!isSafeUrl) {
        throw new BadRequestException('This url is not safe to shorten!');
      }
    }

    if (shortenerDto.key) {
      const isKeyAvailable = await this.shortenerService.isKeyAvailable(shortenerDto.key);
      if (!isKeyAvailable) {
        throw new BadRequestException('This short link already exists');
      }
    }

    if (shortenerDto.temporary) {
      // Temporary links cannot be password protected
      const { password, ...rest } = shortenerDto;
      return this.shortenerService.createShortenedUrl(rest);
    }

    // Only verified users can create shortened urls
    if (!user?.verified) {
      throw new BadRequestException('You must be verified in to create a shortened url');
    }

    // Hash the password if it exists in the request
    if (shortenerDto.password) {
      shortenerDto.password = await this.shortenerService.hashPassword(shortenerDto.password);
    }

    const isEligibleToCreateLink = await this.usageService.isEligibleToCreateLink(user.id);
    if (!isEligibleToCreateLink) {
      throw new BadRequestException('You have reached your link creation limit');
    }

    this.logger.log(`User ${user.id} is creating a shortened url for ${shortenerDto.url}`);
    return this.shortenerService.createUsersShortenedUrl(user, shortenerDto);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Post('bulk')
  async bulk(@GuardFields() @Body() shortenerDto: ShortenerDto[], @Req() req: Request): Promise<{ keys: string[] }> {
    const user = req.user as UserContext;

    // Check if the url is safe
    if (this.configService.getConfig().safeUrl.enable) {
      const checks = await Promise.all(shortenerDto.map(({url}) => this.safeUrlService.isSafeUrl(url)));
      const isSafeUrl = checks.every(Boolean)
      if (!isSafeUrl) {
        throw new BadRequestException('This url is not safe to shorten!');
      }
    }

    // Only verified users can create shortened urls
    if (!user?.verified) {
      throw new BadRequestException('You must be verified in to create a shortened url');
    }

    this.logger.log(`User ${user.id} is creating a bulk-shortened url for ${shortenerDto.length} urls`);

    const keys = await Promise.all(shortenerDto.map(dto => this.shortenerService.createUsersShortenedUrl(user, dto)));

    return { keys: keys.map(({ key }) => key) }
  }
}
